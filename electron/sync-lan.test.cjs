'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createLanServer, privateAddresses } = require('./sync-lan.cjs');

const GROUP = 'a'.repeat(24);

async function rig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'girovo-lan-'));
  const lan = createLanServer({ http, fs, path, dir: () => dir, log: { warn() {} } });
  // A free port, found by asking the system first.
  const port = await new Promise((resolve) => {
    const probe = http.createServer().listen(0, '127.0.0.1', () => {
      const p = probe.address().port;
      probe.close(() => resolve(p));
    });
  });
  await lan.start(port);
  const ask = (method, name, body) => fetch(`http://127.0.0.1:${port}/girovo-sync/v1/${name}`, { method, body });
  return { dir, lan, ask, done: () => { lan.stop(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('a group this computer is in: files go and come back', async () => {
  const r = await rig();
  try {
    fs.writeFileSync(path.join(r.dir, `${GROUP}.devices`), 'sealed');
    const name = `${GROUP}.${'b'.repeat(16)}.state`;
    assert.equal((await r.ask('GET', name)).status, 404);
    assert.equal((await r.ask('PUT', name, Buffer.from('sealed state'))).status, 204);
    const back = await r.ask('GET', name);
    assert.equal(back.status, 200);
    // Never chunked: the phone reads it over a plain socket.
    assert.equal(back.headers.get('content-length'), String('sealed state'.length));
    assert.equal(back.headers.get('transfer-encoding'), null);
    assert.equal(Buffer.from(await back.arrayBuffer()).toString(), 'sealed state');
  } finally {
    r.done();
  }
});

test('a group it is not in, or a name that is no sync file: nothing', async () => {
  const r = await rig();
  try {
    assert.equal((await r.ask('PUT', `${'c'.repeat(24)}.devices`, Buffer.from('x'))).status, 404);
    assert.equal(fs.readdirSync(r.dir).length, 0);
    fs.writeFileSync(path.join(r.dir, `${GROUP}.devices`), 'sealed');
    assert.equal((await r.ask('GET', `${GROUP}.devices/../../etc`)).status, 404);
    assert.equal((await r.ask('GET', 'index.html')).status, 404);
    assert.equal((await r.ask('DELETE', `${GROUP}.devices`)).status, 405);
  } finally {
    r.done();
  }
});

test('privateAddresses: the home network only, at most four', () => {
  assert.deepEqual(privateAddresses({
    eth: [{ family: 'IPv4', address: '192.168.1.20', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
    lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    vpn: [{ family: 'IPv4', address: '10.8.0.2', internal: false }],
    pub: [{ family: 'IPv4', address: '84.12.0.1', internal: false }],
  }), ['192.168.1.20', '10.8.0.2']);
});
