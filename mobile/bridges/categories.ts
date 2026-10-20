// The category guess for the page (Einstellungen, the progress bar): whether
// this phone has Gemini Nano, AICore's download of it, and how far the
// bookings waiting for it are. The guess itself runs in the phone server
// (mobile/server/categories.ts), on the same plugin (NanoPlugin.java).

import type { PluginListenerHandle } from '@capacitor/core';
import { GirovoNano, type NanoProgress, type NanoStatus } from '../native';
import { refreshNano } from '../server/categories';

const UNSUPPORTED: NanoStatus = { state: 'unsupported', reason: 'unavailable' };
const IDLE: NanoProgress = { active: false, done: 0, total: 0, waiting: null };

export async function status(): Promise<NanoStatus> {
  return (await refreshNano()) ?? UNSUPPORTED;
}

const listen = (handle: Promise<PluginListenerHandle>): (() => void) => () => void handle.then((h) => h.remove());

/** AICore's download as it goes, then the status it ended in. */
export function onStatus(fn: (s: NanoStatus) => void): () => void {
  return listen(
    GirovoNano.addListener('download', (s) => {
      // The server's own copy, so a guess asked now sees the model.
      if (s.state !== 'downloading') void refreshNano();
      fn(s);
    }),
  );
}

export async function download(): Promise<NanoStatus> {
  const s = await GirovoNano.download().catch(() => UNSUPPORTED);
  await refreshNano();
  return s;
}

export function progress(): Promise<NanoProgress> {
  return GirovoNano.progress().catch(() => IDLE);
}

export function onProgress(fn: (p: NanoProgress) => void): () => void {
  return listen(GirovoNano.addListener('progress', fn));
}
