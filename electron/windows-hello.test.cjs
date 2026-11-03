'use strict';

// Electron and Girovo-Hello.exe are not needed: the helper comes in through
// createWindowsHello's arguments, faked here with a real RSA key, so the
// PKCS#1 v1.5 check and the key it yields are the real thing.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createHelperRunner, createWindowsHello } = require('./windows-hello.cjs');

/** A Windows Hello that signs with an RSA key per name, and a file system in a Map. */
function rig({ supported = true, pss = false } = {}) {
  const files = new Map();
  const keys = new Map();
  const calls = [];
  let next = null;
  const sign = (name, challenge) => crypto.sign('sha256', Buffer.from(challenge, 'base64'), {
    key: keys.get(name).privateKey,
    padding: pss ? crypto.constants.RSA_PKCS1_PSS_PADDING : crypto.constants.RSA_PKCS1_PADDING,
  }).toString('base64');
  const run = async (request) => {
    calls.push(request);
    if (next) {
      const answer = next;
      next = null;
      return answer;
    }
    switch (request.op) {
      case 'probe':
        return { supported };
      case 'create': {
        keys.set(request.name, crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }));
        const publicKey = keys.get(request.name).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
        return { status: 'Success', publicKey, signature: sign(request.name, request.challenge) };
      }
      case 'sign':
        if (!keys.has(request.name)) return { status: 'NotFound' };
        return { status: 'Success', signature: sign(request.name, request.challenge) };
      case 'delete':
        keys.delete(request.name);
        return { status: 'Success' };
      default:
        return { error: 'unknown op' };
    }
  };
  const fs = {
    readFile: async (f) => {
      if (!files.has(f)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return files.get(f);
    },
    writeFile: async (f, data) => { files.set(f, String(data)); },
    rename: async (from, to) => {
      files.set(to, files.get(from));
      files.delete(from);
    },
    rm: async (f) => { files.delete(f); },
  };
  const make = (platform = 'win32') => createWindowsHello({
    run, file: () => 'C:/data/windows-hello.json', fs, crypto, platform, log: { warn() {} },
  });
  return { files, keys, calls, make, answerNext: (a) => { next = a; } };
}

test('available: asked once per run, and never off Windows', async () => {
  const r = rig();
  const hello = r.make();
  assert.equal(await hello.available(), true);
  assert.equal(await hello.available(), true);
  assert.equal(r.calls.filter((c) => c.op === 'probe').length, 1);
  assert.equal(await rig().make('linux').available(), false);
  assert.equal(await rig({ supported: false }).make().available(), false);
});

test('the first enroll makes a key, and unlock brings the same key back', async () => {
  const r = rig();
  const hello = r.make();
  assert.equal(await hello.enrolled(), false);
  const enrolled = await hello.enroll();
  assert.equal(enrolled.result, 'enrolled');
  assert.equal(enrolled.fresh, true);
  assert.equal(Buffer.from(enrolled.key, 'base64').length, 32);
  assert.equal(await hello.enrolled(), true);
  const unlocked = await hello.unlock();
  assert.deepEqual(unlocked, { result: 'unlocked', key: enrolled.key });
  // A new start of the app reads the same state and gets the same key.
  assert.deepEqual(await r.make().unlock(), { result: 'unlocked', key: enrolled.key });
});

test('a second enroll reuses the key: one gesture, the same key', async () => {
  const r = rig();
  const hello = r.make();
  const first = await hello.enroll();
  const again = await hello.enroll();
  assert.equal(again.result, 'enrolled');
  assert.equal(again.fresh, false);
  assert.equal(again.key, first.key);
  assert.equal(r.calls.filter((c) => c.op === 'create').length, 1);
});

test('a key that signs differently each time is never used', async () => {
  const r = rig({ pss: true });
  const hello = r.make();
  assert.deepEqual(await hello.enroll(), { result: 'failed' });
  assert.equal(await hello.enrolled(), false);
  assert.ok(r.calls.some((c) => c.op === 'delete'));
});

test('canceled at the prompt: nothing changes', async () => {
  const r = rig();
  const hello = r.make();
  await hello.available();
  r.answerNext({ status: 'UserCanceled' });
  assert.deepEqual(await hello.enroll(), { result: 'canceled' });
  assert.equal(await hello.enrolled(), false);
  await hello.enroll();
  r.answerNext({ status: 'UserCanceled' });
  assert.deepEqual(await hello.unlock(), { result: 'canceled' });
  assert.equal(await hello.enrolled(), true);
});

test('a key Windows no longer has, or one replaced since: invalidated, and the state goes', async () => {
  const r = rig();
  const hello = r.make();
  await hello.enroll();
  const { name } = JSON.parse(r.files.get('C:/data/windows-hello.json'));
  r.keys.delete(name);
  assert.deepEqual(await hello.unlock(), { result: 'invalidated' });
  assert.equal(await hello.enrolled(), false);

  await hello.enroll();
  const state = JSON.parse(r.files.get('C:/data/windows-hello.json'));
  r.keys.set(state.name, crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }));
  assert.deepEqual(await hello.unlock(), { result: 'invalidated' });
  assert.equal(await hello.enrolled(), false);
});

test('enroll after the key was lost makes a new one under the same name', async () => {
  const r = rig();
  const hello = r.make();
  const first = await hello.enroll();
  const { name } = JSON.parse(r.files.get('C:/data/windows-hello.json'));
  r.keys.delete(name);
  const again = await hello.enroll();
  assert.equal(again.result, 'enrolled');
  assert.equal(again.fresh, true);
  assert.notEqual(again.key, first.key);
  assert.equal(JSON.parse(r.files.get('C:/data/windows-hello.json')).name, name);
});

test('nothing enrolled: unlock says missing; reset deletes key and state', async () => {
  const r = rig();
  const hello = r.make();
  assert.deepEqual(await hello.unlock(), { result: 'missing' });
  await hello.enroll();
  await hello.reset();
  assert.equal(await hello.enrolled(), false);
  assert.equal(r.keys.size, 0);
});

test('a helper that fails or says nothing useful: failed, never a key', async () => {
  const r = rig();
  const hello = r.make();
  r.answerNext({ error: 'boom' });
  assert.deepEqual(await hello.enroll(), { result: 'unavailable' });
  const s = rig();
  const h = s.make();
  await h.available();
  s.answerNext({ status: 'SecurityDeviceLocked' });
  assert.deepEqual(await h.enroll(), { result: 'failed' });
});

test('what Windows threw comes back with its code, a made-up code never', async () => {
  const r = rig();
  const hello = r.make();
  await hello.available();
  // Windows Hello's key storage gone (NTE_NOT_FOUND): the create throws.
  r.answerNext({ error: 'Das Objekt wurde nicht gefunden.', code: '0x80090011' });
  assert.deepEqual(await hello.enroll(), { result: 'failed', code: '0x80090011' });
  assert.equal(await hello.enrolled(), false);
  r.answerNext({ error: 'odd', code: 'rm -rf' });
  assert.deepEqual(await hello.enroll(), { result: 'failed' });
  // An enrolled key whose signing throws: the code too, and the state stays.
  await hello.enroll();
  r.answerNext({ error: 'Das Objekt wurde nicht gefunden.', code: '0x80090011' });
  assert.deepEqual(await hello.unlock(), { result: 'failed', code: '0x80090011' });
  r.answerNext({ error: 'Das Objekt wurde nicht gefunden.', code: '0x80090011' });
  assert.deepEqual(await hello.enroll(), { result: 'failed', code: '0x80090011' });
  assert.equal(await hello.enrolled(), true);
});

test('one helper at a time: a second request waits for the first', async () => {
  const r = rig();
  const hello = r.make();
  await hello.enroll();
  const order = [];
  await Promise.all([
    hello.unlock().then(() => order.push('a')),
    hello.unlock().then(() => order.push('b')),
  ]);
  assert.deepEqual(order, ['a', 'b']);
});

/** A child process that answers `reply` on stdout and records what came on stdin. */
function fakeSpawn(reply, { hang = false } = {}) {
  const seen = { args: null, stdin: '' };
  const spawn = (cmd, args) => {
    seen.cmd = cmd;
    seen.args = args;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => { child.emit('close', null); };
    child.stdin.on('data', (d) => { seen.stdin += d; });
    child.stdin.on('finish', () => {
      if (hang) return;
      child.stdout.end(reply);
      setImmediate(() => child.emit('close', 0));
    });
    return child;
  };
  return { spawn, seen };
}

test('the runner sends one JSON line and reads the last line back', async () => {
  const { spawn, seen } = fakeSpawn('noise\r\n{"supported":true}\r\n');
  const run = createHelperRunner({ spawn, helper: () => 'C:/app/resources/Girovo-Hello.exe' });
  assert.deepEqual(await run({ op: 'probe' }), { supported: true });
  assert.deepEqual(JSON.parse(seen.stdin), { op: 'probe' });
  assert.equal(seen.cmd, 'C:/app/resources/Girovo-Hello.exe');
  assert.deepEqual(seen.args, []);
});

test('the runner rejects garbage and gives up on a helper that never answers', async () => {
  const garbage = createHelperRunner({ spawn: fakeSpawn('not json').spawn, helper: () => 'x.exe' });
  await assert.rejects(garbage({ op: 'probe' }));
  const hanging = createHelperRunner({ spawn: fakeSpawn('', { hang: true }).spawn, helper: () => 'x.exe', timeoutMs: 50 });
  await assert.rejects(hanging({ op: 'sign' }), /timed out/);
});
