import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flickerFrames, parseFlicker, renderFlicker } from './flicker.ts';

// hbci4java's reference challenge (FlickerTest): HHD 1.4, one control byte,
// a 7-digit start code, an account number, a reference and an amount in ASCII.
const HHD14 = '039870110490631098765432100812345678041,00';

test('reads an HHD 1.4 challenge', () => {
  assert.deepEqual(parseFlicker(HHD14), {
    version: '1.4',
    startCode: '1049063',
    controlBytes: [0x01],
    elements: ['9876543210', '12345678', '1,00'],
  });
});

test('renders it as hbci4java does, Luhn digit and XOR nibble included', () => {
  assert.equal(renderFlicker(HHD14), '1784011049063F059876543210041234567844312C303019');
});

test('reads a challenge with spaces between its parts', () => {
  assert.equal(renderFlicker('039 8701 1049063 10 9876543210 08 12345678 04 1,00'), renderFlicker(HHD14));
});

test('a start code alone is a code too (chipTAN for a login)', () => {
  const p = parseFlicker('012880112345678');
  assert.ok(p);
  assert.equal(p.startCode, '12345678');
  assert.deepEqual(p.elements, []);
  // 04 + 80 (control byte follows), 01, the start code in BCD; length 7 bytes.
  assert.match(renderFlicker('012880112345678')!, /^078401123456780[0-9A-F]$/);
});

test('falls back to HHD 1.3 when the length says so', () => {
  const p = parseFlicker('2008123456780812345678');
  assert.ok(p);
  assert.equal(p.version, '1.3');
  assert.equal(p.startCode, '12345678');
  assert.deepEqual(p.elements, ['12345678']);
});

test('anything else is not a flicker code', () => {
  assert.equal(parseFlicker(''), null);
  assert.equal(parseFlicker('Bitte geben Sie die TAN ein'), null);
  // A matrix challenge: a binary MIME type and an image, not digits.
  assert.equal(parseFlicker('\u0000\u0009image/png\u0000\u0004\u0089PNG'), null);
  // The length does not match what follows.
  assert.equal(parseFlicker('0408701104906310987654321008'), null);
});

test('frames: sync first, low nibble before high, the clock on then off', () => {
  const frames = flickerFrames('A5');
  // 0F FF A5 → nibbles F 0 F F 5 A, two frames each.
  assert.equal(frames.length, 12);
  assert.deepEqual(frames[0], [true, true, true, true, true]);
  assert.deepEqual(frames[1], [false, true, true, true, true]);
  assert.deepEqual(frames[2], [true, false, false, false, false]);
  // 5 = 0101: bits 1 and 4 light.
  assert.deepEqual(frames[8], [true, true, false, true, false]);
  // A = 1010: bits 2 and 8 light.
  assert.deepEqual(frames[10], [true, false, true, false, true]);
});
