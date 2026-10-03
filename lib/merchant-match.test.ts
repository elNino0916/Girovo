import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knownInstitution, nameScore } from './merchant-match.ts';

test('the Sparkassen card processor is Helaba, however the bank spells it', () => {
  for (const n of [
    'Landesbank Hessen-Thüringen', 'LANDESBANK HESSEN-THUERINGEN', 'Landesbank Hessen-ThA.ringen',
    'Landesbank Hessen-Thüringen Girozentrale', 'HELABA',
  ]) {
    assert.deepEqual(knownInstitution(n), { domain: 'helaba.com', label: 'Helaba' }, n);
  }
  assert.equal(knownInstitution('Landesbank Baden-Württemberg'), null);
  assert.equal(knownInstitution('REWE Markt GmbH'), null);
});

test('a bare place name is never partial evidence for a brand', () => {
  // The hit that put the Hessian state crest on card payments.
  assert.equal(nameScore('hessen tha ringen hessen tha', 'hessen'), 0);
  assert.equal(nameScore('hessen thueringen', 'Staatskanzlei Hessen'), 0);
  assert.equal(nameScore('hessen', 'hessen'), 1, 'an exact match still counts');
  // Ordinary prefix matches keep working.
  assert.equal(nameScore('amazon prime', 'amazon'), 0.85);
});
