'use strict';

// Zooming the window from the keyboard: Strg++ / Strg+- / Strg+0, as in a
// browser.
//
// The View menu's roles (main.cjs) cannot do it on every keyboard. Their
// zoom-in accelerator is "Ctrl+Plus", which Windows registers as
// Ctrl+Shift+= — the "+" of a US keyboard. A German keyboard's "+" key sends
// "+" without Shift, so Strg+- shrank the page and Strg++ never brought it
// back (and Chromium kept that level for the next start too — main.cjs now
// opens every start at 100 %). So the window
// reads the keys itself (before-input-event) by the character they type —
// "+", "=" or the number pad's plus — which holds for any layout.

/** One step, as the menu's roles take it (Chromium's levels: 1.2^level). */
const STEP = 0.5;
/** 1.2^-4 ≈ 48 %, 1.2^4 ≈ 207 %: small enough to see everything, large enough to read. */
const MIN_LEVEL = -4;
const MAX_LEVEL = 4;

/**
 * What a key press asks of the zoom: 'in', 'out', 'reset', or null for
 * anything else. Only Strg (Cmd on macOS) with the key — never with Alt,
 * because AltGr is Ctrl+Alt to Windows and types characters of its own
 * (AltGr++ is "~" on a German keyboard).
 */
function zoomCommand(input) {
  if (!input || input.type !== 'keyDown') return null;
  if (!(input.control || input.meta) || input.alt) return null;
  const { key, code } = input;
  if (key === '+' || key === '=' || code === 'NumpadAdd') return 'in';
  if (key === '-' || key === '_' || code === 'NumpadSubtract') return 'out';
  if (key === '0' || code === 'Numpad0') return 'reset';
  return null;
}

/** The zoom level after `command`, kept within MIN_LEVEL…MAX_LEVEL. */
function nextZoomLevel(level, command) {
  const current = Number.isFinite(level) ? level : 0;
  if (command === 'reset') return 0;
  const next = current + (command === 'in' ? STEP : -STEP);
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, next));
}

module.exports = { zoomCommand, nextZoomLevel, MIN_LEVEL, MAX_LEVEL };
