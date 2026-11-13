import './__fixtures__/tz.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SerializedTransaction } from './fints-types';
import type { RecurringSeries } from './recurring.ts';
import { categorize } from './categorize.ts';
import { askNotes, historyMonths, NOTES_MAX, type AskNote, type NotesInput } from './ask-notes.ts';
import { IBAN, OWN_IBANS, OWN_SAVINGS, camt, mt940 } from './__fixtures__/transactions.ts';

const categoryOf = (tx: SerializedTransaction) => categorize(tx, { ownIbans: OWN_IBANS });
const TODAY = '2026-11-13';
const HISTORY = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];

const card = (day: string, amount: number, name: string, ref = `${name}|${day}|${amount}`) =>
  camt({ day, amount, code: 'POSD', text: 'Kartenzahlung', name, ref });

/** Two Lieferando orders a month before October, `october` in it. */
const lieferando = (october: number[]) => [
  ...HISTORY.flatMap((m) => [card(`${m}-06`, -20, 'Lieferando.de'), card(`${m}-20`, -20, 'Lieferando.de')]),
  ...october.map((amount, i) => card(`2026-10-${String(4 + i * 7).padStart(2, '0')}`, amount, 'Lieferando.de')),
];

const series = (id: string, over: Partial<RecurringSeries> = {}): RecurringSeries => ({
  id, key: `out|cred:${id}`, kind: 'expense', name: id.toUpperCase(), iban: null, creditorId: null, mandateReference: null,
  directDebit: true, category: 'subscriptions', cadence: 'monthly', cadenceLabel: 'monatlich', intervalDays: 30,
  amount: -9.99, lastAmount: -9.99, previousAmount: -9.99, changed: false, change: null, priceChange: null, variable: false,
  monthlyAmount: -9.99, yearlyAmount: -119.88, currency: 'EUR', count: 2, firstDate: '2026-10-20', lastDate: '2026-11-10',
  nextDate: '2026-12-10', overdue: false, ended: false, transactions: [], ...over,
} as RecurringSeries);

const input = (txs: SerializedTransaction[], over: Partial<NotesInput> = {}): NotesInput => ({
  txs, categoryOf, currency: 'EUR', from: '2026-05-01', to: TODAY, month: '2026-10', today: TODAY, series: [], live: [], ...over,
});

const kinds = (notes: AskNote[]) => notes.map((n) => n.kind);

test('history: whole loaded months before the month, the nearest first, at most twelve', () => {
  assert.deepEqual(historyMonths('2026-10', '2026-05-01', TODAY), ['2026-09', '2026-08', '2026-07', '2026-06', '2026-05']);
  assert.deepEqual(historyMonths('2026-10', '2026-05-02', TODAY), ['2026-09', '2026-08', '2026-07', '2026-06'], 'a cut month is no whole month');
  assert.equal(historyMonths('2026-10', '2020-01-01', TODAY).length, 12);
  assert.deepEqual(historyMonths('2026-10', '', TODAY), []);
});

test('a payee three times its usual: one note, the category it explains stays quiet', () => {
  const notes = askNotes(input(lieferando([-40, -40, -40])));
  assert.equal(notes.length, 1);
  const n = notes[0];
  assert.equal(n.kind, 'spike');
  if (n.kind !== 'spike') return;
  assert.equal(n.payee?.name, 'Lieferando.de');
  assert.equal(n.category, null);
  assert.equal(n.cents, 12000);
  assert.equal(n.usualCents, 4000);
  assert.equal(n.times, 3);
  assert.equal(n.from, '2026-10-01');
  assert.equal(n.to, '2026-10-31');
});

test('a multiple that is no whole 2 or 3 is said as "deutlich mehr" (no times)', () => {
  const [n] = askNotes(input(lieferando([-50, -50])));
  assert.equal(n?.kind, 'spike');
  if (n?.kind === 'spike') assert.equal(n.times, null);
});

test('calm: not enough above, not enough history, no usual', () => {
  // Three times as much, but only 20 € more.
  const small = [...HISTORY.map((m) => card(`${m}-10`, -10, 'Kiosk Ecke')), card('2026-10-10', -30, 'Kiosk Ecke')];
  assert.deepEqual(askNotes(input(small)), [], '3 times 10 € is only 20 € more');
  // Twice the average, but a month before was already higher.
  const summer = [...lieferando([-60, -60]), card('2026-07-25', -90, 'Lieferando.de')];
  assert.deepEqual(askNotes(input(summer)), [], 'July had 130 €, October 120 €');
  // Two months of history only.
  assert.deepEqual(askNotes(input(lieferando([-40, -40, -40]), { from: '2026-08-01' })), []);
  // A flight once in five months is no usual.
  const flights = [card('2026-06-14', -320, 'Lufthansa'), card('2026-10-02', -410, 'Lufthansa')];
  assert.deepEqual(askNotes(input(flights)), []);
  // Under the usual nothing is said.
  assert.deepEqual(askNotes(input(lieferando([-20, -20]))), []);
});

test('this month counts its days so far against whole months', () => {
  const txs = [...HISTORY.concat('2026-10').map((m) => card(`${m}-08`, -25, 'Lieferando.de')), card('2026-11-03', -40, 'Lieferando.de'), card('2026-11-09', -35, 'Lieferando.de')];
  const [n] = askNotes(input(txs, { month: '2026-11' }));
  assert.equal(n?.kind, 'spike');
  if (n?.kind === 'spike') {
    assert.equal(n.times, 3);
    assert.equal(n.to, TODAY);
  }
});

test('bookings of a known series count nowhere: a yearly insurance is no spike', () => {
  const huk = mt940({ day: '2026-10-01', amount: -486.3, gvc: '105', text: 'BASISLASTSCHRIFT', name: 'HUK-COBURG', iban: IBAN.kfz, purpose: 'KFZ BEITRAG' });
  const monthly = HISTORY.map((m) => mt940({ day: `${m}-01`, amount: -20, gvc: '105', text: 'BASISLASTSCHRIFT', name: 'HUK-COBURG', iban: IBAN.kfz, purpose: 'KLEINBEITRAG' }));
  const txs = [...monthly, huk];
  assert.equal(askNotes(input(txs)).length, 1, 'without the series it would stand out');
  assert.deepEqual(askNotes(input(txs, { series: [series('huk', { transactions: [huk], cadence: 'yearly' })] })), []);
});

test('Umbuchungen to an own account are no spike and no double debit', () => {
  const save = (day: string, amount: number) =>
    mt940({ day, amount, gvc: '116', text: 'UEBERWEISUNG', name: 'Nino Muster', iban: OWN_SAVINGS, purpose: `Sparen ${day}` });
  const txs = [...HISTORY.map((m) => save(`${m}-02`, -100)), save('2026-10-02', -437.5), save('2026-10-03', -437.5)];
  assert.deepEqual(askNotes(input(txs)), []);
});

test('a new subscription: first booking within 45 days, not one a notice or the user already names', () => {
  const disney = series('disney', { name: 'DISNEY PLUS' });
  const [n] = askNotes(input([], { live: [disney] }));
  assert.equal(n?.kind, 'newContract');
  if (n?.kind === 'newContract') {
    assert.equal(n.series.id, 'disney');
    assert.equal(n.cents, 999);
  }
  assert.deepEqual(askNotes(input([], { live: [series('old', { firstDate: '2026-09-01' })] })), [], '73 days old');
  assert.deepEqual(askNotes(input([], { live: [disney], noticed: ['disney'] })), []);
  assert.deepEqual(askNotes(input([], { live: [series('mine', { manual: true })] })), [], 'added by the user');
  assert.deepEqual(askNotes(input([], { live: [series('ended', { ended: true })] })), []);
  assert.deepEqual(askNotes(input([], { live: [series('pay', { kind: 'income', amount: 2400 })] })), []);
});

const amazon = (day: string, amount: number, eref: string) =>
  mt940({ day, amount, gvc: '105', text: 'BASISLASTSCHRIFT', name: 'AMAZON PAYMENTS EUROPE', iban: 'DE02300209000106531065', purpose: `${eref} AMAZON.DE`, eref });

test('a double debit: the same amount to the same payee within three days', () => {
  const txs = [amazon('2026-11-03', -49.99, '302-1'), amazon('2026-11-04', -49.99, '302-2')];
  const [n] = askNotes(input(txs, { month: '2026-11' }));
  assert.equal(n?.kind, 'double');
  if (n?.kind !== 'double') return;
  assert.equal(n.cents, 4999);
  assert.deepEqual(n.days, ['2026-11-03', '2026-11-04']);
  assert.equal(n.name, 'AMAZON PAYMENTS EUROPE');
  assert.equal(n.tx, txs[1]);
});

test('no double debit: refunded, round, too far apart, too small, one booking twice, a series, last month', () => {
  const pair = [amazon('2026-11-03', -49.99, '302-1'), amazon('2026-11-04', -49.99, '302-2')];
  const nov = { month: '2026-11' };
  assert.deepEqual(askNotes(input([...pair, amazon('2026-11-08', 49.99, '302-2R')], nov)), [], 'refunded since');
  assert.deepEqual(askNotes(input([amazon('2026-11-03', -50, 'a'), amazon('2026-11-04', -50, 'b')], nov)), [], 'a round sum');
  assert.deepEqual(askNotes(input([amazon('2026-11-01', -49.99, 'a'), amazon('2026-11-05', -49.99, 'b')], nov)), [], 'four days apart');
  assert.deepEqual(askNotes(input([amazon('2026-11-03', -12.99, 'a'), amazon('2026-11-04', -12.99, 'b')], nov)), [], 'under 20 €');
  assert.deepEqual(askNotes(input([amazon('2026-11-03', -49.99, 'a'), amazon('2026-11-03', -49.99, 'a')], nov)), [], 'the same key');
  assert.deepEqual(askNotes(input(pair, { ...nov, series: [series('prime', { transactions: [pair[0]] })] })), [], 'one of them is a contract');
  assert.deepEqual(askNotes(input(pair, { month: '2026-10' })), [], 'not in the month asked about');
  assert.equal(askNotes(input([amazon('2026-10-31', -49.99, 'a'), amazon('2026-11-02', -49.99, 'b')], nov)).length, 1, 'across the month\'s start');
});

test('the most pressing first, never more than three, a closed one stays closed', () => {
  const txs = [
    ...lieferando([-40, -40, -40]),
    amazon('2026-10-13', -49.99, 'a'), amazon('2026-10-14', -49.99, 'b'),
    amazon('2026-10-20', -64.9, 'c'), amazon('2026-10-22', -64.9, 'd'),
  ];
  const live = [series('disney'), series('dazn', { firstDate: '2026-11-02' })];
  const notes = askNotes(input(txs, { live }));
  assert.equal(notes.length, NOTES_MAX);
  assert.deepEqual(kinds(notes), ['double', 'double', 'newContract']);
  assert.equal(notes[2].kind === 'newContract' && notes[2].series.id, 'dazn', 'the newest contract first');
  const closed = new Set(notes.map((n) => n.key));
  assert.deepEqual(kinds(askNotes(input(txs, { live, dismissed: closed }))), ['newContract', 'spike']);
});

test('a contract is new only where the loaded bookings reach one step of its rhythm before it', () => {
  const disney = series('disney', { name: 'DISNEY PLUS' });
  // Umsätze only from 1 October: a monthly contract first seen on 20 October may well be older.
  assert.deepEqual(askNotes(input([], { live: [disney], from: '2026-10-01' })), []);
  assert.equal(askNotes(input([], { live: [disney], from: '2026-09-20' }))[0]?.kind, 'newContract');
  // A weekly one needs a week before it, a yearly one a year.
  assert.equal(askNotes(input([], { live: [series('w', { cadence: 'weekly', intervalDays: 7, everyDays: 7 })], from: '2026-10-10' }))[0]?.kind, 'newContract');
  assert.deepEqual(askNotes(input([], { live: [series('y', { cadence: 'yearly', intervalDays: 365 })] })), []);
});

test('a budget over in the month: one note, after a double debit, before a new contract; its category spike stays quiet', () => {
  // Lieferando three times its usual in October: Essen & Trinken over a 50 € budget.
  const txs = [
    ...lieferando([-40, -40, -40]),
    amazon('2026-10-13', -49.99, 'a'), amazon('2026-10-14', -49.99, 'b'),
  ];
  const live = [series('dazn', { firstDate: '2026-11-02' })];
  const notes = askNotes(input(txs, { live, budgets: { dining: 5000, shopping: 5000 } }));
  assert.deepEqual(kinds(notes), ['double', 'budget', 'newContract']);
  const b = notes[1];
  assert.equal(b.kind, 'budget');
  if (b.kind !== 'budget') return;
  assert.equal(b.category, 'dining');
  assert.equal(b.over, true);
  assert.equal(b.spent, 12000);
  assert.equal(b.rest, 7000);
  assert.equal(b.month, '2026-10');
  assert.equal(b.key, 'budget|2026-10|dining|over');
  // Only one budget note, though Shopping is over too; closed, the next budget takes its place.
  assert.equal(notes.filter((n) => n.kind === 'budget').length, 1);
  const next = askNotes(input(txs, { live, budgets: { dining: 5000, shopping: 5000 }, dismissed: new Set([b.key]) }));
  assert.deepEqual(next.filter((n) => n.kind === 'budget').map((n) => n.kind === 'budget' && n.category), ['shopping']);
});

test('a budget nearly used up is a note only before the 20th of the running month', () => {
  const txs = [card('2026-11-03', -46, 'Lieferando.de')];
  const early = askNotes(input(txs, { month: '2026-11', budgets: { dining: 5000 } }));
  assert.deepEqual(early.map((n) => n.kind === 'budget' && [n.over, n.rest]), [[false, 400]]);
  const late = askNotes(input(txs, { month: '2026-11', today: '2026-11-21', to: '2026-11-21', budgets: { dining: 5000 } }));
  assert.deepEqual(late, []);
  assert.deepEqual(askNotes(input(txs, { month: '2026-11', budgets: { dining: 6000 } })), [], 'under 90 %');
  assert.deepEqual(askNotes(input(txs, { month: '2026-11' })), [], 'no budgets');
});
