import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptsBalance, balanceQueue, canReportBalance, failureSentence, isCardAccount, namesList, totalBalance,
} from './balances.ts';
import type { SerializedAccount, SerializedBalance } from './fints-types';

const account = (accountNumber: string, over: Partial<SerializedAccount> = {}): SerializedAccount => ({
  accountNumber,
  iban: null,
  bic: null,
  currency: 'EUR',
  accountType: 'CheckingAccount',
  holder: 'Max Mustermann',
  product: null,
  limit: null,
  canStatements: true,
  canBalance: true,
  canTransfer: false,
  canInstant: false,
  canPending: false,
  ...over,
});

const bal = (balance: number, over: Partial<SerializedBalance> = {}): SerializedBalance => ({
  balance, currency: 'EUR', date: '2026-10-04', availableAmount: null, ...over,
});

const giro = account('1', { product: 'GiroKomfort' });
const tagesgeld = account('2', { accountType: 'SavingsAccount' });
const karte = account('3', { accountType: 'CreditCardAccount', canBalance: false });
const depot = account('4', { accountType: 'SecuritiesAccount', canStatements: false, canBalance: false });
const dollar = account('5', { currency: 'USD' });

test('every counted balance known: the sum, in cents, with the card counted negative', () => {
  const t = totalBalance([giro, tagesgeld, karte], { 1: bal(1822.9), 2: bal(5000.1), 3: bal(-2.99) });
  assert.equal(t.cents, 682001);
  assert.deepEqual(t.missing, []);
  assert.deepEqual(t.counted, [giro, tagesgeld, karte]);
});

test('one balance unknown: no figure at all, and the account that is missing', () => {
  const t = totalBalance([giro, tagesgeld, karte], { 1: bal(1822.9), 3: bal(-2.99) });
  assert.equal(t.cents, null);
  assert.deepEqual(t.missing, [tagesgeld]);
});

test('a balance of zero is known, not missing', () => {
  const t = totalBalance([giro, tagesgeld], { 1: bal(10), 2: bal(0) });
  assert.equal(t.cents, 1000);
});

test('an account that can never report a balance does not hold the sum open, and is named', () => {
  const t = totalBalance([giro, tagesgeld, depot], { 1: bal(100), 2: bal(50) });
  assert.equal(t.cents, 15000);
  assert.deepEqual(t.excluded, [{ account: depot, reason: 'unsupported', currency: 'EUR' }]);
  assert.deepEqual(t.counted, [giro, tagesgeld]);
});

test('another currency is never added, known or not', () => {
  const unknown = totalBalance([giro, dollar], { 1: bal(100) });
  assert.equal(unknown.cents, 10000);
  assert.deepEqual(unknown.excluded, [{ account: dollar, reason: 'currency', currency: 'USD' }]);
  // An account the bank lists in euros that answers in another currency.
  const odd = totalBalance([giro, tagesgeld], { 1: bal(100), 2: bal(70, { currency: 'chf' }) });
  assert.equal(odd.cents, 10000);
  assert.deepEqual(odd.excluded.map((e) => e.currency), ['CHF']);
});

test('cents do not drift over many balances', () => {
  const many = Array.from({ length: 10 }, (_, i) => account(String(i)));
  const balances = Object.fromEntries(many.map((a) => [a.accountNumber, bal(0.1)]));
  assert.equal(totalBalance(many, balances).cents, 100);
});

test('a statement-only or enquiry-only account can report; one with neither cannot', () => {
  assert.equal(canReportBalance({ canStatements: true, canBalance: false }), true);
  assert.equal(canReportBalance({ canStatements: false, canBalance: true }), true);
  assert.equal(canReportBalance({ canStatements: false, canBalance: false }), false);
});

test('a card is a card by its Kontoart, never by its product name', () => {
  assert.equal(isCardAccount({ accountType: 'CreditCardAccount' }), true);
  assert.equal(isCardAccount({ accountType: '50' }), true);
  assert.equal(isCardAccount({ accountType: '59' }), true);
  assert.equal(isCardAccount({ accountType: '5' }), false);
  assert.equal(isCardAccount({ accountType: 'CheckingAccount' }), false);
  assert.equal(isCardAccount(account('9', { product: 'Giro mit Visa' })), false);
});

test('a balance never moves back in time; the same day or a newer one replaces it', () => {
  const known = { date: '2026-10-02' };
  assert.equal(acceptsBalance(known, { date: '2026-09-30' }), false);
  assert.equal(acceptsBalance(known, { date: '2026-10-02' }), true);
  assert.equal(acceptsBalance(known, { date: '2026-10-05' }), true);
  assert.equal(acceptsBalance(null, { date: '2020-01-01' }), true);
  // JSON dates are compared by the local day they fall on.
  assert.equal(acceptsBalance({ date: new Date(2026, 9, 2, 23, 30).toISOString() }, { date: new Date(2026, 9, 2, 8).toISOString() }), true);
  // Undated answers are taken as they are.
  assert.equal(acceptsBalance(known, { date: '' }), true);
});

test('names are listed the German way', () => {
  assert.equal(namesList([]), '');
  assert.equal(namesList(['Tagesgeld']), 'Tagesgeld');
  assert.equal(namesList(['Tagesgeld', 'Depot']), 'Tagesgeld und Depot');
  assert.equal(namesList(['GiroKomfort', 'Tagesgeld', 'Depot']), 'GiroKomfort, Tagesgeld und Depot');
});

test('"Alle Salden abrufen" asks for every unknown balance, by enquiry where the account offers one', () => {
  const statementOnly = account('6', { canBalance: false });
  const enquiryOnly = account('7', { canStatements: false });
  const queue = balanceQueue([giro, tagesgeld, statementOnly, enquiryOnly, depot, dollar], { 1: bal(10) }, true);
  assert.deepEqual(queue.map((s) => [s.account.accountNumber, s.via]), [
    ['2', 'balance'], ['6', 'statement'], ['7', 'balance'], ['5', 'balance'],
  ]);
});

test('a statement that ends before today carries no balance, so it is not asked for', () => {
  const statementOnly = account('6', { canBalance: false });
  assert.deepEqual(balanceQueue([statementOnly, tagesgeld], {}, false).map((s) => s.account), [tagesgeld]);
  assert.deepEqual(balanceQueue([giro], { 1: bal(10) }, true), []);
});

test('failures are said in one sentence, with the reason when they share one', () => {
  assert.equal(failureSentence([]), null);
  assert.equal(
    failureSentence([{ name: 'Tagesgeld', message: 'Zeitüberschreitung.' }]),
    'Abruf für „Tagesgeld“ fehlgeschlagen: Zeitüberschreitung.',
  );
  assert.equal(
    failureSentence([{ name: 'Tagesgeld', message: 'Zeitüberschreitung.' }, { name: 'Visa', message: 'Zeitüberschreitung.' }]),
    'Abruf für „Tagesgeld“ und „Visa“ fehlgeschlagen: Zeitüberschreitung.',
  );
  assert.equal(
    failureSentence([{ name: 'Tagesgeld', message: 'Zeitüberschreitung.' }, { name: 'Visa', message: 'Gesperrt.' }]),
    'Abruf für „Tagesgeld“ und „Visa“ fehlgeschlagen.',
  );
});
