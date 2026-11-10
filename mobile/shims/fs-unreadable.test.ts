// A saved file the start could not read (a scanner held it): left alone, and
// no write goes over it — but it is listed, as it is on the disk, and a delete
// the server asks for reaches the disk, where the desktop shell takes the file
// away now or at its next start (src-tauri/src/files.rs). And the desktop's
// save asks for no delete at all: its rename replaces the file.
//
// In a file of its own: the shim gets a disk of the test's instead of
// @capacitor/filesystem, and lib/sealed-file.ts gets the shim as its node:fs,
// as the app's bundle gives it — both in place before anything is loaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';

type Resolved = { url: string; shortCircuit?: boolean };
type Context = { parentURL?: string };
type Hooks = { resolve(specifier: string, context: Context, next: (specifier: string, context: Context) => Resolved): Resolved };
const { registerHooks } = nodeModule as unknown as { registerHooks?: (hooks: Hooks) => void };

/** The disk: what is saved, by path under the app's storage. */
const disk = new Map<string, string>([
  ['fints-state/profile.json', '{"device":1}'],
  ['fints-state/abc.skey', 'sealed PIN'],
  ['fints-state/abc.hello', 'sealed PIN'],
  ['fints-state/abc.hello.bak', 'sealed PIN'],
  ['fints-state/abc.linked', 'sealed PIN'],
]);
/** Held by another program: neither read nor deleted. */
const held = new Set<string>(['fints-state/abc.skey', 'fints-state/abc.hello', 'fints-state/abc.hello.bak', 'fints-state/abc.linked']);
/** What the shim asked the disk to do, in order. */
const calls: string[] = [];
const deletes = () => calls.filter((c) => c.startsWith('delete ')).map((c) => c.slice('delete '.length));

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
    calls.push(`write ${path}`);
    disk.set(path, data);
  },
  async deleteFile({ path }: { path: string }) {
    calls.push(`delete ${path}`);
    if (held.has(path)) throw new Error('EACCES');
    if (!disk.delete(path)) throw new Error('ENOENT');
  },
  async rename({ from, to }: { from: string; to: string }) {
    calls.push(`rename ${from} ${to}`);
    const data = disk.get(from);
    if (data == null) throw new Error('ENOENT');
    if (held.has(to)) throw new Error('EACCES');
    // As the desktop shell's: the file in the target's place is replaced.
    disk.delete(from);
    disk.set(to, data);
  },
};

const stand_in = [
  "export const Directory = { Data: 'DATA' };",
  "export const Encoding = { UTF8: 'utf8' };",
  'export const Filesystem = globalThis.__girovoTestDisk;',
].join('\n');
const SHIM = new URL('./fs.ts', import.meta.url).href;

registerHooks?.({
  resolve(specifier, context, next) {
    if (specifier === '@capacitor/filesystem') return { url: `data:text/javascript,${encodeURIComponent(stand_in)}`, shortCircuit: true };
    // The bundle's alias, for the one library module the tests go through.
    if (specifier === 'node:fs' && String(context.parentURL).endsWith('/lib/sealed-file.ts')) return { url: SHIM, shortCircuit: true };
    return next(specifier, context);
  },
});

// Without the hook (a Node before 22.15) the shim would talk to the real plugin: nothing to test with.
const skip = registerHooks ? false : 'needs module.registerHooks';
const shim = registerHooks ? await import(SHIM) : null;
const { process: shimProcess } = await import('./process.ts');
const { removeFamily } = registerHooks
  ? ((await import(new URL('../../lib/sealed-file.ts', import.meta.url).href)) as typeof import('../../lib/sealed-file.ts'))
  : { removeFamily: null };

const DIR = '/data/fints-state';
const SKEY = `${DIR}/abc.skey`;
const HELLO = `${DIR}/abc.hello`;
const LINKED = `${DIR}/abc.linked`;

test('a file the start could not read is left as it is, takes no write, and is listed', { skip }, async () => {
  const fs = shim!;
  assert.equal(await fs.mountData('fints-state'), 1);
  assert.deepEqual(fs.unreadableFiles().sort(), [HELLO, `${HELLO}.bak`, LINKED, SKEY]);
  assert.equal(fs.existsSync(SKEY), false);
  assert.throws(() => fs.readFileSync(SKEY, 'utf8'), { code: 'ENOENT' });
  assert.throws(() => fs.writeFileSync(SKEY, 'new'), { code: 'EROFS' });
  // On the disk, so in the folder's list.
  assert.deepEqual(fs.readdirSync(DIR), ['abc.hello', 'abc.hello.bak', 'abc.linked', 'abc.skey', 'profile.json']);
  await fs.flush();
  // Nothing deleted unasked: it comes back at the next start as it was.
  assert.deepEqual(deletes(), []);
  assert.equal(disk.get('fints-state/abc.skey'), 'sealed PIN');
});

test('a delete asked for such a file reaches the disk, and the path takes writes again', { skip }, async () => {
  const fs = shim!;
  // Let go meanwhile: gone at once.
  held.delete('fints-state/abc.skey');
  fs.rmSync(SKEY, { force: true });
  assert.equal((await fs.flush()).failures, 0);
  assert.deepEqual(deletes(), ['fints-state/abc.skey']);
  assert.equal(disk.has('fints-state/abc.skey'), false);
  assert.equal(fs.unreadableFiles().includes(SKEY), false);
  assert.equal(fs.readdirSync(DIR).includes('abc.skey'), false);
  // Asked once: a second delete has nothing to pass on (and, without force, says so).
  fs.rmSync(SKEY, { force: true });
  assert.throws(() => fs.unlinkSync(SKEY), { code: 'ENOENT' });
  await fs.flush();
  assert.deepEqual(deletes(), ['fints-state/abc.skey']);
  // Set up afresh.
  fs.writeFileSync(SKEY, 'new PIN');
  assert.equal((await fs.flush()).failures, 0);
  assert.equal(disk.get('fints-state/abc.skey'), 'new PIN');
});

test('"Gerät vergessen" deletes by listing (removeFamily), and reaches the unread files too', { skip }, async () => {
  const fs = shim!;
  calls.length = 0;
  held.delete('fints-state/abc.hello.bak');
  const codes: string[] = [];
  const result = await removeFamily!(DIR, 'abc.hello', (code) => codes.push(code));
  // Both passed on; neither throws here — the disk's refusal is the shell's to note for its next start.
  assert.deepEqual(result, { removed: 2, failed: 0 });
  assert.deepEqual(codes, []);
  await fs.flush();
  assert.deepEqual(deletes(), ['fints-state/abc.hello', 'fints-state/abc.hello.bak']);
  assert.equal(disk.has('fints-state/abc.hello.bak'), false);
  assert.equal(disk.get('fints-state/abc.hello'), 'sealed PIN', 'still held: not this side\'s to force');
});

test('a passed-on delete the disk refused leaves the file unread, so no write goes over it', { skip }, async () => {
  const fs = shim!;
  // Still there, still never read: as before the delete.
  assert.equal(fs.unreadableFiles().includes(HELLO), true);
  assert.equal(fs.readdirSync(DIR).includes('abc.hello'), true);
  assert.throws(() => fs.writeFileSync(HELLO, 'new PIN'), { code: 'EROFS' });
  // Asked again once it is let go: gone, and the path takes writes.
  held.delete('fints-state/abc.hello');
  fs.unlinkSync(HELLO);
  assert.equal((await fs.flush()).failures, 0);
  assert.equal(disk.has('fints-state/abc.hello'), false);
  fs.writeFileSync(HELLO, 'new PIN');
  assert.equal((await fs.flush()).failures, 0);
  assert.equal(disk.get('fints-state/abc.hello'), 'new PIN');
});

test('a write right after the delete is not undone by the delete failing', { skip }, async () => {
  const fs = shim!;
  // The delete is queued, the new file written before the disk answers.
  const before = (await fs.flush()).failures;
  fs.unlinkSync(LINKED);
  fs.writeFileSync(LINKED, 'new PIN');
  assert.equal(fs.readFileSync(LINKED, 'utf8'), 'new PIN');
  // The write cannot reach the held file either (one failure, as for any save), but the file is the server's own now.
  assert.equal((await fs.flush()).failures, before + 1);
  assert.equal(fs.unreadableFiles().includes(LINKED), false);
  held.delete('fints-state/abc.linked');
});

test('the desktop saves by renaming over the file and asks for no delete', { skip }, async () => {
  const fs = shim!;
  calls.length = 0;
  const before = (await fs.flush()).failures;
  shimProcess.env.GIROVO_DESKTOP = '1';
  try {
    fs.writeFileSync(`${DIR}/profile.json`, '{"device":2}');
    assert.equal((await fs.flush()).failures, before);
  } finally {
    delete shimProcess.env.GIROVO_DESKTOP;
  }
  assert.deepEqual(calls, ['write fints-state/profile.json.part', 'rename fints-state/profile.json.part fints-state/profile.json']);
  assert.equal(disk.get('fints-state/profile.json'), '{"device":2}');
  // The phone's save as it always was: the old file deleted first.
  calls.length = 0;
  fs.writeFileSync(`${DIR}/profile.json`, '{"device":3}');
  await fs.flush();
  assert.deepEqual(calls, [
    'write fints-state/profile.json.part',
    'delete fints-state/profile.json',
    'rename fints-state/profile.json.part fints-state/profile.json',
  ]);
});

test('deleting the folder passes the unread files on with the rest', { skip }, async () => {
  const fs = shim!;
  disk.set('fints-state/late.skey', 'sealed PIN');
  held.add('fints-state/late.skey');
  // As a start would have found it: unread.
  await fs.mountData('fints-state');
  assert.equal(fs.unreadableFiles().includes(`${DIR}/late.skey`), true);
  calls.length = 0;
  fs.rmSync(DIR, { recursive: true, force: true });
  await fs.flush();
  assert.deepEqual(deletes().sort(), ['fints-state/abc.hello', 'fints-state/abc.linked', 'fints-state/abc.skey', 'fints-state/late.skey', 'fints-state/profile.json']);
  assert.deepEqual([...disk.keys()], ['fints-state/late.skey'], 'only the one still held is left, for the shell');
});
