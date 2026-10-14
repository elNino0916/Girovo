// File plumbing for the PIN-sealed stores in STATE_DIR: the personal-data
// vault (lib/vault.ts) and the saved Umsätze (lib/history-store.ts).
//
// Both hold something the user cannot get back from anywhere else — what they
// typed in, bookings older than their bank still serves — so both write the
// same careful way: one operation per file at a time, a new version written
// beside the old one and renamed over it (a crash leaves either, never half of
// one), brief Windows file locks ridden out, and an old file set aside rather
// than overwritten. The cipher is lib/crypto-box.ts'; this is only the disk.
//
// No 'server-only' marker, for the same reason as vault.ts: `node --test`
// runs the real file round trips (lib/vault.test.ts, lib/history.test.ts).
// Errors carry a code at most; nothing here ever logs what a file holds.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// One operation per file at a time. The client debounces its saves, but a save
// can still overlap a reset, a wipe, or a second window of the same login.
const queues = new Map<string, Promise<unknown>>();

/** Runs `task` once every operation queued before it on `file` has settled. */
export function serialized<T>(file: string, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(file) ?? Promise.resolve()).then(task);
  const tail = run.then(() => undefined, () => undefined);
  queues.set(file, tail);
  void tail.then(() => {
    if (queues.get(file) === tail) queues.delete(file);
  });
  return run;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Codes of the brief locks a virus scanner, search indexer or backup tool holds on Windows. */
const LOCKED = new Set(['EPERM', 'EACCES', 'EBUSY']);

// Windows refuses a rename onto a file another process briefly holds open.
// Those locks clear within milliseconds, so a few short retries beat failing
// the user's save.
export async function renameRetrying(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (attempt >= 5 || !LOCKED.has(code ?? '')) throw err;
      await sleep(15 * 2 ** attempt);
    }
  }
}

/** Delete `file` (a missing one counts as deleted), riding out the same brief Windows locks. */
export async function removeRetrying(file: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.rmSync(file, { force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (attempt >= 5 || !LOCKED.has(code ?? '')) throw err;
      await sleep(15 * 2 ** attempt);
    }
  }
}

/**
 * Replace `file` so that a crash leaves either the old or the new content,
 * never half of one. Asynchronous throughout: the saved Umsätze run to
 * megabytes, and the server goes on answering while they are written.
 */
export async function writeFileAtomic(file: string, contents: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    const handle = await fs.promises.open(tmp, 'wx', 0o600);
    try {
      await handle.writeFile(contents, 'utf8');
      await handle.sync(); // the rename must not reach the disk before the data does
    } finally {
      await handle.close();
    }
    await renameRetrying(tmp, file);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch { /* best effort */ }
    throw err;
  }
}

/** Move an existing file out of the way, never over an earlier backup. False when there was none. */
export async function moveAside(file: string): Promise<boolean> {
  if (!fs.existsSync(file)) return false;
  const bak = fs.existsSync(`${file}.bak`) ? `${file}.${Date.now()}.bak` : `${file}.bak`;
  await renameRetrying(file, bak);
  return true;
}

/**
 * Delete `<stem>` in `dir` together with everything named `<stem>.…` — the
 * backups a reset set aside (`.bak`, `.<time>.bak`) and any temp file a
 * crashed write left behind — and nothing else. Each of them opens with a
 * PIN, so each is a file someone with this machine could try PINs against
 * offline. Answers how many were removed and how many could not be; a missing
 * directory removed nothing. Throws only when the directory cannot be listed.
 */
export async function removeFamily(dir: string, stem: string, onError: (code: string) => void): Promise<{ removed: number; failed: number }> {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return { removed: 0, failed: 0 };
    throw err;
  }
  let removed = 0;
  let failed = 0;
  for (const name of names) {
    if (name !== stem && !name.startsWith(`${stem}.`)) continue;
    try {
      await removeRetrying(path.join(dir, name));
      removed++;
    } catch (err) {
      failed++;
      onError((err as NodeJS.ErrnoException)?.code || 'unknown');
    }
  }
  return { removed, failed };
}
