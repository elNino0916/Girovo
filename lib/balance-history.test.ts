import './__fixtures__/tz.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SerializedTransaction, StatementBlock } from './fints-types';
import { buildBalanceHistory, type BalanceHistory } from './balance-history.ts';
import { block, camt, mt940, mt940Date, newestFirst } from './__fixtures__/transactions.ts';

const card = (day: string, amount: number) => mt940({ day, amount, gvc: '106', text: 'KARTENZAHLUNG', name: 'REWE SAGT DANKE' });

// An MT940 account: one statement block per booking day, each opening on the
// previous booking day's closing balance — and sent newest first, as some
// banks do.
const TXS: SerializedTransaction[] = newestFirst([
  card('2026-09-25', -50),
  mt940({ day: '2026-09-28', amount: 2000, gvc: '153', text: 'LOHN/GEHALT', name: 'ACME GmbH' }),
  mt940({ day: '2026-09-28', amount: -12.99, gvc: '105', text: 'BASISLASTSCHRIFT', name: 'Netflix' }),
  mt940({ day: '2026-09-30', amount: -850, gvc: '117', text: 'DAUERAUFTRAG', name: 'Hausverwaltung' }),
  card('2026-10-02', -20),
  card('2026-10-02', -5.5),
]);
const BLOCKS: StatementBlock[] = [
  block({ open: 2087.01, openDay: '2026-09-30', close: 2061.51, closeDay: '2026-10-02', count: 2 }),
  block({ open: 2937.01, openDay: '2026-09-28', close: 2087.01, closeDay: '2026-09-30', count: 1 }),
  block({ open: 950, openDay: '2026-09-25', close: 2937.01, closeDay: '2026-09-28', count: 2 }),
  block({ open: 1000, openDay: '2026-09-24', close: 950, closeDay: '2026-09-25', count: 1 }),
];

const verified = (h: BalanceHistory) => {
  assert.equal(h.verified, true, h.verified ? '' : h.reason);
  return h as Extract<BalanceHistory, { verified: true }>;
};
const reason = (h: BalanceHistory) => {
  assert.equal(h.verified, false);
  return (h as Extract<BalanceHistory, { verified: false }>).reason;
};

test('MT940 daily blocks, newest first: one verified point per day, quiet days included', () => {
  const h = verified(buildBalanceHistory({ txs: TXS, blocks: BLOCKS, range: { from: '2026-09-25', to: '2026-10-03' } }));
  assert.deepEqual(h.points, [
    { date: '2026-09-25', balance: 950 },
    { date: '2026-09-26', balance: 950 },
    { date: '2026-09-27', balance: 950 },
    { date: '2026-09-28', balance: 2937.01 },
    { date: '2026-09-29', balance: 2937.01 },
    { date: '2026-09-30', balance: 2087.01 },
    { date: '2026-10-01', balance: 2087.01 },
    { date: '2026-10-02', balance: 2061.51 },
    { date: '2026-10-03', balance: 2061.51 },
  ]);
  assert.equal(h.min, 950);
  assert.equal(h.max, 2937.01);
  assert.equal(h.currency, 'EUR');
  assert.deepEqual([h.from, h.to, h.blocks], ['2026-09-25', '2026-10-03', 4]);
});

test('the series starts where the bank\'s figures start, not before', () => {
  const wide = verified(buildBalanceHistory({ txs: TXS, blocks: BLOCKS, range: { from: '2026-09-01', to: '2026-10-03' } }));
  assert.equal(wide.from, '2026-09-24', 'the first opening balance is dated the 24th');
  assert.deepEqual(wide.points[0], { date: '2026-09-24', balance: 1000 });
  assert.equal(wide.points.length, 10);
  const past = verified(buildBalanceHistory({ txs: TXS, blocks: BLOCKS, range: { from: '2026-09-26', to: '2026-09-29' } }));
  assert.deepEqual(past.points.map((p) => p.balance), [950, 950, 2937.01, 2937.01], 'a past range walks back from the newest closing');
});

test('CAMT: one report for the whole range, date-only balances at local noon', () => {
  const txs = newestFirst([
    camt({ day: '2026-09-01', amount: -850, code: 'STDO', text: 'Dauerauftrag', name: 'Hausverwaltung' }),
    camt({ day: '2026-09-15', amount: -12.99, code: 'ESDD', text: 'SEPA-Basislastschrift', name: 'Netflix' }),
    camt({ day: '2026-09-30', amount: 2650, code: 'SALA', text: 'Lohn/Gehalt', name: 'ACME GmbH' }),
    camt({ day: '2026-10-02', amount: -40.25, code: 'POSD', text: 'Kartenzahlung', name: 'ARAL' }),
  ]);
  const blocks = [block({ camt: true, open: 500, openDay: '2026-08-31', close: 2246.76, closeDay: '2026-10-03', count: 4 })];
  const h = verified(buildBalanceHistory({ txs, blocks, range: { from: '2026-09-01', to: '2026-10-03' } }));
  assert.equal(h.points.length, 33);
  assert.deepEqual(h.points[0], { date: '2026-09-01', balance: -350 });
  assert.deepEqual(h.points.find((p) => p.date === '2026-09-15'), { date: '2026-09-15', balance: -362.99 });
  assert.deepEqual(h.points.find((p) => p.date === '2026-09-29'), { date: '2026-09-29', balance: -362.99 });
  assert.deepEqual(h.points.find((p) => p.date === '2026-09-30'), { date: '2026-09-30', balance: 2287.01 });
  assert.deepEqual(h.points[h.points.length - 1], { date: '2026-10-03', balance: 2246.76 });
  assert.equal(h.min, -362.99);
  assert.equal(h.max, 2287.01);
});

test('CAMT opening booked balance dated the first booking day covers the evening before', () => {
  const txs = [camt({ day: '2026-09-01', amount: -100, code: 'ESCT' }), camt({ day: '2026-09-03', amount: 50, code: 'ESCT' })];
  const blocks = [block({ camt: true, open: 1000, openDay: '2026-09-01', close: 950, closeDay: '2026-09-03', count: 2 })];
  const h = verified(buildBalanceHistory({ txs, blocks, range: { from: '2026-08-25', to: '2026-09-03' } }));
  assert.equal(h.from, '2026-08-31');
  assert.deepEqual(h.points.map((p) => p.balance), [1000, 900, 900, 950]);
});

test('nothing is drawn without a complete, matching chain', () => {
  const range = { from: '2026-09-25', to: '2026-10-03' };
  assert.match(reason(buildBalanceHistory({ txs: TXS, blocks: [], range })), /keine Salden/);
  assert.match(reason(buildBalanceHistory({ txs: TXS, blocks: null, range })), /keine Salden/);

  const noClosing = BLOCKS.map((b, i) => (i === 1 ? { ...b, closingBalance: null } : b));
  assert.match(reason(buildBalanceHistory({ txs: TXS, blocks: noClosing, range })), /Anfangs- und Endsaldo/);
  const noOpening = BLOCKS.map((b, i) => (i === 3 ? { ...b, openingBalance: null, openingDate: null } : b));
  assert.match(reason(buildBalanceHistory({ txs: TXS, blocks: noOpening, range })), /Anfangs- und Endsaldo/);

  const missing = TXS.filter((t) => t.amount !== -12.99);
  assert.match(reason(buildBalanceHistory({ txs: missing, blocks: BLOCKS, range })), /Zahl der Umsätze/);

  const altered = TXS.map((t) => (t.amount === -12.99 ? { ...t, amount: -12.9 } : t));
  assert.match(reason(buildBalanceHistory({ txs: altered, blocks: BLOCKS, range })), /ergeben nicht die Salden/);

  const gap = BLOCKS.map((b, i) => (i === 1 ? { ...b, openingBalance: 2900, closingBalance: 2050 } : b));
  assert.match(reason(buildBalanceHistory({ txs: TXS, blocks: gap, range })), /lückenlos/);

  const usd = BLOCKS.map((b, i) => (i === 0 ? { ...b, currency: 'USD' } : b));
  assert.match(reason(buildBalanceHistory({ txs: TXS, blocks: usd, range })), /Währung/);
  const usdTx = TXS.map((t, i) => (i === 0 ? { ...t, currency: 'USD' } : t));
  assert.match(reason(buildBalanceHistory({ txs: usdTx, blocks: BLOCKS, range })), /Währung/);

  assert.match(reason(buildBalanceHistory({ txs: TXS, blocks: BLOCKS, range: { from: '2026-10-03', to: '2026-09-25' } })), /Zeitraum/);
  assert.match(reason(buildBalanceHistory({ txs: TXS, blocks: BLOCKS, range: { from: '', to: '2026-10-03' } })), /Zeitraum/);
  assert.match(reason(buildBalanceHistory({ txs: TXS, blocks: BLOCKS, range: { from: '2026-09-01', to: '2026-09-10' } })), /keine geprüften Salden/);
});

test('a cent off is off', () => {
  const blocks = BLOCKS.map((b, i) => (i === 0 ? { ...b, closingBalance: 2061.5 } : b));
  assert.equal(buildBalanceHistory({ txs: TXS, blocks, range: { from: '2026-09-25', to: '2026-10-03' } }).verified, false);
  // …but binary floating point is not: amounts that do not add up exactly in
  // doubles still verify to the cent.
  const txs = [0.1, 0.2, 0.7, 1.1, 2.2].map((a) => card('2026-09-29', -a));
  const fp = [block({ open: 4.3, openDay: '2026-09-28', close: 0, closeDay: '2026-09-29', count: 5 })];
  assert.equal(buildBalanceHistory({ txs, blocks: fp, range: { from: '2026-09-28', to: '2026-09-29' } }).verified, true);
});

test('weekend fetch: a booking already dated Monday, closing dated Monday', () => {
  const txs = newestFirst([...TXS, mt940({ day: '2026-10-05', amount: -100, gvc: '116', text: 'UEBERWEISUNG', name: 'Max' })]);
  const blocks = [...BLOCKS, block({ open: 2061.51, openDay: '2026-10-02', close: 1961.51, closeDay: '2026-10-05', count: 1 })];
  const h = verified(buildBalanceHistory({ txs, blocks, range: { from: '2026-09-25', to: '2026-10-03' } }));
  assert.equal(h.to, '2026-10-03');
  assert.deepEqual(h.points[h.points.length - 1], { date: '2026-10-03', balance: 2061.51 }, "Monday's booking is not Saturday's balance");
});

test('weekend fetch: a Monday booking the Friday closing does not contain is not part of it', () => {
  const txs = newestFirst([...TXS, mt940({ day: '2026-10-05', amount: -100, gvc: '116', text: 'UEBERWEISUNG', name: 'Max' })]);
  const last = { ...BLOCKS[0], count: 3 };
  const h = verified(buildBalanceHistory({ txs, blocks: [last, ...BLOCKS.slice(1)], range: { from: '2026-09-25', to: '2026-10-03' } }));
  assert.deepEqual(h.points[h.points.length - 1], { date: '2026-10-03', balance: 2061.51 });
  // Past the closing day there is no figure covering that booking: the series stops the day before it.
  const ahead = verified(buildBalanceHistory({ txs, blocks: [last, ...BLOCKS.slice(1)], range: { from: '2026-09-25', to: '2026-10-07' } }));
  assert.equal(ahead.to, '2026-10-04');
});

test('weekend fetch: a Friday closing that already contains the Monday booking', () => {
  const txs = newestFirst([...TXS, mt940({ day: '2026-10-05', amount: -100, gvc: '116', text: 'UEBERWEISUNG', name: 'Max' })]);
  const last = { ...BLOCKS[0], count: 3, closingBalance: 1961.51 };
  const h = verified(buildBalanceHistory({ txs, blocks: [last, ...BLOCKS.slice(1)], range: { from: '2026-09-25', to: '2026-10-07' } }));
  assert.deepEqual(h.points.slice(-6).map((p) => [p.date, p.balance]), [
    ['2026-10-02', 2061.51], ['2026-10-03', 2061.51], ['2026-10-04', 2061.51],
    ['2026-10-05', 1961.51], ['2026-10-06', 1961.51], ['2026-10-07', 1961.51],
  ]);
});

test('two blocks closing on the same day are put in order by their balances', () => {
  const txs = [
    mt940({ day: '2026-09-28', amount: 2000, gvc: '153', text: 'LOHN/GEHALT', name: 'ACME GmbH' }),
    mt940({ day: '2026-09-28', amount: -12.99, gvc: '105', text: 'BASISLASTSCHRIFT', name: 'Netflix' }),
  ];
  const blocks = [
    block({ open: 2950, openDay: '2026-09-28', close: 2937.01, closeDay: '2026-09-28', count: 1 }),
    block({ open: 950, openDay: '2026-09-28', close: 2950, closeDay: '2026-09-28', count: 1 }),
  ];
  const h = verified(buildBalanceHistory({ txs, blocks, range: { from: '2026-09-27', to: '2026-09-29' } }));
  assert.deepEqual(h.points.map((p) => p.balance), [950, 2937.01, 2937.01]);
});

test('a booking dated outside its own statement block is not drawn, even when the sums work out', () => {
  // MT940 carries the Buchungstag without a year. A Rechnungsabschluss booked
  // on 2 January with value date 31 December can reach the client dated
  // 2 January of the year before — still inside the block's sum, but a whole
  // year before the block's opening balance.
  const misdated = mt940({ day: '2025-01-02', valueDay: '2025-12-31', amount: 1500, gvc: '805', text: 'ABSCHLUSS' });
  const yearEnd = block({ open: 1000, openDay: '2025-12-30', close: 2500, closeDay: '2026-01-02', count: 1 });
  assert.match(
    reason(buildBalanceHistory({ txs: [misdated], blocks: [yearEnd], range: { from: '2025-10-04', to: '2026-01-02' } })),
    /Buchungsdaten passen nicht/,
  );
  // The same when the year-end block is only the oldest of several.
  const later = mt940({ day: '2026-01-05', amount: -100, gvc: '106', text: 'KARTENZAHLUNG', name: 'REWE SAGT DANKE' });
  const blocks = [yearEnd, block({ open: 2500, openDay: '2026-01-02', close: 2400, closeDay: '2026-01-05', count: 1 })];
  assert.match(
    reason(buildBalanceHistory({ txs: newestFirst([later, misdated]), blocks, range: { from: '2025-10-07', to: '2026-01-05' } })),
    /Buchungsdaten passen nicht/,
  );
  // Dated right, the very same statement is a verified curve that opens on the bank's 1.000,00.
  const right = { ...misdated, entryDate: mt940Date('2026-01-02') };
  const h = verified(buildBalanceHistory({ txs: [right], blocks: [yearEnd], range: { from: '2025-10-04', to: '2026-01-02' } }));
  assert.equal(h.from, '2025-12-30');
  assert.deepEqual(h.points.map((p) => [p.date, p.balance]), [
    ['2025-12-30', 1000], ['2025-12-31', 1000], ['2026-01-01', 1000], ['2026-01-02', 2500],
  ]);
});

test('an older block may not hold a booking dated after it closes', () => {
  // Only the newest block gets the weekend allowance for forward-dated bookings.
  const txs = [card('2026-09-25', -50), card('2026-09-29', -10)];
  const blocks = [
    block({ open: 1000, openDay: '2026-09-24', close: 940, closeDay: '2026-09-25', count: 2 }),
    block({ open: 940, openDay: '2026-09-25', close: 940, closeDay: '2026-09-30', count: 0 }),
  ];
  assert.match(
    reason(buildBalanceHistory({ txs: newestFirst(txs), blocks, range: { from: '2026-09-24', to: '2026-09-30' } })),
    /Buchungsdaten passen nicht/,
  );
});

test('DST: one point per calendar day across both switches', () => {
  const spring = [card('2026-03-27', -10), card('2026-03-29', -20), card('2026-03-30', -30)];
  const springBlocks = [
    block({ open: 100, openDay: '2026-03-26', close: 90, closeDay: '2026-03-27', count: 1 }),
    block({ open: 90, openDay: '2026-03-27', close: 70, closeDay: '2026-03-29', count: 1 }),
    block({ open: 70, openDay: '2026-03-29', close: 40, closeDay: '2026-03-30', count: 1 }),
  ];
  const s = verified(buildBalanceHistory({ txs: newestFirst(spring), blocks: springBlocks, range: { from: '2026-03-26', to: '2026-04-01' } }));
  assert.deepEqual(s.points.map((p) => p.date), ['2026-03-26', '2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31', '2026-04-01']);
  assert.deepEqual(s.points.map((p) => p.balance), [100, 90, 90, 70, 40, 40, 40]);

  const autumn = [card('2026-10-24', -1), card('2026-10-25', -2), card('2026-10-26', -3)];
  const autumnBlocks = [block({ open: 10, openDay: '2026-10-23', close: 4, closeDay: '2026-10-26', count: 3 })];
  const a = verified(buildBalanceHistory({ txs: autumn, blocks: autumnBlocks, range: { from: '2026-10-23', to: '2026-10-27' } }));
  assert.deepEqual(a.points.map((p) => [p.date, p.balance]), [
    ['2026-10-23', 10], ['2026-10-24', 9], ['2026-10-25', 7], ['2026-10-26', 4], ['2026-10-27', 4],
  ]);
});

test('a leap day is a day', () => {
  const txs = [card('2028-02-28', -1), card('2028-02-29', -2), card('2028-03-01', -3)];
  const blocks = [block({ open: 10, openDay: '2028-02-27', close: 4, closeDay: '2028-03-01', count: 3 })];
  const h = verified(buildBalanceHistory({ txs, blocks, range: { from: '2028-02-28', to: '2028-03-01' } }));
  assert.deepEqual(h.points.map((p) => [p.date, p.balance]), [['2028-02-28', 9], ['2028-02-29', 7], ['2028-03-01', 4]]);
});

test('an account with no bookings in the range is a flat, verified line', () => {
  const blocks = [block({ open: 321.5, openDay: '2026-09-01', close: 321.5, closeDay: '2026-10-03', count: 0 })];
  const h = verified(buildBalanceHistory({ txs: [], blocks, range: { from: '2026-09-28', to: '2026-10-03' } }));
  assert.equal(h.points.length, 6);
  assert.ok(h.points.every((p) => p.balance === 321.5));
  assert.equal(h.min, 321.5);
  assert.equal(h.max, 321.5);
});
