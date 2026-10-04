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

test('merchant descriptors from a real statement reduce to the shop and its place', async () => {
  const { parseCardAcceptor, cleanMerchantName } = await import('./card-purpose.ts');
  assert.deepEqual(parseCardAcceptor('LS Caf Nova Deutzer F/Frankenwerft 1/Kln/DE'),
    { merchant: 'Café Nova Deutzer F', street: 'Frankenwerft 1', city: 'Köln', country: 'DE' });
  assert.deepEqual(parseCardAcceptor('WL .Steam Purchase//425-889-9642/Us/3'),
    { merchant: 'Steam Purchase', street: null, city: null, country: 'US' }, 'a hotline is not a town');
  assert.deepEqual(parseCardAcceptor('SP the Ridge EU//Amsterdam-Dui/NL/1'),
    { merchant: 'The Ridge EU', street: null, city: 'Amsterdam-Dui', country: 'NL' });
  assert.deepEqual(parseCardAcceptor('DHL.4158584457//Bonn/De/0'),
    { merchant: 'DHL', street: null, city: 'Bonn', country: 'DE' });
  assert.deepEqual(parseCardAcceptor('REWE SAGT DANKE.//KOELN/DE'),
    { merchant: 'REWE SAGT DANKE', street: null, city: 'Köln', country: 'DE' });
  assert.equal(cleanMerchantName('AMZN Mktp DE*2X3Y4Z//amzn.com/bill/LU'), 'AMZN Mktp DE');
  assert.equal(cleanMerchantName('APPLE.COM/BILL//Cork/IE'), 'APPLE.COM/BILL');
  assert.deepEqual(parseCardAcceptor('ALDI SUED/MUENCHEN/DE'),
    { merchant: 'ALDI SUED', street: null, city: 'München', country: 'DE' }, 'no street slot at all');
});

test('ordinary names are never taken apart', async () => {
  const { parseCardAcceptor, cleanMerchantName } = await import('./card-purpose.ts');
  for (const n of ['Stadtwerke Musterstadt GmbH', 'Müller/Schmidt GbR', 'Apple.com/bill', 'G2A.COM Limited', 'PP Autoteile GmbH']) {
    assert.equal(parseCardAcceptor(n), null, n);
    assert.equal(cleanMerchantName(n), n);
  }
});

test('a card refund is recognised and its references stay out of the text', async () => {
  const { isCardPurpose, stripCardBoilerplate } = await import('./card-purpose.ts');
  const refund = '2026-09-12T08:15:30 000 2030-12 /VID-K4F2A9C0DE11 +ARN74123456789012345678901';
  assert.ok(isCardPurpose(refund));
  assert.equal(stripCardBoilerplate(refund), '');
});
