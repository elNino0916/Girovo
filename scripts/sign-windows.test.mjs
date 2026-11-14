import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collect, findSigntool, inBuildPlace, isArtifact, isPortableExecutable, THUMBPRINT, timestampOf, verify } from './sign-windows.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sign-windows.mjs');

test('only Girovo’s own release files count as artifacts', () => {
  for (const name of ['Girovo-7.0.0-Setup.exe', 'Girovo-7.0.0-next.202611141200.gabc1234-Setup.exe', 'Girovo.exe', 'girovo-update.exe', 'girovo-cert.exe', 'Girovo-7.0.0.msi']) {
    assert.ok(isArtifact(name), name);
  }
  for (const name of ['notepad.exe', 'Setup.exe', 'Girovo-7.0.0-Setup.exe.blockmap', 'girovo-update.key', 'MT-Media-CodeSigning.pfx', 'evil-Girovo.exe', 'girovo-other.exe']) {
    assert.ok(!isArtifact(name), name);
  }
});

test('Tauri’s files are signed only from the checkout, the temp folder and Tauri’s NSIS folder', () => {
  const places = { root: 'C:\\repo', temp: 'C:\\Users\\me\\AppData\\Local\\Temp', localAppData: 'C:\\Users\\me\\AppData\\Local' };
  assert.ok(inBuildPlace('C:\\repo\\src-tauri\\target\\release\\Girovo.exe', places));
  assert.ok(inBuildPlace('C:\\Users\\me\\AppData\\Local\\Temp\\nst1.tmp', places));
  assert.ok(inBuildPlace('C:\\Users\\me\\AppData\\Local\\tauri\\NSIS\\Plugins\\x.dll', places));
  assert.ok(!inBuildPlace('C:\\Windows\\notepad.exe', places));
  assert.ok(!inBuildPlace('C:\\repo-other\\Girovo.exe', places), 'a sibling folder with the same prefix is outside');
  assert.ok(!inBuildPlace('C:\\Users\\me\\AppData\\Local\\Programs\\Girovo\\Girovo.exe', places), 'the installed app is not a build place');
});

test('the timestamp line of signtool verify', () => {
  assert.equal(timestampOf('Signing Certificate Chain:\r\nThe signature is timestamped: Sat Nov 14 11:49:41 2026\r\nTimestamp Verified by:'), 'Sat Nov 14 11:49:41 2026');
  assert.equal(timestampOf('File is not timestamped.\r\n'), null);
  assert.equal(timestampOf(''), null);
});

test('folders give their release files only; a stray file named directly is refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'girovo-sign-test-'));
  try {
    for (const f of ['Girovo-7.0.0-Setup.exe', 'other.exe', 'girovo-update-stable.key']) fs.writeFileSync(path.join(dir, f), 'MZ');
    assert.deepEqual(collect([dir]).map((f) => path.basename(f)), ['Girovo-7.0.0-Setup.exe']);
    assert.throws(() => collect([path.join(dir, 'other.exe')]), /not one of Girovo's release files/);
    assert.throws(() => collect([path.join(dir, 'missing')]), /no such path/);
    assert.ok(isPortableExecutable(path.join(dir, 'other.exe')));
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello');
    assert.ok(!isPortableExecutable(path.join(dir, 'notes.txt')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the script refuses to sign outside the build places', () => {
  const r = spawnSync(process.execPath, [SCRIPT, path.join(os.homedir(), 'Desktop', 'not-girovo.exe')], { encoding: 'utf8' });
  // The home folder holds the checkout's parent, not the checkout: refused before anything is read.
  assert.notEqual(r.status, 0);
});

const signtool = process.platform === 'win32' ? findSigntool() : null;

test('an unsigned program fails verification', { skip: !signtool && 'needs Windows and SignTool' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'girovo-sign-test-'));
  try {
    // Any file that starts like a program but carries no signature.
    const file = path.join(dir, 'Girovo.exe');
    fs.writeFileSync(file, Buffer.concat([Buffer.from('MZ'), Buffer.alloc(1024)]));
    const entry = verify(file);
    assert.equal(entry.result, 'failed');
    assert.equal(entry.thumbprint, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a program signed by someone else fails verification', { skip: !signtool && 'needs Windows and SignTool' }, () => {
  // SignTool itself carries Microsoft's signature: valid, but not MT-Media's.
  const entry = verify(signtool);
  assert.equal(entry.result, 'failed');
  assert.notEqual(entry.thumbprint, THUMBPRINT);
  assert.match(entry.error, /not 07995B74/);
});
