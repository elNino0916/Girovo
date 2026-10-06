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

const nextConfig: NextConfig = {
  ...(isElectronBuild ? { output: 'standalone' as const } : {}),
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
  outputFileTracingExcludes: {
    '*': ['./.fints-state/**', './models/**'],
  },
  // Printed documents name the generator and its version, so the client needs
  // the one number that is otherwise only in package.json.
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
};

export default nextConfig;
