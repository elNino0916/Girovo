// Drop a session (logout). The remembered device profile survives — use
// /api/forget-device to wipe that.

import { body, json, wrap } from '@/lib/api';
import { dropSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = wrap(async (req: Request) => {
  const { sessionId } = await body<{ sessionId: string }>(req);
  dropSession(sessionId);
  return json({ ok: true });
});
