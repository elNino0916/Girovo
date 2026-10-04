// "Abbrechen" while the bank is being asked to log in: ends the bank request,
// and drops a session the login had already created — the PIN goes with it.

import { body, json, wrap } from '@/lib/api';
import { cancelAttempt } from '@/lib/connect-attempts';
import { dropSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = wrap(async (req: Request) => {
  const { attemptId } = await body<{ attemptId: string }>(req);
  const sessionId = cancelAttempt(attemptId);
  if (sessionId) dropSession(sessionId);
  // Nothing to report either way: after this, no login of that id goes on.
  return json({ ok: true });
});
