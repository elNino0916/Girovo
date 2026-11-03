'use strict';

// Bridges the renderer's theme toggle to the frameless window's caption-button
// overlay (see BAR_COLORS in main.cjs) — the overlay colour is set once at
// window creation from the OS preference, and the app's own light/dark choice
// can differ, so the renderer corrects it as soon as it knows which theme it's
// actually showing. `dim` is how many dialog scrims cover the caption corner,
// so the OS-drawn buttons darken with the masthead around them (SCRIM in
// main.cjs).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronTitleBar', {
  setTheme: (isDark, dim) => ipcRenderer.send('titlebar:set-theme', !!isDark, Number.isInteger(dim) ? dim : 0),
});

// SessionGuard.tsx's last minute before the automatic logout: while another
// window is in front, the taskbar button flashes until this one is focused
// again (or the warning closes and sends false). It never brings the window
// forward on its own.
contextBridge.exposeInMainWorld('electronWindow', {
  requestAttention: (on) => ipcRenderer.send('window:attention', on === true),
});

// Statement.tsx's PDF export: renders straight out of Chromium via
// webContents.printToPDF in the main process, then a native save dialog — no
// OS print driver ("Microsoft Print to PDF") involved, see main.cjs.
contextBridge.exposeInMainWorld('electronPDF', {
  exportPDF: (suggestedName) => ipcRenderer.invoke('pdf:export', suggestedName),
});

// Saving a file the app made (the CSV export) through a native Save-As, so the
// page hears whether the file was written before it says "gespeichert" — a
// plain download cannot tell it. See main.cjs's file:save handler.
//
// Anything but bytes goes over as null: main refuses it before any dialog,
// with its message in the shell's language (electron/i18n.cjs), which this
// sandboxed preload cannot load itself.
contextBridge.exposeInMainWorld('electronFiles', {
  save: (suggestedName, bytes) =>
    ipcRenderer.invoke('file:save', String(suggestedName ?? ''), ArrayBuffer.isView(bytes) ? bytes : null),
});

// In-app updates (electron/updater.cjs). Every call answers with the
// updater's state; onState hears every change, download progress included,
// and returns its own unsubscribe.
contextBridge.exposeInMainWorld('electronUpdater', {
  getState: () => ipcRenderer.invoke('updater:get'),
  check: () => ipcRenderer.invoke('updater:check'),
  download: () => ipcRenderer.invoke('updater:download'),
  cancel: () => ipcRenderer.invoke('updater:cancel'),
  install: () => ipcRenderer.invoke('updater:install'),
  setAuto: (on) => ipcRenderer.invoke('updater:set-auto', on === true),
  setChannel: (channel) => ipcRenderer.invoke('updater:set-channel', channel === 'preview' ? 'preview' : 'stable'),
  openRelease: () => ipcRenderer.invoke('updater:open-release'),
  onState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('updater:state', listener);
    return () => ipcRenderer.removeListener('updater:state', listener);
  },
});

// Preferences that must survive a restart (theme, "Beträge ausblenden", idle
// limit). Synchronous on purpose: layout.tsx's pre-paint script reads the
// theme before the first frame. Backed by userData/prefs.json in main.cjs,
// because localStorage is lost with the random port of every packaged start.
// Validated here and again in main — the main process never trusts a renderer.
const PREF_KEY = /^fints\.[\w.-]{1,80}$/;
const PREF_VALUE_MAX = 4096;

contextBridge.exposeInMainWorld('electronStore', {
  get: (key) => {
    if (typeof key !== 'string' || !PREF_KEY.test(key)) return null;
    try {
      const value = ipcRenderer.sendSync('store:get', key);
      return typeof value === 'string' ? value : null;
    } catch {
      return null;
    }
  },
  set: (key, value) => {
    if (typeof key !== 'string' || !PREF_KEY.test(key)) return;
    if (typeof value !== 'string' || value.length > PREF_VALUE_MAX) return;
    try {
      ipcRenderer.sendSync('store:set', key, value);
    } catch { /* the page keeps working with its in-memory state */ }
  },
  del: (key) => {
    if (typeof key !== 'string' || !PREF_KEY.test(key)) return;
    try {
      ipcRenderer.sendSync('store:del', key);
    } catch { /* as above */ }
  },
});

// Telemetry (electron/telemetry.cjs). The page's errors always go to the
// main process, which scrubs them; its usage events only count once the user
// said yes — consent() is that answer ('on', 'off' or 'unasked'), read
// synchronously so the Übersicht knows at first paint whether to ask.
const short = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

// "Weitere Banken mit anmelden" (lib/linked-unlock.ts): the secret of this
// user account that the further banks' PINs are sealed with, besides the
// first login's PIN. The provider hands it to the server with each request
// about them; null where the system cannot keep it protected, and the switch
// is then not offered.
contextBridge.exposeInMainWorld('electronLinkedUnlock', {
  secret: () => ipcRenderer.invoke('linked-unlock:secret'),
});

// Sync between devices (lib/sync.ts): the home network's file shelf
// (electron/sync-lan.cjs) — on, with where the phone finds it, or off — a
// folder of the user's choosing, and this computer's name for the others.
contextBridge.exposeInMainWorld('electronSync', {
  lan: (on) => ipcRenderer.invoke('sync:lan', on === true),
  pickFolder: () => ipcRenderer.invoke('sync:pick-folder'),
  deviceName: () => ipcRenderer.invoke('sync:device-name'),
});

// "Neue Umsätze melden" (lib/background-check.ts): the shell plans the checks,
// keeps running in the notification area and shows the notices; the server
// keeps the PINs.
contextBridge.exposeInMainWorld('electronBackground', {
  set: (on) => ipcRenderer.invoke('background:set', on === true),
});

// Windows Hello in place of typing the first login's PIN (lib/windows-hello.ts):
// the shell turns a gesture into a key, the server keeps the PIN under it and
// the secret above. Nothing but Windows says whether it is there.
contextBridge.exposeInMainWorld('electronHello', {
  available: () => ipcRenderer.invoke('hello:available'),
  enroll: () => ipcRenderer.invoke('hello:enroll'),
  unlock: () => ipcRenderer.invoke('hello:unlock'),
});

contextBridge.exposeInMainWorld('electronTelemetry', {
  consent: () => {
    try {
      const value = ipcRenderer.sendSync('telemetry:consent');
      return value === 'on' || value === 'off' ? value : 'unasked';
    } catch {
      return 'unasked';
    }
  },
  setConsent: (on) => ipcRenderer.invoke('telemetry:set-consent', on === true),
  event: (name, props) => {
    if (typeof name !== 'string' || name.length > 64) return;
    ipcRenderer.send('telemetry:event', name, props && typeof props === 'object' ? { ...props } : {});
  },
  error: (err) => {
    ipcRenderer.send('telemetry:error', {
      name: short(err?.name, 80),
      message: short(err?.message, 2000),
      stack: short(err?.stack, 8000),
    });
  },
});
