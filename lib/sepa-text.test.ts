import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEPA_PURPOSE_MAX, sepaLength, sepaSanitize } from './sepa-text.ts';

test('umlauts and ß are spelled out, accents dropped', () => {
  assert.equal(sepaSanitize('für März'), 'fuer Maerz');
  assert.equal(sepaSanitize('Straße Ölmühle ÄÖÜ'), 'Strasse Oelmuehle AeOeUe');
  assert.equal(sepaSanitize('Café Señor'), 'Cafe Senor');
});

test('symbols with a SEPA spelling get it, the rest become spaces', () => {
  assert.equal(sepaSanitize('€5 @x'), 'EUR5 (at)x');
  assert.equal(sepaSanitize('A&B *x_y "z"'), "A+B .x-y 'z'");
  assert.equal(sepaSanitize('Rechnung #12; 100% !'), 'Rechnung 12 100');
});

test('whitespace collapses and the ends are trimmed', () => {
  assert.equal(sepaSanitize('  Max \t  Mustermann \n'), 'Max Mustermann');
  assert.equal(sepaSanitize('😀'), '');
  assert.equal(sepaSanitize(null), '');
  assert.equal(sepaSanitize(undefined), '');
});

test('maxLength cuts the rewritten text — for fields nobody typed', () => {
  assert.equal(sepaSanitize('Müller', 4), 'Muel');
});

test('sepaLength counts what the bank counts', () => {
  assert.equal(sepaLength('Gebühr'), 7);
  // A purpose that fits the input's 140 characters but not the bank's.
  const purpose = `${'x'.repeat(130)} für März`;
  assert.equal(purpose.length, 139);
  assert.equal(sepaLength(purpose), 141);
  assert.ok(sepaLength(purpose) > SEPA_PURPOSE_MAX);
});
