// What the Android build gets in place of a library only the desktop uses
// (next.config.ts, turbopack.resolveAlias): pdf.js and Tesseract, which read
// an invoice on the desktop (components/transfer/desktop-read.ts). The phone
// reads with ML Kit and never loads them, so its export does not carry them.

export {};
