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

// Statement.tsx's PDF export: renders straight out of Chromium via
// webContents.printToPDF in the main process, then a native save dialog — no
// OS print driver ("Microsoft Print to PDF") involved, see main.cjs.
contextBridge.exposeInMainWorld('electronPDF', {
  exportPDF: (suggestedName) => ipcRenderer.invoke('pdf:export', suggestedName),
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
