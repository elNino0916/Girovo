import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AFFORD_TIGHT_CENTS, affordIntentOf, affordOutcome, forecastReaches, monthlySpending, tightLine,
} from './ask-afford.ts';
import { budgetIntentOf } from './ask-budgets.ts';
import { factOf, isFact } from './ask-facts.ts';
import { intentOf } from './ask-intents.ts';

const TODAY = '2026-11-12';
const read = (q: string) => intentOf(q, [], TODAY);

test('an amount asked against the forecast, in many words', () => {
  const cases: Array<[string, number, string | null]> = [
    ['Kann ich mir 800 € leisten?', 80000, null],
    ['kann ich mir 800€ leisten', 80000, null],
    ['Kann ich mir 800 Euro leisten', 80000, null],
    ['Reicht mein Geld für einen Urlaub für 600 €?', 60000, null],
    ['Kann ich diesen Monat noch 200 € ausgeben?', 20000, null],
    ['Geht sich eine 1.200 € Reparatur im Dezember aus?', 120000, '2026-12'],
    ['kann ich mir ein neues handy für 900 euro leisten', 90000, null],
    ['hab ich genug geld für 300€', 30000, null],
    ['Ist ein Fernseher für 800 € noch drin?', 80000, null],
    ['Kann ich mir 1,5k leisten', 150000, null],
    ['kann ich mir 2.500 euro leisten', 250000, null],
    ['Kann ich mir 49,99 € gönnen?', 4999, null],
    ['Kann ich noch 200 € bei Amazon ausgeben?', 20000, null],
    ['Can I afford €800?', 80000, null],
    ['can i afford 800 euros', 80000, null],
    ['do i have enough money for a €600 holiday', 60000, null],
    ['can i spend 200 this month', 20000, null],
    ['is €1,200 affordable in december', 120000, '2026-12'],
  ];
  for (const [q, cents, month] of cases) {
    assert.deepEqual(read(q), { kind: 'afford', cents, month }, q);
    assert.deepEqual(factOf(q, [], TODAY), { kind: 'afford', cents, month }, q);
  }
});

test('the month asked about: this one by default, else the one named', () => {
  assert.equal(affordIntentOf('Kann ich mir bis Monatsende 300 € leisten?', TODAY)?.month, null);
  assert.equal(affordIntentOf('Kann ich mir im November 300 € leisten?', TODAY)?.month, '2026-11');
  assert.equal(affordIntentOf('Kann ich mir nächsten Monat 500 € leisten?', TODAY)?.month, '2026-12');
  assert.equal(affordIntentOf('Kann ich mir im Mai 400 € leisten', TODAY)?.month, '2027-05');
  assert.equal(affordIntentOf('can i afford 400 in may', TODAY)?.month, '2027-05');
  assert.equal(affordIntentOf('Kann ich mir zu Weihnachten 300 € leisten?', TODAY)?.month, '2026-12');
  // A day: its month, and its digits are no amount.
  assert.deepEqual(affordIntentOf('Kann ich mir am 15.12. 300 € leisten?', TODAY), { kind: 'afford', cents: 30000, month: '2026-12' });
  // "May I …" is no month.
  assert.deepEqual(affordIntentOf('May I spend 300 euros?', TODAY), { kind: 'afford', cents: 30000, month: null });
});

test('without an amount, it asks for one instead of guessing', () => {
  for (const q of ['Kann ich mir das leisten?', 'Was kann ich mir leisten?', 'Can I afford it?', 'Reicht mein Geld für einen Urlaub?', 'do i have enough money for a new phone']) {
    assert.deepEqual(read(q), { kind: 'afford', cents: null, month: null }, q);
  }
  // Two bare numbers: which is the amount is not known.
  assert.equal(affordIntentOf('Kann ich mir 3 Nächte für 400 leisten?', TODAY)?.cents, null);
});

test('budgets stay budgets, the month end stays the month end', () => {
  assert.deepEqual(read('Reicht mein Budget für Essen?'), { kind: 'budgetLeft', category: null, name: 'essen' });
  assert.deepEqual(read('Reicht mein Budget für 200 € Essen?'), { kind: 'budgetLeft', category: null, name: 'essen' });
  assert.deepEqual(read('Reicht mein Budget?'), { kind: 'budgetLeft', category: null, name: null });
  assert.deepEqual(read('Wie viel darf ich diesen Monat noch für Essen ausgeben?'), { kind: 'budgetLeft', category: null, name: 'essen' });
  assert.deepEqual(read('Reicht ein Budget von 300 € für Lebensmittel?'), { kind: 'budgetLeft', category: 'groceries', name: null });
  assert.equal(affordIntentOf('Reicht mein Budget für 200 € Essen?', TODAY), null);
  assert.deepEqual(budgetIntentOf('Leg ein Budget für Lebensmittel an'), null);
  assert.deepEqual(read('Reicht es bis Monatsende?'), { kind: 'monthEnd' });
  assert.deepEqual(read('reicht mein geld noch bis zum gehalt'), { kind: 'monthEnd' });
  assert.deepEqual(read('überweis lea 50 euro'), { kind: 'prepareTransfer', name: 'Lea', cents: 5000, purpose: null });
});

test('none of these: the bookings, the month as a whole, small talk', () => {
  for (const q of [
    'Wie viel hab ich bei Amazon ausgegeben?', 'Was habe ich im Oktober für Lebensmittel ausgegeben?', 'Reicht mein Geld für den Rest des Monats?',
    'reichen 400 euro noch für den monat', 'Geht sich das aus?', 'Hallo', 'Wie viel kann ich diesen Monat noch ausgeben',
  ]) {
    assert.equal(affordIntentOf(q, TODAY), null, q);
  }
});

test('it is one of the app’s figures', () => {
  assert.equal(isFact({ kind: 'afford', cents: 100, month: null }), true);
});

test('fits, tight, or not: the lowest balance less the amount', () => {
  const low = { date: '2026-11-27', balance: 1000 };
  assert.deepEqual(affordOutcome({ low, cents: 80000, tight: 10000 }), { state: 'fits', left: 20000, day: '2026-11-27' });
  assert.deepEqual(affordOutcome({ low, cents: 90000, tight: 10000 }), { state: 'fits', left: 10000, day: '2026-11-27' });
  assert.deepEqual(affordOutcome({ low, cents: 95000, tight: 10000 }), { state: 'tight', left: 5000, day: '2026-11-27' });
  assert.deepEqual(affordOutcome({ low, cents: 100000, tight: 10000 }), { state: 'tight', left: 0, day: '2026-11-27' });
  assert.deepEqual(affordOutcome({ low, cents: 120000, tight: 10000 }), { state: 'short', under: 20000, day: '2026-11-27', dispo: false, already: false });
});

test('with a Dispo: within it, or past it', () => {
  const low = { date: '2026-11-27', balance: 500 };
  assert.deepEqual(affordOutcome({ low, cents: 80000, creditLimit: 1000, tight: 10000 }), { state: 'short', under: 30000, day: '2026-11-27', dispo: true, already: false });
  assert.deepEqual(affordOutcome({ low, cents: 200000, creditLimit: 1000, tight: 10000 }), { state: 'overDispo', over: 50000, day: '2026-11-27', already: false });
  // Exactly at the Dispo is still within it.
  assert.deepEqual(affordOutcome({ low, cents: 150000, creditLimit: 1000, tight: 10000 }), { state: 'short', under: 100000, day: '2026-11-27', dispo: true, already: false });
});

test('a balance below zero already, and the low on today', () => {
  const below = affordOutcome({ low: { date: '2026-11-20', balance: -50 }, cents: 1000, tight: 10000 });
  assert.deepEqual(below, { state: 'short', under: 6000, day: '2026-11-20', dispo: false, already: true });
  const today = affordOutcome({ low: { date: TODAY, balance: 2000.55 }, cents: 50000, tight: 10000 });
  assert.deepEqual(today, { state: 'fits', left: 150055, day: TODAY });
  // A negative amount is the same spending.
  assert.deepEqual(affordOutcome({ low: { date: TODAY, balance: 100 }, cents: -5000, tight: 10000 }), { state: 'tight', left: 5000, day: TODAY });
});

test('tight: 100 € at least, else a tenth of the usual month', () => {
  assert.equal(tightLine(0), AFFORD_TIGHT_CENTS);
  assert.equal(tightLine(50000), 10000);
  assert.equal(tightLine(300000), 30000);
  // Regular payments a month (negative) and the usual spending a day over 30 days.
  assert.equal(monthlySpending([-850, -12.99], -40), 85000 + 1299 + 120000);
  assert.equal(monthlySpending([], null), 0);
});

test('the forecast reaches only this month', () => {
  assert.equal(forecastReaches(null, '2026-11-30'), true);
  assert.equal(forecastReaches('2026-11', '2026-11-30'), true);
  assert.equal(forecastReaches('2026-12', '2026-11-30'), false);
});

test('an amount with a dot is no day: "1.527 €" stays 1.527 €', () => {
  assert.deepEqual(affordIntentOf('Kann ich mir 1.527 € leisten?', TODAY), { kind: 'afford', cents: 152700, month: null });
  assert.deepEqual(affordIntentOf('Can I afford €1,527?', TODAY), { kind: 'afford', cents: 152700, month: null });
  assert.deepEqual(affordIntentOf('Kann ich mir 12.127 € leisten?', TODAY), { kind: 'afford', cents: 1212700, month: null });
  assert.deepEqual(affordIntentOf('Kann ich mir 1.200 € am 15.12. leisten?', TODAY), { kind: 'afford', cents: 120000, month: '2026-12' });
});

test('only money is the amount: a model number, inches or people are none', () => {
  for (const q of ['Kann ich mir ein iPhone 16 leisten?', 'Kann ich mir einen Fernseher mit 55 Zoll leisten?', 'Kann ich mir einen Urlaub mit 3 Leuten leisten?', 'Can I afford an iPhone 16?']) {
    assert.deepEqual(affordIntentOf(q, TODAY), { kind: 'afford', cents: null, month: null }, q);
  }
  assert.equal(affordIntentOf('Kann ich mir 3 Tsd leisten?', TODAY)?.cents, 300000);
  assert.equal(affordIntentOf('Kann ich mir 2 tausend leisten?', TODAY)?.cents, 200000);
  assert.equal(affordIntentOf('Kann ich diesen Monat noch 200 ausgeben?', TODAY)?.cents, 20000);
});
