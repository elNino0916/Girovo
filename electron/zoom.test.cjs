'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { zoomCommand, nextZoomLevel, MIN_LEVEL, MAX_LEVEL } = require('./zoom.cjs');

const press = (key, extra = {}) => ({ type: 'keyDown', control: true, key, code: '', ...extra });

test('Strg++ zooms in on a German keyboard, where "+" needs no Shift', () => {
  assert.equal(zoomCommand(press('+', { code: 'BracketRight' })), 'in');
});

test('a US keyboard\'s Ctrl+= and Ctrl+Shift+= zoom in too, and so does the number pad', () => {
  assert.equal(zoomCommand(press('=', { code: 'Equal' })), 'in');
  assert.equal(zoomCommand(press('+', { code: 'Equal', shift: true })), 'in');
  assert.equal(zoomCommand(press('+', { code: 'NumpadAdd' })), 'in');
});

test('Strg+- zooms out and Strg+0 resets, from either row of keys', () => {
  assert.equal(zoomCommand(press('-', { code: 'Slash' })), 'out');
  assert.equal(zoomCommand(press('-', { code: 'NumpadSubtract' })), 'out');
  assert.equal(zoomCommand(press('0', { code: 'Digit0' })), 'reset');
  assert.equal(zoomCommand(press('0', { code: 'Numpad0' })), 'reset');
});

test('nothing without Strg, with AltGr, on key up, or for other keys', () => {
  assert.equal(zoomCommand(press('+', { control: false })), null);
  // AltGr is Ctrl+Alt to Windows: AltGr++ types "~", AltGr+0 "}".
  assert.equal(zoomCommand(press('~', { alt: true })), null);
  assert.equal(zoomCommand(press('+', { alt: true })), null);
  assert.equal(zoomCommand(press('+', { type: 'keyUp' })), null);
  assert.equal(zoomCommand(press('k')), null);
  assert.equal(zoomCommand(undefined), null);
});

test('Cmd stands in for Strg on macOS', () => {
  assert.equal(zoomCommand(press('+', { control: false, meta: true })), 'in');
});

test('the level moves in half steps, within its bounds, and resets to 0', () => {
  assert.equal(nextZoomLevel(0, 'in'), 0.5);
  assert.equal(nextZoomLevel(-1, 'out'), -1.5);
  assert.equal(nextZoomLevel(MAX_LEVEL, 'in'), MAX_LEVEL);
  assert.equal(nextZoomLevel(MIN_LEVEL, 'out'), MIN_LEVEL);
  assert.equal(nextZoomLevel(-3.5, 'reset'), 0);
  // A level from before the bounds existed comes back in a step.
  assert.equal(nextZoomLevel(-7, 'in'), MIN_LEVEL);
  assert.equal(nextZoomLevel(NaN, 'in'), 0.5);
});
