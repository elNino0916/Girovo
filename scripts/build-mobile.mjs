// Builds the phone runtime: mobile/runtime.ts and everything it pulls in —
// Girovo's route handlers (app/api/**/route.ts), lib-fints, the Android
// bridges — as one script the Android build's page loads before the app
// (app/layout.tsx, `/mobile-runtime.js`).
//
// The handlers are the desktop server's, unchanged. What a WebView lacks is
// swapped in at bundle time:
//
//   node:fs, node:crypto, node:async_hooks,     mobile/shims/*
//   next/server, server-only, onnxruntime-node
//   node:path                                   path-browserify
//   Buffer, process, setImmediate (globals)     mobile/shims/globals.ts
//
// and two modules are written here:
//
//   girovo:routes   every app/api/**/route.ts by its URL path
//   girovo:assets   banks-data.json, config.json and the names in public/logos
//                   — what the desktop server reads from its own folder
//
// Usage:
//   node scripts/build-mobile.mjs [--out <dir>] [--dev]
//   (default out: out/, where `next build` put the Android page export)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : process.argv[at + 1];
};
const OUT = path.resolve(ROOT, arg('--out') ?? 'out');
const DEV = process.argv.includes('--dev');

const shim = (name) => path.join(ROOT, 'mobile', 'shims', name);

const ALIASES = {
  'node:fs': shim('fs.ts'),
  fs: shim('fs.ts'),
  'node:fs/promises': shim('fs.ts'),
  'node:crypto': shim('crypto.ts'),
  crypto: shim('crypto.ts'),
  'node:async_hooks': shim('async-hooks.ts'),
  async_hooks: shim('async-hooks.ts'),
  'node:path': 'path-browserify',
  path: 'path-browserify',
  'next/server': shim('next-server.ts'),
  'server-only': shim('empty.ts'),
  'onnxruntime-node': shim('onnxruntime.ts'),
};

/** Every route handler, by URL path: app/api/connect/cancel/route.ts → /api/connect/cancel. */
function routesModule() {
  const api = path.join(ROOT, 'app', 'api');
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'route.ts') found.push(full);
    }
  };
  walk(api);
  found.sort();
  const lines = found.map((file, i) => `import * as r${i} from ${JSON.stringify(file)};`);
  const table = found.map((file, i) => {
    const url = `/api/${path.relative(api, path.dirname(file)).split(path.sep).join('/')}`;
    return `  ${JSON.stringify(url)}: r${i},`;
  });
  return { contents: `${lines.join('\n')}\nexport const ROUTES = {\n${table.join('\n')}\n};\n`, resolveDir: ROOT, loader: 'js' };
}

function assetsModule() {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const assets = {
    '/app/banks-data.json': read('banks-data.json'),
    '/app/config.json': read('config.json'),
  };
  const listings = {
    '/app/public/logos': fs.readdirSync(path.join(ROOT, 'public', 'logos')).sort(),
  };
  return { contents: `export const ASSETS = ${JSON.stringify(assets)};\nexport const LISTINGS = ${JSON.stringify(listings)};\n`, loader: 'js' };
}

const virtual = {
  name: 'girovo-virtual',
  setup(build) {
    build.onResolve({ filter: /^girovo:/ }, (args) => ({ path: args.path, namespace: 'girovo' }));
    build.onLoad({ filter: /.*/, namespace: 'girovo' }, (args) => {
      if (args.path === 'girovo:routes') return routesModule();
      if (args.path === 'girovo:assets') return assetsModule();
      return null;
    });
  },
};

/** Fails the build on a Node built-in no shim covers, instead of shipping a bundle that throws at start. */
const noStrayBuiltins = {
  name: 'girovo-no-node',
  setup(build) {
    build.onResolve({ filter: /^node:/ }, (args) => {
      if (Object.hasOwn(ALIASES, args.path)) return undefined; // esbuild's alias takes it from here
      return { errors: [{ text: `${args.path} has no phone shim (imported by ${path.relative(ROOT, args.importer)}) — add one to scripts/build-mobile.mjs` }] };
    });
  },
};

export async function buildMobile({ out = OUT, dev = DEV } = {}) {
  fs.mkdirSync(out, { recursive: true });
  const result = await esbuild.build({
    absWorkingDir: ROOT,
    entryPoints: [path.join(ROOT, 'mobile', 'runtime.ts')],
    outfile: path.join(out, 'mobile-runtime.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    // Android System WebView updates through Play; Capacitor 8 needs a recent one anyway.
    target: ['chrome111'],
    alias: ALIASES,
    inject: [shim('globals.ts')],
    define: {
      global: 'globalThis',
      // lib/platform.ts: the route handlers' texts in the phone's words (lib/i18n/messages/phone.ts).
      'process.env.NEXT_PUBLIC_GIROVO_PLATFORM': JSON.stringify('android'),
      'process.env.NEXT_PUBLIC_APP_VERSION': JSON.stringify(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version),
    },
    plugins: [virtual, noStrayBuiltins],
    minify: !dev,
    sourcemap: dev ? 'inline' : false,
    legalComments: 'none',
    metafile: true,
    logLevel: 'warning',
  });
  const bytes = fs.statSync(path.join(out, 'mobile-runtime.js')).size;
  console.log(`  mobile-runtime.js  ${(bytes / 1024).toFixed(0)} KB`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildMobile();
}
