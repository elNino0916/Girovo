// The personal-data vault.
//
// What the user tells the app about their own money — the names they give
// their accounts, the people they pay regularly (IBANs included), how they file
// their bookings — has to survive a restart, but must not sit in plaintext on
// disk or in localStorage (which the desktop build wipes on every start
// anyway). So it is sealed like the device profile: AES-256-GCM under a key
// derived from the PIN (lib/crypto-box.ts), in the same STATE_DIR. It follows
// that the vault only exists while you are logged in.
//
// Where it differs from the device profile, and why:
//   - The derived key is cached per session and the file keeps its salt across
//     saves (every save still gets a fresh IV). The client saves after each
//     rename or category change, and scrypt is slow on purpose.
//   - Writes are atomic (tmp + fsync + rename). This file is the only copy of
//     what the user typed in; a torn write would lose all of it, where a torn
//     device profile merely costs one TAN.
//   - An unreadable file is never overwritten implicitly. A save that cannot
//     open the existing file is refused; only an explicit reset moves it aside
//     to .bak. A PIN change at the bank therefore costs a reset, not the data —
//     the old file still opens with the old PIN.
//   - Deleting is explicit too, and complete: wipeVault removes the file
//     together with every backup, because each of them can be tried against
//     PINs offline by whoever has the machine next.
//   - Everything is sanitised on the way in *and* out. Every future version of
//     the client shares this store, and a shape it doesn't know must never
//     reach a view.
//
// No 'server-only' marker: like state-store.ts it needs node:fs, which already
// keeps it out of any client bundle, and leaving the marker off lets
// `node --test` exercise the real file round trip (lib/vault.test.ts).
//
// Never log vault contents or the PIN — not even on an error path.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { TransferTemplate, VaultData, VaultGetResponse, VaultPutResponse } from './app-types.ts';
import type { CategoryId } from './categories.ts';
import type { SealedBox } from './crypto-box.ts';
import type { Session } from './session';
import { EMPTY_VAULT } from './app-types.ts';
import { isCategoryId } from './categories.ts';
import { boxSalt, deriveKey, newSalt, openBox, parseBox, sealBox } from './crypto-box.ts';
import { STATE_DIR } from './state-store.ts';

/**
 * Caps applied by sanitizeVault. Generous for a person, tight for a runaway
 * client: the byte ceiling is on the plaintext JSON, and the counts keep a
 * vault well under it in practice.
 */
export const VAULT_LIMITS = {
  bytes: 512 * 1024,
  templates: 200,
  aliases: 50,
  rules: 5000,
  txCategories: 5000,
  dismissed: 500,
  // String lengths in characters. name/purpose/iban are the SEPA field limits.
  label: 60,
  name: 70,
  iban: 34,
  purpose: 140,
  amount: 20,
  alias: 60,
  templateId: 64,
  accountKey: 64,
  key: 200,
};

/** The route reads at most this much — room for a full vault plus fields sanitizeVault will drop. */
export const VAULT_REQUEST_MAX_BYTES = 2 * VAULT_LIMITS.bytes;

// A sealed file is base64 of the plaintext (4/3) plus a small envelope.
const FILE_MAX_BYTES = Math.ceil((VAULT_LIMITS.bytes * 4) / 3) + 4096;

// Binds the ciphertext to its purpose, so no other box sealed under a key from
// the same PIN (the device profile, say) can be passed off as a vault.
const AAD = Buffer.from('sooskasse-fints/vault/v1', 'utf8');

/** A refusal the route turns into an HTTP status with a message for the user. */
export class VaultError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'VaultError';
    this.status = status;
  }
}

const MSG = {
  unavailable: 'Für diese Sitzung können keine persönlichen Daten gespeichert werden.',
  locked: 'Deine gespeicherten Daten lassen sich mit dieser PIN nicht öffnen. Setze sie zurück, um neu zu beginnen.',
  format: 'Die Daten haben ein unbekanntes Format.',
  tooLarge: 'Zu viele gespeicherte Einträge. Lösche ein paar Vorlagen oder Kategorie-Zuordnungen und versuche es erneut.',
  read: 'Deine gespeicherten Daten konnten nicht gelesen werden.',
  write: 'Deine Daten konnten nicht gespeichert werden.',
  wipe: 'Deine gespeicherten Daten konnten nicht vollständig gelöscht werden. Bitte versuche es erneut.',
};

// ---------------------------------------------------------------------------
// Sanitisation
// ---------------------------------------------------------------------------

// C0/C1 controls and the Unicode line/paragraph separators: none belongs in a
// one-line label, and a stray one breaks a SEPA field or a CSV cell later on.
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const HAS_CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** A one-line string, clipped to `max` characters ('' for anything else). */
function text(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  const s = v.replace(CONTROLS, ' ').replace(/\s+/g, ' ').trim();
  // Clip by code point, so an emoji at the boundary is not cut into a lone surrogate.
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, max).join('').trimEnd() : s;
}

/**
 * Whether `k` can serve as a map key. Keys are never clipped — a shortened key
 * is a different key — they are refused.
 */
const keyOk = (k: unknown, max: number): k is string =>
  typeof k === 'string' && k.length > 0 && k.length <= max && k !== '__proto__' && !HAS_CONTROL.test(k);

function iso(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 40) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * The IBAN without spaces, if it is one. Mirrors validateIban() in
 * fints-sepa.ts; kept local so this module loads under `node --test` without
 * pulling in lib-fints.
 */
function ibanOf(v: unknown): string | null {
  const iban = typeof v === 'string' ? v.replace(/\s+/g, '').toUpperCase() : '';
  if (iban.length > VAULT_LIMITS.iban || !/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return null;
  if (iban.startsWith('DE') && iban.length !== 22) return null;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const digits = ch >= '0' && ch <= '9' ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of digits) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1 ? iban : null;
}

function template(v: unknown): TransferTemplate | null {
  if (!isRecord(v)) return null;
  if (!keyOk(v.id, VAULT_LIMITS.templateId)) return null;
  const name = text(v.name, VAULT_LIMITS.name);
  const iban = ibanOf(v.iban);
  // A template without a payee is nothing to transfer to.
  if (!name || !iban) return null;
  const t: TransferTemplate = {
    id: v.id,
    label: text(v.label, VAULT_LIMITS.label) || text(name, VAULT_LIMITS.label),
    name,
    iban,
    createdAt: iso(v.createdAt) ?? EMPTY_VAULT.updatedAt,
  };
  // An amount is never clipped (that would change its value) — dropped instead.
  const amount = text(v.amount, Number.MAX_SAFE_INTEGER);
  if (amount && Array.from(amount).length <= VAULT_LIMITS.amount && /\d/.test(amount)) t.amount = amount;
  const purpose = text(v.purpose, VAULT_LIMITS.purpose);
  if (purpose) t.purpose = purpose;
  if (typeof v.instant === 'boolean') t.instant = v.instant;
  const lastUsedAt = iso(v.lastUsedAt);
  if (lastUsedAt) t.lastUsedAt = lastUsedAt;
  return t;
}

function templates(v: unknown): TransferTemplate[] {
  const seen = new Set<string>();
  const out: TransferTemplate[] = [];
  for (const raw of Array.isArray(v) ? v : []) {
    const t = template(raw);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  if (out.length <= VAULT_LIMITS.templates) return out;
  // Over the cap, the least recently used go — in the client's own order.
  const recency = (t: TransferTemplate) => Math.max(Date.parse(t.lastUsedAt ?? '') || 0, Date.parse(t.createdAt) || 0);
  const keep = new Set([...out].sort((a, b) => recency(b) - recency(a)).slice(0, VAULT_LIMITS.templates));
  return out.filter((t) => keep.has(t));
}

/**
 * A string-keyed map, filtered entry by entry. Over the cap the *last*
 * entries survive: the client adds a new decision by spreading it onto the
 * end, so those are the newest. (JS orders digit-only keys — account numbers —
 * numerically instead; for aliases the cap is a backstop, never reached by a
 * real login's handful of accounts.)
 */
function capMap<V>(v: unknown, max: number, keyMax: number, value: (raw: unknown, key: string) => V | null): Record<string, V> {
  const entries: [string, V][] = [];
  if (isRecord(v)) {
    for (const [k, raw] of Object.entries(v)) {
      if (!keyOk(k, keyMax)) continue;
      const val = value(raw, k);
      if (val !== null) entries.push([k, val]);
    }
  }
  const out: Record<string, V> = {};
  for (const [k, val] of entries.slice(-max)) out[k] = val;
  return out;
}

const category = (raw: unknown): CategoryId | null => (isCategoryId(raw) ? raw : null);

/**
 * The vault as this server version understands it, or null when `input` is not
 * a vault at all (wrong type or version). Unknown keys are dropped, strings
 * clipped, IBANs and category ids validated, collections capped.
 */
export function sanitizeVault(input: unknown): VaultData | null {
  if (!isRecord(input) || input.version !== 1) return null;
  const dismissed = Array.isArray(input.dismissedRecurring)
    ? [...new Set(input.dismissedRecurring.filter((d): d is string => keyOk(d, VAULT_LIMITS.key)))]
    : [];
  return {
    version: 1,
    templates: templates(input.templates),
    aliases: capMap(input.aliases, VAULT_LIMITS.aliases, VAULT_LIMITS.accountKey, (raw) => text(raw, VAULT_LIMITS.alias) || null),
    // counterpartyKey() always carries one of these prefixes (lib/categories.ts).
    categoryRules: capMap(input.categoryRules, VAULT_LIMITS.rules, VAULT_LIMITS.key, (raw, k) =>
      /^(cred|iban|name):/.test(k) ? category(raw) : null),
    txCategories: capMap(input.txCategories, VAULT_LIMITS.txCategories, VAULT_LIMITS.key, category),
    dismissedRecurring: dismissed.slice(-VAULT_LIMITS.dismissed),
    updatedAt: iso(input.updatedAt) ?? EMPTY_VAULT.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Files and keys
// ---------------------------------------------------------------------------

type Identity = { blz: string; userId: string; pin: string };

/** What a session's vault is keyed by. The PIN is held by lib-fints' config, in memory only. */
function identityOf(s: Session): Identity {
  const cfg = s?.client?.config;
  const blz = s?.meta?.blz;
  if (!cfg?.pin || !cfg.userId || !blz) throw new VaultError(MSG.unavailable, 409);
  return { blz: String(blz), userId: String(cfg.userId), pin: String(cfg.pin) };
}

// Named by a hash like the device profile, so the directory listing says
// nothing about which bank or user it belongs to.
/** A login's vault file name without directory or extension; its backups share it. */
export function vaultBaseName(blz: string, userId: string): string {
  return crypto.createHash('sha256').update(`${blz}|${userId}|vault`).digest('hex').slice(0, 32);
}

function vaultFile(id: Pick<Identity, 'blz' | 'userId'>): string {
  return path.join(STATE_DIR, `${vaultBaseName(id.blz, id.userId)}.vault`);
}

/** A key that has opened (or created) the file at `file`. */
type Unlocked = { file: string; salt: Buffer; key: Buffer };

// Keyed by the session object, so the key goes with the session: logout, the
// idle sweeper or a hot reload drop it without any bookkeeping here.
const unlocked = new WeakMap<Session, Unlocked>();

// One operation per file at a time. The client debounces its saves, but a save
// can still overlap a reset, or a second window of the same login.
const queues = new Map<string, Promise<unknown>>();
function serialized<T>(file: string, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(file) ?? Promise.resolve()).then(task);
  const tail = run.then(() => undefined, () => undefined);
  queues.set(file, tail);
  void tail.then(() => {
    if (queues.get(file) === tail) queues.delete(file);
  });
  return run;
}

type Sealed = { kind: 'missing' } | { kind: 'corrupt' } | { kind: 'sealed'; box: SealedBox };

function readSealed(file: string): Sealed {
  let raw: string;
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > FILE_MAX_BYTES) return { kind: 'corrupt' };
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return { kind: 'missing' };
    console.warn('[vault] read failed:', (err as NodeJS.ErrnoException)?.code || 'unknown');
    throw new VaultError(MSG.read, 500);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'corrupt' };
  }
  const box = parseBox(parsed);
  return box ? { kind: 'sealed', box } : { kind: 'corrupt' };
}

type Opened =
  | { status: 'missing' }
  | { status: 'error'; reason: 'decrypt' | 'corrupt' }
  | { status: 'ready'; data: VaultData; entry: Unlocked };

async function openVaultFile(s: Session, id: Identity, file: string): Promise<Opened> {
  const sealed = readSealed(file);
  if (sealed.kind === 'missing') return { status: 'missing' };
  if (sealed.kind === 'corrupt') return { status: 'error', reason: 'corrupt' };
  const salt = boxSalt(sealed.box);
  const cached = unlocked.get(s);
  const key = cached && cached.file === file && cached.salt.equals(salt) ? cached.key : await deriveKey(id.pin, salt);
  let plaintext: Buffer;
  try {
    plaintext = openBox(key, sealed.box, AAD);
  } catch {
    return { status: 'error', reason: 'decrypt' }; // other PIN, or the file was altered
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext.toString('utf8'));
  } catch {
    // Not rethrown: the parser's message would quote the decrypted text.
    return { status: 'error', reason: 'corrupt' };
  }
  const data = sanitizeVault(parsed);
  return data ? { status: 'ready', data, entry: { file, salt, key } } : { status: 'error', reason: 'corrupt' };
}

async function freshKey(id: Identity, file: string): Promise<Unlocked> {
  const salt = newSalt();
  return { file, salt, key: await deriveKey(id.pin, salt) };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Windows refuses a rename onto a file another process (virus scanner, search
// indexer, backup tool) briefly holds open. Those locks clear within
// milliseconds, so a few short retries beat failing the user's save.
async function renameRetrying(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (attempt >= 5 || !(code === 'EPERM' || code === 'EACCES' || code === 'EBUSY')) throw err;
      await sleep(15 * 2 ** attempt);
    }
  }
}

/** Delete `file` (a missing one counts as deleted), riding out the same brief Windows locks. */
async function removeRetrying(file: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.rmSync(file, { force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (attempt >= 5 || !(code === 'EPERM' || code === 'EACCES' || code === 'EBUSY')) throw err;
      await sleep(15 * 2 ** attempt);
    }
  }
}

/** Replace `file` so that a crash leaves either the old or the new content, never half of one. */
async function writeFileAtomic(file: string, contents: string): Promise<void> {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, contents, 'utf8');
      fs.fsyncSync(fd); // the rename must not reach the disk before the data does
    } finally {
      fs.closeSync(fd);
    }
    await renameRetrying(tmp, file);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch { /* best effort */ }
    throw err;
  }
}

async function writeVault(entry: Unlocked, data: VaultData): Promise<void> {
  const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
  if (plaintext.length > VAULT_LIMITS.bytes) throw new VaultError(MSG.tooLarge, 413);
  try {
    await writeFileAtomic(entry.file, JSON.stringify(sealBox(entry.key, entry.salt, plaintext, AAD)));
  } catch (err) {
    console.warn('[vault] write failed:', (err as NodeJS.ErrnoException)?.code || 'unknown');
    throw new VaultError(MSG.write, 500);
  }
}

/** Move an existing vault file out of the way, never over an earlier backup. */
async function moveAside(file: string): Promise<boolean> {
  if (!fs.existsSync(file)) return false;
  const bak = fs.existsSync(`${file}.bak`) ? `${file}.${Date.now()}.bak` : `${file}.bak`;
  await renameRetrying(file, bak);
  return true;
}

// ---------------------------------------------------------------------------
// Operations (one per /api/vault op)
// ---------------------------------------------------------------------------

/**
 * The session's vault. `data: null` means there is none yet — a first use,
 * not an error. A file this PIN cannot open answers `error` and stays
 * untouched until the user resets it.
 */
export async function loadVault(s: Session): Promise<VaultGetResponse> {
  const id = identityOf(s);
  const file = vaultFile(id);
  return serialized(file, async (): Promise<VaultGetResponse> => {
    const opened = await openVaultFile(s, id, file);
    if (opened.status === 'missing') return { status: 'ready', data: null };
    if (opened.status === 'error') {
      unlocked.delete(s);
      return { status: 'error', reason: opened.reason };
    }
    unlocked.set(s, opened.entry);
    return { status: 'ready', data: opened.data };
  });
}

/**
 * Replace the vault with `input` (sanitised). The server stamps `updatedAt`.
 * Refused (409) while the file on disk cannot be opened with this PIN.
 */
export async function saveVault(s: Session, input: unknown): Promise<VaultPutResponse> {
  const id = identityOf(s);
  const data = sanitizeVault(input);
  if (!data) throw new VaultError(MSG.format, 400);
  const file = vaultFile(id);
  return serialized(file, async (): Promise<VaultPutResponse> => {
    let entry = unlocked.get(s);
    if (!entry || entry.file !== file) {
      // First save of this session without a prior load: prove the key on
      // the existing file before replacing it.
      const opened = await openVaultFile(s, id, file);
      if (opened.status === 'error') throw new VaultError(MSG.locked, 409);
      entry = opened.status === 'ready' ? opened.entry : await freshKey(id, file);
      unlocked.set(s, entry);
    }
    const updatedAt = new Date().toISOString();
    await writeVault(entry, { ...data, updatedAt });
    return { ok: true, updatedAt };
  });
}

/**
 * Start over: move whatever is there aside to `.bak` and write an empty vault
 * under a fresh salt. The only path that replaces a file this PIN cannot open.
 */
export async function resetVault(s: Session): Promise<VaultPutResponse> {
  const id = identityOf(s);
  const file = vaultFile(id);
  return serialized(file, async (): Promise<VaultPutResponse> => {
    unlocked.delete(s);
    let moved: boolean;
    try {
      moved = await moveAside(file);
    } catch (err) {
      console.warn('[vault] could not move the old file aside:', (err as NodeJS.ErrnoException)?.code || 'unknown');
      throw new VaultError(MSG.write, 500);
    }
    const entry = await freshKey(id, file);
    const updatedAt = new Date().toISOString();
    await writeVault(entry, { ...EMPTY_VAULT, updatedAt });
    unlocked.set(s, entry);
    if (moved) console.log(`[vault] reset; previous file kept as backup (blz=${id.blz})`);
    return { ok: true, updatedAt };
  });
}

/**
 * Remove this login's personal data from the machine for good: the vault,
 * every backup a reset set aside (`.bak`, `.<time>.bak`) and any temp file a
 * crashed write left behind. Each of them opens with a PIN, so each is a file
 * someone with this machine could try PINs against offline — "Gerät
 * vergessen" before handing a computer on must not leave them behind.
 *
 * Needs no PIN (an unreadable file is the one most worth removing) and only
 * the session's own login: the identity comes from the session, never from
 * the request. The session's cached key goes too. The client stops saving
 * before it asks for this, so nothing writes the file again afterwards.
 * Returns how many files were removed.
 */
export async function wipeVault(s: Session): Promise<number> {
  const blz = s?.meta?.blz;
  const userId = s?.client?.config?.userId;
  if (!blz || !userId) throw new VaultError(MSG.unavailable, 409);
  const stem = `${vaultBaseName(String(blz), String(userId))}.vault`;
  const file = path.join(STATE_DIR, stem);
  return serialized(file, async () => {
    unlocked.delete(s);
    let names: string[];
    try {
      names = fs.readdirSync(STATE_DIR);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return 0; // never saved anything
      console.warn('[vault] wipe: cannot list the state directory:', (err as NodeJS.ErrnoException)?.code || 'unknown');
      throw new VaultError(MSG.wipe, 500);
    }
    let removed = 0;
    let failed = 0;
    for (const name of names) {
      if (name !== stem && !name.startsWith(`${stem}.`)) continue;
      try {
        await removeRetrying(path.join(STATE_DIR, name));
        removed++;
      } catch (err) {
        failed++;
        console.warn('[vault] wipe: could not delete a file:', (err as NodeJS.ErrnoException)?.code || 'unknown');
      }
    }
    console.log(`[vault] wiped ${removed} file(s)${failed ? `, ${failed} left` : ''} (blz=${blz})`);
    if (failed) throw new VaultError(MSG.wipe, 500);
    return removed;
  });
}
