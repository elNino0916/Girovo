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

const { app, BrowserWindow, Menu, dialog, nativeTheme, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const HOST = '127.0.0.1';
const SERVER_START_TIMEOUT_MS = 60_000;

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
let quitting = false;

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

  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    // Matches the theme colours in app/layout.tsx so the frame does not flash
    // white while the first paint is on its way.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0f0d' : '#ecefea',
    title: 'Sooskasse-FinTS',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  // The app needs no device access at all — deny every request rather than
  // prompting the user inside something that shows their bank account.
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, callback) => callback(false));

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

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('will-quit', stopServer);
  process.on('exit', stopServer);
}
