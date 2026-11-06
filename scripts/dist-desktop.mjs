// Builds the Tauri desktop app's packages (6.0) for one platform and puts
// them in dist/ under the names the Electron build gave them — the names the
// installed apps' updaters look for (electron/updater.cjs, src-tauri's port),
// so the first Tauri release reaches every Electron copy:
//
//   Windows  dist/Girovo-<version>-Setup.exe
//   Linux    dist/Girovo-<version>-x86_64.AppImage, dist/Girovo-<version>-amd64.deb
//
// Steps: the category model (scripts/fetch-model.mjs), the page and its
// runtime (scripts/build-desktop.mjs), then `tauri build` for the platform's
// bundles, renamed.
//
// Usage:
//   node scripts/dist-desktop.mjs                     this machine's platform
//   node scripts/dist-desktop.mjs --platform linux    win32 or linux

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

await fetchModel();
run(process.execPath, [path.join(ROOT, 'scripts', 'build-desktop.mjs')]);
const bundles = PLATFORM === 'win32' ? 'nsis' : 'appimage,deb';
run('npx', ['tauri', 'build', '--bundles', bundles]);

/** The one file in `dir` whose name ends with `suffix`. */
function single(dir, suffix) {
  const found = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(suffix)) : [];
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
