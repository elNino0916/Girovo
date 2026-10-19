import './__fixtures__/tz.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SerializedTransaction } from './fints-types';
import type { CustomCategory } from './categories.ts';
import { categoryDef, categoryLabel, isCategoryId, setCustomCategories, txKey } from './categories.ts';
import { categorize } from './categorize.ts';
import { filterTransactions, periodTotals, topCounterparties } from './analytics.ts';
import { budgetCategories, sanitizeBudgets } from './budgets.ts';
import { transactionsToCsv } from './csv.ts';
import {
  categoryValidator, cleanCategoryName, newCustomId, remainderCents, sanitizeCustomCategories, sanitizeSplit,
  sanitizeSplits, splitParts, withoutCategory,
} from './splits.ts';
import { sanitizeVault } from './vault.ts';
import { OWN_IBANS, mt940 } from './__fixtures__/transactions.ts';

const GIFTS: CustomCategory = { id: 'c_gifts12345', name: 'Geschenke', direction: 'out' };
const RENT_IN: CustomCategory = { id: 'c_rentin1234', name: 'Mieteinnahmen', direction: 'in' };

test('own categories: valid ids, one line names, no twins, a cap', () => {
  const raw = [
    GIFTS,
    { id: 'c_gifts12345', name: 'Zweimal', direction: 'out' }, // same id
    { id: 'c_other12345', name: '  geschenke ', direction: 'out' }, // same name, folded
    { id: 'income', name: 'Gehalt', direction: 'in' }, // not a custom id
    { id: 'c_x', name: 'Zu kurz', direction: 'out' }, // id too short
    { id: 'c_dog1234567', name: 'Hund\nund Katze', direction: 'out' },
    { id: 'c_both123456', name: 'Beides', direction: 'both' }, // no such side
    { id: 'c_empty12345', name: '   ', direction: 'in' },
    RENT_IN,
  ];
  assert.deepEqual(sanitizeCustomCategories(raw), [
    GIFTS,
    { id: 'c_dog1234567', name: 'Hund und Katze', direction: 'out' },
    RENT_IN,
  ]);
  for (const v of [null, undefined, 'x', {}, 42]) assert.deepEqual(sanitizeCustomCategories(v), []);
  const many = Array.from({ length: 60 }, (_, i) => ({ id: `c_cat${String(i).padStart(6, '0')}`, name: `K${i}`, direction: 'out' }));
  assert.equal(sanitizeCustomCategories(many).length, 50);
  assert.equal(cleanCategoryName('x'.repeat(60)).length, 40);
  assert.match(newCustomId(), /^c_[a-z0-9]{12}$/);
});

test('a split: two to ten known shares, whole cents, one share per category', () => {
  const known = categoryValidator([GIFTS]);
  assert.equal(known('groceries'), true);
  assert.equal(known('c_gifts12345'), true);
  assert.equal(known('c_unknown123'), false);
  assert.deepEqual(
    sanitizeSplit([{ id: 'groceries', cents: 3000 }, { id: 'c_gifts12345', cents: 1250 }, { id: 'groceries', cents: 500 }], known),
    [{ id: 'groceries', cents: 3500 }, { id: 'c_gifts12345', cents: 1250 }],
  );
  // One share left is no split; bad shares go first.
  assert.equal(sanitizeSplit([{ id: 'groceries', cents: 3000 }, { id: 'nope', cents: 100 }], known), null);
  assert.equal(sanitizeSplit([{ id: 'groceries', cents: 3000 }, { id: 'shopping', cents: 0.5 }], known), null);
  assert.equal(sanitizeSplit([{ id: 'groceries', cents: 3000 }, { id: 'shopping', cents: -5 }], known), null);
  assert.equal(sanitizeSplit('x', known), null);
  const all = sanitizeSplits({ a: [{ id: 'groceries', cents: 1 }, { id: 'shopping', cents: 2 }], __proto__: [], b: 'x' }, known);
  assert.deepEqual(Object.keys(all), ['a']);
});

test('splitParts signs the shares like the booking and refuses one that no longer adds up', () => {
  const split = [{ id: 'groceries' as const, cents: 3000 }, { id: 'shopping' as const, cents: 4250 }];
  assert.deepEqual(splitParts(split, -72.5), [{ id: 'shopping', amount: -42.5 }, { id: 'groceries', amount: -30 }]);
  assert.deepEqual(splitParts(split, 72.5), [{ id: 'shopping', amount: 42.5 }, { id: 'groceries', amount: 30 }]);
  assert.equal(splitParts(split, -72.51), null, 'the bank re-issued it with another amount');
  assert.equal(splitParts([split[0]], -30), null);
  assert.equal(remainderCents(-72.5, [1250, 1000]), 5000);
  assert.equal(remainderCents(10, [1500]), -500);
});

test('a split booking counts each share in its own category', () => {
  setCustomCategories([GIFTS]);
  try {
    const shop = mt940({ day: '2026-09-12', amount: -80, gvc: '106', text: 'KARTENZAHLUNG', name: 'REWE SAGT DANKE 4711//BERLIN/DE' });
    const other = mt940({ day: '2026-09-13', amount: -20, gvc: '106', text: 'KARTENZAHLUNG', name: 'REWE SAGT DANKE 4712//BERLIN/DE' });
    const splits = { [txKey(shop)]: [{ id: 'groceries' as const, cents: 5000 }, { id: GIFTS.id, cents: 3000 }] };
    const categoryOf = (tx: SerializedTransaction) => categorize(tx, { ownIbans: OWN_IBANS, splits });

    const r = categoryOf(shop);
    assert.equal(r.id, 'groceries');
    assert.equal(r.source, 'manual');
    assert.equal(r.parts?.length, 2);
    assert.equal(categoryOf(other).parts, undefined);

    const totals = periodTotals([shop, other], { categoryOf });
    assert.equal(totals.expense, 100);
    assert.equal(totals.count, 2, 'two bookings, however many shares');
    assert.deepEqual(totals.byCategory.map((c) => [c.id, c.amount, c.count]), [['groceries', 70, 2], [GIFTS.id, 30, 1]]);

    // The counterparties still see one booking each, whole.
    const top = topCounterparties([shop, other], { categoryOf, dir: 'out', limit: 5 });
    assert.equal(top.reduce((s, c) => s + c.count, 0), 2);
    assert.equal(Math.round(top.reduce((s, c) => s + c.amount, 0) * 100), 10000);

    // Filtered by a share's category, the booking is found.
    const filter = { query: '', dir: 'all', category: GIFTS.id } as const;
    assert.deepEqual(filterTransactions([shop, other], filter as never, { categoryOf }), [shop]);

    // The CSV names each share with its amount.
    const account = { accountNumber: '1234593271', iban: 'DE02120300000000202051', bic: 'BYLADEM1001', currency: 'EUR', accountType: 'CheckingAccount' };
    const csv = transactionsToCsv([shop], { account: account as never, bankName: 'Musterbank eG', categoryOf });
    assert.match(csv, /Lebensmittel & Drogerie 50,00 \/ Geschenke 30,00/);
  } finally {
    setCustomCategories([]);
  }
});

test('own categories are known while registered, and read as "Sonstiges" once gone', () => {
  setCustomCategories([GIFTS, RENT_IN]);
  try {
    assert.equal(isCategoryId(GIFTS.id), true);
    assert.equal(categoryLabel(GIFTS.id), 'Geschenke');
    assert.equal(categoryDef(RENT_IN.id).direction, 'in');
    assert.ok(budgetCategories().includes(GIFTS.id));
    assert.ok(!budgetCategories().includes(RENT_IN.id), 'income has no budget');
  } finally {
    setCustomCategories([]);
  }
  assert.equal(isCategoryId(GIFTS.id), false);
  assert.equal(categoryDef(GIFTS.id).id, 'other');
});

test('budgets for own categories need the vault to name them', () => {
  assert.deepEqual(sanitizeBudgets({ groceries: 100, c_gifts12345: 5000, c_rentin1234: 100 }, [GIFTS, RENT_IN]), {
    groceries: 100, c_gifts12345: 5000,
  });
  assert.deepEqual(sanitizeBudgets({ c_gifts12345: 5000 }), {}, 'no list, no own budget');
});

test('the vault checks every category id against its own list', () => {
  const vault = sanitizeVault({
    version: 1,
    templates: [],
    aliases: {},
    customCategories: [GIFTS],
    categoryRules: { 'name:REWE': GIFTS.id, 'name:ALDI': 'c_strangers12' },
    txCategories: { a: GIFTS.id, b: 'c_strangers12' },
    splits: {
      a: [{ id: GIFTS.id, cents: 100 }, { id: 'groceries', cents: 200 }],
      b: [{ id: 'c_strangers12', cents: 100 }, { id: 'groceries', cents: 200 }],
    },
    budgets: { [GIFTS.id]: 1000, c_strangers12: 1000 },
    dismissedRecurring: [],
    notes: {},
    sentOrders: [],
    updatedAt: new Date(0).toISOString(),
  });
  assert.ok(vault);
  assert.deepEqual(vault.customCategories, [GIFTS]);
  assert.deepEqual(vault.categoryRules, { 'name:REWE': GIFTS.id });
  assert.deepEqual(vault.txCategories, { a: GIFTS.id });
  assert.deepEqual(Object.keys(vault.splits), ['a']);
  assert.deepEqual(vault.budgets, { [GIFTS.id]: 1000 });
  // A vault from before own categories and splits reads as one without any.
  const old = sanitizeVault({ version: 1, updatedAt: new Date(0).toISOString() });
  assert.deepEqual(old?.customCategories, []);
  assert.deepEqual(old?.splits, {});
});

test('deleting an own category takes its rules, choices, budget and splits with it', () => {
  const v = {
    categoryRules: { 'name:A': GIFTS.id, 'name:B': 'groceries' as const },
    txCategories: { t1: GIFTS.id, t2: 'shopping' as const },
    budgets: { [GIFTS.id]: 500, groceries: 100 },
    splits: {
      s1: [{ id: GIFTS.id, cents: 1 }, { id: 'groceries' as const, cents: 2 }],
      s2: [{ id: 'shopping' as const, cents: 1 }, { id: 'groceries' as const, cents: 2 }],
    },
  };
  const out = withoutCategory(v, GIFTS.id);
  assert.deepEqual(out.categoryRules, { 'name:B': 'groceries' });
  assert.deepEqual(out.txCategories, { t2: 'shopping' });
  assert.deepEqual(out.budgets, { groceries: 100 });
  assert.deepEqual(Object.keys(out.splits!), ['s2']);
  // Nothing named it: the same objects come back.
  const same = withoutCategory(v, 'c_nothing1234');
  assert.equal(same.categoryRules, v.categoryRules);
  assert.equal(same.splits, v.splits);
});
