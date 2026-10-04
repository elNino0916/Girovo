import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AMOUNT_MASK as M, amountParts, maskAmounts } from './mask.ts';

test('an Entgeltabschluss loses its fee, keeps its dates', () => {
  assert.equal(
    maskAmounts('ENTGELTE VOM 01.09.2026 BIS 30.09.2026 KONTOFUEHRUNG 6,90'),
    `ENTGELTE VOM 01.09.2026 BIS 30.09.2026 KONTOFUEHRUNG ${M}`,
  );
  // The list's re-cased summary of the same booking.
  assert.equal(
    maskAmounts('Entgelte vom 01.09.2026 bis 30.09.2026 Kontofuehrung 6,90'),
    `Entgelte vom 01.09.2026 bis 30.09.2026 Kontofuehrung ${M}`,
  );
});

test('a Visa Debit record gives away no figure the masked amount could be worked out from', () => {
  const usd = '2026-08-31T09:01 Debitk.0 2030-12 Original 9,85 USD 1 Euro=1,1563 USD Einsatzentgelt 0,15 EUR Zahl.System VISA Debit';
  assert.equal(
    maskAmounts(usd),
    `2026-08-31T09:01 Debitk.0 2030-12 Original ${M} USD ${M} Euro=${M} USD Einsatzentgelt ${M} EUR Zahl.System VISA Debit`,
  );
  assert.equal(
    maskAmounts('2026-08-18T10:12 Debitk.0 2030-12 Einsatzentgelt 1,00 EUR Zahl.System VISA Debit'),
    `2026-08-18T10:12 Debitk.0 2030-12 Einsatzentgelt ${M} EUR Zahl.System VISA Debit`,
  );
});

test('German decimals, with or without grouping, and the sign with them', () => {
  const cases: [string, string][] = [
    ['Miete 1.090,00', `Miete ${M}`],
    ['Abschlag 1 090,00', `Abschlag ${M}`],
    ['Saldo −1.234,56 alt', `Saldo ${M} alt`],
    ['Saldo -12,50', `Saldo ${M}`],
    ['Gutschrift +12,00', `Gutschrift ${M}`],
    ['Zinsen 0,01', `Zinsen ${M}`],
    ['Betrag:12,50', `Betrag:${M}`],
    ['Rate-12,00', `Rate-${M}`],
  ];
  for (const [input, want] of cases) assert.equal(maskAmounts(input), want, input);
});

test('whole euros written with a dash', () => {
  assert.equal(maskAmounts('Sofa 149,-'), `Sofa ${M}`);
  assert.equal(maskAmounts('Sofa 149,– bar'), `Sofa ${M} bar`);
  assert.equal(maskAmounts('Sofa 1.149,-- EUR'), `Sofa ${M} EUR`);
});

test('any number next to a currency, in either order and any notation', () => {
  const cases: [string, string][] = [
    ['Miete 850 EUR', `Miete ${M} EUR`],
    ['Miete EUR 850', `Miete EUR ${M}`],
    ['Miete 850EUR', `Miete ${M}EUR`],
    ['Kauf 39.86 USD', `Kauf ${M} USD`],
    ['Kauf USD 39.86', `Kauf USD ${M}`],
    ['Kauf $12.99', `Kauf $${M}`],
    ['Kauf 12,50€', `Kauf ${M}€`],
    ['Kauf 12,50 €', `Kauf ${M} €`],
    ['Kauf € 12', `Kauf € ${M}`],
    ['Kauf 1,234.56 USD', `Kauf ${M} USD`],
    ['Kauf 12.500 EUR', `Kauf ${M} EUR`],
    ['Original 1.234,00 TRY', `Original ${M} TRY`],
    ['1 Euro', `${M} Euro`],
    ['Gutschein 5 USD-Wert', `Gutschein ${M} USD-Wert`],
  ];
  for (const [input, want] of cases) assert.equal(maskAmounts(input), want, input);
});

test('dates, times and identifiers stay as the bank wrote them', () => {
  const untouched = [
    'Entgelte vom 01.09.2026 bis 30.09.2026',
    'Wert 18.09.',
    'GA NR00004471 BLZ57069999 0 17.09/15.55',
    '2026-08-18T10:12 Debitk.0 2030-12',
    'IBAN DE89 3704 0044 0532 0130 00',
    'EREF+1051808585130 MREF+5RRJ2259NXZLL',
    'ARAL Station 4711//MUSTERSTADT/DE 2026-10-04T08:12:40 KFN 1 VJ 2912',
    'Rechnung 2026-1234 Kunde 4711',
    'Kurs 1,1563',
  ];
  for (const s of untouched) assert.equal(maskAmounts(s), s, s);
});

test('a bare whole number stays — it may be a house or contract number', () => {
  assert.equal(maskAmounts('Miete 850'), 'Miete 850');
  assert.equal(maskAmounts('Musterstr. 12'), 'Musterstr. 12');
});

test('words that merely start like a currency are not one', () => {
  assert.equal(maskAmounts('Euroshop 12'), 'Euroshop 12');
  assert.equal(maskAmounts('12 Europaletten'), '12 Europaletten');
});

test('the parts keep every character, and only the figures are amounts', () => {
  const s = 'Original 9,85 USD 1 Euro=1,1563 USD Kontofuehrung 6,90';
  const parts = amountParts(s);
  assert.equal(parts.map((p) => p.text).join(''), s);
  assert.deepEqual(parts.filter((p) => p.amount).map((p) => p.text), ['9,85', '1', '1,1563', '6,90']);
  assert.deepEqual(amountParts('EUR −12,50'), [{ text: 'EUR ', amount: false }, { text: '−12,50', amount: true }]);
  assert.deepEqual(amountParts('Miete 850'), [{ text: 'Miete 850', amount: false }]);
  assert.deepEqual(amountParts(''), []);
});

test('empty and repeated input', () => {
  assert.equal(maskAmounts(''), '');
  assert.equal(maskAmounts(null), '');
  assert.equal(maskAmounts(undefined), '');
  const once = maskAmounts('Original 9,85 USD Einsatzentgelt 0,15 EUR Kontofuehrung 6,90');
  assert.equal(maskAmounts(once), once);
});
