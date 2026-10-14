// Builds the Next server for the desktop app.
//
// `next build` with output: 'standalone' emits .next/standalone/ — server.js
// plus only the node_modules the trace actually needs. Two things it does not
// emit, by design, because a normal deployment serves them from a CDN:
//
//   .next/static   the client bundle, fonts and CSS
//   public         the bank logos, which app/api/logos also reads from disk
//
// In the desktop app there is no CDN, so both are copied in here. The result is
// a folder that runs standalone (`node .next/standalone/server.js`) and is what
// electron-builder ships as an extraResource.
//
// The server itself is the same on every platform; only the ONNX runtime's
// native files (below) and the Windows update window are not. So the build is
// for one platform — this machine's, unless named.
//
// Usage:
//   node scripts/build-electron.mjs                     for this machine's platform
//   node scripts/build-electron.mjs --platform linux    for win32 or linux

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildUpdateWindow } from './build-update-window.mjs';
import { fetchModel } from './fetch-model.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const STANDALONE = path.join(ROOT, '.next', 'standalone');
// electron-builder's unpacked staging output (electron-builder.yml, directories.output
// — every target of a platform stages through its folder first). Fully disposable —
// electron-builder always regenerates it from scratch on the packaging step below.
const UNPACKED = ['win-unpacked', 'linux-unpacked'].map((dir) => path.join(ROOT, 'dist', dir));

// What onnxruntime-node (lib/category-model.ts) needs at run time, per
// platform: its binding and the runtime library that binding loads — on the
// CPU only, x64 only, like the packages (electron-builder.yml).
const ORT_FILES = {
  win32: ['onnxruntime_binding.node', 'onnxruntime.dll'],
  linux: ['onnxruntime_binding.node', 'libonnxruntime.so.1'],
};

const platformArg = process.argv.indexOf('--platform');
const PLATFORM = platformArg === -1 ? process.platform : process.argv[platformArg + 1];
if (!Object.hasOwn(ORT_FILES, PLATFORM)) {
  console.error(`✗ cannot build the desktop server for "${PLATFORM}" — only for ${Object.keys(ORT_FILES).join(' or ')}`);
  process.exit(1);
}

// `next build`'s file tracer, resolving config files (tsconfig.json etc.) for each
// traced node_modules package, doesn't scope its search to the real node_modules —
// it picks up same-named files anywhere under the project root. If dist/win-unpacked
// exists at build time (it does, as soon as you've built once — it's the previous
// build's own output, containing a full copy of node_modules under
// resources/server/), those get swept in too. And since `next build` also never
// wipes .next/standalone before writing to it, that mistake then persists and gets
// re-packaged into the *next* dist/win-unpacked — which the build after that sweeps
// in again, one directory level deeper each time. A few generations of that produced
// paths long enough to break Windows' 260-character limit, which made every *update*
// install fail outright: NSIS renames installed files aside during an upgrade, and
// that rename silently aborts once a path gets too long. A fresh install was never
// affected (it writes files directly), so the bug stayed invisible until an update.
//
// Removing both before every build — rather than trying to make the tracer exclude
// dist/ (its outputFileTracingExcludes matching turned out not to reach these
// particular files) — starves the mechanism at its source: with dist/win-unpacked
// gone, there's nothing under dist/ for the tracer to find in the first place.
// dist/linux-unpacked, the Linux build's, holds the same copy and goes too.
// The on-device category model ships beside the server (electron-builder.yml,
// extraResources); fetched and checked here, a no-op when already present.
console.log('› category model');
await fetchModel({ log: (line) => console.log(`  ${line}`) });

console.log('› cleaning .next/standalone and dist/*-unpacked');
fs.rmSync(STANDALONE, { recursive: true, force: true });
for (const dir of UNPACKED) fs.rmSync(dir, { recursive: true, force: true });

console.log('› next build (standalone)');
// The CLI entry is invoked directly rather than through node_modules/.bin, so
// this needs no shell and behaves the same on every platform.
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_BUILD: '1' },
});
if (build.status !== 0) process.exit(build.status ?? 1);

if (!fs.existsSync(path.join(STANDALONE, 'server.js'))) {
  console.error('✗ .next/standalone/server.js was not produced — is output: "standalone" active?');
  process.exit(1);
}

// outputFileTracingExcludes (next.config.ts) keeps the developer's device
// profiles out of the bundle. Belt and braces, because this one ships secrets:
// if a future tracer heuristic sneaks them back in, they still do not get here.
fs.rmSync(path.join(STANDALONE, '.fints-state'), { recursive: true, force: true });
// Likewise the category model: it ships once, as its own resource
// (electron-builder.yml), and 280 MB twice would be a waste nobody notices.
fs.rmSync(path.join(STANDALONE, 'models'), { recursive: true, force: true });

console.log('› copying .next/static');
fs.cpSync(path.join(ROOT, '.next', 'static'), path.join(STANDALONE, '.next', 'static'), {
  recursive: true,
});

console.log('› copying public');
fs.cpSync(path.join(ROOT, 'public'), path.join(STANDALONE, 'public'), { recursive: true });

// outputFileTracingIncludes (next.config.ts) should have brought these along;
// copy them if a future config change ever drops them, since the app is dead
// without the institute database.
for (const file of ['banks-data.json', 'config.json']) {
  const dest = path.join(STANDALONE, file);
  if (!fs.existsSync(dest)) {
    console.log(`› copying ${file}`);
    fs.copyFileSync(path.join(ROOT, file), dest);
  }
}

// onnxruntime-node (lib/category-model.ts) loads its native runtime by a path
// it computes at run time, which the tracer can only guess at: it brings
// every platform's binding, or none. So its bin/ is replaced by exactly what
// the target platform needs on x64 (ORT_FILES above) — on Windows the binding
// and onnxruntime.dll, about 29 MB; DirectML.dll, dxcompiler.dll and dxil.dll
// (38 MB) are for the GPU and stay out. On Linux, the binding and
// libonnxruntime.so.1, about 46 MB.
const ORT_BIN = path.join('node_modules', 'onnxruntime-node', 'bin', 'napi-v6', PLATFORM, 'x64');
const ortStandalone = path.join(STANDALONE, 'node_modules', 'onnxruntime-node');
if (!fs.existsSync(path.join(ortStandalone, 'package.json'))) {
  console.error('✗ onnxruntime-node was not traced into .next/standalone — the category model would not load.');
  process.exit(1);
}
fs.rmSync(path.join(ortStandalone, 'bin'), { recursive: true, force: true });
fs.mkdirSync(path.join(STANDALONE, ORT_BIN), { recursive: true });
for (const file of ORT_FILES[PLATFORM]) {
  fs.copyFileSync(path.join(ROOT, ORT_BIN, file), path.join(STANDALONE, ORT_BIN, file));
}
console.log(`› onnxruntime: ${PLATFORM} x64 CPU runtime only`);

console.log(`✓ desktop server for ${PLATFORM} ready in .next/standalone`);

// The window shown while an update installs (electron-builder.yml ships it
// with the Windows build). Linux has no such window: it does not update itself.
if (PLATFORM === 'win32') {
  console.log('› update window');
  buildUpdateWindow();
}
