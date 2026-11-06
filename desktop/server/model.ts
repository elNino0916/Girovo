// The category model's folder as lib/category-model.ts expects it, at
// GIROVO_MODEL_DIR (desktop/env.ts): it reads the tokenizer and the
// calibration synchronously through node:fs, which here is the page's
// in-memory tree (mobile/shims/fs.ts). So at server start the shell's copy of
// the folder (src-tauri/src/model.rs) is mounted into it — every file but the
// weights, which are only listed: they stay in the shell, where ONNX Runtime
// runs them (desktop/shims/ort.ts).
//
// A build without the model, or without the runtime to run it, mounts
// nothing: modelAvailable() is then false, and the keyword rules decide
// alone, as they always did without the model.

import { mountAssets } from '../../mobile/shims/fs';
import { invoke } from '../shell';

type Files = { read: string[]; weights: string[] };

export async function mountModel(): Promise<void> {
  const files = await invoke<Files | null>('model_files');
  if (!files) return;
  const dir = process.env.GIROVO_MODEL_DIR || '/model';
  const decoder = new TextDecoder();
  const texts = await Promise.all(files.read.map(async (name) => [`${dir}/${name}`, decoder.decode(await invoke<ArrayBuffer>('model_read', { name }))] as const));
  mountAssets(Object.fromEntries(texts), { [dir]: files.weights });
}
