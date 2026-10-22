import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAME_SHOTS, NAME_SYSTEM, nameText, parseNameAnswer } from './nano-names.ts';

test("Nano's brand is shown only where the bank's text has it", () => {
  assert.equal(parseNameAnswer('eBay', 'PAYPAL *EBAY'), 'eBay');
  assert.equal(parseNameAnswer('Deichmann\n', 'Deichmann-Schuhe GmbH & Co. Vertriebs KG Essen DE'), 'Deichmann');
  assert.equal(parseNameAnswer('„Netto“', 'NETTO MARKEN-DISCOU'), 'Netto');
  assert.equal(parseNameAnswer('Amazon', 'WWW.AMAZON.'), 'Amazon');
  // Made up: not in the name.
  assert.equal(parseNameAnswer('Lieferando', 'Pizzeria Bella 2'), null);
  assert.equal(parseNameAnswer('NONE', 'Peter Schneider'), null);
  assert.equal(parseNameAnswer('', 'REWE'), null);
  // Nothing to tidy: the bank wrote just this.
  assert.equal(parseNameAnswer('REWE', 'REWE'), null);
});

test('the prompt is the calibration’s, byte for byte', () => {
  assert.match(NAME_SYSTEM, /antworte NONE\.$/);
  assert.match(NAME_SHOTS, /PAYPAL \*EBAY → eBay\n/);
  assert.equal(nameText(' Tchibo GmbH '), '\nName: Tchibo GmbH\nMarke:');
});
