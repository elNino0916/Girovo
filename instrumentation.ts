// Next.js's server start hook. In the desktop app the server reports what
// wrap() (lib/api.ts) never sees to telemetry (lib/telemetry.ts), which the
// shell scrubs and sends; elsewhere those calls do nothing. The process hooks
// live in instrumentation-node.ts, loaded only under the Node.js runtime.

import type { Instrumentation } from 'next';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./instrumentation-node');
}

/** An error while rendering a page or running a route outside wrap(). */
export const onRequestError: Instrumentation.onRequestError = async (err, request) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { reportError } = await import('./lib/telemetry');
  reportError(err, { source: 'server', route: request.path.split('?')[0] });
};
