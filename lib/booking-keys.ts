// What the user files for one booking — its category, its split, its note,
// its receipts — hangs on the booking's key (lib/categories.ts txKey). The
// key used to be built on the first ten characters of the moment the fetching
// device made of the Buchungstag: its UTC date, so for an MT940 booking
// fetched on German time the day before, and another day again on a device
// elsewhere. It is built on the bank's own day now (lib/format.ts bankDay),
// and carries a mark in front (KEY_MARK), so a key from before can never be
// taken for one of now.
//
// The rule over all of this: an entry under a key from before is the user's
// until it has been moved. While it is not moved it is shown (the provider
// reads through `readMoves`, the same agreement without the waiting), and
// nothing deletes it that the user has not seen (the setters clear only what
// was shown for the booking: shownFrom).
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
//   - A key from before that names another day than the key now — by its own
//     first field, or by the day the moment was in Germany (a device outside
//     German time reads the slice differently) — waits until the days around
//     it are known for every account (`accounts`, which the provider makes
//     every account of every bank of the view, all logged in): a booking alike
//     in the rest, booked a day either side, may have had the same key from
//     before, at whatever bank. The key from before never named the account.
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
//   - Whatever is taken from a key from before keeps that entry's stamp, and
//     its deletion follows that stamp by half a millisecond (sync-entries.ts
//     moveMergedKeys): a device moving later never wins over an edit made
//     after the first move, and any later edit, on whatever clock, wins over
//     the deletion and is moved in its turn.
//   - Booking by booking while the notes stay within their cap (lib/notes.ts,
//     which would drop the oldest) and the vault within `maxBytes`; what does
//     not fit stays under its keys from before — still shown — and is logged.
//
// A moved entry carries the mark, so it is never moved again: the same
// answer however often this runs. Pure and one pass over the bookings: for
// `node --test`, the provider and the sync round.

import type { VaultData } from './app-types';
import type { KeptDoc } from './docs';
import { KEY_MARK, legacyTxKey, txKey, type KeyedBooking } from './categories.ts';
import { addDaysKey, bankDay, dayNumber } from './format.ts';
import { NOTE_LIMITS, sanitizeNotes } from './notes.ts';

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

const DAY_FIELD = /^\d{4}-\d{2}-\d{2}$/;
/** A key's day and the rest after it ('' for an undated key's day); null for no key of this shape. */
function splitKey(key: string): { day: string; rest: string } | null {
  const bar = key.indexOf('|');
  if (bar < 0) return null;
  const day = key.slice(0, bar);
  return day === '' || DAY_FIELD.test(day) ? { day, rest: key.slice(bar) } : null;
}

/**
 * Whether `from` → `to` can be a booking key move at all: a key from before
 * and one of now, of one booking (the same amount, counterparty and
 * reference), on days at most one apart. What a request may ask the sync
 * round to move (app/api/sync).
 */
export function validMove(from: string, to: string): boolean {
  if (!isLegacyKey(from) || isLegacyKey(to) || from.length > BOOKING_KEY_MAX || to.length > BOOKING_KEY_MAX) return false;
  const a = splitKey(from);
  const b = splitKey(to.slice(KEY_MARK.length));
  if (!a || !b || a.rest !== b.rest) return false;
  if (!a.day || !b.day) return a.day === b.day;
  return Math.abs(dayNumber(a.day) - dayNumber(b.day)) <= 1;
}

// A booking's keys and the day its moment was in Germany, worked out once
// per object: the lists hand the same bookings over again with every change.
const keysOf = new WeakMap<object, readonly [before: string, now: string, germanDay: string]>();
function bookingKeys(tx: KeyedBooking): readonly [string, string, string] {
  let keys = keysOf.get(tx);
  if (!keys) keysOf.set(tx, (keys = [legacyTxKey(tx), txKey(tx), bankDay({ entryDate: tx.entryDate, valueDate: tx.valueDate })]));
  return keys;
}

/**
 * The moves the known bookings allow, by the rules at the top of this file.
 * `accounts`: every account whose bookings must be known before a key from
 * before that names another day may move; left out, the accounts of
 * `groups`; an empty list waits for none (what the page reads through).
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
      const [old, key, germanDay] = bookingKeys(tx);
      if (!isLegacyKey(old)) continue; // no date makes one; never moved, whatever it is
      const day = key.slice(KEY_MARK.length, KEY_MARK.length + 10);
      const shifted = old.slice(0, 10) !== day || (DAY_FIELD.test(germanDay) && germanDay !== day);
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
    if (to === null || to.length > BOOKING_KEY_MAX) continue;
    if (shifted) {
      // A twin booked a day either side of the day the key from before names may have had it.
      const day = old.slice(0, 10);
      if (!DAY_FIELD.test(day) || ![-1, 0, 1].every((d) => known(addDaysKey(day, d)))) continue;
    }
    moves.set(old, { to });
  }
  return moves.size ? moves : NO_MOVES;
}

/** An entry's sync stamp (lib/sync-entries.ts Stamp): its time, and '-' as hash when it was deleted. */
export type EntryStamp = { h: string; t: number };

export type MoveOptions = {
  /** The sync stamps by path ("notes/<key>"); left out, the rules without stamps apply. */
  stamps?: Readonly<Record<string, EntryStamp>>;
  /** The most the vault may take as JSON afterwards; a booking whose move would make it larger waits. */
  maxBytes?: number;
  /** Only to show (the page reading through what is not moved yet): nothing is saved, so no cap applies. */
  display?: boolean;
};

/** One entry the plan writes under a key now (`from`: the key from before it came from). */
export type PlannedSet = { field: BookingMap; key: string; value: unknown; from: string };
/** One entry the plan deletes; `after`: under a key now, the key from before whose newer entry takes its place. */
export type PlannedDrop = { field: BookingMap; key: string; after?: string };
export type MovePlan = { set: PlannedSet[]; drop: PlannedDrop[] };

const has = (map: Record<string, unknown> | undefined, key: string) => !!map && Object.prototype.hasOwnProperty.call(map, key);
const utf8 = (s: string) => new TextEncoder().encode(s).length;
const jsonBytes = (v: unknown) => utf8(JSON.stringify(v));

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
    else if (has(maps[f], to)) plan.drop.push({ field: f, key: to, after: winner });
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

/** What a part of a plan adds to the vault's JSON, and to the notes as lib/notes.ts counts them — never less than it does. */
function growth(vault: VaultData, plan: MovePlan): { vault: number; notes: number } {
  let all = 0;
  let notes = 0;
  const placed = new Set(plan.set.filter((s) => !has(vault[s.field] as Record<string, unknown>, s.key)).map((s) => `${s.field}/${s.from}`));
  for (const s of plan.set) {
    const map = vault[s.field] as Record<string, unknown>;
    // Taken to a key now that is free: only the key changes. Else the value under it.
    const d = has(map, s.key) ? jsonBytes(s.value) - jsonBytes(map[s.key]) : jsonBytes(s.key) - jsonBytes(s.from);
    all += d;
    if (s.field === 'notes') notes += d;
  }
  for (const x of plan.drop) {
    if (placed.has(`${x.field}/${x.key}`)) continue;
    const value = (vault[x.field] as Record<string, unknown>)[x.key];
    // A deletion takes the key, its colon and the value; its comma is not counted, so the estimate stays high.
    all -= jsonBytes(x.key) + 1 + jsonBytes(value);
    if (x.field === 'notes') notes -= jsonBytes(x.key) + jsonBytes(value) + 2;
  }
  return { vault: all, notes };
}

/** The notes' bytes as lib/notes.ts caps them: `"key":"text",` each. */
const notesBytes = (notes: Record<string, string>) => Object.entries(notes).reduce((n, [k, t]) => n + jsonBytes(k) + jsonBytes(t) + 2, 0);

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
  // Booking by booking, part by part, while what it adds still fits.
  const notesRoom = opts.display ? Infinity : NOTE_LIMITS.bytes - notesBytes(vault.notes ?? {});
  let vaultRoom = opts.maxBytes === undefined ? Infinity : opts.maxBytes - jsonBytes(vault);
  let notesLeft = notesRoom;
  const accepted: MovePlan[] = [];
  let held = 0;
  for (const [to, from] of sources) {
    for (const fields of UNITS) {
      const part = planUnit(vault, fields, to, from, opts, position);
      if (!part.set.length && !part.drop.length) continue;
      const g = growth(vault, part);
      if (g.vault > vaultRoom || g.notes > notesLeft) {
        held++;
        continue;
      }
      vaultRoom -= g.vault;
      notesLeft -= g.notes;
      accepted.push(part);
    }
  }
  const join = (list: readonly MovePlan[]): MovePlan => ({ set: list.flatMap((p) => p.set), drop: list.flatMap((p) => p.drop) });
  let plan = join(accepted);
  let next = applyPlan(vault, plan);
  // The estimate is checked against the real thing; should it be off, the last bookings wait too.
  const fits = (v: VaultData) => !!opts.display || ((opts.maxBytes === undefined || jsonBytes(v) <= opts.maxBytes)
    && Object.keys(sanitizeNotes(v.notes)).length === Object.keys(v.notes ?? {}).length);
  while (accepted.length && !fits(next)) {
    accepted.pop();
    held++;
    plan = join(accepted);
    next = applyPlan(vault, plan);
  }
  if (held) console.warn(`[keys] ${held} booking part(s) left under their old keys for now: moved, the saved data would pass a limit`);
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
 * Which key from before each shown entry came from, by "field/key now" — for
 * a plan made only to show (the provider reads the vault through it). What
 * sets or clears a booking's entry clears these and only these: what the
 * user saw for it, never an entry from before they did not see.
 */
export function shownFrom(plan: MovePlan): (fields: readonly BookingMap[], key: string) => string[] {
  const from = new Map(plan.set.map((s) => [`${s.field}/${s.key}`, s.from]));
  return (fields, key) => [...new Set(fields.map((f) => from.get(`${f}/${key}`)).filter((k): k is string => !!k))];
}

/**
 * The moves a sync round takes along ([from, to]): only those whose key from
 * before has an entry in `vault` or ties one of `docs`, and no more than one
 * request carries beside the vault (app/api/sync: twice the vault's size in
 * all) — the rest go with the next round.
 */
export function movesInVault(
  vault: VaultData, moves: KeyMoves, max = { pairs: 1000, chars: 300_000 }, docs: readonly Pick<KeptDoc, 'kind' | 'tx'>[] = [],
): [string, string][] {
  const out: [string, string][] = [];
  if (!moves.size) return out;
  const seen = new Set<string>();
  let chars = 0;
  const keys = [
    ...BOOKING_MAPS.flatMap((field) => Object.keys((vault[field] ?? {}) as Record<string, unknown>)),
    ...docs.filter((d) => d.kind === 'receipt' && d.tx).map((d) => d.tx!),
  ];
  for (const k of keys) {
    const move = moves.get(k);
    if (!move || seen.has(k)) continue;
    chars += k.length + move.to.length + 8;
    if (out.length >= max.pairs || chars > max.chars) return out;
    seen.add(k);
    out.push([k, move.to]);
  }
  return out;
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
