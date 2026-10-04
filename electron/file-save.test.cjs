'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createFileSave, SAVE_MAX_BYTES, SAVE_FAILED } = require('./file-save.cjs');

const FILTERS = {
  '.csv': { name: 'CSV-Datei', extensions: ['csv'] },
  '.png': { name: 'PNG-Bild', extensions: ['png'] },
};
const DOWNLOADS = path.join('C:', 'Users', 'nino', 'Downloads');

/** A save with a scripted dialog and disk; `calls` records what reached them. */
function rig({ answer = { canceled: false, filePath: path.join(DOWNLOADS, 'out.csv') }, writeError = null } = {}) {
  const calls = { dialog: [], written: [] };
  const save = createFileSave({
    showSaveDialog: async (options) => {
      calls.dialog.push(options);
      return answer;
    },
    writeFile: async (file, data) => {
      if (writeError) throw writeError;
      calls.written.push([file, [...data]]);
    },
    downloadsDir: DOWNLOADS,
    filters: FILTERS,
  });
  return { save, calls };
}

const bytes = (...b) => new Uint8Array(b);

test('writes the bytes where the user chose, and only then says ok', async () => {
  const { save, calls } = rig();
  assert.deepEqual(await save('Umsaetze_345932.csv', bytes(0xef, 0xbb, 0xbf, 0x41)), { ok: true });
  assert.deepEqual(calls.dialog, [{ defaultPath: path.join(DOWNLOADS, 'Umsaetze_345932.csv'), filters: [FILTERS['.csv']] }]);
  assert.deepEqual(calls.written, [[path.join(DOWNLOADS, 'out.csv'), [0xef, 0xbb, 0xbf, 0x41]]]);
});

test('a slice of a larger buffer writes only its own bytes', async () => {
  const { save, calls } = rig();
  const whole = bytes(1, 2, 3, 4, 5);
  await save('a.csv', whole.subarray(1, 3));
  assert.deepEqual(calls.written[0][1], [2, 3]);
});

test('a dismissed dialog writes nothing and says so', async () => {
  for (const answer of [{ canceled: true }, { canceled: false, filePath: '' }]) {
    const { save, calls } = rig({ answer });
    assert.deepEqual(await save('a.csv', bytes(1)), { ok: false, canceled: true });
    assert.equal(calls.written.length, 0);
  }
});

test('the suggested name is reduced to a file name in Downloads', async () => {
  const { save, calls } = rig();
  await save('..\\..\\Windows\\evil.csv', bytes(1));
  await save('../../etc/evil.csv', bytes(1));
  for (const options of calls.dialog) assert.equal(path.dirname(options.defaultPath), DOWNLOADS);
});

test('only the types the app makes, real bytes, and a sane size — refused before any dialog', async () => {
  const { save, calls } = rig();
  for (const [name, data] of [
    ['run.exe', bytes(1)],
    ['notes', bytes(1)],
    ['a.csv', 'text'],
    ['a.csv', [1, 2]],
    ['a.csv', null],
    ['a.csv', new Uint8Array(SAVE_MAX_BYTES + 1)],
  ]) {
    assert.deepEqual(await save(name, data), { ok: false, error: SAVE_FAILED }, name);
  }
  assert.equal(calls.dialog.length, 0);
});

test('a failed write says what to do, in German — a file open in Excel by name', async () => {
  const busy = Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
  const denied = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
  const a = await rig({ writeError: busy }).save('a.csv', bytes(1));
  assert.equal(a.ok, false);
  assert.match(a.error, /in einem anderen Programm geöffnet, zum Beispiel in Excel/);
  const b = await rig({ writeError: denied }).save('a.csv', bytes(1));
  assert.match(b.error, /^Die Datei konnte dort nicht gespeichert werden/);
  assert.doesNotMatch(b.error, /EACCES/);
});
