// Keep an idle-but-present session alive.
//
// The browser pings this (throttled) while the user is actually using the app,
// so reading through Umsätze for half an hour does not end in a 401 the
// moment they click something. It touches the in-memory session and nothing
// else — no bank traffic, so it can never trigger a TAN or count against the
// bank's access limits. The FinTS dialog itself may still time out at the
// bank; the next real request reopens it as it always has.

import { body, json, sessionExpired, wrap } from '@/lib/api';
import { getSession, SESSION_TTL_MS } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = wrap(async (req: Request) => {
  const { sessionId } = await body<{ sessionId: string }>(req);
  // getSession() refreshes lastSeen — that is the whole point of the call.
  if (!getSession(sessionId)) return sessionExpired();
  return json({ ok: true as const, ttlMs: SESSION_TTL_MS });
});
