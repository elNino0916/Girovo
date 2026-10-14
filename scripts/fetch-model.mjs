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
// category-models.json is the only place that names the model: `models`
// holds each one that has been calibrated, with its thresholds; `ship` picks
// the one to ship.
// The thresholds go beside the weights as model.json, so the app uses the
// ones measured for the model it actually has. Switching back and forth is
// one word in the JSON and a rerun. A new e5-style encoder (same files, mean
// pooling, "query: " prefix) needs its pins and a calibration first:
// scripts/eval-category-model.mjs --sweep, with HOLDOUT as the judge.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import CATALOG from './category-models.json' with { type: 'json' };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MODEL_DIR = path.join(ROOT, 'models', 'category-model');

/**
 * Each calibrated model's source and files — LFS files by SHA-256, small ones
 * by their git blob id — and its thresholds (lib/category-model.ts,
 * Thresholds), in category-models.json: the Android app downloads from the
 * same list (mobile/bridges/model.ts), so both check the same files.
 * Both are multilingual E5 (MIT), as converted to ONNX and quantised to int8
 * by Xenova. `ship` picks the one the desktop build bundles and the phone offers.
 */
const MODELS = CATALOG.models;

export const MODEL = CATALOG.ship;

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
