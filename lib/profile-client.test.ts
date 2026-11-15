import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loginPlan, startingOrder, suggestedName, withProfileBanks } from './profile-client.ts';

const spk = { blz: '12345678', name: 'Sparkasse', userId: 'kunde1' };
const vb = { blz: '50050201', name: 'Volksbank', userId: 'max' };
const lbs = { blz: '76543210', name: 'LBS', userId: 'bau' };

test('loginPlan: the first bank with a PIN logs in first, the others with a PIN follow in order', () => {
  const plan = loginPlan([spk, { ...vb, pin: '1' }, { ...lbs, pin: '2' }]);
  assert.equal(plan.first?.userId, 'max');
  assert.deepEqual(plan.rest, [{ blz: lbs.blz, userId: 'bau', pin: '2' }]);
  assert.equal(plan.typed, null);
});

test('loginPlan: no PIN anywhere brings up the first bank\'s login form', () => {
  assert.deepEqual(loginPlan([spk, vb]), { first: null, rest: [], typed: spk });
  assert.deepEqual(loginPlan([]), { first: null, rest: [], typed: null });
});

test('startingOrder: the bank opened with, the logged-in ones, the remembered ones, each once', () => {
  assert.deepEqual(startingOrder(spk, [vb], [vb, lbs, { ...spk, name: 'Doppelt' }]).map((b) => b.userId), ['kunde1', 'max', 'bau']);
});

test('withProfileBanks: adds every profile bank but the one logged in, in the profile\'s order', () => {
  const next = withProfileBanks([vb], [spk, vb, lbs], vb);
  assert.deepEqual(next?.map((b) => b.userId), ['max', 'kunde1', 'bau']);
  assert.equal(withProfileBanks([spk, lbs], [spk, vb, lbs], vb), null);
});

test('suggestedName: the holder on one line, at most 40 characters', () => {
  assert.equal(suggestedName('  Max   Mustermann '), 'Max Mustermann');
  assert.equal(suggestedName('x'.repeat(60)).length, 40);
});
