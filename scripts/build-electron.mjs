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
