// The in-page server's line to the page (mobile/worker/host.ts on the page,
// mobile/worker/server.ts beside the route handlers).
//
// The route handlers run in a Web Worker of their own, so that what they do
// at length — opening a vault of a few MB, scrypt, reading a year of
// Umsätze — never holds up the page's frames. A worker has no window: what
// the shell offers (Tauri's invoke, Capacitor's plugins) is only there on the
// page. So both sides talk over postMessage, both ways, in four kinds of
// message:
//
//   call     run a function the other side offers by name; `id` 0 wants no answer
//   reply    its result, or its error
//   listen   start hearing an event source the other side offers; `unlisten` stops it
//   event    one thing it heard
//
// Anything else goes to the `other` handler (the start-up handshake).
//
// Buffers that can move rather than be copied — a vault's bytes, a model's
// output — are sent as transferables: a call names them, an answer wraps
// itself in moved(). Errors keep their name, message and `code` across (the
// server code sorts bank failures by err.code); a shell's plain-string
// rejection stays a string, as desktop/shell.ts expects it.
//
// Direct is the same line without a worker: the page's own functions,
// called in place, for the server on the page's thread (the fallback).
//
// No imports: the tests (link.test.ts) load this file in Node as it is.

/** What a Worker, a worker's global scope and a MessagePort have in common. */
export type Port = {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...args: any[]) => unknown;
/** Functions one side offers the other, by name. */
export type Calls = Record<string, Fn>;
/** An event source: starts handing `emit` what it hears, and returns how to stop. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Source = (emit: (payload: any) => void, ...args: any[]) => (() => void) | Promise<() => void> | void;
export type Sources = Record<string, Source>;

/** What the server code sees of the page, whichever side of a worker it is on. */
export interface Line {
  call<T = unknown>(name: string, args?: unknown[], transfer?: Transferable[]): Promise<T>;
  /** A call nobody waits for: a report, a log line. */
  send(name: string, args?: unknown[]): void;
  listen(name: string, args: unknown[], fn: (payload: unknown) => void): () => void;
}

/** A result sent with some of its buffers moved rather than copied. */
export class Moved<T> {
  readonly value: T;
  readonly transfer: Transferable[];
  constructor(value: T, transfer: Transferable[]) {
    this.value = value;
    this.transfer = transfer;
  }
}

export const moved = <T>(value: T, transfer: Transferable[] = []): Moved<T> => new Moved(value, transfer);

/**
 * The buffer under `bytes`, when moving it gives away exactly these bytes:
 * a view into a larger buffer (Buffer's pool) is copied instead.
 */
export function wholeBuffer(bytes: unknown): ArrayBuffer[] {
  if (bytes instanceof ArrayBuffer) return [bytes];
  if (ArrayBuffer.isView(bytes) && bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return [bytes.buffer];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Errors across

type PackedError = { $error: true; name: string; message: string; stack?: string; code?: unknown; data?: unknown };

/** An Error as a plain object (a structured clone would drop its `code`); anything else as it is. */
export function packError(err: unknown): unknown {
  const e = err as { name?: unknown; message?: unknown; stack?: unknown; code?: unknown; data?: unknown } | null;
  if (!(err instanceof Error) && !(e && typeof e === 'object' && typeof e.message === 'string')) return err;
  const out: PackedError = { $error: true, name: typeof e!.name === 'string' ? e!.name : 'Error', message: String(e!.message) };
  if (typeof e!.stack === 'string') out.stack = e!.stack;
  if (e!.code !== undefined) out.code = e!.code;
  if (e!.data !== undefined) out.data = e!.data;
  return out;
}

export function unpackError(value: unknown): unknown {
  const p = value as PackedError | null;
  if (!p || typeof p !== 'object' || p.$error !== true) return value;
  const err = new Error(p.message) as Error & { code?: unknown; data?: unknown };
  err.name = p.name;
  if (p.stack) err.stack = p.stack;
  if ('code' in p) err.code = p.code;
  if ('data' in p) err.data = p.data;
  return err;
}

// ---------------------------------------------------------------------------
// Requests and answers across

/** A Request as it crosses: the body as bytes, and the page's language (lib/i18n/locale.ts). */
export type WireRequest = { url: string; method: string; headers: [string, string][]; body: ArrayBuffer | null; locale?: string };
export type WireResponse = { status: number; statusText: string; headers: [string, string][]; body: ArrayBuffer | null };

/** Status codes that may not carry a body in a Response. */
const NULL_BODY = new Set([101, 103, 204, 205, 304]);

export async function packRequest(req: Request, locale?: string): Promise<Moved<WireRequest>> {
  const method = req.method.toUpperCase();
  const body = method === 'GET' || method === 'HEAD' || req.body === null ? null : await req.arrayBuffer();
  const wire: WireRequest = { url: req.url, method: req.method, headers: [...req.headers], body };
  if (locale) wire.locale = locale;
  return moved(wire, body ? [body] : []);
}

export function unpackRequest(wire: WireRequest): Request {
  return new Request(wire.url, { method: wire.method, headers: wire.headers, body: wire.body });
}

/** The whole answer at once: no route streams (lib/api.ts reads only requests piecewise). */
export async function packResponse(res: Response): Promise<Moved<WireResponse>> {
  const body = res.body === null || NULL_BODY.has(res.status) ? null : await res.arrayBuffer();
  return moved({ status: res.status, statusText: res.statusText, headers: [...res.headers], body }, body ? [body] : []);
}

export function unpackResponse(wire: WireResponse): Response {
  return new Response(NULL_BODY.has(wire.status) ? null : wire.body, { status: wire.status, statusText: wire.statusText, headers: wire.headers });
}

// ---------------------------------------------------------------------------
// The line

type Message =
  | { k: 'call'; id: number; name: string; args?: unknown[] }
  | { k: 'reply'; id: number; ok: true; value: unknown }
  | { k: 'reply'; id: number; ok: false; error: unknown }
  | { k: 'listen'; sub: number; name: string; args?: unknown[] }
  | { k: 'unlisten'; sub: number }
  | { k: 'event'; sub: number; payload: unknown };

type Own = {
  calls?: Calls;
  sources?: Sources;
  /** Any message that is none of the line's own. */
  other?: (message: { k?: unknown } & Record<string, unknown>) => void;
};

export class Link implements Line {
  private nextId = 0;
  private nextSub = 0;
  private readonly waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  private readonly listeners = new Map<number, (payload: unknown) => void>();
  /** The sources this side runs for the other, by subscription. */
  private readonly serving = new Map<number, Promise<(() => void) | void>>();
  private readonly port: Port;
  private readonly own: Own;

  constructor(port: Port, own: Own = {}) {
    this.port = port;
    this.own = own;
    port.addEventListener('message', (event) => this.receive(event.data));
    // A MessagePort only delivers once started; a worker and its scope have no start().
    (port as { start?: () => void }).start?.();
  }

  call<T = unknown>(name: string, args: unknown[] = [], transfer: Transferable[] = []): Promise<T> {
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      try {
        this.port.postMessage({ k: 'call', id, name, args } satisfies Message, transfer);
      } catch (err) {
        this.waiting.delete(id);
        reject(err);
      }
    });
  }

  send(name: string, args: unknown[] = []): void {
    try {
      this.port.postMessage({ k: 'call', id: 0, name, args } satisfies Message);
    } catch {
      /* not cloneable: a report or a log line is not worth a failure */
    }
  }

  listen(name: string, args: unknown[], fn: (payload: unknown) => void): () => void {
    const sub = ++this.nextSub;
    this.listeners.set(sub, fn);
    this.port.postMessage({ k: 'listen', sub, name, args } satisfies Message);
    return () => {
      if (this.listeners.delete(sub)) this.port.postMessage({ k: 'unlisten', sub } satisfies Message);
    };
  }

  /** A message of the handshake's own. */
  post(message: { k: string } & Record<string, unknown>, transfer: Transferable[] = []): void {
    this.port.postMessage(message, transfer);
  }

  private receive(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const msg = data as Message;
    switch (msg.k) {
      case 'call':
        void this.answer(msg.id, msg.name, msg.args ?? []);
        return;
      case 'reply': {
        const waiting = this.waiting.get(msg.id);
        if (!waiting) return;
        this.waiting.delete(msg.id);
        if (msg.ok) waiting.resolve(msg.value);
        else waiting.reject(unpackError(msg.error));
        return;
      }
      case 'listen':
        this.start(msg.sub, msg.name, msg.args ?? []);
        return;
      case 'unlisten':
        this.stop(msg.sub);
        return;
      case 'event':
        this.listeners.get(msg.sub)?.(msg.payload);
        return;
      default:
        this.own.other?.(data as { k?: unknown } & Record<string, unknown>);
    }
  }

  private async answer(id: number, name: string, args: unknown[]): Promise<void> {
    let value: unknown;
    let transfer: Transferable[] = [];
    try {
      const fn = this.own.calls?.[name];
      if (typeof fn !== 'function') throw new Error(`Girovo: no "${name}" across the line`);
      value = await fn(...args);
      if (value instanceof Moved) {
        transfer = value.transfer;
        value = value.value;
      }
    } catch (err) {
      if (id) this.reply({ k: 'reply', id, ok: false, error: packError(err) });
      else console.warn(`[link] ${name}:`, err);
      return;
    }
    if (id) this.reply({ k: 'reply', id, ok: true, value }, transfer);
  }

  private reply(msg: Message, transfer: Transferable[] = []): void {
    try {
      this.port.postMessage(msg, transfer);
    } catch (err) {
      // An answer that cannot be cloned: the caller hears why instead of waiting forever.
      const e = packError(err) as PackedError;
      this.port.postMessage({ k: 'reply', id: (msg as { id: number }).id, ok: false, error: { $error: true, name: e.name, message: e.message } } satisfies Message);
    }
  }

  private start(sub: number, name: string, args: unknown[]): void {
    const source = this.own.sources?.[name];
    if (typeof source !== 'function') {
      console.warn(`[link] no event source "${name}"`);
      return;
    }
    const emit = (payload: unknown) => {
      if (!this.serving.has(sub)) return;
      try {
        this.port.postMessage({ k: 'event', sub, payload } satisfies Message);
      } catch (err) {
        console.warn(`[link] ${name}: an event could not be sent`, err);
      }
    };
    // Registered before the source runs, so an event it hands over at once is not dropped.
    this.serving.set(
      sub,
      Promise.resolve()
        .then(() => source(emit, ...args))
        .catch((err: unknown) => {
          console.warn(`[link] ${name}:`, err);
        }),
    );
  }

  private stop(sub: number): void {
    const off = this.serving.get(sub);
    if (!off) return;
    this.serving.delete(sub);
    void off.then((fn) => fn?.());
  }
}

/** The line without a worker: the page's functions, called in place (the server on the page's thread). */
export class Direct implements Line {
  private readonly own: { calls?: Calls; sources?: Sources };

  constructor(own: { calls?: Calls; sources?: Sources }) {
    this.own = own;
  }

  call<T = unknown>(name: string, args: unknown[] = []): Promise<T> {
    try {
      const fn = this.own.calls?.[name];
      if (typeof fn !== 'function') throw new Error(`Girovo: no "${name}" on the page`);
      return Promise.resolve(fn(...args)).then((v) => (v instanceof Moved ? v.value : v) as T);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  send(name: string, args: unknown[] = []): void {
    this.call(name, args).catch(() => {});
  }

  listen(name: string, args: unknown[], fn: (payload: unknown) => void): () => void {
    const source = this.own.sources?.[name];
    if (typeof source !== 'function') {
      console.warn(`[link] no event source "${name}"`);
      return () => {};
    }
    const off = Promise.resolve()
      .then(() => source(fn, ...args))
      .catch((err: unknown) => {
        console.warn(`[link] ${name}:`, err);
      });
    return () => void off.then((stop) => stop?.());
  }
}
