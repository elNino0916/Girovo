import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_VAULT } from './app-types.ts';
import type { SerializedTransaction } from './fints-types';
import { vaultEntries, vaultFromEntries } from './sync-entries.ts';
import { mergeVaults, sanitizeVault } from './vault.ts';
import {
  AI_NAMES_LIMITS, aiNameKey, aiNameSource, aiNamesMap, mergeAiNames, namesToClean, sanitizeAiNames, withCleanedNames,
} from './ai-names-store.ts';

const tx = (remoteName: string, purpose = '', ultimateName?: string) =>
  ({ remoteName, purpose, ultimateName, amount: -10, entryDate: '2026-11-01' }) as unknown as SerializedTransaction;

test('one key per name as the bank writes it, the purpose left out', () => {
  const a = aiNameSource(tx('REWE MARKT GMBH-ZWNL 4711', 'Kartenzahlung 01.11.'));
  const b = aiNameSource(tx('REWE  MARKT GMBH-ZWNL 4711', 'Kartenzahlung 02.11.'));
  assert.deepEqual(a, { key: 'REWE MARKT GMBH-ZWNL 4711', name: 'REWE MARKT GMBH-ZWNL 4711', shop: null });
  assert.equal(a?.key, b?.key);
  assert.equal(aiNameSource(tx('  ')), null);
  assert.equal(aiNameKey(tx('')), '');
});

test('a payment service is keyed with the shop its purpose names', () => {
  const zalando = aiNameSource(tx('PAYPAL EUROPE S.A.R.L. ET CIE S.C.A', 'Ihr Einkauf bei ZALANDO SE'));
  const otto = aiNameSource(tx('PAYPAL EUROPE S.A.R.L. ET CIE S.C.A', 'Ihr Einkauf bei OTTO GMBH'));
  assert.ok(zalando?.shop, 'the shop is read from the purpose');
  assert.notEqual(zalando?.key, otto?.key);
  assert.ok(zalando!.key.startsWith('PAYPAL EUROPE'));
  assert.ok(zalando!.key.length <= AI_NAMES_LIMITS.key);
  // Without a shop in the purpose, the service's own name is the key.
  assert.equal(aiNameSource(tx('PAYPAL EUROPE S.A.R.L. ET CIE S.C.A', 'Danke'))?.shop, null);
});

test('only names not answered yet are asked, each once', () => {
  const txs = [tx('REWE MARKT 4711'), tx('REWE MARKT 4711'), tx('Katharina Weber'), tx('ALDI SUED')];
  const cache = { version: 2, names: { 'ALDI SUED': 'Aldi Süd' } };
  assert.deepEqual(namesToClean(txs, cache, 2).map((s) => s.key), ['REWE MARKT 4711', 'Katharina Weber']);
  // Another prompt version asks everything again.
  assert.equal(namesToClean(txs, cache, 3).length, 3);
  assert.deepEqual(namesToClean(txs, cache, 2, new Set(['Katharina Weber'])).map((s) => s.key), ['REWE MARKT 4711']);
});

test('the names shown: real answers of this version only', () => {
  const cache = { version: 2, names: { 'REWE MARKT 4711': 'Rewe', 'XY 123': '' } };
  assert.deepEqual([...aiNamesMap(cache, 2)], [['REWE MARKT 4711', 'Rewe']]);
  assert.equal(aiNamesMap(cache, 3).size, 0);
  assert.equal(aiNamesMap(undefined, 2).size, 0);
});

test('adding names: another version starts empty, the cap drops the oldest unneeded first', () => {
  const old = { version: 1, names: { A: 'a' } };
  assert.deepEqual(withCleanedNames(old, 2, [['B', 'b']]), { version: 2, names: { B: 'b' } });

  const full: Record<string, string> = {};
  for (let i = 0; i < AI_NAMES_LIMITS.entries; i++) full[`N${i}`] = `n${i}`;
  const next = withCleanedNames({ version: 2, names: full }, 2, [['NEW', 'new']], new Set(['N0']));
  const keys = Object.keys(next.names);
  assert.equal(keys.length, AI_NAMES_LIMITS.entries);
  assert.ok(keys.includes('N0'), 'a name the loaded bookings use stays');
  assert.ok(!keys.includes('N1'), 'the oldest other one goes');
  assert.equal(keys.at(-1), 'NEW');
  // Too long an answer is cut to what the check allows.
  assert.equal(withCleanedNames(undefined, 2, [['K', 'x'.repeat(80)]]).names.K.length, AI_NAMES_LIMITS.name);
});

test('the vault keeps only a well formed cache', () => {
  assert.equal(sanitizeAiNames(null), null);
  assert.equal(sanitizeAiNames({ version: '2', names: {} }), null);
  assert.equal(sanitizeAiNames({ version: 2, names: {} }), null);
  assert.deepEqual(
    sanitizeAiNames({ version: 2, names: { REWE: 'Rewe', 'bad\nkey': 'x', LONG: 'y'.repeat(60), N: 3, EMPTY: '' } }),
    { version: 2, names: { REWE: 'Rewe', EMPTY: '' } },
  );
  const many: Record<string, string> = {};
  for (let i = 0; i < AI_NAMES_LIMITS.entries + 20; i++) many[`N${i}`] = 'x';
  assert.equal(Object.keys(sanitizeAiNames({ version: 2, names: many })!.names).length, AI_NAMES_LIMITS.entries);
});

test('a backup adds its names of the same version; this device wins', () => {
  const here = { version: 2, names: { A: 'Rewe' } };
  assert.deepEqual(mergeAiNames(here, { version: 2, names: { A: 'REWE', B: 'Aldi' } }), { version: 2, names: { A: 'Rewe', B: 'Aldi' } });
  assert.deepEqual(mergeAiNames(here, { version: 1, names: { B: 'Aldi' } }), here);
  assert.deepEqual(mergeAiNames(undefined, here), here);
  assert.equal(mergeAiNames(undefined, undefined), null);
});

test('the vault keeps the switch and the names on this device; a sync never carries them', () => {
  const aiNames = { version: 2, names: { 'REWE MARKT 4711': 'Rewe' } };
  const here = { ...EMPTY_VAULT, aiNamesOn: true as const, aiNames };
  assert.deepEqual(sanitizeVault(here)?.aiNames, aiNames);
  assert.equal(sanitizeVault(here)?.aiNamesOn, true);
  assert.equal(sanitizeVault({ ...EMPTY_VAULT, aiNamesOn: 'yes' })?.aiNamesOn, undefined);
  // Not an entry: the other device keeps its own.
  assert.ok(![...vaultEntries(here).keys()].some((k) => k.startsWith('aiNames')));
  const synced = vaultFromEntries(vaultEntries(here), here);
  assert.deepEqual(synced.aiNames, aiNames);
  assert.equal(synced.aiNamesOn, true);
  assert.equal(vaultFromEntries(vaultEntries(here), EMPTY_VAULT).aiNames, undefined);
  // A backup restored: this device's names first.
  const merged = mergeVaults(here, { ...EMPTY_VAULT, aiNames: { version: 2, names: { 'ALDI SUED': 'Aldi Süd', 'REWE MARKT 4711': 'REWE' } } });
  assert.deepEqual(merged.aiNames?.names, { 'ALDI SUED': 'Aldi Süd', 'REWE MARKT 4711': 'Rewe' });
});
