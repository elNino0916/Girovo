import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BANK_UNAVAILABLE, BANK_UNREACHABLE, bankAnswerCodes, bankAnswerLines, formatBankAnswer, isBankOutage,
  isCredentialAnswer, isDefiniteRefusal, refusalReference,
} from './bank-answer.ts';

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

// --- Login and reads (formatBankAnswer, isCredentialAnswer, isBankOutage) ---

test('the bank\'s sentences without their codes, the codes on the side', () => {
  const a = formatBankAnswer('9931: Anmeldename oder PIN falsch. | 9800: Dialog abgebrochen');
  assert.deepEqual(a.lines, ['Anmeldename oder PIN falsch.']);
  // 9800 follows any error and is left out with its sentence.
  assert.deepEqual(a.codes, ['9931']);
  assert.equal(a.locked, false);
});

test('notes and warnings ride along on every reply and do not bury the error', () => {
  const a = formatBankAnswer(
    '3920: Zugelassene Zwei-Schritt-Verfahren für den Benutzer. | 3050: UPD nicht mehr aktuell. | 9210: Auftrag abgelehnt - Konto gesperrt für Überweisungen.',
  );
  assert.deepEqual(a.lines, ['Auftrag abgelehnt - Konto gesperrt für Überweisungen.']);
  assert.deepEqual(a.codes, ['9210']);
});

test('a 3xxx warning about tries or a lock stays next to the error', () => {
  const a = formatBankAnswer('9942: PIN falsch. | 3931: Noch 1 Versuch, danach wird der Zugang gesperrt. | 9800: Dialog abgebrochen');
  assert.deepEqual(a.lines, ['PIN falsch.', 'Noch 1 Versuch, danach wird der Zugang gesperrt.']);
  assert.deepEqual(a.codes, ['9942', '3931']);
  // Announced, not happened.
  assert.equal(a.locked, false);
});

test('the dialog\'s own errors are left out beside a real one, as on a refusal', () => {
  const a = formatBankAnswer(
    '9050: Die Nachricht enthält Fehler. | 9210: Der Auftrag wurde abgelehnt – die Freigabe wurde in der App verweigert. | 9800: Dialog abgebrochen.',
  );
  assert.deepEqual(a.lines, ['Der Auftrag wurde abgelehnt – die Freigabe wurde in der App verweigert.']);
  assert.deepEqual(a.codes, ['9210']);
  // On its own, the message-level error is still the answer.
  assert.deepEqual(formatBankAnswer('9050: Die Nachricht enthält Fehler.').lines, ['Die Nachricht enthält Fehler.']);
});

test('only 9800 is still shown when it is all the bank said', () => {
  assert.deepEqual(formatBankAnswer('9800: Dialog abgebrochen').lines, ['Dialog abgebrochen']);
});

test('without an error, everything the bank said is the answer', () => {
  const a = formatBankAnswer('0020: Auftrag ausgeführt. | 3076: Keine starke Kundenauthentifizierung notwendig.');
  assert.deepEqual(a.lines, ['Auftrag ausgeführt.', 'Keine starke Kundenauthentifizierung notwendig.']);
  assert.deepEqual(a.codes, ['0020', '3076']);
});

test('text without codes is one line, and the same sentence appears once', () => {
  assert.deepEqual(formatBankAnswer(BANK_UNAVAILABLE), { lines: [BANK_UNAVAILABLE], codes: [], locked: false });
  assert.deepEqual(formatBankAnswer('9050: Fehler. | 9051: Fehler.').lines, ['Fehler.']);
  assert.deepEqual(formatBankAnswer('').lines, []);
  assert.deepEqual(formatBankAnswer(null).lines, []);
});

test('a code with no sentence still says something, and keeps the code', () => {
  const a = formatBankAnswer('9010: ');
  assert.deepEqual(a.lines, ['Deine Bank hat keine Begründung mitgeschickt.']);
  assert.deepEqual(a.codes, ['9010']);
});

test('a locked access is recognised by the bank\'s own word, not by its code', () => {
  assert.equal(formatBankAnswer('9942: Zugang gesperrt. | 9800: Dialog abgebrochen').locked, true);
  assert.equal(formatBankAnswer('9930: Ihr Zugang wurde nach 3 Fehlversuchen gesperrt.').locked, true);
  assert.equal(formatBankAnswer('9931: PIN-Sperre aktiv.').locked, true);
  // 9942 for a plain wrong PIN: no lock.
  assert.equal(formatBankAnswer('9942: PIN falsch.').locked, false);
  assert.equal(formatBankAnswer('9942: PIN falsch. Nach drei Fehlversuchen wird der Zugang gesperrt.').locked, false);
  assert.equal(formatBankAnswer('3931: Ihr Zugang ist nicht gesperrt.').locked, false);
  assert.equal(formatBankAnswer('9931: Zugang entsperrt, bitte erneut anmelden.').locked, false);
});

test('credential refusals are told apart from outages and the product registration', () => {
  assert.equal(isCredentialAnswer('9931: Anmeldename oder PIN falsch.'), true);
  assert.equal(isCredentialAnswer('9942: Falsche Eingabe.'), true);
  assert.equal(isCredentialAnswer('9050: Die Kennung ist unbekannt.'), true);
  assert.equal(isCredentialAnswer('Deine Bank hat die Anmeldung abgelehnt. Prüfe Anmeldename und PIN.'), true);
  assert.equal(isCredentialAnswer('9078: Software nicht als FinTS-Produkt registriert (PIN/TAN).'), false);
  assert.equal(isCredentialAnswer(BANK_UNAVAILABLE), false);
  assert.equal(isCredentialAnswer(BANK_UNREACHABLE), false);
});

test('the outage sentences are recognised, with or without a next step after them', () => {
  assert.equal(isBankOutage(BANK_UNAVAILABLE), true);
  assert.equal(isBankOutage(`${BANK_UNREACHABLE} Versuche es später noch einmal.`), true);
  assert.equal(isBankOutage('9931: PIN falsch.'), false);
  assert.equal(isBankOutage(undefined), false);
});

// --- One parser for both readings ---

test('formatBankAnswer reads the same wire spellings as the order reading', () => {
  // Codes without a colon, one per line, as lib-fints writes them.
  const a = formatBankAnswer('0010 Nachricht entgegengenommen.\n9210 Empfänger-IBAN gesperrt.');
  assert.deepEqual(a.lines, ['Empfänger-IBAN gesperrt.']);
  assert.deepEqual(a.codes, ['9210']);
  // A short code is written as the bank's four digits.
  assert.deepEqual(formatBankAnswer('20: Auftrag ausgeführt.').codes, ['0020']);
});
