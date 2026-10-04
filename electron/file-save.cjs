'use strict';

// Saving a file the app made (the CSV export) for window.electronFiles —
// see preload.cjs and saveFile() in lib/download.ts.
//
// A native Save-As in Downloads with the type's filter, then the bytes are
// written here, so the page hears whether the file exists or the dialog was
// dismissed, and only then says "gespeichert". A plain <a download> cannot
// tell it either. Only the types the app produces, a bare file name, and a
// size no export comes near. Kept apart from main.cjs (dialog and fs come in
// as arguments) so `npm test` can run it without Electron.

const path = require('node:path');

/** The largest file it writes: a year of bookings is well under 1 MB. */
const SAVE_MAX_BYTES = 50 * 1024 * 1024;
const SAVE_FAILED = 'Die Datei konnte nicht gespeichert werden.';

/**
 * @param {object} deps
 * @param {(options: object) => Promise<{ canceled: boolean, filePath?: string }>} deps.showSaveDialog
 *   Electron's dialog.showSaveDialog, already bound to the window it belongs to.
 * @param {(file: string, data: Buffer) => Promise<void>} deps.writeFile
 * @param {string} deps.downloadsDir
 * @param {Record<string, { name: string, extensions: string[] }>} deps.filters  by lower-case extension, '.csv' …
 * @returns {(suggestedName: unknown, bytes: unknown) => Promise<{ ok: true } | { ok: false, canceled: true } | { ok: false, error: string }>}
 */
function createFileSave({ showSaveDialog, writeFile, downloadsDir, filters }) {
  return async (suggestedName, bytes) => {
    // The last segment on either separator, whatever the platform's own is.
    const name = String(suggestedName || '').split(/[\\/]/).pop() || 'Download';
    const filter = filters[path.extname(name).toLowerCase()];
    if (!filter || !ArrayBuffer.isView(bytes) || bytes.byteLength > SAVE_MAX_BYTES) {
      return { ok: false, error: SAVE_FAILED };
    }
    const { canceled, filePath } = await showSaveDialog({
      defaultPath: path.join(downloadsDir, name),
      filters: [filter],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    try {
      await writeFile(filePath, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    } catch (err) {
      // Windows refuses to replace a file another program holds open — the
      // usual case being last month's export still open in Excel.
      return {
        ok: false,
        error: err && err.code === 'EBUSY'
          ? 'Die Datei ist noch in einem anderen Programm geöffnet, zum Beispiel in Excel. Schließe sie dort oder wähle einen anderen Namen.'
          : 'Die Datei konnte dort nicht gespeichert werden. Wähle einen anderen Ordner.',
      };
    }
    return { ok: true };
  };
}

module.exports = { createFileSave, SAVE_MAX_BYTES, SAVE_FAILED };
