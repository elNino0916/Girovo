// Umsätze kept on this computer — the pure part.
//
// A bank serves its Umsätze for a while (most for about 90 days without an
// approval, some for a year or two with one) and then not at all. With
// "Umsätze auf diesem Rechner behalten" switched on, every statement the bank
// delivers is folded into a history kept per login, sealed with the PIN next
// to the vault (lib/history-store.ts). Analyse, Verträge & Abos and the
// Kontoverlauf then reach further back than the session's own fetch, and a
// longer Zeitraum asks the bank only for what the history lacks.
//
// What is kept, per account:
//   - booked Umsätze, never Vorgemerkte: a Vormerkposten is not a booking
//     yet, and it would be counted twice once it is one;
//   - the coverage: the days the bank provably delivered complete. A day is
//     in the history whole or not at all, and every kept booking lies on a
//     covered day;
//   - the end-of-day balances the bank's own figures proved when the
//     bookings arrived (lib/balance-history.ts), so the Kontoverlauf can
//     stay checked over the kept days too.
//
// The merge rule is plain on purpose — the bank is authoritative for the days
// it delivered: a new answer replaces every kept booking of that account with
// a Buchungstag inside the delivered span, keeps the rest, and the coverage
// grows by exactly that span. No fuzzy dedupe: two identical bookings on one
// day are two bookings, and a reversal the bank sends is kept as the bank
// sent it. Being precise about the delivered span is what keeps this safe
// (deliveredSpan): a bank may deliver less than asked, and coverage must
// never claim a day the bank did not send — a claimed day would replace what
// was kept for it with nothing.
//
// Pure and node-test-safe like balance-history.ts: no path aliases, `.ts` on
// sibling imports, nothing that touches a file. The server merges on disk with
// these functions; the browser keeps a copy for the session with the very same
// ones, so both agree on what a list is made of.

import type { DateRange, StatementInfo } from './app-types';
import type { SerializedTransaction, StatementBlock } from './fints-types';
import { buildBalanceHistory, fail, type BalanceHistory, type BalancePoint } from './balance-history.ts';
import { addDaysKey, dayFromNumber, dayKey, dayNumber } from './format.ts';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** A run of whole local days, both ends included (yyyy-mm-dd). */
export type DaySpan = { from: string; to: string };

/** Proven end-of-day balances of consecutive days, in cents: `cents[i]` is the end of day `from` + i. */
export type BalanceRun = { from: string; cents: number[] };

/** One account's kept Umsätze. */
export type AccountHistory = {
  /** Booked Umsätze, newest first; each on a day of `coverage`. */
  txs: SerializedTransaction[];
  /** The days the bank delivered complete: sorted, disjoint, never adjacent. */
  coverage: DaySpan[];
  /** End-of-day balances the bank's figures proved when the bookings arrived. */
  balances: BalanceRun[];
};

/** A login's kept Umsätze, by account number. */
export type HistoryData = {
  version: 1;
  accounts: Record<string, AccountHistory>;
  /** ISO, set by the server on every write. */
  updatedAt: string;
};

export const EMPTY_HISTORY: HistoryData = { version: 1, accounts: {}, updatedAt: new Date(0).toISOString() };

/**
 * The /api/history `get` and `reset` answer. `data` is the history in its
 * compact form (compactHistory), null when none is kept yet — read it through
 * sanitizeHistory. A file this PIN cannot open is an error, never an empty
 * history.
 */
export type HistoryGetResponse =
  | { status: 'ready'; data: unknown }
  | { status: 'error'; reason: 'decrypt' | 'corrupt' };

/**
 * off         — not kept (the default), or no session
 * loading     — fetching after the login, or after it was switched on
 * ready       — kept, and the client holds a copy
 * error       — the file exists but this PIN cannot open it; nothing is kept
 *               until the user starts over (lib/history-store.ts resetHistory)
 * unavailable — the server could not be asked; this session keeps nothing
 */
export type HistoryStatus = 'off' | 'loading' | 'ready' | 'error' | 'unavailable';

/**
 * The part of a list that came from this computer (StatementInfo.saved). The
 * list's own `from` is where it starts; the saved part runs from there to `to`.
 */
export type SavedPart = {
  /** The last day the kept Umsätze fill in; the bank's answer covers what follows. */
  to: string;
  /** How many of the list's bookings came from this computer. */
  count: number;
  /**
   * The bank's answer as it came — exactly the bookings its statement blocks
   * add up, which is what the Kontoverlauf is proven from — or null when the
   * bank was not asked at all.
   */
  fetched: readonly SerializedTransaction[] | null;
  /** The proven end-of-day balances kept for the account. */
  balances: readonly BalanceRun[];
};

/**
 * Caps applied whenever a history is sanitised or merged. Generous for a
 * person, tight for a runaway file: over a cap the oldest days go, whole.
 */
export const HISTORY_LIMITS = {
  /** Plaintext ceiling of the whole (compacted) file. */
  bytes: 16 * 1024 * 1024,
  /** Bookings per account: ten years of a busy Girokonto. */
  bookings: 20_000,
  /** How far back a booking is kept: ten years, leap days included. */
  days: 3653,
  accounts: 50,
  /** Coverage spans per account; more means many small gaps, and the oldest go. */
  spans: 400,
  accountKey: 64,
  // String lengths in characters — a backstop against a broken file, far
  // above anything a bank sends, so real bank text is never cut.
  text: 2048,
  short: 256,
};

/** Re-fetched days before the coverage end: late bookings arrive with a Buchungstag in the past. */
export const OVERLAP_DAYS = 7;

/** The window most banks serve without an approval — and the app's default range (DEFAULT_STATEMENT_DAYS). */
export const FREE_WINDOW_DAYS = 90;

// ---------------------------------------------------------------------------
// Days and spans
// ---------------------------------------------------------------------------

/** Whether `s` is a real local day key ("2026-02-31" is not). */
export function isDay(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const n = dayNumber(s);
  return Number.isFinite(n) && dayFromNumber(n) === s;
}

/** A booking's Buchungstag as a local day key ('' when it has none). */
export function bookingDay(t: Pick<SerializedTransaction, 'entryDate' | 'valueDate'>): string {
  return dayKey(t.entryDate || t.valueDate);
}

const inSpan = (s: DaySpan, day: string) => day >= s.from && day <= s.to;
const minDay = (a: string, b: string) => (a < b ? a : b);

/** `spans` sorted and joined wherever they overlap or touch. */
export function unionSpans(spans: readonly DaySpan[]): DaySpan[] {
  const sorted = spans
    .filter((s) => isDay(s?.from) && isDay(s?.to) && s.from <= s.to)
    .map((s) => ({ from: s.from, to: s.to }))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const out: DaySpan[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.from <= addDaysKey(last.to, 1)) {
      if (s.to > last.to) last.to = s.to;
    } else {
      out.push(s);
    }
  }
  return out;
}

/** The span of `spans` that holds `day`, or null. */
export function spanAt(spans: readonly DaySpan[] | null | undefined, day: string): DaySpan | null {
  for (const s of spans ?? []) if (inSpan(s, day)) return s;
  return null;
}

/** Newest first by Buchungstag (then value date), like serializeTransactions hands them over. Stable. */
export function newestFirst<T extends Pick<SerializedTransaction, 'entryDate' | 'valueDate'>>(txs: readonly T[]): T[] {
  const time = (t: T) => {
    const v = new Date(t.entryDate || t.valueDate || 0).getTime();
    return Number.isNaN(v) ? 0 : v;
  };
  return txs
    .map((t, i) => ({ t, i, at: time(t) }))
    .sort((a, b) => b.at - a.at || a.i - b.i)
    .map((x) => x.t);
}

// ---------------------------------------------------------------------------
// Balances, as a day → cents map while they are worked on
// ---------------------------------------------------------------------------

function balanceMap(runs: readonly BalanceRun[] | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const run of runs ?? []) {
    let day = run.from;
    for (const c of run.cents) {
      out.set(day, c);
      day = addDaysKey(day, 1);
    }
  }
  return out;
}

/** End-of-day balances (day → cents) as runs of consecutive days. */
export function balanceRuns(map: ReadonlyMap<string, number>): BalanceRun[] {
  const days = [...map.keys()].sort();
  const out: BalanceRun[] = [];
  let run: BalanceRun | null = null;
  let prev = '';
  for (const day of days) {
    if (run && day === addDaysKey(prev, 1)) {
      run.cents.push(map.get(day)!);
    } else {
      run = { from: day, cents: [map.get(day)!] };
      out.push(run);
    }
    prev = day;
  }
  return out;
}

const cents = (v: number) => Math.round(v * 100);

// ---------------------------------------------------------------------------
// What the bank delivered
// ---------------------------------------------------------------------------

/**
 * The days an answer provably covers complete, or null when it vouches for
 * none. `asked` is what the bank was asked for, with `to` the last day meant
 * (today for an open end).
 *
 * The end is the newest day the answer itself speaks for — its latest
 * closing balance or booking — and never after `asked.to`. A bank that cuts a
 * long statement short ends early, and so does the coverage.
 *
 * The start is where the bank says it started. An opening balance dated on
 * or before the day asked for means the answer starts there. One dated later
 * means the bank keeps less (or sent less): the answer starts at that day if
 * it lists bookings on it (a start-of-day figure, CAMT's OPBD), else the day
 * after (an end-of-day figure, MT940's :60F:). Without any opening balance
 * only the bookings speak, and the answer starts at the first of them.
 * Erring late here only costs coverage; erring early would cost kept
 * bookings, which the merge would replace with nothing.
 */
export function deliveredSpan(input: {
  asked: DaySpan;
  txs: readonly SerializedTransaction[];
  blocks: readonly StatementBlock[];
  today: string;
}): DaySpan | null {
  const { asked, txs, blocks, today } = input;
  if (!isDay(asked?.from) || !isDay(asked?.to) || !isDay(today)) return null;
  const last = minDay(asked.to, today);

  let end = '';
  for (const b of blocks) {
    const d = b.closingBalance != null ? dayKey(b.closingDate) : '';
    if (d > end) end = d;
  }
  const days = txs.map(bookingDay);
  for (const d of days) if (d > end) end = d;
  if (!end) return null;
  const to = minDay(end, last);

  let opening = '';
  for (const b of blocks) {
    const d = b.openingBalance != null ? dayKey(b.openingDate) : '';
    if (d && (!opening || d < opening)) opening = d;
  }
  let from: string;
  if (opening) {
    if (opening <= asked.from) from = asked.from;
    else from = days.includes(opening) ? opening : addDaysKey(opening, 1);
  } else {
    const inside = days.filter((d) => d && d >= asked.from && d <= to).sort();
    if (!inside.length) return null;
    from = inside[0];
  }
  return from <= to ? { from, to } : null;
}

// ---------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------

const EMPTY_ACCOUNT: AccountHistory = { txs: [], coverage: [], balances: [] };

/** Everything before `cut` goes — bookings, coverage and balances alike. */
function trimBefore(h: AccountHistory, cut: string): AccountHistory {
  const txs = h.txs.filter((t) => bookingDay(t) >= cut);
  const coverage = h.coverage.flatMap((s) => (s.to < cut ? [] : [{ from: s.from < cut ? cut : s.from, to: s.to }]));
  const map = balanceMap(h.balances);
  for (const day of [...map.keys()]) if (day < cut) map.delete(day);
  return { txs: txs.length === h.txs.length ? h.txs : txs, coverage, balances: balanceRuns(map) };
}

/**
 * One account within its caps: ten years at most, and at most
 * HISTORY_LIMITS.bookings bookings. The oldest days go, and always whole — a
 * covered day must hold every booking of that day or none.
 */
export function capAccount(h: AccountHistory, today: string, limit = HISTORY_LIMITS.bookings): AccountHistory {
  let cut = addDaysKey(today, 1 - HISTORY_LIMITS.days);
  if (h.txs.length > limit) {
    const first = bookingDay(newestFirst(h.txs)[limit]);
    const after = addDaysKey(first, 1);
    if (after > cut) cut = after;
  }
  let spans = h.coverage;
  if (spans.length > HISTORY_LIMITS.spans) {
    const keepFrom = spans[spans.length - HISTORY_LIMITS.spans].from;
    if (keepFrom > cut) cut = keepFrom;
    spans = spans.slice(-HISTORY_LIMITS.spans);
  }
  return trimBefore({ ...h, coverage: spans }, cut);
}

/**
 * `prev` with one bank answer folded in, by the rule at the top of this file:
 * inside `delivery.span` the answer's bookings replace whatever was kept,
 * outside it nothing changes; the coverage grows by the span. Bookings of the
 * answer dated outside the span (a bank that filters by value date, one
 * ahead of today) are not kept — the days they fall on are not complete.
 *
 * The days of the span also take this answer's proven end-of-day balances
 * (lib/balance-history.ts), or lose the ones kept for them when this answer
 * proves none: a balance is kept only beside the bookings it was proven with.
 */
export function mergeDelivery(
  prev: AccountHistory | undefined,
  delivery: { span: DaySpan; txs: readonly SerializedTransaction[]; blocks: readonly StatementBlock[] },
  today: string,
): AccountHistory {
  const base = prev ?? EMPTY_ACCOUNT;
  const { span } = delivery;
  const kept = base.txs.filter((t) => !inSpan(span, bookingDay(t)));
  const added = delivery.txs.filter((t) => inSpan(span, bookingDay(t)));

  const map = balanceMap(base.balances);
  for (const day of [...map.keys()]) if (inSpan(span, day)) map.delete(day);
  const proof = buildBalanceHistory({ txs: delivery.txs, blocks: delivery.blocks, range: span });
  if (proof.verified) for (const p of proof.points) map.set(p.date, cents(p.balance));

  return capAccount({
    txs: newestFirst([...added, ...kept]),
    coverage: unionSpans([...base.coverage, span]),
    balances: balanceRuns(map),
  }, today);
}

// ---------------------------------------------------------------------------
// Asking the bank for less
// ---------------------------------------------------------------------------

/**
 * Where to ask the bank from for `want`, given what is kept — or null when
 * the kept Umsätze answer it alone.
 *
 *   - The kept days can only stand in from the start: when `want.from` is not
 *     covered, the bank is asked for everything.
 *   - Otherwise it is asked from the end of the kept run that holds the start,
 *     minus OVERLAP_DAYS (late bookings), and never later than the start of
 *     the window it serves without an approval: inside that window the bank
 *     stays the source every time, so a correction there is always seen, and
 *     the kept days only replace what would cost an approval.
 *   - A past range that the kept days hold entirely, before that window, needs
 *     no bank at all.
 */
export function planFetch(want: DateRange, coverage: readonly DaySpan[] | null | undefined, today: string): { from: string } | null {
  const run = spanAt(coverage, want.from);
  if (!run) return { from: want.from };
  const freeFrom = addDaysKey(today, -FREE_WINDOW_DAYS);
  const overlapFrom = addDaysKey(run.to, -OVERLAP_DAYS);
  const from = minDay(overlapFrom, freeFrom);
  if (from <= want.from) return { from: want.from };
  if (from > want.to) return null;
  return { from };
}

/**
 * "Alles Gespeicherte" for one account: from the start of the kept run that
 * reaches into the bank's free window — far enough (OVERLAP_DAYS) that the
 * fetch for it needs no approval — up to today. Null when nothing kept lies
 * before that window.
 */
export function savedPeriod(coverage: readonly DaySpan[] | null | undefined, today: string): DateRange | null {
  const freeFrom = addDaysKey(today, -FREE_WINDOW_DAYS);
  for (const s of coverage ?? []) {
    if (s.from < freeFrom && addDaysKey(s.to, -OVERLAP_DAYS) >= freeFrom) return { from: s.from, to: today };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The list a view shows
// ---------------------------------------------------------------------------

/**
 * What a list holds for `span`: the bank's answer for what it was asked
 * (from `fetchFrom` on), the kept Umsätze before that — never both for one
 * day. Bookings the bank sent for a day the kept part already holds whole are
 * left out (that day's complete list is the kept one); any other booking the
 * bank sent stays, as it always has.
 *
 * Without a kept part (none kept, or the kept days do not reach all the way
 * from `span.from`), the list is exactly the bank's answer.
 */
export function historyView(input: {
  span: DateRange;
  /** Where the bank was asked from; null when it was not asked. */
  fetchFrom: string | null;
  fetched: readonly SerializedTransaction[];
  history: AccountHistory | undefined;
}): { txs: SerializedTransaction[]; saved: SavedPart | null } {
  const { span, fetchFrom, fetched, history } = input;
  const savedTo = fetchFrom == null ? span.to : addDaysKey(fetchFrom, -1);
  const run = history && savedTo >= span.from ? spanAt(history.coverage, span.from) : null;
  if (!history || !run || run.to < savedTo) {
    return { txs: [...fetched], saved: null };
  }
  const part = (t: SerializedTransaction) => {
    const d = bookingDay(t);
    return d >= span.from && d <= savedTo;
  };
  const kept = history.txs.filter(part);
  return {
    txs: newestFirst([...fetched.filter((t) => !part(t)), ...kept]),
    saved: { to: savedTo, count: kept.length, fetched: fetchFrom == null ? null : fetched, balances: history.balances },
  };
}

/**
 * The Kontoverlauf of a list (buildBalanceHistory), carried back over its
 * kept part.
 *
 * The bank's answer is proven on its own, exactly as without kept Umsätze.
 * From the first day it covers, the walk goes back a day at a time through
 * the list's bookings, and each day must land on the balance kept for it —
 * proven by the bank's figures when that day was delivered. The first day
 * without a kept balance, or whose balance disagrees by a cent, ends the walk
 * there: what is drawn is checked against the bank's own figures all the way.
 * A list made of kept Umsätze alone is anchored on the balance kept for its
 * last day.
 */
export function accountBalanceHistory(txs: readonly SerializedTransaction[], info: StatementInfo): BalanceHistory {
  const range = { from: info.from, to: info.to };
  const saved = info.saved;
  if (!saved) return buildBalanceHistory({ txs, blocks: info.blocks, range });

  const fresh = saved.fetched ? buildBalanceHistory({ txs: saved.fetched, blocks: info.blocks, range }) : null;
  if (fresh && !fresh.verified) return fresh;

  const currency = fresh?.verified ? fresh.currency : txs.find((t) => t.currency)?.currency || 'EUR';
  if (txs.some((t) => (t.currency || currency) !== currency)) return fail('currencies');

  const net = new Map<string, number>();
  for (const t of txs) {
    const d = bookingDay(t);
    net.set(d, (net.get(d) ?? 0) + cents(Number(t.amount)));
  }
  const kept = balanceMap(saved.balances);

  // Where the walk starts: the end of the kept part, as the bank's answer
  // puts it (the balance at the end of its first day, less that day's
  // bookings), or as kept for it when the bank was not asked.
  let tail: BalancePoint[] = [];
  let day: string;
  let balance: number | undefined;
  if (fresh?.verified) {
    const first = addDaysKey(saved.to, 1);
    const at = fresh.points.findIndex((p) => p.date === first);
    // The proof does not reach back to where the kept part ends: nothing to join.
    if (at < 0) return fresh;
    tail = fresh.points.slice(at);
    day = saved.to;
    balance = cents(tail[0].balance) - (net.get(first) ?? 0);
  } else {
    day = info.to;
    balance = kept.get(day);
    if (balance === undefined) return fail('unverified');
  }

  const head: BalancePoint[] = [];
  while (day >= info.from && kept.get(day) === balance) {
    head.push({ date: day, balance: balance / 100 });
    balance -= net.get(day) ?? 0;
    day = addDaysKey(day, -1);
  }
  if (!head.length) return fresh ?? fail('unverified');

  const points = [...head.reverse(), ...tail];
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.balance < min) min = p.balance;
    if (p.balance > max) max = p.balance;
  }
  return {
    verified: true,
    points,
    min,
    max,
    currency,
    from: points[0].date,
    to: points[points.length - 1].date,
    blocks: fresh?.verified ? fresh.blocks : 0,
  };
}

/** Per account, the days kept — what the Zeitraum control plans with (planFetch, savedPeriod). */
export function historyCoverage(data: HistoryData | null | undefined): Record<string, DaySpan[]> {
  const out: Record<string, DaySpan[]> = {};
  for (const [acct, h] of Object.entries(data?.accounts ?? {})) if (h.coverage.length) out[acct] = h.coverage;
  return out;
}

// ---------------------------------------------------------------------------
// Sanitisation, and the compact form on disk and on the wire
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/** Whether `k` can serve as an account key. Keys are never clipped — a shortened key is a different account. */
const keyOk = (k: unknown): k is string =>
  typeof k === 'string' && k.length > 0 && k.length <= HISTORY_LIMITS.accountKey && k !== '__proto__' && !CONTROLS.test(k);

type TextField = Exclude<{
  [K in keyof SerializedTransaction]-?: SerializedTransaction[K] extends string | undefined ? K : never;
}[keyof SerializedTransaction], 'currency'>;

/** Every text field of a booking, and how long it may be. */
const TEXT_FIELDS: ReadonlyArray<[TextField, number]> = [
  ['purpose', HISTORY_LIMITS.text],
  ['bookingText', HISTORY_LIMITS.short],
  ['remoteName', HISTORY_LIMITS.short],
  ['remoteIban', HISTORY_LIMITS.short],
  ['remoteBic', HISTORY_LIMITS.short],
  ['creditorId', HISTORY_LIMITS.short],
  ['ultimateName', HISTORY_LIMITS.short],
  ['e2eReference', HISTORY_LIMITS.short],
  ['mandateReference', HISTORY_LIMITS.short],
  ['customerReference', HISTORY_LIMITS.short],
  ['bankReference', HISTORY_LIMITS.short],
  ['transactionCode', HISTORY_LIMITS.short],
  ['primeNotesNr', HISTORY_LIMITS.short],
  ['textKeyExtension', HISTORY_LIMITS.short],
  ['additionalInformation', HISTORY_LIMITS.text],
  ['statementNumber', HISTORY_LIMITS.short],
];

/** Bank text kept verbatim — only a string, and only up to `max` characters (by code point). */
function bankText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  if (v.length <= max) return v;
  return Array.from(v).slice(0, max).join('');
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/**
 * A date as the wire carries it: the very string when it is one (a booking's
 * txKey reads its first ten characters, so it must come back unchanged), else
 * the instant re-written as ISO; '' when it is no date.
 */
function dateText(v: unknown): string {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString();
  if (typeof v !== 'string' || v.length > 40) return '';
  if (ISO_INSTANT.test(v) || isDay(v)) return Number.isNaN(Date.parse(v)) ? '' : v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? '' : new Date(t).toISOString();
}

/** One booking as this version understands it, or null when it is none (no day, no amount). */
export function sanitizeBooking(v: unknown): SerializedTransaction | null {
  if (!isRecord(v)) return null;
  const entryDate = dateText(v.entryDate);
  const valueDate = dateText(v.valueDate);
  if (!entryDate && !valueDate) return null;
  const amount = v.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || Math.abs(amount) >= 1e13) return null;
  const tx = {
    valueDate,
    entryDate,
    amount,
    currency: typeof v.currency === 'string' && /^[A-Z]{3}$/.test(v.currency) ? v.currency : 'EUR',
  } as SerializedTransaction;
  for (const [field, max] of TEXT_FIELDS) tx[field] = bankText(v[field], max);
  return bookingDay(tx) ? tx : null;
}

/** A booking for disk and wire: empty texts left out (sanitizeBooking puts them back). */
export function compactBooking(t: SerializedTransaction): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(t)) if (v !== '' && v != null) out[k] = v instanceof Date ? v.toISOString() : v;
  return out;
}

/** The whole history in its compact form — what is sealed on disk and sent to the browser. */
export function compactHistory(data: HistoryData): unknown {
  const accounts: Record<string, unknown> = {};
  for (const [acct, h] of Object.entries(data.accounts)) {
    accounts[acct] = { txs: h.txs.map(compactBooking), coverage: h.coverage, balances: h.balances };
  }
  return { version: 1, accounts, updatedAt: data.updatedAt };
}

function sanitizeAccount(v: unknown, today: string): AccountHistory | null {
  if (!isRecord(v)) return null;
  const coverage = unionSpans(Array.isArray(v.coverage) ? v.coverage.filter(isRecord) as DaySpan[] : []);
  if (!coverage.length) return null;
  const covered = (day: string) => !!spanAt(coverage, day);

  const txs: SerializedTransaction[] = [];
  for (const raw of Array.isArray(v.txs) ? v.txs : []) {
    const t = sanitizeBooking(raw);
    if (t && covered(bookingDay(t))) txs.push(t);
  }

  const map = new Map<string, number>();
  for (const run of Array.isArray(v.balances) ? v.balances : []) {
    if (!isRecord(run) || !isDay(run.from) || !Array.isArray(run.cents)) continue;
    let day = run.from;
    for (const c of run.cents.slice(0, HISTORY_LIMITS.days + 1)) {
      if (Number.isSafeInteger(c) && covered(day)) map.set(day, c as number);
      day = addDaysKey(day, 1);
    }
  }

  return capAccount({ txs: newestFirst(txs), coverage, balances: balanceRuns(map) }, today);
}

const textBytes = (s: string) => new TextEncoder().encode(s).length;

/**
 * Keeps the whole file under HISTORY_LIMITS.bytes: while it is over, the
 * account with the most bookings gives up the oldest quarter of them.
 */
export function capHistory(data: HistoryData, today: string, maxBytes = HISTORY_LIMITS.bytes): HistoryData {
  let accounts = data.accounts;
  for (;;) {
    if (textBytes(JSON.stringify(compactHistory({ ...data, accounts }))) <= maxBytes) break;
    let biggest: string | null = null;
    for (const [acct, h] of Object.entries(accounts)) {
      if (h.txs.length && (!biggest || h.txs.length > accounts[biggest].txs.length)) biggest = acct;
    }
    if (!biggest) {
      // Nothing left to drop but the coverage and balances themselves.
      accounts = {};
      break;
    }
    const h = accounts[biggest];
    const sorted = newestFirst(h.txs);
    const cut = addDaysKey(bookingDay(sorted[Math.floor((sorted.length * 3) / 4)]), 1);
    accounts = { ...accounts, [biggest]: trimBefore(h, cut) };
  }
  return accounts === data.accounts ? data : { ...data, accounts };
}

/**
 * The history as this version understands it, or null when `input` is not
 * one at all. Unknown keys go, texts are checked, every booking must lie on a
 * covered day and every balance too, and the caps apply (ten years, the
 * booking count, the byte ceiling). Applied on the way in and out — what a
 * future version wrote must never reach a view in a shape this one does not
 * know.
 */
export function sanitizeHistory(input: unknown, today: string): HistoryData | null {
  if (!isRecord(input) || input.version !== 1) return null;
  const accounts: Record<string, AccountHistory> = {};
  if (isRecord(input.accounts)) {
    for (const [acct, raw] of Object.entries(input.accounts)) {
      if (Object.keys(accounts).length >= HISTORY_LIMITS.accounts) break;
      if (!keyOk(acct)) continue;
      const h = sanitizeAccount(raw, today);
      if (h) accounts[acct] = h;
    }
  }
  const at = typeof input.updatedAt === 'string' && !Number.isNaN(Date.parse(input.updatedAt))
    ? new Date(Date.parse(input.updatedAt)).toISOString()
    : EMPTY_HISTORY.updatedAt;
  return capHistory({ version: 1, accounts, updatedAt: at }, today);
}

/**
 * `data` with one account's bank answer folded in (mergeDelivery), the caps
 * applied. The answer's bookings are taken as they are — sanitise first what
 * did not come straight from this app's own server.
 */
export function mergeIntoHistory(
  data: HistoryData,
  account: string,
  delivery: { span: DaySpan; txs: readonly SerializedTransaction[]; blocks: readonly StatementBlock[] },
  today: string,
): HistoryData {
  if (!keyOk(account)) return data;
  if (!data.accounts[account] && Object.keys(data.accounts).length >= HISTORY_LIMITS.accounts) return data;
  const merged = mergeDelivery(data.accounts[account], delivery, today);
  return capHistory({ ...data, accounts: { ...data.accounts, [account]: merged } }, today);
}

/**
 * The days `other` covers that `base` does not, as spans: what a restored
 * backup or an imported file may add without touching a day the bank (or an
 * earlier copy) already delivered complete.
 */
export function uncoveredSpans(base: readonly DaySpan[], other: readonly DaySpan[]): DaySpan[] {
  const out: DaySpan[] = [];
  for (const span of unionSpans(other)) {
    let from = span.from;
    for (const kept of unionSpans(base)) {
      if (kept.to < from || kept.from > span.to) continue;
      if (kept.from > from) out.push({ from, to: addDaysKey(kept.from, -1) });
      from = addDaysKey(kept.to, 1);
      if (from > span.to) break;
    }
    if (from <= span.to) out.push({ from, to: span.to });
  }
  return out;
}

/**
 * `base` with the days only `other` covers added — their bookings and their
 * proven balances, whole days as always. A day `base` covers stays exactly as
 * it is: what was kept there came from the bank (or is newer), and is never
 * replaced by a copy. Used for a restored backup (lib/backup.ts) and for an
 * imported export of the bank's online banking (lib/bank-import.ts).
 */
export function fillGaps(base: AccountHistory | undefined, other: AccountHistory, today: string): AccountHistory {
  const current = base ?? EMPTY_ACCOUNT;
  const gaps = uncoveredSpans(current.coverage, other.coverage);
  if (!gaps.length) return current;
  const inGap = (day: string) => gaps.some((g) => inSpan(g, day));
  const map = balanceMap(current.balances);
  for (const [day, c] of balanceMap(other.balances)) if (inGap(day)) map.set(day, c);
  return capAccount({
    txs: newestFirst([...current.txs, ...other.txs.filter((t) => inGap(bookingDay(t)))]),
    coverage: unionSpans([...current.coverage, ...gaps]),
    balances: balanceRuns(map),
  }, today);
}

/** `data` with every account of `other` gap-filled in (fillGaps), the caps applied. Answers how many days were added. */
export function fillHistoryGaps(data: HistoryData, other: HistoryData, today: string): { data: HistoryData; days: number; bookings: number } {
  let accounts = data.accounts;
  let days = 0;
  let bookings = 0;
  for (const [acct, h] of Object.entries(other.accounts)) {
    if (!keyOk(acct)) continue;
    if (!accounts[acct] && Object.keys(accounts).length >= HISTORY_LIMITS.accounts) continue;
    const before = accounts[acct];
    const gaps = uncoveredSpans(before?.coverage ?? [], h.coverage);
    if (!gaps.length) continue;
    const merged = fillGaps(before, h, today);
    days += gaps.reduce((n, g) => n + dayNumber(g.to) - dayNumber(g.from) + 1, 0);
    bookings += merged.txs.length - (before?.txs.length ?? 0);
    accounts = { ...accounts, [acct]: merged };
  }
  if (accounts === data.accounts) return { data, days: 0, bookings: 0 };
  return { data: capHistory({ ...data, accounts }, today), days, bookings };
}
