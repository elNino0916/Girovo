// Fingerprint login (opt-in, Einstellungen → "Mit Fingerabdruck anmelden").
//
// Turning it on seals the PIN of the session's login — and the PINs of the
// further banks logged in beside it — with a Keystore key that only a
// fingerprint opens (GirovoBiometric). The PINs are taken from the live
// sessions, asked of the phone server that keeps them (lib/session.ts,
// lib-fints' config; mobile/server/logins.ts) — so they never pass through
// the page's own state on the way. A further bank logged in later is sealed
// beside them the same way, after a fingerprint of its own (seal).
//
// Logging in with it hands the PIN to the login form's connect(), exactly as
// if it had been typed, and the further banks' PINs to the provider, which
// logs them in one after another. Should a bank refuse one (the PIN was
// changed at the bank), the page calls forget(): a stale PIN must never be
// tried twice, because a few wrong tries lock the online banking. The check
// for new Umsätze cannot call it (mobile/background/entry.ts): it leaves a
// note instead, and BiometricPlugin drops the copies stored before the note
// rather than hand one out — here that reads as a login with no fingerprint
// login (any more), and the PIN is typed.
//
// A login is named by a hash of BLZ and login name, like the device profile's
// file (lib/state-store.ts), so the stored entries say nothing about whose
// they are. Whose a further bank's PIN is — BLZ and login name — is sealed
// with it.

import { GirovoBiometric, type BiometricItem, type BiometricState } from '../native';
import type { LiveLogin, SealedLogin } from '../server/logins';
import { fingerprintIdOf as idOf } from '../background/fingerprint-id';
import { serverCall } from '../worker/host';
import { VERIFY_WAIT_MS, loginsVerified } from './sealing-wait';

export type { SealedLogin };

export type PromptTexts = { title: string; subtitle: string; cancel: string };

/** The logins of live sessions, with their PINs, in order; null for a session that is gone. */
function loginsOf(sessionIds: readonly string[]): Promise<(LiveLogin | null)[]> {
  return serverCall<(LiveLogin | null)[]>('logins', [...sessionIds]).catch(() => sessionIds.map(() => null));
}

/**
 * One login as it is sealed: BLZ, login name and PIN. `verified` rides
 * beside it, never in it: whether the bank took that PIN, which alone lets it
 * settle a note about the login (BiometricPlugin.java).
 */
const itemOf = (l: LiveLogin): BiometricItem => ({
  id: idOf(l.blz, l.userId),
  secret: JSON.stringify({ blz: l.blz, userId: l.userId, pin: l.pin } satisfies SealedLogin),
  verified: l.verified,
});

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

/**
 * `on`: a fingerprint opens this login's PIN, sealed for it or as a further
 * bank of another login. `dropped`: it did until now, and the PIN went because
 * the bank had turned it down in the check for new Umsätze. The login form
 * asks this, and says so: once, so it is taken here (`consume`) and nowhere else.
 */
export async function enrolled(blz: string, userId: string): Promise<{ on: boolean; dropped: boolean }> {
  try {
    const { enrolled: own, held, dropped } = await GirovoBiometric.has({ id: idOf(blz, userId), consume: true });
    return { on: own || held, dropped: dropped === true };
  } catch {
    return { on: false, dropped: false };
  }
}

/** Whether fingerprint login is on for this login itself — its switch. A drop it finds is left for the login form to say. */
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
): Promise<'enrolled' | 'canceled' | 'failed' | 'notYet'> {
  // The login's own PIN only once the bank has taken it: a remembered device
  // opens with an old one too. Turned on right after the login, its first
  // answer may still be on the way: waited for a moment.
  const [own, ...others] = await loginsVerified([sessionId, ...linkedSessionIds], VERIFY_WAIT_MS.enroll, loginsOf);
  if (!own) return 'failed';
  if (!own.verified) return 'notYet';
  const linked = others.filter((l): l is LiveLogin => !!l);
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
  // A further bank opened on its remembered device is asked right after it
  // joined (FintsProvider offerSeal), before the bank has answered for it:
  // the prompt waits for that answer. One still not checked after the wait is
  // sealed too, but marked: it settles no note.
  const [own, ...others] = await loginsVerified([sessionId, ...linkedSessionIds], VERIFY_WAIT_MS.seal, loginsOf);
  // Logged out meanwhile: nothing to say.
  if (!own) return 'off';
  const linked = others.filter((l): l is LiveLogin => !!l);
  if (!own.verified || !linked.length) return 'failed';
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
