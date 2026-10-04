import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bankAnswerCodes, bankAnswerLines, isDefiniteRefusal, refusalReference } from './bank-answer.ts';

test('a refusal of the order itself is definite', () => {
  assert.equal(isDefiniteRefusal([9050, 9210, 9800]), true);
  assert.equal(isDefiniteRefusal([9941]), true);
  // A message received and a warning beside it change nothing.
  assert.equal(isDefiniteRefusal([10, 3920, 9340]), true);
});

test('a dialog abort on its own is not a refusal — the order may have gone through', () => {
  assert.equal(isDefiniteRefusal([9800]), false);
  assert.equal(isDefiniteRefusal([9050, 9800]), false);
  assert.equal(isDefiniteRefusal([9000]), false);
});

test('an execution code beside an error leaves the outcome open', () => {
  assert.equal(isDefiniteRefusal([20, 9210]), false);
  assert.equal(isDefiniteRefusal([9210, 30]), false);
  assert.equal(isDefiniteRefusal([100, 9210]), true, '0100 Dialog beendet says nothing about the order');
});

test('no codes, or only success and warnings, is no refusal', () => {
  assert.equal(isDefiniteRefusal([]), false);
  assert.equal(isDefiniteRefusal([10, 3076]), false);
  assert.equal(isDefiniteRefusal([Number.NaN, -1]), false);
});

test('bankAnswerLines keeps the bank\'s words and drops the codes', () => {
  assert.deepEqual(
    bankAnswerLines('9050: Die Nachricht enthält Fehler. | 9210: Die Empfänger-IBAN ist gesperrt. | 9800: Dialog abgebrochen.'),
    ['Die Nachricht enthält Fehler.', 'Die Empfänger-IBAN ist gesperrt.', 'Dialog abgebrochen.'],
  );
  assert.deepEqual(bankAnswerLines('0010 Nachricht entgegengenommen.\n0020 Auftrag ausgeführt.'), [
    'Nachricht entgegengenommen.', 'Auftrag ausgeführt.',
  ]);
  // Repeated sentences once; an app message without a code passes unchanged.
  assert.deepEqual(bankAnswerLines('20: Auftrag ausgeführt. | 20: Auftrag ausgeführt.'), ['Auftrag ausgeführt.']);
  assert.deepEqual(bankAnswerLines('Bitte warten — ein anderer Vorgang läuft noch.'), ['Bitte warten — ein anderer Vorgang läuft noch.']);
  assert.deepEqual(bankAnswerLines(null), []);
});

test('a figure inside a sentence is not taken for a code', () => {
  assert.deepEqual(bankAnswerLines('9210: Limit von 1000 EUR überschritten.'), ['Limit von 1000 EUR überschritten.']);
  assert.deepEqual(bankAnswerCodes('9210: Limit von 1000 EUR überschritten.'), [9210]);
});

test('bankAnswerCodes reads both wire spellings, each code once', () => {
  assert.deepEqual(bankAnswerCodes('9050: A | 9210: B | 9800: C | 9210: B'), [9050, 9210, 9800]);
  assert.deepEqual(bankAnswerCodes('0010 Nachricht entgegengenommen.\n0020 Auftrag ausgeführt.'), [10, 20]);
  assert.deepEqual(bankAnswerCodes('Keine Codes hier.'), []);
});

test('refusalReference names the order\'s own errors, four digits each', () => {
  assert.equal(refusalReference('9050: A | 9210: B | 9800: C'), '9210');
  assert.equal(refusalReference('9210: A | 9340: B'), '9210, 9340');
  assert.equal(refusalReference('9800: Dialog abgebrochen.'), '');
  assert.equal(refusalReference(''), '');
});
