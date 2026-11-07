// "Gespeicherte Daten löschen" — app/api/vault (op wipe) and
// app/api/forget-device (wipeData) — for what lies beyond the primary login's
// own files:
//
// - Every further bank of the view keeps its own Umsätze and documents on
//   this machine (lib/history-store.ts, lib/doc-store.ts), one family of files
//   per login. Those logged in now go through their sessions, so nothing more
//   is kept for them this session either; those that are not, by the names
//   the primary login's vault keeps for them (VaultData.linkedBanks) — the
//   user's own list, opened with the PIN, never a name a request brings.
// - The sync group's files on the LAN shelf (lib/sync-stores.ts lanHostDir):
//   the computer is where the group meets over the home network, so the
//   states of every device of the group, its receipts and its token are on
//   it. On the desktop app most of them are on disk only, beside the page's
//   in-memory tree, and the shell deletes them (src-tauri/src/reset.rs
//   lan_forget).
//
// Both run before the vault goes: should one fail, the vault stays as it was
// and the client carries on as before, as for the primary login's files.
//
// No 'server-only' marker, like vault.ts: `node --test` runs it
// (lib/wipe-saved.test.ts). Codes and counts in the log, never a name.

import type { Session } from './session';
import { resumeDocs, wipeDocs, wipeDocsOf } from './doc-store.ts';
import { msgs } from './i18n/index.ts';
import { wipeHistory, wipeHistoryOf } from './history-store.ts';
import { LINKED_BANK_LIMITS, sameLogin } from './linked-banks.ts';
import { IS_ANDROID } from './platform.ts';
import { removeFamily } from './sealed-file.ts';
import { groupOf } from './sync.ts';
import { lanHostDir } from './sync-stores.ts';
import { loadVault, VaultError } from './vault.ts';

type Login = { blz: string; userId: string };

function loginOf(s: Session | null | undefined): Login | null {
  const blz = s?.meta?.blz;
  const userId = s?.client?.config?.userId;
  return blz && userId ? { blz: String(blz), userId: String(userId) } : null;
}

/**
 * The further banks' sessions a wipe request names (`linked`, the browser's
 * own session ids), looked up with `lookup` (lib/session.ts getSession):
 * strings only, at most as many as a view has further banks, unknown ones
 * dropped. Each session is only ever wiped for its own login.
 */
export function sessionsNamed(ids: unknown, lookup: (id: string) => Session | null | undefined): Session[] {
  if (!Array.isArray(ids)) return [];
  return ids
    .filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200)
    .slice(0, LINKED_BANK_LIMITS.count)
    .map((id) => lookup(id))
    .filter((s): s is Session => !!s);
}

/**
 * Deletes the kept Umsätze and documents of every further bank of the view:
 * `linked` are the sessions the browser has for them (any that is not one, or
 * is the primary's own, is passed over); the rest come from the primary
 * login's vault, when it opens. Throws the store's error (HistoryError,
 * DocError, VaultError) when something stays — the sessions it went through
 * then keep documents again (wipeFailed). Answers how many files went.
 */
export async function wipeFurtherBanks(primary: Session, linked: readonly (Session | null | undefined)[]): Promise<number> {
  const own = loginOf(primary);
  if (!own) return 0;
  const done: Login[] = [own];
  const through: Session[] = [];
  let removed = 0;
  try {
    for (const s of linked) {
      const login = loginOf(s);
      if (!s || !login || s === primary || done.some((l) => sameLogin(l, login))) continue;
      done.push(login);
      through.push(s);
      removed += await wipeHistory(s);
      removed += await wipeDocs(s);
    }
    // A vault this PIN does not open names nobody: those banks' files stay
    // until they log in and delete their own — or "Girovo zurücksetzen".
    const vault = await loadVault(primary);
    const named = vault.status === 'ready' ? vault.data?.linkedBanks ?? [] : [];
    for (const ref of named) {
      const login = { blz: ref.blz, userId: ref.userId };
      if (done.some((l) => sameLogin(l, login))) continue;
      done.push(login);
      removed += await wipeHistoryOf(login);
      removed += await wipeDocsOf(login);
    }
  } catch (err) {
    wipeFailed(through);
    throw err;
  }
  return removed;
}

/**
 * The wipe did not get through (a file that stayed, the vault): the client
 * carries on as before and the saved data goes on being saved, so each
 * session it went through keeps documents again (lib/doc-store.ts resumeDocs).
 * The routes call it for the primary and the further banks' sessions.
 */
export function wipeFailed(sessions: readonly Session[]): void {
  for (const s of sessions) resumeDocs(s);
}

/** The desktop shell's way to the LAN shelf's folder on disk (desktop/server/folders.ts). */
const shellForget = () =>
  (globalThis as { __girovoLanForget?: (group: string) => Promise<number> }).__girovoLanForget;

/**
 * Deletes the files of the sync group with `key` from this computer's LAN
 * shelf: whatever the shell keeps on disk, and what the server's own tree
 * holds (the token lib/sync-stores.ts keepLanToken wrote; on the development
 * server, the folder itself). Nothing on the phone, which keeps no shelf.
 * Throws a VaultError (provider.vault.wipe) when a file stays. Answers how
 * many went.
 */
export async function forgetLanGroup(key: Buffer): Promise<number> {
  if (IS_ANDROID) return 0;
  const group = groupOf(key);
  let removed = 0;
  const shell = shellForget();
  try {
    if (shell) removed += await shell(group);
    const here = await removeFamily(lanHostDir(), group, (code) => console.warn('[wipe] LAN shelf: could not delete a file:', code));
    if (here.failed) throw new Error(`${here.failed} file(s) left`);
    removed += here.removed;
  } catch (err) {
    console.warn('[wipe] LAN shelf:', (err as NodeJS.ErrnoException)?.code || 'not all of the group deleted');
    throw new VaultError(msgs().provider.vault.wipe, 500);
  }
  return removed;
}
