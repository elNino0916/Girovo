// Draws the brand images in build/ from the one mark geometry in
// lib/brand-mark.ts:
//
//   build/icon.png              512×512, the app icon (electron-builder makes the .ico from it)
//   build/installerSidebar.bmp  328×628, the installer's Welcome / Finish pages (2× of NSIS's 164×314)
//   build/installerHeader.bmp   300×114, the installer's inner pages (2× of 150×57)
//
//   node scripts/build-brand-assets.mjs
//
// Run it after changing the mark; the images are committed, so a normal
// build does not need it. NSIS reads only uncompressed 24-bit BMP, which
// sharp cannot write — writeBmp below does that from sharp's raw pixels.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { markSvg } = await import(pathToFileURL(path.join(ROOT, 'lib', 'brand-mark.ts')).href);

// The installer's palette (the same navy the icon has always had).
const NAVY = '#12304f';
const HALO = '#25405d';
const ACCENT = '#437fc3';
const TEXT = '#f2f7fc';
const FONT = "'Segoe UI Semibold','Segoe UI',Arial,sans-serif";

/** The mark as an <svg> element placed at (x, y) with side `size`, for nesting in a larger SVG. */
function placedMark(x, y, size, plate, ink) {
  return markSvg({ plate, ink }).replace('<svg ', `<svg x="${x}" y="${y}" width="${size}" height="${size}" `);
}

/** Uncompressed 24-bit bottom-up BMP from RGB pixels — the format NSIS's MUI pages accept. */
function writeBmp(file, { data, info }) {
  const { width: w, height: h, channels } = info;
  const stride = Math.ceil((w * 3) / 4) * 4;
  const size = 54 + stride * h;
  const b = Buffer.alloc(size);
  b.write('BM', 0, 'ascii');
  b.writeUInt32LE(size, 2);
  b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18);
  b.writeInt32LE(h, 22);
  b.writeUInt16LE(1, 26);
  b.writeUInt16LE(24, 28);
  b.writeUInt32LE(stride * h, 34);
  b.writeInt32LE(2835, 38); // 72 dpi
  b.writeInt32LE(2835, 42);
  for (let y = 0; y < h; y++) {
    const row = 54 + (h - 1 - y) * stride;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels;
      b[row + x * 3] = data[i + 2];
      b[row + x * 3 + 1] = data[i + 1];
      b[row + x * 3 + 2] = data[i];
    }
  }
  fs.writeFileSync(file, b);
}

async function rasterize(svg) {
  return sharp(Buffer.from(svg)).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
}

// The app icon: white mark on the navy plate, full bleed — Windows draws it as is.
await sharp(Buffer.from(markSvg({ plate: NAVY, ink: '#ffffff', size: 512 })))
  .png()
  .toFile(path.join(ROOT, 'build', 'icon.png'));

// Welcome / Finish: the mark on a white plate inside a soft halo, the name, an accent rule.
const sidebar = `<svg xmlns="http://www.w3.org/2000/svg" width="328" height="628" viewBox="0 0 328 628">
  <rect width="328" height="628" fill="${NAVY}"/>
  <circle cx="164" cy="196" r="74" fill="${HALO}"/>
  ${placedMark(122, 154, 84, '#ffffff', NAVY)}
  <text x="164" y="308" text-anchor="middle" font-family="${FONT}" font-size="26" fill="${TEXT}">Girovo</text>
  <rect x="144" y="329" width="40" height="3" rx="1.5" fill="${ACCENT}"/>
</svg>`;
writeBmp(path.join(ROOT, 'build', 'installerSidebar.bmp'), await rasterize(sidebar));

// Inner pages: white header, the navy plate at the right.
const header = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="114" viewBox="0 0 300 114">
  <rect width="300" height="114" fill="#ffffff"/>
  ${placedMark(204, 15, 84, NAVY, '#ffffff')}
</svg>`;
writeBmp(path.join(ROOT, 'build', 'installerHeader.bmp'), await rasterize(header));

console.log('✓ brand assets written: build/icon.png, build/installerSidebar.bmp, build/installerHeader.bmp');
