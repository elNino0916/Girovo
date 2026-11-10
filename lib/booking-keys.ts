// What the user files for one booking — its category, its split, its note,
// its receipts — hangs on the booking's key (lib/categories.ts txKey). The
// key used to be built on the first ten characters of the moment the fetching
// device made of the Buchungstag: its UTC date, so for an MT940 booking
// fetched on German time the day before, and another day again on a device
// elsewhere. It is built on the bank's own day now (lib/format.ts bankDay),
// and carries a mark in front (KEY_MARK), so a key from before can never be
// taken for one of now. This moves what was filed under a key from before to
// the key its booking has now, whenever bookings become known (the provider:
// kept Umsätze loaded, a statement read, a file imported). With sync on it
// runs inside a sync round, after the merge, where every entry's stamp is
// known (lib/sync.ts); otherwise on the page, without stamps.
//
// Which keys move (keyMoves). Every key without the mark is one from before.
// Each known booking says which key from before it had (legacyTxKey) and
// which it has now; an entry under a key from before moves to the key now of
// the booking that had it:
//
//   - Only where the known bookings with that key from before all have one
//     key now. Where they have several — a camt booking and an MT940 booking
//     of the next day alike in amount, counterparty and reference, whose
//     keys from before were the same — the entry may be either one's, and
//     nothing in it says which: it is not moved. Bookings alike in every
//     part of the key on one day had one key before and have one key now,
//     so their entry moves: both showed it before, both show it after. (The
//     same goes for one booking seen twice, kept and fetched anew.)
//   - Not for a booking whose key from before names another day than its
//     key now (MT940 on German time: the day before) unless that day is known
//     for every account (`accounts`: every account of a logged-in bank whose
//     Umsätze can be read): a camt booking of that day, alike in the rest,
//     would have had the same key from before — at whatever bank — and must
//     be there to be seen. The key from before never named the account.
//   - Not to a key longer than the vault keeps (BOOKING_KEY_MAX).
//
// What happens to the entries (planMoves). Per booking, its category and its
// split count as one — the two exclude each other, and a split is read first
// — and its note by itself:
//
//   - Several keys from before may lead to one booking (kept as MT940,
//     fetched as camt). Of their entries one is taken: with stamps the
//     newest, without them the last in the map (an edit is written at the
//     end), a split before a category.
//   - The booking already has an entry under its key now: without stamps
//     that one stands and those from before go. With stamps the newer one
//     stands: an entry from before stamped later is an edit made by a device
//     still on the version before, after this device moved — it replaces the
//     one under the key now. A deletion under the key now counts with its
//     stamp too: what the user took off later does not come back.
//   - Whatever is taken from a key from before keeps that entry's stamp
//     (lib/sync.ts), so a device moving later never wins over an edit made
//     after the first move; the keys from before are deleted (a tombstone).
//   - A move that would push the notes over their cap (lib/notes.ts, which
//     would drop the oldest) or the vault over its size (`maxBytes`) is not
//     made for that part: it stays under the keys from before, and that is
//     logged.
//
// An entry that is not moved stays where it is: nothing is deleted on a
// guess. A moved entry carries the mark, so it is never moved again: the same
// answer however often this runs.
//
// Pure and one pass over the bookings: for `node --test`, the provider and
// the sync round.

import type { VaultData } from './app-types';
import type { KeptDoc } from './docs';
import { KEY_MARK, legacyTxKey, txKey, type KeyedBooking } from './categories.ts';
import { sanitizeNotes } from './notes.ts';

/** The vault's maps keyed by txKey — every one of them. */
export const BOOKING_MAPS = ['txCategories', 'splits', 'notes'] as const satisfies readonly (keyof VaultData)[];
export type BookingMap = (typeof BOOKING_MAPS)[number];

/** The parts of a booking's entries that move together: its category with its split, and its note. */
const UNITS: readonly (readonly BookingMap[])[] = [['txCategories', 'splits'], ['notes']];

/** The longest map key the vault keeps (lib/vault.ts VAULT_LIMITS.key, lib/notes.ts, lib/splits.ts). */
export const BOOKING_KEY_MAX = 200;

/** The most the vault may take as JSON (lib/vault.ts VAULT_LIMITS.bytes, which refuses to save more). */
export const VAULT_MAX_BYTES = 512 * 1024;

/** Bookings that became known together: one account's list, the kept Umsätze of one, a list of Vorgemerkte. */
export type BookingGroup = {
  /** The account they belong to; left out, the group stands for an account of its own. */
  account?: string;
  txs: readonly KeyedBooking[];
  /**
   * Whether the bookings of `day` (yyyy-mm-dd) are among `txs`, if the bank
   * had any: the fetched period, the kept days. Left out, every day counts
   * as known — for a list that is whole by itself.
   */
  covers?: (day: string) => boolean;
};

/** Where an entry filed under a key from before goes. */
export type KeyMove = { to: string };
export type KeyMoves = ReadonlyMap<string, KeyMove>;

const NO_MOVES: KeyMoves = new Map();

/** Whether `key` is one from before the mark — the only kind ever moved. */
export const isLegacyKey = (key: string) => !key.startsWith(KEY_MARK);

// A booking's two keys, worked out once per object: the lists hand the same
// bookings over again with every change, thousands of them.
const keysOf = new WeakMap<object, readonly [before: string, now: string]>();
function bothKeys(tx: KeyedBooking): readonly [string, string] {
  let pair = keysOf.get(tx);
  if (!pair) keysOf.set(tx, (pair = [legacyTxKey(tx), txKey(tx)]));
  return pair;
}

/**
 * The moves the known bookings allow, by the rules at the top of this file.
 * `accounts`: every account whose bookings must be known before a key from
 * before that names another day may move; left out, the accounts of `groups`.
 */
export function keyMoves(groups: readonly BookingGroup[], opts: { accounts?: readonly string[] } = {}): KeyMoves {
  const byAccount = new Map<string, BookingGroup[]>();
  groups.forEach((g, i) => {
    const id = g.account ?? `\u0000${i}`;
    const list = byAccount.get(id);
    if (list) list.push(g);
    else byAccount.set(id, [g]);
  });
  const accounts = opts.accounts ?? [...byAccount.keys()];
  const knownDays = new Map<string, boolean>();
  /** Whether every account's bookings of `day` are known. */
  const known = (day: string) => {
    let k = knownDays.get(day);
    if (k === undefined) {
      k = accounts.every((a) => (byAccount.get(a) ?? []).some((g) => !g.covers || g.covers(day)));
      knownDays.set(day, k);
    }
    return k;
  };
  /** By key from before: its key now (null: the bookings that had it disagree), and whether it names another day. */
  const before = new Map<string, { to: string | null; shifted: boolean }>();
  for (const group of groups) {
    for (const tx of group.txs) {
      const [old, key] = bothKeys(tx);
      if (!isLegacyKey(old)) continue; // no date makes one; never moved, whatever it is
      const shifted = old.slice(0, 10) !== key.slice(KEY_MARK.length, KEY_MARK.length + 10);
      const seen = before.get(old);
      if (!seen) before.set(old, { to: key, shifted });
      else {
        if (seen.to !== key) seen.to = null;
        if (shifted) seen.shifted = true;
      }
    }
  }
  if (!before.size) return NO_MOVES;
  const moves = new Map<string, KeyMove>();
  for (const [old, { to, shifted }] of before) {
    // The day a twin booked on it would have had this key from before by: the key's own first field.
    if (to !== null && to.length <= BOOKING_KEY_MAX && (!shifted || known(old.slice(0, 10)))) moves.set(old, { to });
  }
  return moves.size ? moves : NO_MOVES;
}

/** An entry's sync stamp (lib/sync-entries.ts Stamp): its time, and '-' as hash when it was deleted. */
export type EntryStamp = { h: string; t: number };

export type MoveOptions = {
  /** The sync stamps by path ("notes/<key>"); left out, the rules without stamps apply. */
  stamps?: Readonly<Record<string, EntryStamp>>;
  /** The most the vault may take as JSON afterwards; a part that would make it larger is not moved. */
  maxBytes?: number;
};

/** One entry the plan writes under a key now (`from`: the key from before it came from). */
export type PlannedSet = { field: BookingMap; key: string; value: unknown; from: string };
export type MovePlan = { set: PlannedSet[]; drop: { field: BookingMap; key: string }[] };

const has = (map: Record<string, unknown> | undefined, key: string) => !!map && Object.prototype.hasOwnProperty.call(map, key);
const utf8 = (s: string) => new TextEncoder().encode(s).length;

/** The plan for one part of one booking's entries, as the rules at the top of this file say. */
function planUnit(
  vault: VaultData, fields: readonly BookingMap[], to: string, sources: readonly string[], opts: MoveOptions,
  position: (field: BookingMap, key: string) => number,
): MovePlan {
  const maps = Object.fromEntries(fields.map((f) => [f, vault[f] as Record<string, unknown> | undefined])) as Record<BookingMap, Record<string, unknown> | undefined>;
  const from = sources.filter((k) => fields.some((f) => has(maps[f], k)));
  const plan: MovePlan = { set: [], drop: [] };
  if (!from.length) return plan;
  const stamps = opts.stamps;
  const stampOf = (key: string, present: boolean): number | undefined => {
    let best: number | undefined;
    for (const f of fields) {
      if (present && !has(maps[f], key)) continue;
      const t = stamps?.[`${f}/${key}`]?.t;
      if (t !== undefined && (best === undefined || t > best)) best = t;
    }
    return best;
  };
  // Without stamps: a split before a category, then the later in its map.
  const rank = (key: string) => {
    const f = fields.find((x) => x === 'splits' && has(maps[x], key)) ?? fields.find((x) => has(maps[x], key))!;
    return (f === 'splits' ? 1e9 : 0) + position(f, key);
  };
  const score = (key: string) => (stamps ? (stampOf(key, true) ?? -Infinity) : 0);
  const winner = from.reduce((a, b) => (score(b) > score(a) || (score(b) === score(a) && rank(b) > rank(a)) ? b : a));
  for (const k of from) for (const f of fields) if (has(maps[f], k)) plan.drop.push({ field: f, key: k });
  const taken = fields.some((f) => has(maps[f], to));
  const takenAt = stamps ? stampOf(to, false) : undefined;
  // The entry under the key now stands: it is there and no stamp says the one
  // from before is newer — or a deletion there is at least as new.
  const stands = stamps ? (takenAt !== undefined ? takenAt >= score(winner) : taken) : taken;
  if (stands) return plan;
  for (const f of fields) {
    if (has(maps[f], winner)) plan.set.push({ field: f, key: to, value: maps[f]![winner], from: winner });
    else if (has(maps[f], to)) plan.drop.push({ field: f, key: to });
  }
  return plan;
}

/** `vault` with `plan` carried out: an entry taken to a key now goes where the one it came from was. */
function applyPlan(vault: VaultData, plan: MovePlan): VaultData {
  if (!plan.set.length && !plan.drop.length) return vault;
  let next = vault;
  for (const field of BOOKING_MAPS) {
    const sets = plan.set.filter((s) => s.field === field);
    const drops = new Set(plan.drop.filter((d) => d.field === field).map((d) => d.key));
    if (!sets.length && !drops.size) continue;
    const map = (vault[field] ?? {}) as Record<string, unknown>;
    const replace = new Map(sets.filter((s) => has(map, s.key)).map((s) => [s.key, s.value]));
    const placeAt = new Map(sets.filter((s) => !has(map, s.key)).map((s) => [s.from, s]));
    const out: [string, unknown][] = [];
    for (const [k, v] of Object.entries(map)) {
      const placed = placeAt.get(k);
      if (placed) out.push([placed.key, placed.value]);
      else if (replace.has(k)) out.push([k, replace.get(k)]);
      else if (!drops.has(k)) out.push([k, v]);
    }
    next = { ...next, [field]: Object.fromEntries(out) };
  }
  return next;
}

/**
 * What moving `moves` does to `vault`, by the rules at the top of this file:
 * the plan (for the sync round, which stamps it) and the vault afterwards —
 * the same object when nothing moves.
 */
export function planMoves(vault: VaultData, moves: KeyMoves, opts: MoveOptions = {}): { vault: VaultData; plan: MovePlan } {
  const empty = { vault, plan: { set: [], drop: [] } as MovePlan };
  if (!moves.size) return empty;
  // The keys from before present, by the key now they lead to, and every key's place in its map.
  const sources = new Map<string, string[]>();
  const positions = new Map<string, number>();
  for (const field of BOOKING_MAPS) {
    const keys = Object.keys((vault[field] ?? {}) as Record<string, unknown>);
    keys.forEach((k, i) => {
      positions.set(`${field}/${k}`, i);
      const move = moves.get(k);
      if (!move) return;
      const list = sources.get(move.to);
      if (!list) sources.set(move.to, [k]);
      else if (!list.includes(k)) list.push(k);
    });
  }
  if (!sources.size) return empty;
  const position = (field: BookingMap, key: string) => positions.get(`${field}/${key}`) ?? -1;
  // Per part, so a part that would overflow is left out whole.
  const parts = UNITS.map((fields) => {
    const plan: MovePlan = { set: [], drop: [] };
    for (const [to, from] of sources) {
      const p = planUnit(vault, fields, to, from, opts, position);
      plan.set.push(...p.set);
      plan.drop.push(...p.drop);
    }
    return { fields, plan };
  });
  const kept = parts.filter(({ fields, plan }) => {
    if (!fields.includes('notes') || !plan.set.length) return true;
    const notes = applyPlan(vault, plan).notes;
    if (Object.keys(sanitizeNotes(notes)).length === Object.keys(notes).length) return true;
    console.warn(`[keys] ${plan.set.length} note(s) left under their old keys: moved, the notes would pass their cap`);
    return false;
  });
  const join = (list: typeof parts): MovePlan => ({ set: list.flatMap((p) => p.plan.set), drop: list.flatMap((p) => p.plan.drop) });
  let plan = join(kept);
  let next = applyPlan(vault, plan);
  if (opts.maxBytes !== undefined) {
    // The notes first, then the categories: until it fits, or nothing moves.
    const left = [...kept];
    while (left.length && utf8(JSON.stringify(next)) > opts.maxBytes) {
      const gone = left.splice(left.length - 1, 1)[0];
      console.warn(`[keys] ${gone.plan.set.length + gone.plan.drop.length} change(s) to ${gone.fields.join('/')} left for later: the vault would pass its size`);
      plan = join(left);
      next = applyPlan(vault, plan);
    }
  }
  return plan.set.length || plan.drop.length ? { vault: next, plan } : empty;
}

/**
 * `vault` with what is filed per booking moved as `moves` say. The same
 * object when nothing moved, so a caller can skip the save.
 */
export function moveEntries(vault: VaultData, moves: KeyMoves, opts: MoveOptions = {}): VaultData {
  return planMoves(vault, moves, opts).vault;
}

/**
 * `vault` with everything filed under the key from before of one of
 * `bookings` moved to the key it has now — `bookings` taken as all there is
 * to know. The provider, which knows the fetched periods, uses keyMoves and
 * moveEntries themselves.
 */
export function migrateBookingKeys(vault: VaultData, bookings: readonly KeyedBooking[]): VaultData {
  return moveEntries(vault, keyMoves([{ txs: bookings }]));
}

/**
 * The moves a sync round takes along ([from, to]): only those whose key from
 * before has an entry in `vault`, and no more than one request carries
 * beside the vault (app/api/sync: twice the vault's size in all) — the rest
 * go with the next round.
 */
export function movesInVault(vault: VaultData, moves: KeyMoves, max = { pairs: 1000, chars: 300_000 }): [string, string][] {
  const out: [string, string][] = [];
  if (!moves.size) return out;
  const seen = new Set<string>();
  let chars = 0;
  for (const field of BOOKING_MAPS) {
    for (const k of Object.keys((vault[field] ?? {}) as Record<string, unknown>)) {
      const move = moves.get(k);
      if (!move || seen.has(k)) continue;
      chars += k.length + move.to.length + 8;
      if (out.length >= max.pairs || chars > max.chars) return out;
      seen.add(k);
      out.push([k, move.to]);
    }
  }
  return out;
}

// The keys from before that lead to each key now, worked out once per set of moves.
const reverseOf = new WeakMap<KeyMoves, Map<string, string[]>>();

/**
 * The keys from before a booking may still have entries under: its own, and
 * every other that `moves` lead to its key now. What sets or clears an entry
 * of the booking clears these too, so one from before never comes back over
 * it — as clearing did in the version before, where every booking with that
 * key showed the entry.
 */
export function legacyKeysOf(tx: KeyedBooking, moves: KeyMoves): string[] {
  let reverse = reverseOf.get(moves);
  if (!reverse) {
    reverse = new Map();
    for (const [old, { to }] of moves) {
      const list = reverse.get(to);
      if (list) list.push(old);
      else reverse.set(to, [old]);
    }
    reverseOf.set(moves, reverse);
  }
  const [own, now] = bothKeys(tx);
  return [...new Set([...(isLegacyKey(own) ? [own] : []), ...(reverse.get(now) ?? [])])];
}

/** `map` without `keys`; the same object when it has none of them. */
export function dropKeys<T>(map: Record<string, T>, keys: readonly string[]): Record<string, T> {
  if (!keys.some((k) => has(map, k))) return map;
  const out = { ...map };
  for (const k of keys) delete out[k];
  return out;
}

/**
 * The receipts among `docs` still tied to a booking by its key from before,
 * with the key to tie each to (lib/doc-store.ts linkReceipt). A booking may
 * have several receipts, so none gives way to another.
 */
export function receiptMoves<D extends Pick<KeptDoc, 'kind' | 'tx'>>(docs: readonly D[], moves: KeyMoves): { doc: D; tx: string }[] {
  if (!moves.size) return [];
  const out: { doc: D; tx: string }[] = [];
  for (const doc of docs) {
    const move = doc.kind === 'receipt' && doc.tx ? moves.get(doc.tx) : undefined;
    if (move) out.push({ doc, tx: move.to });
  }
  return out;
}
