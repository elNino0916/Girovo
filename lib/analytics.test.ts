import './__fixtures__/tz.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SerializedTransaction } from './fints-types';
import type { TxFilter } from './app-types';
import { categorize } from './categorize.ts';
import type { CategoryOf } from './analytics.ts';
import {
  calendarMonths, daysLabel, facilitatorShop, filterTransactions, inFilterDays, largest, monthOfWord, monthlyBuckets,
  periodTotals, searchReport, topCounterparties, txMatcher,
} from './analytics.ts';
import { CRED, IBAN, OWN_IBANS, OWN_SAVINGS, camt, mt940, newestFirst } from './__fixtures__/transactions.ts';
import { parseCardAcceptor } from './card-purpose.ts';

const categoryOf = (tx: SerializedTransaction) => categorize(tx, { ownIbans: OWN_IBANS });
const sum = (xs: { amount: number }[]) => Math.round(xs.reduce((s, x) => s + x.amount * 100, 0)) / 100;

// One account, July to early October 2026, in both wire shapes.
const salary = (day: string, amount = 2650) =>
  mt940({ day, amount, gvc: '153', text: 'LOHN/GEHALT', name: 'ACME GmbH', iban: IBAN.employer, purpose: `Gehalt ${day.slice(5, 7)}/2026` });
const rent = (day: string) =>
  mt940({ day, amount: -850, gvc: '117', text: 'DAUERAUFTRAG', name: 'Hausverwaltung Kramer', iban: IBAN.landlord, purpose: 'Miete Whg 3' });
const netflix = (day: string) =>
  camt({ day, amount: -12.99, code: 'ESDD', text: 'SEPA-Basislastschrift', name: 'Netflix International B.V.', iban: IBAN.netflix, purpose: `CRED+${CRED.netflix} Netflix Monatsabo`, mref: 'NF-778' });
const rewe = (day: string, amount: number) =>
  mt940({ day, amount, gvc: '106', text: 'KARTENZAHLUNG', name: `REWE SAGT DANKE ${4651 + Math.round(-amount)}//BERLIN/DE` });
const toSavings = (day: string) =>
  mt940({ day, amount: -300, gvc: '116', text: 'UEBERWEISUNG', name: 'Nino Muster', iban: OWN_SAVINGS, purpose: 'Sparen' });

const DATA: SerializedTransaction[] = newestFirst([
  salary('2026-07-31'), salary('2026-08-31'), salary('2026-09-30', 2700),
  rent('2026-07-01'), rent('2026-08-03'), rent('2026-09-01'), rent('2026-10-01'),
  netflix('2026-07-15'), netflix('2026-08-15'), netflix('2026-09-15'),
  rewe('2026-07-04', -54.3), rewe('2026-07-18', -61.15), rewe('2026-08-08', -48.9), rewe('2026-09-05', -72.4), rewe('2026-09-26', -33.05),
  toSavings('2026-08-01'), toSavings('2026-09-01'),
  // A refund from a shop, and a bigger purchase there.
  camt({ day: '2026-09-10', amount: -129.99, code: 'POSD', text: 'Kartenzahlung', name: 'IKEA Deutschland GmbH' }),
  camt({ day: '2026-09-20', amount: 29.99, code: 'POSD', text: 'Gutschrift Kartenzahlung', name: 'IKEA Deutschland GmbH' }),
  // Bank fees and interest: a "both" category, split by sign.
  mt940({ day: '2026-09-30', amount: -7.95, gvc: '805', text: 'ABSCHLUSS' }),
  mt940({ day: '2026-09-30', amount: 0.12, gvc: '805', text: 'ABSCHLUSS' }),
  mt940({ day: '2026-08-12', amount: -200, gvc: '083', text: 'BARGELDAUSZAHLUNG', name: 'GA NR00001234' }),
  mt940({ day: '2026-09-12', amount: 25, gvc: '166', text: 'GUTSCHRIFT', name: 'Max Mustermann', iban: IBAN.person, purpose: 'Pizza Freitag' }),
]);

test('periodTotals: income, expense and net reconcile, Umbuchungen stay out', () => {
  const t = periodTotals(DATA, { categoryOf, from: '2026-09-01', to: '2026-09-30' });
  // September: salary 2700, rent 850, Netflix 12.99, REWE 105.45, IKEA 129.99 − 29.99,
  // fees 7.95, interest 0.12, Max 25; the 300 to the own savings account is not counted.
  assert.equal(t.income, 2725.12);
  assert.equal(t.expense, 1076.39);
  assert.equal(t.net, Math.round((t.income - t.expense) * 100) / 100);
  assert.equal(t.excluded, 1);
  assert.equal(t.count, 10);
  assert.equal(t.currency, 'EUR');
  assert.equal(sum(t.byCategory), t.expense);
  assert.equal(sum(t.incomeByCategory), t.income);
  assert.deepEqual(t.byCategory.map((c) => c.id), ['housing', 'groceries', 'shopping', 'media', 'fees']);
  assert.deepEqual(t.byCategory.find((c) => c.id === 'shopping'), { id: 'shopping', amount: 100, count: 2 }, 'the refund nets inside its category');
  assert.deepEqual(t.byCategory.find((c) => c.id === 'fees'), { id: 'fees', amount: 7.95, count: 1 });
  assert.deepEqual(t.incomeByCategory.map((c) => c.id), ['income', 'otherIn', 'fees']);
  // Net equals the sum of every counted booking — i.e. what the balance did, minus Umbuchungen.
  const raw = DATA.filter((tx) => tx.entryDate >= '2026-08-31T22' && tx.entryDate < '2026-09-30T22' && tx.remoteIban !== OWN_SAVINGS);
  assert.equal(t.net, Math.round(raw.reduce((s, tx) => s + tx.amount * 100, 0)) / 100);
});

test('periodTotals: a category whose refunds outweigh its spending moves to income', () => {
  const t = periodTotals(DATA, { categoryOf, from: '2026-09-15', to: '2026-09-30' });
  assert.ok(!t.byCategory.some((c) => c.id === 'shopping'));
  assert.deepEqual(t.incomeByCategory.find((c) => c.id === 'shopping'), { id: 'shopping', amount: 29.99, count: 1 });
  assert.ok(t.byCategory.every((c) => c.amount > 0));
});

test('periodTotals buckets by the local Buchungstag', () => {
  // Rent on 1 October arrives as "2026-09-30T22:00:00.000Z"; it belongs to October.
  assert.equal(rent('2026-10-01').entryDate, '2026-09-30T22:00:00.000Z');
  const sept = periodTotals(DATA, { categoryOf, from: '2026-09-01', to: '2026-09-30' });
  const oct = periodTotals(DATA, { categoryOf, from: '2026-10-01', to: '2026-10-31' });
  assert.equal(oct.expense, 850);
  assert.equal(oct.count, 1);
  assert.ok(!sept.byCategory.some((c) => c.id === 'housing' && c.amount > 850));
  // Range ends are inclusive.
  assert.equal(periodTotals(DATA, { categoryOf, from: '2026-10-01', to: '2026-10-01' }).count, 1);
});

test('periodTotals never adds currencies', () => {
  const mixed = [...DATA, camt({ day: '2026-09-15', amount: -100, currency: 'USD', code: 'POSD', name: 'Amazon.com' })];
  const eur = periodTotals(mixed, { categoryOf, from: '2026-09-01', to: '2026-09-30', currency: 'EUR' });
  assert.equal(eur.otherCurrency, 1);
  assert.equal(eur.expense, periodTotals(DATA, { categoryOf, from: '2026-09-01', to: '2026-09-30' }).expense);
  const usd = periodTotals(mixed, { categoryOf, currency: 'USD' });
  assert.equal(usd.expense, 100);
  assert.equal(usd.count, 1);
});

test('periodTotals of nothing is zero, not NaN', () => {
  const t = periodTotals([], { categoryOf });
  assert.deepEqual(
    { income: t.income, expense: t.expense, net: t.net, count: t.count, byCategory: t.byCategory, excluded: t.excluded },
    { income: 0, expense: 0, net: 0, count: 0, byCategory: [], excluded: 0 },
  );
});

test('monthlyBuckets: one per month, partial months marked', () => {
  const months = monthlyBuckets(DATA, { categoryOf, from: '2026-07-05', to: '2026-10-03', today: new Date(2026, 9, 3, 12) });
  assert.deepEqual(months.map((m) => m.month), ['2026-07', '2026-08', '2026-09', '2026-10']);
  assert.deepEqual(months.map((m) => m.complete), [false, true, true, false]);
  assert.deepEqual(months.map((m) => m.label), ['Jul', 'Aug', 'Sep', 'Okt']);
  assert.equal(months[3].title, 'Oktober 2026');
  assert.deepEqual([months[0].from, months[0].to], ['2026-07-05', '2026-07-31']);
  assert.deepEqual([months[3].from, months[3].to], ['2026-10-01', '2026-10-03']);
  // The rent of 1 July and the REWE shop of 4 July lie before the range.
  assert.equal(months[0].expense, 74.14);
  assert.equal(months[0].income, 2650);
  const aug = months[1];
  assert.equal(aug.income, 2650);
  assert.equal(aug.expense, 1111.89);
  assert.equal(aug.net, Math.round((aug.income - aug.expense) * 100) / 100);
  const sept = periodTotals(DATA, { categoryOf, from: '2026-09-01', to: '2026-09-30' });
  assert.equal(months[2].expense, sept.expense);
  assert.equal(months[2].income, sept.income);
});

test('monthlyBuckets: a month that ends today is not complete yet; empty months are listed', () => {
  const m = monthlyBuckets(DATA, { categoryOf, from: '2026-01-01', to: '2026-09-30', today: new Date(2026, 8, 30, 20) });
  assert.equal(m.length, 9);
  assert.equal(m[0].count, 0);
  assert.equal(m[0].complete, true);
  assert.equal(m[8].complete, false, 'September is not over on the 30th');
  assert.equal(monthlyBuckets(DATA, { categoryOf, from: '2026-01-01', to: '2026-09-30', today: new Date(2026, 9, 1) })[8].complete, true);
  assert.deepEqual(monthlyBuckets(DATA, { categoryOf, from: '2026-10-03', to: '2026-07-05' }), []);
});

test('monthlyBuckets: leap February and both DST switch days land in their month', () => {
  const txs = [
    mt940({ day: '2028-02-29', amount: -10, gvc: '106', text: 'KARTENZAHLUNG', name: 'IKEA' }),
    mt940({ day: '2028-03-01', amount: -20, gvc: '106', text: 'KARTENZAHLUNG', name: 'IKEA' }),
    mt940({ day: '2028-03-26', amount: -30, gvc: '106', text: 'KARTENZAHLUNG', name: 'IKEA' }),
    mt940({ day: '2028-10-29', amount: -40, gvc: '106', text: 'KARTENZAHLUNG', name: 'IKEA' }),
    mt940({ day: '2028-11-01', amount: -50, gvc: '106', text: 'KARTENZAHLUNG', name: 'IKEA' }),
  ];
  const m = monthlyBuckets(txs, { categoryOf, from: '2028-02-01', to: '2028-11-30', today: new Date(2029, 0, 1) });
  const by = Object.fromEntries(m.map((b) => [b.month, b.expense]));
  assert.equal(by['2028-02'], 10);
  assert.equal(by['2028-03'], 50);
  assert.equal(by['2028-10'], 40);
  assert.equal(by['2028-11'], 50);
  assert.equal(m[0].to, '2028-02-29');
});

test('topCounterparties groups by identity and ranks by money', () => {
  const out = topCounterparties(DATA, { categoryOf, dir: 'out', limit: 3 });
  // Cash is "Bargeld", not a payee named after the machine (or the bank) that paid it out.
  assert.deepEqual(out.map((c) => c.name), ['Hausverwaltung Kramer', 'REWE SAGT DANKE 4684', 'Bargeld']);
  assert.equal(out[2].cash, true);
  assert.equal(out[2].key, 'cash');
  assert.equal(out[2].iban, undefined);
  assert.equal(out[0].amount, 3400);
  assert.equal(out[0].count, 4);
  assert.equal(out[0].iban, IBAN.landlord);
  assert.equal(out[0].key, `iban:${IBAN.landlord}`);
  // Five card payments at different REWE terminals are one counterparty.
  const rewes = topCounterparties(DATA, { categoryOf, dir: 'out', limit: 10 }).find((c) => c.key.startsWith('name:REWE'))!;
  assert.equal(rewes.count, 5);
  assert.equal(rewes.amount, 269.8);
  assert.equal(rewes.sample.entryDate, rewe('2026-09-26', -33.05).entryDate, 'the newest booking is the sample');
  assert.equal(rewes.iban, undefined);
  // The own savings account is not a counterparty.
  assert.ok(!topCounterparties(DATA, { categoryOf, dir: 'out', limit: 50 }).some((c) => c.iban === OWN_SAVINGS));
  // Nameless bookings group by their booking text.
  const fees = topCounterparties(DATA, { categoryOf, dir: 'out', limit: 50 }).find((c) => c.key === 'text:ABSCHLUSS')!;
  assert.equal(fees.name, 'Abschluss');
});

test('topCounterparties for income, and with a period', () => {
  const inc = topCounterparties(DATA, { categoryOf, dir: 'in', limit: 5 });
  assert.equal(inc[0].name, 'ACME GmbH');
  assert.equal(inc[0].amount, 8000);
  assert.equal(inc[0].count, 3);
  const sept = topCounterparties(DATA, { categoryOf, dir: 'in', limit: 5, from: '2026-09-01', to: '2026-09-30' });
  assert.equal(sept[0].amount, 2700);
  assert.deepEqual(topCounterparties(DATA, { categoryOf, dir: 'in', limit: 0 }), []);
  assert.deepEqual(topCounterparties([], { categoryOf, dir: 'out', limit: 8 }), []);
});

test('topCounterparties shares the basis of periodTotals: refunds net, the other side stays out', () => {
  const amazon = (amount: number, text: string) =>
    camt({ day: '2026-09-10', amount, code: amount < 0 ? 'ESDD' : 'RCDT', text, name: 'AMAZON EU S.A R.L.' });
  const txs = newestFirst([
    amazon(-500, 'SEPA-Basislastschrift'),
    amazon(500, 'Gutschrift Erstattung'),
    rewe('2026-09-12', -50),
    // A salary reversed: a debit in an income category reduces the income, it is not an Ausgabe.
    salary('2026-09-25', 2000),
    mt940({ day: '2026-09-28', amount: -2000, gvc: '153', text: 'RUECKBUCHUNG', name: 'ACME GmbH', iban: IBAN.employer, purpose: 'Storno Gehalt 09/2026' }),
  ]);
  // The user's rule files everything from the employer under Einkommen, the reversal too.
  const withRule: CategoryOf = (tx) => (tx.remoteIban === IBAN.employer ? { id: 'income', source: 'rule' } : categoryOf(tx));
  const opts = { categoryOf: withRule, from: '2026-09-01', to: '2026-09-30' };
  assert.equal(categoryOf(txs.find((t) => t.amount === 500)!).id, 'shopping', 'the refund books into the shop’s category');
  const t = periodTotals(txs, opts);
  assert.equal(t.expense, 50);
  assert.equal(t.income, 0);
  assert.deepEqual(t.byCategory.map((c) => [c.id, c.count]), [['groceries', 1]]);
  assert.deepEqual(t.incomeByCategory, []);

  const out = topCounterparties(txs, { ...opts, dir: 'out', limit: 8 });
  assert.deepEqual(out.map((c) => [c.name, c.amount, c.count]), [['REWE SAGT DANKE 4701', 50, 1]]);
  assert.ok(out.every((c) => c.amount <= t.expense), 'no payee is more than the whole');
  assert.deepEqual(topCounterparties(txs, { ...opts, dir: 'in', limit: 8 }), [], 'a reversed salary nets to nothing');

  // A partial refund nets against its payee and is counted with it.
  const partial = [...txs.filter((tx) => tx.amount !== 500), amazon(120, 'Gutschrift Erstattung')];
  const p = topCounterparties(partial, { ...opts, dir: 'out', limit: 8 });
  const az = p.find((c) => c.name.startsWith('AMAZON'))!;
  assert.deepEqual([az.amount, az.count, az.offsets], [380, 2, 1]);
  assert.equal(p.find((c) => c.name.startsWith('REWE'))!.offsets, 0);
  assert.equal(sum(p), periodTotals(partial, opts).expense, 'the payees add up to the Ausgaben');
});

test('topCounterparties: every payee of the sample data adds up to the expense', () => {
  for (const [from, to] of [['2026-07-01', '2026-10-31'], ['2026-09-01', '2026-09-30'], ['2026-09-15', '2026-09-30']]) {
    const t = periodTotals(DATA, { categoryOf, from, to });
    assert.equal(sum(topCounterparties(DATA, { categoryOf, dir: 'out', limit: 99, from, to })), t.expense, `${from}…${to} out`);
    assert.equal(sum(topCounterparties(DATA, { categoryOf, dir: 'in', limit: 99, from, to })), t.income, `${from}…${to} in`);
  }
  // From the 15th, the IKEA refund outweighs the purchase: IKEA leaves the payees and joins the income.
  const late = { categoryOf, from: '2026-09-15', to: '2026-09-30' };
  assert.ok(!topCounterparties(DATA, { ...late, dir: 'out', limit: 99 }).some((c) => c.name.startsWith('IKEA')));
  assert.ok(topCounterparties(DATA, { ...late, dir: 'in', limit: 99 }).some((c) => c.name.startsWith('IKEA')));
});

test('largest: biggest first, newer first on a tie, Umbuchungen left out', () => {
  const big = largest(DATA, { categoryOf, dir: 'out', limit: 5 });
  assert.deepEqual(big.map((t) => t.amount), [-850, -850, -850, -850, -200]);
  assert.equal(big[0].entryDate, rent('2026-10-01').entryDate);
  assert.ok(!big.some((t) => t.remoteIban === OWN_SAVINGS));
  assert.deepEqual(largest(DATA, { categoryOf, dir: 'in', limit: 1 }).map((t) => t.amount), [2700]);
});

const find = (query: string, extra: Partial<TxFilter> = {}) =>
  filterTransactions(DATA, { dir: 'all', category: null, query, ...extra }, { categoryOf });

test('filterTransactions: direction and category chips', () => {
  assert.equal(find('', { dir: 'in' }).length, DATA.filter((t) => t.amount > 0).length);
  assert.equal(find('', { dir: 'out' }).length, DATA.filter((t) => t.amount < 0).length);
  assert.equal(find('', { category: 'groceries' }).length, 5);
  assert.equal(find('', { category: 'transfer' }).length, 2);
  assert.equal(find('', { dir: 'in', category: 'groceries' }).length, 0);
  assert.deepEqual(find(''), DATA, 'no filter keeps everything, in order');
});

test('search: names, prose and booking text, umlauts either way', () => {
  assert.equal(find('rewe').length, 5);
  assert.equal(find('REWE berlin').length, 5);
  assert.equal(find('rewe hamburg').length, 0, 'every word must match');
  assert.equal(find('hausverwaltung').length, 4);
  assert.equal(find('Miete').length, 4, 'SVWZ prose');
  assert.equal(find('netflix monatsabo').length, 3);
  assert.equal(find('dauerauftrag').length, 4, 'booking text');
  assert.equal(find('basislastschrift').length, 3);
  const muellerTx = mt940({ day: '2026-09-02', amount: -40, gvc: '116', text: 'UEBERWEISUNG', name: 'MUELLER, HANS', iban: IBAN.person, purpose: 'Grüße' });
  const withM = [...DATA, muellerTx];
  const s = (q: string) => filterTransactions(withM, { dir: 'all', category: null, query: q }, { categoryOf });
  assert.equal(s('müller').length, 1);
  assert.equal(s('Mueller').length, 1);
  assert.equal(s('grüsse').length, 1);
  assert.equal(s('GRUESSE').length, 1);
  assert.equal(s('  ').length, withM.length);
  assert.equal(s('rewe €').length, 5, 'a lone currency sign narrows nothing');
  assert.equal(s('rewe -').length, 5, 'nor does a lone dash');
});

test('search: IBANs with and without spaces', () => {
  assert.equal(find(IBAN.landlord).length, 4);
  assert.equal(find('DE75 5121 0800 1245 1261 99').length, 4);
  assert.equal(find('de75 5121').length, 4);
  assert.equal(find('DE7551210800').length, 4);
  assert.equal(find('DE99 0000').length, 0);
});

test('search: amounts the way people type them', () => {
  assert.equal(find('12,99').length, 3);
  assert.equal(find('12.99').length, 3);
  assert.equal(find('-12,99').length, 3);
  assert.equal(find('+12,99').length, 0, 'a sign picks the direction');
  assert.equal(find('−12,99').length, 3);
  assert.equal(find('850').length, 4, 'a whole number matches 850,00 … 850,99');
  assert.equal(find('2.700').length, 1);
  assert.equal(find('2700,00').length, 1);
  assert.equal(find('+2650').length, 2);
  assert.equal(find('29,99').length, 1, 'the refund');
  assert.equal(find('-29,99').length, 0);
  assert.equal(find('>800').length, 4 + 3, 'rent and salary');
  assert.equal(find('>=2700').length, 1);
  assert.equal(find('<1').length, 1, 'the interest');
  assert.equal(find('<=7,95').length, 2);
  assert.equal(find('50-100').length, 3, 'REWE 54,30 / 61,15 / 72,40');
  assert.equal(find('rewe >60').length, 2);
  assert.equal(find('>abc').length, 0);
});

test('search: a number pair with a dash is text first, an amount range only when ascending', () => {
  // "z. B. Rechnung 2026-118" is what the transfer form suggests as a Verwendungszweck.
  const invoice = mt940({ day: '2026-09-03', amount: -5, gvc: '116', text: 'UEBERWEISUNG', name: 'Copyshop Lenz', purpose: 'Rechnung 2026-118' });
  const shop = mt940({ day: '2026-09-04', amount: -30, gvc: '106', text: 'KARTENZAHLUNG', name: 'Shop 24-7 GmbH' });
  const withRefs = [...DATA, invoice, shop];
  const s = (q: string) => filterTransactions(withRefs, { dir: 'all', category: null, query: q }, { categoryOf });
  assert.deepEqual(s('2026-118'), [invoice], 'the invoice, not the rent that happens to lie between 118 and 2026 €');
  assert.deepEqual(s('Rechnung 2026-118'), [invoice]);
  assert.deepEqual(s('24-7'), [shop], '30 € is outside 7…24 €, but the name has it');
  assert.deepEqual(s('Shop 24-7 GmbH'), [shop]);
  assert.equal(s('50-100').length, 3, 'still the REWE range');
  assert.equal(s('100-50').length, 0, 'a descending pair is only text');
  assert.ok(txMatcher('2026-118')(invoice));
});

test('search: dates match the Buchungs- or Wertstellungstag', () => {
  assert.equal(find('15.09.').length, 1);
  assert.equal(find('15.09.2026').length, 1);
  assert.equal(find('15.09.26').length, 1);
  assert.equal(find('15.09.2025').length, 0);
  assert.equal(find('01.10.').length, 1, 'local day, not the UTC date of the wire string');
  assert.equal(find('30.09.').length, 3);
  // As English writes the day, day first; "09/2026" stays the month.
  assert.equal(find('15/09').length, 1);
  assert.equal(find('15/09/2026').length, 1);
  assert.equal(find('15/09/2025').length, 0);
  assert.equal(find('30/09').length, 3);
});

test('txMatcher is reusable on its own', () => {
  const m = txMatcher('netflix');
  assert.equal(DATA.filter(m).length, 3);
  assert.equal(DATA.filter(txMatcher('')).length, DATA.length);
});

// ---------------------------------------------------------------------------
// Finding a booking by what the screen shows
// ---------------------------------------------------------------------------

// A girocard payment whose terminal dropped the accents: the bank says "Caf"
// and "Kln", the list says "Café Nova Deutzer F" and "Köln".
const cafe = {
  ...mt940({
    day: '2026-09-18', amount: -4.8, gvc: '106', text: 'KARTENZAHLUNG', name: 'Adyen N.V.', iban: 'NL50ADYB2017400157',
    purpose: '2026-09-18T08:12 Debitk.0 2030-12',
  }),
  ultimateName: 'LS Caf Nova Deutzer F/Frankenwerft 1/Kln/DE',
};
const WITH_CAFE = newestFirst([...DATA, cafe]);
// Stands in for components/transactions/model.ts searchText: what the row and the drawer show.
const shownText = (tx: SerializedTransaction) => {
  const acceptor = parseCardAcceptor(tx.ultimateName);
  return acceptor ? [acceptor.merchant, 'Debitkarte', acceptor.city, acceptor.country === 'DE' ? 'Deutschland' : ''].join(' ') : '';
};
const shown = { categoryOf, shownText };
const findShown = (query: string, extra: Partial<TxFilter> = {}) =>
  filterTransactions(WITH_CAFE, { dir: 'all', category: null, query, ...extra }, shown);

test('search: the words the screen shows find their row', () => {
  assert.equal(filterTransactions(WITH_CAFE, { dir: 'all', category: null, query: 'café nova' }, { categoryOf }).length, 0,
    'the bank wrote "Caf"; without what the screen shows, the accent hides it');
  assert.deepEqual(findShown('café nova'), [cafe]);
  assert.deepEqual(findShown('cafe nova'), [cafe]);
  assert.deepEqual(findShown('köln'), [cafe]);
  assert.deepEqual(findShown('koeln'), [cafe]);
  assert.deepEqual(findShown('deutschland debitkarte'), [cafe]);
  assert.deepEqual(findShown('frankenwerft'), [cafe], 'the bank’s own descriptor still counts');
});

test('search: category labels, as the rows show them', () => {
  assert.equal(findShown('lebensmittel').length, 5, 'every REWE booking is "Lebensmittel & Drogerie"');
  assert.equal(findShown('Lebensmittel & Drogerie').length, 5);
  assert.equal(findShown('wohnen').length, 4);
  assert.equal(findShown('rewe lebensmittel').length, 5);
  // A user's rule is what the row shows, so it is what the search finds.
  const ruled: CategoryOf = (tx) => (tx.remoteIban === IBAN.landlord ? { id: 'savings', source: 'rule' } : categoryOf(tx));
  const ctx = { categoryOf: ruled };
  assert.equal(filterTransactions(DATA, { dir: 'all', category: null, query: 'sparen anlegen' }, ctx).length, 4);
  assert.equal(filterTransactions(DATA, { dir: 'all', category: null, query: 'wohnen' }, ctx).length, 0);
});

test('search: month words, alone or with a year, as well as the text', () => {
  assert.equal(monthOfWord('August'), 8);
  assert.equal(monthOfWord('aug'), 8);
  assert.equal(monthOfWord('Sept.'), 9);
  assert.equal(monthOfWord('märz'), 3);
  assert.equal(monthOfWord('Maerz'), 3);
  assert.equal(monthOfWord('Mrz'), 3);
  assert.equal(monthOfWord('jun'), 6);
  assert.equal(monthOfWord('jul'), 7);
  assert.equal(monthOfWord('ju'), null, 'two letters are text');
  assert.equal(monthOfWord('maier'), null);
  assert.equal(monthOfWord('augustin'), null);

  const august = DATA.filter((tx) => tx.entryDate >= '2026-07-31T22' && tx.entryDate < '2026-08-31T22');
  assert.equal(find('august').length, august.length);
  assert.equal(find('August 2026').length, august.length);
  assert.equal(find('aug 2025').length, 0);
  assert.equal(find('08/2026').length, august.length);
  // "Gehalt 07/2026" is the July salary's purpose; "07/2026" finds it by its text and July's bookings by date.
  assert.equal(find('acme 07/2026').length, 1);
  assert.equal(find('2026-08').length, august.length);
  assert.equal(find('rewe august').length, 1, 'REWE on 8 August');
  assert.equal(find('miete september').length, 1, 'the rent booked in September');
  // A month word is still a word: "Mai" finds no May booking here, but "Maier".
  const maier = mt940({ day: '2026-09-02', amount: -40, gvc: '116', text: 'UEBERWEISUNG', name: 'Maier, Petra', iban: IBAN.person, purpose: 'Nachhilfe' });
  const s = (q: string) => filterTransactions([...DATA, maier], { dir: 'all', category: null, query: q }, { categoryOf });
  assert.deepEqual(s('mai'), [maier]);
  assert.deepEqual(s('maier'), [maier]);
});

test('search: a month counts in the Buchungs- or the Wertstellungsmonat', () => {
  // Paid on 31 August, booked on 1 September.
  const late = mt940({ day: '2026-09-01', valueDay: '2026-08-31', amount: -19.9, gvc: '106', text: 'KARTENZAHLUNG', name: 'Kino am Markt' });
  const s = (q: string) => filterTransactions([late], { dir: 'all', category: null, query: q }, { categoryOf });
  assert.equal(s('august').length, 1);
  assert.equal(s('september').length, 1);
  assert.equal(s('oktober').length, 0);
});

test('searchReport: which word found nothing, and which was read as a month', () => {
  assert.deepEqual(searchReport(DATA, 'rewe augustt', { categoryOf }), [
    { text: 'rewe', matches: 5, month: null },
    { text: 'augustt', matches: 0, month: null },
  ]);
  const r = searchReport(DATA, 'rewe aug 2026', { categoryOf });
  assert.deepEqual(r.map((t) => [t.text, t.month]), [['rewe', null], ['aug 2026', 'August 2026']]);
  assert.ok(r.every((t) => t.matches > 0), 'each word occurs');
  assert.deepEqual(searchReport(DATA, '  ', { categoryOf }), []);
  assert.deepEqual(searchReport(DATA, 'DE75 5121', { categoryOf }), [{ text: 'DE75 5121', matches: 4, month: null }]);
  assert.deepEqual(searchReport(DATA, 'rewe €').map((t) => t.text), ['rewe'], 'a lone currency sign is no word');
});

test('filterTransactions: from/to narrow by the local Buchungstag, both ends included', () => {
  const sept = find('', { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(sept.length, periodTotals(DATA, { categoryOf, from: '2026-09-01', to: '2026-09-30' }).count + 1, 'the Umbuchung is a row too');
  assert.ok(sept.every((tx) => tx.entryDate >= '2026-08-31T22' && tx.entryDate < '2026-09-30T22'));
  assert.equal(find('', { from: '2026-10-01', to: '2026-10-01' }).length, 1, 'the rent of 1 October, sent as 30.09. 22:00 UTC');
  assert.equal(find('', { from: '2026-10-01' }).length, 1, 'an open end');
  assert.equal(find('', { to: '2026-07-04' }).length, 2, 'rent and REWE up to 4 July');
  assert.equal(find('rewe', { from: '2026-09-01', to: '2026-09-30' }).length, 2);
  assert.equal(find('', { from: '', to: '' }).length, DATA.length, 'empty means open');
  assert.equal(inFilterDays(rent('2026-10-01'), { from: '2026-10-01', to: '2026-10-31' }), true);
  assert.equal(inFilterDays(rent('2026-10-01'), { from: '2026-09-01', to: '2026-09-30' }), false);
});

test('calendarMonths and daysLabel name a stretch the way the controls do', () => {
  const m = calendarMonths('2026-07-06', '2026-10-04', new Date(2026, 9, 4, 12));
  assert.deepEqual(m.map((x) => [x.month, x.from, x.to, x.complete]), [
    ['2026-07', '2026-07-06', '2026-07-31', false],
    ['2026-08', '2026-08-01', '2026-08-31', true],
    ['2026-09', '2026-09-01', '2026-09-30', true],
    ['2026-10', '2026-10-01', '2026-10-04', false],
  ]);
  assert.equal(daysLabel('2026-09-01', '2026-09-30'), 'September 2026');
  assert.equal(daysLabel('2026-10-01', '2026-10-04'), 'Oktober 2026 · bis 04.10.');
  assert.equal(daysLabel('2026-07-06', '2026-07-31'), 'Juli 2026 · ab 06.07.');
  assert.equal(daysLabel('2026-07-06', '2026-07-20'), 'Juli 2026 · 06.07.–20.07.');
  assert.equal(daysLabel('2026-09-28', '2026-09-28'), '28.09.2026');
  assert.equal(daysLabel('2026-07-06', '2026-09-30'), '06.07.–30.09.2026');
  assert.equal(daysLabel('2026-09-01', ''), 'ab 01.09.2026');
  assert.equal(daysLabel('', ''), '');
});

const paypal = (day: string, shop: string, amount: number) =>
  mt940({
    day, amount, gvc: '105', text: 'BASISLASTSCHRIFT', name: 'PAYPAL EUROPE S.A.R.L. ET CIE S.C.A', iban: IBAN.paypal,
    purpose: shop ? `PP.4711.PP . ${shop}, Ihr Einkauf bei ${shop}` : 'PP.4711.PP PAYPAL',
  });

test('facilitatorShop: the shop behind a payment service, from the purpose', () => {
  assert.equal(facilitatorShop(paypal('2026-09-03', 'ZALANDO SE', -59.95)), 'ZALANDO SE');
  assert.equal(facilitatorShop(paypal('2026-09-03', 'G2A.com', -9.99)), 'G2A.com', 'a domain as the purpose spells it');
  assert.equal(facilitatorShop(paypal('2026-09-03', '', -9.99)), null, 'no shop named');
  assert.equal(facilitatorShop(rent('2026-09-01')), null, 'not a payment service');
});

test('topCounterparties: a shop paid through PayPal is the payee, not PayPal', () => {
  const txs = newestFirst([
    paypal('2026-09-03', 'ZALANDO SE', -60), paypal('2026-09-10', 'ZALANDO SE', -40), paypal('2026-09-12', 'THOMANN GMBH', -80),
  ]);
  const out = topCounterparties(txs, { categoryOf, dir: 'out', limit: 5 });
  assert.deepEqual(out.map((c) => [c.name, c.amount, c.count]), [['ZALANDO SE', 100, 2], ['THOMANN GMBH', 80, 1]]);
  assert.ok(out.every((c) => c.iban === undefined), 'PayPal’s IBAN would list every PayPal purchase');
  assert.equal(out[0].via, 'PAYPAL EUROPE S.A.R.L. ET CIE S.C.A');
});

test('largest: skip leaves bookings out', () => {
  const big = largest(DATA, { categoryOf, dir: 'out', limit: 3, skip: (tx) => tx.remoteIban === IBAN.landlord });
  assert.deepEqual(big.map((t) => t.amount), [-200, -129.99, -72.4]);
});

test('txMatcher takes the screen’s words through its context', () => {
  assert.equal(WITH_CAFE.filter(txMatcher('köln', shown)).length, 1);
  assert.equal(WITH_CAFE.filter(txMatcher('köln')).length, 0);
});
