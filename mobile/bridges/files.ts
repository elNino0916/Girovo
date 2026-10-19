// Saving and printing, as the desktop shell offers them to the page
// (window.electronFiles, window.electronPDF — types/electron-window.d.ts), so
// lib/download.ts and components/Statement.tsx work unchanged:
//
//  - a file (the CSV export) is saved through Android's own "save to" picker;
//  - a document (Kontoauszug, Buchungsbeleg, Mitteilung) goes to Android's
//    print dialog, where "Save as PDF" is one of the printers. The WebView
//    prints what @media print shows, as Chromium's printToPDF does on the
//    desktop.

import { Buffer } from 'buffer';
import { GirovoDevice } from '../native';

const MIME: Record<string, string> = {
  csv: 'text/csv',
  pdf: 'application/pdf',
  png: 'image/png',
  txt: 'text/plain',
  zip: 'application/zip',
};

const mimeOf = (name: string) => MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

export function installFiles(): void {
  window.electronFiles = {
    async save(suggestedName, bytes) {
      try {
        const { result } = await GirovoDevice.saveFile({
          name: suggestedName,
          mime: mimeOf(suggestedName),
          data: Buffer.from(bytes).toString('base64'),
        });
        return result === 'saved' ? { ok: true } : { ok: false, canceled: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  window.electronPDF = {
    async exportPDF(suggestedName) {
      try {
        // Android names the PDF after the job: the suggested file name, without .pdf.
        const { result } = await GirovoDevice.print({ name: suggestedName.replace(/\.pdf$/i, '') });
        if (result === 'canceled') return { ok: false, canceled: true };
        if (result === 'failed') return { ok: false, error: 'print failed' };
        return { ok: true, filePath: '' };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

/** Hands a file to another app (the share sheet): a GiroCode, an export. */
export async function shareFile(name: string, blob: Blob, title?: string): Promise<void> {
  const data = Buffer.from(new Uint8Array(await blob.arrayBuffer())).toString('base64');
  await GirovoDevice.shareFile({ name, mime: blob.type || mimeOf(name), data, title });
}
