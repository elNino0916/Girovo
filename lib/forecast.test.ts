import './__fixtures__/tz.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RecurringSeries } from './recurring';
import type { SerializedBankOrder } from './fints-types';
import { forecast, monthEnd, seriesDates, usualSpending } from './forecast.ts';
import { mt940 } from './__fixtures__/transactions.ts';

const series = (over: Partial<RecurringSeries>): RecurringSeries => ({
  id: 'rec_x', key: 'x', kind: 'expense', name: 'Netflix', iban: null, creditorId: null, mandateReference: null,
  directDebit: true, category: 'media', cadence: 'monthly', cadenceLabel: '', intervalDays: 30, amount: -12.99,
  lastAmount: -12.99, previousAmount: null, changed: false, change: null, variable: false, monthlyAmount: -12.99,
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
