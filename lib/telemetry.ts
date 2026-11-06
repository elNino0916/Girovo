// The server's side of telemetry. It sends nothing itself: the Android app
// and the desktop app run the route handlers in the page, and a sink takes
// each report to the shell's hub (mobile/bridges/telemetry.ts,
// desktop/server/telemetry.ts) — the hub scrubs errors, drops usage without
// the user's yes, and keeps only the fields it declares. Without a sink
// (`npm run dev`) every call here is a no-op.
//
// Context: wrap() (lib/api.ts) runs every route inside withTelemetryContext;
// code deeper down notes what is known — the bank's BLZ — and an error that
// reaches wrap() is reported with it. Never note anything about the user's
// accounts or bookings: the hub would drop it, but it has no business here.

import { AsyncLocalStorage } from 'node:async_hooks';

type Props = Record<string, string | number | boolean | undefined | null>;

// On globalThis, like the session store: a route module evaluated again (hot
// reload) must keep reading the same scope.
const g = globalThis as typeof globalThis & { __girovoTelemetryScope?: AsyncLocalStorage<Props> };
const scope: AsyncLocalStorage<Props> = (g.__girovoTelemetryScope ??= new AsyncLocalStorage<Props>());

/** The hub of an app whose route handlers run in the page: Android's, the Tauri desktop's. */
type Sink = (message: Record<string, unknown>) => void;

function send(message: Record<string, unknown>): void {
  const sink = (globalThis as typeof globalThis & { __girovoTelemetrySink?: Sink }).__girovoTelemetrySink;
  if (!sink) return;
  try {
    sink(message);
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
