import './__fixtures__/tz.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RecurringSeries } from './recurring';
import type { SerializedBankOrder, SerializedTransaction } from './fints-types';
import { forecast, monthEnd, seriesDates, usualSpending } from './forecast.ts';
import { CRED, IBAN, camt, mt940 } from './__fixtures__/transactions.ts';
import { detectRecurring } from './recurring.ts';

const series = (over: Partial<RecurringSeries>): RecurringSeries => ({
  id: 'rec_x', key: 'x', kind: 'expense', name: 'Netflix', iban: null, creditorId: null, mandateReference: null,
  directDebit: true, category: 'media', cadence: 'monthly', cadenceLabel: '', intervalDays: 30, amount: -12.99,
  lastAmount: -12.99, previousAmount: null, changed: false, change: null, priceChange: null, variable: false, monthlyAmount: -12.99,
  yearlyAmount: -155.88, currency: 'EUR', count: 3, firstDate: '2026-07-15', lastDate: '2026-09-15',
  nextDate: '2026-10-15', overdue: false, ended: false, transactions: [], ...over,
});

const order = (over: Partial<SerializedBankOrder>): SerializedBankOrder => ({
  ref: 'r', kind: 'standing', orderId: '1', name: 'Hausverwaltung', iban: 'DE75512108001245126199', bic: null,
  amount: 850, currency: 'EUR', purpose: 'Miete', schedule: { kind: 'standing', first: '2026-01-01', unit: 'M', interval: 1, day: 30 },
  more: 0, deletable: true, changeable: true, ...over,
});

test('the month end, and the days a series comes on', () => {
  assert.equal(monthEnd('2026-02-10'), '2026-02-28');
  assert.equal(monthEnd('2026-10-19'), '2026-10-31');
  assert.deepEqual(seriesDates(series({ nextDate: '2026-10-22' }), '2026-10-19', '2026-10-31'), ['2026-10-22']);
  assert.deepEqual(seriesDates(series({ nextDate: '2026-11-02' }), '2026-10-19', '2026-10-31'), []);
  assert.deepEqual(
    seriesDates(series({ cadence: 'weekly', nextDate: '2026-10-20' }), '2026-10-19', '2026-10-31'),
    ['2026-10-20', '2026-10-27'],
  );
  assert.deepEqual(seriesDates(series({ ended: true, nextDate: '2026-10-22' }), '2026-10-19', '2026-10-31'), []);
});

test('the forecast walks the days: the low, the end, and the line it crosses', () => {
  const f = forecast({
    today: '2026-10-19',
    balance: 400,
    currency: 'EUR',
    series: [
      series({ name: 'Telekom', amount: -40, nextDate: '2026-10-21' }),
      // The salary comes after the rent: the low is before it.
      series({ name: 'ACME', kind: 'income', amount: 2600, nextDate: '2026-10-30' }),
      // Detected from the bookings, and the bank's own order for the same payment: counted once.
      series({ name: 'Hausverwaltung', amount: -850, iban: 'DE75 5121 0800 1245 1261 99', nextDate: '2026-10-30' }),
    ],
    orders: [order({ schedule: { kind: 'standing', first: '2026-01-29', unit: 'M', interval: 1, day: 29 } })],
    pending: [mt940({ day: '2026-10-19', amount: -60 })],
    usual: { perDay: -10, months: 2 },
    creditLimit: 1000,
  });
  assert.equal(f.until, '2026-10-31');
  // 400 − 60 (vorgemerkt) − 40 − 850 + 2600 − 12 days × 10.
  assert.equal(f.end, 400 - 60 - 40 - 850 + 2600 - 120);
  assert.deepEqual(f.low, { date: '2026-10-29', balance: 400 - 60 - 40 - 850 - 100 });
  assert.deepEqual(f.breach, { date: '2026-10-29', balance: -650, line: 'zero' });
  assert.equal(f.events.filter((e) => e.kind === 'series').length, 2, 'the rent comes from the order, not the series');
  assert.equal(f.events[0].kind, 'pending');

  // Past the Dispo is the line said once it is crossed.
  const deeper = forecast({
    today: '2026-10-19', balance: 100, currency: 'EUR', series: [], orders: [order({ amount: 1500 })], pending: [], usual: null, creditLimit: 1000,
  });
  assert.deepEqual(deeper.breach, { date: '2026-10-30', balance: -1400, line: 'limit' });

  // A card is negative by nature: no warning.
  const card = forecast({ today: '2026-10-19', balance: -300, currency: 'EUR', series: [], orders: [], pending: [], usual: null, card: true });
  assert.equal(card.breach, null);
});

test('usual spending is learnt from whole loaded months only, and never counts on windfalls', () => {
  const txs = [
    mt940({ day: '2026-09-03', amount: -300 }),
    mt940({ day: '2026-09-20', amount: -150 }),
    mt940({ day: '2026-08-12', amount: -90 }),
    mt940({ day: '2026-10-02', amount: -999 }), // this month: not learnt from
  ];
  const usual = usualSpending({ txs, inSeries: new Set(), loaded: { from: '2026-08-01', to: '2026-10-19' }, today: '2026-10-19', currency: 'EUR' });
  assert.ok(usual);
  assert.equal(usual.months, 2);
  assert.equal(Math.round(usual.perDay * 100), Math.round((-540 / 61) * 100));
  // August only half loaded: September alone.
  assert.equal(usualSpending({ txs, inSeries: new Set(), loaded: { from: '2026-08-15', to: '2026-10-19' }, today: '2026-10-19', currency: 'EUR' })?.months, 1);
  // Nothing whole loaded: no estimate.
  assert.equal(usualSpending({ txs, inSeries: new Set(), loaded: { from: '2026-09-15', to: '2026-10-19' }, today: '2026-10-19', currency: 'EUR' }), null);
  // A month of refunds says nothing about the next one.
  const refunds = [mt940({ day: '2026-09-03', amount: 500 })];
  assert.equal(usualSpending({ txs: refunds, inSeries: new Set(), loaded: { from: '2026-09-01', to: '2026-10-19' }, today: '2026-10-19', currency: 'EUR' })?.perDay, 0);
});

// ---------------------------------------------------------------------------
// What is already booked, or already vorgemerkt, is not expected a second time.

const rentBooked = (day: string) =>
  mt940({ day, amount: -850, gvc: '117', text: 'DAUERAUFTRAG', name: 'Hausverwaltung', iban: IBAN.landlord, purpose: 'Miete' });

test('an order due today that is already in the statement is not taken off again', () => {
  const rent = order({ schedule: { kind: 'standing', first: '2026-01-02', unit: 'M', interval: 1, day: 2 } });
  const base = { today: '2026-11-02', balance: 1000, currency: 'EUR', series: [], orders: [rent], pending: [], usual: null };
  // Booked this morning: today's balance of 1000 already has it.
  const booked = forecast({ ...base, bookings: [rentBooked('2026-11-02'), rentBooked('2026-10-02')] });
  assert.deepEqual(booked.events, []);
  assert.equal(booked.end, 1000);
  // Not booked yet: it is still to come.
  const open = forecast({ ...base, bookings: [rentBooked('2026-10-02')] });
  assert.deepEqual(open.events.map((e) => [e.date, e.amount, e.kind]), [['2026-11-02', -850, 'order']]);
  assert.equal(open.end, 150);
  // Another payment to the same payee is not the order's.
  const other = forecast({ ...base, bookings: [{ ...rentBooked('2026-11-02'), amount: -40 }] });
  assert.equal(other.end, 150);
  // Without the bookings, the order's own series says it: its newest booking is today's.
  const rentSeries = series({ name: 'Hausverwaltung', amount: -850, iban: IBAN.landlord, lastDate: '2026-11-02', nextDate: '2026-12-02' });
  const bySeries = forecast({ ...base, series: [rentSeries] });
  assert.deepEqual(bySeries.events, []);
  assert.equal(bySeries.end, 1000);
});

const netflixDebit = (day: string, amount = -13.99) =>
  mt940({ day, amount, gvc: '105', text: 'BASISLASTSCHRIFT', name: 'Netflix International B.V.', iban: IBAN.netflix, cred: CRED.netflix, mref: 'NF-778', purpose: 'Netflix Monatsabo' });

test('a regular payment that is already vorgemerkt is counted once', () => {
  // The 12th, three months running; today is the 11th and the debit is announced.
  const live = detectRecurring(['2026-08-12', '2026-09-14', '2026-10-12'].map((d) => netflixDebit(d)), { today: new Date(2026, 10, 11) });
  assert.deepEqual(live.map((s) => s.nextDate), ['2026-11-12']);
  const base = { today: '2026-11-11', balance: 100, currency: 'EUR', series: live, orders: [], usual: null };
  const f = forecast({ ...base, pending: [netflixDebit('2026-11-11')] });
  assert.deepEqual(f.events.map((e) => [e.date, e.amount, e.kind]), [['2026-11-11', -13.99, 'pending']]);
  assert.equal(f.end, 86.01);
  // Somebody else's 13,99 leaves the contract expected.
  const stranger = mt940({ day: '2026-11-11', amount: -13.99, gvc: '106', text: 'KARTENZAHLUNG', name: 'BUCHHANDLUNG AM MARKT' });
  assert.deepEqual(
    forecast({ ...base, pending: [stranger] }).events.map((e) => [e.date, e.kind]),
    [['2026-11-11', 'pending'], ['2026-11-12', 'series']],
  );
  // Another charge from the same creditor (ten times the price) is not the contract's month.
  assert.equal(forecast({ ...base, pending: [netflixDebit('2026-11-11', -139.9)] }).events.length, 2);
  // Vorgemerkt weeks before its day: the contract's own booking is still to come.
  const early = forecast({ ...base, today: '2026-11-02', pending: [netflixDebit('2026-11-02')] });
  assert.deepEqual(early.events.map((e) => [e.date, e.kind]), [['2026-11-02', 'pending'], ['2026-11-12', 'series']]);

  // The bank's own order, vorgemerkt the day before it runs: the payee's IBAN and the amount.
  const rent = order({ schedule: { kind: 'standing', first: '2026-01-12', unit: 'M', interval: 1, day: 12 } });
  const ordered = forecast({ ...base, series: [], orders: [rent], pending: [rentBooked('2026-11-11')] });
  assert.deepEqual(ordered.events.map((e) => [e.date, e.amount, e.kind]), [['2026-11-11', -850, 'pending']]);
  assert.equal(ordered.end, -750);
});

test('a regular payment a few days late is still to come, until the contracts list calls it overdue', () => {
  const telekom = (day: string) =>
    mt940({ day, amount: -39.99, gvc: '105', text: 'BASISLASTSCHRIFT', name: 'Telekom Deutschland GmbH', iban: 'DE12500105170000077777', cred: 'DE93ZZZ00000078611', mref: 'TK-4711', purpose: 'Mobilfunk' });
  const txs = ['2026-07-06', '2026-08-05', '2026-09-07', '2026-10-05'].map(telekom);
  const on = (day: number, more: { pending?: ReturnType<typeof telekom>[]; loadedTo?: string } = {}) => {
    const live = detectRecurring(txs, { today: new Date(2026, 10, day) });
    assert.deepEqual(live.map((s) => s.nextDate), ['2026-11-05']);
    const today = `2026-11-${String(day).padStart(2, '0')}`;
    return { live: live[0], today, f: forecast({ today, balance: 100, currency: 'EUR', series: live, orders: [], pending: [], usual: null, ...more }) };
  };
  // Due on the 5th. Not booked by the 6th, the 8th, the 10th: late, not gone — it comes any day now.
  for (const day of [5, 6, 8, 10]) {
    const { live, today, f } = on(day);
    assert.equal(live.overdue, false, today);
    assert.deepEqual(f.events.map((e) => [e.date, e.amount, e.kind]), [[today, -39.99, 'series']], today);
    assert.equal(f.end, 60.01, today);
  }
  // From the 11th the contracts list says "überfällig": no longer counted on.
  const gone = on(11);
  assert.equal(gone.live.overdue, true);
  assert.deepEqual(gone.f.events, []);
  // Late and vorgemerkt at last: once.
  assert.deepEqual(on(8, { pending: [telekom('2026-11-08')] }).f.events.map((e) => e.kind), ['pending']);
  // The Umsätze end before its day: whether it was booked since is not known, so nothing is added.
  assert.deepEqual(on(8, { loadedTo: '2026-11-04' }).f.events, []);
  assert.equal(on(8, { loadedTo: '2026-11-08' }).f.events.length, 1);

  assert.deepEqual(seriesDates(series({ nextDate: '2026-10-16' }), '2026-10-19', '2026-10-31'), ['2026-10-19']);
  assert.deepEqual(seriesDates(series({ nextDate: '2026-10-16', overdue: true }), '2026-10-19', '2026-10-31'), []);
  // More than the five days of grace behind today (the series was judged against older Umsätze): not expected today.
  assert.deepEqual(seriesDates(series({ nextDate: '2026-10-12' }), '2026-10-19', '2026-10-31'), []);
  // A weekly one that is late: today, and its next ones.
  assert.deepEqual(
    seriesDates(series({ cadence: 'weekly', nextDate: '2026-10-16' }), '2026-10-19', '2026-10-31'),
    ['2026-10-19', '2026-10-23', '2026-10-30'],
  );
});

test('an order speaks for its series only when it runs in the days ahead', () => {
  const rent = series({ name: 'Hausverwaltung', amount: -850, iban: IBAN.landlord, lastDate: '2026-10-16', nextDate: '2026-11-16' });
  const on = (o: SerializedBankOrder) =>
    forecast({ today: '2026-11-10', balance: 1000, currency: 'EUR', series: [rent], orders: [o], pending: [], usual: null });
  const kinds = (o: SerializedBankOrder) => on(o).events.map((e) => [e.date, e.amount, e.kind]);
  const monthly = { kind: 'standing', first: '2026-01-15', unit: 'M', interval: 1, day: 15 } as const;
  // The bank's own day wins over the guess, and the payment is counted once.
  assert.deepEqual(kinds(order({ schedule: monthly })), [['2026-11-15', -850, 'order']]);
  // The bank's answer did not say when it runs: the series is all there is.
  assert.deepEqual(kinds(order({ schedule: null })), [['2026-11-16', -850, 'series']]);
  assert.equal(on(order({ schedule: null })).end, 150);
  // An order that has run out, and one whose next turn is after the month's end.
  assert.deepEqual(kinds(order({ schedule: { ...monthly, last: '2026-10-15' } })), [['2026-11-16', -850, 'series']]);
  assert.deepEqual(kinds(order({ schedule: { kind: 'dated', date: '2026-12-01' } })), [['2026-11-16', -850, 'series']]);
  // The same payee and figure in another currency is another payment.
  assert.deepEqual(kinds(order({ schedule: monthly, currency: 'USD' })), [['2026-11-16', -850, 'series']]);
});

test('a weekly order runs every week to the month\'s end, not once', () => {
  // Mondays. Today is Tuesday the 10th: the 16th, the 23rd and the 30th are still to come.
  const weekly = { kind: 'standing', first: '2026-01-05', unit: 'W', interval: 1, day: 1 } as const;
  const on = (today: string, o: SerializedBankOrder, more: { pending?: SerializedTransaction[]; bookings?: SerializedTransaction[] } = {}) =>
    forecast({ today, balance: 1000, currency: 'EUR', series: [], orders: [o], pending: [], usual: null, ...more });
  const days = (f: ReturnType<typeof forecast>) => f.events.filter((e) => e.kind === 'order').map((e) => e.date);
  const pocket = order({ name: 'Lena Muster', iban: IBAN.person, amount: 50, schedule: weekly });
  const f = on('2026-11-10', pocket);
  assert.deepEqual(days(f), ['2026-11-16', '2026-11-23', '2026-11-30']);
  assert.equal(f.end, 850);
  // Every second week, and one that ends on the way.
  assert.deepEqual(days(on('2026-11-10', order({ amount: 50, schedule: { ...weekly, first: '2026-11-02', interval: 2 } }))), ['2026-11-16', '2026-11-30']);
  assert.deepEqual(days(on('2026-11-10', order({ amount: 50, schedule: { ...weekly, last: '2026-11-23' } }))), ['2026-11-16', '2026-11-23']);
  // A monthly one and a dated one still come once.
  assert.deepEqual(days(on('2026-11-10', order({}))), ['2026-11-30']);
  assert.deepEqual(days(on('2026-11-10', order({ kind: 'dated', schedule: { kind: 'dated', date: '2026-11-20' } }))), ['2026-11-20']);
  // Today's turn already booked: the later ones stay.
  const paid = (day: string) => mt940({ day, amount: -50, gvc: '117', text: 'DAUERAUFTRAG', name: 'Lena Muster', iban: IBAN.person, purpose: 'Taschengeld' });
  assert.deepEqual(days(on('2026-11-16', pocket, { bookings: [paid('2026-11-16')] })), ['2026-11-23', '2026-11-30']);
  // Vorgemerkt on the Friday before: that one Monday is the Vorgemerkte, the others are still expected.
  const announced = on('2026-11-13', pocket, { pending: [paid('2026-11-13')] });
  assert.deepEqual(days(announced), ['2026-11-23', '2026-11-30']);
  assert.equal(announced.end, 850);

  // A weekly series the same: every week, each on a business day.
  assert.deepEqual(
    seriesDates(series({ cadence: 'weekly', lastDate: '2026-11-02', nextDate: '2026-11-09' }), '2026-11-09', '2026-11-30'),
    ['2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'],
  );
  // Fridays, and Good Friday 2027 moved the next one to the Tuesday after Easter: the ones after it are Fridays again.
  assert.deepEqual(
    seriesDates(series({ cadence: 'weekly', lastDate: '2027-03-19', nextDate: '2027-03-30' }), '2027-03-20', '2027-04-30'),
    ['2027-03-30', '2027-04-02', '2027-04-09', '2027-04-16', '2027-04-23', '2027-04-30'],
  );
});

test('the forecast takes the series as Verträge & Abos reads them: no bonus as salary, every fourth week twice in a long month', () => {
  // 2500 from May to October, 5000 in November (the Christmas bonus): December is expected at 2500.
  const pay = (day: string, amount: number) => camt({ day, amount, code: 'SALA', text: 'Lohn/Gehalt', name: 'ACME GmbH', iban: IBAN.employer });
  const salary = detectRecurring(
    [...['2026-05-29', '2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30', '2026-10-30'].map((d) => pay(d, 2500)), pay('2026-11-30', 5000)],
    { today: new Date(2026, 11, 1) },
  );
  const december = forecast({ today: '2026-12-01', balance: 100, currency: 'EUR', series: salary, orders: [], pending: [], usual: null });
  assert.deepEqual(december.events.map((e) => [e.date, e.amount]), [['2026-12-30', 2500]]);
  assert.equal(december.end, 2600);

  // 60 € every 28 days, last on 5 October: due on 2 and on 30 November.
  const clean = (day: string) =>
    camt({ day, amount: -60, code: 'ESDD', text: 'SEPA-Basislastschrift', name: 'Putzdienst Sauber GmbH', iban: 'DE21500105170000066666', mref: 'PD-28', purpose: 'CRED+DE77ZZZ00000066666 Reinigung' });
  const every28 = detectRecurring(['2026-06-15', '2026-07-13', '2026-08-10', '2026-09-07', '2026-10-05'].map(clean), { today: new Date(2026, 10, 1) });
  const november = forecast({ today: '2026-11-01', balance: 500, currency: 'EUR', series: every28, orders: [], pending: [], usual: null });
  assert.deepEqual(november.events.map((e) => [e.date, e.amount]), [['2026-11-02', -60], ['2026-11-30', -60]]);
  assert.equal(november.end, 380);
});
