// Girovo AI's help: "Was kannst du?" and its kin read as help, real questions
// never do, and every question the help answer offers to tap is read as what
// it shows (components/insights/ask/HelpAnswer.tsx asks them as typed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAsked, type ReadResult } from './ask-read.ts';
import { sanitizeTurn } from './ask-saved.ts';
import { isBuiltinCategoryId, type CategoryId } from './categories.ts';
import { de, en } from './i18n/messages/ask.ts';

const builtin = (v: unknown): v is CategoryId => isBuiltinCategoryId(v);
const input = { today: '2026-11-14', own: [], reading: null, contracts: ['Netflix', 'Spotify'] };
const read = (q: string): ReadResult => readAsked(q, null, input);
const kindOf = (r: ReadResult): string => ('intent' in r ? r.intent.kind : 'query' in r ? r.query.kind : 'offTopic' in r ? 'offTopic' : 'notUnderstood');

test('asking what Girovo AI can do reads as help', () => {
  for (const q of [
    'Was kannst du?', 'was kannst du', 'Was kannst du alles?', 'Was kannst du so?', 'Was kannst du für mich tun?',
    'Was kann ich tun?', 'Was kann ich hier machen?', 'Was kann ich fragen?', 'Was kann ich dich alles fragen?', 'Was kann man hier fragen?',
    'Hilfe', 'Hilfe!', 'Ich brauche Hilfe', 'Wie funktionierst du?', 'Wie funktioniert das?', 'Wie funktioniert Girovo AI?',
    'Wobei kannst du mir helfen?', 'Kannst du mir helfen?', 'Hallo Girovo, was kannst du?', 'Wer bist du?', 'Was bist du?',
    'Zeig mir Beispiele', 'Welche Fragen verstehst du?',
    'What can you do?', 'what can you do for me', 'What can I ask?', 'What can I ask you?', 'What can I do here?',
    'Help', 'help me', 'How do you work?', 'How does this work?', 'Who are you?', 'How can you help me?',
  ]) {
    assert.deepEqual(read(q), { intent: { kind: 'help' } }, q);
  }
});

test('real questions that start the same way stay what they are', () => {
  const cases: [string, string][] = [
    ['Was kann ich mir leisten?', 'afford'],
    ['Was kann ich mir diesen Monat noch leisten?', 'afford'],
    ['Kann ich mir 800 € leisten?', 'afford'],
    ['What can I afford?', 'afford'],
    ['Was kann ich kündigen?', 'cancelBy'],
    ['Was kann ich bald kündigen?', 'cancelBy'],
    ['What can I cancel?', 'cancelBy'],
    ['Was kann ich sparen?', 'sum'],
    ['Was kann ich diesen Monat noch ausgeben?', 'sum'],
    ['Kannst du mir helfen, Geld zu sparen?', 'sum'],
    ['Wer schuldet mir noch Geld?', 'owed'],
    ['Welche Abos habe ich?', 'contracts'],
  ];
  for (const [q, kind] of cases) assert.equal(kindOf(read(q)), kind, q);
});

test('small talk stays small talk', () => {
  for (const q of ['Hallo', 'Wie geht es dir', 'Danke', 'Hilfe, wo ist mein Geld hin?', 'Was machst du heute Abend?']) {
    assert.notEqual(kindOf(read(q)), 'help', q);
  }
  assert.ok('offTopic' in read('Hallo'));
  assert.ok('offTopic' in read('Wie geht es dir'));
});

// What each example in the help answer must be read as, group by group, in both languages.
const EXPECTED = [
  ['sum', 'average', 'count'],
  ['rank', 'rank', 'list'],
  ['balance', 'monthEnd', 'afford'],
  ['contracts', 'cancelBy', 'priceRises'],
  ['budgetsOver', 'budgetLeft', 'goal'],
  ['owed', 'salary'],
  ['budget', 'remindContract', 'prepareTransfer'],
  [],
];

for (const [lang, words] of [['de', de], ['en', en]] as const) {
  test(`every example in the help answer is read as what it shows (${lang})`, () => {
    assert.equal(words.help.groups.length, EXPECTED.length);
    words.help.groups.forEach((g, i) => {
      assert.ok(g.examples.length <= 3, g.title);
      assert.deepEqual(g.examples.map((q) => kindOf(read(q))), EXPECTED[i], g.title);
    });
    // The explanation is asked from a booking; the line names the question its details offer.
    assert.ok(words.help.groups.at(-1)!.text.includes(words.explain.question));
    assert.ok(words.help.shown > 0 && words.help.shown < words.help.groups.length);
  });

  test(`the empty conversation's chip reads as help (${lang})`, () => {
    assert.deepEqual(read(words.thread.helpChip), { intent: { kind: 'help' } });
  });

  test(`the help texts carry no dashes (${lang})`, () => {
    const texts = [words.help.intro, words.help.how, words.help.style, words.help.styleLink, ...words.help.groups.flatMap((g) => [g.title, g.text, ...g.examples])];
    for (const t of texts) assert.doesNotMatch(t, /[–—]/, t);
  });
}

test('a help turn is kept with its conversation', () => {
  const raw = { question: 'Was kannst du?', state: 'answered', day: '2026-11-14', intent: { kind: 'help' } };
  assert.deepEqual(sanitizeTurn(raw, builtin), raw);
});
