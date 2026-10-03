import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  boxSalt, deriveKey, deriveKeySync, newSalt, openBox, openWithPin, parseBox, sealBox, sealWithPin,
} from './crypto-box.ts';

// ---------------------------------------------------------------------------
// The device-profile code path as it shipped before crypto-box.ts existed,
// copied verbatim from lib/state-store.ts. Remembered devices on users' disks
// were written by exactly this; if the shared helper ever drifts from it, a
// TAN-free login silently turns into a TAN login after an update.
// ---------------------------------------------------------------------------
const LEGACY_SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const LEGACY_KEY_LEN = 32;

function legacySave(pin: string, data: unknown, savedAt = Date.now()): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pin), salt, LEGACY_KEY_LEN, LEGACY_SCRYPT);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify({ savedAt, data }), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob = {
    v: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ciphertext.toString('base64'),
  };
  return JSON.stringify(blob);
}

function legacyLoad(pin: string, file: string): { savedAt: number; data: unknown } {
  const blob = JSON.parse(file) as { salt: string; iv: string; tag: string; ct: string };
  const salt = Buffer.from(blob.salt, 'base64');
  const key = crypto.scryptSync(String(pin), salt, LEGACY_KEY_LEN, LEGACY_SCRYPT);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(blob.ct, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}

// Written by the legacy path above with a fixed salt (00..0f) and IV (a0..ab),
// PIN 24680. A fixed vector also catches a change to the scrypt cost, which a
// round trip through the same constants would not.
const GOLDEN =
  '{"v":1,"salt":"AAECAwQFBgcICQoLDA0ODw==","iv":"oKGio6Slpqeoqaqr","tag":"0CnsNvvE4edMDNzHyrWEAA==","ct":"VjcMSJfzJ6iMGcLghjh9Dv3gux3RDFglGNKx0ARPfTnwNvDw/j1dPdF2Iq+6OkgeFehlHtLYEV4kHv9bwAPCgFqypHHYvyvFuVTsPejseWXle7hlFHNCVDhJqw6ytGKoupq8n9mcB5P5Bbabd+Y84oBDfbgSDUp00GROcYwx"}';
const GOLDEN_DATA = { bankingInformation: { systemId: 'SYS-4711' }, tanMethodId: 942, tanMediaName: 'Mein iPhone' };

const PROFILE = { bankingInformation: { systemId: 'SYS-1', bpd: { bankName: 'Testbank eG' } }, tanMethodId: 942, tanMediaName: 'Mein Handy' };

test('a profile sealed by the shipped code path opens with the new helper', () => {
  const box = parseBox(JSON.parse(legacySave('12345', PROFILE, 1_700_000_000_000)));
  assert.ok(box, 'legacy envelope parses');
  const parsed = JSON.parse(openWithPin('12345', box).toString('utf8'));
  assert.deepEqual(parsed, { savedAt: 1_700_000_000_000, data: PROFILE });
});

test('a box sealed by the new helper opens with the shipped code path', () => {
  const plaintext = Buffer.from(JSON.stringify({ savedAt: 42, data: PROFILE }), 'utf8');
  const file = JSON.stringify(sealWithPin('12345', plaintext));
  assert.deepEqual(legacyLoad('12345', file), { savedAt: 42, data: PROFILE });
});

test('the golden legacy file still opens', () => {
  const box = parseBox(JSON.parse(GOLDEN));
  assert.ok(box);
  const parsed = JSON.parse(openWithPin('24680', box).toString('utf8'));
  assert.deepEqual(parsed, { savedAt: 1_700_000_000_000, data: GOLDEN_DATA });
});

test('the envelope keeps its keys, order and field sizes', () => {
  const box = sealWithPin('1', Buffer.from('x'));
  assert.deepEqual(Object.keys(box), ['v', 'salt', 'iv', 'tag', 'ct']);
  assert.equal(box.v, 1);
  assert.equal(Buffer.from(box.salt, 'base64').length, 16);
  assert.equal(Buffer.from(box.iv, 'base64').length, 12);
  assert.equal(Buffer.from(box.tag, 'base64').length, 16);
  // Same layout as the legacy writer, key for key.
  assert.deepEqual(Object.keys(JSON.parse(legacySave('1', null))), Object.keys(box));
});

test('a wrong PIN or a flipped bit fails to open', () => {
  const box = sealWithPin('12345', Buffer.from('geheim'));
  assert.throws(() => openWithPin('12346', box));
  const ct = Buffer.from(box.ct, 'base64');
  ct[0] ^= 1;
  assert.throws(() => openWithPin('12345', { ...box, ct: ct.toString('base64') }));
  const tag = Buffer.from(box.tag, 'base64');
  tag[15] ^= 1;
  assert.throws(() => openWithPin('12345', { ...box, tag: tag.toString('base64') }));
});

test('a truncated tag is refused, not accepted as a short tag', () => {
  const box = sealWithPin('12345', Buffer.from('geheim'));
  const short = { ...box, tag: Buffer.from(box.tag, 'base64').subarray(0, 4).toString('base64') };
  assert.equal(parseBox(short), null);
  assert.throws(() => openWithPin('12345', short));
});

test('parseBox accepts only the v1 envelope', () => {
  const box = sealWithPin('1', Buffer.from('x'));
  assert.deepEqual(parseBox(JSON.parse(JSON.stringify(box))), box);
  assert.equal(parseBox(null), null);
  assert.equal(parseBox('nope'), null);
  assert.equal(parseBox({ ...box, v: 2 }), null);
  assert.equal(parseBox({ ...box, salt: undefined }), null);
  assert.equal(parseBox({ ...box, iv: 'AAAA' }), null);
  assert.equal(parseBox({ ...box, ct: 'not base64!' }), null);
});

test('additional data binds a box to its purpose', () => {
  const salt = newSalt();
  const key = deriveKeySync('12345', salt);
  const box = sealBox(key, salt, Buffer.from('{}'), Buffer.from('purpose-a'));
  assert.equal(openBox(key, box, Buffer.from('purpose-a')).toString(), '{}');
  assert.throws(() => openBox(key, box, Buffer.from('purpose-b')));
  assert.throws(() => openBox(key, box));
});

test('one derived key seals many boxes, each with its own IV', () => {
  const salt = newSalt();
  const key = deriveKeySync('12345', salt);
  const a = sealBox(key, salt, Buffer.from('a'));
  const b = sealBox(key, salt, Buffer.from('a'));
  assert.equal(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
  assert.ok(boxSalt(a).equals(salt));
  assert.equal(openWithPin('12345', b).toString(), 'a');
});

test('async and sync key derivation agree', async () => {
  const salt = newSalt();
  assert.ok((await deriveKey('12345', salt)).equals(deriveKeySync('12345', salt)));
});

// ---------------------------------------------------------------------------
// state-store.ts itself, against real files in a scratch STATE_DIR
// ---------------------------------------------------------------------------

test('state-store reads profiles written by the shipped build and writes ones it can read', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fints-state-'));
  process.env.FINTS_STATE_DIR = dir;
  try {
    const store = await import('./state-store.ts');
    // The file name scheme is part of the format too.
    const legacyName = crypto.createHash('sha256').update('12345678|kunde1').digest('hex').slice(0, 32);
    const file = path.join(dir, `${legacyName}.json`);

    fs.writeFileSync(file, legacySave('13579', PROFILE));
    assert.ok(store.hasProfile('12345678', 'kunde1'));
    assert.deepEqual(store.loadProfile('12345678', 'kunde1', '13579'), PROFILE);
    assert.equal(store.loadProfile('12345678', 'kunde1', '97531'), null, 'wrong PIN');

    const old = Date.now() - store.PROFILE_MAX_AGE_MS - 1000;
    fs.writeFileSync(file, legacySave('13579', PROFILE, old));
    assert.equal(store.loadProfile('12345678', 'kunde1', '13579'), null, 'expired');

    const fresh = { ...PROFILE, tanMethodId: 946 } as unknown as Parameters<typeof store.saveProfile>[3];
    assert.ok(store.saveProfile('12345678', 'kunde1', '13579', fresh));
    assert.deepEqual(legacyLoad('13579', fs.readFileSync(file, 'utf8')).data, fresh);
    assert.deepEqual(store.loadProfile('12345678', 'kunde1', '13579'), fresh);

    assert.ok(store.forgetProfile('12345678', 'kunde1'));
    assert.equal(store.hasProfile('12345678', 'kunde1'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
