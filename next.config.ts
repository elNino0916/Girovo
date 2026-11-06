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

// The Android build (scripts/build-android.mjs) sets GIROVO_TARGET=android. It
// has no server to run the page on: the page is exported as static files for
// the app's WebView, and the route handlers run in that WebView instead
// (mobile/server, bundled by scripts/build-mobile.mjs). So the export leaves
// app/api out — `route.ts` is not a page extension there — and the page learns
// that it is the phone's from NEXT_PUBLIC_GIROVO_PLATFORM.
const isAndroidBuild = process.env.GIROVO_TARGET === 'android';

// The Tauri desktop build (scripts/build-desktop.mjs) sets GIROVO_TARGET=desktop:
// the desktop's page, exported like the Android one, with its route handlers
// in the window (desktop/server).
const isDesktopBuild = process.env.GIROVO_TARGET === 'desktop';

const nextConfig: NextConfig = {
  // `next dev` with the flag (the Android look in a browser, against the design
  // preview's mock data) is not an export: the preview reads its query string.
  ...(isAndroidBuild && process.env.NODE_ENV === 'production'
    ? { output: 'export' as const, pageExtensions: ['tsx'], distDir: '.next-android' }
    : isDesktopBuild && process.env.NODE_ENV === 'production'
      ? { output: 'export' as const, pageExtensions: ['tsx'], distDir: '.next-desktop' }
      : isAndroidBuild
      // 10.0.2.2: the emulator's name for this computer, when a debug build
      // loads the preview from here (GIROVO_DEV_SERVER, capacitor.config.ts).
      ? { pageExtensions: ['tsx'], distDir: '.next-android-dev', allowedDevOrigins: ['10.0.2.2'] }
      : {}),
  // The desktop's invoice reading (components/transfer/desktop-read.ts) is
  // loaded on demand, but a dynamic import still makes a chunk: on the phone,
  // which draws a PDF with Android's PdfRenderer, pdf.js is an empty module.
  // Tesseract's loader stays: the F-Droid build, without ML Kit, reads an
  // invoice's text with it (its files are in that APK alone).
  ...(isAndroidBuild
    ? { turbopack: { resolveAlias: { 'pdfjs-dist': './mobile/desktop-only.ts' } } }
    : {}),
  // Printed documents name the generator and its version, so the client needs
  // the one number that is otherwise only in package.json.
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_GIROVO_PLATFORM: isAndroidBuild ? 'android' : isDesktopBuild ? 'desktop' : '',
  },
};

export default nextConfig;
