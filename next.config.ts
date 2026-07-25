import type { NextConfig } from 'next';

// Sooskasse-FinTS runs as ONE long-lived Node process.
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
const nextConfig: NextConfig = {
  // The institute database and the product registration are read from disk at
  // runtime; keep them traced into a standalone build.
  outputFileTracingIncludes: {
    '/api/**/*': ['./banks-data.json', './config.json'],
  },
};

export default nextConfig;
