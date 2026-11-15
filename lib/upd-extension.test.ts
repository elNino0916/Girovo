import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'lib-fints';
// @ts-expect-error lib-fints keeps the decoder's types under dist/types, not beside this path.
import { decode } from '../node_modules/lib-fints/dist/segment.js';
import { balanceFromUpdExtension, withoutExtensions } from './upd-extension.ts';

// The example of FinTS 3.0 Formals (2017-10-06), Abbildung 15, as JSON.
const SPEC = JSON.stringify({
  Ver: '01.00',
  AcctBal: {
    Cur: 'EUR',
    CurValBal: { DebCrd: 'D', Val: '1476,98', Date: 20151124, Time: '021533' },
    InclPendTransBal: { DebCrd: 'D', Val: '1476,98', Date: 20151124, Time: '063825' },
    OverDraftLim: '5000,00',
    AvailFunds: '1000,00',
  },
  BalComplete: true,
});

test('the spec\'s example: a debit balance, dated in UTC+01:00', () => {
  const b = balanceFromUpdExtension(SPEC)!;
  assert.equal(b.balance, -1476.98);
  assert.equal(b.currency, 'EUR');
  assert.equal(b.date, '2015-11-24T01:15:33.000Z');
  assert.equal(b.availableAmount, 1000);
  assert.equal(b.creditLimit, 5000);
  assert.equal(b.notedBalance, -1476.98);
});

test('a credit balance and thousands separators', () => {
  const raw = JSON.stringify({ Ver: '01.00', AcctBal: { Cur: 'EUR', CurValBal: { DebCrd: 'C', Val: '12.345,60', Date: 20261114 } } });
  const b = balanceFromUpdExtension(raw)!;
  assert.equal(b.balance, 12345.6);
  assert.equal(b.date, '2026-11-13T23:00:00.000Z');
  const dot = JSON.stringify({ Ver: '01.00', AcctBal: { CurValBal: { DebCrd: 'C', Val: '1476.98', Date: 20261114 } } });
  assert.equal(balanceFromUpdExtension(dot)!.balance, 1476.98);
});

test('no balance where the extension holds none', () => {
  assert.equal(balanceFromUpdExtension(undefined), null);
  assert.equal(balanceFromUpdExtension(''), null);
  assert.equal(balanceFromUpdExtension('{"umsltzt": "2014-11-24-15.06.38.253985"}'), null);
  assert.equal(balanceFromUpdExtension('{"Ver": "01.00", "BIC": "SSKMDEMM"}'), null);
  assert.equal(balanceFromUpdExtension('not json'), null);
  assert.equal(balanceFromUpdExtension('[1,2]'), null);
  assert.equal(balanceFromUpdExtension(JSON.stringify({ Ver: '01.00', AcctBal: { CurValBal: { DebCrd: 'C', Val: 'abc', Date: 20261114 } } })), null);
  assert.equal(balanceFromUpdExtension(JSON.stringify({ Ver: '01.00', AcctBal: { CurValBal: { DebCrd: 'C', Val: '1,00', Date: 2026111 } } })), null);
});

test('lib-fints decodes the extension of an HIUPD padded as FinTS asks', () => {
  // The unused repetitions of "Erlaubte Geschäftsvorfälle" (0..999) stand as empty elements before the extension.
  const ext = '{"Ver"?:"01.00","AcctBal"?:{"Cur"?:"EUR","CurValBal"?:{"DebCrd"?:"C","Val"?:"1476,98","Date"?:20261114}}}';
  const tx = ['HKSAK:1', 'HKCCS:1'];
  const raw = 'HIUPD:5:6:4+1234567::280:12345678+DE02120300000000202051+9999999999+70+EUR+Max Mustermann++Bausparen++'
    + [...tx, ...Array(999 - tx.length).fill('')].join('+') + '+' + ext + "'";
  const seg = decode(raw) as { accountExtension?: string; allowedTransactions?: Array<{ transId: string } | undefined> };
  assert.deepEqual(seg.allowedTransactions?.filter(Boolean).map((t) => t!.transId), ['HKSAK', 'HKCCS']);
  assert.equal(balanceFromUpdExtension(seg.accountExtension)!.balance, 1476.98);
});

test('withoutExtensions: the device profile keeps no account list figures', () => {
  const info = { upd: { version: 1, usage: 0, bankAccounts: [{ accountNumber: '1', extension: '{"Ver":"01.00"}' }, { accountNumber: '2' }] } };
  const out = withoutExtensions(info as never) as unknown as typeof info;
  assert.deepEqual(out.upd.bankAccounts, [{ accountNumber: '1' }, { accountNumber: '2' }]);
  assert.equal((info.upd.bankAccounts[0] as { extension?: string }).extension, '{"Ver":"01.00"}');
  const plain = { upd: { bankAccounts: [{ accountNumber: '3' }] } };
  assert.equal(withoutExtensions(plain as never), plain);
});
