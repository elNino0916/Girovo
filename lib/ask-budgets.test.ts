import './__fixtures__/tz.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SerializedTransaction } from './fints-types';
import { categorize } from './categorize.ts';
import {
  budgetIntentOf, budgetsAsked, budgetsToNote, daysLeftInMonth, monthBudgets, perDayLeft, tightBudgets, usedShare,
} from './ask-budgets.ts';
import { factOf } from './ask-facts.ts';
import { intentOf } from './ask-intents.ts';
import { OWN_IBANS, camt } from './__fixtures__/transactions.ts';

const categoryOf = (tx: SerializedTransaction) => categorize(tx, { ownIbans: OWN_IBANS });
const card = (day: string, amount: number, name: string) =>
  camt({ day, amount, code: 'POSD', text: 'Kartenzahlung', name, ref: `${name}|${day}|${amount}` });

test('what is left in a budget, by its category or by a word for it', () => {
  assert.deepEqual(budgetIntentOf('Was ist noch im Lebensmittel-Budget?'), { kind: 'budgetLeft', category: 'groceries', name: null });
  assert.deepEqual(budgetIntentOf('how much is left in my groceries budget'), { kind: 'budgetLeft', category: 'groceries', name: null });
  assert.deepEqual(budgetIntentOf('Wie viel darf ich diesen Monat noch für Essen ausgeben?'), { kind: 'budgetLeft', category: null, name: 'essen' });
  assert.deepEqual(budgetIntentOf('Wie viel ist noch im Essensbudget'), { kind: 'budgetLeft', category: null, name: 'essen' });
  assert.deepEqual(budgetIntentOf('how much can i still spend on eating out'), { kind: 'budgetLeft', category: 'dining', name: null });
  assert.deepEqual(budgetIntentOf('Bin ich beim Lebensmittelbudget drüber?'), { kind: 'budgetLeft', category: 'groceries', name: null });
  assert.deepEqual(budgetIntentOf('Wie stehen meine Budgets?'), { kind: 'budgetLeft', category: null, name: null });
  assert.deepEqual(budgetIntentOf('Was ist noch im Hundebudget'), { kind: 'budgetLeft', category: null, name: 'hunde' });
});

test('every budget over or nearly used up', () => {
  for (const q of ['Wo bin ich über dem Budget?', 'Welche Budgets reichen nicht?', 'which budgets am i over', 'Welche Budgets sind fast aufgebraucht?']) {
    assert.deepEqual(budgetIntentOf(q), { kind: 'budgetsOver' }, q);
  }
});

test('no budget question: making one, the bookings, income', () => {
  for (const q of [
    'Leg ein Budget für Lebensmittel an', 'Setz das Budget für Essen auf 300 Euro', 'Wie viel hab ich für Essen ausgegeben?',
    'Wie viel habe ich im Oktober für Lebensmittel ausgegeben', 'Wie viel Gehalt ist noch übrig', 'Wie viel kann ich diesen Monat noch ausgeben',
  ]) {
    assert.equal(budgetIntentOf(q), null, q);
  }
  // The bookings still answer what was spent.
  assert.equal(intentOf('Wie viel hab ich für Essen ausgegeben?'), null);
  assert.deepEqual(factOf('Was ist noch im Lebensmittel-Budget?'), { kind: 'budgetLeft', category: 'groceries', name: null });
});

const TODAY = '2026-11-13';
const NOVEMBER = [
  card('2026-11-02', -120, 'REWE Markt GmbH'),
  card('2026-11-09', -95.5, 'REWE Markt GmbH'),
  card('2026-11-05', -60, 'Pizzeria Da Mario'),
  card('2026-10-28', -200, 'REWE Markt GmbH'),
];

test('this month against the budgets, as the tile counts it', () => {
  const m = monthBudgets({ groceries: 30000, dining: 5000, mobility: 10000 }, NOVEMBER, {
    categoryOf, currency: 'EUR', from: '2026-08-01', to: TODAY, today: TODAY,
  });
  assert.equal(m.month, '2026-11');
  assert.equal(m.coverage, 'running');
  assert.equal(m.from, '2026-11-01');
  assert.equal(m.to, TODAY);
  const by = Object.fromEntries(m.lines.map((l) => [l.id, l]));
  assert.equal(by.groceries.spent, 21550, 'October is not in November');
  assert.equal(by.groceries.state, 'left');
  assert.equal(by.groceries.rest, 8450);
  assert.equal(by.dining.state, 'over');
  assert.equal(by.dining.rest, 1000);
  assert.equal(by.mobility.spent, 0);
  // 18 days from the 13th to the 30th, today counted.
  assert.equal(daysLeftInMonth(TODAY), 18);
  assert.equal(perDayLeft(by.groceries, TODAY), 469);
  assert.equal(perDayLeft(by.dining, TODAY), null);
  assert.deepEqual(tightBudgets(m.lines).map((l) => l.id), ['dining']);
});

test('a month not loaded from its first day: spending is a floor, nothing is left to say', () => {
  const m = monthBudgets({ groceries: 30000 }, NOVEMBER, { categoryOf, currency: 'EUR', from: '2026-11-05', to: TODAY, today: TODAY });
  assert.equal(m.coverage, 'partial');
  assert.equal(m.lines[0].state, 'unknown');
  const none = monthBudgets({ groceries: 30000 }, [], { categoryOf, currency: 'EUR', from: '', to: '', today: TODAY });
  assert.equal(none.coverage, 'none');
});

test('the budgets a question is about', () => {
  const m = monthBudgets({ groceries: 30000, dining: 5000 }, NOVEMBER, { categoryOf, currency: 'EUR', from: '2026-08-01', to: TODAY, today: TODAY });
  assert.deepEqual(budgetsAsked(m.lines, 'groceries', null).lines.map((l) => l.id), ['groceries']);
  // "Essen": the supermarket and eating out, whichever have a budget.
  assert.deepEqual(budgetsAsked(m.lines, null, 'essen').lines.map((l) => l.id), ['groceries', 'dining']);
  const onlyDining = monthBudgets({ dining: 5000 }, NOVEMBER, { categoryOf, currency: 'EUR', from: '2026-08-01', to: TODAY, today: TODAY });
  assert.deepEqual(budgetsAsked(onlyDining.lines, null, 'essen').lines.map((l) => l.id), ['dining']);
  // No budget for it: named, so the answer can say which.
  assert.deepEqual(budgetsAsked(m.lines, 'mobility', null), { lines: [], asked: ['mobility'] });
  assert.deepEqual(budgetsAsked(m.lines, null, 'hunde', [{ id: 'c_hund0001', name: 'Hund' }]), { lines: [], asked: ['c_hund0001'] });
  assert.deepEqual(budgetsAsked(m.lines, null, 'quatsch').asked, []);
  assert.equal(budgetsAsked(m.lines, null, null).lines.length, 2);
});

test('the budget worth a note: over at any time, nearly used up only early in the running month', () => {
  const opts = { categoryOf, currency: 'EUR', from: '2026-08-01', to: TODAY, today: TODAY };
  // 215,50 € of 230 €: 94 %, on the 13th.
  const near = monthBudgets({ groceries: 23000 }, NOVEMBER, opts);
  assert.deepEqual(budgetsToNote(near, TODAY).map((l) => l.id), ['groceries']);
  assert.ok(usedShare(near.lines[0]) >= 0.9);
  // The same on the 20th: no note until it is over.
  const late = monthBudgets({ groceries: 23000 }, NOVEMBER, { ...opts, to: '2026-11-20', today: '2026-11-20' });
  assert.deepEqual(budgetsToNote(late, '2026-11-20'), []);
  // 80 %: none.
  const fine = monthBudgets({ groceries: 27000 }, NOVEMBER, opts);
  assert.deepEqual(budgetsToNote(fine, TODAY), []);
  // Over, the most used up first.
  const over = monthBudgets({ groceries: 20000, dining: 3000 }, NOVEMBER, { ...opts, to: '2026-11-25', today: '2026-11-25' });
  assert.deepEqual(budgetsToNote(over, '2026-11-25').map((l) => l.id), ['dining', 'groceries']);
  // A month that is over: only being over counts.
  const october = monthBudgets({ groceries: 15000 }, NOVEMBER, { ...opts, month: '2026-10' });
  assert.equal(october.coverage, 'complete');
  assert.deepEqual(budgetsToNote(october, TODAY).map((l) => l.id), ['groceries']);
});
