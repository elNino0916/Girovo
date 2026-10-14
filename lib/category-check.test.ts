import './__fixtures__/tz.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SerializedTransaction } from './fints-types';
import type { CategoryId } from './categories.ts';
import { counterpartyKey, txKey } from './categories.ts';
import { categorize, explainGuess } from './categorize.ts';
import { categoryCheck } from './category-check.ts';
import { CRED, IBAN, OWN_IBANS, OWN_SAVINGS, camt, mt940 } from './__fixtures__/transactions.ts';

const rewe = (day: string) => mt940({ day, amount: -23.4, gvc: '106', text: 'KARTENZAHLUNG', name: 'REWE SAGT DANKE//BERLIN/DE' });
const netflix = mt940({
  day: '2026-09-15', amount: -12.99, gvc: '105', text: 'BASISLASTSCHRIFT', name: 'Netflix International B.V.', iban: IBAN.netflix,
  cred: CRED.netflix, purpose: 'Netflix Monatsabo',
});
const cash = mt940({ day: '2026-09-12', amount: -100, gvc: '083', text: 'BARGELDAUSZAHLUNG' });
const toSavings = mt940({ day: '2026-09-01', amount: -300, gvc: '116', text: 'UEBERWEISUNG', name: 'Nino Muster', iban: OWN_SAVINGS });
// Nothing the keywords know: the model's ground, or nobody's.
const bakery = (day: string) => mt940({ day, amount: -6.8, gvc: '106', text: 'KARTENZAHLUNG', name: 'Kornblume Hofladen//POTSDAM/DE' });
const tailor = camt({ day: '2026-09-21', amount: -45, code: 'POSD', text: 'Kartenzahlung', name: 'Atelier Fadenlauf' });
const friend = mt940({ day: '2026-09-25', amount: 20, gvc: '166', text: 'GUTSCHRIFT', name: 'Max Mustermann', iban: IBAN.person });
const nameless = camt({ day: '2026-09-28', amount: -3, code: 'XXXX', text: '' });

const MODEL: Record<string, CategoryId> = { [counterpartyKey(bakery('2026-09-01'))]: 'groceries' };

/** The provider's two answers, built from the same inputs — as they must be. */
function answers(rules: Record<string, CategoryId> = {}, overrides: Record<string, CategoryId> = {}) {
  const ctx = { ownIbans: OWN_IBANS, modelGuesses: MODEL };
  return {
    categoryOf: (tx: SerializedTransaction) => categorize(tx, { ...ctx, rules, overrides }),
    guessOf: (tx: SerializedTransaction) => explainGuess(tx, ctx),
  };
}

const ALL = [rewe('2026-09-03'), rewe('2026-09-10'), netflix, cash, toSavings, bakery('2026-09-05'), bakery('2026-09-19'), tailor, friend, nameless];

test('nothing touched: every automatic choice is kept, the rest is open', () => {
  const c = categoryCheck(ALL, answers());
  assert.equal(c.total, 10);
  // REWE ×2 and Netflix by keyword, cash by code, the savings transfer as an own account.
  assert.deepEqual(c.auto.rules, { filed: 5, changed: 0 });
  assert.deepEqual(c.auto.model, { filed: 2, changed: 0 });
  assert.equal(c.kept, 7);
  assert.equal(c.byYou, 0);
  assert.equal(c.open, 3);
  assert.deepEqual(c.changes, []);
  assert.deepEqual(c.uncategorised.map((g) => [g.txs.length, g.ruleable]), [[1, false], [1, true], [1, true]]);
  // Newest first among groups of one booking: the nameless one (28th), the friend (25th), the tailor (21st).
  assert.equal(c.uncategorised[0].key, `tx:${txKey(nameless)}`);
  assert.equal(c.uncategorised[1].txs[0], friend);
  assert.equal(c.uncategorised[2].txs[0], tailor);
});

test('a change by rule or by booking counts once per booking, against the source that filed it', () => {
  const r1 = rewe('2026-09-03');
  const r2 = rewe('2026-09-10');
  const b1 = bakery('2026-09-05');
  const b2 = bakery('2026-09-19');
  const txs = [r1, r2, netflix, b1, b2, tailor, friend];
  const c = categoryCheck(txs, answers(
    // REWE refiled as shopping by a rule; the bakery's model guess overruled for one booking.
    { [counterpartyKey(r1)]: 'shopping', [counterpartyKey(tailor)]: 'shopping' },
    { [txKey(b2)]: 'leisure', [txKey(netflix)]: 'media' },
  ));
  assert.deepEqual(c.auto.rules, { filed: 3, changed: 2 });
  assert.deepEqual(c.auto.model, { filed: 2, changed: 1 });
  // Netflix "changed" to what the app had chosen anyway: kept.
  assert.equal(c.kept, 2);
  // The tailor: nothing automatic, filed by the user's rule.
  assert.equal(c.byYou, 1);
  assert.equal(c.open, 1);
  assert.deepEqual(
    c.changes.map((g) => [g.count, g.from, g.to, g.by, g.source]),
    [[2, 'groceries', 'shopping', 'rule', 'rules'], [1, 'groceries', 'leisure', 'manual', 'model']],
  );
  assert.equal(c.changes[0].tx, r2, 'the newest booking stands for its group');
});

test('a group filed both ways says so', () => {
  const r1 = rewe('2026-09-03');
  const r2 = rewe('2026-09-10');
  const c = categoryCheck([r1, r2], answers({ [counterpartyKey(r1)]: 'shopping' }, { [txKey(r2)]: 'shopping' }));
  assert.deepEqual(c.changes.map((g) => [g.count, g.by]), [[2, 'mixed']]);
});

test('open bookings group by counterparty, the biggest group first', () => {
  const tailor2 = camt({ day: '2026-08-02', amount: -30, code: 'POSD', text: 'Kartenzahlung', name: 'Atelier Fadenlauf' });
  const c = categoryCheck([tailor2, friend, tailor], answers());
  assert.deepEqual(c.uncategorised.map((g) => g.txs.length), [2, 1]);
  assert.deepEqual(c.uncategorised[0].txs, [tailor, tailor2], 'newest first within a group');
  assert.equal(c.uncategorised[0].key, counterpartyKey(tailor));
});

test('without the model its bookings are simply open', () => {
  const c = categoryCheck([bakery('2026-09-05')], {
    categoryOf: (tx) => categorize(tx, { ownIbans: OWN_IBANS }),
    guessOf: (tx) => explainGuess(tx, { ownIbans: OWN_IBANS }),
  });
  assert.deepEqual(c.auto.model, { filed: 0, changed: 0 });
  assert.equal(c.open, 1);
});

test('an empty list checks to zeros', () => {
  const c = categoryCheck([], answers());
  assert.equal(c.total + c.kept + c.byYou + c.open, 0);
  assert.deepEqual(c.uncategorised, []);
});
