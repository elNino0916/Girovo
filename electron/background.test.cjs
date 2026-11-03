'use strict';

// Electron is not needed: prefs, the secret, the server's check and the
// notifications come in through createBackgroundChecks' arguments.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackgroundChecks, serverCheck, INTERVAL_MS, SETTLE_MS, RETRY_MS, ON_PREF, LAST_PREF } = require('./background.cjs');

function rig({ on = true, last = null, secret = 's3cret', check } = {}) {
  const store = new Map();
  if (on) store.set(ON_PREF, '1');
  if (last != null) store.set(LAST_PREF, String(last));
  const prefs = {
    get: (k) => store.get(k) ?? null,
    set: (k, v) => (v == null ? store.delete(k) : store.set(k, v)),
  };
  let clock = 1_000_000_000;
  const scheduled = [];
  const timers = {
    setTimeout: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      scheduled.push(t);
      return t;
    },
    clearTimeout: (t) => { if (t) t.cleared = true; },
  };
  const notices = [];
  const checks = [];
  const bg = createBackgroundChecks({
    prefs,
    secret: async () => secret,
    check: check ?? (async (s) => {
      checks.push(s);
      return { checked: 1, notices: [{ key: 'a', kind: 'new', title: '2 neue Umsätze bei DKB', text: '', lines: [] }] };
    }),
    notify: (n) => notices.push(n),
    now: () => clock,
    timers,
    log: { warn() {} },
  });
  const pending = () => scheduled.filter((t) => !t.cleared);
  return { bg, store, scheduled, pending, notices, checks, tick: (ms) => { clock += ms; }, now: () => clock };
}

test('off: nothing is scheduled', () => {
  const r = rig({ on: false });
  r.bg.start();
  assert.equal(r.pending().length, 0);
});

test('never checked: the first check two minutes after the start', () => {
  const r = rig();
  r.bg.start();
  assert.deepEqual(r.pending().map((t) => t.ms), [SETTLE_MS]);
});

test('checked an hour ago: the next one five hours on', () => {
  const r = rig({ last: 1_000_000_000 - 3_600_000 });
  r.bg.start();
  assert.deepEqual(r.pending().map((t) => t.ms), [INTERVAL_MS - 3_600_000]);
});

test('a check shows its notices, remembers when it ran, and plans the next in six hours', async () => {
  const r = rig();
  const result = await r.bg.runNow();
  assert.equal(result.checked, 1);
  assert.deepEqual(r.checks, ['s3cret']);
  assert.equal(r.notices[0].title, '2 neue Umsätze bei DKB');
  assert.equal(r.store.get(LAST_PREF), String(r.now()));
  assert.deepEqual(r.pending().map((t) => t.ms), [INTERVAL_MS]);
});

test('a check that fails is tried again in half an hour; no secret counts as failing', async () => {
  const failing = rig({ check: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal(await failing.bg.runNow(), null);
  assert.deepEqual(failing.pending().map((t) => t.ms), [RETRY_MS]);
  assert.equal(failing.store.get(LAST_PREF), undefined);
  const secretless = rig({ secret: null });
  assert.equal(await secretless.bg.runNow(), null);
  assert.deepEqual(secretless.pending().map((t) => t.ms), [RETRY_MS]);
});

test('two calls at once run one check', async () => {
  const r = rig();
  await Promise.all([r.bg.runNow(), r.bg.runNow()]);
  assert.equal(r.checks.length, 1);
});

test('switching it off stops the plan; on plans the first check soon', () => {
  const r = rig({ on: false });
  r.bg.setEnabled(true);
  assert.equal(r.store.get(ON_PREF), '1');
  assert.deepEqual(r.pending().map((t) => t.ms), [SETTLE_MS]);
  r.bg.setEnabled(false);
  assert.equal(r.pending().length, 0);
  assert.equal(r.store.has(ON_PREF), false);
});

test('back from sleep past the due time: checked once the network is back', () => {
  const r = rig({ last: 1_000_000_000 });
  r.bg.start();
  r.tick(INTERVAL_MS * 2);
  r.bg.resumed();
  assert.deepEqual(r.pending().map((t) => t.ms), [SETTLE_MS]);
});

test('serverCheck posts op check with the secret and the language cookie', async () => {
  let seen;
  const check = serverCheck({
    origin: () => 'http://127.0.0.1:4711',
    locale: () => 'en',
    cookie: 'girovo-locale',
    fetch: async (url, init) => {
      seen = { url, init };
      return { ok: true, json: async () => ({ checked: 0, notices: [] }) };
    },
  });
  assert.deepEqual(await check('s3cret'), { checked: 0, notices: [] });
  assert.equal(seen.url, 'http://127.0.0.1:4711/api/background');
  assert.deepEqual(JSON.parse(seen.init.body), { op: 'check', secret: 's3cret' });
  assert.equal(seen.init.headers.cookie, 'girovo-locale=en');
  const refused = serverCheck({ origin: () => 'x', locale: () => null, cookie: 'c', fetch: async () => ({ ok: false, status: 404 }) });
  await assert.rejects(refused('s'), /404/);
});
