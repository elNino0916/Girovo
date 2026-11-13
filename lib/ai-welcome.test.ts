import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthName, topPayee, welcomeQuestions, type WelcomeBooking } from './ai-welcome.ts';
import { readAsked } from './ask-read.ts';

const today = '2026-11-13';
const b = (day: string, amount: number, payee: string, category = 'groceries'): WelcomeBooking => ({ day, amount, payee, category });

const full: WelcomeBooking[] = [
  b('2026-10-02', -54.2, 'Rewe'),
  b('2026-10-09', -31.8, 'Rewe'),
  b('2026-10-20', -12.4, 'Rewe'),
  b('2026-10-01', -950, 'Hausverwaltung Kurz', 'housing'),
  b('2026-10-15', -5.58, 'Backwerk', 'dining'),
  b('2026-10-05', -200, 'Tagesgeld', 'transfer'),
  b('2026-10-05', -200, 'Tagesgeld', 'transfer'),
  b('2026-10-05', -200, 'Tagesgeld', 'transfer'),
  b('2026-10-30', 2400, 'Arbeitgeber GmbH', 'income'),
];

test('with bookings, contracts and a day to cancel by: the three questions of the mock', () => {
  assert.deepEqual(welcomeQuestions({ bookings: full, today, contracts: 3, cancelDate: true }), [
    'Wie viel ging im Oktober an Rewe?',
    'Was kann ich bis Ende des Monats kündigen?',
    'Wo war ich im Oktober essen?',
  ]);
});

test('contracts without a day to cancel by ask which there are', () => {
  assert.equal(welcomeQuestions({ bookings: full, today, contracts: 2, cancelDate: false })[1], 'Welche Abos habe ich?');
});

test('no contracts and no Essen & Trinken: the fallbacks fill up to three', () => {
  const bookings = full.filter((x) => x.category !== 'dining');
  assert.deepEqual(welcomeQuestions({ bookings, today, contracts: 0, cancelDate: false }), [
    'Wie viel ging im Oktober an Rewe?',
    'Größte Ausgabe dieses Jahr',
    'Lebensmittel letzten Monat',
  ]);
});

test('no bookings at all: always exactly three, none twice', () => {
  const out = welcomeQuestions({ bookings: [], today, contracts: 0, cancelDate: false });
  assert.equal(out.length, 3);
  assert.equal(new Set(out).size, 3);
  assert.equal(out[0], 'Größte Ausgabe dieses Jahr');
});

test('the top payee is the one paid most often; transfers, savings and income never count', () => {
  assert.equal(topPayee(full, '2026-10'), 'Rewe');
  assert.equal(topPayee([b('2026-10-01', -500, 'Depot', 'savings'), b('2026-10-02', 100, 'Lea', 'otherIn')], '2026-10'), null);
});

test('on a tie, the payee paid more; a name too long or without letters is left out', () => {
  assert.equal(topPayee([b('2026-10-01', -10, 'Aldi'), b('2026-10-02', -40, 'Edeka')], '2026-10'), 'Edeka');
  assert.equal(topPayee([b('2026-10-01', -10, 'PAYPAL EUROPE S.A.R.L. ET CIE S.C.A'), b('2026-10-02', -5, '4711')], '2026-10'), null);
});

test('with nothing last month yet, this month is asked about', () => {
  const out = welcomeQuestions({ bookings: [b('2026-11-03', -20, 'Lidl'), b('2026-11-04', -8, 'Pizzeria Roma', 'dining')], today, contracts: 0, cancelDate: false });
  assert.deepEqual(out.slice(0, 2), ['Wie viel ging im November an Lidl?', 'Wo war ich im November essen?']);
});

test('Essen & Trinken only long ago asks about the newest month with it', () => {
  const out = welcomeQuestions({ bookings: [b('2026-06-12', -30, 'Trattoria', 'dining')], today, contracts: 0, cancelDate: false });
  assert.equal(out[0], 'Wo war ich im Juni essen?');
});

test('January asks about December', () => {
  assert.equal(welcomeQuestions({ bookings: [b('2026-12-20', -15, 'dm')], today: '2027-01-04', contracts: 0, cancelDate: false })[0], 'Wie viel ging im Dezember an dm?');
  assert.equal(monthName('2026-12'), 'Dezember');
});

test('every question is one the rules read: a sum, a ranking, a contracts question', () => {
  for (const question of welcomeQuestions({ bookings: full, today, contracts: 3, cancelDate: true })
    .concat(welcomeQuestions({ bookings: [], today, contracts: 1, cancelDate: false }))) {
    const read = readAsked(question, null, { today, own: [], reading: null, contracts: [] });
    assert.ok('query' in read || 'intent' in read, `${question}: ${JSON.stringify(read)}`);
  }
});

test('a bank\'s raw line is no name for a question; the next payee or a fallback takes its place', () => {
  const b = (payee: string) => ({ day: '2026-10-05', amount: -20, payee, category: 'groceries' });
  const qs = welcomeQuestions({ bookings: [b('DM-DROGERIE MARKT SAGT DANKE'), b('DM-DROGERIE MARKT SAGT DANKE'), b('Rewe')], today: '2026-11-14', contracts: 0, cancelDate: false });
  assert.ok(qs.some((q) => q.includes('an Rewe')), qs.join(' | '));
  assert.ok(!qs.some((q) => q.includes('SAGT DANKE')));
});
