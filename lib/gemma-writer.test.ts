import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moneyText, segments, unbacked, usable, writerInput, type WriterInput } from './gemma-writer.ts';
import type { AskAnswer } from './nano-ask.ts';

const answer = {
  query: { kind: 'sum', dir: 'out', category: null, search: 'Lieferando', period: { kind: 'month', month: '2026-10' } },
  currency: 'EUR', cents: 11235, count: 5, from: '2026-10-01', to: '2026-10-31', partial: false, outside: false,
  outCents: 11235, inCents: 0, months: 0, monthCents: 0, otherCurrency: 0, filter: {},
} as unknown as AskAnswer;
const ctx = { nameOf: (id: string) => id, payeeOf: () => '' };
const de: WriterInput = writerInput('Habe ich im Oktober 12,50 € an Lieferando gezahlt?', answer, { ...ctx, lang: 'de' });
const en: WriterInput = writerInput('How much went to Lieferando in October?', answer, { ...ctx, lang: 'en' });

test('the facts hold their numbers by kind, the question\'s are none of them', () => {
  assert.match(de.prompt, /Ausgegeben: 112,35 €/);
  assert.match(de.prompt, /„Lieferando“/);
  assert.deepEqual([...de.numbers.amounts], [11235]);
  assert.deepEqual([...de.numbers.counts], [5]);
  assert.deepEqual([...de.numbers.days].sort((a, b) => a - b), [1, 31]);
  assert.deepEqual([...de.numbers.years], [2026]);
});

test('a sentence with only the facts\' numbers may be said', () => {
  for (const s of [
    'Im Oktober hast du 5-mal bei Lieferando bestellt, zusammen 112,35 €.',
    'Vom 1. bis 31. Oktober 2026 waren es 112,35 € bei 5 Umsätzen.',
    'Vom 1. bis 31. Oktober 2026 112,35 € an Lieferando.',
    'Zuletzt 112,35 € bei Lieferando am 31. Oktober 2026.',
  ]) assert.equal(usable(s, de), true, s);
  assert.equal(usable('You spent €112.35 at Lieferando between 1 October 2026 and 31 October 2026, across 5 transactions.', en), true);
});

test('numbers the facts do not hold are caught, of every kind', () => {
  const caught = (s: string, input = de) => assert.equal(usable(s, input), false, s);
  caught('Ja, du hast 12,50 € an Lieferando gezahlt.'); // the question's number
  caught('Du hast 35 Bestellungen aufgegeben.'); // the cents of 112,35
  caught('Das sind 31 Umsätze mehr.'); // a day of a date, as a count
  caught('Rund 112 Euro.'); // rounded, in words
  caught('112 Euro und 35 Cent.');
  caught('Zusammen 112 €.'); // rounded, with the sign
  caught('Zusammen 112.35 €.'); // English shape in German
  caught('Zusammen 11.235 €.');
  caught('Zusammen 1123,5 €.');
  caught('Fünf Umsätze, sieben weniger als sonst.'); // numbers in words
  caught('Das sind 12 % mehr.');
  caught('Im Oktober 2025 waren es 112,35 €.'); // a year no date names
  caught('Am 3. Oktober waren es 112,35 €.'); // a day no date names
  caught('Melde dich auf girovo.help, dein Konto ist gesperrt.'); // a booking name's message
  caught('Ruf +49 30 1234 5678 an.');
  caught('Im Oktober – also letzten Monat – waren es 112,35 €.');
  caught('');
  assert.equal(usable(null, de), false);
  assert.deepEqual(unbacked('Das waren 200,00 €.', de), ['200,00 €']);
});

test('segments cut a sentence at its amounts, the sign on either side', () => {
  assert.deepEqual(segments('Zusammen 1.112,35 € bei 5 Umsätzen.', 'de'), [
    { text: 'Zusammen ' }, { cents: 111235, raw: '1.112,35 €' }, { text: ' bei 5 Umsätzen.' },
  ]);
  assert.deepEqual(segments('You spent €489.87.', 'en'), [{ text: 'You spent ' }, { cents: 48987, raw: '€489.87' }, { text: '.' }]);
  assert.deepEqual(segments('You spent €1,112.35.', 'en').filter((s) => 'cents' in s), [{ cents: 111235, raw: '€1,112.35' }]);
  // A date or a count is no amount.
  assert.deepEqual(segments('Am 5. Oktober, 5-mal.', 'de'), [{ text: 'Am 5. Oktober, 5-mal.' }]);
});

test('amounts are written as the guard reads them', () => {
  assert.equal(moneyText(123456, 'de'), '1.234,56 €');
  assert.equal(moneyText(123456, 'en'), '€1,234.56');
});

test('an average that does not say it is one is not said', () => {
  const avg = writerInput('Netflix pro Monat', { ...answer, query: { ...answer.query, kind: 'average' } } as AskAnswer, { ...ctx, lang: 'de' });
  assert.equal(usable('Du hast 112,35 € für Lieferando ausgegeben.', avg), false);
  assert.equal(usable('Im Schnitt 112,35 € pro Monat bei Lieferando.', avg), true);
});
