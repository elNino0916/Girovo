// Builds the Tauri desktop app's page (6.0), the Android build's way:
//
//   1. the page, exported         GIROVO_TARGET=desktop next build → .next-desktop/
//   2. the desktop runtime        desktop/runtime.ts → desktop-runtime.js beside it,
//                                 which starts desktop/server/entry.ts →
//                                 desktop-server.js in a Web Worker
//                                 (mobile/worker/host.ts): the route handlers
//                                 (app/api/**/route.ts) and lib-fints, with
//                                 Node's modules swapped for the phone's shims
//                                 (scripts/build-mobile.mjs) and Capacitor's for
//                                 the Tauri shell's (desktop/)
//   3. all into out-desktop/      what src-tauri/tauri.conf.json embeds
//   4. the category model         models/category-model (scripts/fetch-model.mjs)
//                                 and ONNX Runtime for this platform in
//                                 src-tauri/onnxruntime/, both bundled as
//                                 resources (src-tauri/src/model.rs runs them)
//
// Usage:
//   node scripts/build-desktop.mjs [--dev] [--runtime-only]
//   --runtime-only: step 2 to 4 on the last export (quick turns on desktop/),
//   without fetching the model

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { ALIASES, noStrayBuiltins, serverOnly, virtual } from './build-mobile.mjs';
import { fetchModel } from './fetch-model.mjs';

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
/** The page's runtime, then the server's bundle: the same shims, the same shell. */
for (const [entry, file, guard] of [
  ['runtime.ts', 'desktop-runtime.js', []],
  ['server/entry.ts', 'desktop-server.js', [serverOnly(ALIAS)]],
]) {
  await esbuild.build({
    absWorkingDir: ROOT,
    entryPoints: [desktop(entry)],
    outfile: path.join(out, file),
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
    plugins: [virtual, noStrayBuiltins, desktopNative, ...guard],
    minify: !DEV,
    sourcemap: DEV ? 'inline' : false,
    legalComments: 'none',
    logLevel: 'warning',
  });
  const bytes = fs.statSync(path.join(out, file)).size;
  console.log(`  ${file}  ${(bytes / 1024).toFixed(0)} KB`);
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(out, DIST, { recursive: true });
console.log(`✓ ${path.relative(ROOT, DIST)}`);

// The category model's weights run in the shell, on ONNX Runtime loaded at
// run time: onnxruntime-node's library for this platform — the very build the
// Electron app shipped and the model's thresholds were measured with — on the
// CPU only (DirectML.dll and dxcompiler.dll stay out, as in
// the Electron build before it). On Windows the Visual C++ runtime it imports
// goes beside it, for a PC that has none; girovo.exe itself needs none.
// About 31 MB on Windows (onnxruntime.dll 30 MB, the runtime 0.8 MB; 8 MB
// compressed), 45 MB on Linux (12 MB compressed), beside the model's 283 MB.
if (!RUNTIME_ONLY) {
  console.log('› category model');
  await fetchModel({ log: (line) => console.log(`  ${line}`) });
}

const ORT_LIBRARY = { win32: 'onnxruntime.dll', linux: 'libonnxruntime.so.1' }[process.platform];
const ORT_STAGE = path.join(ROOT, 'src-tauri', 'onnxruntime');
/** What onnxruntime.dll imports from the Visual C++ runtime (dumpbin /dependents). */
const VC_RUNTIME = ['msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_atomic_wait.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'];

/** The x64 Visual C++ runtime the build tools may redistribute: VCToolsRedistDir in a developer shell, else vswhere's latest. */
function vcRuntimeDir() {
  let redist = process.env.VCToolsRedistDir;
  if (!redist) {
    const vswhere = path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    const found = fs.existsSync(vswhere)
      ? spawnSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' })
      : null;
    const install = found?.stdout.trim();
    const version = install && fs.readFileSync(path.join(install, 'VC', 'Auxiliary', 'Build', 'Microsoft.VCRedistVersion.default.txt'), 'utf8').trim();
    if (version) redist = path.join(install, 'VC', 'Redist', 'MSVC', version);
  }
  const x64 = redist && path.join(redist, 'x64');
  const crt = x64 && fs.existsSync(x64) && fs.readdirSync(x64).find((d) => /^Microsoft\.VC\d+\.CRT$/.test(d));
  return crt ? path.join(x64, crt) : null;
}

fs.rmSync(ORT_STAGE, { recursive: true, force: true });
if (!ORT_LIBRARY || process.arch !== 'x64') {
  console.log(`  no ONNX Runtime for ${process.platform} ${process.arch}: the build has no category model`);
} else {
  fs.mkdirSync(ORT_STAGE, { recursive: true });
  const from = path.join(ROOT, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', process.platform, 'x64', ORT_LIBRARY);
  fs.copyFileSync(from, path.join(ORT_STAGE, ORT_LIBRARY));
  if (process.platform === 'win32') {
    const crt = vcRuntimeDir();
    if (crt) {
      for (const file of VC_RUNTIME) fs.copyFileSync(path.join(crt, file), path.join(ORT_STAGE, file));
    } else if (DEV) {
      console.warn('  ! no Visual C++ runtime found to ship: the model then needs the one installed on the PC');
    } else {
      console.error('✗ no Visual C++ runtime found to ship beside onnxruntime.dll (install the MSVC build tools, or run with --dev)');
      process.exit(1);
    }
  }
  const total = fs.readdirSync(ORT_STAGE).reduce((n, f) => n + fs.statSync(path.join(ORT_STAGE, f)).size, 0);
  console.log(`✓ ${path.relative(ROOT, ORT_STAGE)}  ${(total / 1048576).toFixed(1)} MB`);
}
