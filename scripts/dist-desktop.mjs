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

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { editionOf, nameOf } from '../lib/edition.ts';
import { fetchModel } from './fetch-model.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = process.argv.indexOf('--platform');
const PLATFORM = at === -1 ? process.platform : process.argv[at + 1];
if (PLATFORM !== 'win32' && PLATFORM !== 'linux') {
  console.error(`✗ no desktop packages for ${PLATFORM}`);
  process.exit(1);
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

await fetchModel();
run(process.execPath, [path.join(ROOT, 'scripts', 'build-desktop.mjs')]);

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

const bundles = PLATFORM === 'win32' ? 'nsis' : 'appimage,deb';
// Bundles of earlier builds stay in the folder otherwise; only this one's should be found.
fs.rmSync(BUNDLE, { recursive: true, force: true });
run('npx', ['tauri', 'build', '--bundles', bundles]);

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
