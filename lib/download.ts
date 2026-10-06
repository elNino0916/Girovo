// Handing the user a file — a CSV export, a GiroCode PNG.
//
// A Blob behind an object URL and an <a download>: in a browser a normal
// download, which the browser itself confirms, and in the desktop shell what
// Electron turns into its Save-As dialog. Never a navigation to a data: URL
// — Chromium blocks top-level data: navigations, and the shell would load the
// file into the app window instead of saving it. saveFile() goes through the
// desktop shell's own Save-As instead, so the page learns whether the file
// was actually written before it says so.

import { msgs } from './i18n/index.ts';

/**
 * A file name every OS accepts: no path separators, none of the characters
 * Windows reserves, no trailing dots or spaces (Explorer strips them, so the
 * extension would silently go missing).
 */
export function safeFileName(name: string, fallback = 'download'): string {
  const cleaned = String(name ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return (cleaned || fallback).slice(0, 180);
}

/**
 * Where the temporary link goes. A modal <dialog> makes everything outside
 * it inert, so the link is placed inside the dialog the user is working in
 * when there is one; otherwise in the body.
 */
function host(): HTMLElement {
  const active = document.activeElement;
  const dialog = active instanceof Element ? active.closest('dialog, [role="dialog"], [role="alertdialog"]') : null;
  return (dialog as HTMLElement | null) ?? document.body ?? document.documentElement;
}

/** Saves a Blob under `filename`. Browser only; a no-op elsewhere. */
export function downloadBlob(filename: string, blob: Blob): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFileName(filename);
  a.rel = 'noopener';
  a.hidden = true;
  host().appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
    // Not revoked on the spot: the download is fetched from the URL after
    // this returns, and in the desktop shell only once the Save-As dialog
    // has been answered — however long the user takes. A minute is generous;
    // the Blob itself is freed with the URL.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/**
 * The Blob a text download is made of. Strings are stored as UTF-8 — a
 * leading U+FEFF becomes the bytes EF BB BF, which is how the CSV export
 * tells Excel its encoding.
 */
export function textBlob(text: string, mime = 'text/plain;charset=utf-8'): Blob {
  return new Blob([text], { type: mime });
}

/**
 * How a save ended. `saved`: the file is on disk (the desktop shell wrote
 * it). `canceled`: the user dismissed the Save-As. `handed-over`: a browser
 * download — whether and where it lands is the browser's to say, and it
 * says so itself.
 */
export type SaveOutcome = 'saved' | 'canceled' | 'handed-over';

/** What the desktop shell's file:save answers (electron/main.cjs). */
export type ShellSaveResult = { ok: true } | { ok: false; canceled: true } | { ok: false; error: string };

/**
 * Saves a Blob as a file and says how that ended, so a "gespeichert" is only
 * ever said for a file that exists. In the desktop shell that is its own
 * Save-As (window.electronFiles, electron/preload.cjs); elsewhere a normal
 * download. Throws with a message for the user when the shell could not
 * write the file.
 */
export async function saveFile(filename: string, blob: Blob): Promise<SaveOutcome> {
  const name = safeFileName(filename);
  const shell = typeof window === 'undefined' ? undefined : window.electronFiles;
  if (!shell) {
    downloadBlob(name, blob);
    return 'handed-over';
  }
  let res: ShellSaveResult;
  try {
    res = await shell.save(name, new Uint8Array(await blob.arrayBuffer()));
  } catch {
    throw new Error(msgs().transactions.download.failed);
  }
  if (res.ok) return 'saved';
  if ('canceled' in res) return 'canceled';
  throw new Error(res.error || msgs().transactions.download.failed);
}
