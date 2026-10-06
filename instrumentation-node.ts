// The Node.js half of instrumentation.ts: reports to telemetry
// (lib/telemetry.ts) what wrap() (lib/api.ts) never sees — a crash outside a
// request, a rejection no one awaited. A file of its own, imported only under
// the Node.js runtime, so the Edge build never meets process.on.

import { reportError } from './lib/telemetry';

process.on('uncaughtExceptionMonitor', (err) => reportError(err, { source: 'server', fatal: true }));
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandled rejection:', reason);
  reportError(reason, { source: 'server' });
});
