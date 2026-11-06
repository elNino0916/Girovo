// The blockmap beside a Tauri Setup.exe, for the updater's differential
// downloads (src-tauri/src/updater, docs/tauri-updater.md):
//
//   node scripts/blockmap.mjs dist/Girovo-6.0.0-Setup.exe   → …-Setup.exe.blockmap
//
// Tauri's bundler writes none (electron-builder did), so CI runs this on the
// renamed installer before the release is published. The format is
// electron-builder's version 2 — gzipped JSON, one file, the chunks'
// checksums and sizes in order — with a "chunker" mark: the installed app cuts
// its own files the same way (src-tauri/src/updater/chunks.rs) and only
// trusts a blockmap that says it was cut alike. The cut and the checksum here
// must stay exactly those of chunks.rs; the shared test vector in both test
// files (scripts/blockmap.test.mjs, chunks.rs) holds them together.

import { createHash } from 'node:crypto';
import { createReadStream, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

export const CHUNKER = 'girovo-cdc-1';

const MIN_CHUNK = 8 * 1024;
const MAX_CHUNK = 128 * 1024;
const BOUNDARY_MASK = 0xfffe0000;

/** chunks.rs GEAR: a splitmix-style counter through murmur3's finaliser. */
const GEAR = new Uint32Array(256);
{
  let state = 0;
  for (let i = 0; i < 256; i++) {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    GEAR[i] = (z ^ (z >>> 16)) >>> 0;
  }
}
export { GEAR };

/** The first 16 bytes of the chunk's SHA-256, base64. */
export const checksum = (bytes) => createHash('sha256').update(bytes).digest().subarray(0, 16).toString('base64');

/**
 * Cuts the blocks `source` yields (an async iterable of Buffers, e.g. a read
 * stream) into content-defined chunks: a gear hash over the last 32 bytes, a
 * boundary where its top 15 bits are zero, 8 KiB to 128 KiB per chunk.
 * Answers { checksums, sizes }.
 */
export async function cut(source) {
  const checksums = [];
  const sizes = [];
  let carry = [];
  let carried = 0;
  let hash = 0;
  const emit = (parts, size) => {
    checksums.push(checksum(parts.length === 1 ? parts[0] : Buffer.concat(parts, size)));
    sizes.push(size);
  };
  for await (const block of source) {
    let start = 0;
    for (let i = 0; i < block.length; i++) {
      hash = ((hash << 1) + GEAR[block[i]]) >>> 0;
      const len = carried + (i + 1 - start);
      if (len >= MAX_CHUNK || (len >= MIN_CHUNK && (hash & BOUNDARY_MASK) === 0)) {
        emit([...carry, block.subarray(start, i + 1)], len);
        carry = [];
        carried = 0;
        start = i + 1;
        hash = 0;
      }
    }
    if (start < block.length) {
      carry.push(block.subarray(start));
      carried += block.length - start;
    }
  }
  if (carried > 0) emit(carry, carried);
  return { checksums, sizes };
}

/** The blockmap of the file at `path`, gzipped. */
export async function blockmap(path) {
  const { checksums, sizes } = await cut(createReadStream(path, { highWaterMark: 1024 * 1024 }));
  const json = { version: '2', chunker: CHUNKER, files: [{ name: 'file', offset: 0, checksums, sizes }] };
  return gzipSync(Buffer.from(JSON.stringify(json)), { level: 9 });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('usage: node scripts/blockmap.mjs <Setup.exe>…');
    process.exit(2);
  }
  for (const file of files) {
    const gz = await blockmap(file);
    writeFileSync(`${file}.blockmap`, gz);
    console.log(`${file}.blockmap: ${gz.length} bytes`);
  }
}
