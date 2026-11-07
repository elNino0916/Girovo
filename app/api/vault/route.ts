// The encrypted personal-data vault (lib/vault.ts): load, save, start over,
// delete from this machine.
//
// One POST with an `op`, like every other route here — the sessionId stays in
// the body, never in a URL. Nothing about the contents is logged; a refusal
// comes back as a status the client can tell apart from an expired session
// (409 locked/unavailable, 413 too large, 400 malformed), because only a 401
// sends the user back to the login screen.

import { boundedBody, fail, json, sessionExpired, wrap } from '@/lib/api';
import type { VaultGetResponse, VaultPutResponse } from '@/lib/app-types';
import { DocError, wipeDocs } from '@/lib/doc-store';
import { HistoryError, wipeHistory } from '@/lib/history-store';
import { msgs } from '@/lib/i18n';
import { loginOfSession, removeLinkedUnlock } from '@/lib/linked-unlock';
import { getSession } from '@/lib/session';
import { loadVault, resetVault, saveVault, VAULT_REQUEST_MAX_BYTES, VaultError, vaultKeyOf, wipeVault } from '@/lib/vault';
import { removeWindowsHello } from '@/lib/windows-hello';
import { readMeta, removeMeta } from '@/lib/sync-meta';
import { forgetLanGroup, sessionsNamed, wipeFailed, wipeFurtherBanks } from '@/lib/wipe-saved';
import { disable as disableBackground } from '@/lib/background-check';
import { backgroundServed, backgroundStore } from '@/lib/background-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `linked`, with 'wipe': the sessions of the further banks of the view, whose saved data goes too. */
type VaultBody = { sessionId: string; op: 'get' | 'put' | 'reset' | 'wipe'; data: unknown; linked?: unknown };

export const POST = wrap(async (req: Request) => {
  const b = await boundedBody<VaultBody>(req, VAULT_REQUEST_MAX_BYTES);
  if (!b) return fail(msgs().provider.vault.tooMany, 413);
  const s = getSession(b.sessionId);
  if (!s) return sessionExpired();

  try {
    switch (b.op) {
      case 'get':
        return json((await loadVault(s)) satisfies VaultGetResponse);
      case 'put':
        if (b.data == null) return fail(msgs().provider.vault.noData);
        return json((await saveVault(s, b.data)) satisfies VaultPutResponse);
      case 'reset':
        return json((await resetVault(s)) satisfies VaultPutResponse);
      case 'wipe': {
        // The file and its backups, for good — and the Umsätze and the
        // documents kept beside it (lib/history-store.ts, lib/doc-store.ts),
        // which are saved data of this login too. They go first: if they
        // cannot, the vault is untouched and the client carries on as
        // before. "Gerät vergessen" can do the same in one go
        // (app/api/forget-device); this is the way when no device is
        // remembered. The further banks' PINs kept beside the login on the
        // desktop (lib/linked-unlock.ts) go first, and the login's own PIN
        // kept for Windows Hello (lib/windows-hello.ts): should they not,
        // nothing else has gone either.
        const own = loginOfSession(s);
        const linked = sessionsNamed(b.linked, getSession);
        try {
          let lan = 0;
          if (own) {
            await removeLinkedUnlock(own);
            await removeWindowsHello(own);
            // This device leaves its sync group: its settings are personal data
            // too, and so are the group's files on this computer's LAN shelf —
            // deleted first, while the settings still say which they are.
            const meta = vaultKeyOf(s) ? await readMeta(s) : null;
            if (meta?.place.kind === 'lan') lan = await forgetLanGroup(meta.key);
            await removeMeta(own.blz, own.userId);
          }
          // The PINs kept for "Neue Umsätze melden" go too — all of them, as the dialog says.
          if (backgroundServed()) await disableBackground(backgroundStore());
          // Every further bank's Umsätze and documents, logged in now or not (lib/wipe-saved.ts).
          const further = await wipeFurtherBanks(s, linked);
          const history = await wipeHistory(s);
          const docs = await wipeDocs(s);
          return json({ ok: true, wiped: lan + further + history + docs + (await wipeVault(s)) });
        } catch (err) {
          // The vault stays and goes on being saved: so do the documents.
          wipeFailed([s, ...linked]);
          throw err;
        }
      }
      default:
        return fail(msgs().provider.vault.unknownAction);
    }
  } catch (err) {
    if (err instanceof VaultError || err instanceof HistoryError || err instanceof DocError) return fail(err.message, err.status);
    throw err; // wrap() logs the message only — never a payload
  }
});
