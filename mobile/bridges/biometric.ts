// Fingerprint login (opt-in, Einstellungen → "Mit Fingerabdruck anmelden").
//
// Turning it on seals the PIN of the session's login — and the PINs of the
// further banks logged in beside it — with a Keystore key that only a
// fingerprint opens (GirovoBiometric). The PINs are taken from the live
// sessions here, inside the phone runtime — the same place the route
// handlers keep them (lib/session.ts, lib-fints' config) — so they never pass
// through the page's own state on the way. A further bank logged in later is
// sealed beside them the same way, after a fingerprint of its own (seal).
//
// Logging in with it hands the PIN to the login form's connect(), exactly as
// if it had been typed, and the further banks' PINs to the provider, which
// logs them in one after another. Should a bank refuse one (the PIN was
// changed at the bank), the page calls forget(): a stale PIN must never be
// tried twice, because a few wrong tries lock the online banking.
//
// A login is named by a hash of BLZ and login name, like the device profile's
// file (lib/state-store.ts), so the stored entries say nothing about whose
// they are. Whose a further bank's PIN is — BLZ and login name — is sealed
// with it.

import { getSession } from '../../lib/session.ts';
import { GirovoBiometric, type BiometricItem, type BiometricState } from '../native';
import { createHash } from '../shims/crypto';

const idOf = (blz: string, userId: string) => createHash('sha256').update(`${blz}|${userId}|biometric`).digest('hex').slice(0, 32);

export type PromptTexts = { title: string; subtitle: string; cancel: string };

/** A sealed login, as a fingerprint opens it. */
export type SealedLogin = { blz: string; userId: string; pin: string };

/** The login of a live session, with its PIN; null once the session is gone. */
function loginOf(sessionId: string): SealedLogin | null {
  const s = getSession(sessionId);
  const blz = s?.meta?.blz;
  const userId = s?.client?.config?.userId;
  const pin = s?.client?.config?.pin;
  return blz && userId && pin ? { blz: String(blz), userId: String(userId), pin: String(pin) } : null;
}

const itemOf = (l: SealedLogin): BiometricItem => ({ id: idOf(l.blz, l.userId), secret: JSON.stringify(l) });

/** An item as it was sealed — only when it is the login its name says. */
function readItem(item: BiometricItem): SealedLogin | null {
  try {
    const v = JSON.parse(item.secret) as Partial<SealedLogin>;
    if (typeof v.blz !== 'string' || typeof v.userId !== 'string' || typeof v.pin !== 'string' || !v.pin) return null;
    return idOf(v.blz, v.userId) === item.id ? { blz: v.blz, userId: v.userId, pin: v.pin } : null;
  } catch {
    return null;
  }
}

export async function state(): Promise<BiometricState> {
  try {
    return await GirovoBiometric.state();
  } catch {
    return { available: false, reason: 'unavailable' };
  }
}

/** Whether a fingerprint opens this login's PIN: sealed for it, or as a further bank of another login. */
export async function enrolled(blz: string, userId: string): Promise<boolean> {
  try {
    const { enrolled: own, held } = await GirovoBiometric.has({ id: idOf(blz, userId) });
    return own || held;
  } catch {
    return false;
  }
}

/** Whether fingerprint login is on for this login itself — its switch. */
export async function isOn(blz: string, userId: string): Promise<boolean> {
  try {
    return (await GirovoBiometric.has({ id: idOf(blz, userId) })).enrolled;
  } catch {
    return false;
  }
}

/** Seals the PIN of `sessionId`'s login, and those of the further banks' sessions beside it, behind a fingerprint. */
export async function enroll(
  sessionId: string,
  linkedSessionIds: readonly string[],
  texts: PromptTexts,
): Promise<'enrolled' | 'canceled' | 'failed'> {
  const own = loginOf(sessionId);
  if (!own) return 'failed';
  const linked = linkedSessionIds.map(loginOf).filter((l): l is SealedLogin => !!l);
  try {
    const { result } = await GirovoBiometric.enroll({ id: idOf(own.blz, own.userId), items: [own, ...linked].map(itemOf), ...texts });
    return result;
  } catch {
    return 'failed';
  }
}

/**
 * Seals the PINs of further banks' sessions beside `sessionId`'s login, after
 * a fingerprint. `off`: the login has no fingerprint login (any more).
 */
export async function seal(
  sessionId: string,
  linkedSessionIds: readonly string[],
  texts: PromptTexts,
): Promise<'sealed' | 'canceled' | 'failed' | 'off'> {
  const own = loginOf(sessionId);
  const linked = linkedSessionIds.map(loginOf).filter((l): l is SealedLogin => !!l);
  if (!own || !linked.length) return 'failed';
  try {
    // The login's own PIN goes along: an entry of the old form takes it in as an item.
    const { result } = await GirovoBiometric.seal({ id: idOf(own.blz, own.userId), items: [own, ...linked].map(itemOf), ...texts });
    return result === 'missing' || result === 'invalidated' ? 'off' : result;
  } catch {
    return 'failed';
  }
}

/** The PIN, after a fingerprint — with the further banks' kept beside it — or why there is none. */
export async function unlock(
  blz: string,
  userId: string,
  texts: PromptTexts,
): Promise<{ result: 'unlocked' | 'canceled' | 'invalidated' | 'missing'; pin?: string; linked?: SealedLogin[] }> {
  try {
    const { result, secret, items } = await GirovoBiometric.unlock({ id: idOf(blz, userId), ...texts });
    if (result !== 'unlocked' || secret == null) return { result: result === 'unlocked' ? 'missing' : result };
    // An entry of the old form holds the bare PIN, and nothing beside it.
    if (!items) return { result, pin: secret };
    const own = readItem({ id: idOf(blz, userId), secret });
    if (!own) return { result: 'missing' };
    const linked = items.map(readItem).filter((l): l is SealedLogin => !!l);
    return { result, pin: own.pin, linked };
  } catch {
    return { result: 'canceled' };
  }
}

/** Everything sealed for this login, and its PIN wherever it is kept beside another login. */
export async function forget(blz: string, userId: string): Promise<void> {
  await GirovoBiometric.remove({ id: idOf(blz, userId) }).catch(() => {});
}

/** "Bank entfernen": a further bank's PIN kept beside this login's. */
export async function forgetLinked(blz: string, userId: string, linkedBlz: string, linkedUserId: string): Promise<void> {
  await GirovoBiometric.remove({ id: idOf(blz, userId), item: idOf(linkedBlz, linkedUserId) }).catch(() => {});
}
