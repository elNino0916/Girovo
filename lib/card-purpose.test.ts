import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCardPurpose, parseCardPurpose, stripCardBoilerplate } from './card-purpose.ts';

const EUR = '2026-08-18T10:12 Debitk.0 2030-12 Einsatzentgelt 1,00 EUR Zahl.System VISA Debit';
const USD = '2026-08-31T09:01 Debitk.0 2030-12 Original 9,85 USD 1 Euro=1,1563 USD Einsatzentgelt 0,15 EUR Zahl.System VISA Debit';
const NOTE = '2026-08-05T18:40 Debitk.0 2030-12 Einsatzentgelt 1,00 EUR Teillieferung(Final) Zahl.System VISA Debit';

test('recognises the card record and nothing else', () => {
  assert.ok(isCardPurpose(EUR));
  assert.ok(isCardPurpose(USD));
  assert.ok(isCardPurpose('Kreditk.1 2028-04 Zahl.System Mastercard'));
  assert.ok(!isCardPurpose('Miete Oktober Whg 3.OG'));
  assert.ok(!isCardPurpose('Entgelte vom 01.09.2026 bis 30.09.2026'));
  assert.ok(!isCardPurpose(''));
});

test('parses the parts of a domestic payment', () => {
  const p = parseCardPurpose(EUR)!;
  assert.equal(p.at, '2026-08-18T10:12');
  assert.equal(p.card, 'debit');
  assert.equal(p.scheme, 'VISA Debit');
  assert.equal(p.original, null);
  assert.equal(p.fee, 1);
  assert.equal(p.rest, '');
});

test('parses a foreign-currency payment', () => {
  const p = parseCardPurpose(USD)!;
  assert.deepEqual(p.original, { amount: 9.85, currency: 'USD', rate: 1.1563 });
  assert.equal(p.fee, 0.15);
  assert.equal(p.rest, '');
});

test('keeps what the record does not explain', () => {
  assert.equal(parseCardPurpose(NOTE)!.rest, 'Teillieferung(Final)');
});

test('stripping leaves no fee word behind — the cause of "Bankentgelte" on purchases', () => {
  for (const s of [EUR, USD, NOTE]) assert.doesNotMatch(stripCardBoilerplate(s), /entgelt/i);
  assert.equal(stripCardBoilerplate('Entgelte vom 01.09.'), 'Entgelte vom 01.09.', 'not a card record: untouched');
});
