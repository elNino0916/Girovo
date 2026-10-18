// Documents kept on this machine (lib/docs.ts), on disk: the bank's own
// Kontoauszüge and the receipts attached to bookings.
//
// Per login, in STATE_DIR, named by a hash like the vault so the directory
// says nothing about bank or user:
//
//   <base>.docs        the index — every document's description (KeptDoc)
//   <base>.docs.<id>   one document each
//
// All of them sealed with AES-256-GCM under one key from the PIN
// (lib/crypto-box.ts): the index holds the salt, every document is sealed
// with the same one, so the key is derived once a session. Each file has its
// own AAD — the index's, and the document's with its id — so no box can be
// passed off as another. Written atomically, one operation on the index at a
// time (lib/sealed-file.ts). One family of files, so "Gespeicherte Daten
// löschen" and "Gerät vergessen" remove all of it (wipeDocs).
//
// Flat files, not a folder: the phone keeps STATE_DIR's files in memory and
// loads them at start (mobile/shims/fs.ts), so DOC_LIMITS keeps a login's
// documents within what a phone can hold.
//
// A statement the bank hands over is kept by the server itself as it
// arrives (keepStatements): some banks hand each one out once. Should the
// store not open with this PIN, it is held for the session instead, so it is
// at least there to save before the logout — never dropped.
//
// No 'server-only' marker, like vault.ts. Never log a PIN, a document or a
// name — codes and counts only.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ElectronicStatement } from 'lib-fints';
import type { Session } from './session';
import { boxSalt, deriveKey, newSalt, openBox, parseBox, sealBox } from './crypto-box.ts';
import { DOC_LIMITS, safeDocName, sanitizeDoc, sniffMime, type AwaitedBooking, type DocMime, type KeptDoc } from './docs.ts';
import { msgs } from './i18n/index.ts';
import { removeFamily, removeRetrying, serialized, writeFileAtomic } from './sealed-file.ts';
import { STATE_DIR } from './state-store.ts';

const INDEX_AAD = Buffer.from('girovo/docs/index/v1', 'utf8');
const docAad = (id: string) => Buffer.from(`girovo/docs/doc/v1/${id}`, 'utf8');

/** A refusal the route turns into an HTTP status with a message for the user (msgs().docs.server). */
export class DocError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'DocError';
    this.status = status;
  }
}

type Identity = { blz: string; userId: string; pin: string };

function identityOf(s: Session): Identity {
  const cfg = s?.client?.config;
  const blz = s?.meta?.blz;
  if (!cfg?.pin || !cfg.userId || !blz) throw new DocError(msgs().docs.server.unavailable, 409);
  return { blz: String(blz), userId: String(cfg.userId), pin: String(cfg.pin) };
}

/** A login's document files' common name, without directory. */
export function docsBaseName(blz: string, userId: string): string {
  return `${crypto.createHash('sha256').update(`${blz}|${userId}|docs`).digest('hex').slice(0, 32)}.docs`;
}

const indexFile = (id: Pick<Identity, 'blz' | 'userId'>) => path.join(STATE_DIR, docsBaseName(id.blz, id.userId));
const docFile = (index: string, docId: string) => `${index}.${docId}`;

type Unlocked = { file: string; salt: Buffer; key: Buffer };
const unlocked = new WeakMap<Session, Unlocked>();

/** Documents this session could not keep (the store does not open with this PIN): held until the logout. */
const held = new WeakMap<Session, Map<string, { doc: KeptDoc; bytes: Buffer }>>();

type Opened =
  | { status: 'missing' }
  | { status: 'error' }
  | { status: 'ready'; docs: KeptDoc[]; entry: Unlocked };

async function openIndex(s: Session, id: Identity, file: string): Promise<Opened> {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return { status: 'missing' };
    console.warn('[docs] read failed:', (err as NodeJS.ErrnoException)?.code || 'unknown');
    throw new DocError(msgs().docs.server.read, 500);
  }
  let box;
  try {
    box = parseBox(JSON.parse(raw));
  } catch {
    box = null;
  }
  if (!box) return { status: 'error' };
  const salt = boxSalt(box);
  const cached = unlocked.get(s);
  const key = cached && cached.file === file && cached.salt.equals(salt) ? cached.key : await deriveKey(id.pin, salt);
  let parsed: unknown;
  try {
    parsed = JSON.parse(openBox(key, box, INDEX_AAD).toString('utf8'));
  } catch {
    return { status: 'error' }; // another PIN, or an altered file
  }
  const list = Array.isArray((parsed as { docs?: unknown })?.docs) ? (parsed as { docs: unknown[] }).docs : [];
  const docs = list.map(sanitizeDoc).filter((d): d is KeptDoc => !!d);
  return { status: 'ready', docs, entry: { file, salt, key } };
}

async function writeIndex(entry: Unlocked, docs: KeptDoc[]): Promise<void> {
  const plaintext = Buffer.from(JSON.stringify({ v: 1, docs }), 'utf8');
  try {
    await writeFileAtomic(entry.file, JSON.stringify(sealBox(entry.key, entry.salt, plaintext, INDEX_AAD)));
  } catch (err) {
    console.warn('[docs] write failed:', (err as NodeJS.ErrnoException)?.code || 'unknown');
    throw new DocError(msgs().docs.server.write, 500);
  }
}

/** The index, opened (or begun) under this session's key; a store this PIN cannot open refuses (409). */
async function ready(s: Session, id: Identity, file: string): Promise<{ docs: KeptDoc[]; entry: Unlocked }> {
  const opened = await openIndex(s, id, file);
  if (opened.status === 'error') {
    unlocked.delete(s);
    throw new DocError(msgs().docs.server.locked, 409);
  }
  if (opened.status === 'ready') {
    unlocked.set(s, opened.entry);
    return opened;
  }
  const salt = newSalt();
  const entry = { file, salt, key: await deriveKey(id.pin, salt) };
  unlocked.set(s, entry);
  return { docs: [], entry };
}

const heldOf = (s: Session) => {
  let m = held.get(s);
  if (!m) held.set(s, (m = new Map()));
  return m;
};

const newId = () => crypto.randomBytes(16).toString('hex');

// ---------------------------------------------------------------------------
// Operations (one per /api/docs op)
// ---------------------------------------------------------------------------

/**
 * Every document of the login, the session's held ones included. `locked`:
 * the store does not open with this PIN — what is listed is only what this
 * session holds.
 */
export async function listDocs(s: Session): Promise<{ docs: KeptDoc[]; locked: boolean }> {
  const id = identityOf(s);
  const file = indexFile(id);
  const extra = [...heldOf(s).values()].map((h) => h.doc);
  return serialized(file, async () => {
    const opened = await openIndex(s, id, file);
    if (opened.status === 'error') {
      unlocked.delete(s);
      return { docs: extra, locked: true };
    }
    if (opened.status === 'ready') unlocked.set(s, opened.entry);
    return { docs: [...(opened.status === 'ready' ? opened.docs : []), ...extra], locked: false };
  });
}

/** One document and its bytes. */
export async function readDoc(s: Session, docId: string): Promise<{ doc: KeptDoc; bytes: Buffer }> {
  const h = heldOf(s).get(docId);
  if (h) return h;
  const id = identityOf(s);
  const file = indexFile(id);
  return serialized(file, async () => {
    const { docs, entry } = await ready(s, id, file);
    const doc = docs.find((d) => d.id === docId);
    if (!doc) throw new DocError(msgs().docs.server.gone, 404);
    try {
      const box = parseBox(JSON.parse(await fs.promises.readFile(docFile(file, docId), 'utf8') as string));
      if (!box) throw new Error('format');
      return { doc, bytes: openBox(entry.key, box, docAad(docId)) };
    } catch (err) {
      console.warn('[docs] document unreadable:', (err as NodeJS.ErrnoException)?.code || 'format');
      throw new DocError(msgs().docs.server.gone, 404);
    }
  });
}

/** Keeps one document: refused when it is too large, or the login's documents would be. */
async function add(s: Session, meta: Omit<KeptDoc, 'id' | 'size' | 'addedAt'>, bytes: Buffer): Promise<KeptDoc> {
  if (bytes.length > DOC_LIMITS.bytes) throw new DocError(msgs().docs.server.tooLarge, 413);
  const id = identityOf(s);
  const file = indexFile(id);
  return serialized(file, async () => {
    const { docs, entry } = await ready(s, id, file);
    const total = docs.reduce((n, d) => n + d.size, 0);
    if (docs.length >= DOC_LIMITS.count || total + bytes.length > DOC_LIMITS.total) {
      throw new DocError(msgs().docs.server.full, 413);
    }
    const doc = sanitizeDoc({ ...meta, id: newId(), size: bytes.length, addedAt: new Date().toISOString() });
    if (!doc) throw new DocError(msgs().docs.server.format, 400);
    try {
      await writeFileAtomic(docFile(file, doc.id), JSON.stringify(sealBox(entry.key, entry.salt, bytes, docAad(doc.id))));
    } catch (err) {
      console.warn('[docs] write failed:', (err as NodeJS.ErrnoException)?.code || 'unknown');
      throw new DocError(msgs().docs.server.write, 500);
    }
    await writeIndex(entry, [...docs, doc]);
    return doc;
  });
}

/**
 * A receipt the user attaches: to a booking (`tx`), or to an order not
 * booked yet (`awaiting`). The bytes decide what it is, not the name.
 */
export async function addReceipt(s: Session, input: {
  name: string; data: Buffer; accountNumber: string | null; tx: string | null; awaiting: AwaitedBooking | null;
}): Promise<KeptDoc> {
  const mime = sniffMime(input.data);
  if (!mime) throw new DocError(msgs().docs.server.notADocument, 415);
  return add(s, {
    kind: 'receipt', mime, name: input.name, accountNumber: input.accountNumber,
    tx: input.tx, awaiting: input.tx ? null : input.awaiting,
  }, input.data);
}

/** Attaches a waiting receipt to its booking, or moves one to another booking. */
export async function linkReceipt(s: Session, docId: string, tx: string, accountNumber: string | null): Promise<KeptDoc> {
  const id = identityOf(s);
  const file = indexFile(id);
  return serialized(file, async () => {
    const { docs, entry } = await ready(s, id, file);
    const at = docs.findIndex((d) => d.id === docId && d.kind === 'receipt');
    if (at < 0) throw new DocError(msgs().docs.server.gone, 404);
    const doc = sanitizeDoc({ ...docs[at], tx, awaiting: null, accountNumber: accountNumber ?? docs[at].accountNumber });
    if (!doc) throw new DocError(msgs().docs.server.format, 400);
    const next = docs.slice();
    next[at] = doc;
    await writeIndex(entry, next);
    return doc;
  });
}

/** Removes one document, its file with it. */
export async function removeDoc(s: Session, docId: string): Promise<void> {
  if (heldOf(s).delete(docId)) return;
  const id = identityOf(s);
  const file = indexFile(id);
  return serialized(file, async () => {
    const { docs, entry } = await ready(s, id, file);
    if (!docs.some((d) => d.id === docId)) return;
    await writeIndex(entry, docs.filter((d) => d.id !== docId));
    try {
      await removeRetrying(docFile(file, docId));
    } catch (err) {
      // The index no longer names it; the file goes with the next wipe.
      console.warn('[docs] could not delete a document file:', (err as NodeJS.ErrnoException)?.code || 'unknown');
    }
  });
}

/**
 * Removes every document of the login from this machine, and the index: one
 * file family (removeFamily). Needs no PIN — an unreadable store is the one
 * most worth removing. Returns how many files went.
 */
export async function wipeDocs(s: Session): Promise<number> {
  const blz = s?.meta?.blz;
  const userId = s?.client?.config?.userId;
  if (!blz || !userId) throw new DocError(msgs().docs.server.unavailable, 409);
  const stem = docsBaseName(String(blz), String(userId));
  const file = path.join(STATE_DIR, stem);
  return serialized(file, async () => {
    unlocked.delete(s);
    held.delete(s);
    const { removed, failed } = await removeFamily(STATE_DIR, stem, (code) => {
      console.warn('[docs] wipe: could not delete a file:', code);
    });
    if (failed) throw new DocError(msgs().docs.server.write, 500);
    return removed;
  });
}

// ---------------------------------------------------------------------------
// The bank's statements
// ---------------------------------------------------------------------------

const isoDay = (d: Date | undefined) => (d instanceof Date && !Number.isNaN(d.getTime())
  ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  : null);

/** The statement's file type: by its bytes, else by the format the bank named (1 MT940, 3 PDF). */
function statementMime(st: ElectronicStatement, bytes: Buffer): DocMime {
  return sniffMime(bytes) ?? (st.format === '1' ? 'text/plain' : 'application/pdf');
}

/**
 * Keeps what the bank handed out for `accountNumber`, each statement once: one
 * the index already has (same account, year and number — or, unnumbered, the
 * same days and size) is not kept again. Answers what was new. Held for the
 * session instead where the store cannot take it.
 */
export async function keepStatements(s: Session, accountNumber: string, statements: ElectronicStatement[]): Promise<{ added: KeptDoc[]; held: boolean }> {
  const added: KeptDoc[] = [];
  let heldAny = false;
  let known: KeptDoc[];
  try {
    known = (await listDocs(s)).docs;
  } catch {
    known = [];
  }
  for (const st of statements) {
    const bytes = Buffer.from(st.document ?? new Uint8Array());
    if (!bytes.length) continue;
    const mime = statementMime(st, bytes);
    const meta = {
      kind: 'statement' as const,
      mime,
      accountNumber,
      number: Number.isInteger(st.number) ? st.number! : null,
      year: Number.isInteger(st.year) ? st.year! : null,
      from: isoDay(st.from),
      to: isoDay(st.to),
      date: isoDay(st.date),
    };
    const same = known.some((d) => d.kind === 'statement' && d.accountNumber === accountNumber && (
      meta.number != null && meta.year != null
        ? d.number === meta.number && d.year === meta.year
        : d.from === meta.from && d.to === meta.to && d.date === meta.date && d.size === bytes.length
    ));
    if (same) continue;
    const word = msgs().docs.fileName.statement;
    const name = safeDocName(
      meta.number != null && meta.year != null ? `${word} ${meta.year}-${String(meta.number).padStart(3, '0')}` : `${word} ${meta.date ?? meta.to ?? ''}`,
      mime, word,
    );
    let doc: KeptDoc;
    try {
      doc = await add(s, { ...meta, name }, bytes);
    } catch (err) {
      if (!(err instanceof DocError)) throw err;
      // Not lost: held for this session, to be saved before the logout.
      const kept = sanitizeDoc({ ...meta, name, id: newId(), size: bytes.length, addedAt: new Date().toISOString() });
      if (!kept) continue;
      heldOf(s).set(kept.id, { doc: kept, bytes });
      doc = kept;
      heldAny = true;
    }
    known.push(doc);
    added.push(doc);
  }
  return { added, held: heldAny };
}
