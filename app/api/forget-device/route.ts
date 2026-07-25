// Forget a remembered device — deletes the encrypted profile.

import { body, json, wrap } from '@/lib/api';
import { getSession } from '@/lib/session';
import { forgetProfile } from '@/lib/state-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ForgetBody = { sessionId?: string; blz?: string; userId?: string };

export const POST = wrap(async (req: Request) => {
  const { sessionId, blz, userId } = await body<ForgetBody>(req);
  let b = blz;
  let u = userId;
  if (sessionId) {
    const s = getSession(sessionId);
    if (s) {
      b = b || s.meta?.blz;
      u = u || s.client?.config?.userId;
    }
  }
  const ok = b && u ? forgetProfile(String(b), String(u)) : false;
  return json({ ok });
});
