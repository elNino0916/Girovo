// The category model's folder as lib/category-model.ts expects it, at
// GIROVO_MODEL_DIR (desktop/env.ts): it reads the tokenizer and the
// calibration synchronously through node:fs, which here is the page's
// in-memory tree (mobile/shims/fs.ts). So at server start the shell's copy of
// the folder (src-tauri/src/model.rs) is mounted into it — the small files
// with their content; the weights, which stay in the shell where ONNX Runtime
// runs them (desktop/shims/ort.ts), only listed.
//
// The tokenizer (16 MB) is only listed at start too: most starts never
// categorize anything, and fetching and decoding it cost every one of them
// about a tenth of a second. The model's loader asks for it right before it
// reads it, and hands it back once the tokenizer is built
// (__girovoModelFiles, lib/category-model.ts) — the model itself is let go
// after a quiet minute, and the next load fetches it again.
//
// A build without the model, or without the runtime to run it, mounts
// nothing: modelAvailable() is then false, and the keyword rules decide
// alone, as they always did without the model.

import { mountAssets, unmountAssets } from '../../mobile/shims/fs';
import { invoke } from '../shell';

type Files = { read: string[]; weights: string[] };
type ModelFiles = { mount(): Promise<void>; unmount(): void };

/** Fetched only while the model loads. */
const ON_DEMAND = new Set(['tokenizer.json']);

const decoder = new TextDecoder();
const fetchText = async (name: string) => decoder.decode(await invoke<ArrayBuffer>('model_read', { name }));

export async function mountModel(): Promise<void> {
  const files = await invoke<Files | null>('model_files');
  if (!files) return;
  const dir = process.env.GIROVO_MODEL_DIR || '/model';
  const now = files.read.filter((name) => !ON_DEMAND.has(name));
  const later = files.read.filter((name) => ON_DEMAND.has(name));
  const texts = await Promise.all(now.map(async (name) => [`${dir}/${name}`, await fetchText(name)] as const));
  mountAssets(Object.fromEntries(texts), { [dir]: [...files.weights, ...later] });

  const paths = later.map((name) => `${dir}/${name}`);
  const hooks: ModelFiles = {
    async mount() {
      const fetched = await Promise.all(later.map(async (name) => [`${dir}/${name}`, await fetchText(name)] as const));
      mountAssets(Object.fromEntries(fetched));
    },
    unmount() {
      unmountAssets(paths);
    },
  };
  (globalThis as { __girovoModelFiles?: ModelFiles }).__girovoModelFiles = hooks;
}
