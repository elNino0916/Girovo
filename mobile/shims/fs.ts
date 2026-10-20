// `node:fs` for the phone server (mobile/server) — the part of it the route
// handlers actually use, over a file tree held in memory.
//
// The server code reads and writes synchronously (lib/state-store.ts,
// lib/vault.ts) and the WebView has no synchronous file API, so the tree lives
// in memory and every change is written through to the app's private storage
// in the background, in order. At start, mountData() loads what is there, so
// the first request already sees every remembered device, vault and history.
//
// The virtual layout (process.cwd() is /app — mobile/shims/process.ts):
//
//   /app/…                 what the desktop build ships beside the server:
//                          banks-data.json, config.json, public/logos/*
//                          (read-only, put in by mountAssets)
//   /data/fints-state/…    FINTS_STATE_DIR — device profiles, vaults, history;
//                          persisted to Directory.Data/fints-state
//
// Every file the server writes is UTF-8 text (JSON envelopes of base64), so the
// tree holds strings and the disk copy is written as UTF-8.
//
// A write on disk is "<file>.part" first, then the old file is deleted and the
// part renamed over it; mountData() finishes a rename a killed app left half
// done and drops a part whose write never finished. So a file on disk is
// always one whole version, old or new — the same promise sealed-file.ts makes
// on the desktop.

import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Buffer } from 'buffer';

type Entry = { text: string; size: number; mtimeMs: number };

const files = new Map<string, Entry>();
const dirs = new Set<string>(['/']);
/** Paths whose content is only listed (the category model's weights live natively). */
const stubs = new Map<string, number>();

const DATA_ROOT = '/data/';
const encoder = new TextEncoder();

function norm(p: unknown): string {
  const raw = String(p ?? '').replace(/\\/g, '/');
  const out: string[] = [];
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return `/${out.join('/')}`;
}

const parentOf = (p: string) => (p.lastIndexOf('/') <= 0 ? '/' : p.slice(0, p.lastIndexOf('/')));

function addDirs(p: string): void {
  for (let d = p; d !== '/' && !dirs.has(d); d = parentOf(d)) dirs.add(d);
}

function fsError(code: string, syscall: string, p: string): NodeJS.ErrnoException {
  const err = new Error(`${code}: ${syscall} '${p}'`) as NodeJS.ErrnoException;
  err.code = code;
  err.syscall = syscall;
  err.path = p;
  return err;
}

// ---------------------------------------------------------------------------
// Persistence: one queue, in order, for everything under /data.

let queue: Promise<void> = Promise.resolve();
let failures = 0;

const diskPath = (p: string) => p.slice(DATA_ROOT.length);
const persisted = (p: string) => p.startsWith(DATA_ROOT);

function enqueue(task: () => Promise<void>): void {
  queue = queue.then(task).catch((err) => {
    failures++;
    console.error('[fs] write-through failed', err);
  });
}

async function quietly(task: Promise<unknown>): Promise<void> {
  try {
    await task;
  } catch {
    /* already gone */
  }
}

function persistWrite(p: string, text: string): void {
  if (!persisted(p)) return;
  const target = diskPath(p);
  enqueue(async () => {
    await Filesystem.writeFile({ path: `${target}.part`, data: text, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true });
    await quietly(Filesystem.deleteFile({ path: target, directory: Directory.Data }));
    await Filesystem.rename({ from: `${target}.part`, to: target, directory: Directory.Data, toDirectory: Directory.Data });
  });
}

function persistRemove(p: string): void {
  if (!persisted(p)) return;
  const target = diskPath(p);
  enqueue(() => quietly(Filesystem.deleteFile({ path: target, directory: Directory.Data })));
}

/** Resolves once every change made so far is on disk (the app going to the background). */
export function flush(): Promise<{ failures: number }> {
  return queue.then(() => ({ failures }));
}

// ---------------------------------------------------------------------------
// Mounting

/** Bundled read-only files, by virtual path. */
export function mountAssets(entries: Record<string, string>, listings: Record<string, string[]> = {}): void {
  for (const [p, text] of Object.entries(entries)) put(norm(p), text, false);
  for (const [dir, names] of Object.entries(listings)) {
    addDirs(norm(dir));
    for (const name of names) {
      const p = norm(`${dir}/${name}`);
      if (!files.has(p)) stubs.set(p, 0);
      addDirs(parentOf(p));
    }
  }
}

/** Loads /data/<dir> from the app's private storage. Call once, before the first request. */
export async function mountData(dir: string): Promise<number> {
  const root = norm(`${DATA_ROOT}${dir}`);
  addDirs(root);
  let names: string[];
  try {
    const listed = await Filesystem.readdir({ path: diskPath(root), directory: Directory.Data });
    names = listed.files.filter((f) => f.type === 'file').map((f) => f.name);
  } catch {
    return 0; // nothing saved yet
  }
  const present = new Set(names);
  // A rename the app did not live to finish: the part is complete, the target gone.
  for (const name of names) {
    if (!name.endsWith('.part')) continue;
    const target = name.slice(0, -'.part'.length);
    const from = `${diskPath(root)}/${name}`;
    if (present.has(target)) {
      await quietly(Filesystem.deleteFile({ path: from, directory: Directory.Data }));
    } else {
      await Filesystem.rename({ from, to: `${diskPath(root)}/${target}`, directory: Directory.Data, toDirectory: Directory.Data });
      present.add(target);
    }
    present.delete(name);
  }
  let loaded = 0;
  for (const name of present) {
    const { data } = await Filesystem.readFile({ path: `${diskPath(root)}/${name}`, directory: Directory.Data, encoding: Encoding.UTF8 });
    put(`${root}/${name}`, typeof data === 'string' ? data : await data.text(), false);
    loaded++;
  }
  return loaded;
}

// ---------------------------------------------------------------------------
// The tree

function put(p: string, text: string, persist = true): void {
  if (dirs.has(p)) throw fsError('EISDIR', 'open', p);
  addDirs(parentOf(p));
  files.set(p, { text, size: encoder.encode(text).length, mtimeMs: Date.now() });
  stubs.delete(p);
  if (persist) persistWrite(p, text);
}

function asText(data: unknown, encoding?: unknown): string {
  if (typeof data === 'string') return data;
  if (data instanceof Uint8Array) return Buffer.from(data).toString(typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8');
  return String(data);
}

const encodingOf = (opts: unknown): string | undefined =>
  typeof opts === 'string' ? opts : (opts as { encoding?: string } | undefined)?.encoding ?? undefined;

function read(p: unknown, opts?: unknown): string | Buffer {
  const at = norm(p);
  const entry = files.get(at);
  if (!entry) {
    if (dirs.has(at)) throw fsError('EISDIR', 'read', at);
    throw fsError('ENOENT', 'open', at);
  }
  const enc = encodingOf(opts);
  return enc ? entry.text : Buffer.from(entry.text, 'utf8');
}

type Stats = { size: number; mtimeMs: number; mtime: Date; isFile(): boolean; isDirectory(): boolean };

function stat(p: unknown): Stats {
  const at = norm(p);
  const entry = files.get(at);
  const stub = stubs.get(at);
  const isDir = dirs.has(at);
  if (!entry && stub == null && !isDir) throw fsError('ENOENT', 'stat', at);
  const size = entry?.size ?? stub ?? 0;
  const mtimeMs = entry?.mtimeMs ?? 0;
  return { size, mtimeMs, mtime: new Date(mtimeMs), isFile: () => !isDir, isDirectory: () => isDir };
}

function exists(p: unknown): boolean {
  const at = norm(p);
  return files.has(at) || stubs.has(at) || dirs.has(at);
}

function readdir(p: unknown): string[] {
  const at = norm(p);
  if (!dirs.has(at)) {
    if (files.has(at)) throw fsError('ENOTDIR', 'scandir', at);
    throw fsError('ENOENT', 'scandir', at);
  }
  const prefix = at === '/' ? '/' : `${at}/`;
  const names = new Set<string>();
  for (const key of [...files.keys(), ...stubs.keys(), ...dirs]) {
    if (key === at || !key.startsWith(prefix)) continue;
    names.add(key.slice(prefix.length).split('/')[0]);
  }
  return [...names].sort();
}

function remove(p: unknown, opts?: { force?: boolean; recursive?: boolean }): void {
  const at = norm(p);
  if (files.delete(at) || stubs.delete(at)) {
    persistRemove(at);
    return;
  }
  if (dirs.has(at)) {
    if (!opts?.recursive) throw fsError('EISDIR', 'rm', at);
    for (const key of [...files.keys()]) if (key.startsWith(`${at}/`)) remove(key);
    for (const key of [...dirs]) if (key === at || key.startsWith(`${at}/`)) dirs.delete(key);
    return;
  }
  if (!opts?.force) throw fsError('ENOENT', 'rm', at);
}

function rename(from: unknown, to: unknown): void {
  const a = norm(from);
  const b = norm(to);
  const entry = files.get(a);
  if (!entry) throw fsError('ENOENT', 'rename', a);
  files.delete(a);
  if (persisted(a) && !a.endsWith('.tmp')) persistRemove(a);
  put(b, entry.text);
}

function mkdir(p: unknown): void {
  addDirs(norm(p));
}

/** What fs.promises.open answers: enough for sealed-file.ts's write-then-rename. */
class FileHandle {
  private text = '';
  private readonly at: string;
  constructor(at: string) {
    this.at = at;
  }
  async writeFile(data: unknown, encoding?: unknown): Promise<void> {
    this.text = asText(data, encodingOf(encoding));
  }
  async sync(): Promise<void> {
    /* the in-memory tree is current; the disk copy follows in order */
  }
  async close(): Promise<void> {
    // A temp file only ever exists in memory: it is renamed into place (and
    // persisted under its real name) or removed.
    const p = this.at;
    addDirs(parentOf(p));
    files.set(p, { text: this.text, size: encoder.encode(this.text).length, mtimeMs: Date.now() });
  }
}

const promises = {
  async stat(p: unknown) {
    return stat(p);
  },
  async readFile(p: unknown, opts?: unknown) {
    return read(p, opts);
  },
  async writeFile(p: unknown, data: unknown, opts?: unknown) {
    put(norm(p), asText(data, encodingOf(opts)));
  },
  async mkdir(p: unknown) {
    mkdir(p);
  },
  async readdir(p: unknown) {
    return readdir(p);
  },
  async rm(p: unknown, opts?: { force?: boolean; recursive?: boolean }) {
    remove(p, opts);
  },
  async rename(from: unknown, to: unknown) {
    rename(from, to);
  },
  async open(p: unknown, flags?: string) {
    const at = norm(p);
    if (flags?.includes('x') && exists(at)) throw fsError('EEXIST', 'open', at);
    return new FileHandle(at);
  },
};

const fs = {
  readFileSync: read,
  writeFileSync: (p: unknown, data: unknown, opts?: unknown) => put(norm(p), asText(data, encodingOf(opts))),
  existsSync: exists,
  statSync: stat,
  readdirSync: readdir,
  rmSync: remove,
  unlinkSync: (p: unknown) => remove(p),
  renameSync: rename,
  mkdirSync: mkdir,
  promises,
};

export default fs;
export const { readFileSync, writeFileSync, existsSync, statSync, readdirSync, rmSync, unlinkSync, renameSync, mkdirSync } = fs;
export { promises };
