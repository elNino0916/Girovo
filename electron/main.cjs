'use strict';

// Desktop shell for Sooskasse-FinTS.
//
// The app is a server app, not a static site: every logged-in user is a live
// FinTS dialog held in one long-lived Node process (see next.config.ts), and the
// API routes talk to the bank over TCP. So the desktop build does not "export"
// the site — it boots the very same Next server the website workflow runs and
// points a window at it.
//
// That server runs as a child process rather than inside this one. Electron's
// own binary re-executed with ELECTRON_RUN_AS_NODE=1 is a plain Node runtime,
// so nothing extra has to be installed on the machine, the server keeps its own
// heap and cwd, and a crash there cannot take the window down with it.
//
// It listens on 127.0.0.1 and an ephemeral port: a banking app has no business
// being reachable from the LAN, and a fixed port would collide with `npm run
// dev` on port 3000.

const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const HOST = '127.0.0.1';
const SERVER_START_TIMEOUT_MS = 60_000;

// Matches --bar / --bar-ink in app/globals.css. The window has no native
// title bar of its own — the app's navy identity bar (Dashboard.tsx) doubles
// as the title bar, with the OS caption buttons floating in its right side,
// so there is exactly one bar instead of a native one stacked on the app's.
const BAR_COLORS = {
  light: { color: '#0a2c5e', symbolColor: '#ffffff' },
  dark: { color: '#08192b', symbolColor: '#f1f5f9' },
};
// Matches --scrim (app/globals.css). A dialog lays it over the whole page,
// masthead included, but the caption buttons are drawn by the OS above the
// page, where no scrim reaches: they stayed a bright navy block in the
// darkened bar. So while a dialog is open the renderer reports how many
// scrims lie over that corner (lib/theme.ts, setCaptionDim) and the overlay
// takes BAR_COLORS composited under that many — the very colour the scrim
// gives the masthead beside it.
const SCRIM = {
  light: { rgb: [10, 22, 40], alpha: 0.45 },
  dark: { rgb: [0, 0, 0], alpha: 0.6 },
};
// Dialogs stack (a confirmation over a sheet); past this the bar is as good
// as black in either theme.
const MAX_CAPTION_DIM = 3;

/** `hex` with `layers` of `scrim` laid over it, as '#rrggbb'. */
function underScrim(hex, scrim, layers) {
  const n = parseInt(hex.slice(1), 16);
  let rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  for (let i = 0; i < layers; i++) rgb = rgb.map((v, k) => v * (1 - scrim.alpha) + scrim.rgb[k] * scrim.alpha);
  return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/** The caption overlay's colours for a theme, under `dim` scrims. */
function barColors(isDark, dim) {
  const theme = isDark ? 'dark' : 'light';
  const base = BAR_COLORS[theme];
  if (!dim) return base;
  return {
    color: underScrim(base.color, SCRIM[theme], dim),
    symbolColor: underScrim(base.symbolColor, SCRIM[theme], dim),
  };
}
// Matches --paper: what shows while the first frame is on its way and in the
// strip a resize briefly uncovers.
const PAPER = { light: '#f4f6f9', dark: '#061423' };
// Must track --barbar-h's desktop value (app/globals.css). The mobile media
// query drops that variable to 56px, but the window never gets that narrow
// (minWidth below), so the desktop value is the only one that matters here.
// A mismatch made the OS-drawn caption buttons cover only the top 56px of
// the 60px bar; the leftover 4px strip repainted incorrectly whenever the
// window's caption geometry changed, which is why clicking maximize/restore
// visibly glitched the icons.
const TITLEBAR_HEIGHT = 60;

/** Where the standalone Next build lives, packaged and unpackaged. */
function serverDir() {
  // electron-builder ships .next/standalone as an extraResource, deliberately
  // outside the asar archive — a child process cannot execute a file from
  // inside one.
  return app.isPackaged
    ? path.join(process.resourcesPath, 'server')
    : path.join(app.getAppPath(), '.next', 'standalone');
}

/** @type {import('node:child_process').ChildProcess | null} */
let server = null;
/** @type {BrowserWindow | null} */
let win = null;
/** Origin of the page the window shows; the only one the IPC bridges answer. */
let appOrigin = '';
let quitting = false;

// ---------------------------------------------------------------------------
// Preferences
//
// localStorage is keyed by origin, and the packaged app serves its UI from a
// fresh random port on every start — so every start would forget the theme,
// the "Beträge ausblenden" toggle and the idle limit. Those few UI
// preferences live in userData/prefs.json instead, behind a *synchronous*
// bridge (preload.cjs → window.electronStore), so layout.tsx's pre-paint theme
// script can read the theme before the first frame and nothing flashes.
//
// Deliberately narrow: `fints.*` keys, short string values, a bounded count.
// This is for preferences, not data — anything personal (IBANs, names,
// categories) belongs in the PIN-encrypted vault (lib/vault.ts), never here.
// ---------------------------------------------------------------------------
const PREF_KEY = /^fints\.[\w.-]{1,80}$/;
const PREF_VALUE_MAX = 4096;
const PREF_MAX_KEYS = 200;

/** @type {Map<string, string> | null} */
let prefsCache = null;

const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
const validPrefKey = (key) => typeof key === 'string' && PREF_KEY.test(key);

/** The preferences, read from disk once and served from memory after that. */
function prefs() {
  if (prefsCache) return prefsCache;
  prefsCache = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [key, value] of Object.entries(raw)) {
        if (prefsCache.size >= PREF_MAX_KEYS) break;
        if (validPrefKey(key) && typeof value === 'string' && value.length <= PREF_VALUE_MAX) {
          prefsCache.set(key, value);
        }
      }
    }
  } catch {
    // First start, or a file that no longer parses: start empty. The next
    // write replaces it — these are preferences, losing them is harmless.
  }
  return prefsCache;
}

/** Blocks this thread for `ms` — only ever a few milliseconds, see writePrefs. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Persist the cache: write a temp file, then rename it over prefs.json, so a
 * crash mid-write leaves the old file rather than half a new one. Windows
 * refuses the rename while another process (a virus scanner, the indexer)
 * briefly holds the target open, so it gets a few short retries.
 */
function writePrefs() {
  const file = prefsFile();
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(prefs()), null, 2), { mode: 0o600, flush: true });
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(tmp, file);
        return true;
      } catch (err) {
        if (attempt >= 3 || !['EPERM', 'EACCES', 'EBUSY'].includes(err?.code)) throw err;
        sleepSync(20 * (attempt + 1));
      }
    }
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch { /* best effort */ }
    console.warn('[prefs] could not save:', err?.code || err?.message || err);
    return false;
  }
}

function setPref(key, value) {
  if (!validPrefKey(key) || typeof value !== 'string' || value.length > PREF_VALUE_MAX) return false;
  const store = prefs();
  if (store.get(key) === value) return true;
  if (!store.has(key) && store.size >= PREF_MAX_KEYS) return false;
  store.set(key, value);
  return writePrefs();
}

function delPref(key) {
  if (!validPrefKey(key)) return false;
  const store = prefs();
  if (!store.has(key)) return true;
  store.delete(key);
  return writePrefs();
}

/** Whether an IPC message was sent by the app's own page, not some other frame. */
function fromApp(event) {
  try {
    return !!appOrigin && new URL(event.senderFrame?.url || '').origin === appOrigin;
  } catch {
    return false;
  }
}

/**
 * Register a handler for ipcRenderer.sendSync. The renderer stays blocked
 * until `returnValue` is set, so it is set on every path — a validation
 * failure or a throw answers `fallback` instead of freezing the window.
 */
function onSync(channel, handler, fallback) {
  ipcMain.on(channel, (event, ...args) => {
    let result = fallback;
    try {
      if (fromApp(event)) result = handler(...args);
    } catch (err) {
      console.warn(`[prefs] ${channel} failed:`, err?.message || err);
    }
    event.returnValue = result;
  });
}

/** The theme the window opens in: the user's stored choice, else the OS's. */
function prefersDark() {
  const stored = prefs().get('fints.theme');
  if (stored === 'dark') return true;
  if (stored === 'light') return false;
  return nativeTheme.shouldUseDarkColors;
}

// ---------------------------------------------------------------------------
// Session policy
// ---------------------------------------------------------------------------

// The app needs no device access — every permission is denied rather than
// prompting the user inside something that shows their bank account. The one
// exception is writing to the clipboard (navigator.clipboard.writeText, behind
// "IBAN kopieren"): write-only, sanitised by Chromium, and only for the app's
// own page. Reading the clipboard stays denied; pasting a GiroCode goes
// through the paste event, which needs no permission at all.
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write']);

// Files the app hands over as Blob + <a download>. Chromium's own Save-As
// dialog is kept — the user decides where a file with bank data lands — but
// it opens in Downloads and with a type filter, so an export cannot be saved
// without its extension by accident.
const DOWNLOAD_FILTERS = {
  '.csv': { name: 'CSV-Datei', extensions: ['csv'] },
  '.png': { name: 'PNG-Bild', extensions: ['png'] },
  '.pdf': { name: 'PDF', extensions: ['pdf'] },
};

/** @type {WeakSet<Electron.Session>} */
const configuredSessions = new WeakSet();

function configureSession(ses) {
  if (configuredSessions.has(ses)) return;
  configuredSessions.add(ses);

  const isAppUrl = (url) => {
    try {
      return !!appOrigin && new URL(url).origin === appOrigin;
    } catch {
      return false;
    }
  };

  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && isAppUrl(details?.requestingUrl || wc?.getURL() || ''));
  });
  // Checks (navigator.permissions.query, and Chromium's own pre-flight before
  // a request) must agree with the request handler, or the page is told
  // "granted" for something that is then refused, or the reverse.
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) =>
    ALLOWED_PERMISSIONS.has(permission) && isAppUrl(requestingOrigin),
  );

  ses.on('will-download', (_event, item) => {
    const name = path.basename(item.getFilename() || 'Download');
    const filter = DOWNLOAD_FILTERS[path.extname(name).toLowerCase()];
    item.setSaveDialogOptions({
      defaultPath: path.join(app.getPath('downloads'), name),
      ...(filter ? { filters: [filter] } : {}),
    });
  });
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, HOST, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** Resolves once the server answers an HTTP request, rejects on timeout. */
function waitForServer(port, deadline) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (server && server.exitCode !== null) {
        reject(new Error(`Der Server wurde mit Code ${server.exitCode} beendet.`));
        return;
      }
      // /api/meta is the cheapest route that also proves the bank database was
      // found on disk, so a broken package fails here rather than in the UI.
      const req = http.get({ host: HOST, port, path: '/api/meta', timeout: 2000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', () => {
        if (Date.now() > deadline) {
          reject(new Error('Der Server hat nicht rechtzeitig geantwortet.'));
        } else {
          setTimeout(attempt, 150);
        }
      });
    };
    attempt();
  });
}

async function startServer() {
  const dir = serverDir();
  const entry = path.join(dir, 'server.js');
  if (!fs.existsSync(entry)) {
    throw new Error(
      `Der gebaute Server fehlt (${entry}).\n\n` +
        'Führe zuerst "npm run electron:build" aus.',
    );
  }

  const port = await findFreePort();

  server = spawn(process.execPath, [entry], {
    cwd: dir, // the API routes read banks-data.json and config.json from cwd
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      HOSTNAME: HOST,
      PORT: String(port),
      // The installed app directory is read-only, so remembered device profiles
      // go to the per-user data folder instead of next to the executable.
      FINTS_STATE_DIR: path.join(app.getPath('userData'), 'fints-state'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  // Surface server output on the terminal when one is attached; without this a
  // packaging problem would be completely silent.
  server.stdout.on('data', (b) => process.stdout.write(`[server] ${b}`));
  server.stderr.on('data', (b) => process.stderr.write(`[server] ${b}`));
  server.on('exit', (code) => {
    server = null;
    if (!quitting) {
      dialog.showErrorBox('Sooskasse-FinTS', `Der Server wurde unerwartet beendet (Code ${code}).`);
      app.quit();
    }
  });

  await waitForServer(port, Date.now() + SERVER_START_TIMEOUT_MS);
  return `http://${HOST}:${port}`;
}

function stopServer() {
  if (!server) return;
  const child = server;
  server = null;
  child.kill();
}

function createWindow(appUrl) {
  const origin = new URL(appUrl).origin;
  appOrigin = origin;
  // The stored theme, not just the OS's: with "Hell" picked on a dark system
  // the window would otherwise open dark and visibly flip on first paint.
  const dark = prefersDark();
  const initialBar = dark ? BAR_COLORS.dark : BAR_COLORS.light;

  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    // Matches --paper in app/globals.css so the frame does not flash white
    // while the first paint is on its way.
    backgroundColor: dark ? PAPER.dark : PAPER.light,
    title: 'Sooskasse-FinTS',
    autoHideMenuBar: true,
    // No native title bar: Dashboard.tsx's navy bar is dragged into service as
    // the title bar instead, via the Window Controls Overlay API. Not
    // supported on macOS, which keeps its usual traffic-light hidden bar.
    titleBarStyle: 'hidden',
    ...(process.platform !== 'darwin'
      ? { titleBarOverlay: { ...initialBar, height: TITLEBAR_HEIGHT } }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // Permissions (deny all but clipboard writes) and the download dialog.
  configureSession(win.webContents.session);

  // Bank and Brandfetch links belong in the real browser; the window itself
  // stays on the local server.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:$/.test(new URL(url).protocol)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  win.on('closed', () => {
    win = null;
  });

  win.loadURL(appUrl);
}

// A minimal menu: hidden behind Alt, but it is what registers the zoom,
// reload and devtools accelerators on Windows.
function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: '&Datei',
        submenu: [{ role: 'quit', label: 'Beenden' }],
      },
      {
        label: '&Bearbeiten',
        submenu: [
          { role: 'cut', label: 'Ausschneiden' },
          { role: 'copy', label: 'Kopieren' },
          { role: 'paste', label: 'Einfügen' },
          { role: 'selectAll', label: 'Alles auswählen' },
        ],
      },
      {
        label: '&Ansicht',
        submenu: [
          { role: 'reload', label: 'Neu laden' },
          { type: 'separator' },
          { role: 'resetZoom', label: 'Zoom zurücksetzen' },
          { role: 'zoomIn', label: 'Vergrößern' },
          { role: 'zoomOut', label: 'Verkleinern' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: 'Vollbild' },
          { role: 'toggleDevTools', label: 'Entwicklertools' },
        ],
      },
    ]),
  );
}

// Two instances would mean two servers and two copies of the FinTS session
// state; focus the existing window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    buildMenu();
    try {
      // ELECTRON_START_URL points the shell at an already-running `npm run dev`
      // (see the electron:dev script) instead of the built server.
      const appUrl = process.env.ELECTRON_START_URL || (await startServer());
      createWindow(appUrl);
    } catch (err) {
      dialog.showErrorBox('Sooskasse-FinTS konnte nicht starten', String(err?.message || err));
      app.quit();
    }
  });

  // The overlay colour is fixed at window creation from the stored theme (or
  // the OS preference); the renderer's effective light/dark can still differ —
  // "System" follows the OS live — so it corrects the overlay as soon as it
  // knows which theme it's showing. `dim` is how many dialog scrims cover the
  // caption corner right now (see SCRIM above); the renderer is not trusted
  // with more than a small whole number.
  ipcMain.on('titlebar:set-theme', (_event, isDark, dim) => {
    if (!win) return;
    const dark = isDark === true;
    win.setBackgroundColor(dark ? PAPER.dark : PAPER.light);
    if (process.platform === 'darwin') return;
    const layers = Number.isInteger(dim) ? Math.min(Math.max(dim, 0), MAX_CAPTION_DIM) : 0;
    win.setTitleBarOverlay({ ...barColors(dark, layers), height: TITLEBAR_HEIGHT });
  });

  // window.electronStore (preload.cjs) — see "Preferences" above.
  onSync('store:get', (key) => (validPrefKey(key) ? prefs().get(key) ?? null : null), null);
  onSync('store:set', (key, value) => setPref(key, value), false);
  onSync('store:del', (key) => delPref(key), false);

  // Statement.tsx's window.print() route hands the PDF off to whatever the OS
  // print dialog offers — on Windows that is the "Microsoft Print to PDF"
  // virtual printer, whose driver is a separate, occasionally broken OS
  // component (it fails with "Configuration error. 0x80070002" on machines
  // where that driver is corrupt, missing, or blocked by policy, and there is
  // nothing this app can do about the driver itself). printToPDF renders the
  // same print-stylesheet snapshot straight out of Chromium instead, so the
  // export no longer depends on any printer or driver being installed at all.
  ipcMain.handle('pdf:export', async (event, suggestedName) => {
    const contents = event.sender;
    const owner = BrowserWindow.fromWebContents(contents) ?? win;
    let data;
    try {
      data = await contents.printToPDF({ printBackground: true, preferCSSPageSize: true });
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }

    const { canceled, filePath } = await dialog.showSaveDialog(owner ?? undefined, {
      defaultPath: suggestedName,
      filters: [{ name: 'PDF-Dokument', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };

    try {
      await fs.promises.writeFile(filePath, data);
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
    return { ok: true, filePath };
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('will-quit', stopServer);
  process.on('exit', stopServer);
}
