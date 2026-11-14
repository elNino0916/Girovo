// Builds the Tauri desktop app's packages (6.0) for one platform and puts
// them in dist/ under the names the Electron build gave them — the names the
// installed apps' updaters look for (src-tauri/src/updater, and the 5.x Electron updater before it),
// so the first Tauri release reaches every Electron copy:
//
//   Windows  dist/Girovo-<version>-Setup.exe
//   Linux    dist/Girovo-<version>-x86_64.AppImage, dist/Girovo-<version>-amd64.deb
//
// Steps: the category model (scripts/fetch-model.mjs), the page and its
// runtime (scripts/build-desktop.mjs), then `tauri build` for the platform's
// bundles, renamed; on Windows the installer's blockmap beside it.
//
// Usage:
//   node scripts/dist-desktop.mjs                     this machine's platform
//   node scripts/dist-desktop.mjs --platform linux    win32 or linux
//
// Windows, signed with the MT-Media certificate (docs/mt-media-code-signing.md,
// scripts/sign-windows.mjs):
//   --sign          Tauri signs Girovo.exe, girovo-update.exe, girovo-cert.exe
//                   and the uninstaller before NSIS packs them, then the
//                   installer; every one is checked afterwards and an unsigned
//                   one fails the build. Also GIROVO_SIGN=1. The committed
//                   config never signs: the command reaches Tauri through a
//                   --config file made here, so builds without it stay as
//                   they were.
//   --no-bundle     the programs only (GitHub's build job, which never sees the key)
//   --bundle-only   the installer from programs built before (GitHub's signing
//                   job: no npm ci, no cargo build; GIROVO_TAURI_CLI names the
//                   Tauri CLI it installed on its own)

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { editionOf, nameOf } from '../lib/edition.ts';
import { fetchModel } from './fetch-model.mjs';
import { LOG, readiness, record, verify } from './sign-windows.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = process.argv.indexOf('--platform');
const PLATFORM = at === -1 ? process.platform : process.argv[at + 1];
if (PLATFORM !== 'win32' && PLATFORM !== 'linux') {
  console.error(`✗ no desktop packages for ${PLATFORM}`);
  process.exit(1);
}
const SIGN = process.argv.includes('--sign') || process.env.GIROVO_SIGN === '1';
const NO_BUNDLE = process.argv.includes('--no-bundle');
const BUNDLE_ONLY = process.argv.includes('--bundle-only');
if ((SIGN || NO_BUNDLE || BUNDLE_ONLY) && PLATFORM !== 'win32') {
  console.error('✗ --sign, --no-bundle and --bundle-only are for the Windows build');
  process.exit(1);
}
if (NO_BUNDLE && (BUNDLE_ONLY || SIGN)) {
  console.error('✗ --no-bundle builds the programs only: nothing to sign or bundle');
  process.exit(1);
}
if (SIGN) {
  const problem = readiness();
  if (problem) {
    console.error(`✗ cannot sign: ${problem}`);
    process.exit(1);
  }
}
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const DIST = path.join(ROOT, 'dist');
const BUNDLE = path.join(ROOT, 'src-tauri', 'target', 'release', 'bundle');

function run(cmd, args) {
  console.log(`› ${cmd} ${args.join(' ')}`);
  // npx is a .cmd on Windows and needs the shell; node (whose path has a space) must not go through it.
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npx' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/** Tauri's CLI: the project's, or the one GIROVO_TAURI_CLI names (the signing job's own install). */
function tauri(args) {
  const cli = process.env.GIROVO_TAURI_CLI;
  if (!cli) return run('npx', ['tauri', ...args]);
  console.log(`› ${cli} ${args.join(' ')}`);
  const r = spawnSync(cli, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' && /\.cmd$/i.test(cli) });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (BUNDLE_ONLY) {
  // The programs, the model and ONNX Runtime come from the build job.
  for (const p of [path.join('src-tauri', 'target', 'release', 'Girovo.exe'), path.join('src-tauri', 'onnxruntime'), path.join('models', 'category-model')]) {
    if (!fs.existsSync(path.join(ROOT, p))) {
      console.error(`✗ --bundle-only needs ${p} from an earlier --no-bundle build`);
      process.exit(1);
    }
  }
} else {
  await fetchModel();
  run(process.execPath, [path.join(ROOT, 'scripts', 'build-desktop.mjs')]);
}

// Girovo Nightly and Girovo Next (pre-release versions, by the rule in
// lib/edition.ts) get their own icon, the mark in navy on amber or in white on
// violet, everywhere Tauri puts one: the program, its windows and tray, the
// installer, the Linux packages. The edition's set takes src-tauri/icons'
// place for this build, which puts the release's back at exit however the
// build ends: Ctrl+C or a closed terminal included, which Node would
// otherwise end without its exit handlers. src-tauri/build.rs reruns when the
// icons change, so the program never keeps the other set.
const EDITION = editionOf(VERSION);
if (EDITION !== 'release') {
  const icons = path.join(ROOT, 'src-tauri', 'icons');
  const set = `icons-${EDITION}`;
  const edition = path.join(ROOT, 'src-tauri', set);
  const kept = fs.mkdtempSync(path.join(os.tmpdir(), 'girovo-icons-release-'));
  const files = fs.readdirSync(icons);
  for (const f of files) {
    if (!fs.existsSync(path.join(edition, f))) {
      console.error(`✗ src-tauri/${set} has no ${f}`);
      process.exit(1);
    }
  }
  for (const f of files) fs.copyFileSync(path.join(icons, f), path.join(kept, f));
  process.on('exit', () => {
    for (const f of files) fs.copyFileSync(path.join(kept, f), path.join(icons, f));
    fs.rmSync(kept, { recursive: true, force: true });
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(130));
  for (const f of files) fs.copyFileSync(path.join(edition, f), path.join(icons, f));
  console.log(`✓ ${nameOf(EDITION)} ${VERSION}: the ${EDITION} icon`);
}

// The signing command, for this build only: Tauri runs it on every program
// it puts into the installer, on the uninstaller and on the installer.
const signConfig = [];
const signedFrom = new Date().toISOString();
if (SIGN) {
  const file = path.join(os.tmpdir(), `girovo-sign-${process.pid}.json`);
  const command = { cmd: process.execPath, args: [path.join(ROOT, 'scripts', 'sign-windows.mjs'), '%1'] };
  fs.writeFileSync(file, JSON.stringify({ bundle: { windows: { signCommand: command } } }));
  process.on('exit', () => fs.rmSync(file, { force: true }));
  signConfig.push('--config', file);
  console.log('✓ signing with the MT-Media certificate');
}

if (NO_BUNDLE) {
  tauri(['build', '--no-bundle']);
  console.log('✓ the programs, without an installer (src-tauri/target/release)');
  process.exit(0);
}

const bundles = PLATFORM === 'win32' ? 'nsis' : 'appimage,deb';
// Bundles of earlier builds stay in the folder otherwise; only this one's should be found.
fs.rmSync(BUNDLE, { recursive: true, force: true });
if (BUNDLE_ONLY) tauri(['bundle', '--bundles', bundles, ...signConfig]);
else tauri(['build', '--bundles', bundles, ...signConfig]);

/** The one file in `dir` of this version whose name ends with `suffix`. */
function single(dir, suffix) {
  const found = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(suffix) && f.includes(VERSION)) : [];
  if (found.length !== 1) {
    console.error(`✗ expected one *${suffix} in ${path.relative(ROOT, dir)}, found ${found.length}`);
    process.exit(1);
  }
  return path.join(dir, found[0]);
}

fs.mkdirSync(DIST, { recursive: true });
const outputs = PLATFORM === 'win32'
  ? [[single(path.join(BUNDLE, 'nsis'), '-setup.exe'), `Girovo-${VERSION}-Setup.exe`]]
  : [
      [single(path.join(BUNDLE, 'appimage'), '.AppImage'), `Girovo-${VERSION}-x86_64.AppImage`],
      [single(path.join(BUNDLE, 'deb'), '.deb'), `Girovo-${VERSION}-amd64.deb`],
    ];
for (const [from, name] of outputs) {
  fs.copyFileSync(from, path.join(DIST, name));
  const mb = (fs.statSync(path.join(DIST, name)).size / 1048576).toFixed(0);
  console.log(`✓ dist/${name}  ${mb} MB`);
}

// The installer's blockmap, for the updater's differential downloads
// (scripts/blockmap.mjs, docs/tauri-updater.md): the installer is built
// uncompressed (tauri.conf.json), so the next one shares most of its bytes.
if (PLATFORM === 'win32') {
  run(process.execPath, [path.join(ROOT, 'scripts', 'blockmap.mjs'), path.join(DIST, `Girovo-${VERSION}-Setup.exe`)]);
}

// Signed builds: every program that went into the installer, and the
// installer, must carry a valid MT-Media signature with a timestamp.
//
// What Tauri packs is not what stays in target/release: it patches
// Girovo.exe with the bundle type, signs that copy, packs it and then puts
// the unpatched file back; the helpers go in from src-tauri/binaries/, signed
// there (Tauri skips one that is signed already). So the proof is threefold:
// this build's signing log must hold a good signature for the app, the
// uninstaller and the installer (each was checked right after signing); the
// helpers as packed and the installer are checked again now; and with 7-Zip at hand (GitHub's runners have it) the
// installer is opened and every program inside is checked.
if (SIGN) {
  const triple = 'x86_64-pc-windows-msvc';
  const setup = path.join(DIST, `Girovo-${VERSION}-Setup.exe`);
  const signed = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((e) => e.action === 'sign' && e.time >= signedFrom);
  const expected = [
    ['Girovo.exe', (n) => n === 'girovo.exe'],
    ['the uninstaller', (n) => /^ns.*\.tmp$/.test(n)],
    ['the installer', (n) => /-setup\.exe$/.test(n)],
  ];
  let failed = 0;
  for (const bad of signed.filter((e) => e.result !== 'ok')) {
    console.error(`✗ ${bad.file} was not signed: ${bad.error}`);
    failed++;
  }
  for (const [what, match] of expected) {
    if (!signed.some((e) => e.result === 'ok' && match(e.file.toLowerCase()))) {
      console.error(`✗ this build signed no ${what}`);
      failed++;
    }
  }
  const files = [
    path.join(ROOT, 'src-tauri', 'binaries', `girovo-update-${triple}.exe`),
    path.join(ROOT, 'src-tauri', 'binaries', `girovo-cert-${triple}.exe`),
    setup,
  ];
  const seven = ['7z', path.join(process.env.ProgramFiles || 'C:\\Program Files', '7-Zip', '7z.exe')]
    .find((exe) => spawnSync(exe, ['i'], { stdio: 'ignore' }).status === 0);
  let unpacked = null;
  if (seven) {
    unpacked = fs.mkdtempSync(path.join(os.tmpdir(), 'girovo-setup-'));
    process.on('exit', () => fs.rmSync(unpacked, { recursive: true, force: true }));
    const r = spawnSync(seven, ['x', '-y', `-o${unpacked}`, setup, '*.exe', '-r'], { stdio: 'ignore' });
    if (r.status !== 0) {
      console.error('✗ 7-Zip could not open the installer');
      process.exit(1);
    }
    const inside = fs.readdirSync(unpacked, { recursive: true })
      .map((f) => path.join(unpacked, f))
      .filter((f) => /\.exe$/i.test(f) && fs.statSync(f).isFile());
    for (const name of ['girovo.exe', 'girovo-update.exe', 'girovo-cert.exe']) {
      if (!inside.some((f) => path.basename(f).toLowerCase() === name)) {
        console.error(`✗ the installer holds no ${name}`);
        failed++;
      }
    }
    files.push(...inside);
  } else {
    console.log('· 7-Zip not found: the programs inside the installer are not opened; the signing log stands for them');
  }
  for (const f of files) {
    const entry = verify(f);
    if (unpacked && f.startsWith(unpacked)) entry.action = 'verify (inside the installer)';
    record(entry);
    if (entry.result !== 'ok') failed++;
  }
  if (failed) {
    console.error(`✗ ${failed} problem(s) with the MT-Media signatures`);
    process.exit(1);
  }
  console.log(`✓ signed by MT-Media and timestamped: ${signed.length} files at signing, ${files.length} checked again`);
}
