import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contractsNamed, contractsYearCount, factOf, forecastAccount, goalsNamed, isFact, lastFrom, nameCase, nextSalary, priceRises, salaryWhen,
  sameName,
} from './ask-facts.ts';
import { intentOf } from './ask-intents.ts';
import type { RecurringSeries } from './recurring.ts';
import type { SavingsGoal } from './savings-goal.ts';

test('balances', () => {
  for (const q of ['Wie viel Geld habe ich?', 'Kontostand', 'Was ist mein Kontostand?', 'wie viel liegt auf meinen konten', 'How much money do I have?', "what's my balance"]) {
    assert.deepEqual(factOf(q), { kind: 'balance' }, q);
  }
});

test('the month-end forecast', () => {
  for (const q of ['Reicht es bis Monatsende?', 'Wie viel bleibt bis Monatsende?', 'Kontostand Ende des Monats', 'reicht mein geld noch bis zum gehalt', 'will my money last until the end of the month']) {
    assert.deepEqual(factOf(q), { kind: 'monthEnd' }, q);
  }
});

const CONTRACTS = ['Netflix', 'NETFLIX INTERNATIONAL B.V.', 'Spotify', 'Spotify AB'];

test('a contract a year, and every contract', () => {
  assert.deepEqual(factOf('Was kostet mich Netflix im Jahr?', CONTRACTS), { kind: 'contractCost', name: 'netflix' });
  assert.deepEqual(factOf('wie viel zahle ich im jahr für spotify', CONTRACTS), { kind: 'contractCost', name: 'spotify' });
  assert.deepEqual(factOf('how much does netflix cost me a year', CONTRACTS), { kind: 'contractCost', name: 'netflix' });
  assert.deepEqual(factOf('Was kosten mich meine Abos im Jahr?'), { kind: 'contractCost', name: null });
  assert.deepEqual(intentOf('Was kostet mich Netflix im Jahr?', CONTRACTS), { kind: 'contractCost', name: 'netflix' });
});

test('a name a year that is no contract is a question about the bookings', () => {
  for (const q of [
    'Wie viel gebe ich pro Jahr bei Amazon aus?', 'Wie viel zahle ich pro Jahr an Lea?', 'Was zahle ich im Jahr bei Rewe?',
    'Was gebe ich im Jahr für Essen aus?', 'Was kostet mich Kaffee im Jahr?', 'What do I spend a year on Amazon?',
    'How much do I pay to Lea a year?',
  ]) {
    assert.equal(factOf(q, CONTRACTS), null, q);
    assert.equal(intentOf(q, CONTRACTS), null, q);
  }
  // Without the contracts loaded, no name is one.
  assert.equal(factOf('Was kostet mich Netflix im Jahr?'), null);
});

test('price rises', () => {
  for (const q of ['Welche Abos sind teurer geworden?', 'Was ist teurer geworden?', 'Gab es Preiserhöhungen?', 'which subscriptions got more expensive']) {
    assert.deepEqual(factOf(q), { kind: 'priceRises' }, q);
  }
});

test('the next salary, never the last one', () => {
  for (const q of ['Wann kommt das Gehalt?', 'wann kommt mein nächstes gehalt', 'when is my next salary', 'when do I get paid']) {
    assert.deepEqual(factOf(q), { kind: 'salary' }, q);
  }
  for (const q of ['wann kam das letzte gehalt', 'gehalt im oktober', 'Gehalt dieses Jahr']) assert.equal(factOf(q), null, q);
});

test('Aufteilen: who owes', () => {
  assert.deepEqual(factOf('Wie viel schuldet mir Lea noch?'), { kind: 'owed', name: 'lea' });
  assert.deepEqual(factOf('schuldet lea mir noch was'), { kind: 'owed', name: 'lea' });
  assert.deepEqual(factOf('how much does Lea owe me'), { kind: 'owed', name: 'lea' });
  assert.deepEqual(factOf('wer schuldet mir noch geld'), { kind: 'owed', name: null });
});

test('Sparziele', () => {
  assert.deepEqual(factOf('Wie weit bin ich beim Urlaubsziel?'), { kind: 'goal', name: 'urlaub' });
  assert.deepEqual(factOf('wie stehen meine sparziele'), { kind: 'goal', name: null });
  assert.deepEqual(factOf('how close am i to the japan goal'), { kind: 'goal', name: 'japan' });
  // "Gespart" is no goal's name.
  assert.deepEqual(factOf('Wie viel habe ich für Ziele gespart?'), { kind: 'goal', name: null });
});

test('spending or eating out at a goal is a question about the bookings', () => {
  for (const q of ['Wie viel habe ich für mein Reiseziel ausgegeben?', 'Wo war ich am Reiseziel essen?', 'how much did i spend on my travel goal']) {
    assert.equal(factOf(q), null, q);
  }
});

test('questions about the bookings stay with the bookings', () => {
  for (const q of [
    'Wie viel ging an Netflix?', 'Netflix pro Monat', 'Was kostet Netflix im Monat', 'was kostet mich wohnen im jahr',
    'was hab ich im jahr 2025 für netflix bezahlt', 'wie viel geld hab ich ausgegeben', 'wie viel bargeld hab ich abgehoben',
    'was hat der urlaub gekostet', 'wie viel hab ich lea überwiesen', 'teuerstes restaurant dieses jahr', 'wie viel ging dieses jahr in den sparplan',
    'kontoführungsgebühren letztes jahr', 'wie viel gebe ich im jahr für essen gehen aus',
  ]) {
    assert.equal(factOf(q), null, q);
  }
});

test('intentOf: a refresh and the contract list come first or stay as they were', () => {
  assert.deepEqual(intentOf('Kontostand aktualisieren'), { kind: 'refresh' });
  assert.deepEqual(intentOf('Welche Abos habe ich?'), { kind: 'contracts' });
  assert.deepEqual(intentOf('Welche Abos sind teurer geworden?'), { kind: 'priceRises' });
  assert.ok(isFact({ kind: 'goal', name: null }));
  assert.ok(!isFact({ kind: 'contracts' }));
});

const series = (over: Partial<RecurringSeries>): RecurringSeries => ({
  id: over.name ?? 'x', key: '', kind: 'expense', name: 'X', iban: null, creditorId: null, mandateReference: null, directDebit: false,
  category: 'media', cadence: 'monthly', cadenceLabel: '', intervalDays: 30, amount: -10, lastAmount: -10, previousAmount: null,
  changed: false, change: null, priceChange: null, variable: false, monthlyAmount: -10, yearlyAmount: -120, currency: 'EUR', count: 3,
  firstDate: '2026-01-01', lastDate: '2026-11-01', nextDate: '2026-12-01', overdue: false, ended: false, transactions: [],
  ...over,
});

test('contractsNamed finds a contract by the name shown or the bank\'s', () => {
  const list = [
    series({ name: 'NETFLIX INTERNATIONAL B.V.', yearlyAmount: -155.88 }),
    series({ name: 'Spotify AB', yearlyAmount: -131.88 }),
    series({ name: 'Netflix Zweitkonto', customName: 'Netflix Oma', yearlyAmount: -95.88 }),
    series({ name: 'Netflix alt', ended: true }),
  ];
  assert.deepEqual(contractsNamed(list, 'netflix').map((s) => s.yearlyAmount), [-155.88, -95.88]);
  assert.deepEqual(contractsNamed(list, 'disney'), []);
});

test('priceRises: dearer within the year, the newest first', () => {
  const list = [
    series({ name: 'A', priceChange: { since: '2026-03-01', previous: 9, delta: 1, perYear: 12 } }),
    series({ name: 'B', priceChange: { since: '2026-09-01', previous: 9, delta: 2, perYear: 24 } }),
    series({ name: 'C', priceChange: { since: '2026-05-01', previous: 9, delta: -1, perYear: -12 } }),
    series({ name: 'D', kind: 'income', priceChange: { since: '2026-05-01', previous: 9, delta: 5, perYear: 60 } }),
  ];
  assert.deepEqual(priceRises(list, '2026-11-12').map((s) => s.name), ['B', 'A']);
});

test('nextSalary: Einnahmen first, then the largest', () => {
  const list = [
    series({ name: 'Mieter', kind: 'income', category: 'otherIn', monthlyAmount: 3000 }),
    series({ name: 'Arbeitgeber GmbH', kind: 'income', category: 'income', monthlyAmount: 2500 }),
    series({ name: 'Alt', kind: 'income', category: 'income', monthlyAmount: 4000, ended: true }),
  ];
  assert.equal(nextSalary(list)?.name, 'Arbeitgeber GmbH');
  assert.equal(nextSalary([series({})]), null);
});

test('salaryWhen: a day passed within the grace comes soon, overdue is late', () => {
  const today = '2026-11-12';
  assert.equal(salaryWhen({ nextDate: '2026-11-10', overdue: false }, today), 'due');
  assert.equal(salaryWhen({ nextDate: '2026-11-01', overdue: true }, today), 'late');
  assert.equal(salaryWhen({ nextDate: today, overdue: false }, today), 'today');
  assert.equal(salaryWhen({ nextDate: '2026-11-28', overdue: false }, today), 'ahead');
});

test('contractsYearCount counts what the yearly total adds up', () => {
  const list = [series({}), series({ name: 'B' }), series({ name: 'USD', currency: 'USD' }), series({ name: 'Alt', ended: true })];
  assert.equal(contractsYearCount(list, 'EUR'), 2);
});

test('goalsNamed: by name, else all', () => {
  const goals: SavingsGoal[] = [{ accountNumber: '1', name: 'Urlaub Japan', target: 300000 }, { accountNumber: '2', name: 'Notgroschen', target: 500000 }];
  assert.deepEqual(goalsNamed(goals, 'urlaub'), { goals: [goals[0]], matched: true });
  assert.deepEqual(goalsNamed(goals, null), { goals, matched: true });
  assert.deepEqual(goalsNamed(goals, 'auto'), { goals, matched: false });
});

test('forecastAccount: the open Girokonto, else the first', () => {
  const giro = { accountType: 'CheckingAccount', canStatements: true, canPortfolio: false, n: 1 };
  const saving = { accountType: 'SavingsAccount', canStatements: true, canPortfolio: false, n: 2 };
  assert.equal(forecastAccount([saving, giro], saving)?.n, 1);
  assert.equal(forecastAccount([giro], giro)?.n, 1);
  assert.equal(forecastAccount([saving], saving), null);
});

test('lastFrom and the names', () => {
  const txs = [
    { amount: 20, day: '2026-10-01', payee: 'Lea Müller' },
    { amount: 35, day: '2026-11-02', payee: 'LEA MUELLER' },
    { amount: -50, day: '2026-11-05', payee: 'Lea Müller' },
  ];
  assert.equal(lastFrom(txs, 'lea', (t) => t)?.amount, 35);
  assert.equal(lastFrom(txs, 'tom', (t) => t), null);
  assert.ok(sameName('Netflix.com', 'netflix'));
  assert.ok(!sameName('Netflix', 'n'));
  assert.equal(nameCase('lea'), 'Lea');
  assert.equal(nameCase('amazon prime'), 'Amazon Prime');
});
