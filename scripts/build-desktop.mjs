// Builds the Tauri desktop app's page (6.0), the Android build's way:
//
//   1. the page, exported         GIROVO_TARGET=desktop next build → .next-desktop/
//   2. the desktop runtime        desktop/runtime.ts → desktop-runtime.js beside it:
//                                 the route handlers (app/api/**/route.ts) and
//                                 lib-fints, with Node's modules swapped for the
//                                 phone's shims (scripts/build-mobile.mjs) and
//                                 Capacitor's for the Tauri shell's (desktop/)
//   3. both into out-desktop/     what src-tauri/tauri.conf.json embeds
//
// Usage:
//   node scripts/build-desktop.mjs [--dev] [--runtime-only]
//   --runtime-only: step 2 and 3 on the last export (quick turns on desktop/)

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { ALIASES, noStrayBuiltins, virtual } from './build-mobile.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPORT = path.join(ROOT, '.next-desktop');
const DIST = path.join(ROOT, 'out-desktop');
const DEV = process.argv.includes('--dev');
const RUNTIME_ONLY = process.argv.includes('--runtime-only');
const desktop = (rel) => path.join(ROOT, 'desktop', rel);

if (!RUNTIME_ONLY) {
  console.log('› next build (desktop export)');
  const next = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, GIROVO_TARGET: 'desktop', NODE_ENV: 'production' },
  });
  if (next.status !== 0) process.exit(next.status ?? 1);
}

/** Where `next build` put the export: the distDir itself with `output: 'export'`, or out/. */
function exportDir() {
  for (const dir of [EXPORT, path.join(ROOT, 'out')]) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  }
  throw new Error('no desktop export found — run without --runtime-only first');
}

/** The phone's plugins (mobile/native.ts), wherever the shared code imports them from: the desktop's instead. */
const desktopNative = {
  name: 'girovo-desktop-native',
  setup(build) {
    const target = path.join(ROOT, 'mobile', 'native');
    build.onResolve({ filter: /(^|\/)native$/ }, (args) => {
      const resolved = path.resolve(args.resolveDir, args.path);
      return resolved === target ? { path: desktop('native.ts') } : undefined;
    });
  },
};

const { '@/lib/category-model': _nano, ...shared } = ALIASES;
const ALIAS = {
  ...shared,
  // The e5 model, as beside the Electron shell's server: its weights run in Rust (desktop/shims/ort.ts).
  'onnxruntime-node': desktop('shims/ort.ts'),
  '@capacitor/core': desktop('capacitor/core.ts'),
  '@capacitor/filesystem': desktop('capacitor/filesystem.ts'),
  '@capacitor/app': desktop('capacitor/app.ts'),
};

const out = exportDir();
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
await esbuild.build({
  absWorkingDir: ROOT,
  entryPoints: [desktop('runtime.ts')],
  outfile: path.join(out, 'desktop-runtime.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  // WebView2 is evergreen on Windows; Linux has WebKitGTK.
  target: ['chrome111', 'safari16'],
  alias: ALIAS,
  inject: [path.join(ROOT, 'mobile', 'shims', 'globals.ts')],
  define: {
    global: 'globalThis',
    'process.env.NEXT_PUBLIC_GIROVO_PLATFORM': JSON.stringify('desktop'),
    'process.env.NEXT_PUBLIC_APP_VERSION': JSON.stringify(version),
  },
  plugins: [virtual, noStrayBuiltins, desktopNative],
  minify: !DEV,
  sourcemap: DEV ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'warning',
});
const bytes = fs.statSync(path.join(out, 'desktop-runtime.js')).size;
console.log(`  desktop-runtime.js  ${(bytes / 1024).toFixed(0)} KB`);

fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(out, DIST, { recursive: true });
console.log(`✓ ${path.relative(ROOT, DIST)}`);
