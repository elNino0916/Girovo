// The desktop server's bundle (scripts/build-desktop.mjs → desktop-server.js):
// the route handlers (./index.ts) in a Web Worker beside the page, or on the
// page's own thread where no worker starts (mobile/worker/host.ts decides,
// mobile/worker/server.ts finds out which).
//
// In the worker, the shell is the page's: window.__girovoShell's shape
// (desktop/shell.ts), every call made on the page across the line — with
// the bytes of fs_write moved over, not copied. On the page the shell is
// already there (src-tauri/src/bridge.js).
//
// Nothing of the server is evaluated before the shell is in place: the
// imports below are dynamic, so esbuild keeps them in this one file and runs
// them on demand — ../env first, which reads the shell's platform.

import { wholeBuffer } from '../../mobile/worker/link';
import { inWorker, page, serve } from '../../mobile/worker/server';
import type { Shell } from '../shell';

serve(async (boot) => {
  if (inWorker) {
    const relayed: Shell = {
      platform: boot.platform,
      version: boot.version,
      invoke: <T>(cmd: string, args?: Record<string, unknown>) => page().call<T>('invoke', [cmd, args]),
      // fs_write's bytes are made for the call (desktop/capacitor/filesystem.ts): moved, not copied.
      invokeRaw: <T>(cmd: string, bytes: Uint8Array, headers?: Record<string, string>) =>
        page().call<T>('invokeRaw', [cmd, bytes, headers], wholeBuffer(bytes)),
      listen: (event, callback) => page().listen('shell', [event], callback),
    };
    (globalThis as { __girovoShell?: Shell }).__girovoShell = relayed;
  }
  await import('../env');
  const server = await import('./index');
  // The worker's own fetch: the bank's traffic through the shell (src-tauri/src/http.rs).
  if (inWorker) (await import('../../mobile/server/fetch')).installFetch(server.handle);
  return { ready: server.ready, handle: server.handle, calls: { flush: () => server.flushFiles() } };
});
