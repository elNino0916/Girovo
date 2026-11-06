// Where "Neue Umsätze melden" keeps its sealed box (lib/background-check.ts).
//
// The desktop: one file in the state folder. The phone: the app's own
// preferences, through the shell (globalThis.__girovoBackgroundStore, set by
// mobile/runtime.ts and by the background job's runtime) — the page's runtime
// and the job's each hold the state folder in memory and would overwrite each
// other's copy of a file, while the preferences are one for the whole app.

import fs from 'node:fs';
import path from 'node:path';
import { IS_ANDROID } from './platform.ts';
import { removeFamily, serialized, writeFileAtomic } from './sealed-file.ts';
import { STATE_DIR } from './state-store.ts';

/**
 * The sealed box as text, or null when there is none; writing null deletes
 * it. With `expected`, a compare-and-set: written only while the box is still
 * that text (null: still none), answering whether it was.
 */
export type BackgroundStore = {
  read(): Promise<string | null>;
  write(text: string | null, expected?: string | null): Promise<boolean>;
};

type StoreGlobal = typeof globalThis & { __girovoBackgroundStore?: BackgroundStore };

/**
 * Whether this server keeps PINs for the checks at all: the desktop app's own
 * (and the development server, `npm run dev`), and the phone where its
 * shell provides the store. Never a server other people use.
 */
export function backgroundServed(): boolean {
  if (IS_ANDROID) return !!(globalThis as StoreGlobal).__girovoBackgroundStore;
  return process.env.GIROVO_DESKTOP === '1' || process.env.NODE_ENV === 'development';
}

export function backgroundFile(): string {
  return path.join(STATE_DIR, 'background.box');
}

export function backgroundStore(): BackgroundStore {
  const injected = (globalThis as StoreGlobal).__girovoBackgroundStore;
  if (injected) return injected;
  const file = backgroundFile();
  return {
    async read() {
      try {
        return await fs.promises.readFile(file, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
        throw err;
      }
    },
    write(text, expected) {
      return serialized(file, async () => {
        if (expected !== undefined) {
          let now: string | null = null;
          try {
            now = await fs.promises.readFile(file, 'utf8');
          } catch (err) {
            if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
          }
          if (now !== expected) return false;
        }
        if (text != null) {
          await writeFileAtomic(file, text);
          return true;
        }
        // The file and every copy beside it: a cut-short write leaves one that opens too.
        const { failed } = await removeFamily(path.dirname(file), path.basename(file), (code) => {
          console.warn('[background] could not delete a file:', code);
        });
        if (failed) throw new Error(`background: ${failed} file(s) left`);
        return true;
      });
    },
  };
}
