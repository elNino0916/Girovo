import assert from 'node:assert/strict';
import test from 'node:test';
import { addressed, answerDetails, askStyle, cleanAskName, nameFits } from './ask-style.ts';
import { sentenceCount, usable, type WriterInput } from './gemma-writer.ts';
import type { AskAnswer, AskQuery } from './nano-ask.ts';

test('a typed name is kept as a name, anything else is none', () => {
  assert.equal(cleanAskName('Nino'), 'Nino');
  assert.equal(cleanAskName('  Anna-Lena  '), 'Anna-Lena');
  assert.equal(cleanAskName("D'Arcy"), "D'Arcy");
  assert.equal(cleanAskName('Zoë'), 'Zoë');
  assert.equal(cleanAskName('Nino123'), undefined);
  assert.equal(cleanAskName('www.example.de'), undefined);
  assert.equal(cleanAskName(''), undefined);
  assert.equal(cleanAskName(42), undefined);
  assert.equal(cleanAskName('A'.repeat(40))?.length, 30);
});

test('the style fills in the defaults and resolves the name', () => {
  assert.deepEqual(askStyle(null, ''), { tone: 'friendly', length: 'short', name: null });
  assert.deepEqual(askStyle({}, 'Nino'), { tone: 'friendly', length: 'short', name: 'Nino' });
  assert.equal(askStyle({ askName: 'Nin' }, 'Nino').name, 'Nin', 'the typed name wins');
  assert.equal(askStyle({ askName: 'Nino1' }, 'Nino').name, 'Nino', 'an unusable typed name falls back to the bank');
  assert.equal(askStyle({ askNameOff: true, askName: 'Nin' }, 'Nino').name, null, 'switched off: no name at all');
  assert.equal(askStyle({ askTone: 'plain', askLength: 'long' }, '').tone, 'plain');
  assert.equal(askStyle({ askTone: 'loud' as never }, '').tone, 'friendly');
});

test('the name is not said beside the same name', () => {
  assert.equal(nameFits('Lea', 'Wie viel hat Lea Schmidt mir überwiesen?'), false);
  assert.equal(nameFits('Lea', 'Was ging ans Leasing?'), true, 'a whole word only');
  assert.equal(nameFits('Zoë', 'Geld von Zoe Klein'), false, 'accents aside');
  assert.equal(nameFits('Anna-Lena', 'Lena Weber'), false, 'any part of the name');
  assert.equal(nameFits('Nino', 'Wie viel ging an Rewe?'), true);
});

test('the name opens a sentence, its first word made small', () => {
  assert.deepEqual(addressed(['Im Oktober hast du ', 1, '.'], 'Nino'), ['Nino, im Oktober hast du ', 1, '.']);
  assert.deepEqual(addressed(['Du hast ', 1], 'Nino'), ['Nino, du hast ', 1]);
  assert.deepEqual(addressed([1, ' und mehr'], 'Nino'), [1, ' und mehr'], 'no plain words first: left as it is');
  assert.deepEqual(addressed(['Im Oktober'], null), ['Im Oktober']);
});

const answer = (q: Partial<AskQuery>, a: Partial<AskAnswer> = {}): AskAnswer => ({
  query: { kind: 'sum', dir: 'out', category: null, search: 'Rewe', period: { kind: 'month', month: '2026-10' }, ...q },
  filter: { dir: 'out', category: null, query: 'Rewe', from: '2026-10-01', to: '2026-10-31' },
  from: '2026-10-01', to: '2026-10-31', partial: false, outside: false, count: 9, cents: 31240, outCents: 31240, inCents: 0,
  tx: null, months: 0, monthCents: 0, otherCurrency: 0, currency: 'EUR', ...a,
});

test('a long answer gets last month and the largest booking', () => {
  const asked: AskQuery[] = [];
  const top = { amount: -64.9, bookingDate: '2026-10-12' } as never;
  const compute = (q: AskQuery) => {
    asked.push(q);
    return q.kind === 'largest' ? answer(q, { tx: top }) : answer(q, { cents: 34050, count: 8 });
  };
  const d = answerDetails(answer({}), compute, '2026-11-14');
  assert.equal(d?.before?.month, '2026-09');
  assert.equal(d?.before?.cents, 34050);
  assert.equal(d?.top, top);
  assert.ok(asked.some((q) => q.kind === 'largest' && q.search === 'Rewe'));
});

test('no details where they would mislead or say nothing', () => {
  const compute = (q: AskQuery) => answer(q);
  assert.equal(answerDetails(answer({ dir: 'all' }), compute, '2026-11-14'), null, 'both ways');
  assert.equal(answerDetails(answer({ kind: 'rank' }), compute, '2026-11-14'), null, 'a ranking');
  assert.equal(answerDetails(answer({}, { count: 0 }), compute, '2026-11-14'), null, 'nothing found');
  // A running month: no month before (a half month against a whole one), one booking: no largest.
  assert.equal(answerDetails(answer({ period: { kind: 'thisMonth' } }, { count: 1 }), compute, '2026-11-14'), null);
  // The month before only partly loaded: left out.
  const partial = (q: AskQuery) => (q.kind === 'largest' ? answer(q) : answer(q, { partial: true }));
  assert.equal(answerDetails(answer({}, { count: 1 }), partial, '2026-11-14'), null);
});

test('sentences are counted without dates and amounts', () => {
  assert.equal(sentenceCount('Im Oktober hast du 312,40 € ausgegeben.'), 1);
  assert.equal(sentenceCount('Der größte Betrag waren 64,90 € am 12. Oktober.'), 1);
  assert.equal(sentenceCount('In October you spent €312.40. That is less than in September.'), 2);
});

const input = (extra: Partial<WriterInput> = {}): WriterInput => ({
  prompt: 'Frage: Wie viel ging im Oktober an Rewe?\nFakten:\n- Worum es geht: Ausgaben · „Rewe“\n- Zeitraum: Oktober 2026',
  numbers: { amounts: new Set([31240]), counts: new Set(), days: new Set(), years: new Set([2026]) },
  lang: 'de',
  ...extra,
});

test('the guard holds the length and the name', () => {
  const one = 'Im Oktober hast du bei Rewe 312,40 € ausgegeben.';
  assert.equal(usable(one, input({ sentences: 1 })), true);
  assert.equal(usable(`${one} Das ist viel.`, input({ sentences: 1 })), false, 'two sentences for a short answer');
  assert.equal(usable(`${one} Das ist viel.`, input({ sentences: 3 })), true);
  assert.equal(usable(`Nino, im Oktober hast du bei Rewe 312,40 € ausgegeben.`, input({ address: 'Nino' })), true);
  assert.equal(usable(`Im Oktober hast du, Nino, bei Rewe 312,40 € ausgegeben.`, input({ address: 'Nino' })), false, 'the name only at the start');
  assert.equal(usable(`Nino, im Oktober hast du bei Rewe 312,40 € ausgegeben, Nino.`, input({ address: 'Nino' })), false, 'the name only once');
  assert.equal(usable('Im Oktober hast du bei Rewe 312,40 € ausgegeben!', input()), false, 'no exclamation mark');
  assert.equal(usable('Im Oktober hast du bei Rewe 312,40 € ausgegeben 🛒', input()), false, 'no emoji');
});
