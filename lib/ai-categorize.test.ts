import './__fixtures__/tz.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SerializedTransaction } from './fints-types';
import type { CategoryId } from './categories.ts';
import type { GuessableCategory } from './category-guess.ts';
import { counterpartyKey, txKey } from './categories.ts';
import { categorize } from './categorize.ts';
import { aiGroups, aiPrompt, answerKey, applyList, initialPicks, promptPurpose, qualifies, readAnswer } from './ai-categorize.ts';
import { NANO_CATEGORY_LIST, NANO_PROMPT_VERSION, NANO_SYSTEM, nanoBookingText } from './nano-categories.ts';
import { CRED, IBAN, OWN_IBANS, OWN_SAVINGS, camt, mt940 } from './__fixtures__/transactions.ts';

// i18n-data-start (bookings as banks write them)
// Nothing the keywords know: still "Sonstiges".
const hofladen = (day: string, amount = -6.8) =>
  mt940({ day, amount, gvc: '106', text: 'KARTENZAHLUNG', name: 'Kornblume Hofladen//POTSDAM/DE', purpose: '2026-09-01T10:00 Debitk.1 2030-12' });
const tailor = camt({ day: '2026-09-21', amount: -45, code: 'POSD', text: 'Kartenzahlung', name: 'Atelier Fadenlauf' });
const friend = (day: string) => mt940({ day, amount: -20, gvc: '116', text: 'UEBERWEISUNG', name: 'Max Mustermann', iban: IBAN.person, purpose: 'Danke fürs Auslegen' });
const gym = mt940({
  day: '2026-09-03', amount: -29.9, gvc: '105', text: 'BASISLASTSCHRIFT', name: 'Max Kraft', cred: CRED.gym, purpose: 'Beitrag September',
});
const rewe = mt940({ day: '2026-09-02', amount: -23.4, gvc: '106', text: 'KARTENZAHLUNG', name: 'REWE SAGT DANKE//BERLIN/DE' });
const refund = mt940({ day: '2026-09-04', amount: 12, gvc: '166', text: 'GUTSCHRIFT', name: 'Atelier Nadelstich', iban: IBAN.kfz });
const toSavings = mt940({ day: '2026-09-01', amount: -300, gvc: '116', text: 'UEBERWEISUNG', name: 'Nino Muster', iban: OWN_SAVINGS });
const nameless = camt({ day: '2026-09-28', amount: -3, code: 'XXXX', text: '' });
// i18n-data-end

const categoryOf = (rules: Record<string, CategoryId> = {}, overrides: Record<string, CategoryId> = {}) =>
  (tx: SerializedTransaction) => categorize(tx, { ownIbans: OWN_IBANS, rules, overrides });

test('only outgoing bookings nobody filed and the app left in Sonstiges qualify', () => {
  const of = categoryOf();
  assert.equal(qualifies(hofladen('2026-09-01'), of), true);
  assert.equal(qualifies(tailor, of), true);
  assert.equal(qualifies(rewe, of), false, 'groceries by keyword');
  assert.equal(qualifies(refund, of), false, 'money in');
  assert.equal(qualifies(toSavings, of), false, 'own account');
  const filed = categoryOf({}, { [txKey(tailor)]: 'other' });
  assert.equal(qualifies(tailor, filed), false, 'the user put it in Sonstiges');
});

test('groups by counterparty, most bookings first, each booking once', () => {
  const a = hofladen('2026-09-01');
  const b = hofladen('2026-09-15', -9.2);
  const groups = aiGroups([a, tailor, b, a, rewe, refund, nameless], categoryOf());
  assert.deepEqual(groups.map((g) => g.key), [counterpartyKey(a), counterpartyKey(tailor)]);
  assert.equal(groups[0].txs.length, 2);
  assert.equal(groups[0].txs[0], b, 'newest first');
  assert.equal(groups[0].name, 'Kornblume Hofladen');
  assert.equal(groups[0].purpose, '', 'a card record carries no purpose');
});

test('a counterparty the user already filed a booking of is left out', () => {
  const a = hofladen('2026-09-01');
  const b = hofladen('2026-09-15', -9.2);
  const groups = aiGroups([a, b, tailor], categoryOf({}, { [txKey(a)]: 'groceries' }));
  assert.deepEqual(groups.map((g) => g.key), [counterpartyKey(tailor)]);
  const ruled = aiGroups([a, b, tailor], categoryOf({ [counterpartyKey(tailor)]: 'shopping' }));
  assert.deepEqual(ruled.map((g) => g.key), [counterpartyKey(a)]);
});

test('a private person is marked, a direct debit never', () => {
  const groups = aiGroups([friend('2026-09-05'), friend('2026-09-06'), gym], categoryOf());
  const person = groups.find((g) => g.name === 'Max Mustermann');
  const club = groups.find((g) => g.name === 'Max Kraft');
  assert.equal(person?.person, true);
  assert.equal(person?.purpose, 'Danke fürs Auslegen');
  assert.equal(club?.person, false, 'a creditor collects it');
});

test('the prompt is the benchmark’s, and answers are remembered per prompt and version', () => {
  const g = { name: 'Atelier Fadenlauf', purpose: '' };
  assert.deepEqual(aiPrompt(g), { system: NANO_SYSTEM, user: NANO_CATEGORY_LIST + nanoBookingText(g.name, g.purpose), maxTokens: 8 });
  assert.equal(answerKey(g), `${NANO_PROMPT_VERSION}\u0000Atelier Fadenlauf\u0000`);
  assert.notEqual(answerKey(g), answerKey({ ...g, purpose: 'Saum' }));
  assert.equal(readAnswer('NONE'), null);
  assert.equal(readAnswer('shopping'), 'shopping');
  assert.equal(promptPurpose({ purpose: 'Rechnung 42' }), 'Rechnung 42');
});

test('review rows: NONE and unasked are not listed, a person starts unchecked', () => {
  const groups = aiGroups([hofladen('2026-09-30'), tailor, friend('2026-09-05'), gym], categoryOf());
  const answers = new Map<string, GuessableCategory | null>();
  const byName = (n: string) => groups.find((g) => g.name === n)!;
  answers.set(answerKey(byName('Kornblume Hofladen')), 'groceries');
  answers.set(answerKey(byName('Atelier Fadenlauf')), null);
  answers.set(answerKey(byName('Max Mustermann')), 'dining');
  const picks = initialPicks(groups, answers);
  assert.deepEqual(picks, [
    { key: byName('Kornblume Hofladen').key, category: 'groceries', checked: true },
    { key: byName('Max Mustermann').key, category: 'dining', checked: false },
  ]);
});

test('Übernehmen files the checked rows, with how many bookings each moves', () => {
  const a = hofladen('2026-09-01');
  const b = hofladen('2026-09-15', -9.2);
  const groups = aiGroups([a, b, tailor, friend('2026-09-05')], categoryOf());
  const key = (n: string) => groups.find((g) => g.name === n)!.key;
  const list = applyList(groups, [
    { key: key('Kornblume Hofladen'), category: 'groceries', checked: true },
    { key: key('Atelier Fadenlauf'), category: 'other', checked: true },
    { key: key('Max Mustermann'), category: 'dining', checked: false },
    { key: 'iban:gone', category: 'shopping', checked: true },
  ]);
  assert.deepEqual(list, [{ tx: b, category: 'groceries', count: 2 }]);
});
