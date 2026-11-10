// What the user files for one booking — its category, its split, its note,
// its receipts — hangs on the booking's key (lib/categories.ts txKey). The
// key used to be built on the first ten characters of the moment the fetching
// device made of the Buchungstag: its UTC date, so for an MT940 booking
// fetched on German time the day before, and another day again on a device
// elsewhere. It is built on the bank's own day now (lib/format.ts bankDay),
// and carries a mark in front (KEY_MARK), so a key from before can never be
// taken for one of now. This moves what was filed under a key from before to
// the key its booking has now, whenever bookings become known (the provider:
// kept Umsätze loaded, a statement read, a file imported).
//
// Every key without the mark is one from before. Each known booking says
// which key from before it had (legacyTxKey) and which it has now; an entry
// under a key from before moves to the key now of the booking that had it:
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
//     key now (MT940 on German time: the day before) while that day is not
//     among the days known for its account (BookingGroup.covers). A camt
//     booking of that day, alike in the rest, would have had the same key
//     from before — and is not there to be seen.
//   - Not to a key longer than the vault keeps (BOOKING_KEY_MAX): the save
//     would drop the entry.
//
// An entry that is not moved stays where it is: nothing is deleted on a
// guess. Where the key now already has an entry, that one stands and the one
// from before goes. A moved entry carries the mark, so it is never moved
// again: the same answer however often this runs.
//
// Pure and one pass over the bookings: for `node --test` and for the
// provider, on every list it gets.

import type { VaultData } from './app-types';
import type { KeptDoc } from './docs';
import { KEY_MARK, legacyTxKey, txKey, type KeyedBooking } from './categories.ts';

/** The vault's maps keyed by txKey — every one of them. */
export const BOOKING_MAPS = ['txCategories', 'splits', 'notes'] as const satisfies readonly (keyof VaultData)[];

/** The longest map key the vault keeps (lib/vault.ts VAULT_LIMITS.key, lib/notes.ts, lib/splits.ts). */
export const BOOKING_KEY_MAX = 200;

/** Bookings that became known together: one account's list, the kept Umsätze of one, a list of Vorgemerkte. */
export type BookingGroup = {
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

/** The moves the known bookings allow, by the rules at the top of this file. */
export function keyMoves(groups: readonly BookingGroup[]): KeyMoves {
  /**
   * By key from before: its key now (null: the bookings that had it
   * disagree), and whether a list that holds one of them knows the day it
   * names — one such list is enough: a twin on that day would be in it.
   */
  const before = new Map<string, { to: string | null; known: boolean }>();
  for (const group of groups) {
    for (const tx of group.txs) {
      const [old, key] = bothKeys(tx);
      if (!isLegacyKey(old)) continue; // no date makes one; never moved, whatever it is
      // The day the key from before names, where it is not the bank's: a twin booked on it must be visible.
      const day = old.slice(0, 10);
      const known = day === key.slice(KEY_MARK.length, KEY_MARK.length + 10) || !group.covers || group.covers(day);
      const seen = before.get(old);
      if (!seen) before.set(old, { to: key, known });
      else {
        if (seen.to !== key) seen.to = null;
        if (known) seen.known = true;
      }
    }
  }
  if (!before.size) return NO_MOVES;
  const moves = new Map<string, KeyMove>();
  for (const [old, { to, known }] of before) {
    if (to !== null && known && to.length <= BOOKING_KEY_MAX) moves.set(old, { to });
  }
  return moves.size ? moves : NO_MOVES;
}

/** One map with its entries moved, in their places (the caps keep the last ones); the same object when none moved. */
function moved<T>(map: Record<string, T> | undefined, moves: KeyMoves): Record<string, T> | undefined {
  if (!map) return map;
  const keys = Object.keys(map);
  if (!keys.some((k) => moves.has(k))) return map;
  const taken = new Set(keys);
  const out: [string, T][] = [];
  for (const k of keys) {
    const move = moves.get(k);
    if (!move) out.push([k, map[k]]);
    else if (!taken.has(move.to)) {
      taken.add(move.to);
      out.push([move.to, map[k]]);
    }
    // else: the entry under the key now stands, the one from before goes.
  }
  return Object.fromEntries(out) as Record<string, T>;
}

/**
 * `vault` with what is filed per booking moved as `moves` say. The same
 * object when nothing moved, so a caller can skip the save.
 */
export function moveEntries(vault: VaultData, moves: KeyMoves): VaultData {
  if (!moves.size) return vault;
  let next = vault;
  for (const field of BOOKING_MAPS) {
    const was = vault[field] as Record<string, unknown> | undefined;
    const map = moved(was, moves);
    if (map !== was) next = { ...next, [field]: map };
  }
  return next;
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
