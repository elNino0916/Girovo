// @capacitor/filesystem for the desktop runtime: the part of it
// mobile/shims/fs.ts uses, over the Tauri shell's file commands
// (src-tauri/src/files.rs). Directory.Data is the data folder — the very one
// the Electron shell used — so "fints-state/…" is where the device profiles,
// vaults and kept Umsätze already are.

import { invoke } from '../shell';

export enum Directory {
  Data = 'DATA',
}

export enum Encoding {
  UTF8 = 'utf8',
}

type PathArgs = { path: string; directory?: Directory };

export const Filesystem = {
  async readdir({ path }: PathArgs): Promise<{ files: Array<{ name: string; type: 'file' | 'directory' }> }> {
    return { files: await invoke('fs_list', { path }) };
  },
  async readFile({ path }: PathArgs & { encoding?: Encoding }): Promise<{ data: string }> {
    return { data: await invoke<string>('fs_read', { path }) };
  },
  async writeFile({ path, data }: PathArgs & { data: string; encoding?: Encoding; recursive?: boolean }): Promise<{ uri: string }> {
    await invoke('fs_write', { path, data });
    return { uri: path };
  },
  async deleteFile({ path }: PathArgs): Promise<void> {
    await invoke('fs_delete', { path });
  },
  async rename({ from, to }: { from: string; to: string; directory?: Directory; toDirectory?: Directory }): Promise<void> {
    await invoke('fs_rename', { from, to });
  },
};
