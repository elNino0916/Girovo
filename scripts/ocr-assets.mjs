// Copies what the desktop needs to read an invoice offline into public/:
// pdf.js's worker (a PDF's pages and the text in them) and Tesseract's
// worker, its WebAssembly core and the German and English language data (a
// photo or a scan). Nothing is fetched from the network at run time
// (components/transfer/desktop-read.ts).
//
// Run after every install (package.json postinstall). public/ocr and
// public/pdf are not in git, and the Android export leaves them out
// (scripts/build-android.mjs): the phone reads with ML Kit.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULES = path.join(ROOT, 'node_modules');

const FILES = [
  ['pdfjs-dist/build/pdf.worker.min.mjs', 'pdf/pdf.worker.min.mjs'],
  ['tesseract.js/dist/worker.min.js', 'ocr/worker.min.js'],
  // One core, named in desktop-read.ts: SIMD is in every Chromium the
  // desktop app ships, and a folder would let Tesseract ask for a variant
  // (relaxed SIMD) that is not copied.
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'ocr/tesseract-core-simd-lstm.wasm.js'],
  // The LSTM models (OEM 1), as Tesseract's own CDN serves them by default.
  ['@tesseract.js-data/deu/4.0.0_best_int/deu.traineddata.gz', 'ocr/deu.traineddata.gz'],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'ocr/eng.traineddata.gz'],
];

let copied = 0;
for (const [from, to] of FILES) {
  const source = path.join(MODULES, from);
  if (!fs.existsSync(source)) {
    // An install without these packages (a partial or production-only one)
    // simply has no invoice reading on the desktop; it is not an error here.
    console.warn(`ocr-assets: ${from} is missing, skipped`);
    continue;
  }
  const target = path.join(ROOT, 'public', to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  copied++;
}
console.log(`ocr-assets: ${copied} of ${FILES.length} files in public/ocr and public/pdf`);
