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
import { msgs } from '@/lib/i18n';
import { getSession } from '@/lib/session';
import { loadVault, resetVault, saveVault, VAULT_REQUEST_MAX_BYTES, VaultError, wipeVault } from '@/lib/vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type VaultBody = { sessionId: string; op: 'get' | 'put' | 'reset' | 'wipe'; data: unknown };

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
      case 'wipe':
        // The file and its backups, for good. "Gerät vergessen" can do the
        // same in one go (app/api/forget-device); this is the way when no
        // device is remembered.
        return json({ ok: true, wiped: await wipeVault(s) });
      default:
        return fail(msgs().provider.vault.unknownAction);
    }
  } catch (err) {
    if (err instanceof VaultError) return fail(err.message, err.status);
    throw err; // wrap() logs the message only — never a payload
  }
});
