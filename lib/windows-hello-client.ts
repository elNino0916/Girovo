// The page's side of Windows Hello on the desktop (lib/windows-hello.ts):
// the shell turns a gesture into a key (window.electronHello), the server
// keeps the first login's PIN under that key and the shell's secret
// (window.electronLinkedUnlock). The login form opens the PIN with it, the
// provider seals and forgets it. Undefined everywhere but the desktop shell.

import { post } from './client-api.ts';
import { IS_ANDROID } from './platform.ts';

type Login = { blz: string; userId: string };

/**
 * What Windows threw that means its Windows Hello key storage is missing or
 * damaged (NTE_NOT_FOUND, NTE_BAD_KEYSET): no app can make or use a key
 * then. Setting the Windows Hello PIN up again in Windows mends it.
 */
const BROKEN_STORE = new Set(['0x80090011', '0x80090016']);

/** Whether the code Windows threw says its Windows Hello storage needs mending (in Windows, not here). */
export function helloStoreBroken(code: string | undefined): boolean {
  return code !== undefined && BROKEN_STORE.has(code);
}

/** The shell's Windows Hello, where there is one (never on Android, never in a browser). */
export function helloShell(): NonNullable<Window['electronHello']> | null {
  if (IS_ANDROID || typeof window === 'undefined') return null;
  return window.electronHello && window.electronLinkedUnlock ? window.electronHello : null;
}

const secret = (): Promise<string | null> =>
  window.electronLinkedUnlock?.secret().catch(() => null) ?? Promise.resolve(null);

/** Whether Windows Hello is set up on this Windows — false outside the shell, and when asking fails. */
export async function helloAvailable(): Promise<boolean> {
  const shell = helloShell();
  return shell ? shell.available().catch(() => false) : false;
}

/** Whether the login opens with Windows Hello here. */
export async function helloOn(login: Login): Promise<boolean> {
  if (!helloShell()) return false;
  try {
    const r = await post<{ on: boolean }>('/api/windows-hello', { op: 'status', login });
    return r.on === true;
  } catch {
    return false;
  }
}

/**
 * The login's PIN after the gesture. 'gone': it cannot open any more (the
 * Windows Hello key changed) and was deleted; 'off': nothing kept for it.
 */
export async function openWithHello(login: Login): Promise<
  { result: 'opened'; pin: string } | { result: 'canceled' | 'gone' | 'off' } | { result: 'failed'; code?: string }
> {
  const shell = helloShell();
  if (!shell) return { result: 'off' };
  const gesture = await shell.unlock().catch(() => ({ result: 'failed' as const, key: undefined, code: undefined }));
  if (gesture.result === 'invalidated' || gesture.result === 'missing') {
    // No key opens the kept PIN any more: it goes too.
    await forgetHello(login);
    return { result: gesture.result === 'invalidated' ? 'gone' : 'off' };
  }
  if (gesture.result === 'canceled') return { result: 'canceled' };
  if (gesture.result !== 'unlocked' || !gesture.key) return { result: 'failed', code: gesture.code };
  const s = await secret();
  if (!s) return { result: 'failed' };
  try {
    const r = await post<{ pin?: string; on?: boolean; dropped?: boolean }>(
      '/api/windows-hello', { op: 'open', login, key: gesture.key, secret: s },
    );
    if (typeof r.pin === 'string' && r.pin) return { result: 'opened', pin: r.pin };
    return { result: r.dropped ? 'gone' : 'off' };
  } catch {
    return { result: 'failed' };
  }
}

/**
 * Keeps the session's PIN for Windows Hello, after the gesture (the first
 * time Windows sets the key up too). The server takes it only once the bank
 * has taken it; its answer otherwise comes back as the thrown message.
 * `code`: what Windows threw, where it did.
 */
export async function sealWithHello(sessionId: string): Promise<{ result: 'sealed' | 'canceled' | 'failed'; code?: string }> {
  const shell = helloShell();
  if (!shell) return { result: 'failed' };
  const gesture = await shell.enroll().catch(() => ({ result: 'failed' as const, key: undefined, code: undefined }));
  if (gesture.result === 'canceled') return { result: 'canceled' };
  if (gesture.result !== 'enrolled' || !gesture.key) return { result: 'failed', code: gesture.code };
  const s = await secret();
  if (!s) return { result: 'failed' };
  await post('/api/windows-hello', { op: 'seal', sessionId, key: gesture.key, secret: s });
  return { result: 'sealed' };
}

/** Deletes what is kept for the login (off, a refused PIN, a key that changed). */
export async function forgetHello(login: Login): Promise<void> {
  if (!helloShell()) return;
  await post('/api/windows-hello', { op: 'forget', login }).catch(() => {});
}
