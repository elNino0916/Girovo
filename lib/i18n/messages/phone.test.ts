import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MESSAGES } from './index.ts';
import { onPhone } from './phone.ts';

/** Every text in `value`, functions called with a stand-in for each value. */
function texts(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'function') {
    try {
      texts((value as (...a: unknown[]) => unknown)('X', 'Y', 'Z'), out);
    } catch { /* a formatter that needs real values: its words are checked elsewhere */ }
  } else if (Array.isArray(value)) value.forEach((v) => texts(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => texts(v, out));
  return out;
}

test('the phone build never calls the phone a computer', () => {
  for (const locale of ['de', 'en'] as const) {
    const all = texts(onPhone(MESSAGES[locale], locale));
    const left = all.filter((s) => /Rechner|computer|klickst|\bclick\b/i.test(s));
    assert.deepEqual(left, [], locale);
  }
});

test('the phone wording keeps the grammar', () => {
  const de = onPhone(MESSAGES.de, 'de');
  assert.equal(de.session.thisComputer, 'Auf diesem Telefon');
  assert.equal(de.history.keep, 'Umsätze auf diesem Telefon behalten');
  assert.match(de.session.forgetDialog.description('die Bank'), /dieses Telefon kennt\. Bei der nächsten Anmeldung gilt es als neues Gerät/);
  assert.match(de.session.forgetDialog.body, /Gibst du das Telefon weiter/);
  assert.match(de.provider.bank.insecure, /dieses Telefons\./);
  assert.equal(onPhone(MESSAGES.en, 'en').session.thisComputer, 'On this phone');
});

test('the desktop and website texts stay as they are', () => {
  assert.equal(MESSAGES.de.session.thisComputer, 'Auf diesem Rechner');
  assert.equal(MESSAGES.en.session.thisComputer, 'On this computer');
});
