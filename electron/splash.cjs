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
// UpdateWindow.cs), drawn as the app's Material basic dialog: the G€ plate
// with what the window is doing beside it, 28px corners, the app's Google Sans Flex (its own copy in
// electron/fonts — the app's server is not up yet), the same light and dark
// palettes — the app's Material roles (app/material.css). A transparent, frameless window
// draws it with its shadow (electron/splash.html); the window takes the
// card's height.
//
// The steps and their states are worked out here (splashModel), so the page
// only draws what it is given — and every word comes from electron/i18n.cjs.

const path = require('node:path');

/**
 * The steps a start goes through, in order. `finishing` only after an update;
 * `checking` while updates install at start; `downloading`, `installing` and
 * `starting` once that check found a version to install — in place of
 * `opening`, since the installer starts the new version. The install window
 * (build/update-window/UpdateWindow.cs) takes the same list over (view()).
 */
const STEPS = ['finishing', 'preparing', 'checking', 'downloading', 'installing', 'starting', 'opening'];

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
 * for a start that follows an update, `checking` while `checks`, and the
 * download and install of `update` (the version found) with how far the
 * download is (`progress`, 0–100).
 */
function splashModel({ current, updated, checks = false, update = null, progress = null, texts, version, portable, dark, slow }) {
  const steps = STEPS.filter((key) => {
    if (key === 'finishing') return updated;
    if (key === 'checking') return checks;
    if (key === 'downloading' || key === 'installing' || key === 'starting') return !!update;
    if (key === 'opening') return !update;
    return true;
  });
  const at = Math.max(0, steps.indexOf(current));
  const label = (key) => {
    if (key === 'downloading') {
      const base = texts.steps.downloading(update);
      return current === 'downloading' && progress != null ? `${base} · ${texts.progress(progress)}` : base;
    }
    if (key === 'installing') return texts.steps.installing(update);
    return texts.steps[key];
  };
  return {
    dark: !!dark,
    // An update found at start: the window is about the update now, not the start.
    title: update ? texts.titleUpdating : texts.title,
    version: texts.version(version) + (portable ? ` · ${texts.portable}` : ''),
    steps: steps.map((key, i) => ({
      key,
      label: label(key),
      state: i < at ? 'done' : i === at ? 'active' : 'pending',
    })),
    // A download takes its time; the note is about a slow start.
    note: slow && !update ? texts.slow : null,
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
  let checks = false;
  let update = null;
  let progress = null;

  const model = () => splashModel({ current, updated, checks, update, progress, texts: texts(), version, portable, dark, slow });

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
  // where it was. Measured in the font it is shown in, so it waits for that.
  const fit = async () => {
    if (win.isDestroyed()) return;
    const height = await win.webContents
      .executeJavaScript('document.fonts.ready.then(() => Math.ceil(document.querySelector(".frame").getBoundingClientRect().height))')
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
    /** What it shows now — for the install window, which takes over looking the same. */
    view() {
      return model();
    },
    /** This start looks for an update: "Nach Updates suchen" is one of its steps. */
    setChecks(on) {
      if (checks === !!on) return;
      checks = !!on;
      render();
    },
    /** The version found to install (its download and install become the steps), or null again. */
    setUpdate(found) {
      update = found || null;
      progress = null;
      render();
    },
    /** How far the download is, 0–100. */
    progress(percent) {
      const p = Math.max(0, Math.min(100, Math.floor(percent)));
      if (p === progress) return;
      progress = p;
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
