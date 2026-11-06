// scripts/blockmap.mjs must cut exactly as the updater does
// (src-tauri/src/updater/chunks.rs): the same test vector, the same numbers.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { CHUNKER, GEAR, blockmap, cut } from './blockmap.mjs';

/** 1 MiB from xorshift32 seeded with 1, the low byte of each step (chunks.rs vector()). */
function vector() {
  const out = Buffer.alloc(1024 * 1024);
  let x = 1;
  for (let i = 0; i < out.length; i++) {
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    out[i] = x & 0xff;
  }
  return out;
}

/** The vector in uneven blocks, as a read stream hands them over. */
async function* blocks(buf, size) {
  for (let at = 0; at < buf.length; at += size) yield buf.subarray(at, at + size);
}

test('the shared vector is cut as chunks.rs cuts it', async () => {
  const { checksums, sizes } = await cut(blocks(vector(), 777));
  assert.equal(GEAR[0], 0x92ca2f0e);
  assert.equal(GEAR[255], 0x7970d887);
  assert.equal(sizes.length, 29);
  assert.deepEqual(sizes.slice(0, 6), [131_072, 28_540, 45_961, 28_067, 20_896, 54_232]);
  assert.equal(checksums[0], 'nQPCcseVfAyLOTNuui64Eg==');
  assert.equal(checksums.at(-1), 'fGSH0WSt01dpsxq7j9/Ytw==');
  assert.equal(sizes.reduce((a, b) => a + b, 0), 1024 * 1024);
});

test('the block size does not change the cut', async () => {
  const one = await cut(blocks(vector(), 1024 * 1024));
  const many = await cut(blocks(vector(), 4096));
  assert.deepEqual(many, one);
});

test('the blockmap file is electron-builder\'s version 2 with the chunker mark', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'girovo-blockmap-'));
  try {
    const file = join(dir, 'Girovo-9.9.9-Setup.exe');
    writeFileSync(file, vector());
    writeFileSync(`${file}.blockmap`, await blockmap(file));
    const json = JSON.parse(gunzipSync(readFileSync(`${file}.blockmap`)).toString('utf8'));
    assert.equal(json.version, '2');
    assert.equal(json.chunker, CHUNKER);
    assert.equal(json.files.length, 1);
    assert.equal(json.files[0].offset, 0);
    assert.equal(json.files[0].checksums.length, json.files[0].sizes.length);
    assert.equal(json.files[0].sizes.reduce((a, b) => a + b, 0), 1024 * 1024);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
