import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SerializedTransaction } from './fints-types';
import {
  belowLimit, dearerCharge, isIncome, mergeWatch, readLimit, readWatch, watchOf,
  type WatchedContract,
} from './payment-alerts.ts';
import { detectRecurring, seriesBase, seriesIdentity } from './recurring.ts';

function tx(day: string, amount: number, name: string, extra: Partial<Record<string, string>> = {}): SerializedTransaction {
  return {
    valueDate: `${day}T00:00:00.000Z`, entryDate: `${day}T00:00:00.000Z`, amount, currency: 'EUR',
    purpose: '', bookingText: '', remoteName: name, remoteIban: '', remoteBic: '', creditorId: '', ultimateName: '',
    e2eReference: '', mandateReference: '', customerReference: '', bankReference: '', transactionCode: '',
    primeNotesNr: '', textKeyExtension: '', additionalInformation: '', statementNumber: '',
    ...extra,
  } as unknown as SerializedTransaction;
}

const NETFLIX = { creditorId: 'DE98ZZZ09999999999', mandateReference: 'NFX-4711', bookingText: 'FOLGELASTSCHRIFT' };
const netflix = (day: string, amount: number) => tx(day, amount, 'Netflix International B.V.', NETFLIX);
const keyOf = (t: SerializedTransaction) => seriesIdentity(t).key!;
const contract = (t: SerializedTransaction, cents: number, extra: Partial<WatchedContract> = {}): WatchedContract => ({
  key: keyOf(t), name: 'Netflix International B.V.', cents, at: '2026-11-01', ...extra,
});

test('seriesIdentity names a booking as Verträge & Abos groups it', () => {
  const series = detectRecurring(
    [netflix('2026-08-03', -12.99), netflix('2026-09-03', -12.99), netflix('2026-10-03', -12.99)],
    { today: new Date('2026-10-10') },
  );
  assert.equal(series.length, 1);
  assert.equal(seriesBase(series[0].key), keyOf(netflix('2026-11-03', -13.99)));
  // An amount cluster's or a shop's suffix is not part of the identity.
  assert.equal(seriesBase('out|iban:DE02120300000000202051|amt:13'), 'out|iban:DE02120300000000202051');
  assert.equal(seriesBase('out|cred:X|mref:Y|amt:13|shop:NETFLIX'), 'out|cred:X|mref:Y');
});

test('dearerCharge: more than 1 % and 0,50 € above the usual price, below twice it', () => {
  const watched = [contract(netflix('2026-10-03', -12.99), 1299)];
  assert.deepEqual(dearerCharge(watched, netflix('2026-11-03', -13.99))?.cents, 1399);
  // The usual price, a few cents more, a refund, an unrelated payment: nothing.
  assert.equal(dearerCharge(watched, netflix('2026-11-03', -12.99)), null);
  assert.equal(dearerCharge(watched, netflix('2026-11-03', -13.30)), null);
  assert.equal(dearerCharge(watched, netflix('2026-11-03', 13.99)), null);
  assert.equal(dearerCharge(watched, tx('2026-11-03', -20, 'REWE')), null);
  // Another mandate at the same creditor is another contract.
  assert.equal(dearerCharge(watched, tx('2026-11-03', -20, 'Netflix', { ...NETFLIX, mandateReference: 'NFX-9' })), null);
  // Twice the price or more is another charge, not a price increase.
  assert.equal(dearerCharge(watched, netflix('2026-11-03', -25.98)), null);
});

test('dearerCharge: of two prices under one mandate, the nearest one is judged', () => {
  const t = tx('2026-11-01', -85, 'Stadtwerke', { creditorId: 'DE11ZZZ00000000001', mandateReference: 'STROM-1' });
  const watched = [contract(t, 8000, { name: 'Stadtwerke' }), contract(t, 25000, { name: 'Stadtwerke' })];
  assert.equal(dearerCharge(watched, t)?.contract.cents, 8000);
  assert.equal(dearerCharge(watched, { ...t, amount: -260 } as SerializedTransaction)?.contract.cents, 25000);
  // Nearer to the settlement and below it: no increase of either.
  assert.equal(dearerCharge(watched, { ...t, amount: -170 } as SerializedTransaction), null);
});

test('dearerCharge: a payment facilitator\u2019s booking counts only for its own shop', () => {
  const via = (shop: string, amount: number) => tx('2026-11-02', amount, 'PayPal Europe S.a.r.l. et Cie S.C.A', {
    creditorId: 'LU96ZZZ0000000000000000058', mandateReference: 'PP-MANDATE', purpose: `PP.1234.PP . Ihr Einkauf bei ${shop}`,
  });
  const watched = [contract(via('Spotify', -9.99), 999, { shop: seriesIdentity(via('Spotify', -9.99)).shop!, name: 'Spotify' })];
  assert.equal(dearerCharge(watched, via('Spotify', -10.99))?.cents, 1099);
  assert.equal(dearerCharge(watched, via('Zalando', -10.99)), null);
});

test('isIncome: the bank\u2019s salary text, or a watched regular income', () => {
  assert.equal(isIncome([], tx('2026-11-01', 2500, 'ACME GmbH', { bookingText: 'LOHN/GEHALT' })), true);
  const rent = tx('2026-11-01', 650, 'Max Mieter', { remoteIban: 'DE02120300000000202051' });
  assert.equal(isIncome([], rent), false);
  assert.equal(isIncome([{ key: keyOf(rent), at: '2026-11-01' }], rent), true);
  // Money out is never income, whatever the text says.
  assert.equal(isIncome([], tx('2026-11-01', -2500, 'ACME GmbH', { bookingText: 'LOHN/GEHALT' })), false);
});

test('watchOf: fixed-price contracts and every income; ended and hidden series dropped', () => {
  const history = [
    netflix('2026-07-03', -12.99), netflix('2026-08-03', -12.99), netflix('2026-09-03', -12.99), netflix('2026-10-03', -12.99),
    ...['07', '08', '09', '10'].map((m) => tx(`2026-${m}-28`, 2500, 'ACME GmbH', { bookingText: 'LOHN/GEHALT', remoteIban: 'DE89370400440532013000' })),
    ...[41.2, 57.9, 33.1, 64.5].map((a, i) => tx(['2026-07-15', '2026-08-15', '2026-09-15', '2026-10-15'][i], -a, 'Telefonica', {
      creditorId: 'DE22ZZZ00000000002', mandateReference: 'TEL-1', bookingText: 'FOLGELASTSCHRIFT',
    })),
  ];
  const series = detectRecurring(history, { today: new Date('2026-10-20') });
  const live = series.filter((s) => !s.ended);
  const w = watchOf(live, [], '2026-10-20');
  assert.deepEqual(w.contracts.map((c) => [c.name, c.cents]), [['Netflix International B.V.', 1299]]);
  assert.equal(w.income.length, 1);
  assert.deepEqual(w.drop, []);
  // Hidden: its identity goes, unless a live series shares it.
  const gone = live.filter((s) => s.kind === 'expense' && !s.variable);
  assert.deepEqual(watchOf([], gone, '2026-10-20').drop, [seriesBase(gone[0].key)]);
  assert.deepEqual(watchOf(gone, gone, '2026-10-20').drop, []);
});

test('mergeWatch: what is named now replaces, the rest waits 120 days, dropped goes', () => {
  const now = Date.parse('2026-11-06T12:00:00Z');
  const a = { key: 'out|cred:A|mref:1', name: 'A', cents: 1000, at: '2026-11-01' };
  const b = { key: 'out|cred:B|mref:1', name: 'B', cents: 2000, at: '2026-08-01' };
  const old = { key: 'out|cred:C|mref:1', name: 'C', cents: 3000, at: '2026-06-01' };
  const prior = { contracts: [a, b, old], income: [{ key: 'in|iban:X', at: '2026-06-01' }] };
  const merged = mergeWatch(prior, { contracts: [{ ...a, cents: 1100, at: '2026-11-06' }], income: [], drop: ['out|cred:B|mref:1'] }, now);
  assert.deepEqual(merged.contracts.map((c) => [c.key, c.cents]), [['out|cred:A|mref:1', 1100]]);
  assert.deepEqual(merged.income, []);
});

test('readWatch and readLimit keep only what makes sense', () => {
  const w = readWatch({
    contracts: [
      { key: 'out|cred:A', name: 'A\u2028B', cents: 999, at: '2026-11-01' },
      { key: 'out|cred:B', name: 'B', cents: -5, at: '2026-11-01' },
      { key: 'out|cred:C', name: 'C', cents: 1.5, at: '2026-11-01' },
      { key: 'out|\u0000', name: 'D', cents: 100, at: '2026-11-01' },
      { key: 'out|cred:E', name: 'E', cents: 100, at: 'yesterday' },
      'nonsense',
    ],
    income: [{ key: 'in|iban:X', at: '2026-11-01' }, { key: 7, at: '2026-11-01' }],
  });
  assert.deepEqual(w.contracts, [{ key: 'out|cred:A', name: 'A B', cents: 999, at: '2026-11-01' }]);
  assert.deepEqual(w.income, [{ key: 'in|iban:X', at: '2026-11-01' }]);
  assert.deepEqual(readLimit({ cents: -50000, label: 'Girokonto' }), { cents: -50000, label: 'Girokonto' });
  assert.equal(readLimit({ cents: 10.5 }), null);
  assert.equal(readLimit({ cents: 1e12 }), null);
});

test('belowLimit: under the limit in cents; nothing to tell without a limit or a balance', () => {
  assert.equal(belowLimit({ cents: 10000, label: '' }, 99.99), true);
  assert.equal(belowLimit({ cents: 10000, label: '' }, 100), false);
  assert.equal(belowLimit({ cents: -50000, label: '' }, -600), true);
  assert.equal(belowLimit(undefined, 5), null);
  assert.equal(belowLimit({ cents: 100, label: '' }, null), null);
});

test('reminders: a vault replaces only its own list, an empty one clears it, past ones go', () => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  const prior = readWatch({
    contracts: [], income: [],
    reminders: [
      { owner: 'a|1', id: 'gym', by: '2026-11-10', lead: 7, name: 'FitX', told: '2026-11-10' },
      { owner: 'a|1', id: 'gone', by: '2026-12-10', lead: 30, name: 'Weg' },
      { owner: 'b|2', id: 'tv', by: '2026-11-20', lead: 14, name: 'TV' },
      { owner: 'b|2', id: 'old', by: '2026-10-20', lead: 14, name: 'Alt' },
      { owner: 'b|2', id: 'bad', by: '2026-11-31', lead: 14, name: 'x' },
    ],
  });
  assert.equal(prior.reminders?.length, 4, 'a day that does not exist is not kept');
  const next = mergeWatch(prior, {
    contracts: [], income: [], owner: 'a|1',
    reminders: [{ owner: 'ignored', id: 'gym', by: '2026-11-10', lead: 14, name: 'FitX', told: '2099-01-01' }],
  }, now);
  assert.deepEqual(next.reminders, [
    { owner: 'a|1', id: 'gym', by: '2026-11-10', lead: 14, name: 'FitX', told: '2026-11-10' },
    { owner: 'b|2', id: 'tv', by: '2026-11-20', lead: 14, name: 'TV' },
  ]);
  const cleared = mergeWatch(next, { contracts: [], income: [], owner: 'b|2', reminders: [] }, now);
  assert.deepEqual(cleared.reminders?.map((r) => r.id), ['gym']);
  assert.deepEqual(mergeWatch(cleared, { contracts: [], income: [] }, now).reminders?.map((r) => r.id), ['gym'], 'no owner: nothing handed over');
});
