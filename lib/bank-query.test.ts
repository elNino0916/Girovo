import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bankSearchTerm, parseBankQuery } from './bank-query.ts';

test('a BLZ is found the way the app prints it, spaces and all', () => {
  assert.deepEqual(parseBankQuery('370 400 44'), { kind: 'blz', digits: '37040044' });
  assert.deepEqual(parseBankQuery(' 12030000 '), { kind: 'blz', digits: '12030000' });
  assert.equal(bankSearchTerm(parseBankQuery('370 400 44')), '37040044');
  // From three digits on, like the route's BLZ prefix search.
  assert.equal(bankSearchTerm(parseBankQuery('12')), null);
  assert.equal(bankSearchTerm(parseBankQuery('120')), '120');
});

test('spaces are only removed when the query is digits and spaces alone', () => {
  assert.deepEqual(parseBankQuery('Sparkasse 1822'), { kind: 'text', text: 'Sparkasse 1822' });
  assert.deepEqual(parseBankQuery('N26'), { kind: 'text', text: 'N26' });
  assert.equal(bankSearchTerm(parseBankQuery('Sparkasse Köln')), 'Sparkasse Köln');
});

test('an IBAN is read in the browser, and only its BLZ is searched for', () => {
  const full = parseBankQuery('DE89 3704 0044 0532 0130 00');
  assert.deepEqual(full, { kind: 'iban', country: 'DE', blz: '37040044', complete: true, valid: true });
  assert.equal(bankSearchTerm(full), '37040044');
  // Lower case and no spaces work the same.
  assert.equal(bankSearchTerm(parseBankQuery('de89370400440532013000')), '37040044');
});

test('a partial IBAN resolves as soon as its 12 characters are there', () => {
  assert.deepEqual(parseBankQuery('DE89 3704'), { kind: 'iban', country: 'DE', blz: null, complete: false, valid: null });
  assert.equal(bankSearchTerm(parseBankQuery('DE89 3704')), null);
  const twelve = parseBankQuery('DE89 3704 0044');
  assert.deepEqual(twelve, { kind: 'iban', country: 'DE', blz: '37040044', complete: false, valid: null });
  assert.equal(bankSearchTerm(twelve), '37040044');
  // Recognised from the first check digit, so "DE8" is not a name search.
  assert.equal(parseBankQuery('DE8').kind, 'iban');
});

test('a complete IBAN with a wrong check number is not looked up', () => {
  const wrong = parseBankQuery('DE88 3704 0044 0532 0130 00');
  assert.equal(wrong.kind === 'iban' && wrong.valid, false);
  assert.equal(bankSearchTerm(wrong), null);
  // Longer than any German IBAN: complete, and wrong.
  const long = parseBankQuery('DE89 3704 0044 0532 0130 0012');
  assert.equal(long.kind === 'iban' && long.complete && long.valid, false);
});

test('a foreign IBAN is recognised but never searched', () => {
  const at = parseBankQuery('AT61 1904 3002 3457 3201');
  assert.deepEqual(at, { kind: 'iban', country: 'AT', blz: null, complete: false, valid: null });
  assert.equal(bankSearchTerm(at), null);
});

test('names are searched from two characters on; nothing for an empty box', () => {
  assert.deepEqual(parseBankQuery('   '), { kind: 'empty' });
  assert.equal(bankSearchTerm(parseBankQuery('D')), null);
  assert.equal(bankSearchTerm(parseBankQuery('DKB')), 'DKB');
  // "DE" alone could still be the start of "Deutsche Bank".
  assert.deepEqual(parseBankQuery('De'), { kind: 'text', text: 'De' });
});
