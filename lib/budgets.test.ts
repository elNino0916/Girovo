import './__fixtures__/tz.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SerializedTransaction } from './fints-types';
import { categorize } from './categorize.ts';
import { monthlyBuckets, periodTotals } from './analytics.ts';
import {
  BUDGET_CATEGORIES, BUDGET_MAX_CENTS, averageByCategory, budgetCents, budgetLines, isBudgetCategory, monthCoverage,
  parseBudgetInput, sanitizeBudgets,
} from './budgets.ts';
import { IBAN, OWN_IBANS, OWN_SAVINGS, camt, mt940, newestFirst } from './__fixtures__/transactions.ts';

const categoryOf = (tx: SerializedTransaction) => categorize(tx, { ownIbans: OWN_IBANS });

test('only the spending side can carry a budget', () => {
  assert.equal(isBudgetCategory('groceries'), true);
  assert.equal(isBudgetCategory('fees'), true, 'fees and interest: measured on the spending side');
  assert.equal(isBudgetCategory('other'), true);
  assert.equal(isBudgetCategory('income'), false);
  assert.equal(isBudgetCategory('otherIn'), false);
  assert.equal(isBudgetCategory('transfer'), false, 'an Umbuchung is neither income nor spending');
  assert.equal(isBudgetCategory('nope' as never), false);
  assert.deepEqual(BUDGET_CATEGORIES.slice(0, 3), ['housing', 'groceries', 'mobility']);
  assert.ok(!BUDGET_CATEGORIES.includes('income') && !BUDGET_CATEGORIES.includes('transfer'));
});

test('sanitizeBudgets keeps whole, positive cents for spending categories only', () => {
  const raw = JSON.parse(
    '{"groceries":30000,"income":250000,"transfer":100,"leisure":12.5,"shopping":-100,"media":0,'
      + '"health":"5000","savings":100000000,"taxes":99999999,"__proto__":500,"bogus":1000,"fees":1}',
  );
  assert.deepEqual(sanitizeBudgets(raw), { groceries: 30000, taxes: 99999999, fees: 1 });
  // The app's order, whatever order the file had.
  assert.deepEqual(Object.keys(sanitizeBudgets({ other: 100, housing: 200 })), ['housing', 'other']);
  for (const v of [null, undefined, 'x', 42, [], [30000]]) assert.deepEqual(sanitizeBudgets(v), {});
  assert.equal(Object.getPrototypeOf(sanitizeBudgets(raw)), Object.prototype);
  assert.equal(budgetCents(BUDGET_MAX_CENTS), BUDGET_MAX_CENTS);
  assert.equal(budgetCents(BUDGET_MAX_CENTS + 1), null);
  assert.equal(budgetCents(Number.NaN), null);
});

test('a typed budget is read the way the interface language writes amounts', () => {
  assert.deepEqual(parseBudgetInput('250', 'de'), { cents: 25000, error: null });
  assert.deepEqual(parseBudgetInput('250,50', 'de'), { cents: 25050, error: null });
  assert.deepEqual(parseBudgetInput('1.200', 'de'), { cents: 120000, error: null });
  assert.deepEqual(parseBudgetInput('1.200,00 €', 'de'), { cents: 120000, error: null });
  assert.deepEqual(parseBudgetInput('250.50', 'en'), { cents: 25050, error: null });
  assert.deepEqual(parseBudgetInput('1,200', 'en'), { cents: 120000, error: null });
  assert.deepEqual(parseBudgetInput('   ', 'de'), { cents: null, error: null }, 'empty: no budget, no error');
  assert.equal(parseBudgetInput('zwei', 'de').error, 'format');
  assert.equal(parseBudgetInput('0', 'de').error, 'notPositive');
  assert.equal(parseBudgetInput('0,004', 'de').error, 'format');
  assert.equal(parseBudgetInput('-50', 'de').error, 'notPositive');
  assert.equal(parseBudgetInput('1.000.000', 'de').error, 'tooLarge');
  assert.deepEqual(parseBudgetInput('999.999,99', 'de'), { cents: BUDGET_MAX_CENTS, error: null });
});

test('month coverage: complete, running, partial at either end, nothing loaded', () => {
  const today = '2026-10-06';
  // September, all of it loaded and over.
  assert.equal(monthCoverage({ month: '2026-09', from: '2026-09-01', to: '2026-09-30' }, today), 'complete');
  // October, loaded from its first day up to today.
  assert.equal(monthCoverage({ month: '2026-10', from: '2026-10-01', to: '2026-10-06' }, today), 'running');
  // The last day of a month is still running on that very day.
  assert.equal(monthCoverage({ month: '2026-10', from: '2026-10-01', to: '2026-10-31' }, '2026-10-31'), 'running');
  assert.equal(monthCoverage({ month: '2026-10', from: '2026-10-01', to: '2026-10-31' }, '2026-11-01'), 'complete');
  // July, where a 90-day range starts on the 8th: the first week is missing.
  assert.equal(monthCoverage({ month: '2026-07', from: '2026-07-08', to: '2026-07-31' }, today), 'partial');
  // A past range that ended mid-September: the rest of it is unknown, not empty.
  assert.equal(monthCoverage({ month: '2026-09', from: '2026-09-01', to: '2026-09-15' }, today), 'partial');
  // The running month, but the range starts after its first day.
  assert.equal(monthCoverage({ month: '2026-10', from: '2026-10-03', to: '2026-10-06' }, today), 'partial');
  // Before the first booking in scope, or nothing at all.
  assert.equal(monthCoverage({ month: '2026-06', from: '2026-06-01', to: '2026-06-30', noData: true }, today), 'none');
  assert.equal(monthCoverage({ month: '2026-06', from: '', to: '' }, today), 'none');
  assert.equal(monthCoverage({ month: 'all', from: '2026-07-08', to: '2026-10-06' }, today), 'none');
});

test('coverage agrees with the Analyse on which months are complete', () => {
  const today = new Date(2026, 9, 6, 12);
  const months = monthlyBuckets([], { categoryOf, from: '2026-07-08', to: '2026-10-06', today });
  assert.deepEqual(
    months.map((m) => [m.month, m.complete, monthCoverage(m, '2026-10-06')]),
    [
      ['2026-07', false, 'partial'],
      ['2026-08', true, 'complete'],
      ['2026-09', true, 'complete'],
      ['2026-10', false, 'running'],
    ],
  );
});

test('budget lines: left, exact, over — in the app order, a quiet category with 0', () => {
  const spending = [
    { id: 'groceries' as const, amount: 212.4, count: 9 },
    { id: 'leisure' as const, amount: 190, count: 4 },
    { id: 'shopping' as const, amount: 100, count: 2 },
    { id: 'housing' as const, amount: 850, count: 1 },
  ];
  const lines = budgetLines({ leisure: 15000, groceries: 30000, shopping: 10000, media: 2000 }, spending, 'complete');
  assert.deepEqual(lines.map((l) => [l.id, l.state, l.spent, l.rest]), [
    ['groceries', 'left', 21240, 8760],
    ['shopping', 'exact', 10000, 0],
    ['leisure', 'over', 19000, 4000],
    ['media', 'left', 0, 2000],
  ]);
  assert.equal(lines.find((l) => l.id === 'groceries')?.count, 9);
  assert.equal(lines.find((l) => l.id === 'leisure')?.share, 1, 'a bar is never longer than its track');
  assert.equal(lines.find((l) => l.id === 'groceries')?.share, 0.708);
  // A budget the vault should never have held is ignored rather than shown.
  assert.deepEqual(budgetLines({ income: 100, groceries: 1.5 } as never, spending, 'complete'), []);
});

test('a partial month says nothing about what is left — only that it is over', () => {
  const spending = [{ id: 'groceries' as const, amount: 120, count: 5 }, { id: 'leisure' as const, amount: 160, count: 2 }];
  const lines = budgetLines({ groceries: 30000, leisure: 15000 }, spending, 'partial');
  assert.deepEqual(lines.map((l) => [l.id, l.state, l.rest]), [['groceries', 'unknown', 0], ['leisure', 'over', 1000]]);
  // The running month: what is left is left for its remaining days.
  assert.equal(budgetLines({ groceries: 30000 }, spending, 'running')[0].state, 'left');
  assert.equal(budgetLines({ groceries: 30000 }, spending, 'none')[0].state, 'unknown');
});

test('spending is counted as "Ausgaben nach Kategorie" counts it: refunds netted, Umbuchungen out', () => {
  const txs = newestFirst([
    mt940({ day: '2026-09-04', amount: -54.3, gvc: '106', text: 'KARTENZAHLUNG', name: 'REWE SAGT DANKE//BERLIN/DE' }),
    mt940({ day: '2026-09-18', amount: -61.15, gvc: '106', text: 'KARTENZAHLUNG', name: 'EDEKA CENTER//BERLIN/DE' }),
    camt({ day: '2026-09-10', amount: -129.99, code: 'POSD', text: 'Kartenzahlung', name: 'IKEA Deutschland GmbH' }),
    camt({ day: '2026-09-20', amount: 29.99, code: 'POSD', text: 'Gutschrift Kartenzahlung', name: 'IKEA Deutschland GmbH' }),
    mt940({ day: '2026-09-01', amount: -300, gvc: '116', text: 'UEBERWEISUNG', name: 'Nino Muster', iban: OWN_SAVINGS, purpose: 'Sparen' }),
    // Another month: not this budget's business.
    mt940({ day: '2026-10-01', amount: -40, gvc: '106', text: 'KARTENZAHLUNG', name: 'REWE SAGT DANKE//BERLIN/DE' }),
    mt940({ day: '2026-09-12', amount: 25, gvc: '166', text: 'GUTSCHRIFT', name: 'Max Mustermann', iban: IBAN.person }),
  ]);
  const { byCategory } = periodTotals(txs, { categoryOf, from: '2026-09-01', to: '2026-09-30' });
  const lines = budgetLines({ groceries: 10000, shopping: 10000, savings: 20000 }, byCategory, 'complete');
  assert.deepEqual(lines.map((l) => [l.id, l.spent, l.count, l.state]), [
    ['groceries', 11545, 2, 'over'],
    ['shopping', 10000, 2, 'exact'],
    // The transfer to the own savings account is an Umbuchung, not spending on "Sparen".
    ['savings', 0, 0, 'left'],
  ]);
});

test('the average per category counts a month without spending as 0', () => {
  const avg = averageByCategory([
    [{ id: 'groceries', amount: 300 }, { id: 'leisure', amount: 90.01 }],
    [{ id: 'groceries', amount: 200.5 }],
    [],
  ]);
  assert.equal(avg.get('groceries'), 16683);
  assert.equal(avg.get('leisure'), 3000);
  assert.equal(avg.has('shopping'), false);
  assert.equal(averageByCategory([]).size, 0);
});
