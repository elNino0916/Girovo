import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FinTSConfig, type BankAccount } from 'lib-fints';
import { accountKeyOf, bankAccountOf, bankNumberOf, findBankAccount } from './account-key.ts';
import { matchAccount } from './bank-import.ts';
import { fetchStatements, statementFormat } from './fints-statements.ts';
import type { FinTSClientEx } from './fints-types';

// A bank that lists a Girokonto and its Depot under one number, told apart
// only by the sub-account id (#20), beside a Tagesgeld with a number of its own.

const account = (accountNumber: string, subAccountId: string | undefined, transIds: string[], over: Partial<BankAccount> = {}) => ({
  accountNumber, subAccountId, bank: { country: 280, bankId: '12030000' }, customerId: 'nino.b',
  currency: 'EUR', holder1: 'NINO BECKER', allowedTransactions: transIds.map((transId) => ({ transId })), ...over,
}) as unknown as BankAccount;

const GIRO = account('1234567', 'Girokonto', ['HKCAZ', 'HKSAL', 'HKCCS'], { iban: 'DE02120300000001234567' });
const DEPOT = account('1234567', 'Depot', ['HKWPD']);
const TAGESGELD = account('7654321', '01', ['HKKAZ', 'HKSAL'], { iban: 'DE12120300000007654321' });

/** lib-fints' own configuration, holding the UPD above: its lookups are the real ones. */
function config(bankAccounts: BankAccount[] = [GIRO, DEPOT, TAGESGELD]): FinTSConfig {
  return Object.assign(Object.create(FinTSConfig.prototype), {
    bankingInformation: {
      upd: { bankAccounts },
      bpd: { allowedTransactions: ['HKCAZ', 'HKKAZ', 'HKSAL', 'HKWPD', 'HKCCS'].map((transId) => ({ transId, versions: [1] })) },
    },
  }) as FinTSConfig;
}

test('a number the bank uses twice gets the sub-account id; every other key stays the plain number', () => {
  const all = [GIRO, DEPOT, TAGESGELD];
  assert.equal(accountKeyOf(GIRO, all), '1234567:Girokonto');
  assert.equal(accountKeyOf(DEPOT, all), '1234567:Depot');
  // Unique: the key every install already keeps its names, notes and Umsätze under.
  assert.equal(accountKeyOf(TAGESGELD, all), '7654321');
});

test('of two accounts under one number, one without a sub-account id keeps the plain number', () => {
  const plain = account('1234567', undefined, ['HKKAZ']);
  const all = [plain, DEPOT];
  assert.equal(accountKeyOf(plain, all), '1234567');
  assert.equal(accountKeyOf(DEPOT, all), '1234567:Depot');
  assert.equal(bankAccountOf(config(all), '1234567'), plain);
});

test('a key resolves to the bank\'s own account, sub-account id included', () => {
  const c = config();
  assert.equal(bankAccountOf(c, '1234567:Girokonto'), GIRO);
  assert.equal(bankAccountOf(c, '1234567:Depot'), DEPOT);
  assert.equal(bankAccountOf(c, '7654321'), TAGESGELD);
  assert.equal(findBankAccount(c, '9999999'), undefined);
  // The number alone still names neither, and lib-fints still refuses to guess.
  assert.throws(() => bankAccountOf(c, '1234567'), /not unique in UPD/);
  assert.throws(() => bankAccountOf(c, '9999999'), /not found in UPD/);
});

test('the Girokonto\'s Umsätze are read from the Girokonto, never from the Depot under its number', async () => {
  const c = config();
  assert.equal(statementFormat(c, '1234567:Girokonto'), 'camt');
  assert.equal(statementFormat(c, '1234567:Depot'), null);
  assert.equal(statementFormat(c, '7654321'), 'mt940');

  let asked: { account?: unknown } | undefined;
  const client = {
    config: c,
    startCustomerOrderInteraction: async (interaction: { account?: unknown }) => {
      asked = interaction;
      return { success: true, requiresTan: false, bankAnswers: [], statements: [] };
    },
  } as unknown as FinTSClientEx;
  await fetchStatements(client, '1234567:Girokonto');
  assert.equal(asked?.account, GIRO);
});

test('what a screen, a statement or an import shows of a key is the bank\'s number', () => {
  assert.equal(bankNumberOf('1234567:Depot'), '1234567');
  assert.equal(bankNumberOf('7654321'), '7654321');
  const accounts = [
    { accountNumber: '1234567:Girokonto', iban: GIRO.iban },
    { accountNumber: '1234567:Depot', iban: null },
    { accountNumber: '7654321', iban: TAGESGELD.iban },
  ];
  assert.equal(matchAccount('DE02 1203 0000 0001 2345 67', accounts), '1234567:Girokonto');
  assert.equal(matchAccount('0007654321', accounts), '7654321');
});
