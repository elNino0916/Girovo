import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEpcPayload, EPC_MAX_BYTES, parseEpcPayload } from './girocode.ts';

// A valid IBAN (the Bundesbank's documented example) and a few more for variety.
const IBAN = 'DE02120300000000202051';
const IBAN_AT = 'AT611904300234573201';
const BIC = 'BYLADEM1001';

const bytes = (s: string) => new TextEncoder().encode(s).length;

test('builds the exact EPC069-12 v002 layout', () => {
  const p = buildEpcPayload({ name: 'Max Mustermann', iban: IBAN, bic: BIC, amount: 12.5, purpose: 'Miete Oktober' });
  assert.equal(p, ['BCD', '002', '1', 'SCT', BIC, 'Max Mustermann', IBAN, 'EUR12.50', '', '', 'Miete Oktober'].join('\n'));
  assert.ok(!p.includes('\r'));
  assert.ok(!p.endsWith('\n'));
});

test('ends at the last populated element', () => {
  assert.equal(
    buildEpcPayload({ name: 'Max', iban: IBAN, amount: 5 }),
    ['BCD', '002', '1', 'SCT', '', 'Max', IBAN, 'EUR5.00'].join('\n'),
  );
  assert.equal(buildEpcPayload({ name: 'Max', iban: IBAN }), ['BCD', '002', '1', 'SCT', '', 'Max', IBAN].join('\n'));
  // No amount but a purpose: the amount line stays, empty, so the purpose keeps its position.
  assert.equal(
    buildEpcPayload({ name: 'Max', iban: IBAN, amount: null, purpose: 'Danke' }),
    ['BCD', '002', '1', 'SCT', '', 'Max', IBAN, '', '', '', 'Danke'].join('\n'),
  );
});

test('normalises IBAN and BIC, and keeps a field on its own line', () => {
  const p = buildEpcPayload({ name: '  Max\nMuster\tmann ', iban: 'de02 1203 0000 0000 2020 51', bic: 'byla dem1 001', purpose: 'Zeile 1\r\nZeile 2 Ende' });
  const lines = p.split('\n');
  assert.equal(lines.length, 11);
  assert.equal(lines[4], BIC);
  assert.equal(lines[5], 'Max Muster mann');
  assert.equal(lines[6], IBAN);
  assert.equal(lines[10], 'Zeile 1 Zeile 2 Ende');
});

test('formats amounts with a point, two decimals and no grouping', () => {
  const amountLine = (amount: number) => buildEpcPayload({ name: 'X', iban: IBAN, amount }).split('\n')[7];
  assert.equal(amountLine(0.01), 'EUR0.01');
  assert.equal(amountLine(1234.5), 'EUR1234.50');
  assert.equal(amountLine(999999999.99), 'EUR999999999.99');
  assert.equal(amountLine(0.1 + 0.2), 'EUR0.30'); // 0.30000000000000004
  assert.equal(amountLine(19.99), 'EUR19.99');
});

test('refuses invalid input with a German message', () => {
  const bad = (input: Parameters<typeof buildEpcPayload>[0], re: RegExp) =>
    assert.throws(() => buildEpcPayload(input), (e: unknown) => e instanceof Error && re.test(e.message));
  bad({ name: '  ', iban: IBAN }, /Namen des Empfängers/);
  bad({ name: 'x'.repeat(71), iban: IBAN }, /höchstens 70 Zeichen/);
  bad({ name: 'Max', iban: 'DE02120300000000202052' }, /IBAN ist ungültig/);
  bad({ name: 'Max', iban: '' }, /IBAN ist ungültig/);
  bad({ name: 'Max', iban: IBAN, bic: 'NOTABIC' }, /BIC ist ungültig/);
  bad({ name: 'Max', iban: IBAN, amount: 0 }, /zwischen 0,01 €/);
  bad({ name: 'Max', iban: IBAN, amount: -5 }, /zwischen 0,01 €/);
  bad({ name: 'Max', iban: IBAN, amount: 1e9 }, /zwischen 0,01 €/);
  bad({ name: 'Max', iban: IBAN, amount: 12.345 }, /zwei Nachkommastellen/);
  bad({ name: 'Max', iban: IBAN, amount: Number.NaN }, /keine gültige Zahl/);
  bad({ name: 'Max', iban: IBAN, purpose: 'y'.repeat(141) }, /höchstens 140 Zeichen/);
  // 70 + 140 two-byte characters: every element within its own limit, the whole too big.
  bad({ name: 'ü'.repeat(70), iban: IBAN, amount: 1, purpose: 'ö'.repeat(140) }, /zu lang für einen GiroCode/);
});

test('counts characters, not UTF-16 units or bytes, against the element limits', () => {
  const name = 'Ä'.repeat(70);
  const p = buildEpcPayload({ name, iban: IBAN });
  assert.equal(p.split('\n')[5], name);
  // A 140-character purpose of plain text fits alongside a 70-character name.
  const full = buildEpcPayload({ name: 'N'.repeat(70), iban: IBAN_AT, bic: BIC, amount: 999999999.99, purpose: 'P'.repeat(140) });
  assert.ok(bytes(full) <= EPC_MAX_BYTES);
});

test('accepts a payload of exactly the byte limit', () => {
  // Header and fixed elements, then fill the purpose with two-byte characters up to 331 bytes.
  const base = buildEpcPayload({ name: 'Ü'.repeat(70), iban: IBAN, amount: 1, purpose: 'a' });
  const room = EPC_MAX_BYTES - bytes(base) + 1; // bytes available for the purpose
  const purpose = 'é'.repeat(Math.floor(room / 2)) + (room % 2 ? 'a' : '');
  const p = buildEpcPayload({ name: 'Ü'.repeat(70), iban: IBAN, amount: 1, purpose });
  assert.equal(bytes(p), EPC_MAX_BYTES);
  assert.throws(() => buildEpcPayload({ name: 'Ü'.repeat(70), iban: IBAN, amount: 1, purpose: purpose + 'a' }));
});

test('parses what it builds', () => {
  const cases = [
    { name: 'Jürgen Müller-Lüdenscheidt', iban: IBAN, bic: BIC, amount: 1234.56, purpose: 'Rechnung 2026-117 · Danke!' },
    { name: 'Max', iban: IBAN },
    { name: 'Max', iban: IBAN_AT, amount: 0.01 },
    { name: 'Zoë Ørsted', iban: IBAN, purpose: 'ß ł ő €' },
  ];
  for (const c of cases) {
    const parsed = parseEpcPayload(buildEpcPayload(c));
    assert.deepEqual(parsed, c);
  }
});

test('parses CRLF, version 001, other charsets, a BOM and a trailing newline', () => {
  const crlf = ['BCD', '001', '1', 'SCT', BIC, 'Red Cross', IBAN, 'EUR1', 'CHAR', '', 'Urgency fund', 'Sample EPC QR code'].join('\r\n');
  assert.deepEqual(parseEpcPayload(crlf), { name: 'Red Cross', iban: IBAN, bic: BIC, amount: 1, purpose: 'Urgency fund' });

  const latin1 = '﻿' + ['BCD', '002', '2', 'SCT', '', 'Müller', IBAN, 'EUR10.5', '', '', 'Miete'].join('\n') + '\n';
  assert.deepEqual(parseEpcPayload(latin1), { name: 'Müller', iban: IBAN, amount: 10.5, purpose: 'Miete' });
});

test('returns the structured reference', () => {
  const p = ['BCD', '002', '1', 'SCT', '', 'Stadtwerke', IBAN, 'EUR49.90', 'GDDS', 'RF18539007547034', ''].join('\n');
  assert.deepEqual(parseEpcPayload(p), { name: 'Stadtwerke', iban: IBAN, amount: 49.9, reference: 'RF18539007547034' });
});

test('is lenient about form', () => {
  const amount = (line: string) => parseEpcPayload(['BCD', '002', '1', 'SCT', '', 'X', IBAN, line].join('\n'))?.amount;
  assert.equal(amount('EUR12,50'), 12.5); // decimal comma
  assert.equal(amount('EUR 7'), 7);
  assert.equal(amount('eur3.1'), 3.1);
  assert.equal(amount('EUR'), undefined); // no amount
  assert.equal(amount('EUR0.00'), undefined);
  // A malformed BIC is dropped, not fatal.
  assert.deepEqual(parseEpcPayload(['BCD', '002', '1', 'SCT', 'XX', 'X', IBAN].join('\n')), { name: 'X', iban: IBAN });
  // An IBAN written in groups.
  assert.equal(parseEpcPayload(['BCD', '002', '1', 'SCT', '', 'X', 'DE02 1203 0000 0000 2020 51'].join('\n'))?.iban, IBAN);
});

test('is strict about substance', () => {
  const lines = ['BCD', '002', '1', 'SCT', BIC, 'Max', IBAN, 'EUR12.50', '', '', 'Text'];
  const withLine = (i: number, v: string) => lines.map((l, j) => (j === i ? v : l)).join('\n');
  assert.equal(parseEpcPayload(withLine(0, 'XYZ')), null);
  assert.equal(parseEpcPayload(withLine(1, '003')), null);
  assert.equal(parseEpcPayload(withLine(2, '9')), null);
  assert.equal(parseEpcPayload(withLine(3, 'INST')), null);
  assert.equal(parseEpcPayload(withLine(5, '')), null); // no name
  assert.equal(parseEpcPayload(withLine(6, 'DE02120300000000202052')), null); // checksum
  assert.equal(parseEpcPayload(withLine(7, 'CHF12.50')), null); // not euros
  assert.equal(parseEpcPayload(withLine(7, 'EUR12.505')), null); // three decimals
  assert.equal(parseEpcPayload(withLine(7, 'EUR1.000,00')), null); // grouped
  assert.equal(parseEpcPayload(withLine(7, 'EUR9999999999')), null); // too large
  assert.equal(parseEpcPayload(withLine(7, 'EUR-5')), null);
  // Too short, too long (a field carried a line break, so everything after it shifted).
  assert.equal(parseEpcPayload(lines.slice(0, 6).join('\n')), null);
  assert.equal(parseEpcPayload([...lines, 'Info', 'extra'].join('\n')), null);
  assert.equal(parseEpcPayload('https://example.com/pay?x=1'), null);
  assert.equal(parseEpcPayload(''), null);
  assert.equal(parseEpcPayload(undefined as unknown as string), null);
});
