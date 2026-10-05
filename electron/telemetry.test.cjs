'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTelemetryHub, relayServerLine, lineSplitter, MARK, CONSENT_PREF, ID_PREF } = require('./telemetry.cjs');

/** A stand-in for the SDK instance that records every call. */
function fakeClient() {
  const calls = [];
  return {
    calls,
    identify: (id) => calls.push(['identify', id]),
    captureError: (e, props) => calls.push(['error', e.name, e.message, props]),
    track: (name, props) => calls.push(['track', name, props]),
    metric: (name, value, props) => calls.push(['metric', name, value, props]),
    shutdown: async () => calls.push(['shutdown']),
  };
}

function setup(initial = {}) {
  const prefs = new Map(Object.entries(initial));
  const client = fakeClient();
  let n = 0;
  const hub = createTelemetryHub({
    client,
    getPref: (k) => prefs.get(k) ?? null,
    setPref: (k, v) => prefs.set(k, v),
    delPref: (k) => prefs.delete(k),
    randomId: () => `id-${++n}`,
  });
  return { hub, client, prefs };
}

test('errors go out without consent — scrubbed, without an install id', () => {
  const { hub, client, prefs } = setup();
  assert.equal(hub.consent(), 'unasked');
  hub.error(new TypeError('Empfänger: Max Mustermann'), { source: 'route', route: '/api/transfer', blz: '37040044', note: 'x' });
  assert.deepEqual(client.calls, [
    ['identify', undefined],
    ['error', 'TypeError', 'Empfänger: […]', { source: 'route', route: '/api/transfer', blz: '37040044' }],
  ]);
  assert.equal(prefs.has(ID_PREF), false, 'nothing stored for an error report');
});

test('usage waits for the yes', () => {
  const { hub, client } = setup();
  hub.event('screen_viewed', { screen: 'umsaetze' });
  hub.metric('bank.request_ms', 120, { blz: '37040044', ok: true });
  assert.equal(client.calls.filter(([k]) => k !== 'identify').length, 0);

  const off = setup({ [CONSENT_PREF]: 'off' });
  off.hub.event('screen_viewed', { screen: 'umsaetze' });
  assert.equal(off.client.calls.filter(([k]) => k !== 'identify').length, 0);
});

test('with the yes: an install id, declared events and fields only', () => {
  const { hub, client, prefs } = setup();
  hub.setConsent(true);
  assert.equal(prefs.get(CONSENT_PREF), 'on');
  assert.equal(prefs.get(ID_PREF), 'id-1');
  hub.event('login_result', { blz: '37040044', outcome: 'ok', ms: 812.4, userId: 'erika', iban: 'DE89…' });
  hub.event('made_up_event', { a: 1 });
  hub.metric('bank.request_ms', 99.6, { blz: '37040044', ok: true, path: '/x' });
  hub.metric('bank.request_ms', NaN, {});
  assert.deepEqual(client.calls.slice(1), [
    ['identify', 'id-1'],
    ['track', 'login_result', { blz: '37040044', outcome: 'ok', ms: 812 }],
    ['metric', 'bank.request_ms', 100, { blz: '37040044', ok: true }],
  ]);
});

test('switching usage off deletes the install id', () => {
  const { hub, client, prefs } = setup({ [CONSENT_PREF]: 'on', [ID_PREF]: 'kept-id' });
  assert.deepEqual(client.calls[0], ['identify', 'kept-id']);
  hub.setConsent(false);
  assert.equal(prefs.get(CONSENT_PREF), 'off');
  assert.equal(prefs.has(ID_PREF), false);
  assert.deepEqual(client.calls.at(-1), ['identify', undefined]);
  // Back on: a new id, not the old one.
  hub.setConsent(true);
  assert.equal(prefs.get(ID_PREF), 'id-1');
});

test('without a client nothing happens', () => {
  const hub = createTelemetryHub({ client: null, getPref: () => null, setPref() {}, delPref() {}, randomId: () => 'x' });
  hub.error(new Error('x'));
  hub.event('screen_viewed', { screen: 'a' });
  assert.equal(hub.consent(), 'unasked');
});

test('shutdown does not wait longer than allowed', async () => {
  const { hub, client } = setup();
  client.shutdown = () => new Promise(() => {});
  const started = Date.now();
  await hub.shutdown(50);
  assert.ok(Date.now() - started < 1000);
});

test('relayServerLine: the server is held to the same rules', () => {
  const { hub, client } = setup();
  relayServerLine(hub, MARK + JSON.stringify({ t: 'error', name: 'Error', message: 'Konto 0532013000', props: { route: '/api/balance', blz: '37040044', fatal: true } }));
  relayServerLine(hub, MARK + JSON.stringify({ t: 'event', name: 'login_result', props: { outcome: 'ok' } }));
  relayServerLine(hub, MARK + '{not json');
  assert.deepEqual(client.calls.slice(1), [
    ['error', 'Error', 'Konto [Zahl]', { source: 'server', route: '/api/balance', blz: '37040044', fatal: true }],
  ]);
});

test('lineSplitter: telemetry lines are taken out, the log stays intact', () => {
  const tel = [];
  let text = '';
  const feed = lineSplitter((l) => tel.push(l), (t) => { text += t; });
  feed('ready on 127.0.0.1\n' + MARK.slice(0, 5));
  feed(MARK.slice(5) + '{"t":"event"}\npartial');
  feed(' line\n');
  assert.deepEqual(tel, [MARK + '{"t":"event"}']);
  assert.equal(text, 'ready on 127.0.0.1\npartial line\n');
});
