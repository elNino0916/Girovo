// The desktop server, from the page: desktop-server.js in a worker beside
// the page (mobile/worker/host.ts), and the page's fetch('/api/…') answered
// by it — the Android app's way (mobile/bridges/server.ts).
//
// What the server asks of the page is the Tauri shell, whose invoke is only
// on the page (src-tauri/src/bridge.js): invoke and invokeRaw — the files'
// bytes, the model's tensors, moved across rather than copied — the shell's
// events, and the window hiding ("pause": the files flushed).

import { installFetch } from '../mobile/server/fetch';
import { startServer, type ServerHandle } from '../mobile/worker/host';
import { moved } from '../mobile/worker/link';
import { onPause } from './pause';
import { shell } from './shell';

/** A shell's answer as it goes back: bytes moved, not copied (fs_read, model_read, model_run). */
const back = (value: unknown) => (value instanceof ArrayBuffer ? moved(value, [value]) : value);

export function startDesktopServer(): ServerHandle {
  const s = shell();
  const server = startServer({
    script: '/desktop-server.js',
    boot: { platform: s.platform, version: s.version, native: true, console: false },
    calls: {
      // The shell's own rejections (plain strings) go back as they are: desktop/shell.ts reads their code.
      invoke: (cmd: string, args?: Record<string, unknown>) => s.invoke(cmd, args).then(back),
      invokeRaw: (cmd: string, bytes: Uint8Array, headers?: Record<string, string>) => s.invokeRaw(cmd, bytes, headers).then(back),
    },
    sources: {
      shell: (emit, event: string) => s.listen(event, emit),
      pause: (emit) => onPause(() => emit(null)),
    },
  });
  installFetch(server.handle);
  return server;
}
