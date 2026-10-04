import './__fixtures__/tz.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SerializedTransaction } from './fints-types';
import { counterpartyKey, counterpartyName, intermediaryName } from './categories.ts';
import { categorize, guessCategory } from './categorize.ts';
import { detectRecurring } from './recurring.ts';
import { topCounterparties, txMatcher } from './analytics.ts';
import { getMerchantKey } from './merchant-match.ts';
import { mt940 } from './__fixtures__/transactions.ts';

// A Sparkasse Visa Debit payment: the card processor holds the account the
// money goes to, the shop is the "abweichender Empfänger" (ultimateName).
const HELABA_IBAN = 'DE41500500000001234567';
const visa = (day: string, amount: number, shop: string): SerializedTransaction => ({
  ...mt940({
    day, amount, name: 'Landesbank Hessen-Thüringen', iban: HELABA_IBAN, text: 'LASTSCHRIFT',
    purpose: `${day}T10:12 Debitk.0 2030-12 Zahl.System VISA Debit`,
  }),
  ultimateName: shop,
});
const ownIbans = new Set<string>();
const categoryOf = (tx: SerializedTransaction) => categorize(tx, { ownIbans });

test('the shop is the counterparty; the processor is the intermediary', () => {
  const tx = visa('2026-09-15', -12.99, 'NETFLIX.COM');
  assert.equal(counterpartyName(tx), 'NETFLIX.COM');
  assert.equal(intermediaryName(tx), 'Landesbank Hessen-Thüringen');
  // No ultimate party, or the same one, is no split.
  assert.equal(intermediaryName({ remoteName: 'REWE', ultimateName: '' }), null);
  assert.equal(intermediaryName({ remoteName: 'REWE Markt GmbH', ultimateName: 'REWE MARKT GMBH' }), null);
  assert.equal(counterpartyName({ remoteName: 'REWE Markt GmbH' }), 'REWE Markt GmbH');
});

test('rules, logos and categories follow the shop, not the shared processor IBAN', () => {
  const netflix = visa('2026-09-15', -12.99, 'NETFLIX.COM');
  const rewe = visa('2026-09-16', -23.4, 'REWE Markt GmbH');
  assert.notEqual(counterpartyKey(netflix), counterpartyKey(rewe), 'one rule must not file every Visa payment');
  assert.equal(counterpartyKey(netflix), 'name:NETFLIX COM');
  assert.equal(getMerchantKey(netflix), 'NETFLIX.COM');
  assert.equal(guessCategory(rewe), 'groceries');
  assert.equal(guessCategory(netflix), 'media');
});

test('a subscription paid by Visa Debit is its own series, not one "Helaba" series', () => {
  const txs = [
    ...['2026-07-15', '2026-08-15', '2026-09-15'].map((d) => visa(d, -12.99, 'NETFLIX.COM')),
    ...['2026-07-02', '2026-07-19', '2026-08-04', '2026-08-23', '2026-09-08'].map((d, i) => visa(d, -(20 + i * 7.31), 'REWE Markt GmbH')),
  ];
  const series = detectRecurring(txs, { today: new Date(2026, 9, 1), categoryOf });
  const names = series.map((s) => s.name);
  assert.deepEqual(names, ['NETFLIX.COM']);
  assert.equal(series[0].iban, null, "the processor's IBAN would find every shop");
});

test('payees and search see the shop', () => {
  const txs = [visa('2026-09-15', -12.99, 'NETFLIX.COM'), visa('2026-09-16', -23.4, 'REWE Markt GmbH')];
  const payees = topCounterparties(txs, { categoryOf, dir: 'out', limit: 5 });
  assert.deepEqual(payees.map((p) => p.name).sort(), ['NETFLIX.COM', 'REWE Markt GmbH']);
  assert.ok(payees.every((p) => !p.iban));
  assert.ok(txMatcher('netflix')(txs[0]));
  assert.ok(txMatcher('landesbank')(txs[0]), 'the processor still finds them');
});
