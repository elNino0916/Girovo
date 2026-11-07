import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Buffer as Shim } from './buffer.ts';

// The in-page server's Buffer (mobile/shims/buffer.ts, on Android and the
// desktop) must speak 'base64url' exactly as Node does: lib/sync.ts writes the
// sync code with it, and a code made on one device is read on another.

const samples = () => Array.from({ length: 41 }, (_, n) => crypto.randomBytes(n));

test('toString(base64url) writes what Node writes', () => {
  for (const bytes of samples()) {
    assert.equal(Shim.from(bytes).toString('base64url'), Buffer.from(bytes).toString('base64url'));
  }
  // The two characters that differ from base64, and no padding.
  assert.equal(Shim.from([0xfb, 0xff, 0xbf]).toString('base64url'), '-_-_');
  assert.equal(Shim.from([0xff]).toString('base64url'), '_w');
});

test('toString(base64url) with a range', () => {
  const bytes = crypto.randomBytes(20);
  assert.equal(Shim.from(bytes).toString('base64url', 3, 11), Buffer.from(bytes).toString('base64url', 3, 11));
});

test('from(…, base64url) reads what Node writes', () => {
  for (const bytes of samples()) {
    const text = Buffer.from(bytes).toString('base64url');
    assert.deepEqual(new Uint8Array(Shim.from(text, 'base64url')), new Uint8Array(bytes));
    assert.equal(Shim.byteLength(text, 'base64url'), Buffer.byteLength(text, 'base64url'));
  }
});

test('the other ways in take base64url too', () => {
  const text = Buffer.from([0xfb, 0xff, 0xbf, 1, 2]).toString('base64url');
  assert.equal(Shim.isEncoding('base64url'), true);
  assert.equal(Shim.isEncoding('BASE64URL'), true);
  assert.equal(Shim.isEncoding('nonsense'), false);

  const written = Shim.alloc(8);
  assert.equal(written.write(text, 1, 'base64url'), 5);
  assert.deepEqual([...written], [0, 0xfb, 0xff, 0xbf, 1, 2, 0, 0]);
  assert.equal(written.write(text, 'base64url'), 5);
  assert.deepEqual([...written.subarray(0, 5)], [0xfb, 0xff, 0xbf, 1, 2]);

  assert.deepEqual([...Shim.alloc(6, '-_-_', 'base64url')], [0xfb, 0xff, 0xbf, 0xfb, 0xff, 0xbf]);
  assert.equal(written.includes('_w', 'base64url'), true); // 0xff
  assert.equal(written.includes('AAE', 'base64url'), false); // 0x00 0x01
  assert.equal(Shim.from([9, 0xff]).indexOf('_w', 0, 'base64url'), 1);
});

test('a sync code survives the round trip', () => {
  const key = crypto.randomBytes(32);
  const payload = JSON.stringify({ k: key.toString('base64'), l: 'a1b2c3d4e5f6', p: { kind: 'lan', addresses: ['192.168.0.7'], port: 47321 } });
  // Made on a phone or the desktop window, read in Node, and the other way round.
  const fromShim = Shim.from(payload, 'utf8').toString('base64url');
  assert.equal(fromShim, Buffer.from(payload, 'utf8').toString('base64url'));
  assert.equal(Shim.from(fromShim, 'base64url').toString('utf8'), payload);
});

test('everything else is the package as it was', () => {
  const bytes = crypto.randomBytes(17);
  for (const encoding of ['base64', 'hex', 'utf8', 'latin1'] as const) {
    const text = Buffer.from(bytes).toString(encoding);
    assert.equal(Shim.from(bytes).toString(encoding), text);
    assert.deepEqual(new Uint8Array(Shim.from(text, encoding)), new Uint8Array(Buffer.from(text, encoding)));
  }
  assert.equal(Shim.from('hallo').toString(), 'hallo');
  assert.throws(() => Shim.from('x', 'nonsense' as BufferEncoding), /Unknown encoding/);
});
