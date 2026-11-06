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
  };
}

export function installFolders(): void {
  (globalThis as { __girovoFolderStore?: (place: string) => SyncStore }).__girovoFolderStore = folder;
}
