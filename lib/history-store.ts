// The Umsätze kept on this computer, on disk (the rules are in lib/history.ts).
//
// One sealed file per login, next to the vault in STATE_DIR and sealed the
// same way: AES-256-GCM under a key derived from the PIN (lib/crypto-box.ts),
// named by a hash so the directory says nothing about bank or user, written
// atomically and one operation at a time (lib/sealed-file.ts). Its own AAD,
// so neither the vault nor the device profile can be passed off as it.
//
// Who decides what is kept: the vault. "Umsätze auf diesem Rechner behalten"
// is a choice stored there (VaultData.keepBookings), and the server reads it
// itself whenever the bank answers a statement read — with the PIN it holds
// anyway. So the first statement of a login is kept although the browser has
// not even opened the vault yet, the browser never uploads a booking, and no
// request can ask for keeping the vault does not allow.
//
// How a statement gets in (noteDelivery): the routes hand over the bank's
// answer as they send it to the browser, and the merge runs after that answer
// is on its way — it reads, merges and writes megabytes, and must never delay
// or fail a statement. The session holds the latest answer per account until
// it is kept, so switching the choice on keeps what was just loaded too; a
// logout or the idle sweep drops what the session holds, like everything else
// it holds.
//
// Where it differs from the vault, and why:
//   - An unreadable file (another PIN: changed at the bank) is never
//     overwritten either — answers are simply not kept until the user starts
//     over (resetHistory sets the old file aside, as the vault's reset does).
//     Unlike the vault's, these bookings may be gone at the bank by now; the
//     old file is the only copy.
//   - Reads are asynchronous: the file runs to megabytes, and the server keeps
//     answering TAN polls while it is read.
//   - After a wipe this session keeps nothing, even for an answer that
//     arrives later, until the browser asks for the history again (which it
//     does only once the choice is on again).
//
// No 'server-only' marker, like vault.ts: `node --test` runs the real file
// round trip (lib/history.test.ts). Never log the PIN, the file's contents or
// a booking — not even on an error path. Codes and counts only.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { SerializedTransaction, StatementBlock } from './fints-types';
import type { SealedBox } from './crypto-box.ts';
import type { Session } from './session';
import { boxSalt, deriveKey, newSalt, openBox, parseBox, sealBox } from './crypto-box.ts';
import { isoDate } from './format.ts';
import {
  EMPTY_HISTORY, HISTORY_LIMITS, compactHistory, deliveredSpan, fillHistoryGaps, isDay, mergeIntoHistory, sanitizeBooking,
  sanitizeHistory, type DaySpan, type HistoryData, type HistoryGetResponse,
} from './history.ts';
import { msgs } from './i18n/index.ts';
import { moveAside, removeFamily, serialized, writeFileAtomic } from './sealed-file.ts';
import { STATE_DIR } from './state-store.ts';
import { loadVault } from './vault.ts';

// A sealed file is base64 of the plaintext (4/3) plus a small envelope.
const FILE_MAX_BYTES = Math.ceil((HISTORY_LIMITS.bytes * 4) / 3) + 4096;

// Binds the ciphertext to its purpose: no other box sealed under a key from
// the same PIN can be passed off as the kept Umsätze, nor these as a vault.
const AAD = Buffer.from('girovo/history/v1', 'utf8');

/** A refusal the route turns into an HTTP status with a message for the user (msgs().history.server). */
export class HistoryError extends Error {
  status: number;
  /** Set where a caller decides by it: 'notKept' — this login does not keep its Umsätze. */
  reason?: 'notKept';
  constructor(message: string, status: number, reason?: 'notKept') {
    super(message);
    this.name = 'HistoryError';
    this.status = status;
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// Files and keys
// ---------------------------------------------------------------------------

type Identity = { blz: string; userId: string; pin: string };

function identityOf(s: Session): Identity {
  const cfg = s?.client?.config;
  const blz = s?.meta?.blz;
  if (!cfg?.pin || !cfg.userId || !blz) throw new HistoryError(msgs().history.server.unavailable, 409);
  return { blz: String(blz), userId: String(cfg.userId), pin: String(cfg.pin) };
}

/** A login's history file name without directory or extension; its backups share it. */
export function historyBaseName(blz: string, userId: string): string {
  return crypto.createHash('sha256').update(`${blz}|${userId}|history`).digest('hex').slice(0, 32);
}

const historyFile = (id: Pick<Identity, 'blz' | 'userId'>) =>
  path.join(STATE_DIR, `${historyBaseName(id.blz, id.userId)}.history`);

/** A key that has opened (or created) the file at `file`. */
type Unlocked = { file: string; salt: Buffer; key: Buffer };

// Keyed by the session object, so key, held answers and the stop all go with
// the session: logout, the idle sweeper or a hot reload drop them unasked.
const unlocked = new WeakMap<Session, Unlocked>();

/** A statement answer the session has not kept yet. */
type Delivery = { asked: DaySpan; txs: SerializedTransaction[]; blocks: StatementBlock[] };

/** Per session, the latest answer per account that is not kept yet. */
const held = new WeakMap<Session, Map<string, Delivery>>();

/** Sessions that wiped their history: nothing is kept for them until they ask for it again. */
const stopped = new WeakSet<Session>();

const today = () => isoDate(new Date());

type Opened =
  | { status: 'missing' }
  | { status: 'error'; reason: 'decrypt' | 'corrupt' }
  | { status: 'ready'; data: HistoryData; entry: Unlocked };

async function openHistoryFile(s: Session, id: Identity, file: string): Promise<Opened> {
  let raw: string;
  try {
    const st = await fs.promises.stat(file);
    if (!st.isFile() || st.size > FILE_MAX_BYTES) return { status: 'error', reason: 'corrupt' };
    raw = await fs.promises.readFile(file, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return { status: 'missing' };
    console.warn('[history] read failed:', code || 'unknown');
    throw new HistoryError(msgs().history.server.read, 500);
  }
  let box: SealedBox | null;
  try {
    box = parseBox(JSON.parse(raw));
  } catch {
    box = null;
  }
  if (!box) return { status: 'error', reason: 'corrupt' };
  const salt = boxSalt(box);
  const cached = unlocked.get(s);
  const key = cached && cached.file === file && cached.salt.equals(salt) ? cached.key : await deriveKey(id.pin, salt);
  let plaintext: Buffer;
  try {
    plaintext = openBox(key, box, AAD);
  } catch {
    return { status: 'error', reason: 'decrypt' }; // another PIN, or the file was altered
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext.toString('utf8'));
  } catch {
    // Not rethrown: the parser's message would quote the decrypted text.
    return { status: 'error', reason: 'corrupt' };
  }
  const data = sanitizeHistory(parsed, today());
  return data ? { status: 'ready', data, entry: { file, salt, key } } : { status: 'error', reason: 'corrupt' };
}

async function freshKey(id: Identity, file: string): Promise<Unlocked> {
  const salt = newSalt();
  return { file, salt, key: await deriveKey(id.pin, salt) };
}

async function writeHistory(entry: Unlocked, data: HistoryData): Promise<HistoryData> {
  const stamped = { ...data, updatedAt: new Date().toISOString() };
  // capHistory has kept it under the ceiling already; this is the backstop.
  const plaintext = Buffer.from(JSON.stringify(compactHistory(stamped)), 'utf8');
  if (plaintext.length > HISTORY_LIMITS.bytes) throw new HistoryError(msgs().history.server.write, 413);
  try {
    await writeFileAtomic(entry.file, JSON.stringify(sealBox(entry.key, entry.salt, plaintext, AAD)));
  } catch (err) {
    console.warn('[history] write failed:', (err as NodeJS.ErrnoException)?.code || 'unknown');
    throw new HistoryError(msgs().history.server.write, 500);
  }
  return stamped;
}

/**
 * How a session is found by its id: lib/session.ts registers its store here
 * (it is server-only, this module runs under `node --test` too). Without
 * one, no session follows another.
 */
let findSession: (id: string) => Session | null = () => null;
export function findSessionsWith(lookup: (id: string) => Session | null): void {
  findSession = lookup;
}

/**
 * Whether this login keeps its Umsätze: the vault says so, and the session
 * has not wiped them since. For a further bank of the view the primary
 * login's vault says so (Session.keepChoiceFrom): the choice is the view's,
 * and the further login's own vault, if any, belongs to another one. A
 * primary session that has ended is no yes.
 */
async function keepWanted(s: Session): Promise<boolean> {
  if (stopped.has(s)) return false;
  const owner = s.keepChoiceFrom ? findSession(s.keepChoiceFrom) : s;
  if (!owner) return false;
  try {
    const vault = await loadVault(owner);
    return vault.status === 'ready' && vault.data?.keepBookings === true;
  } catch {
    return false; // no vault to read is no yes
  }
}

/** `data` with every answer the session holds folded in, oldest first; the held answers are let go. */
function foldHeld(s: Session, data: HistoryData): { data: HistoryData; count: number } {
  const waiting = held.get(s);
  if (!waiting?.size) return { data, count: 0 };
  let next = data;
  let count = 0;
  const day = today();
  for (const [account, d] of waiting) {
    const span = deliveredSpan({ asked: d.asked, txs: d.txs, blocks: d.blocks, today: day });
    if (!span) continue; // an answer that vouches for no day changes nothing
    next = mergeIntoHistory(next, account, { span, txs: d.txs, blocks: d.blocks }, day);
    count++;
  }
  held.delete(s);
  return { data: next, count };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * A statement answer, as a route sends it to the browser, offered for
 * keeping. Returns at once and never throws: the merge runs once the answer
 * is on its way, and a failure there is logged (with a code) and nothing
 * else. `asked` is what the bank was asked for, as local days (`to`: the last
 * day meant — today for an open end).
 */
export function noteDelivery(
  s: Session,
  account: string,
  asked: DaySpan,
  txs: readonly SerializedTransaction[],
  blocks: readonly StatementBlock[],
): void {
  if (!account || !isDay(asked?.from) || !isDay(asked?.to)) return;
  // Not a moment of the answer's own time: even the copy below waits until
  // the route has handed the answer over.
  setImmediate(() => {
    try {
      if (stopped.has(s)) return;
      // The wire form, exactly as the browser receives it: dates as ISO strings.
      const wire = JSON.parse(JSON.stringify({ txs, blocks })) as { txs: unknown[]; blocks: StatementBlock[] };
      const delivery: Delivery = {
        asked: { from: asked.from, to: asked.to },
        txs: wire.txs.map(sanitizeBooking).filter((t): t is SerializedTransaction => !!t),
        blocks: Array.isArray(wire.blocks) ? wire.blocks : [],
      };
      const waiting = held.get(s) ?? new Map<string, Delivery>();
      // A newer answer for the account supersedes an older one not kept yet.
      waiting.delete(account);
      waiting.set(account, delivery);
      held.set(s, waiting);
    } catch (err) {
      console.warn('[history] not noted:', (err as Error)?.name || 'unknown');
      return;
    }
    void keepHeld(s).catch((err) => {
      console.warn('[history] not kept:', (err as NodeJS.ErrnoException)?.code || (err as Error)?.name || 'unknown');
    });
  });
}

/** Folds what the session holds into the file — if this login keeps its Umsätze and the file opens. */
async function keepHeld(s: Session): Promise<void> {
  const id = identityOf(s);
  const file = historyFile(id);
  await serialized(file, async () => {
    if (!held.get(s)?.size || !(await keepWanted(s))) return;
    const opened = await openHistoryFile(s, id, file);
    if (opened.status === 'error') {
      // Never overwritten implicitly: the answers wait until the user starts over.
      unlocked.delete(s);
      console.warn(`[history] not kept: file unreadable (${opened.reason})`);
      return;
    }
    const entry = opened.status === 'ready' ? opened.entry : await freshKey(id, file);
    const { data, count } = foldHeld(s, opened.status === 'ready' ? opened.data : EMPTY_HISTORY);
    if (!count) return;
    await writeHistory(entry, data);
    unlocked.set(s, entry);
    console.log(`[history] kept ${count} statement answer(s) (blz=${id.blz})`);
  });
}

/**
 * The login's kept Umsätze, with what the session holds folded in first.
 * `data: null` means none are kept yet — a first use, not an error. A file
 * this PIN cannot open answers `error` and stays untouched.
 *
 * The browser asks only while the choice is on, so asking ends a stop a wipe
 * set: from here on, answers are kept again.
 */
export async function loadHistory(s: Session): Promise<HistoryGetResponse> {
  const id = identityOf(s);
  const file = historyFile(id);
  return serialized(file, async (): Promise<HistoryGetResponse> => {
    stopped.delete(s);
    const opened = await openHistoryFile(s, id, file);
    if (opened.status === 'error') {
      unlocked.delete(s);
      return { status: 'error', reason: opened.reason };
    }
    let data = opened.status === 'ready' ? opened.data : null;
    if (held.get(s)?.size && (await keepWanted(s))) {
      const entry = opened.status === 'ready' ? opened.entry : await freshKey(id, file);
      const folded = foldHeld(s, data ?? EMPTY_HISTORY);
      if (folded.count) {
        data = await writeHistory(entry, folded.data);
        console.log(`[history] kept ${folded.count} statement answer(s) (blz=${id.blz})`);
      }
      unlocked.set(s, entry);
    } else if (opened.status === 'ready') {
      unlocked.set(s, opened.entry);
    }
    return { status: 'ready', data: data ? compactHistory(data) : null };
  });
}

/**
 * Adds the days `other` covers and the kept file does not (lib/history.ts
 * fillGaps): a restored backup's Umsätze, or an export from the bank's online
 * banking the user imported. A day already kept is never touched. Only while
 * this login keeps its Umsätze — the vault's choice, as for every answer —
 * and only into a file this PIN opens (or none yet). Answers how many days
 * and bookings were added.
 */
export async function fillKeptGaps(s: Session, other: HistoryData): Promise<{ days: number; bookings: number }> {
  const id = identityOf(s);
  const file = historyFile(id);
  return serialized(file, async () => {
    if (!(await keepWanted(s))) throw new HistoryError(msgs().history.server.notKept, 409, 'notKept');
    const opened = await openHistoryFile(s, id, file);
    if (opened.status === 'error') {
      unlocked.delete(s);
      throw new HistoryError(msgs().history.server.locked, 409);
    }
    const entry = opened.status === 'ready' ? opened.entry : await freshKey(id, file);
    // What the session holds goes in first: the bank's answers outrank any copy.
    const folded = foldHeld(s, opened.status === 'ready' ? opened.data : EMPTY_HISTORY);
    const filled = fillHistoryGaps(folded.data, other, today());
    if (filled.days || folded.count) await writeHistory(entry, filled.data);
    unlocked.set(s, entry);
    console.log(`[history] filled ${filled.days} day(s) (blz=${id.blz})`);
    return { days: filled.days, bookings: filled.bookings };
  });
}

/**
 * Start over after the file stopped opening (another PIN): set it aside as
 * `.bak` — the bookings in it may be gone at the bank — and begin an empty
 * history under a fresh salt, with what the session holds folded in. The only
 * path that replaces a file this PIN cannot open.
 */
export async function resetHistory(s: Session): Promise<HistoryGetResponse> {
  const id = identityOf(s);
  const file = historyFile(id);
  return serialized(file, async (): Promise<HistoryGetResponse> => {
    unlocked.delete(s);
    stopped.delete(s);
    let moved: boolean;
    try {
      moved = await moveAside(file);
    } catch (err) {
      console.warn('[history] could not move the old file aside:', (err as NodeJS.ErrnoException)?.code || 'unknown');
      throw new HistoryError(msgs().history.server.write, 500);
    }
    const entry = await freshKey(id, file);
    const { data } = (await keepWanted(s)) ? foldHeld(s, EMPTY_HISTORY) : { data: EMPTY_HISTORY };
    const written = await writeHistory(entry, data);
    unlocked.set(s, entry);
    if (moved) console.log(`[history] reset; previous file kept as backup (blz=${id.blz})`);
    return { status: 'ready', data: compactHistory(written) };
  });
}

/**
 * Remove the login's kept Umsätze from the machine for good: the file, every
 * backup a reset set aside and any temp file a crashed write left behind —
 * each opens with a PIN and could be tried against PINs offline. Needs no PIN
 * (an unreadable file is the one most worth removing), and acts only for the
 * session's own login. What the session holds goes too, and nothing more is
 * kept for it until the browser asks for the history again. Returns how many
 * files were removed.
 */
export async function wipeHistory(s: Session): Promise<number> {
  const blz = s?.meta?.blz;
  const userId = s?.client?.config?.userId;
  if (!blz || !userId) throw new HistoryError(msgs().history.server.unavailable, 409);
  const stem = `${historyBaseName(String(blz), String(userId))}.history`;
  stopped.add(s);
  held.delete(s);
  return serialized(path.join(STATE_DIR, stem), async () => {
    // Again inside the queue: an answer noted while the wipe waited its turn goes as well.
    stopped.add(s);
    held.delete(s);
    unlocked.delete(s);
    let removed: number;
    let failed: number;
    try {
      ({ removed, failed } = await removeFamily(STATE_DIR, stem, (code) => {
        console.warn('[history] wipe: could not delete a file:', code);
      }));
    } catch (err) {
      console.warn('[history] wipe: cannot list the state directory:', (err as NodeJS.ErrnoException)?.code || 'unknown');
      throw new HistoryError(msgs().history.server.wipe, 500);
    }
    console.log(`[history] wiped ${removed} file(s)${failed ? `, ${failed} left` : ''} (blz=${blz})`);
    if (failed) throw new HistoryError(msgs().history.server.wipe, 500);
    return removed;
  });
}
