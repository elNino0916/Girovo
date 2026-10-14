// The category model on the phone: an optional download (Sitzung → Kategorien),
// kept natively in the app's private storage. lib/category-model.ts looks for
// it in GIROVO_MODEL_DIR (/model) and reads the tokenizer synchronously, so:
//
//  - mountModel() lists the files under /model — the 280 MB weights as a stub
//    (GirovoModel runs them natively), the small JSON files with their text;
//  - prepareModel() reads the 17 MB tokenizer.json in only when the model is
//    about to be used (the first /api/category-guesses), not at every start.

import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { GirovoModel, type ModelStatus } from '../native';
import { mountAssets, mountStub, unmount } from '../shims/fs';

const DIR = '/model';
/** Where the plugin keeps the files, in Directory.Data. */
const NATIVE_DIR = 'category-model';
/** Read whole at mount time — small. */
const SMALL = ['model.json', 'tokenizer_config.json', 'config.json', 'special_tokens_map.json'];
/** Read on first use — tokenizer.json is 17 MB. */
const LAZY = ['tokenizer.json'];

let mounted: ModelStatus | null = null;
let prepared: Promise<void> | null = null;

async function readText(name: string): Promise<string> {
  const { data } = await Filesystem.readFile({ path: `${NATIVE_DIR}/${name}`, directory: Directory.Data, encoding: Encoding.UTF8 });
  return typeof data === 'string' ? data : data.text();
}

/** Mirrors the plugin's files into /model. Cheap: the big ones are only listed. */
export async function mountModel(): Promise<ModelStatus | null> {
  unmount(DIR);
  prepared = null;
  let status: ModelStatus;
  try {
    status = await GirovoModel.status();
  } catch {
    return (mounted = null); // no native side (a desktop browser)
  }
  if (!status.installed) return (mounted = status);
  const texts: Record<string, string> = {};
  for (const file of status.files) {
    if (SMALL.includes(file.name)) texts[`${DIR}/${file.name}`] = await readText(file.name);
    else mountStub(`${DIR}/${file.name}`, file.size);
  }
  mountAssets(texts);
  return (mounted = status);
}

/** Puts the tokenizer in before lib/category-model.ts reads it. */
export function prepareModel(): Promise<void> {
  if (!mounted?.installed) return Promise.resolve();
  prepared ??= (async () => {
    const texts: Record<string, string> = {};
    for (const name of LAZY) texts[`${DIR}/${name}`] = await readText(name);
    mountAssets(texts);
  })().catch((err) => {
    prepared = null;
    throw err;
  });
  return prepared;
}
