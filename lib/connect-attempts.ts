// Logins in flight, so the user can call one off.
//
// /api/connect holds the PIN (inside its FinTSClient) for as long as the bank
// takes to answer — up to a minute per address, and a bank can have two. The
// login form's "Abbrechen" posts the attempt's id to /api/connect/cancel:
//  - the bank request ends at once (its signal goes to withBankSignal),
//  - no session is created for it, and
//  - a session the answer had already created is handed back to be dropped,
//    so the PIN does not wait in memory for the 30-minute sweep.
//
// Pinned to globalThis like the session store (lib/session.ts), and free of
// imports so it can be tested on its own.

export type ConnectAttempt = {
  readonly id: string | null;
  readonly signal: AbortSignal;
};

type Entry = { ctrl: AbortController; sessionId: string | null; endedAt: number | null };

/** Client-made random ids: nothing else is accepted as a key. */
const ATTEMPT_ID = /^[A-Za-z0-9_-]{16,64}$/;
/** How long a finished (or pre-cancelled) attempt still answers. */
export const ATTEMPT_LINGER_MS = 2 * 60_000;

type AttemptGlobal = typeof globalThis & { __sooskasseConnectAttempts?: Map<string, Entry> };
const g = globalThis as AttemptGlobal;
const attempts: Map<string, Entry> = (g.__sooskasseConnectAttempts ??= new Map());

function sweep(now: number): void {
  for (const [id, e] of attempts) if (e.endedAt !== null && now - e.endedAt > ATTEMPT_LINGER_MS) attempts.delete(id);
}

/**
 * Registers a login under the id the browser sent. Without a usable id the
 * login still runs, it just cannot be called off.
 */
export function beginAttempt(rawId: unknown, now = Date.now()): ConnectAttempt {
  sweep(now);
  const id = typeof rawId === 'string' && ATTEMPT_ID.test(rawId) ? rawId : null;
  if (!id) return { id: null, signal: new AbortController().signal };
  const known = attempts.get(id);
  // Called off before its request even arrived: it stays called off.
  if (known?.ctrl.signal.aborted) return { id, signal: known.ctrl.signal };
  const entry: Entry = { ctrl: new AbortController(), sessionId: null, endedAt: null };
  attempts.set(id, entry);
  return { id, signal: entry.ctrl.signal };
}

/**
 * The login has its answer: called with the session it created, and again
 * (without one) when the request is over — which keeps that session.
 */
export function settleAttempt(attempt: ConnectAttempt, sessionId: string | null = null, now = Date.now()): void {
  if (!attempt.id) return;
  const entry = attempts.get(attempt.id);
  if (!entry || entry.ctrl.signal !== attempt.signal) return;
  if (sessionId) entry.sessionId = sessionId;
  entry.endedAt ??= now;
}

/**
 * Calls a login off. Returns the session it already created, if any — the
 * caller drops it.
 */
export function cancelAttempt(rawId: unknown, now = Date.now()): string | null {
  sweep(now);
  if (typeof rawId !== 'string' || !ATTEMPT_ID.test(rawId)) return null;
  const entry = attempts.get(rawId);
  if (!entry) {
    attempts.set(rawId, { ctrl: abortedController(), sessionId: null, endedAt: now });
    return null;
  }
  entry.ctrl.abort();
  entry.endedAt ??= now;
  const sessionId = entry.sessionId;
  entry.sessionId = null;
  return sessionId;
}

function abortedController(): AbortController {
  const c = new AbortController();
  c.abort();
  return c;
}
