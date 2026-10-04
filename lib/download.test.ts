import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadBlob, safeFileName, saveFile, textBlob } from './download.ts';

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
});

/** Runs `fn` with a stand-in for the desktop shell's window.electronFiles. */
async function withShell<T>(save: (name: string, bytes: Uint8Array) => Promise<unknown>, fn: () => Promise<T>): Promise<T> {
  const g = globalThis as { window?: unknown };
  const before = g.window;
  g.window = { electronFiles: { save } };
  try {
    return await fn();
  } finally {
    if (before === undefined) delete g.window;
    else g.window = before;
  }
}

test('saveFile: outside the desktop shell it is a plain download the browser confirms', async () => {
  assert.equal(await saveFile('a.csv', new Blob(['a'])), 'handed-over');
});

test('saveFile: "saved" only once the shell has written the file, with its bytes and a safe name', async () => {
  const calls: Array<[string, number[]]> = [];
  const outcome = await withShell(async (name, bytes) => {
    calls.push([name, [...bytes]]);
    return { ok: true };
  }, () => saveFile('Umsätze: Juli?.csv', textBlob('ä', 'text/csv')));
  assert.equal(outcome, 'saved');
  assert.deepEqual(calls, [['Umsätze_ Juli_.csv', [0xc3, 0xa4]]]);
});

test('saveFile: a dismissed Save-As is "canceled", not an error and not a save', async () => {
  const outcome = await withShell(async () => ({ ok: false, canceled: true }), () => saveFile('a.csv', new Blob(['a'])));
  assert.equal(outcome, 'canceled');
});

test('saveFile: a failed write throws the shell\'s message, or a German one', async () => {
  await assert.rejects(
    withShell(async () => ({ ok: false, error: 'Die Datei ist noch in einem anderen Programm geöffnet.' }), () => saveFile('a.csv', new Blob(['a']))),
    { message: 'Die Datei ist noch in einem anderen Programm geöffnet.' },
  );
  await assert.rejects(
    withShell(async () => { throw new Error('IPC gone'); }, () => saveFile('a.csv', new Blob(['a']))),
    { message: 'Die Datei konnte nicht gespeichert werden.' },
  );
  await assert.rejects(
    withShell(async () => ({ ok: false, error: '' }), () => saveFile('a.csv', new Blob(['a']))),
    { message: 'Die Datei konnte nicht gespeichert werden.' },
  );
});
