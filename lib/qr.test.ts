import { test } from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import qrcode from 'qrcode-generator';
import { buildEpcPayload } from './girocode.ts';
import { qrMatrix, qrPngBlob, qrSvgPath } from './qr.ts';
import { rasterise } from './__fixtures__/io-raster.ts';

const IBAN = 'DE02120300000000202051';
const NAME_70 = 'Gemeinnützige Wohnungsbaugenossenschaft Musterstadt-Süd eG, Verwaltung';
const PURPOSE_140 = 'Rechnung 2026-0117 '.repeat(8).slice(0, 140);

/** A payload of exactly 331 bytes — the most a GiroCode may hold. */
function fullestPayload(): string {
  const fixed = { name: 'Ü'.repeat(70), iban: IBAN, amount: 1 };
  const room = 331 - new TextEncoder().encode(buildEpcPayload({ ...fixed, purpose: 'a' })).length + 1;
  return buildEpcPayload({ ...fixed, purpose: 'é'.repeat(Math.floor(room / 2)) + (room % 2 ? 'a' : '') });
}

/** matrix → pixels (4 px per module, 4-module quiet zone) → jsQR. */
function roundTrip(text: string) {
  const image = rasterise(qrMatrix(text), { scale: 4, quiet: 4 });
  const hit = jsQR(image.data, image.width, image.height);
  assert.ok(hit, `no code found for ${JSON.stringify(text.slice(0, 40))}`);
  return hit;
}

const PAYLOADS: [string, string][] = [
  ['umlauts', buildEpcPayload({ name: 'Jürgen Müller-Lüdenscheidt', iban: IBAN, amount: 12.5, purpose: 'Grüße, Rückzahlung für Äpfel & Öl – ß' })],
  ['140-character purpose', buildEpcPayload({ name: 'Max Mustermann', iban: IBAN, amount: 99.99, purpose: PURPOSE_140 })],
  ['70-character name', buildEpcPayload({ name: NAME_70, iban: IBAN })],
  ['no amount', buildEpcPayload({ name: 'Max Mustermann', iban: IBAN, purpose: 'Danke' })],
  ['every element at its limit', buildEpcPayload({ name: 'N'.repeat(70), iban: 'AT611904300234573201', bic: 'BYLADEM1001', amount: 999999999.99, purpose: 'P'.repeat(140) })],
  ['331 bytes', fullestPayload()],
  ['beyond Latin-1', buildEpcPayload({ name: 'Łukasz Wróbel', iban: IBAN, purpose: 'Őrség – € 5' })],
];

for (const [label, payload] of PAYLOADS) {
  test(`round-trips a GiroCode through pixels: ${label}`, () => {
    const hit = roundTrip(payload);
    assert.equal(hit.data, payload);
    // The bytes in the code are UTF-8, as the payload's character set line promises.
    assert.deepEqual(hit.binaryData, Array.from(new TextEncoder().encode(payload)));
    // EPC069-12: a scanner may expect at most a version 13 code at level M.
    assert.ok(hit.version <= 13, `version ${hit.version}`);
  });
}

test('the fixtures are what they claim', () => {
  assert.equal([...NAME_70].length, 70);
  assert.equal(PURPOSE_140.length, 140);
  assert.ok(!PURPOSE_140.endsWith(' '));
  assert.equal(new TextEncoder().encode(fullestPayload()).length, 331);
});

test('round-trips arbitrary text', () => {
  for (const text of ['x', 'https://example.com/a?b=c&d=e', '0123456789', 'emoji 😀 and ½']) {
    assert.equal(roundTrip(text).data, text);
  }
});

test('leaves the library configured as it found it', () => {
  const before = qrcode.stringToBytes;
  qrMatrix('Müller');
  assert.equal(qrcode.stringToBytes, before);
  // …and its default is still the Latin-1 truncation we work around.
  assert.deepEqual(qrcode.stringToBytes('ü'), [0xfc]);
});

test('matrix is square and versioned by size', () => {
  const m = qrMatrix('BCD');
  assert.equal(m.length, 21); // version 1
  for (const row of m) assert.equal(row.length, m.length);
  // Finder pattern in the top-left corner: a 7-module dark top edge, then the light separator.
  assert.deepEqual(m[0].slice(0, 8), [true, true, true, true, true, true, true, false]);
});

test('uses the error-correction level it is given', () => {
  const text = 'x'.repeat(100);
  assert.ok(qrMatrix(text, 'H').length > qrMatrix(text, 'L').length);
});

test('refuses text no QR code can hold', () => {
  assert.throws(() => qrMatrix('x'.repeat(3000), 'H'), /zu lang für einen QR-Code/);
});

test('svg path covers exactly the dark modules, offset by the quiet zone', () => {
  const m = qrMatrix(PAYLOADS[0][1]);
  const { d, size } = qrSvgPath(m);
  assert.equal(size, m.length + 8);
  assert.ok(d.startsWith('M4 4h7v1h-7z'), d.slice(0, 20));

  // Paint the runs back into a grid and compare with the matrix.
  const painted = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  for (const [, x, y, len] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
    for (let i = 0; i < Number(len); i++) {
      assert.equal(painted[Number(y)][Number(x) + i], false, 'runs overlap');
      painted[Number(y)][Number(x) + i] = true;
    }
  }
  assert.equal(d.replace(/M(\d+) (\d+)h(\d+)v1h-\3z/g, ''), '', 'path has only run segments');
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inside = y >= 4 && x >= 4 && y < size - 4 && x < size - 4;
      assert.equal(painted[y][x], inside && m[y - 4][x - 4], `module ${x},${y}`);
    }
  }

  assert.equal(qrSvgPath(m, 0).size, m.length);
  assert.ok(qrSvgPath(m, 0).d.startsWith('M0 0h7'));
  assert.equal(qrSvgPath(m, -3).size, m.length);
});

test('png needs a browser', async () => {
  await assert.rejects(qrPngBlob(qrMatrix('x')), /nur im Browser/);
});
