// Shared plumbing for the route handlers: JSON helpers and the error boundary
// that used to be Express' `wrap`.
//
// Every route that talks to a bank comes through here, so this is also where
// the bank-request policy is installed (lib/bank-fetch.ts, on import).

import { NextResponse } from 'next/server';
import { bankErrorKind, describeError } from './bank-fetch.ts';
import { reportError, withTelemetryContext } from './telemetry.ts';

export function json<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** 401 + the message the frontend keys on to bounce back to the login screen. */
export function sessionExpired(): NextResponse {
  return fail('Sitzung abgelaufen. Bitte neu anmelden.', 401);
}

/**
 * Wraps a handler so an unexpected throw becomes a 500 with a readable German
 * message instead of Next's opaque digest page: a bank that does not answer,
 * lib-fints' English, a bug — each in words (describeError), and never a
 * bank's response body. The details stay in the server log, and go to
 * telemetry (lib/telemetry.ts) with the route and the bank's BLZ when known —
 * except a request the user called off.
 */
export function wrap<A extends unknown[]>(
  fn: (...args: A) => Promise<NextResponse>,
): (...args: A) => Promise<NextResponse> {
  return (...args: A) => withTelemetryContext(async () => {
    try {
      return await fn(...args);
    } catch (err) {
      const e = err as { message?: string; cause?: { code?: string } };
      console.error('[error]', e?.message || err, e?.cause?.code || '');
      const kind = bankErrorKind(err);
      if (kind !== 'cancelled') reportError(err, { source: 'route', route: routeOf(args[0]), kind: kind ?? undefined });
      return NextResponse.json({ error: describeError(err) }, { status: 500 });
    }
  });
}

/** The path a route was called at ("/api/transactions"), never its query. */
function routeOf(req: unknown): string | undefined {
  try {
    return req instanceof Request ? new URL(req.url).pathname : undefined;
  } catch {
    return undefined;
  }
}

/** Reads a JSON body, tolerating an empty one (the old Express behaviour). */
export async function body<T = Record<string, unknown>>(req: Request): Promise<Partial<T>> {
  try {
    return (await req.json()) as Partial<T>;
  } catch {
    return {};
  }
}

/**
 * Like body(), but for the one route that accepts a payload of real size (the
 * vault): stops reading past `maxBytes` and answers null instead of buffering
 * whatever arrives. Malformed or empty JSON still reads as `{}`.
 *
 * The parse error is swallowed rather than passed on on purpose — V8 quotes
 * the offending input in its message, and that input may be personal data
 * that must not end up in a log line.
 */
export async function boundedBody<T = Record<string, unknown>>(req: Request, maxBytes: number): Promise<Partial<T> | null> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!req.body) return {};
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Partial<T>) : {};
  } catch {
    return {};
  }
}
