// Sync between devices (6.0, lib/sync.ts): the vault as single entries, and
// how two devices' entries become one.
//
// The vault keeps no times per note or rule, so a device keeps its own: for
// each entry a hash of what it was at the last sync and when that changed
// (`Stamps`). At a sync, an entry that differs from its hash changed now; one
// that is gone was deleted now (a tombstone). Each device's state file holds
// every entry with its time; per entry, the newest change wins — on a tie,
// the device with the larger id, so every device picks the same one.
//
// What a device decides for itself is never an entry: whether it keeps its
// Umsätze or balances (keepBookings, keepBalances). Receipts are entries too
// (`docs/<content hash>`), their bytes travel beside (lib/sync.ts).

import crypto from 'node:crypto';
import type { VaultData } from './app-types';

/** What one entry was at the last sync on this device: its hash ('-' deleted) and since when. */
export type Stamp = { h: string; t: number };
export type Stamps = Record<string, Stamp>;

/** An entry in a device's state file: its value, or that it was deleted, and when. */
export type SyncEntry = { t: number; v?: unknown; d?: 1 };

/** A tombstone is kept this long, then forgotten: every device has seen it by then. */
export const TOMBSTONE_MS = 180 * 86_400_000;

type MapField = 'aliases' | 'categoryRules' | 'txCategories' | 'splits' | 'budgets' | 'notes' | 'keptBalances';
const MAPS: readonly MapField[] = ['aliases', 'categoryRules', 'txCategories', 'splits', 'budgets', 'notes', 'keptBalances'];
const SCALARS = ['avatar', 'avatarImage', 'accountGrouping', 'accountOrder'] as const;

/** How each list's members are told apart. */
const LISTS = {
  templates: (t: { id: string }) => t.id,
  customCategories: (c: { id: string }) => c.id,
  goals: (g: { accountNumber: string }) => g.accountNumber,
  netWorth: (d: { day: string }) => d.day,
  sentOrders: (o: { at: string; iban: string; cents: number; kind?: string }) => `${o.at}|${o.iban}|${o.cents}|${o.kind ?? ''}`,
  linkedBanks: (l: { blz: string; userId: string }) => `${l.blz}|${l.userId}`,
} as const;
type ListField = keyof typeof LISTS;

/** JSON with keys in one order, so the same value hashes the same on every device. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export const hashOf = (v: unknown): string => crypto.createHash('sha256').update(stableJson(v)).digest('hex').slice(0, 16);

/** The vault as entries, by path ("notes/<txKey>", "templates/<id>", "avatar", …). */
export function vaultEntries(v: VaultData): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const field of MAPS) {
    for (const [k, value] of Object.entries((v[field] ?? {}) as Record<string, unknown>)) out.set(`${field}/${k}`, value);
  }
  for (const field of Object.keys(LISTS) as ListField[]) {
    const idOf = LISTS[field] as (x: unknown) => string;
    for (const item of ((v[field] ?? []) as unknown[])) out.set(`${field}/${idOf(item)}`, item);
  }
  for (const id of v.dismissedRecurring ?? []) out.set(`dismissedRecurring/${id}`, true);
  for (const field of SCALARS) if (v[field] !== undefined) out.set(field, v[field]);
  return out;
}

const byKey = <T>(key: (x: T) => string) => (a: T, b: T) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);

/**
 * The vault the entries describe — what this device decides for itself taken
 * from `base`, lists in a stable order (the base's first, where it has one).
 */
export function vaultFromEntries(entries: ReadonlyMap<string, unknown>, base: VaultData): VaultData {
  const maps: Record<string, Record<string, unknown>> = Object.fromEntries(MAPS.map((f) => [f, {}]));
  const lists: Record<string, unknown[]> = Object.fromEntries(Object.keys(LISTS).map((f) => [f, []]));
  const dismissed: string[] = [];
  const scalars: Record<string, unknown> = {};
  for (const [path, value] of entries) {
    const slash = path.indexOf('/');
    const field = slash < 0 ? path : path.slice(0, slash);
    const key = slash < 0 ? '' : path.slice(slash + 1);
    if (field in maps) maps[field][key] = value;
    else if (field in lists) lists[field].push(value);
    else if (field === 'dismissedRecurring') dismissed.push(key);
    else if ((SCALARS as readonly string[]).includes(field)) scalars[field] = value;
  }
  /** The base's members first, as they stood, then the new ones by id. */
  const ordered = <T>(field: ListField, items: T[]): T[] => {
    const idOf = LISTS[field] as (x: T) => string;
    const pos = new Map(((base[field] ?? []) as T[]).map((x, i) => [idOf(x), i]));
    return [...items].sort((a, b) => {
      const pa = pos.get(idOf(a));
      const pb = pos.get(idOf(b));
      if (pa !== undefined && pb !== undefined) return pa - pb;
      if (pa !== undefined) return -1;
      if (pb !== undefined) return 1;
      return byKey(idOf)(a, b);
    });
  };
  const out: VaultData = {
    version: 1,
    templates: ordered('templates', lists.templates as VaultData['templates']),
    aliases: maps.aliases as VaultData['aliases'],
    categoryRules: maps.categoryRules as VaultData['categoryRules'],
    txCategories: maps.txCategories as VaultData['txCategories'],
    customCategories: ordered('customCategories', lists.customCategories as VaultData['customCategories']),
    splits: maps.splits as VaultData['splits'],
    dismissedRecurring: [...(base.dismissedRecurring ?? []).filter((d) => dismissed.includes(d)), ...dismissed.filter((d) => !(base.dismissedRecurring ?? []).includes(d)).sort()],
    budgets: maps.budgets as VaultData['budgets'],
    notes: maps.notes as VaultData['notes'],
    sentOrders: (lists.sentOrders as VaultData['sentOrders']).sort(byKey((o) => o.at)),
    updatedAt: base.updatedAt,
  };
  if (scalars.avatar !== undefined) out.avatar = scalars.avatar as VaultData['avatar'];
  if (scalars.avatarImage !== undefined) out.avatarImage = scalars.avatarImage as string;
  if (lists.linkedBanks.length) out.linkedBanks = ordered('linkedBanks', lists.linkedBanks as NonNullable<VaultData['linkedBanks']>);
  if (base.keepBookings) out.keepBookings = true;
  // This device's view (Konten als Ebenen), never another's.
  if (base.accountsHidden?.length) out.accountsHidden = base.accountsHidden;
  if (lists.goals.length) out.goals = ordered('goals', lists.goals as NonNullable<VaultData['goals']>);
  if (scalars.accountOrder !== undefined) out.accountOrder = scalars.accountOrder as string[];
  if (scalars.accountGrouping !== undefined) out.accountGrouping = scalars.accountGrouping as VaultData['accountGrouping'];
  if (base.keepBalances === false) {
    out.keepBalances = false;
  } else {
    if (Object.keys(maps.keptBalances).length) out.keptBalances = maps.keptBalances as NonNullable<VaultData['keptBalances']>;
    if (lists.netWorth.length) out.netWorth = (lists.netWorth as NonNullable<VaultData['netWorth']>).sort(byKey((d) => d.day));
  }
  return out;
}

/**
 * This device's stamps brought up to date with what it has now: an entry
 * that differs from its stamp changed `now`, one that is gone was deleted
 * `now`. Tombstones older than TOMBSTONE_MS are forgotten.
 */
export function restamp(entries: ReadonlyMap<string, unknown>, stamps: Stamps, now: number): Stamps {
  const out: Stamps = {};
  // A change is newer than what it changes, even when another device's clock
  // ran ahead and stamped that later than this device's now.
  const after = (s: Stamp | undefined) => (s ? Math.max(now, s.t + 1) : now);
  for (const [path, value] of entries) {
    const h = hashOf(value);
    out[path] = stamps[path]?.h === h ? stamps[path] : { h, t: after(stamps[path]) };
  }
  for (const [path, s] of Object.entries(stamps)) {
    if (entries.has(path)) continue;
    const tomb = s.h === '-' ? s : { h: '-', t: after(s) };
    if (now - tomb.t < TOMBSTONE_MS) out[path] = tomb;
  }
  return out;
}

/** Another device's state, as its file holds it. */
export type RemoteState = { device: string; entries: Record<string, SyncEntry> };

/**
 * One set of entries from this device's and the others': per entry the
 * newest change wins, a tie goes to the larger device id. Answers the
 * entries now (deleted ones gone), the stamps to keep, and the state file to
 * write — every entry with its time, tombstones included.
 */
export function mergeEntries(
  local: ReadonlyMap<string, unknown>, stamps: Stamps, device: string, remotes: readonly RemoteState[], now: number,
): { entries: Map<string, unknown>; stamps: Stamps; state: Record<string, SyncEntry> } {
  type Candidate = { t: number; dev: string; deleted: boolean; v?: unknown };
  const best = new Map<string, Candidate>();
  const offer = (path: string, c: Candidate) => {
    const cur = best.get(path);
    if (!cur || c.t > cur.t || (c.t === cur.t && c.dev > cur.dev)) best.set(path, c);
  };
  for (const [path, s] of Object.entries(stamps)) {
    offer(path, { t: s.t, dev: device, deleted: s.h === '-', v: local.get(path) });
  }
  for (const r of remotes) {
    for (const [path, e] of Object.entries(r.entries)) {
      if (!e || typeof e.t !== 'number' || !Number.isFinite(e.t)) continue;
      offer(path, { t: e.t, dev: r.device, deleted: e.d === 1, v: e.v });
    }
  }
  const entries = new Map<string, unknown>();
  const kept: Stamps = {};
  const state: Record<string, SyncEntry> = {};
  for (const [path, c] of best) {
    if (c.deleted) {
      if (now - c.t >= TOMBSTONE_MS) continue;
      kept[path] = { h: '-', t: c.t };
      state[path] = { t: c.t, d: 1 };
      continue;
    }
    entries.set(path, c.v);
    kept[path] = { h: hashOf(c.v), t: c.t };
    state[path] = { t: c.t, v: c.v };
  }
  return { entries, stamps: kept, state };
}
