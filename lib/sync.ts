// Sync between devices (6.0): the first login's personal data — notes,
// categories and rules, budgets, Sparziele, templates, account names, the
// arrangement of the overview, kept balances — and its receipts, the same on
// the phone and the computer, end-to-end encrypted, with no server of
// Girovo's in between.
//
// The devices of one login share a key, made by the first and handed to the
// next as a code (a QR code on screen): nothing else is needed to read what
// they leave each other. They meet in a place that keeps files — the
// computer itself over the home network (src-tauri/src/sync_lan.rs), a WebDAV
// folder (Nextcloud and the like), a folder a sync tool already keeps in
// step — and each device only ever writes its own files there:
//
//   <group>.devices          who belongs to the group (name, last seen)
//   <group>.<device>.state   that device's entries, each with its time (lib/sync-entries.ts)
//   <group>.<blob>.doc       one receipt's bytes, removed by the device that deleted it once all have seen that
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
import type { KeyMoves } from './booking-keys';
import type { KeptDoc } from './docs';
import {
  hashOf, mergeEntries, moveMergedKeys, restamp, stableJson, vaultEntries, vaultFromEntries,
  type RemoteState, type Stamp, type Stamps, type SyncEntry,
} from './sync-entries.ts';

/** A place that keeps files by name. */
export type SyncStore = {
  get(name: string): Promise<Uint8Array | null>;
  put(name: string, bytes: Uint8Array): Promise<void>;
  /** Removes it; one that is not there is no error. A place without it keeps a deleted receipt's bytes. */
  remove?(name: string): Promise<void>;
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
  /** Receipts whose bytes this device has left in the place, or taken from it, by content hash. */
  uploaded: string[];
  /** Each local receipt's content hash, by its id — reading every receipt each time is slow. */
  hashes: Record<string, string>;
  /**
   * Receipts deleted here whose bytes are still in the place, by content
   * hash: they leave it once every device of the group has taken in the
   * deletion — never while one may still keep the receipt.
   */
  removing?: string[];
};

export type SyncDevice = { id: string; name: string; at: number };

export type SyncResult = {
  vault: VaultData;
  local: SyncLocal;
  /** Whether the vault changed (the other devices had something new). */
  changed: boolean;
  devices: SyncDevice[];
  /** `relinked`: receipts here tied to another booking by the round (another device's choice, a moved key). */
  receipts: { added: number; removed: number; relinked: number };
  /**
   * Entries of the other devices this one has no room for (the vault's byte
   * limit, `maxBytes`): they stay theirs, untouched, and every round tries
   * them again. 0 when everything fits.
   */
  full: number;
};

export const KEY_BYTES = 32;
const DEVICES_MAX = 8;
/**
 * A device not seen this long is left out — its state no longer read, its
 * entry dropped — long before a deletion's tombstone is forgotten
 * (sync-entries.ts TOMBSTONE_MS, years): neither its old state nor the
 * device itself, when it comes back, can bring a deleted note back, since
 * the others still hold the tombstone that beats its older entry.
 */
export const DEVICE_STALE_MS = 90 * 86_400_000;
/**
 * How full a round fills the vault with what is new from the others, of
 * `maxBytes`: the rest stays room for this device's own next edits, which
 * lib/vault.ts would otherwise refuse to save.
 */
export const FILL_MAX = 0.85;
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

/** Whether two sets of stamps say the same. */
function sameStamps(a: Stamps, b: Stamps): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((p) => a[p] === b[p] || (b[p] !== undefined && a[p].h === b[p].h && a[p].t === b[p].t));
}

/**
 * The stamp for an entry this device holds as `held`, given it as `st` says:
 * held as given, the stamp as it is; held changed by the keeping, the same
 * stamp with what it holds as `k` (sync-entries.ts Stamp) — at the time it had.
 */
const stampAsHeld = (st: Stamp, held: unknown): Stamp => {
  const h = hashOf(held);
  if (h === st.h) return st.k === undefined ? st : { h: st.h, t: st.t };
  return st.k === h ? st : { h: st.h, t: st.t, k: h };
};

/** UTF-8 bytes of a value as JSON — how lib/vault.ts measures the vault. */
const jsonBytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v) ?? '', 'utf8');
/** What one entry takes in the vault's JSON, about: its key (not its field) and its value. */
const entryBytes = (path: string, v: unknown) => jsonBytes(path.slice(path.indexOf('/') + 1)) + jsonBytes(v) + 2;

/** The place has no room for one more file (lib/sync-stores.ts SyncPlaceError 'full': the shelf's 507, a WebDAV quota). */
const placeFull = (err: unknown) => (err as { reason?: unknown } | null)?.reason === 'full';

export const newDeviceId = () => crypto.randomBytes(8).toString('hex');
export const newGroupKey = () => crypto.randomBytes(KEY_BYTES);

/**
 * One round: this device's vault and receipts merged with every other
 * device's state in the place, and this device's own state left there.
 *
 * In this order: the place first (a deleted receipt's bytes, new receipts'
 * bytes, the state, the devices list), only then this device's receipts — so
 * a round the place cuts off has changed nothing here — and the stamps kept
 * (`checkpoint`) before anything of the round reaches the place and again
 * once the receipts here changed.
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
  /**
   * The most the kept vault may take as JSON (lib/vault.ts VAULT_LIMITS.bytes,
   * which refuses to save more). What is new from the others comes only
   * while the vault stays within FILL_MAX of it — the oldest left out first,
   * instead of failing every round, and with room left for this device's own
   * edits.
   */
  maxBytes?: number;
  /**
   * Keeps this device's sync state (lib/sync-meta.ts) while the round is under
   * way. A round cut off later — the place gone mid-way, the app closed —
   * then never stamps what this device holds anew, which would make it newer
   * than what the others did meanwhile (a receipt deleted there would come
   * back, a match made there would be undone).
   */
  checkpoint?: (local: SyncLocal) => Promise<void>;
  /**
   * Booking keys to move from keys from before to the keys now
   * (lib/booking-keys.ts): done after the merge, with every entry's stamp
   * (sync-entries.ts moveMergedKeys) — never on the page while sync is on.
   */
  moves?: KeyMoves;
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
  // "Letzte Salden behalten" is each device's own choice: switched off here,
  // the kept balances and the curve it held are not this device's to delete
  // for the others. Their stamps go without a tombstone.
  if (vault.keepBalances === false) {
    prior = Object.fromEntries(Object.entries(prior).filter(([p, st]) => st.h === '-' || !(p.startsWith('keptBalances/') || p.startsWith('netWorth/'))));
  }
  // A device's first round after joining: what it brought is older than the group's.
  const stamps = restamp(entries, prior, opts.local.joining && !Object.keys(prior).length ? 0 : now);

  // Every other device's state. Only a tombstone deletes: an entry that is
  // missing from a state (its device never held it, the read failed) is
  // never taken for deleted — a device back after months keeps what the
  // others did not hold, and loses only what they deleted, tombstone and all.
  const remotes: RemoteState[] = [];
  for (const d of devices) {
    if (d.id === device.id) continue;
    const st = await readJson(store, key, stateFile(key, d.id)) as { entries?: Record<string, SyncEntry> } | null;
    if (st?.entries && typeof st.entries === 'object') remotes.push({ device: d.id, entries: st.entries });
  }
  const merged = mergeEntries(entries, stamps, device.id, remotes, now);
  const fill = opts.maxBytes === undefined ? Infinity : Math.floor(opts.maxBytes * FILL_MAX);
  // Booking keys moved now that the others' edits are in (moveMergedKeys);
  // what the move wrote is this device's own, never left out below as new.
  const had = vaultEntries(vault);
  const moved = opts.moves
    ? moveMergedKeys(merged, opts.moves, vault, now, {
      maxBytes: Number.isFinite(fill) ? fill : undefined,
      incoming: new Set([...merged.entries.keys()].filter((p) => !p.startsWith('docs/') && !had.has(p))),
      docs: !!receipts,
    })
    : new Set<string>();

  // What this device holds now, stamped, is kept before anything of this
  // round reaches the place.
  const stampedHere: Stamps = { ...asideDocs, ...stamps };
  if (opts.checkpoint && !sameStamps(stampedHere, opts.local.stamps)) {
    await opts.checkpoint({ ...opts.local, stamps: stampedHere, hashes: { ...hashes } });
  }

  // The place. A receipt deleted here takes its bytes out of it once every
  // device of the group has taken in the deletion and it still stands —
  // never while one of them may still keep the receipt (matched again there
  // meanwhile, its later stamp beats the deletion) or its state could not be
  // read this round. A deletion forgotten after its years goes at once.
  const removing = new Set(opts.local.removing ?? []);
  if (receipts) {
    const had = new Set(opts.local.uploaded);
    for (const [p, st] of Object.entries(stamps)) {
      if (p.startsWith('docs/') && st.h === '-' && merged.stamps[p]?.h === '-' && had.has(p.slice(5))) removing.add(p.slice(5));
    }
    for (const h of removing) {
      const p = `docs/${h}`;
      if (merged.entries.has(p)) {
        removing.delete(h);
        continue;
      }
      const everywhere = devices.every((d) => d.id === device.id || remotes.some((r) => r.device === d.id && r.entries[p]?.d === 1));
      if (!everywhere && merged.stamps[p]) continue;
      if (store.remove) await store.remove(blobFile(key, h));
      removing.delete(h);
    }
  }
  // A receipt kept here that beat another device's deletion: its bytes may
  // have left the place meanwhile (a round cut off, an older version), so
  // they go up again until no state says deleted any more.
  const contested = new Set<string>();
  for (const r of remotes) {
    for (const [p, e] of Object.entries(r.entries)) if (p.startsWith('docs/') && e?.d === 1 && merged.entries.has(p)) contested.add(p.slice(5));
  }
  // This device's receipts' bytes, once each.
  const uploaded = new Set(opts.local.uploaded.filter((h) =>
    !contested.has(h) && (merged.entries.has(`docs/${h}`) || (asideDocs[`docs/${h}`] && asideDocs[`docs/${h}`].h !== '-'))));
  for (const d of docs) {
    const h = hashes[d.id];
    if (uploaded.has(h) || !merged.entries.has(`docs/${h}`)) continue;
    try {
      await store.put(blobFile(key, h), seal(key, blobFile(key, h), await receipts!.read(d.id)));
    } catch (err) {
      // No room for one more file there (the desktop's shelf is full, a
      // WebDAV quota): this receipt waits for the next round, the rest syncs on.
      if (placeFull(err)) continue;
      throw err;
    }
    uploaded.add(h);
  }
  await writeJson(store, key, stateFile(key, device.id), { v: 1, device: { id: device.id, name: device.name }, at: now, entries: merged.state });
  // "Last seen" only once this round's state is written: a device whose
  // rounds keep failing ages out of the others' view (DEVICE_STALE_MS)
  // instead of keeping its old state, tombstones expired, in it.
  await writeJson(store, key, devicesFile(key), devices);

  // Then the receipts here: what the others added comes, what they deleted
  // goes, a changed match follows.
  const localByHash = new Map(docs.map((d) => [hashes[d.id], d]));
  let added = 0;
  let removed = 0;
  let relinked = 0;
  for (const [path, value] of receipts ? merged.entries : []) {
    if (!path.startsWith('docs/')) continue;
    const hash = path.slice(5);
    if (!value || typeof value !== 'object' || typeof (value as ReceiptEntry).mime !== 'string') continue;
    const meta = value as ReceiptEntry;
    const here = localByHash.get(hash);
    if (here) {
      if ((here.tx ?? null) !== meta.tx || (here.accountNumber ?? null) !== meta.accountNumber) {
        await receipts!.link(here.id, meta.tx, meta.accountNumber).catch(() => {});
        relinked++;
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
    uploaded.add(hash);
    added++;
  }
  for (const d of docs) {
    if (merged.entries.has(`docs/${hashes[d.id]}`)) continue;
    await receipts!.remove(d.id);
    delete hashes[d.id];
    removed++;
  }
  // Kept hashes only for receipts still here.
  const keptHashes: Record<string, string> = {};
  for (const [id, h] of Object.entries(hashes)) if (merged.entries.has(`docs/${h}`)) keptHashes[id] = h;
  // Stamps only for receipts this device really holds now: one that did not
  // arrive gets none — it is not this device's to delete, and the next round
  // tries it again. A tombstone stays. One the doc store keeps a little
  // differently (lib/docs.ts sanitizeDoc) is stamped as held, at the time it
  // had; a match this device could not follow (there is no unlinking) stays
  // its own, to go to the others with the next round as before.
  const current = added || relinked ? (await receipts!.list()).filter((d) => d.kind === 'receipt') : docs;
  const heldAs = new Map(current.filter((d) => keptHashes[d.id]).map((d) => [keptHashes[d.id], receiptEntry(d)]));
  const docStamps: Stamps = { ...asideDocs };
  for (const [p, st] of receipts ? Object.entries(merged.stamps) : []) {
    if (!p.startsWith('docs/')) continue;
    if (st.h === '-') {
      docStamps[p] = st;
      continue;
    }
    const here = heldAs.get(p.slice(5));
    if (!here) continue;
    const given = merged.entries.get(p) as ReceiptEntry | undefined;
    docStamps[p] = here.tx === given?.tx && here.accountNumber === given?.accountNumber ? stampAsHeld(st, here) : st;
  }
  // The receipts here changed: kept with their stamps at once — the vault's
  // still as it is on disk until the route saves the merged one.
  if (opts.checkpoint && (added || removed || relinked)) {
    const vaultStamps = Object.fromEntries(Object.entries(stamps).filter(([p]) => !p.startsWith('docs/')));
    await opts.checkpoint({ ...opts.local, stamps: { ...vaultStamps, ...docStamps }, uploaded: [...uploaded], hashes: keptHashes, removing: [...removing] });
  }

  // The vault: the merged entries as this device keeps them.
  const vaultOnly = new Map([...merged.entries].filter(([p]) => !p.startsWith('docs/')));
  const keepFrom = (m: ReadonlyMap<string, unknown>) => {
    const built = vaultFromEntries(m, vault);
    return opts.keep ? opts.keep(built) : built;
  };
  let next = keepFrom(vaultOnly);
  let full = 0;
  let asBefore = false;
  let excess = jsonBytes(next) - fill;
  if (excess > 0) {
    // Fuller than a round may fill it: what is new from the others is left
    // out, the oldest first, until it fits FILL_MAX of the limit — the rest
    // stays room for this device's own next edits. Not held here, it gets no
    // stamp — still theirs, never deleted — and the next round tries it again.
    const incoming = [...vaultOnly.keys()]
      .filter((p) => !had.has(p) && !moved.has(p))
      .sort((a, b) => merged.stamps[a].t - merged.stamps[b].t || (a < b ? -1 : a > b ? 1 : 0));
    const left = new Map(vaultOnly);
    let i = 0;
    while (excess > 0 && i < incoming.length) {
      while (excess > 0 && i < incoming.length) {
        const p = incoming[i++];
        excess -= entryBytes(p, left.get(p));
        left.delete(p);
        full++;
      }
      next = keepFrom(left);
      excess = jsonBytes(next) - fill;
    }
    // Still fuller (this device's own entries, the others' edits to them) is
    // kept while it can be saved at all.
    if (jsonBytes(next) > opts.maxBytes!) {
      // Even without anything new it does not fit (what the others changed
      // made it larger): the vault stays as it is, with its own stamps.
      asBefore = true;
      next = vault;
      full = 0;
      for (const [p, v] of vaultOnly) if (!had.has(p) || hashOf(had.get(p)) !== hashOf(v)) full++;
      for (const p of had.keys()) if (!vaultOnly.has(p)) full++;
      full = Math.max(full, 1);
    }
  }
  const sorted = (v: VaultData) => stableJson([...vaultEntries(v)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const changed = sorted(next) !== sorted(vault);

  // Stamps only for what this device really holds now. An entry the vault
  // did not keep gets none: it is not this device's to delete, and the next
  // round tries it again. A tombstone stays. What the keeping changed (a
  // field this version does not know, a clipped note) is stamped as kept
  // (`k`), at the time it had — never as this device's own change, stamped
  // anew every round and sent back and forth between devices that keep it
  // differently, and never a rival to the original it came as.
  const stampsNow: Stamps = { ...docStamps };
  if (asBefore) {
    for (const [p, st] of Object.entries(stamps)) if (!p.startsWith('docs/')) stampsNow[p] = st;
  } else {
    const held = vaultEntries(next);
    for (const [p, st] of Object.entries(merged.stamps)) {
      if (p.startsWith('docs/')) continue;
      if (st.h === '-') stampsNow[p] = st;
      else if (held.has(p)) stampsNow[p] = stampAsHeld(st, held.get(p));
    }
  }
  return {
    vault: changed ? next : vault,
    local: { stamps: stampsNow, uploaded: [...uploaded], hashes: keptHashes, ...(removing.size ? { removing: [...removing] } : {}) },
    changed,
    devices,
    receipts: { added, removed, relinked },
    full,
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

/** What the desktop app's shelf asks of every request (src-tauri/src/sync_lan.rs): from the key, never the key. */
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
