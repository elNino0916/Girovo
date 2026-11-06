// Sync between devices (lib/sync.ts): setting it up, the code for the next
// device, and one round.
//
// One POST with an `op` and the sessionId in the body:
//   status                          → { on, place?, deviceName?, lastSync?, devices? }
//   create {place, deviceName}      → { code }         a new group, this device its first member
//   code   {place?}                 → { code }         for one more device (the computer's addresses refreshed)
//   join   {code, deviceName, place?} → { on: true }   this device into the group the code names
//   run    {vault}                  → { changed, vault?, devices, lastSync, receipts }
//                                     the merged vault is saved here and handed back
//   leave                           → { on: false }
// Only for the first login of the view, once its vault is loaded: the group's
// settings are sealed with the vault's key (lib/sync-meta.ts). The code is the
// group's key; it is shown, never logged.

import { boundedBody, fail, json, sessionExpired, wrap } from '@/lib/api';
import { IS_ANDROID } from '@/lib/platform';
import { msgs } from '@/lib/i18n';
import { linkReceipt, listDocs, readDoc, removeDoc, restoreDocs } from '@/lib/doc-store';
import { loginOfSession } from '@/lib/linked-unlock';
import { getSession, type Session } from '@/lib/session';
import {
  leaveGroup, loginTag, makeCode, newDeviceId, newGroupKey, readCode, readPlace, runSync, type ReceiptsSide, type SyncPlace,
} from '@/lib/sync';
import { readMeta, removeMeta, syncMetaFileOf, writeMeta, type SyncMeta } from '@/lib/sync-meta';
import { keepLanToken, storeFor, SyncPlaceError } from '@/lib/sync-stores';
import { serialized } from '@/lib/sealed-file';
import { sanitizeVault, saveVault, VAULT_REQUEST_MAX_BYTES, vaultKeyOf } from '@/lib/vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SyncBody = {
  op?: 'status' | 'create' | 'code' | 'join' | 'run' | 'leave';
  sessionId?: string;
  place?: unknown;
  deviceName?: unknown;
  code?: unknown;
  vault?: unknown;
};

const nameOf = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : IS_ANDROID ? 'Telefon' : 'Computer');

/** This login's receipts through its session — null while their store does not open. */
async function receiptsOf(s: Session): Promise<ReceiptsSide | null> {
  const { locked } = await listDocs(s);
  if (locked) return null;
  return {
    list: async () => (await listDocs(s)).docs,
    read: async (id) => (await readDoc(s, id)).bytes,
    async add(doc, bytes) {
      const before = new Set((await listDocs(s)).docs.map((d) => d.id));
      const r = await restoreDocs(s, [{ doc, bytes: Buffer.from(bytes) }]);
      if (!r.added) return null;
      return (await listDocs(s)).docs.find((d) => !before.has(d.id))?.id ?? null;
    },
    remove: (id) => removeDoc(s, id),
    link: async (id, tx, accountNumber) => {
      if (tx) await linkReceipt(s, id, tx, accountNumber);
    },
  };
}

/** A place as this device may use it: the computer is the meeting point over the home network, the phone has no folder. */
function placeHere(place: SyncPlace): string | null {
  const said = msgs().sync.api;
  if (place.kind === 'folder' && IS_ANDROID) return said.noFolderHere;
  if (place.kind === 'folder' && !place.path) return said.needFolder;
  return null;
}

export const POST = wrap(async (req: Request) => {
  const said = msgs().sync.api;
  const b = await boundedBody<SyncBody>(req, VAULT_REQUEST_MAX_BYTES);
  if (!b) return fail(said.unknownAction, 413);
  const s = getSession(b.sessionId ?? '');
  if (!s) return sessionExpired();
  const login = loginOfSession(s);
  if (!login) return fail(said.noVault, 409);

  // One operation per login at a time: two rounds at once would add a
  // receipt twice and keep only one round's stamps.
  return serialized(`${syncMetaFileOf(login.blz, login.userId)}#op`, () => handle(b, s, login));
});

async function handle(b: SyncBody, s: Session, login: { blz: string; userId: string }) {
  const said = msgs().sync.api;
  if (b.op === 'leave') {
    // Out of the group's list first (its files stay, sealed, for no one), then the settings go.
    const before = vaultKeyOf(s) ? await readMeta(s) : null;
    const store = before ? safeStore(before) : null;
    if (before && store) await leaveGroup(store, before.key, before.deviceId).catch(() => {});
    await removeMeta(login.blz, login.userId);
    return json({ on: false });
  }
  if (!vaultKeyOf(s)) return fail(said.noVault, 409);
  const meta = await readMeta(s);

  switch (b.op) {
    case 'status':
      return json(meta
        ? { on: true, place: meta.place.kind, deviceName: meta.deviceName, lastSync: meta.lastSync ?? null, devices: meta.devices ?? [], deviceId: meta.deviceId }
        : { on: false });
    case 'create': {
      if (meta) return fail(said.already, 409);
      const place = readPlace(b.place);
      if (!place) return fail(said.badPlace);
      const refused = placeHere(place);
      if (refused) return fail(refused);
      const key = newGroupKey();
      await writeMeta(s, { key, deviceId: newDeviceId(), deviceName: nameOf(b.deviceName), place, local: { stamps: {}, uploaded: [], hashes: {} } });
      return json({ code: makeCode(key, login, place) });
    }
    case 'code': {
      if (!meta) return fail(said.notSetUp, 409);
      // The computer's addresses may have changed since it was set up.
      const fresher = readPlace(b.place);
      const place = fresher && fresher.kind === meta.place.kind ? fresher : meta.place;
      if (place !== meta.place) await writeMeta(s, { ...meta, place });
      return json({ code: makeCode(meta.key, login, place) });
    }
    case 'join': {
      if (meta) return fail(said.already, 409);
      const code = readCode(String(b.code ?? ''));
      if (!code) return fail(said.badCode);
      if (code.tag !== loginTag(login.blz, login.userId)) return fail(said.otherLogin);
      // Over the home network the computer is the meeting point: a second computer cannot be one.
      if (code.place.kind === 'lan' && !IS_ANDROID) return fail(said.lanFromComputer);
      const chosen = readPlace(b.place);
      const place: SyncPlace = code.place.kind === 'folder' ? (chosen?.kind === 'folder' ? chosen : { kind: 'folder' }) : code.place;
      const refused = placeHere(place);
      if (refused) return fail(refused);
      // What this device brought counts as older than the group's (lib/sync.ts SyncLocal.joining).
      await writeMeta(s, { key: code.key, deviceId: newDeviceId(), deviceName: nameOf(b.deviceName), place, local: { stamps: {}, uploaded: [], hashes: {}, joining: true } });
      return json({ on: true });
    }
    case 'run': {
      if (!meta) return fail(said.notSetUp, 409);
      const store = safeStore(meta);
      if (!store) return fail(said.badPlace, 409);
      // The vault exactly as the server keeps it, never something it would not.
      const sent = sanitizeVault(b.vault);
      if (!sent) return fail(said.unknownAction);
      const saved = await saveVault(s, sent);
      const vault = { ...sent, updatedAt: saved.updatedAt };
      let result;
      try {
        result = await runSync({
          store, key: meta.key, device: { id: meta.deviceId, name: meta.deviceName }, vault, local: meta.local, receipts: await receiptsOf(s),
          keep: (v) => sanitizeVault(v) ?? v,
        });
      } catch (err) {
        // The place out of reach or refusing: said, not reported as a fault (it is the network's state).
        if (err instanceof SyncPlaceError) {
          if (err.reason === 'refused') return fail(said.placeRefused, 503);
          return fail(meta.place.kind === 'lan' ? msgs().sync.unreachableLan : said.unreachable, 503);
        }
        throw err;
      }
      // The saved data was deleted meanwhile ("Gespeicherte Daten löschen"):
      // nothing of this round may bring it back.
      if (!vaultKeyOf(s)) return fail(said.noVault, 409);
      const lastSync = Date.now();
      if (result.changed) await saveVault(s, result.vault);
      await writeMeta(s, { ...meta, local: result.local, lastSync, devices: result.devices });
      return json({
        changed: result.changed,
        ...(result.changed ? { vault: result.vault } : {}),
        devices: result.devices,
        lastSync,
        receipts: result.receipts,
        deviceId: meta.deviceId,
      });
    }
    default:
      return fail(said.unknownAction);
  }
}

/** The place for this group; the desktop's shelf learns the group's token first (src-tauri/src/sync_lan.rs). */
function safeStore(meta: SyncMeta) {
  if (meta.place.kind === 'lan' && !IS_ANDROID) keepLanToken(meta.key);
  return storeFor(meta.place, meta.key);
}
