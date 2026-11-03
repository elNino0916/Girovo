// Sync between devices (6.0): the first login's personal data — notes,
// categories and rules, budgets, Sparziele, templates, account names, the
// arrangement of the overview, kept balances — and its receipts, the same on
// the phone and the computer, end-to-end encrypted, with no server of
// Girovo's in between.
//
// The devices of one login share a key, made by the first and handed to the
// next as a code (a QR code on screen): nothing else is needed to read what
// they leave each other. They meet in a place that keeps files — the
// computer itself over the home network (electron/sync-lan.cjs), a WebDAV
// folder (Nextcloud and the like), a folder a sync tool already keeps in
// step — and each device only ever writes its own files there:
//
//   <group>.devices          who belongs to the group (name, last seen)
//   <group>.<device>.state   that device's entries, each with its time (lib/sync-entries.ts)
//   <group>.<blob>.doc       one receipt's bytes
//
// <group> comes from the key; every file is sealed with it (AES-256-GCM, the
// file's name bound in), so the place learns sizes and times, nothing else.
// A device that reads another's state merges it entry by entry (newest change
// wins), writes the result back to its own vault and leaves its own state.
// A file that does not open — damaged, or from another group — is skipped.
//
// The place and the vault come in as arguments (`SyncStore`, `ReceiptsSide`),
// so `node --test` runs a whole round between two devices (lib/sync.test.ts).

import crypto from 'node:crypto';
import type { VaultData } from './app-types';
import type { KeptDoc } from './docs';
import { mergeEntries, restamp, stableJson, vaultEntries, vaultFromEntries, type RemoteState, type Stamps, type SyncEntry } from './sync-entries.ts';

/** A place that keeps files by name. */
export type SyncStore = {
  get(name: string): Promise<Uint8Array | null>;
  put(name: string, bytes: Uint8Array): Promise<void>;
};

/** This login's receipts on this device (lib/doc-store.ts, through the session). */
export type ReceiptsSide = {
  list(): Promise<KeptDoc[]>;
  read(id: string): Promise<Uint8Array>;
  /** Keeps it; answers the id it got here, or null when it was not kept (already there, or no room). */
  add(doc: KeptDoc, bytes: Uint8Array): Promise<string | null>;
  remove(id: string): Promise<void>;
  link(id: string, tx: string | null, accountNumber: string | null): Promise<void>;
};

/** What this device keeps about the group, beside its vault (lib/sync-meta.ts). */
export type SyncLocal = {
  stamps: Stamps;
  /**
   * Set when this device joined and has not had its first round: what it
   * brought counts as older than anything the group has, so it never
   * overwrites the group's newer notes or brings back what the group deleted.
   */
  joining?: true;
  /** Receipts whose bytes this device has left in the place, by content hash. */
  uploaded: string[];
  /** Each local receipt's content hash, by its id — reading every receipt each time is slow. */
  hashes: Record<string, string>;
};

export type SyncDevice = { id: string; name: string; at: number };

export type SyncResult = {
  vault: VaultData;
  local: SyncLocal;
  /** Whether the vault changed (the other devices had something new). */
  changed: boolean;
  devices: SyncDevice[];
  receipts: { added: number; removed: number };
};

export const KEY_BYTES = 32;
const DEVICES_MAX = 8;
/**
 * A device not seen this long is left out — its state no longer read, its
 * entry dropped — well before a deletion's tombstone is forgotten
 * (sync-entries.ts TOMBSTONE_MS), so it can never bring a deleted note back.
 */
export const DEVICE_STALE_MS = 90 * 86_400_000;
const NAME_MAX = 40;
const FILE_MAX = 64 * 1024 * 1024;
const IV = 12;
const TAG = 16;

/** The group's name in the place: from the key, telling nothing about it. */
export const groupOf = (key: Buffer): string =>
  crypto.createHash('sha256').update('girovo/sync/group').update(key).digest('hex').slice(0, 24);
const fileKey = (key: Buffer) => crypto.createHash('sha256').update('girovo/sync/file').update(key).digest();
const blobOf = (key: Buffer, hash: string) =>
  crypto.createHash('sha256').update('girovo/sync/blob').update(key).update(hash).digest('hex').slice(0, 32);
export const contentHash = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 32);

export const devicesFile = (key: Buffer) => `${groupOf(key)}.devices`;
export const stateFile = (key: Buffer, device: string) => `${groupOf(key)}.${device}.state`;
export const blobFile = (key: Buffer, hash: string) => `${groupOf(key)}.${blobOf(key, hash)}.doc`;

/** Seals `plain` under the group's key, bound to the file's name. */
export function seal(key: Buffer, name: string, plain: Uint8Array): Uint8Array {
  const iv = crypto.randomBytes(IV);
  const cipher = crypto.createCipheriv('aes-256-gcm', fileKey(key), iv, { authTagLength: TAG });
  cipher.setAAD(Buffer.from(name, 'utf8'));
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

/** Opens what `seal` sealed for this name; null for anything else. */
export function unseal(key: Buffer, name: string, sealed: Uint8Array | null): Buffer | null {
  if (!sealed || sealed.length < IV + TAG || sealed.length > FILE_MAX) return null;
  try {
    const buf = Buffer.from(sealed);
    const decipher = crypto.createDecipheriv('aes-256-gcm', fileKey(key), buf.subarray(0, IV), { authTagLength: TAG });
    decipher.setAAD(Buffer.from(name, 'utf8'));
    decipher.setAuthTag(buf.subarray(IV, IV + TAG));
    return Buffer.concat([decipher.update(buf.subarray(IV + TAG)), decipher.final()]);
  } catch {
    return null;
  }
}

const readJson = async (store: SyncStore, key: Buffer, name: string): Promise<unknown> => {
  const plain = unseal(key, name, await store.get(name).catch(() => null));
  if (!plain) return null;
  try {
    return JSON.parse(plain.toString('utf8'));
  } catch {
    return null;
  }
};
const writeJson = (store: SyncStore, key: Buffer, name: string, value: unknown) =>
  store.put(name, seal(key, name, Buffer.from(JSON.stringify(value), 'utf8')));

const isDeviceId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{16}$/.test(v);

function readDevices(v: unknown): SyncDevice[] {
  const out: SyncDevice[] = [];
  for (const d of Array.isArray(v) ? v : []) {
    if (!d || !isDeviceId(d.id) || out.some((o) => o.id === d.id)) continue;
    out.push({ id: d.id, name: typeof d.name === 'string' ? d.name.slice(0, NAME_MAX) : '', at: Number(d.at) || 0 });
  }
  return out;
}

/** A receipt as an entry: what describes it, never its id on one device. */
function receiptEntry(doc: KeptDoc) {
  return {
    name: doc.name, mime: doc.mime, size: doc.size, addedAt: doc.addedAt,
    accountNumber: doc.accountNumber ?? null, tx: doc.tx ?? null, awaiting: doc.awaiting ?? null,
  };
}
type ReceiptEntry = ReturnType<typeof receiptEntry>;

export const newDeviceId = () => crypto.randomBytes(8).toString('hex');
export const newGroupKey = () => crypto.randomBytes(KEY_BYTES);

/**
 * One round: this device's vault and receipts merged with every other
 * device's state in the place, and this device's own state left there.
 */
export async function runSync(opts: {
  store: SyncStore;
  key: Buffer;
  device: { id: string; name: string };
  vault: VaultData;
  local: SyncLocal;
  /** null: this device's receipts cannot be read now — they are left as they are, here and in the others' view. */
  receipts: ReceiptsSide | null;
  /**
   * The vault as it will be kept (lib/vault.ts sanitizeVault): an entry the
   * keeping drops (a cap, a category this version does not know) is not one
   * this device deleted, and must not reach the others as deleted.
   */
  keep?: (vault: VaultData) => VaultData;
  now?: number;
}): Promise<SyncResult> {
  const { store, key, device, vault, receipts } = opts;
  const now = opts.now ?? Date.now();

  // Who is in the group: this device says it is here; long-silent ones are left out.
  const known = readDevices(await readJson(store, key, devicesFile(key)));
  const devices = [
    { id: device.id, name: device.name.slice(0, NAME_MAX), at: now },
    ...known.filter((d) => d.id !== device.id && now - d.at < DEVICE_STALE_MS),
  ].slice(0, DEVICES_MAX);
  await writeJson(store, key, devicesFile(key), devices);

  // This device's entries: the vault's, and one per receipt (by content).
  const docs = receipts ? (await receipts.list()).filter((d) => d.kind === 'receipt') : [];
  const hashes: Record<string, string> = {};
  for (const d of docs) hashes[d.id] = opts.local.hashes[d.id] ?? contentHash(await receipts!.read(d.id));
  const entries = vaultEntries(vault);
  for (const d of docs) entries.set(`docs/${hashes[d.id]}`, receiptEntry(d));
  // Unreadable receipts are not deleted ones: they take no part in this
  // round, and their stamps are kept aside as they were.
  const asideDocs: Stamps = {};
  let prior = opts.local.stamps;
  if (!receipts) {
    prior = {};
    for (const [p, st] of Object.entries(opts.local.stamps)) (p.startsWith('docs/') ? asideDocs : prior)[p] = st;
  }
  // A device's first round after joining: what it brought is older than the group's.
  const stamps = restamp(entries, prior, opts.local.joining && !Object.keys(prior).length ? 0 : now);

  // Every other device's state.
  const remotes: RemoteState[] = [];
  for (const d of devices) {
    if (d.id === device.id) continue;
    const st = await readJson(store, key, stateFile(key, d.id)) as { entries?: Record<string, SyncEntry> } | null;
    if (st?.entries && typeof st.entries === 'object') remotes.push({ device: d.id, entries: st.entries });
  }
  const merged = mergeEntries(entries, stamps, device.id, remotes, now);

  // The receipts: what the others added comes here, what they deleted goes,
  // a changed match follows — and this device's bytes go to the place once.
  const localByHash = new Map(docs.map((d) => [hashes[d.id], d]));
  const receivedHere = new Set<string>();
  let added = 0;
  let removed = 0;
  for (const [path, value] of receipts ? merged.entries : []) {
    if (!path.startsWith('docs/')) continue;
    const hash = path.slice(5);
    if (!value || typeof value !== 'object' || typeof (value as ReceiptEntry).mime !== 'string') continue;
    const meta = value as ReceiptEntry;
    const mine = localByHash.get(hash);
    if (mine) {
      if ((mine.tx ?? null) !== meta.tx || (mine.accountNumber ?? null) !== meta.accountNumber) {
        await receipts!.link(mine.id, meta.tx, meta.accountNumber).catch(() => {});
      }
      continue;
    }
    const bytes = unseal(key, blobFile(key, hash), await store.get(blobFile(key, hash)).catch(() => null));
    // Not there yet (its device has not left it), or not what it says: next time.
    if (!bytes || contentHash(bytes) !== hash) continue;
    const id = await receipts!.add({ id: crypto.randomBytes(16).toString('hex'), kind: 'receipt', ...meta, size: bytes.length }, bytes);
    if (!id) continue;
    hashes[id] = hash;
    // Its bytes are in the place already: never left there a second time.
    receivedHere.add(hash);
    added++;
  }
  for (const d of docs) {
    if (merged.entries.has(`docs/${hashes[d.id]}`)) continue;
    await receipts!.remove(d.id);
    delete hashes[d.id];
    removed++;
  }
  const uploaded = new Set([...opts.local.uploaded, ...receivedHere].filter((h) => merged.entries.has(`docs/${h}`)));
  for (const d of docs) {
    const h = hashes[d.id];
    if (!h || uploaded.has(h)) continue;
    await store.put(blobFile(key, h), seal(key, blobFile(key, h), await receipts!.read(d.id)));
    uploaded.add(h);
  }

  await writeJson(store, key, stateFile(key, device.id), { v: 1, device: { id: device.id, name: device.name }, at: now, entries: merged.state });

  const vaultEntriesOnly = new Map([...merged.entries].filter(([p]) => !p.startsWith('docs/')));
  const built = vaultFromEntries(vaultEntriesOnly, vault);
  const next = opts.keep ? opts.keep(built) : built;
  const sorted = (v: VaultData) => stableJson([...vaultEntries(v)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const changed = sorted(next) !== sorted(vault);
  // Kept hashes only for receipts still here.
  const keptHashes: Record<string, string> = {};
  for (const [id, h] of Object.entries(hashes)) if (merged.entries.has(`docs/${h}`)) keptHashes[id] = h;
  // Stamps only for what this device really holds now. An entry the vault
  // did not keep, or a receipt that did not arrive, gets none: it is not this
  // device's to delete, and the next round tries it again. A tombstone stays.
  const held = vaultEntries(next);
  const heldDocs = new Set(Object.values(keptHashes));
  const stampsNow: Stamps = { ...asideDocs };
  for (const [p, st] of Object.entries(merged.stamps)) {
    if (st.h === '-') stampsNow[p] = st;
    else if (p.startsWith('docs/') ? receipts && heldDocs.has(p.slice(5)) : held.has(p)) stampsNow[p] = st;
  }
  return {
    vault: changed ? next : vault,
    local: { stamps: stampsNow, uploaded: [...uploaded], hashes: keptHashes },
    changed,
    devices,
    receipts: { added, removed },
  };
}

/** This device leaves the group's list (its state file stays, sealed, for no one). */
export async function leaveGroup(store: SyncStore, key: Buffer, deviceId: string): Promise<void> {
  const known = readDevices(await readJson(store, key, devicesFile(key)));
  if (!known.some((d) => d.id === deviceId)) return;
  await writeJson(store, key, devicesFile(key), known.filter((d) => d.id !== deviceId));
}

// ---------------------------------------------------------------------------
// The code that brings a device into the group

/** How the devices meet: the computer over the home network, a WebDAV folder, or a folder. */
export type SyncPlace =
  | { kind: 'lan'; addresses: string[]; port: number }
  | { kind: 'webdav'; url: string; user: string; password: string }
  | { kind: 'folder'; path?: string };

const CODE_PREFIX = 'girovo-sync:1:';

/** The login a group belongs to, without naming it: the code is refused by any other. */
export const loginTag = (blz: string, userId: string) =>
  crypto.createHash('sha256').update(`${blz}|${userId}|girovo-sync`).digest('hex').slice(0, 12);

export function makeCode(key: Buffer, login: { blz: string; userId: string }, place: SyncPlace): string {
  // A folder's path is this device's own; the next device picks its own copy of it.
  const shared = place.kind === 'folder' ? { kind: 'folder' } : place;
  const payload = { k: key.toString('base64'), l: loginTag(login.blz, login.userId), p: shared };
  return CODE_PREFIX + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function readCode(code: string): { key: Buffer; tag: string; place: SyncPlace } | null {
  const text = String(code ?? '').trim();
  if (!text.startsWith(CODE_PREFIX) || text.length > 4096) return null;
  try {
    const raw = JSON.parse(Buffer.from(text.slice(CODE_PREFIX.length), 'base64url').toString('utf8'));
    const key = Buffer.from(String(raw?.k ?? ''), 'base64');
    if (key.length !== KEY_BYTES || typeof raw.l !== 'string') return null;
    const place = readPlace(raw.p);
    return place ? { key, tag: raw.l, place } : null;
  } catch {
    return null;
  }
}

const PRIVATE_V4 = /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;
const privateV4 = (a: string) => PRIVATE_V4.test(a) && a.split('.').every((o) => Number(o) <= 255);

/** What the desktop app's shelf asks of every request (electron/sync-lan.cjs): from the key, never the key. */
export const lanToken = (key: Buffer) =>
  crypto.createHash('sha256').update('girovo/sync/lan').update(key).digest('hex').slice(0, 32);

/** A place as a request or a code names it, checked; null when it is none. */
export function readPlace(v: unknown): SyncPlace | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (r.kind === 'lan') {
    const addresses = Array.isArray(r.addresses) ? r.addresses.filter((a): a is string => typeof a === 'string' && privateV4(a)).slice(0, 4) : [];
    const port = Number(r.port);
    if (!addresses.length || !Number.isInteger(port) || port < 1024 || port > 65535) return null;
    return { kind: 'lan', addresses, port };
  }
  if (r.kind === 'webdav') {
    const url = typeof r.url === 'string' ? r.url.trim().replace(/\/+$/, '') : '';
    if (!/^https:\/\/[^\s/]+/i.test(url) || url.length > 500) return null;
    const user = typeof r.user === 'string' ? r.user.slice(0, 200) : '';
    const password = typeof r.password === 'string' ? r.password.slice(0, 500) : '';
    return { kind: 'webdav', url, user, password };
  }
  if (r.kind === 'folder') {
    const path = typeof r.path === 'string' && r.path.trim() && r.path.length <= 1000 ? r.path.trim() : undefined;
    return path ? { kind: 'folder', path } : { kind: 'folder' };
  }
  return null;
}
