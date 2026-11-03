'use strict';

// Electron is not needed: safeStorage and fs come in through
// createLinkedUnlockSecret's arguments, faked here.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createLinkedUnlockSecret, SECRET_BYTES } = require('./linked-unlock.cjs');

/** A safeStorage that "seals" by prefixing, and a file system in a Map. */
function rig({ available = true, backend, failDecrypt = false, reEncrypt = false } = {}) {
  const files = new Map();
  const calls = { encrypt: 0, decrypt: 0 };
  const safeStorage = {
    isAsyncEncryptionAvailable: async () => available,
    encryptStringAsync: async (text) => {
      calls.encrypt++;
      return Buffer.from(`sealed:${text}`);
    },
    decryptStringAsync: async (buf) => {
      calls.decrypt++;
      const text = buf.toString();
      if (failDecrypt || !text.startsWith('sealed:')) throw new Error('decrypt failed');
      return { result: text.slice('sealed:'.length), shouldReEncrypt: reEncrypt };
    },
    ...(backend ? { getSelectedStorageBackend: () => backend } : {}),
  };
  const fs = {
    readFile: async (f) => {
      if (!files.has(f)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return files.get(f);
    },
    writeFile: async (f, data) => { files.set(f, Buffer.from(data)); },
    rename: async (from, to) => {
      files.set(to, files.get(from));
      files.delete(from);
    },
    rm: async (f) => { files.delete(f); },
  };
  const make = () => createLinkedUnlockSecret({
    safeStorage, file: () => 'C:/data/linked-unlock.key', fs, randomBytes: crypto.randomBytes,
    platform: backend ? 'linux' : 'win32', log: { warn() {} },
  });
  return { files, calls, make };
}

test('the first ask makes a secret, keeps it sealed and answers the same one after', async () => {
  const r = rig();
  const keeper = r.make();
  const secret = await keeper.secret();
  assert.equal(Buffer.from(secret, 'base64').length, SECRET_BYTES);
  assert.deepEqual([...r.files.keys()], ['C:/data/linked-unlock.key']);
  assert.equal(r.files.get('C:/data/linked-unlock.key').toString(), `sealed:${secret}`);
  assert.equal(await keeper.secret(), secret);
  // A new start of the app reads the same secret back.
  assert.equal(await r.make().secret(), secret);
  assert.equal(r.calls.encrypt, 1);
});

test('no protected store, no secret: nothing is written', async () => {
  const r = rig({ available: false });
  assert.equal(await r.make().secret(), null);
  assert.equal(r.files.size, 0);
});

test('Linux with Chromium\'s built-in password counts as no protected store', async () => {
  const r = rig({ backend: 'basic_text' });
  assert.equal(await r.make().secret(), null);
  assert.equal(r.files.size, 0);
  const keyring = rig({ backend: 'gnome_libsecret' });
  assert.notEqual(await keyring.make().secret(), null);
});

test('a sealed secret that no longer opens is replaced by a new one', async () => {
  const r = rig();
  r.files.set('C:/data/linked-unlock.key', Buffer.from('from another account'));
  const secret = await r.make().secret();
  assert.equal(Buffer.from(secret, 'base64').length, SECRET_BYTES);
  assert.equal(r.files.get('C:/data/linked-unlock.key').toString(), `sealed:${secret}`);
});

test('shouldReEncrypt seals the same secret again', async () => {
  const r = rig({ reEncrypt: true });
  r.files.set('C:/data/linked-unlock.key', Buffer.from(`sealed:${crypto.randomBytes(32).toString('base64')}`));
  const before = r.files.get('C:/data/linked-unlock.key').toString();
  const secret = await r.make().secret();
  assert.equal(`sealed:${secret}`, before);
  assert.equal(r.calls.encrypt, 1);
});

test('two asks at once share one answer', async () => {
  const r = rig();
  const keeper = r.make();
  const [a, b] = await Promise.all([keeper.secret(), keeper.secret()]);
  assert.equal(a, b);
  assert.equal(r.calls.encrypt, 1);
});
