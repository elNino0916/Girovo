// Reading a QR code out of an image — for "GiroCode einlesen".
//
// The image arrives as a dropped file, a pasted screenshot or a picked file;
// it is decoded and scanned entirely in this window (jsQR, no network). There
// is deliberately no camera path: the desktop shell denies camera access, and
// an invoice on screen is the common case anyway.
//
// Screenshots are hostile input for a QR reader in two opposite ways: a 4K
// screenshot of a whole invoice is far more pixels than the code needs (jsQR
// time grows with the pixel count, and text-heavy pages are its worst case),
// while a code cropped from a PDF preview can be so small that a module is
// barely more than a pixel wide. So an image is first read fitted to 1600 px;
// a small one is then tried enlarged, a 4K one once more at 2560 px (see
// passesFor). Measured in Chromium: a text-heavy full-HD page without any
// code costs about a second, one at 2560×1440 about one and a half; a
// smoothly downscaled preview at 1.2 px per module is still read.

import jsQR from 'jsqr';
import type { Options as JsQrOptions, QRCode } from 'jsqr';

/** Anything shaped like ImageData — the real thing, or plain pixels in a test. */
export type RgbaImage = { data: Uint8ClampedArray; width: number; height: number };

type Inversion = NonNullable<JsQrOptions['inversionAttempts']>;

/** Longest side an image is fitted to for the first pass. */
const FIRST_SIDE = 1600;
/** Longest side a big image is looked at for the second pass. */
const SECOND_SIDE = 2560;
/** Up to this longest side an image is a crop or a preview, and gets enlarged… */
const SMALL_SIDE = 800;
/** …by each of these factors that keeps it within FIRST_SIDE. */
const UPSCALES = [2, 3, 4, 6, 8];
/** Narrower than this (1st–99th percentile luminance), contrast is stretched. */
const NARROW_CONTRAST = 160;
/** A screenshot is a few MB; anything far beyond that is not worth decoding. */
const MAX_BLOB_BYTES = 40 * 1024 * 1024;

// ECI assignment numbers (ISO/IEC 18004) and EPC069-12 character-set digits,
// as WHATWG encoding labels TextDecoder understands.
const ECI_CHARSETS: Record<number, string> = {
  1: 'iso-8859-1', 3: 'iso-8859-1', 4: 'iso-8859-2', 6: 'iso-8859-4', 7: 'iso-8859-5',
  9: 'iso-8859-7', 12: 'iso-8859-10', 17: 'iso-8859-15', 26: 'utf-8',
};
const EPC_CHARSETS: Record<string, string> = {
  1: 'utf-8', 2: 'iso-8859-1', 3: 'iso-8859-2', 4: 'iso-8859-4',
  5: 'iso-8859-5', 6: 'iso-8859-7', 7: 'iso-8859-10', 8: 'iso-8859-15',
};

function decodeAs(label: string, bytes: Uint8Array, fatal = false): string | null {
  try {
    return new TextDecoder(label, { fatal }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * The text of a QR code's byte payload.
 *
 * jsQR's own `data` only ever tries UTF-8 and yields an empty string for
 * anything else — but a GiroCode may legitimately declare ISO 8859-1 (its
 * character-set line "2"), and then "Müller" is the bytes 4D FC 6C 6C 65 72.
 * So the bytes are decoded here: an explicit ECI wins; otherwise valid UTF-8
 * is UTF-8; otherwise a GiroCode's own character-set line decides; otherwise
 * Latin-1, which at least maps every byte to something.
 */
export function decodeQrBytes(input: ArrayLike<number>, eci?: number | null): string {
  const bytes = Uint8Array.from(input as ArrayLike<number>);
  const byEci = eci != null ? ECI_CHARSETS[eci] : undefined;
  if (byEci) {
    const text = decodeAs(byEci, bytes);
    if (text != null) return text;
  }
  const utf8 = decodeAs('utf-8', bytes, true);
  if (utf8 != null) return utf8;
  // "BCD\n002\n2\n…" — the charset digit is the third line, plain ASCII.
  const head = /^BCD\r?\n\d{3}\r?\n([1-8])\r?\n/.exec(String.fromCharCode(...bytes.subarray(0, 16)));
  const label = head ? EPC_CHARSETS[head[1]] : undefined;
  if (label && label !== 'utf-8') {
    const text = decodeAs(label, bytes);
    if (text != null) return text;
  }
  let latin1 = '';
  for (const b of bytes) latin1 += String.fromCharCode(b);
  return latin1;
}

function textOf(hit: QRCode): string {
  // Kanji chunks are Shift-JIS, which jsQR already decodes correctly — and
  // no payment code would ever contain them. Leave such a result as jsQR read it.
  // (`String()`: jsQR types the mode as a declared enum it does not export.)
  if (hit.chunks.some((c) => String(c.type) === 'kanji')) return hit.data;
  let eci: number | null = null;
  for (const c of hit.chunks) {
    if ('assignmentNumber' in c && c.assignmentNumber >= 0) {
      eci = c.assignmentNumber;
      break;
    }
  }
  return decodeQrBytes(hit.binaryData, eci);
}

/**
 * The pixels composited over a solid background.
 *
 * jsQR ignores alpha. A PNG exported with a transparent background stores
 * "black, fully transparent" for every light module, so read raw it is a
 * black square with nothing on it. Returns null when the image is opaque
 * already (nothing to do).
 */
function flatten(image: RgbaImage, background: 0 | 255): RgbaImage | null {
  const src = image.data;
  let translucent = false;
  for (let i = 3; i < src.length; i += 4) {
    if (src[i] !== 255) {
      translucent = true;
      break;
    }
  }
  if (!translucent) return null;
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3] / 255;
    const bg = background * (1 - a);
    out[i] = src[i] * a + bg;
    out[i + 1] = src[i + 1] * a + bg;
    out[i + 2] = src[i + 2] * a + bg;
    out[i + 3] = 255;
  }
  return { data: out, width: image.width, height: image.height };
}

function scan(image: RgbaImage, inversion: Inversion): string | null {
  const hit = jsQR(image.data, image.width, image.height, { inversionAttempts: inversion });
  if (!hit) return null;
  const text = textOf(hit);
  return text ? text : null;
}

/** `prepare` may change the pixels it is given; `image` itself is only handed to it when opaque. */
function read(image: RgbaImage, inversion: Inversion, prepare: (image: RgbaImage) => RgbaImage = (i) => i): string | null {
  if (!image || !(image.width > 0) || !(image.height > 0)) return null;
  if (image.data.length < image.width * image.height * 4) return null;
  const onWhite = flatten(image, 255);
  if (!onWhite) return scan(prepare(image), inversion);
  return scan(prepare(onWhite), inversion) ?? scan(prepare(flatten(image, 0)!), inversion);
}

/**
 * Reads the first QR code in a block of pixels, or null.
 *
 * Tries light and dark (inverted) codes alike. An image with transparency is
 * read over white first — the common "black code on transparent" export —
 * and then over black, for a light code drawn for a dark page.
 */
export function readQrFromImageData(image: RgbaImage): string | null {
  return read(image, 'attemptBoth');
}

/** Per-pixel luminance and its 1st/99th percentiles. */
function luminance(image: RgbaImage): { lum: Uint8ClampedArray; lo: number; hi: number } {
  const d = image.data;
  const lum = new Uint8ClampedArray(d.length / 4);
  const histogram = new Uint32Array(256);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    lum[p] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    histogram[lum[p]]++;
  }
  const cut = Math.floor(lum.length * 0.01);
  let lo = 0;
  for (let seen = 0; lo < 255 && seen + histogram[lo] <= cut; lo++) seen += histogram[lo];
  let hi = 255;
  for (let seen = 0; hi > 0 && seen + histogram[hi] <= cut; hi--) seen += histogram[hi];
  return { lum, lo, hi };
}

function stretch(image: RgbaImage, { lum, lo, hi }: ReturnType<typeof luminance>): RgbaImage {
  const d = image.data;
  const span = hi > lo ? hi - lo : 1;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    d[i] = d[i + 1] = d[i + 2] = ((lum[p] - lo) * 255) / span;
    d[i + 3] = 255;
  }
  return image;
}

/**
 * Greyscale with the contrast stretched to the full range, in place.
 *
 * jsQR thresholds 8×8 blocks and treats a block whose darkest and lightest
 * pixels are within 24 levels as flat — so a pale or tinted code on a light
 * background (a branded GiroCode on an invoice) never binarises. The 1st and
 * 99th luminance percentiles become black and white.
 */
export function stretchContrast(image: RgbaImage): RgbaImage {
  return stretch(image, luminance(image));
}

/** Stretches only an image whose contrast is narrow; anywhere else it would change nothing jsQR cares about. */
function autoContrast(image: RgbaImage): RgbaImage {
  const range = luminance(image);
  return range.hi - range.lo < NARROW_CONTRAST ? stretch(image, range) : image;
}

/** One scan: the image resized by `scale`, read for upright and/or inverted codes. */
export type ScanPass = { scale: number; inversion: Inversion };

/** The scans readQrFromBlob makes of an image of this size, in order, until one finds a code. */
export function passesFor(width: number, height: number): ScanPass[] {
  const longest = Math.max(width, height);
  if (longest <= SMALL_SIDE) {
    // A crop or a preview. Scanning it is cheap, and whether jsQR finds a
    // code of one or two pixels per module depends on how the enlarged
    // module grid happens to fall — so several enlargements are tried, all
    // smoothed: bilinear interpolation recovers module edges from a blurry
    // preview that a blocky enlargement only turns into bigger blur
    // (measured in Chromium: 1.4–1.6 px/module read at ×2–×3 smoothed and at
    // no nearest-neighbour factor from ×2 to ×6).
    const passes: ScanPass[] = [{ scale: 1, inversion: 'attemptBoth' }];
    for (const f of UPSCALES) if (longest * f <= FIRST_SIDE) passes.push({ scale: f, inversion: 'attemptBoth' });
    return passes;
  }
  const fit = Math.min(1, FIRST_SIDE / longest);
  const passes: ScanPass[] = [{ scale: fit, inversion: 'attemptBoth' }];
  // Beyond 2560 px (a 4K or HiDPI screenshot) the fitted image can shrink a
  // code's modules below two pixels, so it gets one more look at 2560 px —
  // upright codes only: an inverted code would have been found at the first
  // size too, and checking both doubles the cost. Up to 2560 px the fit
  // keeps any code a person could scan off the screen readable, and a second
  // full scan of a text-heavy page would cost another second for nothing.
  if (longest > SECOND_SIDE) passes.push({ scale: SECOND_SIDE / longest, inversion: 'dontInvert' });
  return passes;
}

type Decoded = { image: CanvasImageSource; width: number; height: number; release(): void };

async function decodeImage(blob: Blob): Promise<Decoded | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Not every format createImageBitmap refuses is unreadable — an SVG
      // blob, for one, only decodes through an <img>.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('empty image');
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

function rasterise(source: Decoded, scale: number): RgbaImage | null {
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source.image, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

/**
 * Reads the first QR code in an image file, or null when the file is not an
 * image this browser can decode or no code could be found in it.
 *
 * Browser only (resolves null elsewhere). jsQR is synchronous: on a large,
 * text-heavy screenshot without a code this blocks the main thread for up
 * to about a second per pass. It yields between passes; show a busy state
 * whose animation runs on the compositor (a CSS transform), which keeps
 * turning while the scan runs.
 */
export async function readQrFromBlob(blob: Blob): Promise<string | null> {
  if (typeof document === 'undefined' || !blob || blob.size === 0 || blob.size > MAX_BLOB_BYTES) return null;
  const source = await decodeImage(blob);
  if (!source) return null;
  try {
    for (const pass of passesFor(source.width, source.height)) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const image = rasterise(source, pass.scale);
      const text = image ? read(image, pass.inversion, autoContrast) : null;
      if (text) return text;
    }
    return null;
  } catch {
    return null;
  } finally {
    source.release();
  }
}
