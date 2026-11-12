import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CategoryResult } from './categories.ts';
import type { SerializedTransaction } from './fints-types.ts';
import {
  askText, asksWith, compareFromQuestion, computeAnswer, dirFromQuestion, kindFromQuestion, nanoGeneration, parseAskAnswer,
  nameFromPayees, periodDays, periodFromQuestion, periodsFromQuestion, questionTopic, rankFromQuestion, readQuestion, searchAsFilter,
  searchFromQuestion, wholeMonths, LIST_ROWS, newest,
  type AskQuery,
} from './nano-ask.ts';

const TODAY = '2026-10-20';

test("Nano's line is read, whatever surrounds it", () => {
  const q = parseAskAnswer('```json\n{"art":"summe","richtung":"aus","kategorie":null,"suche":"Amazon","zeitraum":"monat:2026-09"}\n```');
  assert.deepEqual(q, { dir: 'out', category: null, search: 'Amazon' });
  assert.equal(parseAskAnswer('Ich kann das nicht beantworten.'), null);
  assert.equal(parseAskAnswer('{"art": '), null);
  assert.equal(parseAskAnswer(null), null);
});

test("Nano's line cut off at the token limit is read field by field", () => {
  // What nano-v4-fast gave with the first prompt: fenced, pretty-printed, every value a field, cut at 80 tokens.
  const cut = '```json\n{\n  "art": "summe",\n  "anzahl": 0,\n  "groesste": null,\n  "richtung": "aus",\n  "ein": null,\n  "kategorie": "groceries",\n  "suche": null,\n  "zeit';
  assert.deepEqual(parseAskAnswer(cut), { dir: 'out', category: 'groceries', search: null });
});

test('Gemini Nano v4 or later asks; an older or unnamed model does not', () => {
  assert.equal(nanoGeneration('nano-v4-fast'), 4);
  assert.equal(asksWith('nano-v4-fast'), true);
  assert.equal(asksWith('NANO_V5'), true);
  assert.equal(asksWith('nano-v3-full'), false);
  assert.equal(asksWith('gemini-nano'), false);
  assert.equal(asksWith(undefined), false);
});

test('only known categories count; income always comes in', () => {
  assert.equal(parseAskAnswer('{"art":"summe","kategorie":"food"}')?.category, null);
  const income = readQuestion('Lohn', parseAskAnswer('{"art":"summe","richtung":"aus","kategorie":"income"}'), TODAY);
  assert.equal(income?.category, 'income');
  assert.equal(income?.dir, 'in');
  // The user's own category, by its id.
  assert.equal(parseAskAnswer('{"kategorie":"c_pet"}', [{ id: 'c_pet', name: 'Haustier' }])?.category, 'c_pet');
});

test('a search that is no name, or not in the question, is dropped', () => {
  const searchOf = (answer: string, question: string) => readQuestion(question, parseAskAnswer(answer), TODAY)?.search ?? null;
  assert.equal(parseAskAnswer('{"suche":"null"}')?.search, null);
  assert.equal(searchOf('{"suche":"Ausgaben"}', 'Ausgaben insgesamt'), null);
  assert.equal(searchOf('{"suche":"September"}', 'Was ging im September raus?'), null);
  assert.equal(searchOf('{"suche":"„Rewe“"}', 'Wie oft bei Rewe?'), 'Rewe');
  // A category word is no name ("Tank" for getankt, "Streaming").
  assert.equal(searchOf('{"suche":"Tank","kategorie":"mobility"}', 'Wie viel habe ich getankt?'), null);
  assert.equal(searchOf('{"suche":"Streaming","kategorie":"media"}', 'Was habe ich für Streaming bezahlt?'), null);
  // Nano made it up.
  assert.equal(searchOf('{"suche":"Edeka"}', 'Lebensmittel letzten Monat'), null);
});

// What nano-v4-fast answered on the S26 (2026-10-21), and what Girovo makes of it.
test("the question's own words win over Nano's reading", () => {
  const read = (question: string, answer: string) => readQuestion(question, parseAskAnswer(answer), TODAY);
  // "an Mama": out, and Mama is the name — Nano had it coming in, without a name.
  assert.deepEqual(read('Wie viel Geld ging an Mama?', '{"art":"summe","richtung":"ein","kategorie":null,"suche":null}'), {
    kind: 'sum', dir: 'out', category: null, search: 'Mama', period: { kind: 'all' }, hint: null,
  });
  // A name beats Nano's category, which is kept for when the name finds nothing.
  const amazon = read('Wie viel ging an Amazon?', '{"art":"summe","richtung":"ein","kategorie":"shopping","suche":"Amazon"}');
  assert.deepEqual([amazon?.dir, amazon?.category, amazon?.search, amazon?.hint], ['out', null, 'Amazon', 'shopping']);
  // "im Monat" is a monthly average over everything loaded, not this month's sum.
  const netflix = read('Was kostet mich Netflix im Monat?', '{"art":"summe","richtung":"aus","kategorie":"media","suche":"Netflix"}');
  assert.deepEqual([netflix?.kind, netflix?.period], ['average', { kind: 'all' }]);
  assert.equal(read('Wann war ich zuletzt bei dm?', '{"art":"summe","richtung":"aus","kategorie":"groceries","suche":"dm"}')?.kind, 'last');
  assert.equal(read('Wie viel Gehalt habe ich bekommen?', '{"art":"summe","richtung":"aus","kategorie":"income","suche":null}')?.dir, 'in');
  // Nano's kind and period are never taken: the question names neither.
  assert.deepEqual(read('Spotify', '{"art":"durchschnitt","richtung":"aus","kategorie":null,"suche":"Spotify"}')?.kind, 'sum');
  assert.equal(read('Wann habe ich Miete gezahlt?', '{"kategorie":"housing"}')?.kind, 'last');
  // A category the question names in its own words beats Nano's guess.
  assert.equal(read('Was kostet mich das Fitnessstudio?', '{"richtung":"aus","kategorie":"health","suche":null}')?.category, 'leisure');
  // Nano's period is never taken: the question names none.
  assert.deepEqual(read('Miete', '{"art":"summe","richtung":"aus","kategorie":"housing","suche":null,"zeitraum":"dieses_jahr"}')?.period, { kind: 'all' });
});

test('without a line from Nano, the rules answer what they can', () => {
  assert.deepEqual(readQuestion('Wie viel habe ich letzten Monat bei Rewe ausgegeben?', null, TODAY), {
    kind: 'sum', dir: 'out', category: null, search: 'Rewe', period: { kind: 'lastMonth' }, hint: null,
  });
  const fuel = readQuestion('Tanken pro Monat', null, TODAY);
  assert.deepEqual([fuel?.kind, fuel?.category], ['average', 'mobility']);
  assert.equal(readQuestion('Wie viel Rente kam?', null, TODAY)?.category, 'income');
  assert.equal(readQuestion('Taxi im August', null, TODAY)?.category, 'mobility');
  // The user's own category, by its name.
  assert.equal(readQuestion('Haustier dieses Jahr', null, TODAY, [{ id: 'c_pet', name: 'Haustier' }])?.category, 'c_pet');
  assert.equal(readQuestion('Hallo', null, TODAY), null);
});

test('a name after "an", "bei", "von", "für": as written, without what follows', () => {
  assert.equal(searchFromQuestion('Was ging an Amazon Prime?'), 'Amazon Prime');
  assert.equal(searchFromQuestion('Wieviel hab ich bei Rewe ausgegeben'), 'Rewe');
  assert.equal(searchFromQuestion('Was habe ich an mama gezahlt'), 'mama');
  assert.equal(searchFromQuestion('how much did I spend on uber'), 'uber');
  assert.equal(searchFromQuestion('Was habe ich für Lebensmittel bei Lidl ausgegeben?'), 'Lidl');
  assert.equal(searchFromQuestion('Was habe ich für Streaming bezahlt?'), null);
  assert.equal(searchFromQuestion('Was kam von Januar bis heute?'), null);
});

test('kind and direction by the question’s words', () => {
  assert.equal(kindFromQuestion('Wie oft war ich bei McDonalds?'), 'count');
  assert.equal(kindFromQuestion('Teuerste Buchung'), 'largest');
  assert.equal(kindFromQuestion('Versicherungen pro Monat'), 'average');
  assert.equal(kindFromQuestion('Lebensmittel letzten Monat'), null);
  assert.equal(dirFromQuestion('Überweisung von Lisa'), 'in');
  assert.equal(dirFromQuestion('Größte Überweisung an Lisa'), 'out');
  assert.equal(dirFromQuestion('Was habe ich ausgegeben und eingenommen?'), 'all');
  assert.equal(dirFromQuestion('Was habe ich zurückbekommen?'), 'in');
  assert.equal(dirFromQuestion('Lebensmittel'), null);
});

test('the period a question names plainly is read by rule', () => {
  assert.deepEqual(periodFromQuestion('Wie viel habe ich letzten Monat ausgegeben?', TODAY), { kind: 'lastMonth' });
  assert.deepEqual(periodFromQuestion('Was ging diesen Monat an Amazon?', TODAY), { kind: 'thisMonth' });
  assert.deepEqual(periodFromQuestion('Lebensmittel im September', TODAY), { kind: 'month', month: '2026-09' });
  // A month after this one is last year's.
  assert.deepEqual(periodFromQuestion('Tanken im Dezember', TODAY), { kind: 'month', month: '2025-12' });
  assert.deepEqual(periodFromQuestion('Restaurants im März 2025', TODAY), { kind: 'month', month: '2025-03' });
  assert.deepEqual(periodFromQuestion('Amazon aug 2026', TODAY), { kind: 'month', month: '2026-08' });
  assert.deepEqual(periodFromQuestion('Alles von 2025', TODAY), { kind: 'year', year: 2025 });
  assert.deepEqual(periodFromQuestion('Ausgaben der letzten 30 Tage', TODAY), { kind: 'days', days: 30 });
  assert.deepEqual(periodFromQuestion('How much did I spend last month?', TODAY), { kind: 'lastMonth' });
  // "Jan" may be a person: only a whole month name counts on its own.
  assert.equal(periodFromQuestion('Wie viel habe ich Jan überwiesen?', TODAY), null);
  assert.equal(periodFromQuestion('Wie oft war ich bei Rewe?', TODAY), null);
  assert.deepEqual(periodFromQuestion('Was habe ich heute ausgegeben?', TODAY), { kind: 'today' });
  assert.deepEqual(periodFromQuestion('Lebensmittel seit Juli', TODAY), { kind: 'since', month: '2026-07' });
  assert.deepEqual(periodFromQuestion('Tanken in den letzten drei Monaten', TODAY), { kind: 'months', months: 3 });
  assert.deepEqual(periodFromQuestion('Ausgaben der letzten 2 Wochen', TODAY), { kind: 'days', days: 14 });
  assert.deepEqual(periodFromQuestion('Amazon im letzten halben Jahr', TODAY), { kind: 'months', months: 6 });
  // A year still to come is none.
  assert.equal(periodFromQuestion('Urlaub 2027', TODAY), null);
});

test('a period spans whole days, never past today', () => {
  assert.deepEqual(periodDays({ kind: 'lastMonth' }, TODAY), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(periodDays({ kind: 'lastMonth' }, '2026-01-15'), { from: '2025-12-01', to: '2025-12-31' });
  assert.deepEqual(periodDays({ kind: 'thisMonth' }, TODAY), { from: '2026-10-01', to: TODAY });
  assert.deepEqual(periodDays({ kind: 'month', month: '2026-02' }, TODAY), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(periodDays({ kind: 'year', year: 2026 }, TODAY), { from: '2026-01-01', to: TODAY });
  assert.deepEqual(periodDays({ kind: 'days', days: 7 }, TODAY), { from: '2026-10-14', to: TODAY });
  assert.deepEqual(periodDays({ kind: 'today' }, TODAY), { from: TODAY, to: TODAY });
  assert.deepEqual(periodDays({ kind: 'since', month: '2026-07' }, TODAY), { from: '2026-07-01', to: TODAY });
  assert.deepEqual(periodDays({ kind: 'months', months: 3 }, TODAY), { from: '2026-07-21', to: TODAY });
  assert.deepEqual(periodDays({ kind: 'months', months: 1 }, '2026-03-31'), { from: '2026-03-01', to: '2026-03-31' });
  assert.equal(periodDays({ kind: 'all' }, TODAY), null);
});

test('whole months: only those wholly inside and over', () => {
  assert.equal(wholeMonths('2026-07-22', '2026-10-20', TODAY), 2); // August, September
  assert.equal(wholeMonths('2026-08-01', '2026-09-30', TODAY), 2);
  assert.equal(wholeMonths('2026-10-01', '2026-10-20', TODAY), 0);
});

// ---- the answer -------------------------------------------------------------

function tx(day: string, amount: number, remoteName: string, purpose = ''): SerializedTransaction {
  return {
    valueDate: day, entryDate: day, amount, currency: 'EUR', purpose, bookingText: amount < 0 ? 'Lastschrift' : 'Gutschrift',
    remoteName, remoteIban: '', remoteBic: '', e2eReference: '', mandateReference: '', customerReference: '', bankReference: '',
  } as SerializedTransaction;
}

const BOOKINGS = [
  tx('2026-08-03', -30, 'AMAZON EU S.A R.L.'),
  tx('2026-09-02', -12.5, 'WWW.Amazon.'),
  tx('2026-09-15', -40, 'AMAZON EU S.A R.L.'),
  tx('2026-09-20', -55.2, 'REWE Markt GmbH'),
  tx('2026-09-25', -500, 'Eigenes Sparkonto'),
  tx('2026-09-28', 100, 'Nadine Becker', 'Danke'),
  tx('2026-10-05', -80, 'Split Laden', 'Lebensmittel und Geschenk'),
];

const categoryOf = (t: SerializedTransaction): CategoryResult => {
  if (t.remoteName.startsWith('REWE')) return { id: 'groceries' } as CategoryResult;
  if (t.remoteName === 'Eigenes Sparkonto') return { id: 'transfer' } as CategoryResult;
  if (t.remoteName === 'Split Laden') {
    return { id: 'groceries', parts: [{ id: 'groceries', amount: -50 }, { id: 'shopping', amount: -30 }] } as unknown as CategoryResult;
  }
  return { id: t.amount > 0 ? 'otherIn' : 'shopping' } as CategoryResult;
};
const CTX = { categoryOf };
const LOADED = { from: '2026-07-22', to: TODAY };
const ask = (q: Partial<AskQuery>) =>
  computeAnswer({ kind: 'sum', dir: 'out', category: null, search: null, period: { kind: 'all' }, ...q }, BOOKINGS, CTX, LOADED, TODAY);

test('a sum over a name and a month: the same bookings the list shows', () => {
  const a = ask({ search: 'Amazon', period: { kind: 'month', month: '2026-09' } });
  assert.equal(a.count, 2);
  assert.equal(a.cents, 5250);
  assert.deepEqual([a.filter.from, a.filter.to, a.filter.query, a.filter.dir], ['2026-09-01', '2026-09-30', 'Amazon', 'out']);
  assert.equal(a.partial, false);
});

test('Umbuchungen count only when the question names a category or a name', () => {
  assert.equal(ask({ period: { kind: 'month', month: '2026-09' } }).cents, 1250 + 4000 + 5520);
  assert.equal(ask({ search: 'Sparkonto' }).cents, 50000);
});

test("a split booking counts with its share in the category asked about", () => {
  assert.equal(ask({ category: 'groceries' }).cents, 5520 + 5000);
  assert.equal(ask({ category: 'shopping', period: { kind: 'thisMonth' } }).cents, 3000);
});

test('in, largest, last, and a period before the loaded days', () => {
  assert.equal(ask({ dir: 'in', search: 'Nadine' }).cents, 10000);
  assert.equal(ask({ kind: 'largest', search: 'Amazon' }).tx?.amount, -40);
  assert.equal(ask({ kind: 'last', search: 'Amazon' }).tx?.entryDate, '2026-09-15');
  const early = ask({ period: { kind: 'thisYear' } });
  assert.equal(early.partial, true);
  assert.equal(early.from, LOADED.from);
  const before = ask({ period: { kind: 'month', month: '2026-03' } });
  assert.equal(before.outside, true);
  assert.equal(before.count, 0);
});

test('a name that finds nothing falls back to the category Nano read', () => {
  const a = ask({ search: 'Supermarkt', hint: 'groceries' });
  assert.equal(a.query.category, 'groceries');
  assert.equal(a.query.search, null);
  assert.equal(a.cents, 5520 + 5000);
  // A name that finds something keeps it.
  assert.equal(ask({ search: 'Amazon', hint: 'groceries' }).query.search, 'Amazon');
});

test('the prompt carries the question and the own categories', () => {
  const text = askText('  Wie viel?  ', [{ id: 'c_pet', name: 'Haustier' }]);
  assert.match(text, /\nFrage: Wie viel\?\n$/);
  assert.match(text, /Eigene Kategorien: c_pet \(Haustier\)/);
});

// ---- rankings and comparisons (5.9.0) -------------------------------------------

test('a ranking: of categories or payees, by money or by how often', () => {
  assert.deepEqual(rankFromQuestion('Wofür gebe ich am meisten aus?'), { by: 'category', metric: 'sum' });
  assert.deepEqual(rankFromQuestion('Wo kaufe ich am häufigsten ein?'), { by: 'payee', metric: 'count' });
  assert.deepEqual(rankFromQuestion('Bei wem gebe ich am meisten aus?'), { by: 'payee', metric: 'sum' });
  assert.deepEqual(rankFromQuestion('Top 5 Ausgaben dieses Jahr'), { by: 'category', metric: 'sum' });
  assert.equal(rankFromQuestion('Was war meine größte Ausgabe?'), null, 'one booking, not a ranking');
  // A ranking within a category: the payees of "Essen & Trinken".
  // Nano read "einkaufen" as Lebensmittel (S26, 2026-10-22): a ranking takes only a category the question names.
  const shops = readQuestion('Wo kaufe ich am häufigsten ein?', parseAskAnswer('{"richtung":"aus","kategorie":"groceries","suche":null}'), TODAY);
  assert.deepEqual([shops?.kind, shops?.category], ['rank', null]);
  const q = readQuestion('Welche Restaurants am häufigsten?', null, TODAY);
  assert.deepEqual([q?.kind, q?.category, q?.rank], ['rank', 'dining', { by: 'payee', metric: 'count' }]);
});

test('a comparison: two periods, the running one against the one it names', () => {
  assert.deepEqual(compareFromQuestion('Mehr als letzten Monat?', TODAY), { period: { kind: 'thisMonth' }, against: { kind: 'lastMonth' } });
  assert.deepEqual(compareFromQuestion('Tanken diesen vs. letzten Monat', TODAY), { period: { kind: 'thisMonth' }, against: { kind: 'lastMonth' } });
  assert.deepEqual(compareFromQuestion('Lebensmittel im September im Vergleich zum August', TODAY), {
    period: { kind: 'month', month: '2026-09' }, against: { kind: 'month', month: '2026-08' },
  });
  assert.deepEqual(compareFromQuestion('Gebe ich dieses Jahr mehr für Essen gehen aus als letztes Jahr?', TODAY), {
    period: { kind: 'thisYear' }, against: { kind: 'lastYear' },
  });
  assert.equal(compareFromQuestion('Mehr als 100 Euro bei Rewe?', TODAY), null, 'an amount is no period');
  assert.deepEqual(periodsFromQuestion('Amazon im August 2026 und September', TODAY), [
    { kind: 'month', month: '2026-08' }, { kind: 'month', month: '2026-09' },
  ]);
});

test('a ranking counts the same bookings as the sum, split shares in their categories', () => {
  const byCategory = ask({ kind: 'rank', rank: { by: 'category', metric: 'sum' } });
  assert.deepEqual(byCategory.rank?.map((r) => [r.category, r.cents]), [['shopping', 3000 + 1250 + 4000 + 3000], ['groceries', 5520 + 5000]]);
  assert.equal(byCategory.rank?.[0].filter.category, 'shopping');
  const byPayee = ask({ kind: 'rank', rank: { by: 'payee', metric: 'count' } });
  assert.equal(byPayee.rank?.[0].count, 2);
  assert.equal(byPayee.rank?.[0].filter.query, byPayee.rank?.[0].name);
});

test('a comparison sets the running month against as many days of the last', () => {
  const a = ask({ kind: 'compare', period: { kind: 'thisMonth' }, against: { kind: 'lastMonth' } });
  assert.equal(a.compare?.a.cents, 8000);
  assert.deepEqual([a.compare?.b.from, a.compare?.b.to], ['2026-09-01', '2026-09-20']);
  assert.equal(a.compare?.b.cents, 1250 + 4000 + 5520);
  // Two whole months stay whole.
  const months = ask({ kind: 'compare', period: { kind: 'month', month: '2026-09' }, against: { kind: 'month', month: '2026-08' } });
  assert.deepEqual([months.compare?.b.from, months.compare?.b.to], ['2026-08-01', '2026-08-31']);
});

test('a search in the Umsätze list says what it means; a plain one stays text', () => {
  assert.deepEqual(searchAsFilter('Tanken im August', TODAY), { query: '', category: 'mobility', from: '2026-08-01', to: '2026-08-31' });
  assert.deepEqual(searchAsFilter('Amazon letzten Monat', TODAY), { query: 'Amazon', from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(searchAsFilter('Restaurants im August', TODAY), { query: '', category: 'dining', from: '2026-08-01', to: '2026-08-31' });
  assert.deepEqual(searchAsFilter('Eingänge September', TODAY), { query: '', dir: 'in', from: '2026-09-01', to: '2026-09-30' });
  // Only what it names: no period, so a month picked before stays.
  assert.deepEqual(searchAsFilter('Ausgaben bei Rewe', TODAY), { query: 'Rewe', dir: 'out' });
  assert.equal(searchAsFilter('Rewe', TODAY), null);
  assert.equal(searchAsFilter('4711', TODAY), null);
  assert.deepEqual(searchAsFilter('Futter für Haustier', TODAY, [{ id: 'c_pet', name: 'Haustier' }]), { query: 'Futter', category: 'c_pet' });
});

test('desktop: what a question is about, for the category model', () => {
  assert.equal(questionTopic('Wie viel habe ich letzten Monat für Essen gehen ausgegeben?'), 'Essen gehen');
  assert.equal(questionTopic('Was gebe ich für Klamotten aus?'), 'Klamotten');
  assert.equal(questionTopic('Wie oft war ich tanken?'), 'tanken');
  assert.equal(questionTopic('How much did I spend on clothes last month?'), 'clothes');
  assert.equal(questionTopic('Wo kaufe ich am häufigsten ein?'), '');
  assert.equal(questionTopic('Ausgaben im August 2026'), '');
});

test('desktop: a name the question asks about, found among the payees in view', () => {
  const payees = ['REWE Markt GmbH', 'NETFLIX.COM', 'Amazon EU S.a r.l.', 'Mama', 'Deutsche Bahn', 'H&M Hennes & Mauritz'];
  assert.equal(nameFromPayees('Wie viel kostet mich Netflix im Jahr?', payees), 'Netflix');
  assert.equal(nameFromPayees('Was habe ich bei Rewe gelassen?', payees), 'Rewe');
  assert.equal(nameFromPayees('Was zahle ich an Mama?', payees), 'Mama');
  assert.equal(nameFromPayees('Wie viel für die Deutsche Bahn?', payees), 'Deutsche Bahn');
  assert.equal(nameFromPayees('Was gebe ich für Klamotten aus?', payees), null, 'no payee by that name');
  assert.equal(nameFromPayees('Wie viel im Jahr?', payees), null);
  assert.equal(nameFromPayees('Was kostet Ama?', payees), null, 'three letters only for a whole word');
  // Read as on the phone: the name beats a category, and the rules keep the rest.
  const read = readQuestion('Wie viel ging letzten Monat an Netflix?', { dir: null, category: null, search: nameFromPayees('Wie viel ging letzten Monat an Netflix?', payees) }, TODAY);
  assert.equal(read?.search, 'Netflix');
  assert.equal(read?.period.kind, 'lastMonth');
});

// ---- a per-month average: the whole months' own bookings, in one currency --------

test('a per-month average sums only the whole months it divides by', () => {
  // 100 EUR at REWE every Monday from 10.08. to 09.11.2026, loaded 10.08.–10.11.
  const mondays: SerializedTransaction[] = [];
  for (let d = new Date(2026, 7, 10); d <= new Date(2026, 10, 9); d.setDate(d.getDate() + 7)) {
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    mondays.push(tx(day, -100, 'REWE Markt GmbH'));
  }
  assert.equal(mondays.length, 14);
  const q = readQuestion('Was gebe ich pro Monat für Lebensmittel aus?', null, '2026-11-10')!;
  assert.deepEqual([q.kind, q.category], ['average', 'groceries']);
  const a = computeAnswer(q, mondays, CTX, { from: '2026-08-10', to: '2026-11-10' }, '2026-11-10');
  assert.equal(a.months, 2); // September, October
  assert.equal(a.monthCents, 80000, 'four Mondays each: 400 € a month, not 1400 € / 2');
  assert.equal(a.cents, 140000, 'the loaded period as a whole stays the plain sum');
  assert.equal(a.monthCents / a.months, 40000);
  // "Umsätze zeigen" opens the bookings the average counts.
  assert.deepEqual([a.filter.from, a.filter.to], ['2026-09-01', '2026-10-31']);
  // No whole month loaded: nothing to divide, the sum of what is there.
  const short = computeAnswer(q, mondays, CTX, { from: '2026-10-05', to: '2026-11-10' }, '2026-11-10');
  assert.deepEqual([short.months, short.monthCents, short.cents], [0, 0, 60000]);
  assert.deepEqual([short.filter.from, short.filter.to], ['2026-10-05', '2026-11-10']);
  // In and out apart, each over the whole months.
  const both = computeAnswer({ ...q, dir: 'all', category: null }, [...mondays, tx('2026-08-20', 900, 'Nadine Becker'), tx('2026-09-20', 50, 'Nadine Becker')], CTX, { from: '2026-08-10', to: '2026-11-10' }, '2026-11-10');
  assert.equal(both.monthCents, 80000 + 5000);
});

test('a booking in another currency is set aside, as in the Analyse', () => {
  const usd = { ...tx('2026-09-21', -900, 'REWE Markt GmbH'), currency: 'USD' };
  const a = computeAnswer(
    { kind: 'sum', dir: 'out', category: 'groceries', search: null, period: { kind: 'all' } }, [...BOOKINGS, usd], CTX, LOADED, TODAY,
  );
  assert.equal(a.cents, 5520 + 5000);
  assert.equal(a.count, 2);
  assert.equal(a.otherCurrency, 1);
  assert.equal(ask({ category: 'groceries' }).otherCurrency, 0);
  // The currency the Analyse sums is the one counted: a dollar account's own bookings.
  const dollars = computeAnswer(
    { kind: 'sum', dir: 'out', category: 'groceries', search: null, period: { kind: 'all' } }, [...BOOKINGS, usd], { ...CTX, currency: 'USD' }, LOADED, TODAY,
  );
  assert.deepEqual([dollars.cents, dollars.count, dollars.otherCurrency], [90000, 1, 2]);
  // Largest and last look at the counted bookings only.
  const largest = computeAnswer(
    { kind: 'largest', dir: 'out', category: 'groceries', search: null, period: { kind: 'all' } }, [...BOOKINGS, usd], CTX, LOADED, TODAY,
  );
  assert.equal(largest.tx?.amount, -55.2);
});

test('the answer names the currency it sums, and how many matching bookings it set aside', () => {
  // A payee paid in dollars from a euro account: nothing to sum, two bookings to mention.
  const usd = (day: string) => ({ ...tx(day, -20, 'OpenAI LLC'), currency: 'USD' });
  const q: AskQuery = { kind: 'sum', dir: 'out', category: null, search: 'OpenAI', period: { kind: 'all' } };
  const a = computeAnswer(q, [...BOOKINGS, usd('2026-09-03'), usd('2026-10-03')], { ...CTX, currency: 'EUR' }, LOADED, TODAY);
  assert.deepEqual([a.count, a.cents, a.otherCurrency, a.currency], [0, 0, 2, 'EUR']);
  // A dollar account: its own currency is the one the figures are in.
  const d = computeAnswer(q, [usd('2026-09-03'), usd('2026-10-03')], { ...CTX, currency: 'USD' }, LOADED, TODAY);
  assert.deepEqual([d.count, d.cents, d.otherCurrency, d.currency], [2, 4000, 0, 'USD']);
  // Both sides of a comparison say theirs.
  const c = computeAnswer({ ...q, kind: 'compare', period: { kind: 'thisMonth' }, against: { kind: 'lastMonth' } }, [...BOOKINGS, usd('2026-09-03'), usd('2026-10-03')], CTX, LOADED, TODAY);
  assert.deepEqual([c.currency, c.compare?.a.otherCurrency, c.compare?.b.otherCurrency], ['EUR', 1, 1]);
});

test('a list: "zeig", "liste", "alle … an, von, bei" and "show me all" ask for the bookings themselves', () => {
  assert.equal(kindFromQuestion('Zeig alle Zahlungen an Amazon'), 'list');
  assert.equal(kindFromQuestion('Liste Netflix'), 'list');
  assert.equal(kindFromQuestion('show me all payments to Amazon'), 'list');
  assert.equal(kindFromQuestion('alle Umsätze bei Rewe'), 'list');
  // A total, one booking, how often: not a list, whatever "zeig" says.
  assert.equal(kindFromQuestion('Zeig mir, wie viel ich bei Rewe ausgegeben habe'), null);
  assert.equal(kindFromQuestion('Zeig mir die größte Ausgabe'), 'largest');
  assert.equal(kindFromQuestion('Zeig mir, wie oft ich bei Rewe war'), 'count');
  assert.equal(kindFromQuestion('Rangliste der Händler'), null);
  const lea = readQuestion('Zeig mir die Buchungen von Lea im Oktober', null, TODAY);
  assert.deepEqual([lea?.kind, lea?.search, lea?.dir, lea?.period], ['list', 'Lea', 'all', { kind: 'month', month: '2026-10' }]);
  const rewe = readQuestion('alle Umsätze bei Rewe', null, TODAY);
  assert.deepEqual([rewe?.kind, rewe?.search, rewe?.dir], ['list', 'Rewe', 'out']);
  const spent = readQuestion('Zeig mir alle Ausgaben im September', null, TODAY);
  assert.deepEqual([spent?.kind, spent?.dir, spent?.search], ['list', 'out', null]);
  const income = readQuestion('Zeig mir mein Gehalt', null, TODAY);
  assert.deepEqual([income?.kind, income?.dir, income?.category], ['list', 'in', 'income']);
});

test('a list answer: the bookings counted, the newest LIST_ROWS of them first', () => {
  const amazon = ask({ kind: 'list', dir: 'all', search: 'Amazon' });
  assert.equal(amazon.count, 3);
  assert.deepEqual(amazon.latest?.map((t) => t.entryDate), ['2026-09-15', '2026-09-02', '2026-08-03']);
  // Every booking but the Umbuchung, five of six shown.
  const all = ask({ kind: 'list', dir: 'all' });
  assert.equal(all.count, 6);
  assert.equal(LIST_ROWS, 5);
  assert.deepEqual(all.latest?.map((t) => t.entryDate), ['2026-10-05', '2026-09-28', '2026-09-20', '2026-09-15', '2026-09-02']);
  assert.equal(ask({ kind: 'sum' }).latest, undefined);
  // Of one day, in the order they came.
  const same = [tx('2026-09-01', -1, 'A'), tx('2026-09-02', -2, 'B'), tx('2026-09-02', -3, 'C')];
  assert.deepEqual(newest(same, 2).map((t) => t.remoteName), ['B', 'C']);
});

test('a ranking holds every payee, not only the first few', () => {
  const many = Array.from({ length: 12 }, (_, i) => tx(`2026-09-${String(i + 1).padStart(2, '0')}`, -(i + 1), `Laden ${i + 1}`));
  const a = computeAnswer({ kind: 'rank', rank: { by: 'payee', metric: 'sum' }, dir: 'out', category: null, search: null, period: { kind: 'all' } }, many, CTX, LOADED, TODAY);
  assert.equal(a.rank?.length, 12);
  assert.deepEqual([a.rank?.[0].name, a.rank?.[11].name], ['Laden 12', 'Laden 1']);
});
