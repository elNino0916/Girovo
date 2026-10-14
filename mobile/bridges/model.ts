// The category model as an optional download on the phone (Sitzung →
// "Textmodell für Kategorien"). The desktop app bundles it; 280 MB is too much
// to put in every phone's install, so here it is fetched on request — the
// files scripts/category-models.json pins, from the same Hugging Face
// revision, each checked natively against its size and digest before it is
// kept (GirovoModel). The calibration goes beside them as model.json, as
// scripts/fetch-model.mjs writes it on the desktop.

import type { PluginListenerHandle } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import CATALOG from '../../scripts/category-models.json';
import { GirovoModel, type ModelFile, type ModelStatus } from '../native';
import { mountModel } from '../server/model';

const MODEL = CATALOG.ship as keyof typeof CATALOG.models;
const entry = CATALOG.models[MODEL];

const FILES: ModelFile[] = entry.files.map((f) => ({
  name: f.to,
  url: `https://huggingface.co/${entry.repo}/resolve/${entry.revision}/${f.from}`,
  size: f.size,
  ...('sha256' in f ? { sha256: f.sha256 } : { gitBlob: f.gitBlob }),
}));

/** The download's size in bytes, for "rund 300 MB". */
export const MODEL_BYTES = FILES.reduce((sum, f) => sum + f.size, 0);

const idle: ModelStatus = { installed: false, files: [], downloading: false, received: 0, total: 0 };

export async function status(): Promise<ModelStatus> {
  try {
    return await GirovoModel.status();
  } catch {
    return idle;
  }
}

export function onProgress(fn: (s: ModelStatus) => void): () => void {
  let handle: PluginListenerHandle | null = null;
  let gone = false;
  void GirovoModel.addListener('progress', fn).then((h) => {
    if (gone) void h.remove();
    else handle = h;
  });
  return () => {
    gone = true;
    void handle?.remove();
  };
}

/** Downloads and checks the model, then hands it to the route handlers. */
export async function download(): Promise<ModelStatus> {
  const done = await GirovoModel.download({ files: FILES });
  await Filesystem.writeFile({
    path: 'category-model/model.json',
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    data: `${JSON.stringify({ model: MODEL, revision: entry.revision, thresholds: entry.thresholds }, null, 2)}\n`,
  });
  await mountModel();
  return done;
}

export async function cancel(): Promise<void> {
  await GirovoModel.cancelDownload().catch(() => {});
}

export async function remove(): Promise<void> {
  await GirovoModel.remove();
  await mountModel();
}
