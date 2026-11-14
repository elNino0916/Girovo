import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cancelLetter, letterDay, letterFileName, letterMailto, lineText } from './cancel-letter.ts';

const BASE = { holder: 'Nino Bornemann', contract: 'Netflix', today: '2026-11-14' };

test('the German letter, standard form, gaps marked', () => {
  const l = cancelLetter(BASE, 'de');
  assert.equal(l.text, [
    'Nino Bornemann',
    '[Straße und Hausnummer]',
    '[PLZ und Ort]',
    '',
    'Netflix',
    '[Anschrift des Anbieters]',
    '',
    '[Ort], 14. November 2026',
    '',
    'Kündigung meines Vertrags mit Netflix',
    'Kunden- oder Vertragsnummer: [bitte eintragen]',
    '',
    'Sehr geehrte Damen und Herren,',
    '',
    'hiermit kündige ich meinen Vertrag fristgerecht zum nächstmöglichen Zeitpunkt.',
    '',
    'Bitte bestätigen Sie mir die Kündigung und das Datum, zu dem der Vertrag endet, schriftlich.',
    '',
    'Bitte buchen Sie ab dem Vertragsende keine Beträge mehr von meinem Konto ab.',
    '',
    'Mit freundlichen Grüßen',
    '',
    '',
    'Nino Bornemann',
    '',
  ].join('\n'));
  assert.deepEqual(l.sender[1], [{ fill: 'Straße und Hausnummer' }]);
  assert.deepEqual(l.signer, ['Nino Bornemann']);
});

test('an end day, a Kündbar-bis day and the SEPA mandate', () => {
  const l = cancelLetter({
    ...BASE, endDay: '2026-12-31', noticeBy: '2026-11-30', directDebit: true,
    creditorId: 'DE98ZZZ09999999999', mandateReference: 'M-1', customerNumber: ' 4711 ',
  }, 'de');
  assert.deepEqual(l.paragraphs, [
    'hiermit kündige ich meinen Vertrag fristgerecht zum 31. Dezember 2026, hilfsweise zum nächstmöglichen Zeitpunkt.',
    'Bitte bestätigen Sie mir schriftlich, dass diese Kündigung vor Ablauf der Kündigungsfrist am 30. November 2026 bei Ihnen eingegangen ist, und das Datum, zu dem der Vertrag endet.',
    'Bitte buchen Sie ab dem Vertragsende keine Beträge mehr von meinem Konto ab. Das SEPA-Lastschriftmandat (Gläubiger-ID DE98ZZZ09999999999, Mandatsreferenz M-1) widerrufe ich zum Vertragsende.',
  ]);
  assert.equal(lineText(l.reference), 'Kunden- oder Vertragsnummer: 4711');
  assert.equal(l.mail.subject, 'Kündigung meines Vertrags mit Netflix, Kunden- oder Vertragsnummer 4711');
});

test('a direct debit without its IDs still revokes the mandate; a card payment does not', () => {
  assert.match(cancelLetter({ ...BASE, directDebit: true }, 'de').paragraphs[2], /Das SEPA-Lastschriftmandat widerrufe ich zum Vertragsende\.$/);
  assert.doesNotMatch(cancelLetter({ ...BASE, directDebit: false }, 'de').paragraphs[2], /SEPA/);
  // A Gläubiger-ID alone means a direct debit.
  assert.match(cancelLetter({ ...BASE, creditorId: 'DE98ZZZ09999999999' }, 'de').paragraphs[2], /\(Gläubiger-ID DE98ZZZ09999999999\)/);
});

test('no holder: the name is a gap too, in the address and under the signature', () => {
  const l = cancelLetter({ ...BASE, holder: '  ' }, 'de');
  assert.equal(lineText(l.sender[0]), '[Vor- und Nachname]');
  assert.match(l.text, /Mit freundlichen Grüßen\n\n\n\[Vor- und Nachname\]\n$/);
});

test('the English letter has the same structure', () => {
  const l = cancelLetter({ ...BASE, endDay: '2026-12-31', directDebit: true }, 'en');
  assert.equal(l.subject, 'Cancellation of my contract with Netflix');
  assert.equal(lineText(l.date), '[Town], 14 November 2026');
  assert.equal(l.salutation, 'Dear Sir or Madam,');
  assert.equal(l.paragraphs.length, 3);
  assert.match(l.paragraphs[0], /as of 31 December 2026, or failing that at the earliest possible date\.$/);
  assert.match(l.paragraphs[2], /I revoke the SEPA Direct Debit mandate as of the end of the contract\.$/);
  assert.equal(l.closing, 'Yours faithfully,');
  const de = cancelLetter({ ...BASE, endDay: '2026-12-31', directDebit: true }, 'de');
  assert.equal(l.text.split('\n').length, de.text.split('\n').length);
});

test('typed values stay on one line; a day that does not exist is left out', () => {
  const l = cancelLetter({ ...BASE, contract: 'Fit\nX', customerNumber: `A${String.fromCharCode(0x2028)}B`, endDay: '2026-02-30' }, 'de');
  assert.equal(l.subject, 'Kündigung meines Vertrags mit Fit X');
  assert.equal(lineText(l.reference), 'Kunden- oder Vertragsnummer: A B');
  assert.equal(l.paragraphs[0], 'hiermit kündige ich meinen Vertrag fristgerecht zum nächstmöglichen Zeitpunkt.');
  assert.equal(letterDay('2026-02-30', 'de'), null);
  assert.equal(cancelLetter({ ...BASE, contract: '' }, 'de').subject, 'Kündigung meines Vertrags mit Anbieter');
});

test('the e-mail: number first, no address blocks, CRLF in the mailto link', () => {
  const l = cancelLetter(BASE, 'de');
  assert.ok(l.mail.body.startsWith('Kunden- oder Vertragsnummer: [bitte eintragen]\n\nSehr geehrte Damen und Herren,'));
  assert.ok(!l.mail.body.includes('[Anschrift des Anbieters]'));
  assert.ok(l.mail.body.endsWith('Mit freundlichen Grüßen\nNino Bornemann\n[Straße und Hausnummer]\n[PLZ und Ort]'));
  const url = letterMailto(l);
  assert.ok(url.startsWith('mailto:?subject=K%C3%BCndigung%20meines%20Vertrags%20mit%20Netflix&body='));
  assert.ok(url.includes('%0D%0A%0D%0ASehr%20geehrte'));
  // Every line break is CRLF.
  assert.ok(!url.replace(/%0D%0A/g, '').includes('%0A'));
  // Short enough for a mail program to take it.
  assert.ok(url.length < 2000, String(url.length));
});

test('the PDF file name', () => {
  assert.equal(letterFileName('Netflix', 'de'), 'Kuendigung_Netflix.pdf');
  assert.equal(letterFileName('Süße Grüße GmbH & Co.', 'de'), 'Kuendigung_Susse_Grusse_GmbH_Co.pdf');
  assert.equal(letterFileName('', 'en'), 'Cancellation.pdf');
});

test('a Kündbar-bis day that has passed is left out of the letter', () => {
  const passed = cancelLetter({ ...BASE, noticeBy: '2026-11-13' }, 'de');
  assert.ok(!passed.text.includes('13. November 2026'));
  assert.ok(passed.text.includes('Bitte bestätigen Sie mir die Kündigung und das Datum, zu dem der Vertrag endet, schriftlich.'));
  assert.ok(cancelLetter({ ...BASE, noticeBy: '2026-11-14' }, 'de').text.includes('am 14. November 2026 bei Ihnen eingegangen'));
});
