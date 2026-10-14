// Forget a remembered device — deletes the encrypted profile.
//
// With `wipeData` it also deletes this login's personal-data vault and every
// backup of it (lib/vault.ts, wipeVault), and the Umsätze kept on this
// computer with theirs (lib/history-store.ts, wipeHistory). All are sealed
// under a key from the PIN, so any left on disk is something to try PINs
// against offline; when the machine is handed on, all have to go. The wipe
// is its own choice in the dialog because "Gerät vergessen" alone is also just
// the way to make the bank register this machine afresh — that must not cost
// the Vorlagen.
//
// The wipe only ever acts for the session's own login, never for a blz/userId
// named in the request, and runs first: if it fails, the device is not
// forgotten either and the user can simply try again.

import { body, fail, json, sessionExpired, wrap } from '@/lib/api';
import { getSession } from '@/lib/session';
import { HistoryError, wipeHistory } from '@/lib/history-store';
import { forgetProfile } from '@/lib/state-store';
import { VaultError, wipeVault } from '@/lib/vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ForgetBody = { sessionId?: string; blz?: string; userId?: string; wipeData?: boolean };

export const POST = wrap(async (req: Request) => {
  const { sessionId, blz, userId, wipeData } = await body<ForgetBody>(req);
  const s = sessionId ? getSession(sessionId) : null;
  let b = blz;
  let u = userId;
  if (s) {
    b = b || s.meta?.blz;
    u = u || s.client?.config?.userId;
  }

  let wiped: number | undefined;
  if (wipeData === true) {
    if (!s) return sessionExpired();
    try {
      // The kept Umsätze first, as in app/api/vault: if they cannot go, the vault stays as it was.
      const history = await wipeHistory(s);
      wiped = history + (await wipeVault(s));
    } catch (err) {
      if (err instanceof VaultError || err instanceof HistoryError) return fail(err.message, err.status);
      throw err;
    }
  }

  const ok = b && u ? forgetProfile(String(b), String(u)) : false;
  return json({ ok, ...(wiped !== undefined ? { wiped } : {}) });
});
