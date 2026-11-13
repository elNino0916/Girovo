import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dirChoices, periodChoices, periodLabel, readingChips, samePeriod, sameQuery, sentenceCase, topicChoices, topicLabel, withDir, withRank,
  withPer, withTopic,
} from './ask-chips.ts';
import type { AskQuery } from './nano-ask.ts';

const today = '2026-11-12';
const base: AskQuery = { kind: 'sum', dir: 'out', category: null, search: null, period: { kind: 'thisYear' } };
const labels = (q: AskQuery, own: { id: string; name: string }[] = []) => readingChips(q, today, own).map((c) => c.label);

test('a payee question reads as money out, the name and the period', () => {
  assert.deepEqual(labels({ ...base, search: 'Nadine Milleville' }), ['Ausgaben', 'Nadine Milleville', 'dieses Jahr']);
});

test('a ranking of places in a category names the category, the month and how it is ordered', () => {
  const q: AskQuery = { ...base, kind: 'rank', category: 'dining', period: { kind: 'month', month: '2026-08' }, rank: { by: 'payee', metric: 'sum' } };
  assert.deepEqual(labels(q), ['Ausgaben', 'Essen & Trinken', 'August 2026', 'nach Ort', 'nach Betrag']);
});

test('a ranking of the categories has no topic chip', () => {
  const q: AskQuery = { ...base, kind: 'rank', rank: { by: 'category', metric: 'count' } };
  assert.deepEqual(readingChips(q, today).map((c) => c.slot), ['dir', 'period', 'rankBy', 'metric']);
  assert.equal(readingChips(q, today).at(-1)?.label, 'nach Häufigkeit');
});

test('no topic reads as every category; the user\'s own category by its own name', () => {
  assert.equal(topicLabel(base), 'alle Kategorien');
  assert.equal(topicLabel({ ...base, category: 'c_hund01' }, [{ id: 'c_hund01', name: 'Hund' }]), 'Hund');
});

test('a comparison names the period it is set against by its month', () => {
  const q: AskQuery = { ...base, kind: 'compare', period: { kind: 'thisMonth' }, against: { kind: 'lastMonth' } };
  assert.deepEqual(labels(q), ['Ausgaben', 'alle Kategorien', 'diesen Monat', 'gegenüber Oktober 2026']);
});

test('periods read as the user would say them', () => {
  assert.equal(periodLabel({ kind: 'lastMonth' }, today), 'letzten Monat');
  assert.equal(periodLabel({ kind: 'lastMonth' }, today, true), 'Oktober 2026');
  assert.equal(periodLabel({ kind: 'lastYear' }, today, true), '2025');
  assert.equal(periodLabel({ kind: 'all' }, today), 'alles');
  assert.equal(periodLabel({ kind: 'year', year: 2024 }, today), '2024');
  assert.equal(periodLabel({ kind: 'months', months: 3 }, today), 'letzte 3 Monate');
  assert.equal(sentenceCase('diesen Monat'), 'Diesen Monat');
});

test('the same days are the same period', () => {
  assert.ok(samePeriod({ kind: 'month', month: '2026-10' }, { kind: 'lastMonth' }, today));
  assert.ok(samePeriod({ kind: 'all' }, { kind: 'all' }, today));
  assert.ok(!samePeriod({ kind: 'all' }, { kind: 'thisYear' }, today));
});

test('the period menu offers the quick choices, then the loaded months newest first, this and last month once', () => {
  const choices = periodChoices({ kind: 'thisYear' }, { from: '2026-07-03', to: '2026-11-12' }, today);
  assert.deepEqual(choices.slice(0, 5).map((p) => p.kind), ['thisMonth', 'lastMonth', 'thisYear', 'lastYear', 'all']);
  assert.deepEqual(choices.slice(5), [
    { kind: 'month', month: '2026-09' }, { kind: 'month', month: '2026-08' }, { kind: 'month', month: '2026-07' },
  ]);
});

test('a period none of the choices is leads the menu', () => {
  const current = { kind: 'months', months: 3 } as const;
  const choices = periodChoices(current, { from: '2026-10-01', to: '2026-11-12' }, today);
  assert.deepEqual(choices[0], current);
  assert.equal(periodChoices({ kind: 'month', month: '2026-10' }, { from: '2026-10-01', to: '2026-11-12' }, today)[0].kind, 'thisMonth');
});

test('both ways of money only where one figure still means something', () => {
  assert.deepEqual(dirChoices(base), ['out', 'in', 'all']);
  assert.deepEqual(dirChoices({ ...base, kind: 'average' }), ['out', 'in']);
  assert.deepEqual(dirChoices({ ...base, kind: 'rank', rank: { by: 'payee', metric: 'sum' } }), ['out', 'in']);
  // A list shows both ways by default: its chip offers "Beides".
  assert.deepEqual(dirChoices({ ...base, kind: 'list', dir: 'all' }), ['out', 'in', 'all']);
});

test('sameQuery: the same reading whatever the key order, a changed field is another', () => {
  const rank: AskQuery = { ...base, kind: 'rank', rank: { by: 'payee', metric: 'sum' } };
  assert.ok(sameQuery(rank, { rank: { metric: 'sum', by: 'payee' }, period: { kind: 'thisYear' }, search: null, category: null, dir: 'out', kind: 'rank' }));
  assert.ok(sameQuery(base, { ...base, against: undefined }));
  assert.ok(sameQuery(base, withDir(base, 'out')));
  assert.ok(!sameQuery(base, withDir(base, 'in')));
  assert.ok(!sameQuery(rank, withRank(rank, { metric: 'count' })));
  assert.ok(!sameQuery(base, { ...base, period: { kind: 'month', month: '2026-10' } }));
});

test('the topic menu offers the askable categories and then the user\'s own', () => {
  const list = topicChoices([{ id: 'c_hund01', name: 'Hund' }]);
  assert.equal(list[0], 'income');
  assert.equal(list.at(-1), 'c_hund01');
});

test('a new category drops the name and turns the money\'s way with it', () => {
  const q = withTopic({ ...base, search: 'Rewe', hint: 'groceries' }, 'income');
  assert.equal(q.category, 'income');
  assert.equal(q.search, null);
  assert.equal(q.hint, null);
  assert.equal(q.dir, 'in');
  assert.equal(withTopic({ ...base, dir: 'in' }, 'dining').dir, 'out');
  assert.equal(withTopic({ ...base, dir: 'all' }, 'dining').dir, 'all');
});

test('removing the name leaves every category', () => {
  const q = withTopic({ ...base, search: 'Nadine' }, null);
  assert.equal(q.search, null);
  assert.equal(q.category, null);
});

test('a category for a ranking of categories ranks the places in it', () => {
  const q = withTopic({ ...base, kind: 'rank', rank: { by: 'category', metric: 'sum' } }, 'dining');
  assert.deepEqual(q.rank, { by: 'payee', metric: 'sum' });
});

test('ranking by category lets go of the category it was narrowed to', () => {
  const q = withRank({ ...base, kind: 'rank', category: 'dining', rank: { by: 'payee', metric: 'sum' } }, { by: 'category' });
  assert.deepEqual(q.rank, { by: 'category', metric: 'sum' });
  assert.equal(q.category, null);
  assert.equal(withRank({ ...base, kind: 'rank', category: 'dining', rank: { by: 'payee', metric: 'sum' } }, { metric: 'count' }).category, 'dining');
});

test('an average has a chip for per month or per year', () => {
  const avg: AskQuery = { ...base, kind: 'average', period: { kind: 'all' } };
  assert.deepEqual(labels(avg), ['Ausgaben', 'alle Kategorien', 'alles', 'pro Monat']);
  const year = withPer(avg, 'year');
  assert.equal(year.per, 'year');
  assert.equal(labels(year).at(-1), 'pro Jahr');
  // Per month is the default: the field goes, so it reads as a question read per month.
  assert.equal('per' in withPer(year, 'month'), false);
  assert.ok(sameQuery(withPer(year, 'month'), avg));
  assert.equal(readingChips(base, today).some((c) => c.slot === 'per'), false);
});
