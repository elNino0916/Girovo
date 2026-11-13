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
  assert.match(de.prompt, /Du hast an „Lieferando“ gezahlt: 112,35 €/);
  assert.match(de.prompt, /„Lieferando“/);
  assert.deepEqual([...de.numbers.amounts], [11235]);
  assert.deepEqual([...de.numbers.counts], [5]);
  // The month in words ("Zeitraum: Oktober 2026"), not as a span of days.
  assert.match(de.prompt, /Zeitraum: Oktober 2026/);
  assert.deepEqual([...de.numbers.days], []);
  assert.deepEqual([...de.numbers.years], [2026]);
});

test('a sentence with only the facts\' numbers may be said', () => {
  for (const s of [
    'Im Oktober hast du 5-mal bei Lieferando bestellt, zusammen 112,35 €.',
    'Im Oktober 2026 waren es 112,35 € bei 5 Umsätzen.',
    'Im Oktober 112,35 € an Lieferando.',
  ]) assert.equal(usable(s, de), true, s);
  assert.equal(usable('You spent €112.35 at Lieferando in October 2026, across 5 transactions.', en), true);
  // A period the facts do not name, a name they do not hold, the largest said as a total.
  assert.equal(usable('Im September 2026 waren es 112,35 €.', de), false);
  assert.equal(usable('Von Lea hast du 112,35 € bekommen.', de), false);
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

test('money from a name is said as from that name, and a sentence that turns it round is not said', () => {
  const fromNadine = { ...answer, query: { ...answer.query, dir: 'in', search: 'Nadine Milleville', period: { kind: 'thisYear' } }, cents: 58675, partial: true } as unknown as AskAnswer;
  const input = writerInput('Was kam dieses Jahr von Nadine Milleville?', fromNadine, { ...ctx, lang: 'de' });
  assert.match(input.prompt, /Du hast von „Nadine Milleville“ bekommen: mindestens 586,75 €/);
  assert.equal(usable('Nadine Milleville hat mindestens 586,75 € bekommen.', input), false);
  assert.equal(usable('Von Nadine Milleville hast du mindestens 586,75 € bekommen.', input), true);
});

test('a list\'s facts: how many, the total, the newest booking', () => {
  const newestTx = { entryDate: '2026-10-28', valueDate: '2026-10-28', amount: -23.4, currency: 'EUR' };
  const list = { ...answer, query: { ...answer.query, kind: 'list' }, latest: [newestTx] } as unknown as AskAnswer;
  const input = writerInput('Zeig alle Zahlungen an Lieferando im Oktober', list, { ...ctx, payeeOf: () => 'Lieferando', lang: 'de' });
  assert.match(input.prompt, /Anzahl Umsätze: 5/);
  assert.match(input.prompt, /Du hast an „Lieferando“ gezahlt: 112,35 €/);
  assert.match(input.prompt, /Neuester Umsatz: Lieferando, 23,40 €, am 28\. Oktober 2026/);
  assert.equal(usable('Im Oktober hast du 5 Umsätze bei Lieferando, zuletzt 23,40 € am 28. Oktober.', input), true);
  // Both ways at once: no total.
  const both = writerInput('Zeig alles mit Lieferando', { ...list, query: { ...list.query, dir: 'all' } } as AskAnswer, { ...ctx, lang: 'de' });
  assert.doesNotMatch(both.prompt, /112,35/);
});

test('a ranking\'s facts say how many there are', () => {
  const row = (name: string, cents: number) => ({ key: name, category: null, name, cents, count: 1, share: 0, filter: {} });
  const rank = {
    ...answer, query: { ...answer.query, kind: 'rank', search: null, category: 'dining', rank: { by: 'payee', metric: 'count' } },
    rank: [row('Pinos Pizza', 8450), row('Café Lotte', 1200), row('Sushi Bar', 3100)],
  } as unknown as AskAnswer;
  const input = writerInput('In welchen Restaurants war ich im Oktober?', rank, { ...ctx, lang: 'de' });
  assert.match(input.prompt, /Anzahl Empfänger: 3/);
  assert.equal(usable('Im Oktober warst du in 3 Restaurants, am häufigsten bei Pinos Pizza.', input), true);
});
