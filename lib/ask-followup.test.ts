import { test } from 'node:test';
import assert from 'node:assert/strict';
import { followUp, monthBefore } from './ask-followup.ts';
import { readQuestion, type AskQuery } from './nano-ask.ts';

const today = '2026-11-11';
const read = (q: string): AskQuery => {
  const r = readQuestion(q, null, today);
  assert.ok(r, `"${q}" is read`);
  return r;
};

test('a follow-up naming only a payee keeps the period before it', () => {
  const first = read('Wie viel ging im Oktober an Rewe?');
  const next = followUp(first, 'Und an Lieferando?', read('Und an Lieferando?'), today);
  assert.equal(next.search?.toLowerCase(), 'lieferando');
  assert.deepEqual(next.period, first.period);
  assert.equal(next.dir, 'out');
});

test('a follow-up naming only a month keeps the topic before it', () => {
  const first = read('Wie viel ging im Oktober an Rewe?');
  const next = followUp(first, 'Und im September?', read('Und im September?'), today);
  assert.equal(next.search, first.search);
  assert.deepEqual(next.period, { kind: 'month', month: '2026-09' });
});

test('without a question before it the reading stands as it is', () => {
  const q = read('Wie viel ging im Oktober an Rewe?');
  assert.deepEqual(followUp(null, 'Wie viel ging im Oktober an Rewe?', q, today), q);
});

test('a new topic after income takes its own direction', () => {
  const first = read('Wie viel Gehalt kam dieses Jahr?');
  assert.equal(first.dir, 'in');
  const next = followUp(first, 'Und Lebensmittel?', read('Und Lebensmittel?'), today);
  assert.equal(next.category, 'groceries');
  assert.equal(next.dir, 'out');
});

test('a model\'s guess at a bare follow-up does not replace the topic', () => {
  const first = read('Wie viel ging im Oktober an Rewe?');
  const guessed: AskQuery = { ...read('Größte Ausgabe'), category: 'shopping', search: null };
  const next = followUp(first, 'Größte Ausgabe', guessed, today);
  assert.equal(next.search, first.search);
  assert.equal(next.category, null);
  assert.equal(next.kind, 'largest');
});

test('the month before the one asked about, in either language', () => {
  const first = read('Wie viel ging im Oktober an Rewe?');
  const de = readQuestion('Und im Monat davor?', null, today) ?? first;
  assert.deepEqual(followUp(first, 'Und im Monat davor?', de, today).period, { kind: 'month', month: '2026-09' });
  assert.equal(followUp(first, 'Und im Monat davor?', de, today).kind, first.kind);
  const en1 = read('How much did I spend on groceries last month?');
  const en2 = readQuestion('And the month before?', null, today) ?? en1;
  assert.deepEqual(followUp(en1, 'And the month before?', en2, today).period, { kind: 'month', month: '2026-09' });
});

test('a ranking does not carry over to a new topic', () => {
  const first = read('Wofür gebe ich am meisten aus?');
  assert.equal(first.kind, 'rank');
  const next = followUp(first, 'Und an Lieferando?', read('Und an Lieferando?'), today);
  assert.equal(next.kind, 'sum');
  assert.equal(next.rank, undefined);
});

test('the month before a one-month period, and none for other periods', () => {
  assert.equal(monthBefore({ kind: 'month', month: '2026-10' }, today), '2026-09');
  assert.equal(monthBefore({ kind: 'month', month: '2026-01' }, today), '2025-12');
  assert.equal(monthBefore({ kind: 'lastMonth' }, today), '2026-09');
  assert.equal(monthBefore({ kind: 'days', days: 30 }, today), null);
  assert.equal(monthBefore({ kind: 'all' }, today), null);
});
