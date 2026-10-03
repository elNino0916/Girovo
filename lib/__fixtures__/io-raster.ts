// Turns a QR matrix into RGBA pixels the way a screenshot of it would look,
// so the tests can read a code back with jsQR without a canvas.

import type { QrMatrix } from '../qr.ts';

export type Rgba = { data: Uint8ClampedArray; width: number; height: number };

export type RasterOptions = {
  /** Pixels per module. */
  scale?: number;
  /** Quiet zone in modules. */
  quiet?: number;
  /** Colour of dark modules, [r, g, b, a]. */
  dark?: [number, number, number, number];
  /** Colour of light modules and the quiet zone, [r, g, b, a]. */
  light?: [number, number, number, number];
};

export function rasterise(matrix: QrMatrix, opts: RasterOptions = {}): Rgba {
  const scale = opts.scale ?? 4;
  const quiet = opts.quiet ?? 4;
  const dark = opts.dark ?? [0, 0, 0, 255];
  const light = opts.light ?? [255, 255, 255, 255];
  const n = matrix.length;
  const size = (n + 2 * quiet) * scale;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let py = 0; py < size; py++) {
    const my = Math.floor(py / scale) - quiet;
    for (let px = 0; px < size; px++) {
      const mx = Math.floor(px / scale) - quiet;
      const on = my >= 0 && my < n && mx >= 0 && mx < n && matrix[my][mx];
      data.set(on ? dark : light, (py * size + px) * 4);
    }
  }
  return { data, width: size, height: size };
}
