import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listWords, rankShown, rankWords, RANK_SHOWN } from './ask-list.ts';
import type { AskQuery } from './nano-ask.ts';

const q = (over: Partial<AskQuery>): AskQuery => ({ kind: 'rank', dir: 'out', category: null, search: null, period: { kind: 'all' }, ...over });

test('a ranking is said in the words of what it ranks', () => {
  const payee = { by: 'payee', metric: 'sum' } as const;
  assert.equal(rankWords(q({ rank: payee, category: 'dining' })), 'dining');
  assert.equal(rankWords(q({ rank: payee, category: 'groceries' })), 'shops');
  assert.equal(rankWords(q({ rank: payee, category: 'shopping' })), 'shops');
  assert.equal(rankWords(q({ rank: payee })), 'payeeOut');
  assert.equal(rankWords(q({ rank: payee, dir: 'in' })), 'payeeIn');
  assert.equal(rankWords(q({ rank: { by: 'category', metric: 'count' } })), 'categoryOut');
  assert.equal(rankWords(q({ rank: { by: 'category', metric: 'sum' }, category: 'income' })), 'categoryIn');
});

test('a long ranking shows eight rows until opened, a short one all of them', () => {
  const rows = Array.from({ length: 14 }, (_, i) => i);
  assert.equal(RANK_SHOWN, 8);
  assert.deepEqual(rankShown(rows, false), { rows: rows.slice(0, 8), hidden: 6 });
  assert.deepEqual(rankShown(rows, true), { rows, hidden: 0 });
  assert.deepEqual(rankShown(rows.slice(0, 8), false), { rows: rows.slice(0, 8), hidden: 0 });
});

test('a list names its total only for money one way', () => {
  assert.deepEqual(listWords(q({ kind: 'list', search: 'Amazon' })), { words: 'withName', total: true });
  assert.deepEqual(listWords(q({ kind: 'list', category: 'groceries' })), { words: 'withCategory', total: true });
  assert.deepEqual(listWords(q({ kind: 'list', dir: 'all' })), { words: 'plain', total: false });
});
