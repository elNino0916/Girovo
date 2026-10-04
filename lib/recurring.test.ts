import './__fixtures__/tz.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SerializedTransaction } from './fints-types';
import { counterpartyKey } from './categories.ts';
import { categorize } from './categorize.ts';
import {
  cadenceLabel, detectRecurring, recurringGroups, recurringTotals, seriesId, txCreditorId, txMandate, unseenCadences, upcoming,
  type RecurringSeries,
} from './recurring.ts';
import { CRED, IBAN, OWN_IBANS, OWN_SAVINGS, camt, mt940, newestFirst } from './__fixtures__/transactions.ts';

const TODAY = new Date(2026, 9, 3, 11, 0); // Saturday, 3 October 2026

const netflixMt940 = (day: string, amount = -12.99) =>
  mt940({ day, amount, gvc: '105', text: 'BASISLASTSCHRIFT', name: 'Netflix International B.V.', iban: IBAN.netflix, cred: CRED.netflix, mref: 'NF-778', purpose: 'Netflix Monatsabo' });

const only = (series: RecurringSeries[]) => {
  assert.equal(series.length, 1, `expected one series, got ${series.map((s) => `${s.name} ${s.cadence}`).join(', ') || 'none'}`);
  return series[0];
};

test('identity: creditor ID and mandate from fields, from remoteBic, and from run-together tags', () => {
  const spaced = netflixMt940('2026-09-15');
  assert.equal(spaced.remoteBic, CRED.netflix, 'lib-fints files CRED+ under remoteIdentifier → remoteBic');
  assert.equal(txCreditorId(spaced), CRED.netflix);
  assert.equal(txMandate(spaced), 'NF-778');

  const raw = mt940({ day: '2026-09-15', amount: -5, gvc: '105', text: 'BASISLASTSCHRIFT', rawTags: true, eref: 'E1', mref: 'M-9', cred: 'DE98ZZZ09999999999', bic: 'COBADEFFXXX', purpose: 'Abo' });
  assert.equal(txCreditorId(raw), 'DE98ZZZ09999999999');
  assert.equal(txMandate(raw), 'M-9');

  const camtTx = camt({ day: '2026-09-15', amount: -5, code: 'ESDD', bic: 'INGDDEFFXXX', mref: 'GYM-1', purpose: `CRED+${CRED.gym} Mitgliedsbeitrag` });
  assert.equal(txCreditorId(camtTx), CRED.gym, 'CAMT has no creditor field; the purpose still carries it');
  assert.equal(txMandate(camtTx), 'GYM-1');

  assert.equal(txCreditorId(camt({ day: '2026-09-15', amount: -5, bic: 'INGDDEFFXXX' })), null, 'a BIC is not a creditor ID');
  assert.equal(txMandate(camt({ day: '2026-09-15', amount: -5, mref: 'NOTPROVIDED' })), null);
});

test('a monthly MT940 direct debit, one booking rolled over a weekend', () => {
  const s = only(detectRecurring(newestFirst([netflixMt940('2026-07-15'), netflixMt940('2026-08-17'), netflixMt940('2026-09-15')]), { today: TODAY }));
  assert.equal(s.cadence, 'monthly');
  assert.equal(s.cadenceLabel, 'monatlich');
  assert.equal(s.kind, 'expense');
  assert.equal(s.amount, -12.99);
  assert.equal(s.monthlyAmount, -12.99);
  assert.equal(s.yearlyAmount, -155.88);
  assert.equal(s.directDebit, true);
  assert.equal(s.creditorId, CRED.netflix);
  assert.equal(s.mandateReference, 'NF-778');
  assert.equal(s.iban, IBAN.netflix);
  assert.equal(s.category, 'media');
  assert.equal(s.firstDate, '2026-07-15');
  assert.equal(s.lastDate, '2026-09-15');
  assert.equal(s.nextDate, '2026-10-15', 'the 15th — not the 17th the rolled booking fell on');
  assert.equal(s.count, 3);
  assert.equal(s.changed, false);
  assert.equal(s.change, null);
  assert.equal(s.overdue, false);
  assert.equal(s.ended, false);
  assert.equal(s.key, `out|cred:${CRED.netflix}|mref:NF-778`);
  assert.equal(s.id, seriesId(s.key));
  assert.match(s.id, /^rec_[0-9a-z]+$/);
  assert.equal(s.transactions[0].entryDate, netflixMt940('2026-09-15').entryDate, 'newest first');
});

test('two bookings make a monthly series only for a SEPA direct debit with a creditor ID (CAMT)', () => {
  const gym = (day: string) =>
    camt({ day, amount: -29.9, code: 'ESDD', text: 'SEPA-Basislastschrift', name: 'FitX Deutschland GmbH', iban: 'DE12500105170000012345', mref: 'GYM-1', purpose: `CRED+${CRED.gym} Mitgliedsbeitrag` });
  const s = only(detectRecurring([gym('2026-08-03'), gym('2026-09-01')], { today: TODAY }));
  assert.equal(s.cadence, 'monthly');
  assert.equal(s.count, 2);
  assert.equal(s.creditorId, CRED.gym);
  assert.equal(s.nextDate, '2026-10-01');
  assert.equal(s.category, 'leisure');

  const transfer = (day: string) =>
    camt({ day, amount: -29.9, code: 'ESCT', text: 'SEPA-Überweisung', name: 'Erika Musterfrau', iban: IBAN.person, purpose: 'Nachhilfe' });
  assert.deepEqual(detectRecurring([transfer('2026-08-03'), transfer('2026-09-01')], { today: TODAY }), []);
  assert.equal(detectRecurring([transfer('2026-07-01'), transfer('2026-08-03'), transfer('2026-09-01')], { today: TODAY }).length, 1);
});

test('salary: varies, is still one series, and is anchored to the month end', () => {
  const pay = (day: string, amount: number) =>
    mt940({ day, amount, gvc: '153', text: 'LOHN/GEHALT', name: 'ACME GmbH', iban: IBAN.employer, purpose: 'Lohn/Gehalt' });
  // Paid on the last working day: 27 Feb (28th a Saturday), 31 Mar, 30 Apr, 29 May (31st a Sunday).
  const s = only(detectRecurring([pay('2026-02-27', 2650), pay('2026-03-31', 2710.4), pay('2026-04-30', 2590.1), pay('2026-05-29', 2980.55)], { today: new Date(2026, 5, 5) }));
  assert.equal(s.kind, 'income');
  assert.equal(s.category, 'income');
  assert.equal(s.cadence, 'monthly');
  assert.equal(s.variable, true);
  assert.equal(s.amount, 2680.2, 'the median of the recent amounts');
  assert.equal(s.lastAmount, 2980.55);
  assert.equal(s.changed, true);
  assert.equal(s.change, 390.45);
  assert.equal(s.nextDate, '2026-06-30', 'month end, whatever the date');
});

test('the 25 % allowance is for salary only', () => {
  const amounts = [100, 150, 80, 130]; // CV ≈ 23 %
  const days = ['2026-06-01', '2026-07-01', '2026-08-03', '2026-09-01'];
  const fromPerson = days.map((day, i) =>
    camt({ day, amount: amounts[i], code: 'ESCT', text: 'Gutschrift', name: 'Erika Musterfrau', iban: IBAN.person, purpose: 'Danke' }));
  assert.deepEqual(detectRecurring(fromPerson, { today: TODAY }), []);
  const salary = days.map((day, i) => camt({ day, amount: amounts[i], code: 'SALA', text: 'Lohn/Gehalt', name: 'Minijob GmbH', iban: IBAN.employer }));
  assert.equal(only(detectRecurring(salary, { today: TODAY })).kind, 'income');
});

test('rent by standing order: the 1st, next rolled off a Sunday', () => {
  const rent = (day: string) =>
    mt940({ day, amount: -850, gvc: '117', text: 'DAUERAUFTRAG', name: 'Hausverwaltung Kramer', iban: IBAN.landlord, purpose: 'Miete Whg 3' });
  const s = only(detectRecurring([rent('2026-07-01'), rent('2026-08-03'), rent('2026-09-01'), rent('2026-10-01')], { today: TODAY }));
  assert.equal(s.nextDate, '2026-11-02', '1 November 2026 is a Sunday');
  assert.equal(s.directDebit, false);
  assert.equal(s.category, 'housing');
  assert.equal(s.key, `out|iban:${IBAN.landlord}`);
});

test('a price increase: flagged, and the new price is the one projected', () => {
  const spotify = (day: string, amount: number) =>
    camt({ day, amount, code: 'ESDD', text: 'SEPA-Basislastschrift', name: 'Spotify AB', iban: 'SE3550000000054910000003', mref: 'SP-1', purpose: 'CRED+SE11ZZZ5567037485 Spotify Premium' });
  const just = only(detectRecurring([spotify('2026-06-10', -12.99), spotify('2026-07-10', -12.99), spotify('2026-08-10', -12.99), spotify('2026-09-10', -14.99)], { today: TODAY }));
  assert.equal(just.changed, true);
  assert.equal(just.change, 2);
  assert.equal(just.previousAmount, -12.99);
  assert.equal(just.lastAmount, -14.99);
  assert.equal(just.amount, -14.99);
  assert.equal(just.monthlyAmount, -14.99);
  assert.equal(just.variable, false);
  assert.equal(just.nextDate, '2026-10-12', '10 October is a Saturday');

  // Two increases a while ago: a fixed price, now 11,99, nothing new to flag.
  const older = only(detectRecurring(
    [['2026-03-10', -9.99], ['2026-04-10', -9.99], ['2026-05-11', -9.99], ['2026-06-10', -10.99], ['2026-07-10', -10.99], ['2026-08-10', -11.99], ['2026-09-10', -11.99]]
      .map(([d, a]) => spotify(d as string, a as number)),
    { today: TODAY },
  ));
  assert.equal(older.amount, -11.99);
  assert.equal(older.changed, false);
  assert.equal(older.variable, false);

  // A cent of rounding is not a price change.
  const tiny = only(detectRecurring([spotify('2026-07-10', -9.99), spotify('2026-08-10', -9.99), spotify('2026-09-10', -10.0)], { today: TODAY }));
  assert.equal(tiny.changed, false);
});

test('groceries by card are a habit, not a contract — however regular', () => {
  const shop = (day: string, amount: number) =>
    mt940({ day, amount, gvc: '106', text: 'KARTENZAHLUNG', name: 'REWE SAGT DANKE 46511234//BERLIN/DE' });
  const irregular = [
    shop('2026-08-01', -54.3), shop('2026-08-04', -12.1), shop('2026-08-08', -61.15), shop('2026-08-12', -8.99),
    shop('2026-08-15', -48.9), shop('2026-08-19', -33.4), shop('2026-08-22', -72.4), shop('2026-08-29', -41.0),
  ];
  assert.deepEqual(detectRecurring(irregular, { today: TODAY }), []);
  const weekly = ['2026-08-01', '2026-08-08', '2026-08-15', '2026-08-22', '2026-08-29', '2026-09-05'].map((d) => shop(d, -25));
  assert.deepEqual(detectRecurring(weekly, { today: TODAY }), []);
  // …unless collected by direct debit, like a weekly organic box.
  const box = (day: string) =>
    camt({ day, amount: -24.9, code: 'ESDD', text: 'SEPA-Basislastschrift', name: 'Alnatura Lieferservice', iban: 'DE50500105170000098765', mref: 'BOX-7', purpose: 'CRED+DE77ZZZ00000077777 Gemüsekiste' });
  const s = only(detectRecurring(['2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25', '2026-10-02'].map(box), { today: TODAY }));
  assert.equal(s.cadence, 'weekly');
  assert.equal(s.category, 'groceries');
  assert.equal(s.nextDate, '2026-10-09');
});

test('Umbuchungen to own accounts, cash and returned debits are never series', () => {
  const save = (day: string) =>
    mt940({ day, amount: -300, gvc: '117', text: 'DAUERAUFTRAG', name: 'Nino Muster', iban: OWN_SAVINGS, purpose: 'Sparen' });
  const months = ['2026-06-01', '2026-07-01', '2026-08-03', '2026-09-01'];
  assert.equal(detectRecurring(months.map(save), { today: TODAY }).length, 1, 'without the own-account list it looks like any standing order');
  assert.deepEqual(detectRecurring(months.map(save), { today: TODAY, ownIbans: OWN_IBANS }), []);
  assert.deepEqual(detectRecurring(months.map(save), { today: TODAY, ownIbans: new Set(OWN_IBANS) }), []);
  const umbuchung = (day: string) => mt940({ day, amount: -100, gvc: '116', text: 'UMBUCHUNG', name: 'Nino Muster', iban: 'DE89370400440532099999' });
  assert.deepEqual(detectRecurring(months.map(umbuchung), { today: TODAY }), []);
  const atm = (day: string) => mt940({ day, amount: -100, gvc: '083', text: 'BARGELDAUSZAHLUNG', name: 'GA NR00001234' });
  assert.deepEqual(detectRecurring(['2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25'].map(atm), { today: TODAY }), []);
  const back = (day: string) => mt940({ day, amount: 12.99, gvc: '109', text: 'RUECKLASTSCHRIFT', name: 'Netflix International B.V.', iban: IBAN.netflix });
  assert.deepEqual(detectRecurring(months.map(back), { today: TODAY }), []);
  // And the user's own say: a booking they filed as Umbuchung is left out too.
  const categoryOf = () => ({ id: 'transfer' as const, source: 'manual' as const });
  const rent = (day: string) => mt940({ day, amount: -850, gvc: '117', text: 'DAUERAUFTRAG', name: 'Hausverwaltung', iban: IBAN.landlord });
  assert.deepEqual(detectRecurring(months.map(rent), { today: TODAY, categoryOf }), []);
});

test('quarterly and yearly series need only two bookings, and project on the calendar', () => {
  const insurance = (day: string) =>
    camt({ day, amount: -86.4, code: 'ESDD', text: 'SEPA-Basislastschrift', name: 'HUK-COBURG', iban: IBAN.insurer, mref: 'HUK-55', purpose: `CRED+${CRED.insurer} Beitrag Hausrat` });
  const q = only(detectRecurring([insurance('2026-04-01'), insurance('2026-07-01')], { today: new Date(2026, 8, 20) }));
  assert.equal(q.cadence, 'quarterly');
  assert.equal(q.cadenceLabel, 'vierteljährlich');
  assert.equal(q.nextDate, '2026-10-01');
  assert.equal(q.monthlyAmount, -28.8);
  assert.equal(q.yearlyAmount, -345.6);
  assert.equal(q.category, 'insurance');

  const kfz = (day: string) =>
    mt940({ day, amount: -412.37, gvc: '105', text: 'BASISLASTSCHRIFT', name: 'ALLIANZ VERSICHERUNGS-AG', iban: IBAN.kfz, cred: CRED.kfz, mref: 'KFZ-1', purpose: 'Kfz-Versicherung M-AB 1234' });
  const y = only(detectRecurring([kfz('2025-01-02'), kfz('2026-01-02')], { today: new Date(2026, 5, 1) }));
  assert.equal(y.cadence, 'yearly');
  assert.equal(y.nextDate, '2027-01-04', '2 January 2027 is a Saturday');
  assert.equal(y.monthlyAmount, -34.36);
  assert.equal(y.yearlyAmount, -412.37);

  const half = (day: string) => camt({ day, amount: -60, code: 'ESDD', name: 'ADAC e.V.', iban: 'DE65700800000123456789', mref: 'ADAC-3', purpose: 'CRED+DE88ZZZ00000012121 Beitrag' });
  assert.equal(only(detectRecurring([half('2025-11-14'), half('2026-05-14')], { today: TODAY })).cadence, 'halfyearly');
});

test('month ends clamp: the 31st becomes the 30th, and the 29th in a leap February', () => {
  const dd = (day: string) =>
    camt({ day, amount: -20, code: 'ESDD', name: 'Stadtwerke Musterstadt', iban: IBAN.stadtwerke, mref: 'SW-1', purpose: `CRED+${CRED.stadtwerke} Abschlag` });
  assert.equal(only(detectRecurring([dd('2026-07-31'), dd('2026-08-31')], { today: new Date(2026, 8, 10) })).nextDate, '2026-09-30');
  assert.equal(only(detectRecurring([dd('2027-12-31'), dd('2028-01-31')], { today: new Date(2028, 1, 1) })).nextDate, '2028-02-29');
  assert.equal(only(detectRecurring([dd('2024-12-31'), dd('2025-01-31')], { today: new Date(2025, 1, 1) })).nextDate, '2025-02-28');
});

test('a due date on a weekend: debits move forward, month-end pay moves back', () => {
  // 31 October 2026 is a Saturday.
  const days = ['2026-07-31', '2026-08-31', '2026-09-30'];
  const debit = (day: string) =>
    camt({ day, amount: -20, code: 'ESDD', name: 'Stadtwerke Musterstadt', iban: IBAN.stadtwerke, mref: 'SW-1', purpose: `CRED+${CRED.stadtwerke} Abschlag` });
  const pay = (day: string) => camt({ day, amount: 2650, code: 'SALA', name: 'ACME GmbH', iban: IBAN.employer });
  assert.equal(only(detectRecurring(days.map(debit), { today: TODAY })).nextDate, '2026-11-02');
  assert.equal(only(detectRecurring(days.map(pay), { today: TODAY })).nextDate, '2026-10-30');
  // History beats the default: this creditor collected early when the 15th
  // was a Saturday (14 August 2026), so the Sunday 15 November moves back too.
  const early = ['2026-07-15', '2026-08-14', '2026-09-15', '2026-10-15'].map((day) =>
    camt({ day, amount: -45, code: 'ESDD', name: 'Musikschule', iban: 'DE12500105170000044444', mref: 'MS-1', purpose: 'CRED+DE44ZZZ00000044444 Unterricht' }));
  assert.equal(only(detectRecurring(early, { today: new Date(2026, 9, 20) })).nextDate, '2026-11-13');
  // …and one that collected late keeps rolling forward.
  const late = ['2026-08-17', '2026-09-15', '2026-10-15'].map((day) =>
    camt({ day, amount: -45, code: 'ESDD', name: 'Musikschule', iban: 'DE12500105170000044444', mref: 'MS-1', purpose: 'CRED+DE44ZZZ00000044444 Unterricht' }));
  assert.equal(only(detectRecurring(late, { today: new Date(2026, 9, 20) })).nextDate, '2026-11-16');
});

test('weekly: seven days on, rolled over Easter', () => {
  const pocket = (day: string) =>
    mt940({ day, amount: -10, gvc: '117', text: 'DAUERAUFTRAG', name: 'Lena Muster', iban: IBAN.person, purpose: 'Taschengeld' });
  const s = only(detectRecurring(['2027-02-26', '2027-03-05', '2027-03-12', '2027-03-19'].map(pocket), { today: new Date(2027, 2, 20) }));
  assert.equal(s.cadence, 'weekly');
  assert.equal(s.nextDate, '2027-03-30', 'Good Friday 26 March and Easter Monday 29 March 2027 are closed');
  assert.equal(s.monthlyAmount, -43.33);
  assert.equal(s.yearlyAmount, -520);
});

test('irregular payments to the same person are not a series', () => {
  const p = (day: string) => mt940({ day, amount: -50, gvc: '116', text: 'UEBERWEISUNG', name: 'Max Mustermann', iban: IBAN.person });
  assert.deepEqual(detectRecurring(['2026-06-02', '2026-06-20', '2026-08-11', '2026-08-14', '2026-09-30'].map(p), { today: TODAY }), []);
});

test('one PayPal mandate, many purchases: the subscription inside is still found', () => {
  const pp = (day: string, amount: number, shop: string) =>
    mt940({ day, amount, gvc: '105', text: 'BASISLASTSCHRIFT', name: 'PayPal Europe S.a.r.l. et Cie S.C.A', iban: IBAN.paypal, cred: CRED.paypal, mref: '5RRJ2259NXZLL', purpose: `PP.8126.PP . ${shop}, Ihr Einkauf bei ${shop}` });
  const txs = [
    pp('2026-06-15', -12.99, 'Netflix International B.V.'), pp('2026-06-22', -34.5, 'ABC Handels UG'),
    pp('2026-07-15', -12.99, 'Netflix International B.V.'), pp('2026-07-30', -8.2, 'Kiosk Online'),
    pp('2026-08-17', -12.99, 'Netflix International B.V.'), pp('2026-08-20', -112, 'Elektro Shop GmbH'),
    pp('2026-09-15', -12.99, 'Netflix International B.V.'), pp('2026-09-16', -19.99, 'Buchladen'),
  ];
  const s = only(detectRecurring(newestFirst(txs), { today: TODAY }));
  assert.equal(s.amount, -12.99);
  assert.equal(s.count, 4);
  assert.equal(s.category, 'media');
  assert.equal(s.key, `out|cred:${CRED.paypal}|mref:5RRJ2259NXZLL|amt:13`);
  assert.equal(s.nextDate, '2026-10-15');
  // Named after the shop, not PayPal — and without PayPal's IBAN, which would
  // lead "Umsätze anzeigen" to every PayPal purchase.
  assert.equal(s.name, 'Netflix International B.V');
  assert.equal(s.iban, null);
});

test('money in and money out with the same counterparty are separate series', () => {
  const out = (day: string) => mt940({ day, amount: -100, gvc: '117', text: 'DAUERAUFTRAG', name: 'Erika Musterfrau', iban: IBAN.person });
  const back = (day: string) => mt940({ day, amount: 40, gvc: '152', text: 'DAUERAUFTRAGSGUTSCHRIFT', name: 'Erika Musterfrau', iban: IBAN.person });
  const days = ['2026-06-01', '2026-07-01', '2026-08-03', '2026-09-01'];
  const series = detectRecurring([...days.map(out), ...days.map(back)], { today: TODAY });
  assert.deepEqual(series.map((s) => [s.kind, s.amount]), [['income', 40], ['expense', -100]], 'income first');
  assert.notEqual(series[0].id, series[1].id);
});

test('late and ended series, judged against the data that could show them', () => {
  const months = ['2026-03-16', '2026-04-15', '2026-05-15', '2026-06-15'];
  const txs = months.map((d) => netflixMt940(d));
  const stale = only(detectRecurring(txs, { today: TODAY }));
  assert.equal(stale.nextDate, '2026-07-15');
  assert.equal(stale.overdue, true);
  assert.equal(stale.ended, true);
  // The loaded range stopped at the end of June: nothing is late yet.
  const fair = only(detectRecurring(txs, { today: TODAY, until: '2026-06-30' }));
  assert.equal(fair.overdue, false);
  assert.equal(fair.ended, false);

  const recent = ['2026-07-01', '2026-08-03', '2026-09-01'].map((d) => mt940({ day: d, amount: -850, gvc: '117', text: 'DAUERAUFTRAG', name: 'Hausverwaltung', iban: IBAN.landlord }));
  assert.equal(only(detectRecurring(recent, { today: new Date(2026, 9, 6) })).overdue, false, 'five days of grace');
  const late = only(detectRecurring(recent, { today: new Date(2026, 9, 12) }));
  assert.equal(late.overdue, true);
  assert.equal(late.ended, false);
});

test('dismissed series stay dismissed, by a stable id', () => {
  const txs = ['2026-07-15', '2026-08-17', '2026-09-15'].map((d) => netflixMt940(d));
  const [s] = detectRecurring(txs, { today: TODAY });
  const again = detectRecurring(newestFirst(txs), { today: new Date(2026, 9, 10) });
  assert.equal(again[0].id, s.id, 'same id across calls and input order');
  assert.deepEqual(detectRecurring(txs, { today: TODAY, dismissed: [s.id] }), []);
  assert.equal(detectRecurring(txs, { today: TODAY, dismissed: ['rec_other'] }).length, 1);
});

test('categoryOf from the provider decides the category shown', () => {
  const txs = ['2026-07-15', '2026-08-17', '2026-09-15'].map((d) => netflixMt940(d));
  const rules = { [counterpartyKey(txs[0])]: 'leisure' as const };
  const categoryOf = (tx: SerializedTransaction) => categorize(tx, { ownIbans: OWN_IBANS, rules });
  assert.equal(only(detectRecurring(txs, { today: TODAY, categoryOf })).category, 'leisure');
});

test('nothing in, nothing out', () => {
  assert.deepEqual(detectRecurring([], { today: TODAY }), []);
  assert.deepEqual(detectRecurring([netflixMt940('2026-09-15')], { today: TODAY }), []);
  assert.deepEqual(upcoming([], { today: TODAY, days: 30 }), []);
  assert.deepEqual(recurringTotals([]), { monthlyExpense: 0, monthlyIncome: 0, yearlyExpense: 0, count: 0, currency: 'EUR' });
  assert.equal(cadenceLabel('yearly'), 'jährlich');
});

test('upcoming: the next booking of each live series within the window, soonest first', () => {
  const rent = (day: string) => mt940({ day, amount: -850, gvc: '117', text: 'DAUERAUFTRAG', name: 'Hausverwaltung', iban: IBAN.landlord });
  const salary = (day: string) => mt940({ day, amount: 2650, gvc: '153', text: 'LOHN/GEHALT', name: 'ACME GmbH', iban: IBAN.employer });
  const stale = ['2026-03-16', '2026-04-15', '2026-05-15'].map((d) => mt940({ day: d, amount: -9.99, gvc: '105', text: 'BASISLASTSCHRIFT', name: 'Old Abo', iban: 'DE02100100100006820101', cred: 'DE11ZZZ00000011111', mref: 'OLD' }));
  const txs = [
    ...['2026-07-15', '2026-08-17', '2026-09-15'].map((d) => netflixMt940(d)),
    ...['2026-07-01', '2026-08-03', '2026-09-01', '2026-10-01'].map(rent),
    ...['2026-07-31', '2026-08-31', '2026-09-30'].map(salary),
    ...stale,
  ];
  const series = detectRecurring(txs, { today: TODAY });
  assert.equal(series.length, 4);
  const next = upcoming(series, { today: TODAY, days: 30 });
  assert.deepEqual(next.map((n) => [n.series.name, n.date]), [
    ['Netflix International B.V.', '2026-10-15'],
    ['ACME GmbH', '2026-10-30'],
    ['Hausverwaltung', '2026-11-02'],
  ]);
  assert.deepEqual(upcoming(series, { today: TODAY, days: 14 }).map((n) => n.date), ['2026-10-15']);

  const totals = recurringTotals(series);
  assert.equal(totals.monthlyExpense, 862.99, 'the ended subscription is not a fixed cost any more');
  assert.equal(totals.monthlyIncome, 2650);
  assert.equal(totals.yearlyExpense, 10355.88);
  assert.equal(totals.count, 3);
});

// ---------------------------------------------------------------------------
// Sparse card spend over a year of history. Each fixture below is shaped like
// bookings the preview's thirteen months produced and the detector once took
// for a contract: two visits a quarter, half a year or a year apart that
// happened to cost about the same.
// ---------------------------------------------------------------------------

/** A girocard payment as MT940 carries it: GVC 106, the terminal's text as purpose. */
const girocard = (day: string, amount: number, name: string) =>
  mt940({ day, amount, gvc: '106', text: 'KARTENZAHLUNG', name, purpose: `${name}//MUSTERSTADT/DE ${day}T19:22:10 KFN 1 VJ 2912` });

/** A credit-card line as CAMT carries it on the card account. */
const creditCard = (day: string, amount: number, name: string, purpose: string) =>
  camt({ day, amount, code: 'CCRD', text: 'Kartenumsatz', name, purpose });

/** A PayPal purchase: one SEPA mandate for every shop, the tags run together. */
const paypalBuy = (day: string, amount: number, shop: string) =>
  mt940({
    day, amount, gvc: '105', text: 'BASISLASTSCHRIFT', name: 'PAYPAL EUROPE S.A.R.L. ET CIE S.C.A', iban: IBAN.paypal,
    bic: 'PPLXLUL2', cred: CRED.paypal, mref: '5RRJ2259NXZLLC', eref: `1038${day.replace(/-/g, '')} PP.4711.PP PAYPAL`,
    purpose: `PP.4711.PP . ${shop}, Ihr Einkauf bei ${shop}`, rawTags: true,
  });

const listed = (series: RecurringSeries[]) =>
  series.map((s) => `${s.name} ${s.cadenceLabel}${s.changed ? ` ${s.change}` : ''}`).join(', ');

test('false positive: "Sushi Yana vierteljährlich" — two dinners 91 days apart are not a contract', () => {
  const txs = [
    girocard('2025-10-06', -34.2, 'SUSHI YANA'), girocard('2025-11-14', -52.1, 'SUSHI YANA'),
    girocard('2026-01-05', -34.8, 'SUSHI YANA'), girocard('2026-03-20', -23.4, 'SUSHI YANA'),
    girocard('2026-05-04', -41.9, 'SUSHI YANA'),
  ];
  const found = detectRecurring(newestFirst(txs), { today: TODAY });
  assert.deepEqual(found, [], listed(found));
});

test('false positive: "Mcdonalds 1182 jährlich" — the same burger a year apart is not a contract', () => {
  const txs = [
    girocard('2025-09-12', -11.4, 'MCDONALDS 1182'), girocard('2025-12-05', -7.8, 'MCDONALDS 1182'),
    girocard('2026-02-20', -16.3, 'MCDONALDS 1182'), girocard('2026-06-12', -18.9, 'MCDONALDS 1182'),
    girocard('2026-09-11', -11.9, 'MCDONALDS 1182'),
  ];
  const found = detectRecurring(newestFirst(txs), { today: TODAY });
  assert.deepEqual(found, [], listed(found));
});

test('false positive: "Uber *Trip halbjährlich" — two rides half a year apart are not a contract', () => {
  const ride = (day: string, amount: number) => creditCard(day, amount, 'Uber *Trip', 'Uber *Trip help.uber.com NL');
  const txs = [ride('2025-11-21', -27.6), ride('2026-03-09', -14.2), ride('2026-05-15', -9.4), ride('2026-07-24', -33.1), ride('2026-09-07', -14.9)];
  const found = detectRecurring(newestFirst(txs), { today: TODAY });
  assert.deepEqual(found, [], listed(found));
});

test('false positive: "Paypal halbjährlich, Betrag gestiegen +1,18 €" — two shops, one mandate', () => {
  const txs = [
    paypalBuy('2025-10-20', -112.9, 'IKEA DEUTSCHLAND'), paypalBuy('2025-12-08', -24.99, 'THOMANN GMBH'),
    paypalBuy('2026-02-16', -61.2, 'ZALANDO SE'), paypalBuy('2026-04-27', -87.45, 'ZALANDO SE'),
    paypalBuy('2026-06-29', -41.1, 'IKEA DEUTSCHLAND'), paypalBuy('2026-08-17', -62.38, 'TCHIBO GMBH'),
  ];
  const found = detectRecurring(newestFirst(txs), { today: TODAY });
  assert.deepEqual(found, [], listed(found));
});

test('a year of sparse card spend, all of it together, yields nothing at all', () => {
  const ride = (day: string, amount: number) => creditCard(day, amount, 'Uber *Trip', 'Uber *Trip help.uber.com NL');
  const txs = [
    girocard('2025-10-06', -34.2, 'SUSHI YANA'), girocard('2026-01-05', -34.8, 'SUSHI YANA'), girocard('2026-03-20', -23.4, 'SUSHI YANA'),
    girocard('2025-09-12', -11.4, 'MCDONALDS 1182'), girocard('2026-02-20', -16.3, 'MCDONALDS 1182'), girocard('2026-09-11', -11.9, 'MCDONALDS 1182'),
    ride('2026-03-09', -14.2), ride('2026-05-15', -9.4), ride('2026-09-07', -14.9),
    paypalBuy('2026-02-16', -61.2, 'ZALANDO SE'), paypalBuy('2026-06-29', -41.1, 'IKEA DEUTSCHLAND'), paypalBuy('2026-08-17', -62.38, 'TCHIBO GMBH'),
  ];
  const found = detectRecurring(newestFirst(txs), { today: TODAY });
  assert.deepEqual(found, [], listed(found));
});

test('without a creditor ID or mandate, every rhythm needs three bookings and a steady amount', () => {
  // A quarterly transfer to a Kita: twice is a coincidence, three times a rhythm.
  const kita = (day: string, amount = -180) =>
    mt940({ day, amount, gvc: '116', text: 'ONLINE-UEBERWEISUNG', name: 'KITA SONNENSCHEIN E.V.', iban: 'DE02500105170137075030', purpose: 'Essensgeld' });
  assert.deepEqual(detectRecurring([kita('2026-04-15'), kita('2026-07-15')], { today: TODAY }), []);
  assert.equal(only(detectRecurring([kita('2026-01-15'), kita('2026-04-15'), kita('2026-07-15')], { today: TODAY })).cadence, 'quarterly');
  // Three that wander by more than 10 % are not a fixed price.
  assert.deepEqual(detectRecurring([kita('2026-01-15', -150), kita('2026-04-15', -180), kita('2026-07-15', -210)], { today: TODAY }), []);
  // A standing order is an arrangement the user made: twice, a year apart, is enough.
  const club = (day: string) =>
    mt940({ day, amount: -120, gvc: '117', text: 'DAUERAUFTRAG', name: 'TSV MUSTERSTADT 1860 E.V.', iban: 'DE12500105170648489811', purpose: 'Mitgliedsbeitrag' });
  assert.equal(only(detectRecurring([club('2025-03-03'), club('2026-03-02')], { today: TODAY })).cadence, 'yearly');
});

test('card payments at leisure, shopping and mobility count only at an identical price', () => {
  // A gym paid by card: the same 24,99 every month is a membership.
  const gym = (day: string, amount = -24.99) => girocard(day, amount, 'FITX STUDIO 0815');
  const s = only(detectRecurring(['2026-07-01', '2026-08-03', '2026-09-01'].map((d) => gym(d)), { today: TODAY }));
  assert.equal(s.category, 'leisure');
  assert.equal(s.cadence, 'monthly');
  // 24,99, 25,49 and 24,79 at the same place is a habit — however steady.
  const lunch = [gym('2026-07-01', -24.99), gym('2026-08-03', -25.49), gym('2026-09-01', -24.79)];
  assert.deepEqual(detectRecurring(lunch, { today: TODAY }), []);
});

test('true positives survive: insurance by direct debit, Kfz by mandate, Netflix by card', () => {
  // Quarterly insurance, two bookings, a creditor ID (no mandate on the statement).
  const hausrat = (day: string) =>
    mt940({ day, amount: -86.4, gvc: '105', text: 'BASISLASTSCHRIFT', name: 'HUK-COBURG ALLGEMEINE VERS. AG', iban: IBAN.insurer, cred: CRED.insurer, purpose: 'Beitrag Hausrat' });
  const q = only(detectRecurring([hausrat('2026-04-01'), hausrat('2026-07-01')], { today: new Date(2026, 8, 20) }));
  assert.equal(q.cadence, 'quarterly');
  assert.equal(q.count, 2);
  assert.equal(q.creditorId, CRED.insurer);
  assert.equal(q.nextDate, '2026-10-01');

  // Yearly Kfz-Versicherung, two bookings, a mandate reference only (CAMT without CRED in the purpose).
  const kfz = (day: string) =>
    camt({ day, amount: -412.37, code: 'ESDD', text: 'SEPA-Basislastschrift', name: 'ALLIANZ VERSICHERUNGS-AG', iban: IBAN.kfz, mref: 'KFZ-1', purpose: 'Kfz-Versicherung M-AB 1234' });
  const y = only(detectRecurring([kfz('2025-01-02'), kfz('2026-01-02')], { today: new Date(2026, 5, 1) }));
  assert.equal(y.cadence, 'yearly');
  assert.equal(y.creditorId, null);
  assert.equal(y.mandateReference, 'KFZ-1');
  assert.equal(y.category, 'insurance');

  // Netflix on the credit card: no mandate at all, but the same price three months running.
  const nf = (day: string) => creditCard(day, -13.99, 'NETFLIX.COM', 'NETFLIX.COM 866-579-7172 NL');
  const m = only(detectRecurring(['2026-07-08', '2026-08-10', '2026-09-08'].map(nf), { today: TODAY }));
  assert.equal(m.cadence, 'monthly');
  assert.equal(m.amount, -13.99);
  assert.equal(m.category, 'media');
  assert.equal(m.directDebit, false);
  assert.equal(m.nextDate, '2026-10-08');
  // Twice is not enough without a mandate.
  assert.deepEqual(detectRecurring(['2026-08-10', '2026-09-08'].map(nf), { today: TODAY }), []);
});

test('PayPal: a series is one shop at one steady price, never similar amounts at different shops', () => {
  // Three different shops a month apart, all about 30 € — not a subscription.
  const similar = [paypalBuy('2026-06-12', -30.1, 'ZALANDO SE'), paypalBuy('2026-07-13', -30.6, 'TCHIBO GMBH'), paypalBuy('2026-08-12', -30.9, 'IKEA DEUTSCHLAND')];
  assert.deepEqual(detectRecurring(similar, { today: TODAY }), [], listed(detectRecurring(similar, { today: TODAY })));

  // One shop every month at a different price — food delivery, not a contract.
  const food = ['2026-06-05', '2026-07-06', '2026-08-05', '2026-09-04'].map((d, i) => paypalBuy(d, -[23.4, 31.8, 27.1, 19.9][i], 'LIEFERANDO.DE'));
  assert.deepEqual(detectRecurring(food, { today: TODAY }), []);

  // The subscription inside survives, even beside a one-off at almost its price.
  const txs = [
    ...['2026-06-22', '2026-07-22', '2026-08-24', '2026-09-22'].map((d) => paypalBuy(d, -9.99, 'Spotify AB')),
    paypalBuy('2026-08-25', -10.49, 'Kiosk Online'),
    ...food,
  ];
  const s = only(detectRecurring(newestFirst(txs), { today: TODAY }));
  assert.equal(s.amount, -9.99);
  assert.equal(s.count, 4);
  assert.equal(s.changed, false);
  assert.equal(s.cadence, 'monthly');
  assert.equal(s.nextDate, '2026-10-22');
  assert.equal(s.name, 'Spotify AB');
});

test('unseenCadences: what a history of that length cannot be relied on to show', () => {
  assert.deepEqual(unseenCadences(91), ['quarterly', 'halfyearly', 'yearly']);
  assert.deepEqual(unseenCadences(182), ['halfyearly', 'yearly']);
  assert.deepEqual(unseenCadences(366), ['yearly'], 'a year holds one insurance premium, not two');
  assert.deepEqual(unseenCadences(730), []);
  assert.deepEqual(unseenCadences(Number.NaN), ['quarterly', 'halfyearly', 'yearly']);
});

test('recurringGroups: rent apart from subscriptions, each with its own figures', () => {
  const stub = (p: Partial<RecurringSeries>): RecurringSeries => ({
    kind: 'expense', ended: false, currency: 'EUR', category: 'other', monthlyAmount: 0, yearlyAmount: 0, ...p,
  } as RecurringSeries);
  const series = [
    stub({ id: 'rent', category: 'housing', monthlyAmount: -1090, yearlyAmount: -13080 }),
    stub({ id: 'power', category: 'housing', monthlyAmount: -78, yearlyAmount: -936 }),
    stub({ id: 'netflix', category: 'media', monthlyAmount: -15.99, yearlyAmount: -191.88 }),
    stub({ id: 'gym', category: 'leisure', monthlyAmount: -29.9, yearlyAmount: -358.8 }),
    stub({ id: 'plan', category: 'savings', monthlyAmount: -100, yearlyAmount: -1200 }),
    stub({ id: 'gone', category: 'media', monthlyAmount: -9.99, yearlyAmount: -119.88, ended: true }),
    stub({ id: 'salary', kind: 'income', category: 'income', monthlyAmount: 2650, yearlyAmount: 31800 }),
    stub({ id: 'usd', category: 'media', currency: 'USD', monthlyAmount: -5, yearlyAmount: -60 }),
  ];
  const groups = recurringGroups(series, 'EUR');
  assert.deepEqual(groups.map((g) => [g.id, g.label, g.series.map((s) => s.id), g.monthly, g.yearly]), [
    ['housing', 'Wohnen & Energie', ['rent', 'power'], 1168, 14016],
    ['media', 'Abos & Medien', ['netflix', 'usd'], 15.99, 191.88],
    ['other', 'Weitere Verträge', ['gym'], 29.9, 358.8],
    ['savings', 'Sparen & Anlegen', ['plan'], 100, 1200],
  ]);
  const all = recurringTotals(series.filter((s) => s.kind === 'expense'), 'EUR');
  assert.equal(Math.round(groups.reduce((sum, g) => sum + g.monthly * 100, 0)) / 100, all.monthlyExpense, 'the groups add up to the whole');
});
