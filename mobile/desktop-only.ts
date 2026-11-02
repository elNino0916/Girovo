// What the Android build gets in place of a library only the desktop uses
// (next.config.ts, turbopack.resolveAlias): pdf.js, which draws an invoice's
// PDF on the desktop (components/transfer/desktop-read.ts). The phone draws
// one with Android's PdfRenderer and never loads it, so its export does not
// carry it.

export {};
