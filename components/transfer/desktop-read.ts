// The desktop's way to read an invoice (owner's pick "PDFs and photos",
// 2026-10-24): what the phone does with ML Kit and its PdfRenderer, done in
// the page, offline. A PDF is drawn by pdf.js — its pages as pictures, for a
// GiroCode, and the text inside it with every line's place, so a digital
// invoice needs no character recognition at all. A photo, a scan or a PDF
// without text goes through Tesseract (German and English). Both run in
// workers from the app's own files (scripts/ocr-assets.mjs); nothing leaves
// the computer.
//
// Loaded on demand, and only by the desktop build (GiroCodeDrop imports it
// behind IS_ANDROID): neither library reaches the phone's bundle.

/** A page's text as the phone's text recognition gives it: lines with their boxes, in the picture's pixels. */
export type PageText = {
  text: string;
  lines: { text: string; box: [number, number, number, number] }[];
  width: number;
  height: number;
};

/** The longer side a PDF page is drawn at: sharp enough for a GiroCode and for reading, small enough to keep. */
const PDF_SIDE = 2000;
/** How many pages a GiroCode is looked for on — an invoice's code is on its first or second. */
const PDF_PAGES = 3;

type PdfJs = typeof import('pdfjs-dist');
let pdfjs: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= import('pdfjs-dist').then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = '/pdf/pdf.worker.min.mjs';
    return lib;
  });
  return pdfjs;
}

/**
 * A PDF's first pages, each as a PNG and with the text pdf.js finds on it —
 * empty for a scanned page, whose text only Tesseract can read.
 */
export async function pdfPages(file: Blob): Promise<{ image: Blob; text: PageText }[]> {
  const lib = await loadPdfJs();
  const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  try {
    const out: { image: Blob; text: PageText }[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, PDF_PAGES); n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: PDF_SIDE / Math.max(base.width, base.height) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      // White under the page: a PDF may leave its background transparent.
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      const image = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no image'))), 'image/png'));
      const content = await page.getTextContent();
      out.push({ image, text: linesOf(lib, content.items, viewport, canvas.width, canvas.height) });
      page.cleanup();
    }
    return out;
  } finally {
    void task.destroy();
  }
}

type PdfItem = { str?: string; transform?: number[]; width?: number; height?: number; hasEOL?: boolean };

/**
 * pdf.js's text runs gathered into lines: runs whose baselines lie within a
 * third of their height of each other are one line, read left to right, with
 * a space wherever the gap between two runs is wider than a narrow letter.
 * The box of each line is in the drawn page's pixels.
 */
function linesOf(lib: PdfJs, items: unknown[], viewport: { transform: number[] }, width: number, height: number): PageText {
  type Run = { text: string; x: number; y: number; w: number; h: number };
  const runs: Run[] = [];
  for (const raw of items as PdfItem[]) {
    if (!raw.str?.trim() || !raw.transform) continue;
    const [, , , , x, y] = lib.Util.transform(viewport.transform, raw.transform) as number[];
    const scale = Math.hypot(viewport.transform[0], viewport.transform[1]);
    const h = Math.max(1, Math.hypot(raw.transform[2], raw.transform[3]) * scale);
    runs.push({ text: raw.str, x, y, w: (raw.width ?? 0) * scale, h });
  }
  runs.sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: Run[][] = [];
  for (const run of runs) {
    const line = groups.find((g) => Math.abs(g[0].y - run.y) < Math.min(g[0].h, run.h) / 3);
    if (line) line.push(run);
    else groups.push([run]);
  }
  const lines = groups
    .map((g) => {
      g.sort((a, b) => a.x - b.x);
      let text = '';
      let end = -Infinity;
      for (const run of g) {
        if (text && run.x - end > run.h * 0.2 && !text.endsWith(' ') && !run.text.startsWith(' ')) text += ' ';
        text += run.text;
        end = run.x + run.w;
      }
      const left = Math.min(...g.map((r) => r.x));
      const right = Math.max(...g.map((r) => r.x + r.w));
      const top = Math.min(...g.map((r) => r.y - r.h));
      const bottom = Math.max(...g.map((r) => r.y + r.h * 0.25));
      return { text: text.replace(/\s+/g, ' ').trim(), box: [left, top, right, bottom] as [number, number, number, number] };
    })
    .filter((l) => l.text)
    .sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
  return { text: lines.map((l) => l.text).join('\n'), lines, width, height };
}

type TesseractWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;
let worker: Promise<TesseractWorker> | null = null;
function loadWorker(): Promise<TesseractWorker> {
  worker ??= import('tesseract.js').then(({ createWorker, OEM }) => createWorker(['deu', 'eng'], OEM.LSTM_ONLY, {
    workerPath: '/ocr/worker.min.js',
    corePath: '/ocr/tesseract-core-simd-lstm.wasm.js',
    langPath: '/ocr',
    gzip: true,
    // The language data is the app's own file: nothing to keep in IndexedDB.
    cacheMethod: 'none',
    workerBlobURL: false,
  })).catch((e) => {
    worker = null;
    throw e;
  });
  return worker;
}

/** The text of a picture — a photo, a scan, a screenshot — by Tesseract; null when it reads nothing. */
export async function imageText(image: Blob): Promise<PageText | null> {
  const bitmap = await createImageBitmap(image);
  const { width, height } = bitmap;
  bitmap.close();
  const ocr = await loadWorker();
  const { data } = await ocr.recognize(image, {}, { blocks: true, text: true });
  const lines: PageText['lines'] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        const text = line.text.replace(/\s+/g, ' ').trim();
        if (text) lines.push({ text, box: [line.bbox.x0, line.bbox.y0, line.bbox.x1, line.bbox.y1] });
      }
    }
  }
  if (!lines.length) return null;
  return { text: lines.map((l) => l.text).join('\n'), lines, width, height };
}
