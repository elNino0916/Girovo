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

test('profileState tells no device, one this PIN opens, an expired one and one another PIN made', async () => {
  // Never the real state folder, whichever test runs first.
  if (!process.env.FINTS_STATE_DIR) process.env.FINTS_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fints-state-'));
  const store = await import('./state-store.ts');
  const dir = store.STATE_DIR;
  assert.equal(dir, process.env.FINTS_STATE_DIR);
  try {
    const name = crypto.createHash('sha256').update('87654321|kunde2').digest('hex').slice(0, 32);
    const file = path.join(dir, `${name}.json`);
    const state = (pin: string) => store.profileState('87654321', 'kunde2', pin);

    assert.equal(state('13579'), 'none');

    const profile = PROFILE as unknown as Parameters<typeof store.saveProfile>[3];
    assert.ok(store.saveProfile('87654321', 'kunde2', '13579', profile));
    assert.equal(state('13579'), 'opens');
    assert.equal(state('97531'), 'locked', 'made under another PIN');
    assert.equal(state(''), 'locked', 'no PIN opens nothing');
    assert.equal(store.profileState('87654321', 'kunde3', '13579'), 'none', 'another login');

    // Older than the limit: it opens, and says so. loadProfile hands neither out.
    fs.writeFileSync(file, legacySave('13579', PROFILE, Date.now() - store.PROFILE_MAX_AGE_MS - 1000));
    assert.equal(state('13579'), 'expired');
    assert.equal(state('97531'), 'locked', 'another PIN is another PIN, however old the file');
    assert.equal(store.loadProfile('87654321', 'kunde2', '13579'), null);
    assert.equal(store.loadProfile('87654321', 'kunde2', '97531'), null);

    // Damaged — empty, cut short, not JSON, not an envelope: no PIN's, and
    // never taken for one made under another PIN.
    const whole = JSON.stringify(sealWithPin('13579', Buffer.from(JSON.stringify({ savedAt: Date.now(), data: PROFILE }), 'utf8')));
    for (const text of ['', whole.slice(0, whole.length >> 1), '{"v":1,"salt"', 'not json', '[]', JSON.stringify({ hello: 'world' })]) {
      fs.writeFileSync(file, text);
      assert.equal(state('13579'), 'damaged', JSON.stringify(text.slice(0, 20)));
      assert.equal(state('97531'), 'damaged');
      assert.equal(state(''), 'damaged');
      assert.equal(store.loadProfile('87654321', 'kunde2', '13579'), null);
      assert.ok(store.hasProfile('87654321', 'kunde2'));
    }
    // Opens with the PIN, but holds no profile with a date: damaged too, the PIN was right.
    for (const inside of ['{"data":{}}', '{"savedAt":1}', 'null', 'no json']) {
      fs.writeFileSync(file, JSON.stringify(sealWithPin('13579', Buffer.from(inside, 'utf8'))));
      assert.equal(state('13579'), 'damaged', inside);
      assert.equal(state('97531'), 'locked', 'a whole envelope another PIN does not open');
    }
    // A whole envelope with one byte of it changed: no PIN opens it, and that is all that can be told.
    const flipped = JSON.parse(whole) as { ct: string };
    flipped.ct = `${flipped.ct[0] === 'A' ? 'B' : 'A'}${flipped.ct.slice(1)}`;
    fs.writeFileSync(file, JSON.stringify(flipped));
    assert.equal(state('13579'), 'locked');

    // One opening answers both: the state, and the profile where it opens.
    assert.ok(store.saveProfile('87654321', 'kunde2', '13579', profile));
    assert.deepEqual(store.openProfile('87654321', 'kunde2', '13579'), { state: 'opens', data: PROFILE });
    assert.deepEqual(store.openProfile('87654321', 'kunde2', '97531'), { state: 'locked', data: null });
    fs.writeFileSync(file, legacySave('13579', PROFILE, Date.now() - store.PROFILE_MAX_AGE_MS - 1000));
    assert.deepEqual(store.openProfile('87654321', 'kunde2', '13579'), { state: 'expired', data: null });

    assert.ok(store.forgetProfile('87654321', 'kunde2'));
    assert.equal(state('13579'), 'none');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a kept PIN is stale only where a device is remembered under another PIN; only then do the kept copies go on saving', async () => {
  if (!process.env.FINTS_STATE_DIR) process.env.FINTS_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fints-state-'));
  const { keptPinIsStale, replacesAnotherPin } = await import('./state-store.ts');
  // app/api/connect: refused before the bank is asked.
  assert.equal(keptPinIsStale(true, 'locked'), true);
  // A damaged file is as good as none: the kept PIN may well be the right one.
  for (const state of ['none', 'opens', 'expired', 'damaged'] as const) assert.equal(keptPinIsStale(true, state), false, state);
  // A typed PIN is the user's to try, whatever is remembered; only a real `true` counts as kept.
  for (const kept of [false, undefined, null, 'true', 1]) assert.equal(keptPinIsStale(kept, 'locked'), false, String(kept));
  // lib/session.ts saveSessionProfile: Windows Hello and the security keys go with the old PIN only.
  assert.equal(replacesAnotherPin('locked'), true);
  for (const state of ['none', 'opens', 'expired', 'damaged'] as const) assert.equal(replacesAnotherPin(state), false, state);
});

test('a profile is written whole: no temp file stays, and one a cut-short write left goes with the device', async () => {
  if (!process.env.FINTS_STATE_DIR) process.env.FINTS_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fints-state-'));
  const store = await import('./state-store.ts');
  const dir = store.STATE_DIR;
  assert.equal(dir, process.env.FINTS_STATE_DIR);
  try {
    const name = `${crypto.createHash('sha256').update('87654321|kunde4').digest('hex').slice(0, 32)}.json`;
    const profile = PROFILE as unknown as Parameters<typeof store.saveProfile>[3];
    assert.ok(store.saveProfile('87654321', 'kunde4', '13579', profile));
    assert.ok(store.saveProfile('87654321', 'kunde4', '24680', profile), 'over the one that is there');
    assert.deepEqual(fs.readdirSync(dir), [name]);
    assert.equal(store.profileState('87654321', 'kunde4', '24680'), 'opens');
    assert.equal(store.profileState('87654321', 'kunde4', '13579'), 'locked');

    // What a write that never finished leaves: sealed with a PIN too, so it goes with the profile.
    fs.writeFileSync(path.join(dir, `${name}.0a1b2c3d4e5f.tmp`), '{"v":1');
    fs.writeFileSync(path.join(dir, 'another.json'), '{}');
    assert.ok(store.forgetProfile('87654321', 'kunde4'));
    assert.deepEqual(fs.readdirSync(dir), ['another.json']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a refused PIN is noted beside the profile: known again by that PIN only, gone with the next device saved', async () => {
  if (!process.env.FINTS_STATE_DIR) process.env.FINTS_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fints-state-'));
  const store = await import('./state-store.ts');
  const dir = store.STATE_DIR;
  assert.equal(dir, process.env.FINTS_STATE_DIR);
  try {
    const refused = (pin: string, userId = 'kunde5') => store.pinWasRefused('87654321', userId, pin);
    const profile = PROFILE as unknown as Parameters<typeof store.saveProfile>[3];
    assert.equal(refused('13579'), false, 'nothing noted');

    // The background check's case: the device is remembered under the PIN the bank then refuses.
    assert.ok(store.saveProfile('87654321', 'kunde5', '13579', profile));
    assert.ok(store.markPinRefused('87654321', 'kunde5', '13579'));
    assert.equal(refused('13579'), true);
    assert.equal(refused('24680'), false, 'another PIN is not held back');
    assert.equal(refused(''), false);
    assert.equal(refused('13579', 'kunde6'), false, 'another login');
    // Its own file: the profile is as it was, and the note is not taken for a device.
    assert.equal(store.profileState('87654321', 'kunde5', '13579'), 'opens');
    assert.equal(fs.readdirSync(dir).filter((n) => n.endsWith('.json')).length, 1);
    assert.equal(fs.readdirSync(dir).filter((n) => n.endsWith('.refused')).length, 1);
    // It names neither the login nor the PIN.
    const text = fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((n) => n.endsWith('.refused'))!), 'utf8');
    assert.ok(!text.includes('13579') && !text.includes('kunde5') && !text.includes('87654321'));

    // The device goes for the refusal (lib/background-bank.ts); the note stays, and stands without it.
    assert.ok(store.forgetProfile('87654321', 'kunde5'));
    assert.equal(store.hasProfile('87654321', 'kunde5'), false);
    assert.equal(store.profileState('87654321', 'kunde5', '13579'), 'none');
    assert.equal(refused('13579'), true, 'the kept copy beside another login is still known');

    // A profile put in the note's place is no note: the two are sealed apart.
    const note = path.join(dir, fs.readdirSync(dir).find((n) => n.endsWith('.refused'))!);
    const kept = fs.readFileSync(note, 'utf8');
    fs.writeFileSync(note, JSON.stringify(sealWithPin('13579', Buffer.from('{"refusedAt":1}', 'utf8'))));
    assert.equal(refused('13579'), false);
    fs.writeFileSync(note, '{"v":1');
    assert.equal(refused('13579'), false, 'a damaged note holds nothing back');
    fs.writeFileSync(note, kept);
    assert.equal(refused('13579'), true);

    // One note per login, the latest.
    assert.ok(store.markPinRefused('87654321', 'kunde5', '11111'));
    assert.equal(refused('11111'), true);
    assert.equal(refused('13579'), false);

    // The bank took a PIN and the device is remembered again: the note is gone, whatever PIN it was for.
    assert.ok(store.saveProfile('87654321', 'kunde5', '24680', profile));
    assert.equal(refused('11111'), false);
    assert.equal(fs.readdirSync(dir).filter((n) => n.endsWith('.refused')).length, 0);

    // "Gerät vergessen": the note goes by itself too.
    assert.ok(store.markPinRefused('87654321', 'kunde5', '24680'));
    assert.ok(store.forgetRefusedPin('87654321', 'kunde5'));
    assert.equal(refused('24680'), false);
    assert.ok(store.forgetRefusedPin('87654321', 'kunde5'), 'nothing there is nothing left');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a kept PIN goes to the bank only when neither the device nor a note speaks against it; a typed one always', async () => {
  if (!process.env.FINTS_STATE_DIR) process.env.FINTS_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fints-state-'));
  const store = await import('./state-store.ts');
  const dir = store.STATE_DIR;
  assert.equal(dir, process.env.FINTS_STATE_DIR);
  // The gate as app/api/connect asks it, before the bank is contacted.
  const heldBack = (kept: unknown, pin: string) => kept === true
    && (store.keptPinIsStale(kept, store.openProfile('87654321', 'kunde7', pin).state) || store.pinWasRefused('87654321', 'kunde7', pin));
  try {
    const profile = PROFILE as unknown as Parameters<typeof store.saveProfile>[3];
    // Further bank B: remembered under the old PIN, which is also kept beside first login A.
    assert.ok(store.saveProfile('87654321', 'kunde7', '13579', profile));
    assert.equal(heldBack(true, '13579'), false, 'the device opens: it may log in');
    // The check is refused (try 1): noted, the device deleted (lib/background-bank.ts refused).
    assert.ok(store.markPinRefused('87654321', 'kunde7', '13579'));
    assert.ok(store.forgetProfile('87654321', 'kunde7'));
    // A logs in and hands B's kept PIN on: no device speaks against it any more, the note does. No try 2.
    assert.equal(store.profileState('87654321', 'kunde7', '13579'), 'none');
    assert.equal(heldBack(true, '13579'), true);
    // Typed, the same PIN is the user's to try, and the new one is never held back.
    assert.equal(heldBack(undefined, '13579'), false);
    assert.equal(heldBack(false, '13579'), false);
    assert.equal(heldBack(true, '24680'), false);
    // The user logs in with the new PIN and the bank takes it: from then on only the device decides.
    assert.ok(store.saveProfile('87654321', 'kunde7', '24680', profile));
    assert.equal(heldBack(true, '24680'), false);
    assert.equal(heldBack(true, '13579'), true, 'the old kept copy: the device was made under another PIN');
    // A device file cut short says nothing: the kept PIN is tried.
    fs.writeFileSync(path.join(dir, fs.readdirSync(dir).find((n) => n.endsWith('.json'))!), '{"v":1,"salt"');
    assert.equal(heldBack(true, '24680'), false);
    assert.equal(heldBack(true, '13579'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
