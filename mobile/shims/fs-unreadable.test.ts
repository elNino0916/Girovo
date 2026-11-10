// A saved file the start could not read (a scanner held it): left alone, and
// no write goes over it — but a delete the server asks for reaches the disk,
// where the desktop shell takes the file away now or at its next start
// (src-tauri/src/files.rs). In a file of its own: the shim gets a disk of the
// test's instead of @capacitor/filesystem, which has to be in place before
// the shim is loaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';

type Resolved = { url: string; shortCircuit?: boolean };
type Hooks = { resolve(specifier: string, context: unknown, next: (specifier: string, context: unknown) => Resolved): Resolved };
const { registerHooks } = nodeModule as unknown as { registerHooks?: (hooks: Hooks) => void };

/** The disk: what is saved, by path under the app's storage. */
const disk = new Map<string, string>([
  ['fints-state/profile.json', '{"device":1}'],
  ['fints-state/abc.skey', 'sealed PIN'],
  ['fints-state/abc.hello', 'sealed PIN'],
  ['fints-state/abc.linked', 'sealed PIN'],
]);
/** Held by another program: neither read nor deleted. */
const held = new Set<string>(['fints-state/abc.skey', 'fints-state/abc.hello', 'fints-state/abc.linked']);
/** What the shim asked the disk to delete. */
const deletes: string[] = [];

(globalThis as { __girovoTestDisk?: unknown }).__girovoTestDisk = {
  async readdir({ path }: { path: string }) {
    const names = [...disk.keys()].filter((p) => p.startsWith(`${path}/`)).map((p) => p.slice(path.length + 1));
    return { files: names.map((name) => ({ name, type: 'file' })) };
  },
  async readFile({ path }: { path: string }) {
    if (held.has(path)) throw new Error('EACCES');
    const data = disk.get(path);
    if (data == null) throw new Error('ENOENT');
    return { data };
  },
  async writeFile({ path, data }: { path: string; data: string }) {
    disk.set(path, data);
  },
  async deleteFile({ path }: { path: string }) {
    deletes.push(path);
    if (held.has(path)) throw new Error('EACCES');
    if (!disk.delete(path)) throw new Error('ENOENT');
  },
  async rename({ from, to }: { from: string; to: string }) {
    const data = disk.get(from);
    if (data == null) throw new Error('ENOENT');
    if (held.has(to)) throw new Error('EACCES');
    disk.delete(from);
    disk.set(to, data);
  },
};

const stand_in = [
  "export const Directory = { Data: 'DATA' };",
  "export const Encoding = { UTF8: 'utf8' };",
  'export const Filesystem = globalThis.__girovoTestDisk;',
].join('\n');

registerHooks?.({
  resolve(specifier, context, next) {
    if (specifier === '@capacitor/filesystem') return { url: `data:text/javascript,${encodeURIComponent(stand_in)}`, shortCircuit: true };
    return next(specifier, context);
  },
});

// Without the hook (a Node before 22.15) the shim would talk to the real plugin: nothing to test with.
const skip = registerHooks ? false : 'needs module.registerHooks';
const shim = registerHooks ? await import('./fs.ts') : null;

const SKEY = '/data/fints-state/abc.skey';
const HELLO = '/data/fints-state/abc.hello';
const LINKED = '/data/fints-state/abc.linked';

test('a file the start could not read is left as it is, and takes no write', { skip }, async () => {
  const fs = shim!;
  assert.equal(await fs.mountData('fints-state'), 1);
  assert.deepEqual(fs.unreadableFiles().sort(), [HELLO, LINKED, SKEY]);
  assert.equal(fs.existsSync(SKEY), false);
  assert.throws(() => fs.writeFileSync(SKEY, 'new'), { code: 'EROFS' });
  await fs.flush();
  // Nothing deleted unasked: it comes back at the next start as it was.
  assert.deepEqual(deletes, []);
  assert.equal(disk.get('fints-state/abc.skey'), 'sealed PIN');
});

test('a delete asked for such a file reaches the disk', { skip }, async () => {
  const fs = shim!;
  // Let go meanwhile: gone at once.
  held.delete('fints-state/abc.skey');
  fs.rmSync(SKEY, { force: true });
  assert.deepEqual((await fs.flush()).failures, 0);
  assert.deepEqual(deletes, ['fints-state/abc.skey']);
  assert.equal(disk.has('fints-state/abc.skey'), false);
  assert.deepEqual(fs.unreadableFiles().sort(), [HELLO, LINKED]);
  // Asked once: a second delete has nothing to pass on (and, without force, says so).
  fs.rmSync(SKEY, { force: true });
  assert.throws(() => fs.unlinkSync(SKEY), { code: 'ENOENT' });
  await fs.flush();
  assert.deepEqual(deletes, ['fints-state/abc.skey']);
});

test('a delete of a file still held is passed on all the same, and nothing throws', { skip }, async () => {
  const fs = shim!;
  // The disk refuses (the desktop shell notes it for its next start); the server's delete went through.
  fs.unlinkSync(HELLO);
  assert.deepEqual((await fs.flush()).failures, 0);
  assert.deepEqual(deletes, ['fints-state/abc.skey', 'fints-state/abc.hello']);
  assert.equal(disk.get('fints-state/abc.hello'), 'sealed PIN', 'still there: not this side\'s to force');
  assert.deepEqual(fs.unreadableFiles(), [LINKED]);
});

test('after the delete the path takes writes again', { skip }, async () => {
  const fs = shim!;
  // Windows Hello set up afresh, the old file let go by now.
  held.delete('fints-state/abc.hello');
  fs.writeFileSync(HELLO, 'new PIN');
  assert.equal(fs.readFileSync(HELLO, 'utf8'), 'new PIN');
  assert.deepEqual((await fs.flush()).failures, 0);
  assert.equal(disk.get('fints-state/abc.hello'), 'new PIN');
  assert.equal(disk.has('fints-state/abc.hello.part'), false);
});

test('deleting the folder passes the unread files on with the rest', { skip }, async () => {
  const fs = shim!;
  deletes.length = 0;
  fs.rmSync('/data/fints-state', { recursive: true, force: true });
  await fs.flush();
  assert.deepEqual([...deletes].sort(), ['fints-state/abc.hello', 'fints-state/abc.linked', 'fints-state/profile.json']);
  assert.deepEqual(fs.unreadableFiles(), []);
  assert.deepEqual([...disk.keys()], ['fints-state/abc.linked'], 'only the one still held is left, for the shell');
});
