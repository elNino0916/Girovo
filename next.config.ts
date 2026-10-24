import type { NextConfig } from 'next';

import pkg from './package.json' with { type: 'json' };

// Girovo runs as ONE long-lived Node process.
//
// Every logged-in user is a live `FinTSClient` with an open FinTS dialog held in
// this process's memory (see lib/session.ts). That state cannot be serialised,
// so the app must never be deployed to a serverless/edge runtime or scaled to
// multiple workers — a request landing on the wrong instance would lose the
// session mid-TAN-approval.
//
// `lib-fints` is deliberately NOT listed in `serverExternalPackages`: the SEPA
// and Vormerkposten segments register themselves in the library's module-level
// segment registry (lib/fints-sepa.ts, lib/fints-pending.ts). Externalising the
// package would give the bundled registry and the runtime-required one separate
// module instances, and the custom segments would be invisible to the encoder.

// The desktop build (scripts/build-electron.mjs) sets ELECTRON_BUILD=1. It needs
// `output: 'standalone'` so the server can ship as a self-contained folder next
// to the Electron binary instead of dragging node_modules along. The website
// workflow (`next build` → `next start`) is left on the default output.
const isElectronBuild = process.env.ELECTRON_BUILD === '1';

// The Android build (scripts/build-android.mjs) sets GIROVO_TARGET=android. It
// has no server to run the page on: the page is exported as static files for
// the app's WebView, and the route handlers run in that WebView instead
// (mobile/server, bundled by scripts/build-mobile.mjs). So the export leaves
// app/api out — `route.ts` is not a page extension there — and the page learns
// that it is the phone's from NEXT_PUBLIC_GIROVO_PLATFORM.
const isAndroidBuild = process.env.GIROVO_TARGET === 'android';

const nextConfig: NextConfig = {
  ...(isElectronBuild ? { output: 'standalone' as const } : {}),
  // `next dev` with the flag (the Android look in a browser, against the design
  // preview's mock data) is not an export: the preview reads its query string.
  ...(isAndroidBuild && process.env.NODE_ENV === 'production'
    ? { output: 'export' as const, pageExtensions: ['tsx'], distDir: '.next-android' }
    : isAndroidBuild
      // 10.0.2.2: the emulator's name for this computer, when a debug build
      // loads the preview from here (GIROVO_DEV_SERVER, capacitor.config.ts).
      ? { pageExtensions: ['tsx'], distDir: '.next-android-dev', allowedDevOrigins: ['10.0.2.2'] }
      : {}),
  // The desktop's invoice reading (components/transfer/desktop-read.ts) is
  // loaded on demand behind IS_ANDROID, but a dynamic import still makes a
  // chunk: on the phone its libraries are an empty module instead.
  ...(isAndroidBuild
    ? { turbopack: { resolveAlias: { 'pdfjs-dist': './mobile/desktop-only.ts', 'tesseract.js': './mobile/desktop-only.ts' } } }
    : {}),
  // The institute database and the product registration are read from disk at
  // runtime; keep them traced into a standalone build.
  outputFileTracingIncludes: {
    '/api/**/*': ['./banks-data.json', './config.json'],
  },
  // The tracer cannot resolve the filename lib/state-store.ts builds at runtime,
  // so it falls back to pulling in all of .fints-state/ — the developer's own
  // encrypted device profiles, which would then ship inside the installer.
  //
  // The category model (lib/category-model.ts) ships beside the server as a
  // resource of its own (electron-builder.yml) — traced in, it would ship twice.
  //
  // The Android project (android/, its exports .next-android*) is no part of
  // the desktop server either: the tracer's guess at the state store's JSON
  // would otherwise sweep Gradle's build intermediates into the installer.
  outputFileTracingExcludes: {
    '*': ['./.fints-state/**', './models/**', './android/**', './.next-android/**', './.next-android-dev/**'],
  },
  // Printed documents name the generator and its version, so the client needs
  // the one number that is otherwise only in package.json.
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_GIROVO_PLATFORM: isAndroidBuild ? 'android' : '',
  },
};

export default nextConfig;
