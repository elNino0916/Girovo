// Fingerprint login (opt-in, Sitzung panel → "Mit Fingerabdruck anmelden").
//
// Turning it on seals the PIN of the session's login with a Keystore key that
// only a fingerprint opens (GirovoBiometric). The PIN is taken from the live
// session here, inside the phone runtime — the same place the route handlers
// keep it (lib/session.ts, lib-fints' config) — so it never passes through
// the page's own state on the way.
//
// Logging in with it hands the PIN to the login form's connect(), exactly as
// if it had been typed. Should the bank refuse it (the PIN was changed at the
// bank), the page calls forget(): a stale PIN must never be tried twice,
// because a few wrong tries lock the online banking.
//
// A login is named by a hash of BLZ and login name, like the device profile's
// file (lib/state-store.ts), so the stored entries say nothing about whose they are.

import { getSession } from '../../lib/session.ts';
import { GirovoBiometric, type BiometricState } from '../native';
import { createHash } from '../shims/crypto';

const idOf = (blz: string, userId: string) => createHash('sha256').update(`${blz}|${userId}|biometric`).digest('hex').slice(0, 32);

export type PromptTexts = { title: string; subtitle: string; cancel: string };

export async function state(): Promise<BiometricState> {
  try {
    return await GirovoBiometric.state();
  } catch {
    return { available: false, reason: 'unavailable' };
  }
}

export async function enrolled(blz: string, userId: string): Promise<boolean> {
  try {
    return (await GirovoBiometric.has({ id: idOf(blz, userId) })).enrolled;
  } catch {
    return false;
  }
}

/** Seals the PIN of `sessionId`'s login behind a fingerprint. */
export async function enroll(sessionId: string, texts: PromptTexts): Promise<'enrolled' | 'canceled' | 'failed'> {
  const s = getSession(sessionId);
  const blz = s?.meta?.blz;
  const userId = s?.client?.config?.userId;
  const pin = s?.client?.config?.pin;
  if (!blz || !userId || !pin) return 'failed';
  try {
    const { result } = await GirovoBiometric.enroll({ id: idOf(String(blz), String(userId)), secret: String(pin), ...texts });
    return result;
  } catch {
    return 'failed';
  }
}

/** The PIN, after a fingerprint — or why there is none. */
export async function unlock(
  blz: string,
  userId: string,
  texts: PromptTexts,
): Promise<{ result: 'unlocked' | 'canceled' | 'invalidated' | 'missing'; pin?: string }> {
  try {
    const { result, secret } = await GirovoBiometric.unlock({ id: idOf(blz, userId), ...texts });
    return { result, pin: secret };
  } catch {
    return { result: 'canceled' };
  }
}

export async function forget(blz: string, userId: string): Promise<void> {
  await GirovoBiometric.remove({ id: idOf(blz, userId) }).catch(() => {});
}
