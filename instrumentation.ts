// Next.js's server start hook. In the desktop app the server reports what
// wrap() (lib/api.ts) never sees — a crash outside a request, a rejection no
// one awaited, an error while rendering a page — to telemetry (lib/telemetry.ts),
// which the shell scrubs and sends. Elsewhere those calls do nothing.

import type { Instrumentation } from 'next';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { reportError } = await import('./lib/telemetry');
  process.on('uncaughtExceptionMonitor', (err) => reportError(err, { source: 'server', fatal: true }));
  process.on('unhandledRejection', (reason) => {
    console.error('[server] unhandled rejection:', reason);
    reportError(reason, { source: 'server' });
  });
}

export const onRequestError: Instrumentation.onRequestError = async (err, request) => {
  const { reportError } = await import('./lib/telemetry');
  reportError(err, { source: 'server', route: request.path.split('?')[0] });
};
