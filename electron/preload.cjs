'use strict';

// Bridges the renderer's theme toggle to the frameless window's caption-button
// overlay (see BAR_COLORS in main.cjs) — the overlay colour is set once at
// window creation from the OS preference, and the app's own light/dark choice
// can differ, so the renderer corrects it as soon as it knows which theme it's
// actually showing.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronTitleBar', {
  setTheme: (isDark) => ipcRenderer.send('titlebar:set-theme', isDark),
});

// Statement.tsx's PDF export: renders straight out of Chromium via
// webContents.printToPDF in the main process, then a native save dialog — no
// OS print driver ("Microsoft Print to PDF") involved, see main.cjs.
contextBridge.exposeInMainWorld('electronPDF', {
  exportPDF: (suggestedName) => ipcRenderer.invoke('pdf:export', suggestedName),
});
