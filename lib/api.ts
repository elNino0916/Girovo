// Shared plumbing for the route handlers: JSON helpers and the error boundary
// that used to be Express' `wrap`.

import { NextResponse } from 'next/server';

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

function friendlyError(err: unknown): string {
  const e = err as { message?: string; cause?: { code?: string } };
  const msg = e?.message || String(err);
  const code = e?.cause?.code || '';
  if (msg === 'fetch failed' || ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(code)) {
    return 'Bank nicht erreichbar. Prüfe deine Internetverbindung und die FinTS-URL.';
  }
  return msg;
}

/**
 * Wraps a handler so an unexpected throw becomes a 500 with a readable German
 * message instead of Next's opaque digest page.
 */
export function wrap<A extends unknown[]>(
  fn: (...args: A) => Promise<NextResponse>,
): (...args: A) => Promise<NextResponse> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      const e = err as { message?: string; cause?: { code?: string } };
      console.error('[error]', e?.message || err, e?.cause?.code || '');
      return NextResponse.json({ error: friendlyError(err) }, { status: 500 });
    }
  };
}

/** Reads a JSON body, tolerating an empty one (the old Express behaviour). */
export async function body<T = Record<string, unknown>>(req: Request): Promise<Partial<T>> {
  try {
    return (await req.json()) as Partial<T>;
  } catch {
    return {};
  }
}
