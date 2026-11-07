// The sync places that are folders on this computer (lib/sync-stores.ts):
// the LAN shelf the phone writes into over the network, and a folder a sync
// tool keeps in step. Read from disk through the shell every time — the
// page's in-memory tree (mobile/shims/fs.ts) would never see a file the
// phone or OneDrive put there meanwhile.

import { Buffer } from 'buffer';
import type { SyncStore } from '../../lib/sync.ts';
import { invoke } from '../shell';

/** `lan` for the shelf, else the folder's absolute path. */
function folder(place: string): SyncStore {
  return {
    async get(name) {
      const data = await invoke<string | null>('folder_get', { place, name });
      return data == null ? null : Buffer.from(data, 'base64');
    },
    async put(name, bytes) {
      await invoke('folder_put', { place, name, data: Buffer.from(bytes).toString('base64') });
    },
    async remove(name) {
      await invoke('folder_remove', { place, name });
    },
  };
}

export function installFolders(): void {
  (globalThis as { __girovoFolderStore?: (place: string) => SyncStore }).__girovoFolderStore = folder;
  // "Gespeicherte Daten löschen": one sync group's files off the LAN shelf,
  // on disk (lib/wipe-saved.ts forgetLanGroup, src-tauri/src/reset.rs lan_forget).
  (globalThis as { __girovoLanForget?: (group: string) => Promise<number> }).__girovoLanForget =
    (group) => invoke<number>('lan_forget', { group });
}
