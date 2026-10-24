import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canRequest, equalSplit, resplit } from './bill-split.ts';

const people = (...names: string[]) => names.map((name, i) => ({ id: String(i), name }));

test('equal shares; the cent that does not divide stays with the user', () => {
  const s = equalSplit(-3079, people('Lea', 'Jonas'));
  assert.deepEqual(s.others.map((p) => p.cents), [1026, 1026]);
  assert.equal(s.own, 1027);
  assert.equal(s.own + s.others.reduce((a, p) => a + p.cents, 0), 3079);
  assert.equal(s.over, false);
});

test('typed shares stay; the rest share what is left', () => {
  const start = equalSplit(3000, people('Lea', 'Jonas'));
  const typed = start.others.map((p) => (p.name === 'Lea' ? { ...p, cents: 2000, typed: true } : p));
  const s = resplit(3000, typed);
  assert.equal(s.others[0].cents, 2000);
  assert.equal(s.others[1].cents, 500);
  assert.equal(s.own, 500);
});

test('shares that ask for more than the booking are refused', () => {
  const s = resplit(1000, [
    { id: '1', name: 'Lea', cents: 800, typed: true },
    { id: '2', name: 'Jonas', cents: 400, typed: true },
  ]);
  assert.equal(s.over, true);
  assert.equal(canRequest(s), false);
});

test('a request needs a name and a share for everyone asked', () => {
  assert.equal(canRequest(equalSplit(3000, people('Lea', ''))), false);
  assert.equal(canRequest(equalSplit(3000, people('Lea', 'Jonas'))), true);
  assert.equal(canRequest(equalSplit(3000, [])), false);
  assert.equal(canRequest(equalSplit(1, people('Lea'))), false);
});
