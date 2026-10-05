import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterStatementRead, pendingView, unbookedPending } from './pending.ts';
import type { SerializedTransaction } from './fints-types';

/** JSON of a local calendar day — what the wire carries for a booking date. */
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d).toISOString();

const tx = (over: Partial<SerializedTransaction> = {}): SerializedTransaction => ({
  valueDate: day(2026, 10, 5),
  entryDate: day(2026, 10, 5),
  amount: -120,
  currency: 'EUR',
  purpose: 'Abschlag Strom',
  bookingText: 'LASTSCHRIFT',
  remoteName: 'Stadtwerke Musterstadt',
  remoteIban: 'DE02120300000000202051',
  remoteBic: '',
  e2eReference: 'ABS-2026-10-4711',
  mandateReference: 'M-1',
  customerReference: '',
  bankReference: '',
  transactionCode: '105',
  primeNotesNr: '',
  textKeyExtension: '',
  additionalInformation: '',
  statementNumber: '',
  ...over,
});

test('a Vormerkposten the statement now lists as booked is gone', () => {
  const pending = [tx()];
  const booked = [tx({ bankReference: 'B-991' }), tx({ remoteName: 'REWE', remoteIban: '', e2eReference: '', amount: -12.9 })];
  assert.deepEqual(unbookedPending(pending, booked), []);
});

test('nothing booked: the very same array comes back', () => {
  const pending = [tx(), tx({ amount: -9.99, e2eReference: 'NF-1', remoteName: 'Netflix' })];
  assert.equal(unbookedPending(pending, []), pending);
  assert.equal(unbookedPending(pending, [tx({ amount: -1, e2eReference: '' })]), pending);
});

test('a card payment booked days later is matched by its end-to-end reference', () => {
  const card = tx({
    entryDate: day(2026, 10, 1), valueDate: day(2026, 10, 1), amount: -54.3,
    remoteName: 'Tankstelle', remoteIban: '', e2eReference: 'CARD-88123',
  });
  const booking = { ...card, entryDate: day(2026, 10, 3), valueDate: day(2026, 10, 1) };
  assert.deepEqual(unbookedPending([card], [booking]), []);
});

test('the same reference a month earlier is the last instalment, not this one', () => {
  // A debit whose creditor reuses one reference every month.
  const now = tx({ e2eReference: 'MIETE', entryDate: day(2026, 11, 1), valueDate: day(2026, 11, 1) });
  const lastMonth = tx({ e2eReference: 'MIETE', entryDate: day(2026, 10, 1), valueDate: day(2026, 10, 1) });
  assert.deepEqual(unbookedPending([now], [lastMonth]), [now]);
});

test('a reference match needs the same amount and IBAN', () => {
  const p = tx({ entryDate: day(2026, 10, 2) });
  assert.equal(unbookedPending([p], [tx({ amount: -121 })]).length, 1);
  assert.equal(unbookedPending([p], [tx({ remoteIban: 'DE89370400440532013000' })]).length, 1);
});

test('"NOTPROVIDED" is no reference and matches nothing by itself', () => {
  const p = tx({ e2eReference: 'NOTPROVIDED', entryDate: day(2026, 10, 2) });
  const b = tx({ e2eReference: 'NOTPROVIDED', entryDate: day(2026, 10, 4) });
  assert.equal(unbookedPending([p], [b]).length, 1);
});

test('one booking accounts for one Vormerkposten only', () => {
  const coffee = () => tx({ amount: -3.2, remoteName: 'Café', remoteIban: '', e2eReference: '', bookingText: 'KARTENZAHLUNG' });
  const a = coffee();
  const b = coffee();
  const left = unbookedPending([a, b], [coffee()]);
  assert.equal(left.length, 1);
  assert.equal(left[0], b);
});

// ---------------------------------------------------------------------------
// Two sources: on request (HKVMK) and with the Umsätze (HIKAZ/HICAZ)

/** Epoch ms of a local moment on 5 October 2026. */
const at = (h: number, min = 0) => new Date(2026, 9, 5, h, min).getTime();

test('afterStatementRead: a sent list replaces the last one', () => {
  const prev = { txs: [tx()], loadedAt: at(8) };
  assert.deepEqual(afterStatementRead(prev, [], true, at(9)), { txs: [], loadedAt: at(9) });
  const sent = [tx({ amount: -5 })];
  assert.deepEqual(afterStatementRead(undefined, sent, false, at(9)), { txs: sent, loadedAt: at(9) });
});

test('afterStatementRead: nothing sent up to today means nothing vorgemerkt — once a list ever came', () => {
  const prev = { txs: [tx()], loadedAt: at(8) };
  assert.deepEqual(afterStatementRead(prev, undefined, true, at(9)), { txs: [], loadedAt: at(9) });
  // A bank that never sends a list keeps having none.
  assert.equal(afterStatementRead(undefined, undefined, true, at(9)), undefined);
});

test('afterStatementRead: a past range says nothing about today', () => {
  const prev = { txs: [tx()], loadedAt: at(8) };
  assert.equal(afterStatementRead(prev, undefined, false, at(9)), prev);
});

test('afterStatementRead: an unreadable list says nothing at all — the last one stands, as old as it is', () => {
  const prev = { txs: [tx()], loadedAt: at(8) };
  assert.equal(afterStatementRead(prev, null, true, at(9)), prev);
  assert.equal(afterStatementRead(undefined, null, true, at(9)), undefined);
});

test('pendingView: a list read with the statement is taken as the bank sorted it', () => {
  // Two identical card payments; the bank booked one and lists the other as vorgemerkt.
  const coffee = () => tx({ amount: -3.2, remoteName: 'Café', remoteIban: '', e2eReference: '', bookingText: 'KARTENZAHLUNG' });
  const noted = { txs: [coffee()], loadedAt: at(9) };
  const view = pendingView({ noted }, { loadedAt: at(9), to: '2026-10-05', booked: [coffee()] });
  assert.equal(view?.txs, noted.txs);
  assert.equal(view?.behindStatement, false);
  assert.equal(view?.booked, 0);
});

test('pendingView: a list older than a statement reaching its day loses what that shows as booked', () => {
  const noted = { txs: [tx(), tx({ amount: -9.99, e2eReference: 'NF-1', remoteName: 'Netflix' })], loadedAt: at(8) };
  const view = pendingView({ noted }, { loadedAt: at(12), to: '2026-10-05', booked: [tx({ bankReference: 'B-1' })] });
  assert.deepEqual(view?.txs.map((t) => t.remoteName), ['Netflix']);
  assert.equal(view?.behindStatement, true);
  assert.equal(view?.booked, 1);
});

test('pendingView: a later statement of a past range leaves the list alone', () => {
  const noted = { txs: [tx()], loadedAt: at(8) };
  const view = pendingView({ noted }, { loadedAt: at(12), to: '2026-09-30', booked: [tx()] });
  assert.equal(view?.txs, noted.txs);
  assert.equal(view?.behindStatement, false);
});

test('pendingView: on request and with the Umsätze — the first adds only what the second lacks', () => {
  const netflix = tx({ amount: -9.99, e2eReference: 'NF-1', remoteName: 'Netflix' });
  const noted = { txs: [tx()], loadedAt: at(9) };
  const fetched = { txs: [tx(), netflix], loadedAt: at(10) };
  const view = pendingView({ noted, fetched }, { loadedAt: at(9), to: '2026-10-05', booked: [] });
  assert.deepEqual(view?.txs.map((t) => t.remoteName), ['Stadtwerke Musterstadt', 'Netflix']);
  // As fresh as the older list whose rows are shown; read last at 10.
  assert.equal(view?.loadedAt, at(9));
  assert.equal(view?.readAt, at(10));
});

test('pendingView: an empty list on request never hides the one sent with the Umsätze, nor vouches for it', () => {
  const noted = { txs: [tx()], loadedAt: at(9) };
  const view = pendingView({ noted, fetched: { txs: [], loadedAt: at(10) } }, undefined);
  assert.equal(view?.txs, noted.txs);
  assert.equal(view?.loadedAt, at(9));
  assert.equal(view?.readAt, at(10));
});

test('pendingView: an older list on request with nothing to add does not age the one read with the statement', () => {
  const noted = { txs: [tx()], loadedAt: at(12) };
  const fetched = { txs: [tx()], loadedAt: at(8) };
  const view = pendingView({ noted, fetched }, { loadedAt: at(12), to: '2026-10-05', booked: [] });
  assert.equal(view?.txs, noted.txs);
  assert.equal(view?.loadedAt, at(12));
  assert.equal(view?.behindStatement, false);
});

test('pendingView: the same card payment from MT942 (local midnight) and camt (local noon) is listed once', () => {
  const card = (entryDate: string, name: string) => tx({
    entryDate, valueDate: entryDate, amount: -54.3, remoteName: name, remoteIban: '', e2eReference: 'NOTPROVIDED', bookingText: 'KARTENZAHLUNG',
  });
  // MT942 names the day only, camt a noon; MT942 also cuts the name short.
  const fromMt942 = card(new Date(2026, 9, 5).toISOString(), 'ARAL TANKSTELLE MUSTERST');
  const fromCamt = card(new Date(2026, 9, 5, 12).toISOString(), 'ARAL Tankstelle Musterstadt');
  const view = pendingView(
    { noted: { txs: [fromCamt], loadedAt: at(9) }, fetched: { txs: [fromMt942], loadedAt: at(10) } },
    undefined,
  );
  assert.equal(view?.txs.length, 1);
  // Two such payments on request, one in the other list: the second still shows.
  const both = pendingView(
    { noted: { txs: [fromCamt], loadedAt: at(9) }, fetched: { txs: [fromMt942, fromMt942], loadedAt: at(10) } },
    undefined,
  );
  assert.equal(both?.txs.length, 2);
});

test('pendingView: a different amount or counterparty is a different Vormerkposten', () => {
  const noted = { txs: [tx()], loadedAt: at(9) };
  const other = tx({ e2eReference: '', remoteIban: 'DE89370400440532013000' });
  const more = tx({ e2eReference: '', amount: -121 });
  const view = pendingView({ noted, fetched: { txs: [other, more], loadedAt: at(10) } }, undefined);
  assert.equal(view?.txs.length, 3);
});

test('pendingView: no list from either source, no view', () => {
  assert.equal(pendingView({}, undefined), undefined);
  const fetched = { txs: [tx()], loadedAt: at(8) };
  assert.equal(pendingView({ fetched }, undefined)?.txs, fetched.txs);
});
