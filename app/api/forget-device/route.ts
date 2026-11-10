// Forget a remembered device — deletes the encrypted profile.
//
// With `wipeData` it also deletes this login's personal-data vault and every
// backup of it (lib/vault.ts, wipeVault), the Umsätze kept on this computer
// with theirs (lib/history-store.ts, wipeHistory), and the kept documents —
// the bank's Kontoauszüge and the receipts (lib/doc-store.ts). All are sealed
// under a key from the PIN, so any left on disk is something to try PINs
// against offline; when the machine is handed on, all have to go. The wipe
// is its own choice in the dialog because "Gerät vergessen" alone is also just
// the way to make the bank register this machine afresh — that must not cost
// the Vorlagen.
//
// The wipe only ever acts for the session's own login, never for a blz/userId
// named in the request, and runs first: if it fails, the device is not
// forgotten either and the user can simply try again. The further banks of
// the view lose their kept Umsätze and documents with it: through their own
// sessions (`linked`), or by the names the login's own vault keeps for them
// (lib/wipe-saved.ts) — and the sync group's files leave this computer's LAN
// shelf.
//
// The further banks' PINs kept beside the login on the desktop
// (lib/linked-unlock.ts) go either way, and first: they are part of what this
// machine remembers about the login, like the fingerprint's PINs on the phone.

import { body, fail, json, sessionExpired, wrap } from '@/lib/api';
import { getSession, pinRefused } from '@/lib/session';
import { DocError, wipeDocs } from '@/lib/doc-store';
import { HistoryError, wipeHistory } from '@/lib/history-store';
import { loginOfSession, removeLinkedUnlock } from '@/lib/linked-unlock';
import { forgetProfile, forgetRefusedPin, markPinRefused } from '@/lib/state-store';
import { removeSecurityKeys } from '@/lib/security-key';
import { removeWindowsHello } from '@/lib/windows-hello';
import { readMeta, removeMeta } from '@/lib/sync-meta';
import { disable as disableBackground } from '@/lib/background-check';
import { backgroundServed, backgroundStore } from '@/lib/background-store';
import { VaultError, vaultKeyOf, wipeVault } from '@/lib/vault';
import { forgetLanGroup, sessionsNamed, wipeFailed, wipeFurtherBanks } from '@/lib/wipe-saved';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `refused`: the bank turned the first login's PIN down — not the user's "Gerät vergessen". */
type ForgetBody = { sessionId?: string; blz?: string; userId?: string; wipeData?: boolean; refused?: boolean; linked?: unknown };

export const POST = wrap(async (req: Request) => {
  const { sessionId, blz, userId, wipeData, refused, linked } = await body<ForgetBody>(req);
  const s = sessionId ? getSession(sessionId) : null;
  let b = blz;
  let u = userId;
  if (s) {
    b = b || s.meta?.blz;
    u = u || s.client?.config?.userId;
  }

  if (wipeData === true && !s) return sessionExpired();
  // The bank turned this session's PIN down (the page asks only for the
  // bank's own codes, lib/client-api.ts PIN_REFUSED_EVENT): while the session
  // stays open, nothing keeps that PIN again (Windows Hello, a security key,
  // the checks). And it is noted, for a copy kept where nothing here reaches
  // — beside another login: /api/connect does not send that one again.
  if (s && refused === true) {
    pinRefused(s);
    const own = loginOfSession(s);
    if (own) markPinRefused(own.blz, own.userId, own.pin);
  }
  if (b && u) {
    await removeLinkedUnlock({ blz: String(b), userId: String(u) });
    await removeWindowsHello({ blz: String(b), userId: String(u) });
    await removeSecurityKeys({ blz: String(b), userId: String(u) });
  }
  // "Gerät vergessen" by the user (with a session, not a refused further
  // bank's): the PINs kept for "Neue Umsätze melden" go, all of them. A
  // refused PIN takes only its own login's out (the page asks for that).
  if (s && refused !== true && backgroundServed()) await disableBackground(backgroundStore());

  let wiped: number | undefined;
  if (wipeData === true && s) {
    const further = sessionsNamed(linked, getSession);
    try {
      // The kept Umsätze first, as in app/api/vault: if they cannot go, the vault stays as it was.
      // The sync group's files on the LAN shelf before its settings, which say which they are.
      const meta = vaultKeyOf(s) ? await readMeta(s) : null;
      const lan = meta?.place.kind === 'lan' ? await forgetLanGroup(meta.key) : 0;
      if (b && u) await removeMeta(String(b), String(u));
      const others = await wipeFurtherBanks(s, further);
      const history = await wipeHistory(s);
      const docs = await wipeDocs(s);
      wiped = lan + others + history + docs + (await wipeVault(s));
    } catch (err) {
      // The vault stays and goes on being saved: so do the documents.
      wipeFailed([s, ...further]);
      if (err instanceof VaultError || err instanceof HistoryError || err instanceof DocError) return fail(err.message, err.status);
      throw err;
    }
  }

  // Forgotten by the user: nothing about this login stays, the note of a refused PIN neither.
  if (b && u && refused !== true) forgetRefusedPin(String(b), String(u));
  const ok = b && u ? forgetProfile(String(b), String(u)) : false;
  return json({ ok, ...(wiped !== undefined ? { wiped } : {}) });
});
