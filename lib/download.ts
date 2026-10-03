// Handing the user a file — a CSV export, a GiroCode PNG.
//
// Always a Blob behind an object URL and an <a download>: in a browser that
// is a normal download, and in the desktop shell it is what Electron turns
// into its Save-As dialog. Never a navigation to a data: URL — Chromium
// blocks top-level data: navigations, and the shell would load the file
// into the app window instead of saving it.

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

/** Saves text as a file — e.g. `downloadText(name, csv, 'text/csv;charset=utf-8')`. */
export function downloadText(filename: string, text: string, mime = 'text/plain;charset=utf-8'): void {
  downloadBlob(filename, textBlob(text, mime));
}
