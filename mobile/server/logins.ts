// The logins of live sessions, with their PINs, for fingerprint login
// (mobile/bridges/biometric.ts seals them): the sessions are the server's
// (lib/session.ts, lib-fints' config), so the page asks for them across the
// line (mobile/server/entry.ts) — they never pass through the page's own state.

import { getSession } from '../../lib/session.ts';

/** A sealed login, as a fingerprint opens it. */
export type SealedLogin = { blz: string; userId: string; pin: string };

/** The login of a live session, with its PIN; null once the session is gone. */
export function loginOf(sessionId: unknown): SealedLogin | null {
  const s = getSession(sessionId);
  const blz = s?.meta?.blz;
  const userId = s?.client?.config?.userId;
  const pin = s?.client?.config?.pin;
  return blz && userId && pin ? { blz: String(blz), userId: String(userId), pin: String(pin) } : null;
}
