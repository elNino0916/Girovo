import './__fixtures__/tz.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SerializedTransaction, StatementBlock } from './fints-types';
import type { StatementInfo } from './app-types';
import type { Session } from './session';
import { block, mt940, newestFirst } from './__fixtures__/transactions.ts';

// STATE_DIR is read when state-store.ts loads, so the scratch directory has to
// be in place before the first import of the store (and of the vault, whose
// choice it reads).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fints-history-'));
process.env.FINTS_STATE_DIR = dir;
const h = await import('./history.ts');
const store = await import('./history-store.ts');
const vault = await import('./vault.ts');
const { EMPTY_VAULT } = await import('./app-types.ts');
const { sealWithPin } = await import('./crypto-box.ts');

after(() => fs.rmSync(dir, { recursive: true, force: true }));

const TODAY = '2026-10-06';

/** A booking on `day`; `n` tells bookings of one day apart. */
const tx = (day: string, amount: number, n = 1, over: Partial<SerializedTransaction> = {}): SerializedTransaction => ({
  ...mt940({ day, amount, name: `Gegenpartei ${n}`, purpose: `Zweck ${day} ${n}`, gvc: '105', text: 'BASISLASTSCHRIFT' }),
  ...over,
});

/**
 * A bank answer for [from, to] as one MT940 block: the opening balance dated
 * the day before `from`, the closing on `to`, the bookings adding up.
 */
function answer(from: string, to: string, txs: SerializedTransaction[], opening = 1000): { txs: SerializedTransaction[]; blocks: StatementBlock[] } {
  const sum = txs.reduce((s, t) => s + Math.round(t.amount * 100), 0);
  return {
    txs: newestFirst(txs),
    blocks: [block({ open: opening, openDay: h.isDay(from) ? addDays(from, -1) : null, close: (Math.round(opening * 100) + sum) / 100, closeDay: to, count: txs.length })],
  };
}

const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return x.toISOString().slice(0, 10);
};

const days = (list: readonly SerializedTransaction[]) => list.map((t) => h.bookingDay(t));

// ---------------------------------------------------------------------------
// Spans
// ---------------------------------------------------------------------------

test('spans are joined where they overlap or touch, and broken ones dropped', () => {
  assert.deepEqual(h.unionSpans([
    { from: '2026-05-01', to: '2026-05-10' },
    { from: '2026-05-11', to: '2026-05-20' },
    { from: '2026-04-01', to: '2026-04-05' },
    { from: '2026-05-15', to: '2026-05-30' },
    { from: '2026-02-31', to: '2026-03-02' },
    { from: '2026-06-02', to: '2026-06-01' },
  ]), [
    { from: '2026-04-01', to: '2026-04-05' },
    { from: '2026-05-01', to: '2026-05-30' },
  ]);
});

// ---------------------------------------------------------------------------
// What the bank delivered
// ---------------------------------------------------------------------------

test('a full answer covers what was asked, up to its last balance or booking', () => {
  const a = answer('2026-07-08', TODAY, [tx('2026-07-10', -5), tx('2026-10-05', -7)]);
  assert.deepEqual(h.deliveredSpan({ asked: { from: '2026-07-08', to: TODAY }, ...a, today: TODAY }), { from: '2026-07-08', to: TODAY });
});

test('a statement cut short covers only the days it reaches', () => {
  // The bank answered with the oldest slice: its closing is from August.
  const a = answer('2026-07-08', '2026-08-20', [tx('2026-07-10', -5), tx('2026-08-20', -7)]);
  assert.deepEqual(h.deliveredSpan({ asked: { from: '2026-07-08', to: TODAY }, ...a, today: TODAY }), { from: '2026-07-08', to: '2026-08-20' });
});

test('a booking dated ahead never stretches the coverage past the day asked for', () => {
  const a = answer('2026-09-01', '2026-10-03', [tx('2026-09-10', -5), tx('2026-10-09', -64.18)]);
  assert.equal(h.deliveredSpan({ asked: { from: '2026-09-01', to: '2026-10-03' }, ...a, today: TODAY })?.to, '2026-10-03');
  assert.equal(h.deliveredSpan({ asked: { from: '2026-09-01', to: TODAY }, ...a, today: TODAY })?.to, TODAY);
});

test('a bank that keeps less than asked: the coverage starts where its figures start', () => {
  const txs = [tx('2025-10-10', -5), tx('2026-01-02', -7)];
  // An end-of-day opening balance dated 9 October 2025: the answer starts the 10th.
  const mt = { txs, blocks: [block({ open: 100, openDay: '2025-10-09', close: 88, closeDay: TODAY, count: 2 })] };
  assert.equal(h.deliveredSpan({ asked: { from: '2024-10-06', to: TODAY }, ...mt, today: TODAY })?.from, '2025-10-10');
  // A start-of-day balance dated on a day with bookings (CAMT's OPBD) includes that day.
  const camt = { txs, blocks: [block({ open: 100, openDay: '2025-10-10', close: 88, closeDay: TODAY, count: 2, camt: true })] };
  assert.equal(h.deliveredSpan({ asked: { from: '2024-10-06', to: TODAY }, ...camt, today: TODAY })?.from, '2025-10-10');
  // An opening dated before the start asked for (a quiet account): the answer starts at the start asked for.
  const quiet = { txs, blocks: [block({ open: 100, openDay: '2024-09-01', close: 88, closeDay: TODAY, count: 2 })] };
  assert.equal(h.deliveredSpan({ asked: { from: '2024-10-06', to: TODAY }, ...quiet, today: TODAY })?.from, '2024-10-06');
});

test('without an opening balance only the bookings speak; without anything nothing is covered', () => {
  const txs = [tx('2026-08-03', -5), tx('2026-09-01', -7)];
  const noOpening = { txs, blocks: [block({ open: null, openDay: null, close: 88, closeDay: TODAY, count: 2 })] };
  assert.deepEqual(h.deliveredSpan({ asked: { from: '2026-07-08', to: TODAY }, ...noOpening, today: TODAY }), { from: '2026-08-03', to: TODAY });
  assert.equal(h.deliveredSpan({ asked: { from: '2026-07-08', to: TODAY }, txs: [], blocks: [], today: TODAY }), null);
});

// ---------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------

test('inside the delivered span the bank replaces what was kept; outside nothing changes', () => {
  const first = answer('2026-01-01', '2026-03-31', [tx('2026-01-15', -1), tx('2026-02-15', -2), tx('2026-03-15', -3)]);
  let acct = h.mergeDelivery(undefined, { span: { from: '2026-01-01', to: '2026-03-31' }, ...first }, TODAY);
  assert.deepEqual(days(acct.txs), ['2026-03-15', '2026-02-15', '2026-01-15']);

  // The bank's later answer for February to April: the 15 February booking is
  // gone (reversed and re-booked as two), March is as before, April is new.
  const second = answer('2026-02-01', '2026-04-30', [
    tx('2026-02-15', -1.5, 1), tx('2026-02-15', -0.5, 2), tx('2026-03-15', -3), tx('2026-04-15', -4),
  ]);
  acct = h.mergeDelivery(acct, { span: { from: '2026-02-01', to: '2026-04-30' }, ...second }, TODAY);
  assert.deepEqual(days(acct.txs), ['2026-04-15', '2026-03-15', '2026-02-15', '2026-02-15', '2026-01-15']);
  assert.deepEqual(acct.txs.filter((t) => h.bookingDay(t) === '2026-02-15').map((t) => t.amount).sort(), [-1.5, -0.5].sort());
  assert.deepEqual(acct.coverage, [{ from: '2026-01-01', to: '2026-04-30' }]);
});

test('no fuzzy dedupe: two identical bookings on one day stay two', () => {
  const twin = tx('2026-05-05', -9.99, 1);
  const a = answer('2026-05-01', '2026-05-31', [twin, { ...twin }]);
  const acct = h.mergeDelivery(undefined, { span: { from: '2026-05-01', to: '2026-05-31' }, ...a }, TODAY);
  assert.equal(acct.txs.length, 2);
  // And the same answer again replaces them — still two, never four.
  assert.equal(h.mergeDelivery(acct, { span: { from: '2026-05-01', to: '2026-05-31' }, ...a }, TODAY).txs.length, 2);
});

test('bookings of an answer dated outside its delivered span are not kept, nor do they touch kept days', () => {
  const kept = h.mergeDelivery(undefined, {
    span: { from: '2026-04-01', to: '2026-04-30' },
    ...answer('2026-04-01', '2026-04-30', [tx('2026-04-29', -1, 1), tx('2026-04-29', -2, 2), tx('2026-04-30', -3)]),
  }, TODAY);
  // A bank filtering by value date sends one of 29 April's bookings with May's.
  const may = answer('2026-05-01', '2026-05-31', [tx('2026-04-29', -2, 2), tx('2026-05-02', -5)]);
  const acct = h.mergeDelivery(kept, { span: { from: '2026-05-01', to: '2026-05-31' }, ...may }, TODAY);
  assert.equal(acct.txs.filter((t) => h.bookingDay(t) === '2026-04-29').length, 2, '29 April stays whole, and single');
  assert.deepEqual(acct.coverage, [{ from: '2026-04-01', to: '2026-05-31' }]);
});

test('the coverage never grows over days the bank did not deliver', () => {
  const kept = h.mergeDelivery(undefined, {
    span: { from: '2025-01-01', to: '2025-03-31' },
    ...answer('2025-01-01', '2025-03-31', [tx('2025-02-01', -1)]),
  }, TODAY);
  // Asked from 2024, the bank keeps only from 10 March 2025 on (an end-of-day
  // opening dated the 9th): January to the 9th of March must stay as kept.
  const txs = [tx('2025-03-15', -2), tx('2025-06-01', -3)];
  const a = { txs, blocks: [block({ open: 50, openDay: '2025-03-09', close: 45, closeDay: '2025-06-30', count: 2 })] };
  const span = h.deliveredSpan({ asked: { from: '2024-06-01', to: '2025-06-30' }, ...a, today: TODAY })!;
  assert.deepEqual(span, { from: '2025-03-10', to: '2025-06-30' });
  const acct = h.mergeDelivery(kept, { span, ...a }, TODAY);
  assert.deepEqual(days(acct.txs), ['2025-06-01', '2025-03-15', '2025-02-01']);
  assert.deepEqual(acct.coverage, [{ from: '2025-01-01', to: '2025-06-30' }]);
});

test('the proven end-of-day balances are kept with the days, and go when a later answer proves none', () => {
  const a = answer('2026-06-01', '2026-06-10', [tx('2026-06-03', -100), tx('2026-06-07', 50)], 1000);
  let acct = h.mergeDelivery(undefined, { span: { from: '2026-06-01', to: '2026-06-10' }, ...a }, TODAY);
  assert.deepEqual(acct.balances, [{ from: '2026-06-01', cents: [100000, 100000, 90000, 90000, 90000, 90000, 95000, 95000, 95000, 95000] }]);
  // The same days again, without the bank's balances: nothing proves them now.
  const blind = { txs: a.txs, blocks: [block({ open: null, openDay: null, close: null, closeDay: null, count: 2 })] };
  acct = h.mergeDelivery(acct, { span: { from: '2026-06-05', to: '2026-06-10' }, ...blind }, TODAY);
  assert.deepEqual(acct.balances, [{ from: '2026-06-01', cents: [100000, 100000, 90000, 90000] }]);
});

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

test('over the booking cap the oldest days go — whole, never a part of a day', () => {
  const list = [tx('2026-01-01', -1, 1), tx('2026-01-02', -1, 1), tx('2026-01-02', -1, 2), tx('2026-01-03', -1, 1), tx('2026-01-04', -1, 1)];
  const acct = h.capAccount({ txs: newestFirst(list), coverage: [{ from: '2026-01-01', to: '2026-01-04' }], balances: [] }, TODAY, 3);
  // Three may stay; the third newest is on the 2nd, which also has a fourth — so the 2nd goes whole.
  assert.deepEqual(days(acct.txs), ['2026-01-04', '2026-01-03']);
  assert.deepEqual(acct.coverage, [{ from: '2026-01-03', to: '2026-01-04' }]);
});

test('nothing older than ten years is kept', () => {
  const acct = h.capAccount({
    txs: [tx('2026-01-05', -1), tx('2016-10-06', -1), tx('2016-10-05', -1)],
    coverage: [{ from: '2016-01-01', to: '2026-01-31' }],
    balances: [{ from: '2016-10-04', cents: [1, 2, 3] }],
  }, TODAY);
  assert.deepEqual(days(acct.txs), ['2026-01-05', '2016-10-06']);
  assert.equal(acct.coverage[0].from, '2016-10-06');
  assert.deepEqual(acct.balances, [{ from: '2016-10-06', cents: [3] }]);
});

test('over the byte ceiling the account with the most bookings gives up its oldest ones', () => {
  const big = Array.from({ length: 40 }, (_, i) => tx(addDays('2026-01-01', i), -1, i, { purpose: 'x'.repeat(200) }));
  const small = [tx('2025-06-01', -1)];
  const data = {
    version: 1 as const,
    updatedAt: new Date(0).toISOString(),
    accounts: {
      giro: { txs: newestFirst(big), coverage: [{ from: '2026-01-01', to: '2026-02-09' }], balances: [] },
      tagesgeld: { txs: small, coverage: [{ from: '2025-06-01', to: '2025-06-01' }], balances: [] },
    },
  };
  const full = new TextEncoder().encode(JSON.stringify(h.compactHistory(data))).length;
  const capped = h.capHistory(data, TODAY, Math.floor(full * 0.8));
  assert.ok(new TextEncoder().encode(JSON.stringify(h.compactHistory(capped))).length <= full * 0.8);
  assert.equal(capped.accounts.tagesgeld.txs.length, 1, 'the small account is left alone');
  assert.ok(capped.accounts.giro.txs.length < 40);
  assert.equal(days(capped.accounts.giro.txs).at(0), '2026-02-09', 'the newest stay');
  const oldest = days(capped.accounts.giro.txs).at(-1)!;
  const coveredFrom = capped.accounts.giro.coverage[0].from;
  assert.ok(coveredFrom > '2026-01-01' && coveredFrom <= oldest, 'the coverage starts after the days that went');
});

// ---------------------------------------------------------------------------
// Asking the bank for less
// ---------------------------------------------------------------------------

test('a start the kept days do not hold: ask the bank for everything', () => {
  assert.deepEqual(h.planFetch({ from: '2025-10-06', to: TODAY }, [], TODAY), { from: '2025-10-06' });
  assert.deepEqual(h.planFetch({ from: '2025-10-06', to: TODAY }, [{ from: '2025-11-01', to: '2026-10-05' }], TODAY), { from: '2025-10-06' });
});

test('12 months with a year kept: only the bank\'s free window is asked for', () => {
  assert.deepEqual(h.planFetch({ from: '2025-10-06', to: TODAY }, [{ from: '2025-01-01', to: '2026-10-05' }], TODAY), { from: '2026-07-08' });
});

test('kept days that end long ago: asked from a week before they end — and never for older days', () => {
  // Not logged in since May: from a week before the kept days end.
  assert.deepEqual(h.planFetch({ from: '2025-10-06', to: TODAY }, [{ from: '2025-01-01', to: '2026-05-20' }], TODAY), { from: '2026-05-13' });
});

test('the default 90 days are always the bank\'s', () => {
  assert.deepEqual(h.planFetch({ from: '2026-07-08', to: TODAY }, [{ from: '2025-01-01', to: '2026-10-05' }], TODAY), { from: '2026-07-08' });
});

test('a past range the kept days hold, before the free window, needs no bank at all', () => {
  assert.equal(h.planFetch({ from: '2026-01-01', to: '2026-01-31' }, [{ from: '2025-01-01', to: '2026-10-05' }], TODAY), null);
  // Reaching into the free window, the bank answers for that part.
  assert.deepEqual(h.planFetch({ from: '2026-06-01', to: '2026-08-31' }, [{ from: '2025-01-01', to: '2026-10-05' }], TODAY), { from: '2026-07-08' });
});

test('"Alles Gespeicherte" reaches as far back as the kept run that joins the free window', () => {
  assert.deepEqual(h.savedPeriod([{ from: '2024-03-12', to: '2026-10-05' }], TODAY), { from: '2024-03-12', to: TODAY });
  assert.equal(h.savedPeriod([{ from: '2024-03-12', to: '2026-07-10' }], TODAY), null, 'ends too soon to join without an approval');
  assert.equal(h.savedPeriod([{ from: '2026-08-01', to: '2026-10-05' }], TODAY), null, 'nothing older than the window');
});

// ---------------------------------------------------------------------------
// The list a view shows
// ---------------------------------------------------------------------------

const KEPT = h.mergeDelivery(undefined, {
  span: { from: '2025-10-01', to: '2026-09-30' },
  ...answer('2025-10-01', '2026-09-30', [
    tx('2025-10-03', -10), tx('2026-01-05', -20), tx('2026-07-06', -30, 1), tx('2026-07-06', -31, 2), tx('2026-07-07', -32), tx('2026-09-20', -40),
  ], 2000),
}, TODAY);

test('the list: the bank\'s answer for what it was asked, the kept days before — never both for one day', () => {
  const fetched = newestFirst([tx('2026-07-06', -31, 2), tx('2026-07-10', -50), tx('2026-09-20', -40), tx('2026-10-05', -60)]);
  const view = h.historyView({ span: { from: '2025-10-06', to: TODAY }, fetchFrom: '2026-07-08', fetched, history: KEPT });
  assert.ok(view.saved);
  assert.equal(view.saved.to, '2026-07-07');
  assert.equal(view.saved.count, 4);
  // 6 July comes whole from the kept days; the bank's lone 6 July booking is not added to it.
  assert.deepEqual(days(view.txs), ['2026-10-05', '2026-09-20', '2026-07-10', '2026-07-07', '2026-07-06', '2026-07-06', '2026-01-05']);
  assert.equal(view.saved.fetched, fetched, 'the bank\'s answer as it came, for the Kontoverlauf');
});

test('without kept days that reach back to the start, the list is the bank\'s answer alone', () => {
  const fetched = [tx('2026-08-01', -1)];
  assert.deepEqual(h.historyView({ span: { from: '2024-01-01', to: TODAY }, fetchFrom: '2026-07-08', fetched, history: KEPT }), { txs: fetched, saved: null });
  assert.deepEqual(h.historyView({ span: { from: '2026-07-08', to: TODAY }, fetchFrom: '2026-07-08', fetched, history: KEPT }), { txs: fetched, saved: null });
  assert.deepEqual(h.historyView({ span: { from: '2026-01-01', to: TODAY }, fetchFrom: '2026-07-08', fetched, history: undefined }), { txs: fetched, saved: null });
});

test('a past range from the kept days alone', () => {
  const view = h.historyView({ span: { from: '2026-01-01', to: '2026-01-31' }, fetchFrom: null, fetched: [], history: KEPT });
  assert.deepEqual(days(view.txs), ['2026-01-05']);
  assert.equal(view.saved?.fetched, null);
  assert.equal(view.saved?.to, '2026-01-31');
});

// ---------------------------------------------------------------------------
// The Kontoverlauf over the kept days
// ---------------------------------------------------------------------------

/**
 * The bank's answer for its free window (from 8 July), opening on the balance
 * the kept days end 7 July with: 2000 − 10 − 20 − 30 − 31 − 32 = 1877.
 */
const freshAnswer = () => answer('2026-07-08', TODAY, [tx('2026-07-10', -50), tx('2026-09-20', -40), tx('2026-10-05', -60)], 1877);

test('the Kontoverlauf carries back over the kept days, checked against their kept balances', () => {
  const a = freshAnswer();
  const view = h.historyView({ span: { from: '2025-10-06', to: TODAY }, fetchFrom: '2026-07-08', fetched: a.txs, history: KEPT });
  const info: StatementInfo = { from: '2025-10-06', to: TODAY, blocks: a.blocks, loadedAt: 0, saved: view.saved! };
  const hist = h.accountBalanceHistory(view.txs, info);
  assert.equal(hist.verified, true, hist.verified ? '' : hist.reason);
  if (!hist.verified) return;
  assert.equal(hist.from, '2025-10-06');
  assert.equal(hist.to, TODAY);
  const at = (d: string) => hist.points.find((p) => p.date === d)?.balance;
  assert.equal(at('2025-10-06'), 1990);
  assert.equal(at('2026-01-05'), 1970);
  assert.equal(at('2026-07-07'), 1877);
  assert.equal(at('2026-07-10'), 1827);
  assert.equal(at(TODAY), 1727);
});

test('a kept balance that disagrees by a cent ends the walk there', () => {
  const a = freshAnswer();
  const bent = {
    ...KEPT,
    balances: KEPT.balances.map((r) => ({ ...r, cents: r.cents.map((c, i) => (r.from <= '2026-01-01' && addDays(r.from, i) === '2026-01-01' ? c + 1 : c)) })),
  };
  const view = h.historyView({ span: { from: '2025-10-06', to: TODAY }, fetchFrom: '2026-07-08', fetched: a.txs, history: bent });
  const hist = h.accountBalanceHistory(view.txs, { from: '2025-10-06', to: TODAY, blocks: a.blocks, loadedAt: 0, saved: view.saved! });
  assert.equal(hist.verified, true);
  if (hist.verified) assert.equal(hist.from, '2026-01-02');
});

test('a list from the kept days alone is anchored on the balance kept for its last day', () => {
  const view = h.historyView({ span: { from: '2026-01-01', to: '2026-01-31' }, fetchFrom: null, fetched: [], history: KEPT });
  const hist = h.accountBalanceHistory(view.txs, { from: '2026-01-01', to: '2026-01-31', blocks: [], loadedAt: 0, saved: view.saved! });
  assert.equal(hist.verified, true);
  if (!hist.verified) return;
  assert.equal(hist.points.length, 31);
  assert.equal(hist.points[0].balance, 1990);
  assert.equal(hist.points.at(-1)?.balance, 1970);
});

test('without a kept part the Kontoverlauf is the bank\'s proof, as it always was', () => {
  const a = answer('2026-07-08', TODAY, [tx('2026-07-10', -50)], 1877);
  const hist = h.accountBalanceHistory(a.txs, { from: '2026-07-08', to: TODAY, blocks: a.blocks, loadedAt: 0 });
  assert.equal(hist.verified, true);
  if (hist.verified) assert.equal(hist.from, '2026-07-08');
});

// ---------------------------------------------------------------------------
// Sanitising and the compact form
// ---------------------------------------------------------------------------

test('only a version-1 object is a history', () => {
  for (const v of [null, 'x', 42, [], {}, { version: 2 }]) assert.equal(h.sanitizeHistory(v, TODAY), null);
  assert.deepEqual(h.sanitizeHistory({ version: 1 }, TODAY)?.accounts, {});
});

test('a booking comes back exactly as it went in, through the compact form', () => {
  const t = tx('2026-03-03', -12.34, 1, { creditorId: 'DE98ZZZ09999999999', ultimateName: '' });
  const data = { version: 1 as const, updatedAt: '2026-10-06T08:00:00.000Z', accounts: { '1234567': { txs: [t], coverage: [{ from: '2026-03-01', to: '2026-03-31' }], balances: [] } } };
  const back = h.sanitizeHistory(JSON.parse(JSON.stringify(h.compactHistory(data))), TODAY);
  assert.deepEqual(back?.accounts['1234567'].txs[0], { ...t, ultimateName: '' });
  // The dates are the very strings: a booking's category is keyed by them (txKey).
  assert.equal(back?.accounts['1234567'].txs[0].entryDate, t.entryDate);
});

test('what does not belong goes: bookings off the coverage, broken bookings, odd keys and fields', () => {
  const ok = tx('2026-03-03', -1);
  const out = h.sanitizeHistory({
    version: 1,
    secret: 'x',
    accounts: {
      '1234567': {
        txs: [ok, tx('2026-04-03', -2), { ...ok, amount: 'viel' }, { ...ok, entryDate: 'gestern', valueDate: 7 }, { ...ok, purpose: 'y'.repeat(5000), injected: true }],
        coverage: [{ from: '2026-03-01', to: '2026-03-31' }, 'x'],
        balances: [{ from: '2026-03-30', cents: [1, 2.5, 3] }, { from: 'nie', cents: [1] }],
      },
      __proto__: { txs: [ok], coverage: [{ from: '2026-03-01', to: '2026-03-31' }] },
      'bad\nkey': { txs: [ok], coverage: [{ from: '2026-03-01', to: '2026-03-31' }] },
      empty: { txs: [ok], coverage: [] },
    },
  }, TODAY)!;
  assert.deepEqual(Object.keys(out.accounts), ['1234567']);
  const acct = out.accounts['1234567'];
  assert.equal(acct.txs.length, 2, 'April lies off the coverage; the broken ones go');
  assert.equal(acct.txs.find((t) => t.purpose.startsWith('y'))?.purpose.length, h.HISTORY_LIMITS.text);
  assert.equal('injected' in acct.txs[0] || 'injected' in acct.txs[1], false);
  assert.deepEqual(acct.balances, [{ from: '2026-03-30', cents: [1] }], '2.5 is no cent count; 1 April is off the coverage');
  assert.equal('secret' in out, false);
});

// ---------------------------------------------------------------------------
// On disk (lib/history-store.ts)
// ---------------------------------------------------------------------------

/** Just enough of a Session: who, which bank, the PIN. */
const fakeSession = (pin: string, userId = 'kunde1', blz = '12345678') =>
  ({ meta: { blz }, client: { config: { userId, pin } } }) as unknown as Session;

const fileOf = (userId = 'kunde1', blz = '12345678') =>
  path.join(dir, `${crypto.createHash('sha256').update(`${blz}|${userId}|history`).digest('hex').slice(0, 32)}.history`);

/** Lets a noted answer's background merge run, then waits for the file queue behind it. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

const ANSWER = answer('2026-07-08', TODAY, [tx('2026-07-10', -50, 1, { purpose: 'Miete Oktober Musterstraße 1' }), tx('2026-10-05', -60)], 1877);

test('nothing is kept while the vault does not say so — and what the session holds is kept once it does', async () => {
  const s = fakeSession('12345', 'kunde-a');
  store.noteDelivery(s, '1234567', { from: '2026-07-08', to: TODAY }, ANSWER.txs, ANSWER.blocks);
  await settle();
  assert.deepEqual(await store.loadHistory(s), { status: 'ready', data: null });
  assert.equal(fs.existsSync(fileOf('kunde-a')), false);

  await vault.saveVault(s, { ...EMPTY_VAULT, keepBookings: true });
  const res = await store.loadHistory(s);
  assert.equal(res.status, 'ready');
  const data = h.sanitizeHistory(res.status === 'ready' ? res.data : null, TODAY)!;
  assert.equal(data.accounts['1234567'].txs.length, 2);
  assert.deepEqual(data.accounts['1234567'].coverage, [{ from: '2026-07-08', to: TODAY }]);
});

test('a further bank of the view follows the choice of the primary login, into a file of its own', async () => {
  const primary = fakeSession('13579', 'haupt', '12345678');
  const linked = fakeSession('97531', 'zweit', '87654321');
  Object.assign(primary, { id: 'primary-session' });
  Object.assign(linked, { id: 'linked-session', keepChoiceFrom: 'primary-session' });
  const live = new Map<string, Session>([['primary-session', primary]]);
  store.findSessionsWith((id) => live.get(id) ?? null);
  try {
    // Its own vault says nothing; the primary's says keep.
    await vault.saveVault(primary, { ...EMPTY_VAULT, keepBookings: true });
    store.noteDelivery(linked, '9990001', { from: '2026-07-08', to: TODAY }, ANSWER.txs, ANSWER.blocks);
    await settle();
    const res = await store.loadHistory(linked);
    const data = h.sanitizeHistory(res.status === 'ready' ? res.data : null, TODAY)!;
    assert.equal(data.accounts['9990001'].txs.length, 2);
    assert.equal(fs.existsSync(fileOf('zweit', '87654321')), true, 'a file of the further login');
    assert.equal(fs.existsSync(fileOf('haupt', '12345678')), false, 'none of the primary login');

    // The primary session has ended: no yes any more.
    live.clear();
    const other = fakeSession('97531', 'zweit2', '87654321');
    Object.assign(other, { keepChoiceFrom: 'primary-session' });
    store.noteDelivery(other, '9990002', { from: '2026-07-08', to: TODAY }, ANSWER.txs, ANSWER.blocks);
    await settle();
    assert.deepEqual(await store.loadHistory(other), { status: 'ready', data: null });
  } finally {
    store.findSessionsWith(() => null);
  }
});

test('a statement answer is kept in a sealed file the PIN opens — and nowhere in plain text', async () => {
  const s = fakeSession('24680', 'kunde-b');
  await vault.saveVault(s, { ...EMPTY_VAULT, keepBookings: true });
  store.noteDelivery(s, '1234567', { from: '2026-07-08', to: TODAY }, ANSWER.txs, ANSWER.blocks);
  await settle();
  const res = await store.loadHistory(s);
  const data = h.sanitizeHistory(res.status === 'ready' ? res.data : null, TODAY)!;
  assert.deepEqual(days(data.accounts['1234567'].txs), ['2026-10-05', '2026-07-10']);
  const raw = fs.readFileSync(fileOf('kunde-b'), 'utf8');
  assert.equal(raw.includes('Musterstraße'), false);
  assert.equal(raw.includes('Miete'), false);
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['ct', 'iv', 'salt', 'tag', 'v']);
  // A fresh session (a new login) reads the same.
  const again = await store.loadHistory(fakeSession('24680', 'kunde-b'));
  assert.equal(again.status, 'ready');
});

test('a file another PIN sealed is never overwritten; starting over sets it aside', async () => {
  const s1 = fakeSession('11111', 'kunde-c');
  await vault.saveVault(s1, { ...EMPTY_VAULT, keepBookings: true });
  store.noteDelivery(s1, '1234567', { from: '2026-07-08', to: TODAY }, ANSWER.txs, ANSWER.blocks);
  await settle();
  await store.loadHistory(s1);
  const before = fs.readFileSync(fileOf('kunde-c'), 'utf8');

  // The PIN changed at the bank: the vault is unreadable too, so it says nothing — make it say keep.
  const s2 = fakeSession('22222', 'kunde-c');
  await vault.resetVault(s2);
  await vault.saveVault(s2, { ...EMPTY_VAULT, keepBookings: true });
  assert.deepEqual(await store.loadHistory(s2), { status: 'error', reason: 'decrypt' });
  store.noteDelivery(s2, '1234567', { from: '2026-07-08', to: TODAY }, ANSWER.txs, ANSWER.blocks);
  await settle();
  await store.loadHistory(s2);
  assert.equal(fs.readFileSync(fileOf('kunde-c'), 'utf8'), before, 'untouched');

  const reset = await store.resetHistory(s2);
  assert.equal(reset.status, 'ready');
  assert.equal(fs.readFileSync(`${fileOf('kunde-c')}.bak`, 'utf8'), before, 'the old file kept as a backup');
  const data = h.sanitizeHistory(reset.status === 'ready' ? reset.data : null, TODAY)!;
  assert.equal(data.accounts['1234567']?.txs.length, 2, 'what the session held is folded into the new one');
  assert.equal((await store.loadHistory(s2)).status, 'ready');
});

test('a sealed box made for another purpose does not open as the kept Umsätze', async () => {
  const s = fakeSession('33333', 'kunde-d');
  fs.writeFileSync(fileOf('kunde-d'), JSON.stringify(sealWithPin('33333', Buffer.from(JSON.stringify({ version: 1, accounts: {} })))));
  assert.deepEqual(await store.loadHistory(s), { status: 'error', reason: 'decrypt' });
});

test('wipe removes the file, its backups and stray temp files — and nothing else; then keeps nothing more', async () => {
  const s = fakeSession('44444', 'kunde-e');
  await vault.saveVault(s, { ...EMPTY_VAULT, keepBookings: true });
  store.noteDelivery(s, '1234567', { from: '2026-07-08', to: TODAY }, ANSWER.txs, ANSWER.blocks);
  await settle();
  await store.loadHistory(s);
  const file = fileOf('kunde-e');
  fs.writeFileSync(`${file}.bak`, 'x');
  fs.writeFileSync(`${file}.1700000000000.bak`, 'x');
  fs.writeFileSync(`${file}.abc123.tmp`, 'x');
  const other = fileOf('someone-else');
  fs.writeFileSync(other, 'x');

  assert.equal(await store.wipeHistory(s), 4);
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(`${file}.bak`), false);
  assert.equal(fs.existsSync(other), true, 'another login\'s file stays');
  assert.equal(fs.readdirSync(dir).some((n) => n.startsWith(path.basename(file))), false);

  // An answer that arrives after the wipe is not kept…
  store.noteDelivery(s, '1234567', { from: '2026-07-08', to: TODAY }, ANSWER.txs, ANSWER.blocks);
  await settle();
  await settle();
  assert.equal(fs.existsSync(file), false);
  // …until the history is asked for again (the choice was switched back on).
  assert.deepEqual(await store.loadHistory(s), { status: 'ready', data: null });
});

test('wipe without a login to go by is refused', async () => {
  await assert.rejects(store.wipeHistory({ meta: {}, client: { config: {} } } as unknown as Session), store.HistoryError);
});
