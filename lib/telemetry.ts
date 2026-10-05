// The server's side of telemetry. It sends nothing itself: each report is one
// line on stdout, after a mark, which the desktop shell takes out of the log
// and hands to its hub (electron/telemetry.cjs) — the hub scrubs errors,
// drops usage without the user's yes, and keeps only the fields it declares.
// Outside the desktop shell (`npm run dev`, a website build) the pipe is not
// set, and every call here is a no-op.
//
// Context: wrap() (lib/api.ts) runs every route inside withTelemetryContext;
// code deeper down notes what is known — the bank's BLZ — and an error that
// reaches wrap() is reported with it. Never note anything about the user's
// accounts or bookings: the hub would drop it, but it has no business here.

import { AsyncLocalStorage } from 'node:async_hooks';

const MARK = '@@girovo-telemetry ';
const PIPE = process.env.GIROVO_TELEMETRY_PIPE === '1';

type Props = Record<string, string | number | boolean | undefined | null>;

// On globalThis, like the session store: a route module evaluated again (hot
// reload) must keep reading the same scope.
const g = globalThis as typeof globalThis & { __girovoTelemetryScope?: AsyncLocalStorage<Props> };
const scope: AsyncLocalStorage<Props> = (g.__girovoTelemetryScope ??= new AsyncLocalStorage<Props>());

function send(message: Record<string, unknown>): void {
  if (!PIPE) return;
  try {
    process.stdout.write(`${MARK}${JSON.stringify(message)}\n`);
  } catch { /* a report must never break a request */ }
}

/** Runs `fn` with a fresh context that noteTelemetry fills in. */
export function withTelemetryContext<T>(fn: () => T): T {
  return scope.run({}, fn);
}

/** Adds to the current request's context — e.g. `{ blz }` once the bank is known. */
export function noteTelemetry(props: Props): void {
  const store = scope.getStore();
  if (store) Object.assign(store, props);
}

/** What the current request has noted so far. */
export function telemetryContext(): Props {
  return { ...scope.getStore() };
}

/** An unexpected failure. Always reported; the shell scrubs the message and stack. */
export function reportError(err: unknown, props: Props = {}): void {
  const e = (err && typeof err === 'object' ? err : { message: String(err) }) as { name?: unknown; message?: unknown; stack?: unknown };
  send({
    t: 'error',
    name: typeof e.name === 'string' ? e.name : 'Error',
    message: typeof e.message === 'string' ? e.message : '',
    stack: typeof e.stack === 'string' ? e.stack : '',
    props: { ...telemetryContext(), ...props },
  });
}

/** A usage event — counted only with the user's yes. */
export function reportEvent(name: string, props: Props = {}): void {
  send({ t: 'event', name, props });
}

/** A usage measurement — counted only with the user's yes. */
export function reportMetric(name: string, value: number, props: Props = {}): void {
  send({ t: 'metric', name, value, props });
}
