// What this device keeps about its sync group (lib/sync.ts), beside the
// first login's vault: the group's key, this device's id and name, where the
// devices meet, and the stamps the merge needs. Sealed with the vault's own
// key (the login's PIN), so it opens only while the login does — a vault
// that is reset or wiped takes it along, and the device joins again.
//
// Named like the vault, `<vault base>.sync`. Never in a backup, never logged.

import fs from 'node:fs';
import path from 'node:path';
import { openBox, parseBox, sealBox } from './crypto-box.ts';
import type { Session } from './session';
import { readPlace, type SyncDevice, type SyncLocal, type SyncPlace } from './sync.ts';
import { removeFamily, serialized, writeFileAtomic } from './sealed-file.ts';
import { STATE_DIR } from './state-store.ts';
import { vaultBaseName, vaultKeyOf } from './vault';

export type SyncMeta = {
  key: Buffer;
  deviceId: string;
  deviceName: string;
  place: SyncPlace;
  local: SyncLocal;
  lastSync?: number;
  devices?: SyncDevice[];
};

const FILE_MAX = 8 * 1024 * 1024;
const AAD = 'girovo/sync-meta/v1';

export function syncMetaFile(base: string): string {
  return path.join(STATE_DIR, `${base}.sync`);
}

/** The file of the session's login, whether or not its vault is open. */
export function syncMetaFileOf(blz: string, userId: string): string {
  return syncMetaFile(vaultBaseName(blz, userId));
}

function sanitize(raw: unknown): SyncMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const key = Buffer.from(String(r.key ?? ''), 'base64');
  const place = readPlace(r.place);
  if (key.length !== 32 || typeof r.deviceId !== 'string' || !/^[0-9a-f]{16}$/.test(r.deviceId) || !place) return null;
  const local = (r.local && typeof r.local === 'object' ? r.local : {}) as Partial<SyncLocal>;
  return {
    key,
    deviceId: r.deviceId,
    deviceName: typeof r.deviceName === 'string' ? r.deviceName.slice(0, 40) : '',
    place,
    local: {
      ...(local.joining === true ? { joining: true as const } : {}),
      stamps: local.stamps && typeof local.stamps === 'object' ? local.stamps : {},
      uploaded: Array.isArray(local.uploaded) ? local.uploaded.filter((h): h is string => typeof h === 'string') : [],
      hashes: local.hashes && typeof local.hashes === 'object' ? local.hashes : {},
    },
    ...(typeof r.lastSync === 'number' ? { lastSync: r.lastSync } : {}),
    ...(Array.isArray(r.devices) ? { devices: r.devices as SyncDevice[] } : {}),
  };
}

/** This login's sync settings: null when it has none, or they do not open (the vault was reset). */
export async function readMeta(s: Session): Promise<SyncMeta | null> {
  const vk = vaultKeyOf(s);
  if (!vk) return null;
  const file = syncMetaFile(vk.base);
  return serialized(file, async () => {
    let raw: string;
    try {
      const st = await fs.promises.stat(file);
      if (st.size > FILE_MAX) return null;
      raw = await fs.promises.readFile(file, 'utf8');
    } catch {
      return null;
    }
    try {
      const box = parseBox(JSON.parse(raw));
      if (!box) return null;
      return sanitize(JSON.parse(openBox(vk.key, box, Buffer.from(`${AAD}|${vk.base}`)).toString('utf8')));
    } catch {
      return null;
    }
  });
}

export async function writeMeta(s: Session, meta: SyncMeta): Promise<void> {
  const vk = vaultKeyOf(s);
  if (!vk) throw new Error('sync: the vault is not open');
  const file = syncMetaFile(vk.base);
  const plain = Buffer.from(JSON.stringify({ ...meta, key: meta.key.toString('base64') }), 'utf8');
  await serialized(file, () => writeFileAtomic(file, JSON.stringify(sealBox(vk.key, vk.salt, plain, Buffer.from(`${AAD}|${vk.base}`)))));
}

/** Leaves the group on this device: its settings go, copies included. Needs no key. */
export async function removeMeta(blz: string, userId: string): Promise<void> {
  const file = syncMetaFileOf(blz, userId);
  await serialized(file, async () => {
    await removeFamily(path.dirname(file), path.basename(file), (code) => console.warn('[sync] could not delete a file:', code));
  });
}
