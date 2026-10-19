// A backup of everything a login keeps on this machine — the personal-data
// vault, the kept Umsätze and the kept documents (the bank's Kontoauszüge,
// the receipts) — in one file the user keeps wherever they like, and brings
// back on a new computer, a phone, or this machine after a loss.
//
// Why it exists: the bank keeps a booking for a few months or years, and
// some banks hand a Kontoauszug out once. What Girovo kept may be the only
// copy left, and it is sealed with the PIN on one device. A backup is the way
// that copy survives the device.
//
// The file (".girovo") is sealed with a password the user chooses for it, not
// with the PIN: it is made to leave the machine — a USB stick, a cloud folder
// — and a five-digit PIN would not stand up to a stolen copy being tried
// offline. AES-256-GCM under scrypt(password, salt) (lib/crypto-box.ts), its
// own AAD. Nothing in it is readable without the password, not even which
// bank it is for.
//
//   { "format": "girovo-backup", "v": 1, "box": SealedBox }
//
// Inside, one binary plaintext: a JSON manifest and then the documents' bytes
// back to back, so a document is not base64-encoded twice.
//
//   [4 bytes: manifest length, big-endian][manifest JSON][document bytes …]
//
// Restoring writes each login's part anew under this machine's PIN, only for
// a login that is signed in now (same BLZ and Anmeldename): a backup never
// becomes another login's data. What is here wins — the vault is merged
// (lib/vault.ts mergeVaults), the Umsätze only fill days not kept yet
// (lib/history.ts fillGaps), and a document already here is not added twice.
//
// No 'server-only' marker, like vault.ts: `node --test` runs the round trip.
// Never log a password, a PIN or anything from inside a backup.

import type { KeptDoc } from './docs.ts';
import type { HistoryData } from './history.ts';
import type { Session } from './session';
import { boxSalt, deriveKey, newSalt, openBox, parseBox, sealBox } from './crypto-box.ts';
import { exportDocs, restoreDocs } from './doc-store.ts';
import { sanitizeDoc } from './docs.ts';
import { HistoryError, fillKeptGaps, loadHistory } from './history-store.ts';
import { compactHistory, sanitizeHistory } from './history.ts';
import { msgs } from './i18n/index.ts';
import { loadVault, restoreVault, sanitizeVault } from './vault.ts';
import { isoDate } from './format.ts';

const AAD = Buffer.from('girovo/backup/v1', 'utf8');
const FORMAT = 'girovo-backup';

/** The shortest password a backup is sealed with. Long, because the file is made to leave the machine. */
export const BACKUP_MIN_PASSWORD = 10;

/** The largest backup file read or written: every document of a few logins, their Umsätze beside them. */
export const BACKUP_MAX_BYTES = 180 * 1024 * 1024;

/** A refusal the route turns into an HTTP status with a message for the user (msgs().backup.server). */
export class BackupError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'BackupError';
    this.status = status;
  }
}

type ManifestDoc = { doc: KeptDoc; offset: number; length: number };

type ManifestLogin = {
  blz: string;
  userId: string;
  bank: string;
  vault: unknown | null;
  history: unknown | null;
  docs: ManifestDoc[];
};

type Manifest = { v: 1; createdAt: string; app: string; logins: ManifestLogin[] };

/** One login's part of a backup, read and checked. */
export type BackupLogin = {
  blz: string;
  userId: string;
  bank: string;
  vault: ReturnType<typeof sanitizeVault>;
  history: HistoryData | null;
  docs: { doc: KeptDoc; bytes: Buffer }[];
};

export type BackupContents = { createdAt: string; app: string; logins: BackupLogin[] };

/** What a backup was made of, per login — for the dialog's answer. Never contents. */
export type BackupSummary = {
  bank: string;
  vault: boolean;
  /** Accounts and bookings of the kept Umsätze. */
  accounts: number;
  bookings: number;
  docs: number;
  /** Parts that could not be read with this PIN and are not in the file. */
  missing: ('vault' | 'history' | 'docs')[];
};

/** What a restore did, per login of the backup. */
export type RestoreReport = {
  bank: string;
  /** No login of this bank is signed in: nothing of it was restored. */
  skipped: boolean;
  vault: boolean;
  days: number;
  bookings: number;
  docs: number;
  /** Documents that did not fit the store's limits. */
  docsFull: number;
  /** The Umsätze were not restored: "Umsätze behalten" is off for this login. */
  historyOff: boolean;
};

const loginOf = (s: Session) => ({
  blz: String(s?.meta?.blz ?? ''),
  userId: String(s?.client?.config?.userId ?? ''),
  bank: String(s?.meta?.bankName ?? ''),
});

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

function pack(manifest: Manifest, blobs: Buffer[]): Buffer {
  const json = Buffer.from(JSON.stringify(manifest), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32BE(json.length, 0);
  return Buffer.concat([head, json, ...blobs]);
}

function unpack(plain: Buffer): { manifest: unknown; body: Buffer } {
  if (plain.length < 4) throw new BackupError(msgs().backup.server.format, 400);
  const len = plain.readUInt32BE(0);
  if (4 + len > plain.length) throw new BackupError(msgs().backup.server.format, 400);
  let manifest: unknown;
  try {
    manifest = JSON.parse(plain.subarray(4, 4 + len).toString('utf8'));
  } catch {
    throw new BackupError(msgs().backup.server.format, 400);
  }
  return { manifest, body: plain.subarray(4 + len) };
}

/** Seals `plain` into the file's text under `password`. */
async function seal(plain: Buffer, password: string): Promise<string> {
  const salt = newSalt();
  const key = await deriveKey(password, salt);
  return JSON.stringify({ format: FORMAT, v: 1, box: sealBox(key, salt, plain, AAD) });
}

/** Opens a backup file's text with `password`: a wrong password and a damaged file are told apart where they can be. */
async function open(text: string, password: string): Promise<Buffer> {
  let envelope: { format?: unknown; v?: unknown; box?: unknown };
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new BackupError(msgs().backup.server.notABackup, 400);
  }
  if (envelope?.format !== FORMAT) throw new BackupError(msgs().backup.server.notABackup, 400);
  if (envelope.v !== 1) throw new BackupError(msgs().backup.server.newer, 400);
  const box = parseBox(envelope.box);
  if (!box) throw new BackupError(msgs().backup.server.format, 400);
  const key = await deriveKey(password, boxSalt(box));
  try {
    return openBox(key, box, AAD);
  } catch {
    // GCM cannot tell a wrong key from an altered file; the wrong password is by far the likelier.
    throw new BackupError(msgs().backup.server.password, 403);
  }
}

// ---------------------------------------------------------------------------
// Making one
// ---------------------------------------------------------------------------

/**
 * The backup of every login in `sessions` (the view: the first login and the
 * further banks signed in now), sealed with `password`. Parts this PIN cannot
 * open are left out and named in the summary — never a reason to save nothing.
 */
export async function makeBackup(sessions: readonly Session[], password: string, app: string): Promise<{ text: string; summary: BackupSummary[] }> {
  if (typeof password !== 'string' || Array.from(password).length < BACKUP_MIN_PASSWORD) {
    throw new BackupError(msgs().backup.server.tooShort(BACKUP_MIN_PASSWORD), 400);
  }
  const logins: ManifestLogin[] = [];
  const blobs: Buffer[] = [];
  const summary: BackupSummary[] = [];
  let offset = 0;
  for (const s of sessions) {
    const who = loginOf(s);
    if (!who.blz || !who.userId) continue;
    const missing: BackupSummary['missing'] = [];

    let vault: unknown = null;
    try {
      const v = await loadVault(s);
      if (v.status === 'ready') vault = v.data;
      else missing.push('vault');
    } catch {
      missing.push('vault');
    }

    let history: unknown = null;
    let accounts = 0;
    let bookings = 0;
    try {
      const h = await loadHistory(s);
      if (h.status === 'ready' && h.data) {
        const data = sanitizeHistory(h.data, isoDate(new Date()));
        if (data) {
          history = compactHistory(data);
          accounts = Object.keys(data.accounts).length;
          bookings = Object.values(data.accounts).reduce((n, a) => n + a.txs.length, 0);
        }
      } else if (h.status === 'error') missing.push('history');
    } catch {
      missing.push('history');
    }

    const docs: ManifestDoc[] = [];
    try {
      const exported = await exportDocs(s);
      for (const { doc, bytes } of exported.docs) {
        docs.push({ doc, offset, length: bytes.length });
        blobs.push(bytes);
        offset += bytes.length;
      }
      if (exported.unreadable) missing.push('docs');
    } catch {
      missing.push('docs');
    }

    logins.push({ ...who, vault, history, docs });
    summary.push({ bank: who.bank, vault: vault != null, accounts, bookings, docs: docs.length, missing });
  }
  if (!logins.length) throw new BackupError(msgs().backup.server.nothing, 409);
  const plain = pack({ v: 1, createdAt: new Date().toISOString(), app, logins }, blobs);
  const text = await seal(plain, password);
  if (Buffer.byteLength(text) > BACKUP_MAX_BYTES) throw new BackupError(msgs().backup.server.tooLarge, 413);
  return { text, summary };
}

// ---------------------------------------------------------------------------
// Reading one
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A backup file's contents, opened with `password` and checked part by part as if it came from anywhere. */
export async function readBackup(text: string, password: string): Promise<BackupContents> {
  if (typeof text !== 'string' || Buffer.byteLength(text) > BACKUP_MAX_BYTES) throw new BackupError(msgs().backup.server.tooLarge, 413);
  const { manifest, body } = unpack(await open(text, String(password ?? '')));
  if (!isRecord(manifest) || manifest.v !== 1 || !Array.isArray(manifest.logins)) {
    throw new BackupError(msgs().backup.server.format, 400);
  }
  const today = isoDate(new Date());
  const logins: BackupLogin[] = [];
  for (const raw of manifest.logins.slice(0, 20)) {
    if (!isRecord(raw)) continue;
    const blz = typeof raw.blz === 'string' && /^\d{8}$/.test(raw.blz) ? raw.blz : '';
    const userId = typeof raw.userId === 'string' && raw.userId.length <= 64 ? raw.userId : '';
    if (!blz || !userId) continue;
    const docs: BackupLogin['docs'] = [];
    for (const d of Array.isArray(raw.docs) ? raw.docs : []) {
      if (!isRecord(d)) continue;
      const doc = sanitizeDoc(d.doc);
      const { offset, length } = d as { offset?: unknown; length?: unknown };
      if (!doc || !Number.isSafeInteger(offset) || !Number.isSafeInteger(length)) continue;
      const start = offset as number;
      const end = start + (length as number);
      if (start < 0 || end > body.length || length !== doc.size) continue;
      docs.push({ doc, bytes: Buffer.from(body.subarray(start, end)) });
    }
    logins.push({
      blz,
      userId,
      bank: typeof raw.bank === 'string' ? raw.bank.slice(0, 120) : '',
      vault: raw.vault == null ? null : sanitizeVault(raw.vault),
      history: raw.history == null ? null : sanitizeHistory(raw.history, today),
      docs,
    });
  }
  return {
    createdAt: typeof manifest.createdAt === 'string' ? manifest.createdAt : '',
    app: typeof manifest.app === 'string' ? manifest.app.slice(0, 40) : '',
    logins,
  };
}

// ---------------------------------------------------------------------------
// Restoring one
// ---------------------------------------------------------------------------

/**
 * Restores each login of `contents` into the session of the same login among
 * `sessions`; one without its session is skipped and said so. The vault
 * first, so a backup that kept its Umsätze switches keeping on before they
 * are filled in.
 */
export async function restoreBackup(sessions: readonly Session[], contents: BackupContents): Promise<RestoreReport[]> {
  const out: RestoreReport[] = [];
  for (const login of contents.logins) {
    const s = sessions.find((x) => {
      const who = loginOf(x);
      return who.blz === login.blz && who.userId === login.userId;
    });
    const report: RestoreReport = {
      bank: login.bank || (s ? loginOf(s).bank : ''),
      skipped: !s,
      vault: false,
      days: 0,
      bookings: 0,
      docs: 0,
      docsFull: 0,
      historyOff: false,
    };
    if (!s) {
      out.push(report);
      continue;
    }
    if (login.vault) {
      await restoreVault(s, login.vault);
      report.vault = true;
    }
    if (login.history && Object.keys(login.history.accounts).length) {
      try {
        const filled = await fillKeptGaps(s, login.history);
        report.days = filled.days;
        report.bookings = filled.bookings;
      } catch (err) {
        if (!(err instanceof HistoryError) || err.reason !== 'notKept') throw err;
        report.historyOff = true;
      }
    }
    if (login.docs.length) {
      const docs = await restoreDocs(s, login.docs);
      report.docs = docs.added;
      report.docsFull = docs.full;
    }
    out.push(report);
  }
  return out;
}

/** The file name a backup is offered under: "Girovo-Sicherung_2026-10-19.girovo". ASCII only. */
export function backupFileName(day: string): string {
  return `${msgs().backup.file}_${day.replace(/[^0-9-]/g, '')}.girovo`;
}
