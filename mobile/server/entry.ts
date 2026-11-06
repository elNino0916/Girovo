// The phone server's bundle (scripts/build-mobile.mjs → mobile-server.js):
// the route handlers (./index.ts) in a Web Worker beside the page, or on the
// page's own thread where no worker starts (mobile/worker/host.ts decides,
// mobile/worker/server.ts finds out which).
//
// Nothing of the server is evaluated before the page's facts are in: the
// imports below are dynamic, so esbuild keeps them in this one file and runs
// them on demand.

import { inWorker, page, serve } from '../worker/server';

serve(async () => {
  // lib/telemetry.ts: in a worker, the route handlers' reports go to the page's
  // hub (mobile/bridges/telemetry.ts); on the page they reach its sink directly.
  if (inWorker) {
    (globalThis as { __girovoTelemetrySink?: (message: Record<string, unknown>) => void }).__girovoTelemetrySink = (message) =>
      page().send('telemetry', [message]);
  }
  const server = await import('./index');
  const { refreshNano } = await import('./categories');
  const { loginOf } = await import('./logins');
  // The worker's own fetch: the bank's traffic through the page's GirovoHttp.
  if (inWorker) (await import('./fetch')).installFetch(server.handle);
  return {
    ready: server.ready,
    handle: server.handle,
    calls: {
      // Einstellungen asks again whether Nano is here, and the server's copy follows (mobile/bridges/categories.ts).
      refreshNano: () => refreshNano(),
      logins: (sessionIds: unknown[]) => sessionIds.map(loginOf),
    },
  };
});
