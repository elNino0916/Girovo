// Every request lib-fints sends to a bank, under one policy — and the one
// place that turns whatever went wrong on the way into a German sentence.
//
// lib-fints posts each FinTS message with the global fetch, without a signal
// and without a time limit of its own (node_modules/lib-fints/dist/
// httpClient.js). Node's fetch then waits up to five minutes for a reply, and
// an HTTP error page from a bank in maintenance comes back, markup and all, as
// "Request failed with status code 503: <html>…". The policy is attached from
// outside, so node_modules stays untouched:
//  - HttpClient.prototype.sendMessage runs inside an AsyncLocalStorage scope;
//  - a wrapper around globalThis.fetch applies the policy to the requests made
//    inside that scope only. Every other fetch in the process passes through.
//
// The policy:
//  - FIRST_BYTE_MS: the bank must start answering within a minute. It limits
//    the wait for the first byte, not the whole request — a slow bank, or
//    twelve months of Umsätze, may take longer to arrive once it has started.
//  - A caller's signal (withBankSignal: a login the user called off) ends the
//    request at once.
//  - A non-2xx answer, or a reply that is no FinTS message, becomes
//    BankUnavailable. Its body is logged here, on the server, and goes no
//    further.
//
// What a broken request means is still the caller's to decide. These errors
// are thrown from inside the dialog exactly like a dropped connection, so an
// order whose answer is lost this way still ends as OrderUnanswered — "Status
// unklar", never "failed" (lib/fints-order.ts).

import { AsyncLocalStorage } from 'node:async_hooks';
import { HttpClient } from 'lib-fints';
import { BANK_UNAVAILABLE, BANK_UNREACHABLE } from './bank-answer.ts';
import { reportMetric, telemetryContext } from './telemetry.ts';

/** How long a bank may take to start answering. */
export const FIRST_BYTE_MS = 60_000;

export type BankUnavailableReason = 'timeout' | 'status' | 'unreadable';

/** The bank did not answer usefully. The message is for the server log. */
export class BankUnavailable extends Error {
  readonly reason: BankUnavailableReason;
  readonly status: number | null;
  constructor(reason: BankUnavailableReason, status: number | null = null) {
    super(
      reason === 'status' ? `bank answered HTTP ${status}`
        : reason === 'timeout' ? 'bank sent nothing within the first-byte limit'
          : 'bank reply is no FinTS message',
    );
    this.name = 'BankUnavailable';
    this.reason = reason;
    this.status = status;
  }
}

/** The request was called off by the app (withBankSignal). */
export class BankRequestCancelled extends Error {
  constructor() {
    super('bank request cancelled');
    this.name = 'BankRequestCancelled';
  }
}

type Fetch = typeof fetch;
type Scope = { signal?: AbortSignal; bankCall?: boolean; inPolicy?: boolean };

// On globalThis, like the session store: a route module evaluated again (hot
// reload) must keep talking to the scope the installed patches read.
const g = globalThis as typeof globalThis & { __girovoBankScope?: AsyncLocalStorage<Scope> };
const scope: AsyncLocalStorage<Scope> = (g.__girovoBankScope ??= new AsyncLocalStorage<Scope>());

/** Runs `fn` so that `signal` ends every bank request made inside it. */
export function withBankSignal<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
  return scope.run({ ...scope.getStore(), signal }, fn);
}

function hostOf(input: Parameters<Fetch>[0]): string {
  try {
    return new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).host;
  } catch {
    return 'bank';
  }
}

/** Whitespace folded and cut short: enough to recognise a maintenance page in the log. */
const snippet = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 400);

/** Every FinTS message opens with its header segment, HNHBK — base64 on the wire. */
function isFinTSReply(text: string): boolean {
  const head = text.slice(0, 64).replace(/\s+/g, '').slice(0, 16);
  return Buffer.from(head, 'base64').toString('latin1').startsWith('HNHBK:');
}

/**
 * One bank request under the policy, through `inner` (the fetch it wraps).
 * Resolves with a Response lib-fints can read as before, or throws
 * BankUnavailable / BankRequestCancelled / whatever the connection threw.
 */
export async function fetchFromBank(
  inner: Fetch,
  input: Parameters<Fetch>[0],
  init?: RequestInit,
  opts: { signal?: AbortSignal; firstByteMs?: number; log?: (line: string) => void } = {},
): Promise<Response> {
  const log = opts.log ?? ((line: string) => console.warn(line));
  if (opts.signal?.aborted) throw new BankRequestCancelled();
  const ctrl = new AbortController();
  const cancel = () => ctrl.abort(new BankRequestCancelled());
  opts.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => ctrl.abort(new BankUnavailable('timeout')), opts.firstByteMs ?? FIRST_BYTE_MS);
  try {
    let res: Response;
    try {
      res = await inner(input, { ...init, signal: ctrl.signal });
    } finally {
      // The first byte is in (or the request failed): from here on the bank
      // takes as long as its answer needs.
      clearTimeout(timer);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      log(`[bank] ${hostOf(input)} answered HTTP ${res.status}: ${snippet(body) || '(empty)'}`);
      throw new BankUnavailable('status', res.status);
    }
    const text = await res.text();
    if (!isFinTSReply(text)) {
      log(`[bank] ${hostOf(input)} sent no FinTS message: ${snippet(text) || '(empty)'}`);
      throw new BankUnavailable('unreadable');
    }
    // The body has been read; lib-fints gets it again, unchanged.
    return new Response(text, { status: res.status, statusText: res.statusText });
  } catch (err) {
    // An abort of ours carries its reason; anything else (a refused
    // connection, a dropped socket) stays as the connection reported it.
    const reason: unknown = ctrl.signal.aborted ? ctrl.signal.reason : null;
    if (reason instanceof BankUnavailable || reason instanceof BankRequestCancelled) throw reason;
    throw err;
  } finally {
    opts.signal?.removeEventListener('abort', cancel);
  }
}

// ---------------------------------------------------------------------------
// Installation

const BANK_FETCH = Symbol.for('girovo.bankFetch');
const BANK_SCOPE = Symbol.for('girovo.bankScope');
type MarkedFetch = Fetch & { [BANK_FETCH]?: true };

/**
 * Wraps whatever globalThis.fetch is now. Checked before every bank request
 * rather than once: Next's dev server puts its own fetch back after a hot
 * reload, and wraps it again on the next request.
 */
function ensureFetchWrapped(): void {
  const current = globalThis.fetch as MarkedFetch;
  if (current[BANK_FETCH]) return;
  const wrapped: MarkedFetch = (input, init) => {
    const s = scope.getStore();
    // Outside a bank call, or already under the policy (a wrapper around
    // this wrapper): straight through.
    if (!s?.bankCall || s.inPolicy) return current(input, init);
    return scope.run({ ...s, inPolicy: true }, () => timed(fetchFromBank(current, input, init, { signal: s.signal })));
  };
  wrapped[BANK_FETCH] = true;
  globalThis.fetch = wrapped;
}

/**
 * How long the bank took to answer, as a usage metric (lib/telemetry.ts —
 * counted only with the user's yes): the duration, whether it worked and the
 * bank's BLZ from the request's context. Nothing of the request or the answer.
 */
async function timed(request: Promise<Response>): Promise<Response> {
  const started = Date.now();
  const blz = telemetryContext().blz;
  try {
    const res = await request;
    reportMetric('bank.request_ms', Date.now() - started, { blz, ok: true });
    return res;
  } catch (err) {
    if (!(err instanceof BankRequestCancelled)) reportMetric('bank.request_ms', Date.now() - started, { blz, ok: false });
    throw err;
  }
}

/** Puts every lib-fints request under the policy. Idempotent. */
export function installBankFetch(): void {
  const proto = HttpClient.prototype as HttpClient & { [BANK_SCOPE]?: true };
  if (proto[BANK_SCOPE]) return;
  const send = proto.sendMessage;
  proto.sendMessage = function sendMessage(this: HttpClient, message: Parameters<HttpClient['sendMessage']>[0]) {
    ensureFetchWrapped();
    return scope.run({ ...scope.getStore(), bankCall: true }, () => send.call(this, message));
  };
  proto[BANK_SCOPE] = true;
}

installBankFetch();

// ---------------------------------------------------------------------------
// What went wrong, in words

/** The connection never got as far as the bank: no network, no name. */
const UNREACHABLE_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN']);
/** The bank's side refused or dropped it: a server down or overloaded. */
const DROPPED_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_CLOSED',
]);
/** The bank's certificate did not check out. */
const TLS_CODE = /CERT|TLS|SSL|SELF_SIGNED/;

export type BankErrorKind = 'unavailable' | 'unreachable' | 'insecure' | 'cancelled';

/**
 * Which way a request to the bank broke, or null for anything that is not a
 * transport failure (a FinTS-level refusal, a bug).
 */
export function bankErrorKind(err: unknown): BankErrorKind | null {
  if (err instanceof BankRequestCancelled) return 'cancelled';
  if (err instanceof BankUnavailable) return 'unavailable';
  const e = err as { message?: string; cause?: { code?: string } } | null;
  const message = e?.message || '';
  const code = e?.cause?.code || '';
  if (UNREACHABLE_CODES.has(code)) return 'unreachable';
  if (DROPPED_CODES.has(code)) return 'unavailable';
  if (code && TLS_CODE.test(code)) return 'insecure';
  if (message === 'fetch failed') return 'unavailable';
  // lib-fints' own words for an error page or an undecodable reply — no
  // longer reached through fetchFromBank, kept as a backstop.
  if (/request failed with status code|error decoding/i.test(message)) return 'unavailable';
  return null;
}

const INSECURE = 'Die Verbindung zu deiner Bank ließ sich nicht sicher aufbauen. Prüfe Datum und Uhrzeit dieses Rechners.';
const CANCELLED = 'Die Anfrage an deine Bank wurde abgebrochen.';
const UNEXPECTED = 'Bei der Verbindung mit deiner Bank ist ein unerwarteter Fehler aufgetreten.';

/** lib-fints throws in English; what each of its errors means for the user. */
const LIBRARY_ERRORS: [RegExp, string][] = [
  [/TAN must be provided for non-decoupled TAN methods/i,
    'Dieses Verfahren braucht eine TAN-Eingabe. Hier geht nur die Freigabe in einer Banking-App.'],
  [/not supported according to the BPD|does not support business transaction/i,
    'Deine Bank bietet diesen Vorgang für dein Konto über FinTS nicht an.'],
  [/has no IBAN in the UPD/i, 'Für dieses Konto meldet deine Bank keine IBAN.'],
];

/** Plain ASCII with an English function word: a library's message, not ours. */
const ENGLISH = /\b(?:the|is|are|not|must|cannot|can't|failed|error|invalid|unexpected|undefined|null|of|to|has|no)\b/i;

/**
 * The message a user sees for an error thrown while handling a request.
 * Transport failures get the sentences from lib/bank-answer.ts; lib-fints'
 * English errors a German meaning; our own German messages pass through.
 * Nothing of a bank's response body ever reaches the result.
 */
export function describeError(err: unknown): string {
  switch (bankErrorKind(err)) {
    case 'unavailable': return BANK_UNAVAILABLE;
    case 'unreachable': return BANK_UNREACHABLE;
    case 'insecure': return INSECURE;
    case 'cancelled': return CANCELLED;
    default: break;
  }
  const message = (err as { message?: string } | null)?.message || String(err ?? '');
  for (const [re, text] of LIBRARY_ERRORS) if (re.test(message)) return text;
  if (!message.trim() || (/^[\x20-\x7e]*$/.test(message) && ENGLISH.test(message))) return UNEXPECTED;
  return message;
}
