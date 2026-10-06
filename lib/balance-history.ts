// The Kontoverlauf: the balance at the end of every day of the loaded range —
// but only when the bank's own figures prove it.
//
// A balance history is easy to fake by accident. Walk back from today's
// balance through the bookings and any booking the bank left out, any
// duplicate, any block in another currency silently bends every point before
// it, and the chart still looks perfectly plausible. So nothing is drawn on
// trust. Every statement block carries the bank's opening and closing balance;
// each block's bookings must carry its opening exactly onto its closing, and
// each block must open where the one before it closed. Only a chain that
// holds end to end — no missing balance, no gap, no stray cent — becomes a
// chart. Anything else returns `verified: false` with a reason in plain words
// (lib/i18n, read when it is read) for the quiet note that replaces the chart.
//
// Given a verified chain, the series is anchored on the newest closing
// balance and walked back by local Buchungstag: the balance at the end of day
// d is the anchor minus every booking dated after d. Days without bookings
// are points too — the line stays flat rather than skipping them.
//
// Pure and node-test-safe: no path aliases, `.ts` on sibling imports.

import type { SerializedTransaction, StatementBlock } from './fints-types';
import type { DateRange } from './app-types';
import { addDaysKey, dayKey, dayNumber } from './format.ts';
import { msgs, type Messages } from './i18n/index.ts';

export type BalancePoint = {
  /** Local yyyy-mm-dd. */
  date: string;
  /** End-of-day balance by Buchungstag. */
  balance: number;
};

export type BalanceHistory =
  | {
      verified: true;
      /** One per day, oldest first, no gaps. */
      points: BalancePoint[];
      min: number;
      max: number;
      currency: string;
      /** The days the points actually cover — inside the range, possibly shorter. */
      from: string;
      to: string;
      /** How many statement blocks the proof rests on. */
      blocks: number;
    }
  | { verified: false; reason: string };

/** Hard stop for a malformed range; a decade of daily points is already plenty. */
const MAX_DAYS = 4000;

const cents = (v: number) => Math.round(v * 100);

type Reason = keyof Messages['insights']['balanceHistory'];

/** No history, and why — the words read where they are shown, so they follow the language. */
const fail = (reason: Reason): BalanceHistory => ({
  verified: false,
  get reason() {
    return msgs().insights.balanceHistory[reason];
  },
});

type Block = {
  open: number;
  close: number;
  openDay: string;
  closeDay: string;
  count: number;
  index: number;
};

type Booking = { day: string; cents: number; index: number };

type Proof = {
  /** Balance after every booking that counts towards it, in cents. */
  anchor: number;
  anchorDay: string;
  included: Booking[];
  /** Forward-dated bookings the newest closing balance does not contain. */
  excluded: Booking[];
  /** The bookings of each block, in block order — the assignment that added up. */
  assigned: readonly Booking[][];
};

/**
 * Bookings to blocks by date: each booking goes to the first block whose
 * closing day it does not lie after; bookings dated beyond the newest block
 * go to it (that is where a bank lists a forward-dated booking). Accepted
 * only if every block then holds exactly the count the bank stated.
 */
function assignByDate(blocks: readonly Block[], bookings: readonly Booking[]): Booking[][] | null {
  const out = blocks.map((): Booking[] => []);
  for (const b of bookings) {
    let k = blocks.findIndex((blk) => b.day <= blk.closeDay);
    if (k < 0) k = blocks.length - 1;
    out[k].push(b);
  }
  return out.every((list, k) => list.length === blocks[k].count) ? out : null;
}

/**
 * Bookings to blocks by count: oldest first, the stated number of bookings
 * per block in block order. Covers blocks that share a closing day, which a
 * date alone cannot separate.
 */
function assignByCount(blocks: readonly Block[], bookings: readonly Booking[]): Booking[][] {
  const sorted = [...bookings].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.index - b.index));
  const out: Booking[][] = [];
  let at = 0;
  for (const blk of blocks) {
    out.push(sorted.slice(at, at + blk.count));
    at += blk.count;
  }
  return out;
}

/**
 * Checks one assignment of bookings to blocks. Each block's bookings must turn
 * its opening into its closing, to the cent.
 *
 * The newest block gets one allowance. A statement fetched over a weekend can
 * list a booking the bank has already dated to Monday while stating the
 * closing balance as of today; whether that closing contains the booking
 * depends on the bank. If the sum only works out without the bookings dated
 * after the closing day, those were not part of it — they are set aside and
 * the series stops the day before the first of them, since no figure the
 * bank sent covers what comes after.
 */
function prove(blocks: readonly Block[], assigned: readonly Booking[][]): Proof | null {
  const last = blocks.length - 1;
  let excluded: Booking[] = [];
  for (let k = 0; k <= last; k++) {
    const blk = blocks[k];
    const members = assigned[k];
    const sum = members.reduce((s, b) => s + b.cents, 0);
    if (blk.open + sum === blk.close) continue;
    if (k === last) {
      const ahead = members.filter((b) => b.day > blk.closeDay);
      const aheadSum = ahead.reduce((s, b) => s + b.cents, 0);
      if (ahead.length && blk.open + sum - aheadSum === blk.close) {
        excluded = ahead;
        continue;
      }
    }
    return null;
  }
  const skip = new Set(excluded);
  return {
    anchor: blocks[last].close,
    anchorDay: blocks[last].closeDay,
    included: assigned.flat().filter((b) => !skip.has(b)),
    excluded,
    assigned,
  };
}

/** Chronological block order: by closing day, then opening day, then as the bank sent them. */
function orderBlocks(blocks: Block[]): Block[] {
  const sorted = [...blocks].sort(
    (a, b) =>
      (a.closeDay < b.closeDay ? -1 : a.closeDay > b.closeDay ? 1 : 0) ||
      (a.openDay < b.openDay ? -1 : a.openDay > b.openDay ? 1 : 0) ||
      a.index - b.index,
  );
  // Blocks closing on the same day cannot be ordered by date. Within such a
  // run, follow the balances instead: the next block is the one that opens
  // where the previous one closed.
  const out: Block[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j].closeDay === sorted[i].closeDay) j++;
    const run = sorted.slice(i, j);
    while (run.length) {
      const prevClose = out.length ? out[out.length - 1].close : null;
      let pick = prevClose == null ? -1 : run.findIndex((b) => b.open === prevClose);
      if (pick < 0) {
        // The run's head: the block no other block in the run closes onto.
        pick = run.findIndex((b) => !run.some((o) => o !== b && o.close === b.open));
        if (pick < 0) pick = 0;
      }
      out.push(run.splice(pick, 1)[0]);
    }
    i = j;
  }
  return out;
}

/**
 * The verified end-of-day balance for every day of `range`, or the reason
 * there is none.
 *
 * `txs` must be exactly the bookings of the statement `blocks` were taken
 * from — one account, one fetch, nothing pending — which is what the provider
 * keeps per account.
 */
export function buildBalanceHistory(input: {
  txs: readonly SerializedTransaction[];
  blocks: readonly StatementBlock[] | null | undefined;
  range: DateRange;
}): BalanceHistory {
  const from = dayKey(input.range?.from);
  const to = dayKey(input.range?.to);
  if (!from || !to || from > to) return fail('invalidRange');

  const raw = input.blocks ?? [];
  if (!raw.length) return fail('noBalances');
  if (raw.some((b) => b.openingBalance == null || b.closingBalance == null || !b.openingDate || !b.closingDate)) {
    return fail('missingBalances');
  }
  const currency = raw[0].currency || 'EUR';
  if (raw.some((b) => (b.currency || 'EUR') !== currency) || input.txs.some((t) => (t.currency || currency) !== currency)) {
    return fail('currencies');
  }

  const blocks = orderBlocks(
    raw.map((b, index) => ({
      open: cents(b.openingBalance as number),
      close: cents(b.closingBalance as number),
      openDay: dayKey(b.openingDate),
      closeDay: dayKey(b.closingDate),
      count: Math.max(0, Math.trunc(b.count) || 0),
      index,
    })),
  );
  if (blocks.some((b) => !b.openDay || !b.closeDay)) {
    return fail('missingBalances');
  }

  for (let k = 1; k < blocks.length; k++) {
    if (blocks[k].open !== blocks[k - 1].close) {
      return fail('gap');
    }
  }

  const bookings: Booking[] = input.txs.map((t, index) => ({
    day: dayKey(t.entryDate || t.valueDate),
    cents: cents(Number(t.amount)),
    index,
  }));
  if (bookings.some((b) => !b.day || !Number.isFinite(b.cents))) {
    return fail('badBooking');
  }
  if (blocks.reduce((s, b) => s + b.count, 0) !== bookings.length) {
    return fail('count');
  }

  const byDate = assignByDate(blocks, bookings);
  const proof = (byDate && prove(blocks, byDate)) || prove(blocks, assignByCount(blocks, bookings));
  if (!proof) return fail('sum');

  // Adding up is not enough: the walk-back hangs every booking on its date, so
  // each date must lie inside the statement block the booking belongs to — not
  // before the block opens, and, but for the newest block's forward-dated
  // bookings, not after it closes. MT940 sends the Buchungstag without a year;
  // a booking from 2 January whose value date is 31 December can come back
  // dated 2 January of the *previous* year. Its block still sums to the cent,
  // yet the walk-back would never reach that day and every point would carry
  // the booking — the curve would contradict the bank's own opening balance.
  const last = blocks.length - 1;
  if (proof.assigned.some((list, k) => list.some((b) => b.day < blocks[k].openDay || (k < last && b.day > blocks[k].closeDay)))) {
    return fail('dates');
  }

  // Where the bank's figures start to cover the account. An opening balance
  // dated the day before the first booking (MT940 :60F:, CAMT PRCD) covers
  // that day's end; one dated the first booking day itself (CAMT OPBD) is a
  // start-of-day figure and so covers the end of the day before.
  const first = blocks[0];
  const covered = proof.assigned[0].some((b) => b.day === first.openDay) ? addDaysKey(first.openDay, -1) : first.openDay;
  // The balance at the end of that day is the anchor minus every booking
  // after it, and that must be the bank's first opening balance — which holds
  // only if no booking is dated on or before it. Blocks that overlap in time
  // could still put one there.
  if (proof.included.some((b) => b.day <= covered)) {
    return fail('dates');
  }

  let end = to;
  if (proof.excluded.length) {
    const firstAhead = proof.excluded.reduce((d, b) => (b.day < d ? b.day : d), proof.excluded[0].day);
    const stop = addDaysKey(firstAhead, -1);
    if (stop < end) end = stop;
  }
  const start = covered > from ? covered : from;
  if (start > end) return fail('unverified');
  const span = dayNumber(end) - dayNumber(start) + 1;
  if (span > MAX_DAYS) return fail('tooLong');

  // Walk back from the anchor: first everything dated after the last point,
  // then one day at a time.
  const netByDay = new Map<string, number>();
  let after = 0;
  for (const b of proof.included) {
    if (b.day > end) after += b.cents;
    else netByDay.set(b.day, (netByDay.get(b.day) ?? 0) + b.cents);
  }
  let balance = proof.anchor - after;
  const points: BalancePoint[] = new Array(span);
  let min = Infinity;
  let max = -Infinity;
  for (let i = span - 1, day = end; i >= 0; i--, day = addDaysKey(day, -1)) {
    points[i] = { date: day, balance: balance / 100 };
    if (balance < min) min = balance;
    if (balance > max) max = balance;
    balance -= netByDay.get(day) ?? 0;
  }

  return { verified: true, points, min: min / 100, max: max / 100, currency, from: start, to: end, blocks: blocks.length };
}
