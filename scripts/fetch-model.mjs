// Fetches the on-device category model (lib/category-model.ts) into
// models/category-model/ — pinned to one revision, every file checked
// against its known hash before it is kept:
//
//   node scripts/fetch-model.mjs
//
// The weights are hundreds of MB, over GitHub's file limit, so they are not
// committed: this script runs before every desktop build
// (scripts/build-electron.mjs) and in development once by hand. Files already
// present and correct are not downloaded again. Without the model the app
// still runs — categories then come from the keyword rules alone.
//
// This file is the only place that names the model. MODELS holds each one
// that has been calibrated, with its thresholds; MODEL picks the one to ship.
// The thresholds go beside the weights as model.json, so the app uses the
// ones measured for the model it actually has. Switching back and forth is
// one word here and a rerun. A new e5-style encoder (same files, mean
// pooling, "query: " prefix) needs its pins and a calibration first:
// scripts/eval-category-model.mjs --sweep, with HOLDOUT as the judge.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MODEL_DIR = path.join(ROOT, 'models', 'category-model');

/**
 * Each model's source and files — LFS files by SHA-256, small ones by their
 * git blob id — and its calibration (lib/category-model.ts, Thresholds).
 * Both are multilingual E5 (MIT), as converted to ONNX and quantised to int8
 * by Xenova.
 */
const MODELS = {
  // Ships since 5.0.4. Right more often on names nobody tuned it on, for a
  // few more wrong guesses than the strictest setting would allow.
  'multilingual-e5-base': {
    upstream: 'intfloat/multilingual-e5-base',
    repo: 'Xenova/multilingual-e5-base',
    revision: '1ec9243030a27d1a115d5c340572074c125b58b2',
    files: [
      { from: 'onnx/model_quantized.onnx', to: 'model_quantized.onnx', size: 278647662, sha256: 'df7a9a29309e3ad491e1783adf8baee710262cc06079c7cbab63c630277fac94' },
      { from: 'tokenizer.json', to: 'tokenizer.json', size: 17082660, sha256: '62c24cdc13d4c9952d63718d6c9fa4c287974249e16b7ade6d5a85e7bbb75626' },
      { from: 'tokenizer_config.json', to: 'tokenizer_config.json', size: 418, gitBlob: '6de1940d16d38be9877bf7cc228c9377841b311f' },
      { from: 'config.json', to: 'config.json', size: 686, gitBlob: '6f4d460131679782c01697207140860df1bb3df4' },
      { from: 'special_tokens_map.json', to: 'special_tokens_map.json', size: 280, gitBlob: 'd5698132694f4f1bcff08fa7d937b1701812598e' },
    ],
    thresholds: { minScore: 0.8075, minMargin: 0.006, exampleScore: 0.92 },
  },
  // 5.0.2 and 5.0.3. Less than half the size and quicker to load.
  'multilingual-e5-small': {
    upstream: 'intfloat/multilingual-e5-small',
    repo: 'Xenova/multilingual-e5-small',
    revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
    files: [
      { from: 'onnx/model_quantized.onnx', to: 'model_quantized.onnx', size: 118308185, sha256: 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193' },
      { from: 'tokenizer.json', to: 'tokenizer.json', size: 17082730, sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39' },
      { from: 'tokenizer_config.json', to: 'tokenizer_config.json', size: 443, gitBlob: '059214673d9d6d2ee319411e2ffec8c024b816d5' },
      { from: 'config.json', to: 'config.json', size: 658, gitBlob: '4104f38273cc595fd9500fd243124e9f6cf383dc' },
      { from: 'special_tokens_map.json', to: 'special_tokens_map.json', size: 167, gitBlob: 'e0b1d18ecd0ae4ff1d47bd297d910c0cf83e504b' },
    ],
    thresholds: { minScore: 0.83, minMargin: 0.002, exampleScore: 0.94 },
  },
};

export const MODEL = 'multilingual-e5-base';

const { upstream: UPSTREAM, repo: REPO, revision: REVISION, files: FILES, thresholds: THRESHOLDS } = MODELS[MODEL];

const NOTICE = `${MODEL}
https://huggingface.co/${UPSTREAM}
Liang Wang, Nan Yang, Xiaolong Huang, Linjun Yang, Rangan Majumder, Furu Wei:
"Multilingual E5 Text Embeddings: A Technical Report", 2024.
Released under the MIT License, as its model card declares.

ONNX conversion and int8 quantisation:
https://huggingface.co/${REPO} (revision ${REVISION})

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

function matches(buf, file) {
  if (buf.length !== file.size) return false;
  if (file.sha256) return crypto.createHash('sha256').update(buf).digest('hex') === file.sha256;
  const blob = crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
  return blob === file.gitBlob;
}

function present(file) {
  try {
    return matches(fs.readFileSync(path.join(MODEL_DIR, file.to)), file);
  } catch {
    return false;
  }
}

async function download(file) {
  const url = `https://huggingface.co/${REPO}/resolve/${REVISION}/${file.from}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!matches(buf, file)) throw new Error(`${file.from} does not match its pinned hash — not kept`);
  const target = path.join(MODEL_DIR, file.to);
  fs.writeFileSync(`${target}.partial`, buf);
  fs.renameSync(`${target}.partial`, target);
}

export async function fetchModel({ log = console.log } = {}) {
  fs.mkdirSync(MODEL_DIR, { recursive: true });
  for (const file of FILES) {
    if (present(file)) continue;
    log(`› downloading ${file.from} (${(file.size / 1048576).toFixed(1)} MB)`);
    await download(file);
  }
  fs.writeFileSync(path.join(MODEL_DIR, 'NOTICE'), NOTICE);
  fs.writeFileSync(path.join(MODEL_DIR, 'model.json'), `${JSON.stringify({ model: MODEL, revision: REVISION, thresholds: THRESHOLDS }, null, 2)}
`);
  log(`✓ category model (${MODEL}) ready in ${path.relative(ROOT, MODEL_DIR)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fetchModel().catch((err) => {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  });
}
