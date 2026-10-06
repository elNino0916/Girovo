// Whether a remembered device profile exists for (BLZ, user). Does not need
// the PIN — only reveals existence, not contents.
//
// POST, not GET: the login name is personal, and a query string ends up in
// access logs, the dev server's request log and the browser's history. The
// body does not.

import { body, fail, json, wrap } from '@/lib/api';
import { msgs } from '@/lib/i18n';
import { withRequestLocale } from '@/lib/i18n/server';
import { hasProfile } from '@/lib/state-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DeviceStatusBody = { blz?: unknown; userId?: unknown };

export const POST = wrap(async (req: Request) => {
  const { blz, userId } = await body<DeviceStatusBody>(req);
  // Anything that is not a plain string is no login name — not an error the
  // user could do anything about, just "nothing remembered".
  const b = typeof blz === 'string' ? blz.trim() : '';
  const u = typeof userId === 'string' ? userId.trim() : '';
  return json({ remembered: !!(b && u && hasProfile(b, u)) });
});

/**
 * The old query-string form is gone on purpose; say so rather than 404, in
 * the caller's language (what wrap() does for the routes it wraps).
 */
export function GET(req: Request) {
  const res = withRequestLocale(req, () => fail(msgs().auth.api.usePost, 405));
  res.headers.set('Allow', 'POST');
  return res;
}
