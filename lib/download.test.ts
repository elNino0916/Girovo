import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadBlob, downloadText, safeFileName, textBlob } from './download.ts';

test('safeFileName keeps ordinary names and defuses the rest', () => {
  assert.equal(safeFileName('Umsaetze_345932_2026-07-05_2026-10-03.csv'), 'Umsaetze_345932_2026-07-05_2026-10-03.csv');
  assert.equal(safeFileName('GiroCode Max Müller.png'), 'GiroCode Max Müller.png');
  assert.equal(safeFileName('..\\..\\Windows/system32:evil?.csv'), '.._.._Windows_system32_evil_.csv');
  assert.equal(safeFileName('Kontoauszug.pdf. . '), 'Kontoauszug.pdf');
  assert.equal(safeFileName('a\u0000b\nc'), 'a_b_c');
  assert.equal(safeFileName('   '), 'download');
  assert.equal(safeFileName('', 'GiroCode.png'), 'GiroCode.png');
  assert.equal(safeFileName('x'.repeat(300)).length, 180);
});

test('textBlob stores UTF-8 with the given type', async () => {
  const blob = textBlob('﻿ä;€', 'text/csv;charset=utf-8');
  assert.equal(blob.type, 'text/csv;charset=utf-8');
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [0xef, 0xbb, 0xbf, 0xc3, 0xa4, 0x3b, 0xe2, 0x82, 0xac]);
  assert.equal(textBlob('x').type, 'text/plain;charset=utf-8');
});

test('downloads are a no-op without a document', () => {
  assert.doesNotThrow(() => downloadBlob('a.txt', new Blob(['a'])));
  assert.doesNotThrow(() => downloadText('a.txt', 'a', 'text/plain'));
});
