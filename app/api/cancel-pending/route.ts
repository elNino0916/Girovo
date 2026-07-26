// Frontend gave up on a pending approval (user pressed cancel). The bank-side
// dialog can't be aborted, but clearing the pending record lets the session
// start a fresh operation. A transfer parked on an unanswered Namensabgleich is
// dropped too — abandoning the VOP-ID is exactly how the spec says to cancel.

import { body, json, wrap } from '@/lib/api';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = wrap(async (req: Request) => {
  const { sessionId } = await body<{ sessionId: string }>(req);
  const s = getSession(sessionId);
  if (s) {
    s.pending = null;
    s.vopHold = null;
  }
  return json({ ok: true });
});
