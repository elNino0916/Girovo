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
// Usage:
//   node scripts/build-electron.mjs

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const STANDALONE = path.join(ROOT, '.next', 'standalone');
// electron-builder's unpacked staging output (electron-builder.yml, directories.output
// + win.target nsis/portable both stage through here first). Fully disposable —
// electron-builder always regenerates it from scratch on the packaging step below.
const WIN_UNPACKED = path.join(ROOT, 'dist', 'win-unpacked');

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
console.log('› cleaning .next/standalone and dist/win-unpacked');
fs.rmSync(STANDALONE, { recursive: true, force: true });
fs.rmSync(WIN_UNPACKED, { recursive: true, force: true });

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

console.log('✓ desktop server ready in .next/standalone');
