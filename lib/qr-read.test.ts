import { test } from 'node:test';
import assert from 'node:assert/strict';
import qrcode from 'qrcode-generator';
import { buildEpcPayload, parseEpcPayload } from './girocode.ts';
import { qrMatrix, type QrMatrix } from './qr.ts';
import { decodeQrBytes, passesFor, readQrFromBlob, readQrFromImageData, stretchContrast } from './qr-read.ts';
import { rasterise } from './__fixtures__/io-raster.ts';

const IBAN = 'DE02120300000000202051';
const PAYLOAD = buildEpcPayload({ name: 'Jürgen Müller', iban: IBAN, amount: 42, purpose: 'Grüße' });

test('reads a plain black-on-white code', () => {
  assert.equal(readQrFromImageData(rasterise(qrMatrix(PAYLOAD))), PAYLOAD);
});

test('reads an inverted code', () => {
  const image = rasterise(qrMatrix(PAYLOAD), { dark: [255, 255, 255, 255], light: [0, 0, 0, 255] });
  assert.equal(readQrFromImageData(image), PAYLOAD);
});

test('reads a code exported on a transparent background', () => {
  // What a "save as PNG with transparency" gives: light modules are fully
  // transparent black, which jsQR — ignoring alpha — would see as black.
  const image = rasterise(qrMatrix(PAYLOAD), { dark: [0, 0, 0, 255], light: [0, 0, 0, 0] });
  assert.equal(readQrFromImageData(image), PAYLOAD);
});

test('reads a light code drawn for a dark page on a transparent background', () => {
  const image = rasterise(qrMatrix(PAYLOAD), { dark: [255, 255, 255, 255], light: [255, 255, 255, 0] });
  assert.equal(readQrFromImageData(image), PAYLOAD);
});

test('reads a pale code once the contrast is stretched', () => {
  // ~15 luminance levels apart: below jsQR's 24-level floor, so raw it sees a flat image.
  const image = rasterise(qrMatrix(PAYLOAD), { dark: [196, 206, 222, 255], light: [214, 220, 230, 255] });
  assert.equal(readQrFromImageData(image), null);
  assert.equal(readQrFromImageData(stretchContrast(image)), PAYLOAD);
});

test('stretchContrast maps the extremes to black and white', () => {
  const image = rasterise(qrMatrix('x'), { dark: [100, 100, 100, 255], light: [140, 140, 140, 255] });
  stretchContrast(image);
  const values = new Set<number>();
  for (let i = 0; i < image.data.length; i += 4) {
    assert.equal(image.data[i], image.data[i + 1]);
    assert.equal(image.data[i], image.data[i + 2]);
    values.add(image.data[i]);
  }
  assert.deepEqual([...values].sort((a, b) => a - b), [0, 255]);
});

/** A GiroCode written the way some invoicing tools do: charset "2", ISO 8859-1 bytes. */
function latin1Code(text: string): QrMatrix {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte'); // the library's default stringToBytes is charCode & 0xff — Latin-1
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

test('reads a Latin-1 GiroCode by its declared character set', () => {
  const text = ['BCD', '002', '2', 'SCT', '', 'Jürgen Müller', IBAN, 'EUR10.00', '', '', 'Grüße aus Köln'].join('\n');
  const read = readQrFromImageData(rasterise(latin1Code(text)));
  assert.equal(read, text);
  assert.deepEqual(parseEpcPayload(read!), { name: 'Jürgen Müller', iban: IBAN, amount: 10, purpose: 'Grüße aus Köln' });
});

test('decodeQrBytes: UTF-8, declared charsets, ECI, Latin-1 fallback', () => {
  const utf8 = (s: string) => Array.from(new TextEncoder().encode(s));
  const latin1 = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
  assert.equal(decodeQrBytes(utf8('Müller ő €')), 'Müller ő €');
  assert.equal(decodeQrBytes(latin1('BCD\n002\n2\nSCT\n\nMüller')), 'BCD\n002\n2\nSCT\n\nMüller');
  // ISO 8859-15 has € at 0xA4.
  assert.equal(decodeQrBytes([...latin1('BCD\r\n002\r\n8\r\nSCT\r\n\r\n5 '), 0xa4]), 'BCD\r\n002\r\n8\r\nSCT\r\n\r\n5 €');
  // A code claiming UTF-8 whose bytes are not: still every byte becomes a character.
  assert.equal(decodeQrBytes(latin1('BCD\n002\n1\nSCT\n\nMüller')), 'BCD\n002\n1\nSCT\n\nMüller');
  // An explicit ECI wins: 3 is ISO 8859-1, so these two bytes are "Ã¼", not "ü".
  assert.equal(decodeQrBytes([0xc3, 0xbc], 3), 'Ã¼');
  assert.equal(decodeQrBytes([0xc3, 0xbc], 26), 'ü');
  assert.equal(decodeQrBytes([]), '');
});

test('finds nothing where there is nothing', () => {
  const blank = { data: new Uint8ClampedArray(64 * 64 * 4).fill(255), width: 64, height: 64 };
  assert.equal(readQrFromImageData(blank), null);
  assert.equal(readQrFromImageData({ data: new Uint8ClampedArray(0), width: 0, height: 0 }), null);
  // Too few bytes for the stated size.
  assert.equal(readQrFromImageData({ data: new Uint8ClampedArray(10), width: 64, height: 64 }), null);
});

test('pass plan: enlarge previews, fit screenshots, look again only at 4K', () => {
  const plan = (w: number, h: number) => passesFor(w, h).map((p) => `${+p.scale.toFixed(3)}${p.inversion === 'attemptBoth' ? '' : '!'}`);
  // A 90 px preview: as is, then every enlargement that stays within 1600 px.
  assert.deepEqual(plan(90, 90), ['1', '2', '3', '4', '6', '8']);
  assert.deepEqual(plan(300, 200), ['1', '2', '3', '4']);
  assert.deepEqual(plan(700, 700), ['1', '2']);
  // Medium and full-HD: one pass, fitted to 1600 px.
  assert.deepEqual(plan(1400, 900), ['1']);
  assert.deepEqual(plan(1080, 1920), ['0.833']);
  assert.deepEqual(plan(2560, 1440), ['0.625']);
  // 4K: fitted, then upright codes only at 2560 px.
  assert.deepEqual(plan(3840, 2160), ['0.417', '0.667!']);
});

test('readQrFromBlob is browser-only and resolves null elsewhere', async () => {
  assert.equal(await readQrFromBlob(new Blob(['not an image'])), null);
});
