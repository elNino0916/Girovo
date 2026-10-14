// The WebView's fetch, rerouted. On the phone there is no server across the
// network: the page's `/api/…` calls are answered by the route handlers in
// this same page (mobile/server/index.ts), and the server's own requests — to
// the bank, to Brandfetch — leave through the app's native HTTP stack
// (GirovoHttp), which is not held to the WebView's CORS rules. Banks' FinTS
// endpoints send no CORS headers, so a WebView fetch to them would always fail.
//
// Everything else (the app's own files) goes to the WebView's fetch as before.
//
// Only https leaves the app. Every bank URL in banks-data.json is https, and a
// request in the clear would show the bank's traffic to the network.
//
// A native request resolves in two steps, like a real fetch: the Response
// once the head is in, its body when it is read. lib/bank-fetch.ts gives a
// bank one minute to *start* answering and then as long as twelve months of
// Umsätze take to arrive — it can only tell those apart because of that.

import { Capacitor } from '@capacitor/core';
import { Buffer } from 'buffer';
import { GirovoHttp } from '../native';

type Handler = (req: Request) => Promise<Response>;

const original: typeof fetch = window.fetch.bind(window);
let nextId = 0;

/**
 * Failures that prove the request never left the phone: no address for the
 * host, or no connection to it. Nothing reached the bank, so the very same
 * bytes may be sent again — a FinTS message carries its number, and a
 * request the bank never saw used none of it.
 */
const NOT_SENT = new Set(['ENOTFOUND', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH']);

// From Android 15, an app in the background has no network unless a
// foreground service keeps it (ApprovalService covers an approval being
// awaited; this covers what slips past it — a race at the switch, the
// service's three-minute limit). Its requests then fail before they leave.
let hiddenAt = document.hidden ? Date.now() : 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
});
/** Whether the app is in the background, or was a moment ago (the failure can beat the event). */
const awayNow = () => document.hidden || Date.now() - hiddenAt < 3000;
/** Resolves once the app is in front again, and its network back with it. */
function backInFront(): Promise<void> {
  return new Promise((resolve) => {
    const settle = () => setTimeout(resolve, 400);
    if (!document.hidden) return settle();
    const onChange = () => {
      if (document.hidden) return;
      document.removeEventListener('visibilitychange', onChange);
      settle();
    };
    document.addEventListener('visibilitychange', onChange);
  });
}

/** A failed request, shaped like Node's fetch failure so lib/bank-fetch.ts can sort it. */
function fetchFailed(code: string, message?: string): TypeError {
  const err = new TypeError('fetch failed');
  (err as TypeError & { cause: unknown }).cause = { code, message };
  return err;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

async function bodyBase64(body: BodyInit | null | undefined): Promise<string | undefined> {
  if (body == null) return undefined;
  if (typeof body === 'string') return Buffer.from(body, 'utf8').toString('base64');
  if (body instanceof Uint8Array) return Buffer.from(body).toString('base64');
  if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body)).toString('base64');
  return Buffer.from(new Uint8Array(await new Response(body).arrayBuffer())).toString('base64');
}

/** Status codes that may not carry a body in a Response. */
const NULL_BODY = new Set([101, 103, 204, 205, 304]);

const failure = (err: unknown) => {
  const e = err as { code?: string; message?: string } | null;
  return fetchFailed(e?.code || 'EUNKNOWN', e?.message);
};

/** A request to another host, through the native stack. */
export async function nativeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const asRequest = input instanceof Request ? input : null;
  const url = asRequest ? asRequest.url : String(input);
  if (!/^https:\/\//i.test(url)) throw fetchFailed('ERR_TLS_REQUIRED', 'only https leaves the app');

  // From init, not from a Request: a Request drops the headers browsers keep
  // for themselves (User-Agent, Referer), which lib/merchants.ts sets on purpose.
  const headers: Record<string, string> = {};
  asRequest?.headers.forEach((v, k) => (headers[k] = v));
  new Headers(init?.headers).forEach((v, k) => (headers[k] = v));

  const signal = init?.signal ?? asRequest?.signal ?? null;
  if (signal?.aborted) throw abortReason(signal);

  const base = `r${++nextId}`;
  /** The native request under way: a resend gets a name of its own. */
  let id = base;
  const method = (init?.method ?? asRequest?.method ?? 'GET').toUpperCase();
  const rawBody = init?.body ?? (asRequest && method !== 'GET' && method !== 'HEAD' ? await asRequest.arrayBuffer() : undefined);
  const body = await bodyBase64(rawBody);

  // Every stage races the caller's signal: a native call cannot be aborted
  // from here, only told to stop (cancel), so the promise must not wait for it.
  let cancelled = false;
  const aborted = new Promise<never>((_, reject) => {
    signal?.addEventListener(
      'abort',
      () => {
        cancelled = true;
        void GirovoHttp.cancel({ id }).catch(() => {});
        reject(abortReason(signal));
      },
      { once: true },
    );
  });
  aborted.catch(() => {}); // only ever observed through the races below
  const race = <T>(p: Promise<T>) => (signal ? Promise.race([p, aborted]) : p);

  let head;
  for (let attempt = 0; ; attempt++) {
    try {
      id = attempt ? `${base}.${attempt}` : base;
      head = await race(GirovoHttp.open({ id, url, method, headers, body }));
      break;
    } catch (err) {
      if (cancelled) throw err;
      const code = (err as { code?: string } | null)?.code ?? '';
      // Cut off in the background before it left: once more, once the app is back.
      if (attempt === 0 && NOT_SENT.has(code) && awayNow()) {
        await race(backInFront());
        continue;
      }
      throw failure(err);
    }
  }
  const status = head.status >= 200 && head.status <= 599 ? head.status : 502;

  const readBody = async (): Promise<Uint8Array> => {
    try {
      const { body } = await race(GirovoHttp.body({ id }));
      return Buffer.from(body, 'base64');
    } catch (err) {
      if (cancelled) throw err;
      throw failure(err);
    }
  };

  if (NULL_BODY.has(status)) {
    void readBody().catch(() => {});
    return new Response(null, { status, statusText: head.statusText, headers: head.headers });
  }
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const bytes = await readBody();
        if (bytes.length) controller.enqueue(bytes);
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      void GirovoHttp.cancel({ id }).catch(() => {});
    },
  });
  return new Response(stream, { status, statusText: head.statusText, headers: head.headers });
}

/** Routes every fetch of the page: `/api/…` to `handle`, other hosts to the native stack. */
export function installFetch(handle: Handler): void {
  const native = Capacitor.isNativePlatform();
  const routed: typeof fetch = (input, init) => {
    const href = input instanceof Request ? input.url : String(input instanceof URL ? input.href : input);
    let url: URL;
    try {
      url = new URL(href, location.href);
    } catch {
      return original(input, init);
    }
    if (url.origin === location.origin) {
      if (url.pathname.startsWith('/api/')) return handle(new Request(input instanceof Request ? input : url, init));
      return original(input, init);
    }
    // In a desktop browser (developing the phone build) there is no native
    // stack; the request goes out as the browser would send it.
    if (!native) return original(input, init);
    return nativeFetch(input, init);
  };
  window.fetch = routed;
}
