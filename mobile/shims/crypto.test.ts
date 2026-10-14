import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import phone from './crypto.ts';

// The phone's node:crypto (mobile/shims/crypto.ts) must seal and open exactly
// what Node does: a vault or device profile is the same file format on both,
// and lib/crypto-box.ts runs unchanged on top of either.

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

test('scryptSync derives the key Node derives', () => {
  const salt = crypto.randomBytes(16);
  for (const pin of ['12345', 'pässwört€', '']) {
    assert.deepEqual(
      Buffer.from(phone.scryptSync(pin, salt, 32, SCRYPT)),
      crypto.scryptSync(pin, salt, 32, SCRYPT),
    );
  }
});

test('async scrypt derives the same key', async () => {
  const salt = crypto.randomBytes(16);
  const key = await new Promise<Buffer>((resolve, reject) =>
    phone.scrypt('4711', salt, 32, SCRYPT, (err, k) => (err ? reject(err) : resolve(Buffer.from(k)))),
  );
  assert.deepEqual(key, crypto.scryptSync('4711', salt, 32, SCRYPT));
});

test('hashes match Node', () => {
  for (const alg of ['sha256', 'sha1']) {
    const text = '76050101|kunde01|vault';
    assert.equal(phone.createHash(alg).update(text).digest('hex'), crypto.createHash(alg).update(text).digest('hex'));
    assert.equal(
      phone.createHash(alg).update('blob 3\0').update(Buffer.from('abc')).digest('hex'),
      crypto.createHash(alg).update('blob 3\0').update(Buffer.from('abc')).digest('hex'),
    );
  }
});

function nodeSeal(key: Buffer, plaintext: Buffer, aad?: Buffer) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  if (aad) c.setAAD(aad);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return { iv, ct, tag: c.getAuthTag() };
}

function phoneSeal(key: Buffer, plaintext: Buffer, aad?: Buffer) {
  const iv = crypto.randomBytes(12);
  const c = phone.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  if (aad) c.setAAD(aad);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return { iv, ct, tag: Buffer.from(c.getAuthTag()) };
}

test('a box sealed on the phone opens in Node, and the other way round', () => {
  const key = crypto.randomBytes(32);
  const aad = Buffer.from('girovo/history/v1');
  const plaintext = Buffer.from(JSON.stringify({ note: 'Geschenk für Mama', n: 12.5 }), 'utf8');

  for (const withAad of [aad, undefined]) {
    const a = phoneSeal(key, plaintext, withAad);
    const d = crypto.createDecipheriv('aes-256-gcm', key, a.iv, { authTagLength: 16 });
    if (withAad) d.setAAD(withAad);
    d.setAuthTag(a.tag);
    assert.deepEqual(Buffer.concat([d.update(a.ct), d.final()]), plaintext);

    const b = nodeSeal(key, plaintext, withAad);
    const p = phone.createDecipheriv('aes-256-gcm', key, b.iv, { authTagLength: 16 });
    if (withAad) p.setAAD(withAad);
    p.setAuthTag(b.tag);
    assert.deepEqual(Buffer.concat([p.update(b.ct), p.final()]), plaintext);
  }
});

test('a changed bit, a wrong key or a short tag does not open', () => {
  const key = crypto.randomBytes(32);
  const plaintext = Buffer.from('Kontostand', 'utf8');
  const box = nodeSeal(key, plaintext);
  const open = (k: Buffer, ct: Buffer, tag: Buffer) => {
    const d = phone.createDecipheriv('aes-256-gcm', k, box.iv, { authTagLength: 16 });
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
  };
  const flipped = Buffer.from(box.ct);
  flipped[0] ^= 1;
  assert.throws(() => open(key, flipped, box.tag));
  assert.throws(() => open(crypto.randomBytes(32), box.ct, box.tag));
  assert.throws(() => open(key, box.ct, box.tag.subarray(0, 4)));
});

test('randomBytes gives the size asked for, and differs', () => {
  const a = phone.randomBytes(24);
  assert.equal(a.length, 24);
  assert.notDeepEqual(a, phone.randomBytes(24));
});
