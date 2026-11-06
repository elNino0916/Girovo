// The Tauri shell as the desktop runtime reaches it: src-tauri/src/bridge.js
// puts window.__girovoShell up before any script of the page, with the
// platform, the version and Tauri's invoke.
//
// Tauri's errors arrive as plain strings, "ENOTFOUND: …"; the code the server
// code reads from Node's errors (err.code) is put back on an Error here.

type Shell = {
  platform: string;
  version: string;
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  /** Bytes as the request's body, with headers beside them (src-tauri/src/bridge.js). */
  invokeRaw: <T>(cmd: string, bytes: Uint8Array, headers?: Record<string, string>) => Promise<T>;
  /** A shell event's payload as it comes; returns its own unsubscribe. */
  listen: (event: string, callback: (payload: unknown) => void) => () => void;
};

export function shell(): Shell {
  const s = (window as Window & { __girovoShell?: Shell }).__girovoShell;
  if (!s) throw new Error('Girovo: no Tauri shell');
  return s;
}

/** An error from the shell as Node would have thrown it: `code` from its "CODE: message" text. */
export function shellError(err: unknown): Error & { code?: string } {
  const text = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err);
  const m = /^([A-Z][A-Z0-9_]{1,30}): ?/.exec(text);
  return Object.assign(new Error(text), m ? { code: m[1] } : {});
}

export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return shell().invoke<T>(cmd, args).catch((err: unknown) => {
    throw shellError(err);
  });
}

export function invokeRaw<T>(cmd: string, bytes: Uint8Array, headers?: Record<string, string>): Promise<T> {
  return shell().invokeRaw<T>(cmd, bytes, headers).catch((err: unknown) => {
    throw shellError(err);
  });
}
