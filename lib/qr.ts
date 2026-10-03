// QR codes, drawn locally.
//
// A payment request carries the user's IBAN and name; sending that to a QR
// web service to get a picture back would hand it to a third party for no
// reason. So the code is computed here (qrcode-generator, no dependencies of
// its own) and drawn as one SVG path — or, for "Als PNG speichern", onto a
// canvas.
//
// The matrix is plain data — `matrix[row][col] === true` is a dark module — so
// the rendering never depends on the library and the tests can rasterise it
// themselves and read it back with jsQR.

import qrcode from 'qrcode-generator';

export type QrEcc = 'L' | 'M' | 'Q' | 'H';
export type QrMatrix = boolean[][];

const encoder = new TextEncoder();
const utf8Bytes = (s: string): number[] => Array.from(encoder.encode(s));

/**
 * The modules of a QR code for `text`, encoded as UTF-8 bytes.
 *
 * The version is chosen automatically (the smallest that fits). `ecc` defaults
 * to M, which is what EPC069-12 prescribes for a GiroCode.
 *
 * Why the byte conversion is done here: qrcode-generator's ESM build turns a
 * string into bytes with `charCode & 0xff` — Latin-1 at best. "Müller" would
 * go in as the single byte 0xFC, which a GiroCode declaring character set 1
 * (UTF-8) must not contain, and "ő" (U+0151) would silently become "Q". The
 * library reads `qrcode.stringToBytes` at `addData` time, so a UTF-8 encoder
 * is put in place for exactly that call and the previous one restored — the
 * shared module object is never left changed.
 */
export function qrMatrix(text: string, ecc: QrEcc = 'M'): QrMatrix {
  const qr = qrcode(0, ecc);
  const previous = qrcode.stringToBytes;
  qrcode.stringToBytes = utf8Bytes;
  try {
    qr.addData(String(text), 'Byte');
  } finally {
    qrcode.stringToBytes = previous;
  }
  try {
    qr.make();
  } catch {
    // The library throws a bare string ("code length overflow …").
    throw new Error('Der Inhalt ist zu lang für einen QR-Code.');
  }
  const n = qr.getModuleCount();
  const matrix: QrMatrix = [];
  for (let row = 0; row < n; row++) {
    const line: boolean[] = [];
    for (let col = 0; col < n; col++) line.push(qr.isDark(row, col));
    matrix.push(line);
  }
  return matrix;
}

/**
 * Calls `draw` once per horizontal run of dark modules.
 *
 * Runs rather than single modules: a version-13 code has ~2000 dark modules
 * but only a few hundred runs, and adjacent squares drawn separately leave
 * hairline seams between them when a renderer anti-aliases their edges.
 */
function forEachRun(matrix: QrMatrix, draw: (x: number, y: number, length: number) => void): void {
  for (let y = 0; y < matrix.length; y++) {
    const row = matrix[y];
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < row.length && row[end]) end++;
      draw(x, y, end - x);
      x = end;
    }
  }
}

const quietZone = (quiet: number) => Math.max(0, Math.floor(Number.isFinite(quiet) ? quiet : 4));

/**
 * The dark modules as a single SVG path in module units, quiet zone included.
 *
 * Render it as `<svg viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges">
 * <path d={d} fill="#000"/></svg>` on a white background — in dark mode too:
 * an inverted code is one scanners are allowed to refuse. The quiet zone (four
 * modules by the standard) is part of `size`, so the white tile needs no
 * padding of its own to stay scannable.
 */
export function qrSvgPath(matrix: QrMatrix, quiet = 4): { d: string; size: number } {
  const q = quietZone(quiet);
  const parts: string[] = [];
  forEachRun(matrix, (x, y, length) => {
    parts.push(`M${x + q} ${y + q}h${length}v1h-${length}z`);
  });
  return { d: parts.join(''), size: matrix.length + 2 * q };
}

/**
 * The code as a PNG — black on white, `scale` pixels per module, quiet zone
 * included. Browser only (it draws on a canvas); rejects elsewhere.
 *
 * An integer scale keeps every module edge on a pixel boundary, so the image
 * stays sharp however it is later printed or scaled down by a viewer.
 */
export async function qrPngBlob(matrix: QrMatrix, scale = 8, quiet = 4): Promise<Blob> {
  if (typeof document === 'undefined') throw new Error('Ein PNG kann nur im Browser erzeugt werden.');
  const q = quietZone(quiet);
  const px = Math.max(1, Math.round(Number.isFinite(scale) ? scale : 8));
  const size = (matrix.length + 2 * q) * px;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Das Bild konnte nicht erzeugt werden.');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000000';
  forEachRun(matrix, (x, y, length) => {
    ctx.fillRect((x + q) * px, (y + q) * px, length * px, px);
  });

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Das Bild konnte nicht erzeugt werden.'));
    }, 'image/png');
  });
}
