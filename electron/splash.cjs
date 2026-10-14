'use strict';

// The window shown while Girovo starts (main.cjs).
//
// Until now nothing appeared before the server answered and the page had
// drawn — usually a second or two, but after an update or a restart of the
// computer, when Windows reads some 1,600 files for the first time, long
// enough to wonder whether the click registered. This window comes up as soon
// as Electron is ready and says what the start is doing, step by step, with
// the version; after a while without the app's window it says that the first
// start after an update or a restart often takes longer.
//
// It is the card of the update and error windows (build/update-window/
// UpdateWindow.cs): the G€ plate and the wordmark, 16px corners, Segoe UI
// Variable, the same light and dark palettes. A transparent, frameless window
// draws it with its shadow (electron/splash.html); the window takes the
// card's height.
//
// The steps and their states are worked out here (splashModel), so the page
// only draws what it is given — and every word comes from electron/i18n.cjs.

const path = require('node:path');

/** The steps a start goes through, in order. `finishing` only after an update. */
const STEPS = ['finishing', 'preparing', 'opening'];

/** Window width: the 440px card and the margins its shadow needs (as UpdateWindow.cs). */
const WIDTH = 440 + 2 * 28;

/** How long a start may take before the window says that it takes longer. */
const SLOW_AFTER_MS = 10_000;

/**
 * The window stays at least this long once it is in view (the owner's call,
 * 2026-10-07): a fast start shows it for a moment that can be read, never a
 * flash. main.cjs waits for held() before it shows the app's window.
 */
const MIN_VISIBLE_MS = 2_000;

/**
 * What the page draws: the texts, the theme and each step's state — done
 * before `current`, active at it, pending after. `finishing` is shown only
 * for a start that follows an update.
 */
function splashModel({ current, updated, texts, version, portable, dark, slow }) {
  const steps = STEPS.filter((key) => key !== 'finishing' || updated);
  const at = Math.max(0, steps.indexOf(current));
  return {
    dark: !!dark,
    title: texts.title,
    version: texts.version(version) + (portable ? ` · ${texts.portable}` : ''),
    steps: steps.map((key, i) => ({
      key,
      label: texts.steps[key],
      state: i < at ? 'done' : i === at ? 'active' : 'pending',
    })),
    note: slow ? texts.slow : null,
  };
}

/**
 * Opens the splash. `deps.BrowserWindow` is Electron's; the rest says what to
 * show. Answers the handle main.cjs drives: `step(key)` moves on, `close()`
 * ends it (once the app's window is there), `window` for its bounds, and
 * `onClosedByUser(fn)` for a start the user called off by closing it.
 */
function createSplash({ BrowserWindow, texts, version, portable, dark, updated, icon }) {
  let current = updated ? 'finishing' : 'preparing';
  let slow = false;
  let closing = false;
  let onUserClose = null;

  const model = () => splashModel({ current, updated, texts: texts(), version, portable, dark, slow });

  const win = new BrowserWindow({
    width: WIDTH,
    height: 320,
    useContentSize: true,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: true,
    fullscreenable: false,
    show: false,
    center: true,
    title: 'Girovo',
    ...(icon ? { icon } : {}),
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  // The first frame already holds everything: the model travels in the hash.
  void win.loadFile(path.join(__dirname, 'splash.html'), {
    hash: encodeURIComponent(JSON.stringify(model())),
  });

  // Drawn, then measured: the window takes the card's height, still centred
  // where it was.
  const fit = async () => {
    if (win.isDestroyed()) return;
    const height = await win.webContents
      .executeJavaScript('Math.ceil(document.querySelector(".frame").getBoundingClientRect().height)')
      .catch(() => 0);
    if (!height || win.isDestroyed()) return;
    const b = win.getBounds();
    const [, contentHeight] = win.getContentSize();
    if (contentHeight === height) return;
    win.setBounds({ x: b.x, y: Math.round(b.y - (height - contentHeight) / 2), width: b.width, height: b.height + height - contentHeight });
  };

  const render = () => {
    if (win.isDestroyed()) return;
    void win.webContents
      .executeJavaScript(`window.splash && window.splash.render(${JSON.stringify(model())})`)
      .then(fit, () => {});
  };

  // In view as soon as it is drawn; held() counts from then.
  let markShown;
  const shown = new Promise((resolve) => { markShown = resolve; });
  win.once('ready-to-show', () => {
    void fit().then(() => {
      if (!win.isDestroyed() && !closing) win.show();
      markShown(Date.now());
    });
  });

  const slowTimer = setTimeout(() => {
    slow = true;
    render();
  }, SLOW_AFTER_MS);
  slowTimer.unref?.();

  win.on('closed', () => {
    clearTimeout(slowTimer);
    markShown(0);
    if (!closing && onUserClose) onUserClose();
  });

  return {
    window: win,
    step(key) {
      if (!STEPS.includes(key) || key === current) return;
      current = key;
      render();
    },
    /** Resolves once the window has been in view for MIN_VISIBLE_MS (at once if it is gone). */
    held() {
      return shown.then((at) => new Promise((resolve) => {
        setTimeout(resolve, at ? Math.max(0, at + MIN_VISIBLE_MS - Date.now()) : 0);
      }));
    },
    close() {
      closing = true;
      clearTimeout(slowTimer);
      if (!win.isDestroyed()) win.destroy();
    },
    onClosedByUser(fn) {
      onUserClose = fn;
    },
    focus() {
      if (win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.focus();
    },
  };
}

module.exports = { createSplash, splashModel, STEPS, SLOW_AFTER_MS, MIN_VISIBLE_MS };
