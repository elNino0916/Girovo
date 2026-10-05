'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const scrub = require('./telemetry-scrub.cjs');

test('text: IBANs, with and without spaces', () => {
  assert.equal(scrub.text('Konto DE89370400440532013000 gesperrt'), 'Konto [IBAN] gesperrt');
  assert.equal(scrub.text('an DE89 3704 0044 0532 0130 00.'), 'an [IBAN].');
});

test('text: amounts, dates and long numbers', () => {
  assert.equal(scrub.text('Betrag 1.234,56 EUR überschreitet Limit'), 'Betrag [Betrag] EUR überschreitet Limit');
  assert.equal(scrub.text('49,99 und 12.50'), '[Betrag] und [Betrag]');
  assert.equal(scrub.text('gebucht am 05.10.2026 und 2026-10-05'), 'gebucht am [Datum] und [Datum]');
  assert.equal(scrub.text('Konto 0532013000 bei 37040044'), 'Konto [Zahl] bei [Zahl]');
});

test('text: short codes stay — they say what went wrong', () => {
  assert.equal(scrub.text('HIRMS 9942: PIN falsch'), 'HIRMS 9942: PIN falsch');
  assert.equal(scrub.text('request failed with status code 503'), 'request failed with status code 503');
});

test('text: names after a label, and quoted text, are masked', () => {
  assert.equal(scrub.text('Name des Zahlungsempfängers weicht ab. Empfänger: Max Mustermann'),
    'Name […]. Empfänger: […]');
  assert.equal(scrub.text('Kontoinhaber Erika Musterfrau; bitte prüfen'), 'Kontoinhaber […]; bitte prüfen');
  // The label rule is the stricter one and wins: what follows "Name" goes.
  assert.equal(scrub.text('Der Name „Erika Musterfrau“ passt nicht'), 'Der Name […]');
  assert.equal(scrub.text('Der Wert „Erika Musterfrau“ passt nicht'), 'Der Wert "…" passt nicht');
  assert.equal(scrub.text('Verwendungszweck: Miete Oktober'), 'Verwendungszweck: […]');
});

test('text: a quoted code word stays', () => {
  assert.equal(scrub.text("Cannot read properties of undefined (reading 'amount')"),
    "Cannot read properties of undefined (reading 'amount')");
  assert.equal(scrub.text('"Erika Musterfrau" is not a function'), '"…" is not a function');
});

test('text: e-mail, home folders, URL queries', () => {
  assert.equal(scrub.text('mail to max@example.org failed'), 'mail to [E-Mail] failed');
  assert.equal(scrub.text('ENOENT C:\\Users\\ninob\\AppData\\Roaming\\x'), 'ENOENT C:\\Users\\~\\AppData\\Roaming\\x');
  assert.equal(scrub.text('open /home/erika/file'), 'open /home/~/file');
  assert.equal(scrub.text('GET https://bank.example/fints?user=erika&pin=1 → 500'), 'GET https://bank.example/fints → 500');
});

test('text: one line, capped', () => {
  assert.equal(scrub.text('a\n\n  b\tc'), 'a b c');
  const long = scrub.text('x'.repeat(1000));
  assert.equal(long.length, scrub.MAX_MESSAGE);
  assert.ok(long.endsWith('…'));
});

test('error: the stack is rebuilt from the scrubbed message and its frames', () => {
  const raw = {
    name: 'TypeError',
    message: 'Empfänger: Max Mustermann, DE89370400440532013000',
    stack: 'TypeError: Empfänger: Max Mustermann, DE89370400440532013000\n'
      + '  second line of the message with 49,99\n'
      + '    at pay (C:\\Users\\ninob\\AppData\\Local\\Programs\\Girovo\\resources\\server\\x.js:12:34)\n'
      + '    at http://127.0.0.1:51234/_next/static/app.js?v=abc:1:999',
  };
  const e = scrub.error(raw);
  assert.ok(e instanceof Error);
  assert.equal(e.name, 'TypeError');
  assert.equal(e.message, 'Empfänger: […]');
  assert.equal(e.stack,
    'TypeError: Empfänger: […]\n'
    + '    at pay (C:\\Users\\~\\AppData\\Local\\Programs\\Girovo\\resources\\server\\x.js:12:34)\n'
    + '    at http://127.0.0.1:51234/_next/static/app.js:1:999');
  assert.ok(!e.stack.includes('49,99'));
});

test('error: odd input', () => {
  assert.equal(scrub.error(null), null);
  assert.equal(scrub.error('boom 0532013000').message, 'boom [Zahl]');
  assert.equal(scrub.error({ name: 'not a name!', message: 'x' }).name, 'Error');
  assert.equal(scrub.error(new RangeError('bad')).name, 'RangeError');
});

test('props: only declared fields, each of its type', () => {
  const spec = { blz: 'blz', ok: 'bool', ms: 'int', screen: 'id', format: ['pdf', 'csv'], from: 'version' };
  assert.deepEqual(scrub.props({
    blz: '37040044', ok: true, ms: 182.6, screen: 'umsaetze', format: 'pdf', from: '4.3.0',
    iban: 'DE89370400440532013000', extra: 1,
  }, spec), { blz: '37040044', ok: true, ms: 183, screen: 'umsaetze', format: 'pdf', from: '4.3.0' });
});

test('props: free text never rides along', () => {
  const spec = { screen: 'id', blz: 'blz', format: ['pdf', 'csv'], ms: 'int' };
  assert.deepEqual(scrub.props({
    screen: 'Max Mustermann', blz: '3704 0044', format: 'docx', ms: '12',
  }, spec), {});
  assert.deepEqual(scrub.props(null, spec), {});
  assert.deepEqual(scrub.props({ ms: -5 }, spec), { ms: 0 });
});
