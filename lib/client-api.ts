'use client';

// Thin fetch wrapper for the route handlers. Every endpoint answers either the
// payload or `{ error }` with a non-2xx status, so failure is always a throw
// with a message that is already written for the user in German.

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Fired on `window` when a session-bound call comes back 401: the server no
 * longer knows the session (its 30-minute idle sweep, or a restart of the
 * process). The provider listens and logs out with a toast, so every caller
 * does not have to recognise an expired session itself.
 *
 * `detail.sessionId` names the session that was refused. A straggling request
 * from a session that already ended must not log out the one that replaced it.
 */
export const SESSION_EXPIRED_EVENT = 'fints:expired';
export type SessionExpiredDetail = { sessionId: string };

/** fetch itself threw: the local server is gone (crashed, restarting) or unreachable. */
const UNREACHABLE = 'Keine Verbindung zum lokalen Server. Bitte versuche es erneut.';

/**
 * Only calls made *within* a session can report its expiry. A 401 from a call
 * without one (connect, bank search, meta) would mean something else entirely,
 * so the session is read from the body rather than inferred from the path.
 */
function sessionOf(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const id = (payload as { sessionId?: unknown }).sessionId;
  return typeof id === 'string' && id ? id : null;
}

async function settle<T>(res: Response, payload?: unknown): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data as { error?: string }).error || `Fehler (${res.status})`;
    const sessionId = res.status === 401 ? sessionOf(payload) : null;
    if (sessionId && typeof window !== 'undefined') {
      // Dispatched before the throw, so the logout is already under way when
      // the caller's catch runs — a caller that checks whether its session is
      // still current then sees that it is not, and stays quiet.
      window.dispatchEvent(
        new CustomEvent<SessionExpiredDetail>(SESSION_EXPIRED_EVENT, { detail: { sessionId } }),
      );
    }
    throw new ApiError(message, res.status);
  }
  return data as T;
}

export async function post<T>(path: string, payload?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  } catch {
    // The browser's own "Failed to fetch" would land in a German UI verbatim.
    throw new ApiError(UNREACHABLE, 0);
  }
  return settle<T>(res, payload);
}

export async function get<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path);
  } catch {
    throw new ApiError(UNREACHABLE, 0);
  }
  return settle<T>(res);
}

// ---------------------------------------------------------------------------
// Preferences
//
// The packaged desktop app serves itself on a fresh random port at every start,
// and localStorage is per origin — so inside the shell it is effectively wiped
// on each restart. electron/preload.cjs therefore exposes a small synchronous
// key/value file in userData (keys `fints.*`, values up to 4 KB); everywhere
// else, localStorage is the store.
//
// Only preferences belong here: the last bank, the login name, theme, privacy,
// the idle limit. Anything personal (IBANs, templates, categories) goes into
// the encrypted vault instead.
// ---------------------------------------------------------------------------

type KeyValueStore = {
  get(key: string): string | null;
  set(key: string, value: string): void;
  del(key: string): void;
};

/** The desktop shell's preference file, or undefined in a plain browser. */
function shellStore(): KeyValueStore | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { electronStore?: KeyValueStore }).electronStore;
}

export const store = {
  get: (k: string): string | null => {
    const shell = shellStore();
    if (shell) {
      try {
        const v = shell.get(k);
        if (v != null) return v;
      } catch { /* bridge refused the key — fall back below */ }
    }
    // Also the migration path: values written to localStorage before the shell
    // had its own store (the dev shell runs on a fixed origin, so they survive)
    // are still found until the next `set` puts them in the file.
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set: (k: string, v: string): void => {
    const shell = shellStore();
    if (shell) {
      try {
        shell.set(k, v);
        return;
      } catch { /* refused (key shape, size) — keep it at least for this run */ }
    }
    try { localStorage.setItem(k, v); } catch { /* private mode */ }
  },
  del: (k: string): void => {
    // Both, so a stale localStorage copy cannot resurface through `get`.
    const shell = shellStore();
    if (shell) {
      try { shell.del(k); } catch { /* best effort */ }
    }
    try { localStorage.removeItem(k); } catch { /* private mode */ }
  },
};
