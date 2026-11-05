'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { splashModel } = require('./splash.cjs');
const { TEXTS } = require('./i18n.cjs');

const base = { texts: TEXTS.de.splash, version: '5.2.1', portable: false, dark: false, slow: false };
const states = (model) => model.steps.map((s) => `${s.key}:${s.state}`);

test('an ordinary start: getting ready, then opening the window', () => {
  assert.deepEqual(states(splashModel({ ...base, current: 'preparing', updated: false })), ['preparing:active', 'opening:pending']);
  assert.deepEqual(states(splashModel({ ...base, current: 'opening', updated: false })), ['preparing:done', 'opening:active']);
});

test('after an update, finishing it comes first', () => {
  assert.deepEqual(
    states(splashModel({ ...base, current: 'finishing', updated: true })),
    ['finishing:active', 'preparing:pending', 'opening:pending'],
  );
  assert.deepEqual(
    states(splashModel({ ...base, current: 'opening', updated: true })),
    ['finishing:done', 'preparing:done', 'opening:active'],
  );
});

test('updates at start: the check between getting ready and the window', () => {
  assert.deepEqual(
    states(splashModel({ ...base, current: 'checking', updated: false, checks: true })),
    ['preparing:done', 'checking:active', 'opening:pending'],
  );
});

test('an update found: its download with the progress, then its install, in place of the window', () => {
  const at = (current, progress = null) => splashModel({ ...base, current, updated: false, checks: true, update: '6.0.1', progress });
  assert.deepEqual(states(at('downloading', 42)), ['preparing:done', 'checking:done', 'downloading:active', 'installing:pending']);
  assert.deepEqual(at('downloading', 42).steps.map((s) => s.label), [
    'Girovo vorbereiten', 'Nach Updates suchen', 'Version 6.0.1 herunterladen · 42 %', 'Version 6.0.1 installieren',
  ]);
  assert.equal(at('installing').steps[2].label, 'Version 6.0.1 herunterladen', 'the progress only while it downloads');
  assert.equal(at('downloading', 42).title, 'Girovo wird aktualisiert');
  assert.equal(splashModel({ ...base, current: 'checking', updated: false, checks: true }).title, 'Girovo wird gestartet');
  assert.equal(splashModel({ ...base, current: 'downloading', updated: false, checks: true, update: '6.0.1', slow: true }).note, null);
});

test('the version, portable or not, and the note once it is slow', () => {
  const model = splashModel({ ...base, current: 'preparing', updated: false });
  assert.equal(model.version, 'Version 5.2.1');
  assert.equal(model.note, null);
  const slow = splashModel({ ...base, current: 'preparing', updated: false, portable: true, slow: true });
  assert.equal(slow.version, 'Version 5.2.1 · portabel');
  assert.equal(slow.note, TEXTS.de.splash.slow);
});

test('every word in the language asked for', () => {
  const en = splashModel({ ...base, texts: TEXTS.en.splash, current: 'preparing', updated: true });
  assert.equal(en.title, 'Starting Girovo');
  assert.deepEqual(en.steps.map((s) => s.label), ['Finish the update', 'Get Girovo ready', 'Open the window']);
});

test('German and English say the same things', () => {
  const keys = (o) => Object.keys(o).sort();
  assert.deepEqual(keys(TEXTS.en.splash), keys(TEXTS.de.splash));
  assert.deepEqual(keys(TEXTS.en.splash.steps), keys(TEXTS.de.splash.steps));
});
