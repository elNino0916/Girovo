import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aboutBookings, continuesFrom, followUp, monthBefore } from './ask-followup.ts';
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

test('"Und wo?" lists the places of the topic and month asked about', () => {
  const first = read('Wo war ich im August essen?');
  assert.equal(first.kind, 'rank');
  assert.equal(first.rank?.by, 'payee');
  const sum = read('Wie viel hab ich im August fürs Essen gehen ausgegeben?');
  const next = followUp(sum, 'Und wo?', readQuestion('Und wo?', null, today) ?? sum, today);
  assert.equal(next.kind, 'rank');
  assert.equal(next.rank?.by, 'payee');
  assert.equal(next.category, sum.category);
  assert.deepEqual(next.period, sum.period);
});

test('small talk is no question about the bookings, whatever a model reads into it', () => {
  for (const q of ['Hallo', 'Wie geht es dir', 'Danke!', 'Wer bist du?']) {
    assert.equal(aboutBookings(q, readQuestion(q, null, today), { dir: 'all', category: null, search: null }), false, q);
    assert.equal(aboutBookings(q, readQuestion(q, null, today), { dir: null, category: 'health', search: null }), false, q);
  }
  assert.equal(aboutBookings('Wie viel ging an Rewe?', readQuestion('Wie viel ging an Rewe?', null, today), null), true);
  assert.equal(aboutBookings('Was kostet mich Netflix?', null, { dir: null, category: null, search: 'Netflix' }), true);
  assert.equal(aboutBookings('Wofür gebe ich Geld aus?', null, { dir: null, category: 'shopping', search: null }), true);
});

test('a complete new question keeps nothing of the one before it', () => {
  const first = read('Wo war ich im August essen?');
  const q = 'Größte Ausgabe dieses Jahr';
  const next = followUp(first, q, read(q), today);
  assert.equal(next.category, null);
  assert.equal(next.search, null);
  assert.equal(next.kind, 'largest');
  assert.equal(continuesFrom('Und wo?'), true);
  assert.equal(continuesFrom('Pro Monat'), true);
  assert.equal(continuesFrom('Was ist mit Rewe?'), true);
  assert.equal(continuesFrom('Wie viel ging im Oktober an Rewe?'), false);
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

test('a list goes on like a sum: a new month or name keeps it a list, "wie viel insgesamt" asks the sum', () => {
  const first = read('Zeig alle Zahlungen an Amazon');
  assert.equal(first.kind, 'list');
  const october = followUp(first, 'Und im Oktober?', read('Und im Oktober?'), today);
  assert.deepEqual([october.kind, october.search, october.period], ['list', first.search, { kind: 'month', month: '2026-10' }]);
  const rewe = followUp(first, 'Und bei Rewe?', read('Und bei Rewe?'), today);
  assert.deepEqual([rewe.kind, rewe.search?.toLowerCase()], ['list', 'rewe']);
  const total = followUp(october, 'Und wie viel insgesamt?', october, today) // nothing to read in it: the question before stands, as lib/ask-read.ts hands it on;
  assert.deepEqual([total.kind, total.search, total.period], ['sum', first.search, october.period]);
});

test('"Zeig sie mir" lists the bookings of the question before', () => {
  const first = read('Wie viel ging im Oktober an Rewe?');
  assert.equal(continuesFrom('Zeig sie mir'), true);
  assert.equal(continuesFrom('Zeig mir die Umsätze'), true);
  const shown = followUp(first, 'Zeig sie mir', read('Zeig sie mir'), today);
  assert.deepEqual([shown.kind, shown.search, shown.period, shown.dir], ['list', 'Rewe', first.period, 'out']);
});

test('a bare "zeig" is no question about the bookings, "zeig mir alle Umsätze" is', () => {
  const rules = (q: string) => readQuestion(q, null, today);
  assert.equal(aboutBookings('Zeig mal, was du kannst', rules('Zeig mal, was du kannst'), null), false);
  assert.equal(aboutBookings('Zeig mir alle Umsätze', rules('Zeig mir alle Umsätze'), null), true);
});
