// The page's side of security keys on the desktop (lib/security-key.ts): the
// shell turns a touch into a key (window.electronSecurityKey), the server
// keeps the first login's PIN under that key and the shell's secret. The login
// form opens the PIN with it, the provider seals and forgets it. Undefined
// everywhere but the desktop shell.

import { post } from './client-api.ts';
import { IS_ANDROID } from './platform.ts';

type Login = { blz: string; userId: string };

/** One key of a login, as the settings list it. */
export type SecurityKeyInfo = { id: string; added: string };

type Status = { keys: Array<SecurityKeyInfo & { credential: string }>; salt: string };

/** The shell's security keys, where there are any (never on Android, never in a browser). */
export function securityKeyShell(): NonNullable<Window['electronSecurityKey']> | null {
  if (IS_ANDROID || typeof window === 'undefined') return null;
  return window.electronSecurityKey && window.electronLinkedUnlock ? window.electronSecurityKey : null;
}

const secret = (): Promise<string | null> =>
  window.electronLinkedUnlock?.secret().catch(() => null) ?? Promise.resolve(null);

const status = (login: Login) => post<Status>('/api/security-key', { op: 'status', login });

const brief = (keys: SecurityKeyInfo[]): SecurityKeyInfo[] => keys.map(({ id, added }) => ({ id, added }));

/** Whether this Windows can use a security key — false outside the shell, and when asking fails. */
export async function securityKeyAvailable(): Promise<boolean> {
  const shell = securityKeyShell();
  return shell ? shell.available().catch(() => false) : false;
}

/** The login's keys; null where the shell has none or asking failed. */
export async function securityKeysOf(login: Login): Promise<SecurityKeyInfo[] | null> {
  if (!securityKeyShell()) return null;
  try {
    return brief((await status(login)).keys);
  } catch {
    return null;
  }
}

/** An earlier openWithSecurityKey has its touch and is opening the PIN with it. */
let openingPin = false;

/**
 * The login's PIN after the touch. 'gone': this key no longer opens it (it
 * was reset) and its copy was deleted; 'off': nothing kept; 'busy': an earlier
 * request is still at it; 'wrong': the key in the reader is not one of this login's.
 */
export async function openWithSecurityKey(login: Login): Promise<
  { result: 'opened'; pin: string } | { result: 'canceled' | 'gone' | 'off' | 'busy' | 'wrong' } | { result: 'failed'; code?: string }
> {
  const shell = securityKeyShell();
  if (!shell) return { result: 'off' };
  if (openingPin) return { result: 'busy' };
  let known: Status;
  try {
    known = await status(login);
  } catch {
    return { result: 'failed' };
  }
  if (!known.keys.length) return { result: 'off' };
  const touch = await shell.open(known.salt, known.keys.map((k) => k.credential)).catch(() => ({ result: 'failed' as const, credential: undefined, key: undefined, code: undefined }));
  if (touch.result === 'busy' || touch.result === 'canceled' || touch.result === 'wrong') return { result: touch.result };
  if (touch.result !== 'opened' || !touch.key || !touch.credential) return { result: 'failed', code: touch.code };
  openingPin = true;
  try {
    const s = await secret();
    if (!s) return { result: 'failed' };
    const r = await post<{ pin?: string; on?: boolean; dropped?: boolean }>(
      '/api/security-key', { op: 'open', login, credential: touch.credential, key: touch.key, secret: s },
    );
    if (typeof r.pin === 'string' && r.pin) return { result: 'opened', pin: r.pin };
    return { result: r.dropped ? 'gone' : 'off' };
  } catch {
    return { result: 'failed' };
  } finally {
    openingPin = false;
  }
}

/**
 * Keeps the session's PIN under one more key, after two touches. The server
 * takes it only once the bank has taken it; its answer otherwise comes back
 * as the thrown message. A key already set up for the login answers 'exists'.
 */
export async function addSecurityKey(sessionId: string, login: Login): Promise<
  { result: 'added'; keys: SecurityKeyInfo[] } | { result: 'canceled' | 'exists' | 'unsupported' | 'busy' } | { result: 'failed'; code?: string }
> {
  const shell = securityKeyShell();
  if (!shell) return { result: 'failed' };
  const known = await status(login);
  const made = await shell.register(known.salt, known.keys.map((k) => k.credential)).catch(() => ({ result: 'failed' as const, credential: undefined, key: undefined, code: undefined }));
  if (made.result === 'canceled' || made.result === 'exists' || made.result === 'unsupported' || made.result === 'busy') return { result: made.result };
  if (made.result !== 'registered' || !made.key || !made.credential) return { result: 'failed', code: made.code };
  const s = await secret();
  if (!s) return { result: 'failed' };
  const r = await post<{ keys: SecurityKeyInfo[] }>('/api/security-key', { op: 'seal', sessionId, credential: made.credential, key: made.key, secret: s });
  return { result: 'added', keys: brief(r.keys) };
}

/** One key goes; answers the keys left. */
export async function removeSecurityKey(login: Login, id: string): Promise<SecurityKeyInfo[]> {
  const r = await post<{ keys: SecurityKeyInfo[] }>('/api/security-key', { op: 'forget', login, id });
  return brief(r.keys);
}

/** Every key of the login goes (a refused PIN, a key that changed). */
export async function forgetSecurityKeys(login: Login): Promise<void> {
  if (!securityKeyShell()) return;
  await post('/api/security-key', { op: 'forget', login }).catch(() => {});
}
