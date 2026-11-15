// The page's side of the profile above all banks (Girovo 7 on the desktop,
// lib/profile.ts, app/api/profile): which bank logs in first after an
// unlock, which banks a new profile begins with, and how the banks the
// profile knows show up in the list. Pure, so `node --test` runs it.

import { rememberLinkedBank, sameLogin, type LinkedBankRef } from './linked-banks.ts';

/** The shortest password a profile takes (lib/profile.ts PROFILE_LIMITS reads it from here). */
export const PROFILE_PASSWORD_MIN = 8;

/** How the profile stands, as the page knows it. `served`: this app keeps a profile at all (the desktop). */
/** `checked`: the app has asked (served or not); until then the login waits. */
export type ProfileInfo = {
  served: boolean; exists: boolean; name: string; hello: boolean; open: boolean; damaged?: boolean; checked?: boolean;
  /** The picture the unlock screen shows (lib/profile.ts ProfileFace). */
  face?: { avatar: string; image?: string };
  /** The security keys that open it, and the salt the shell hands the reader (lib/profile.ts). */
  keys?: { id: string; credential: string; added: string; name?: string }[];
  keySalt?: string;
};

/** How the unlock screen opens the profile: the password typed, Windows Hello, or a security key. */
export type UnlockWay = { password: string } | { via: 'hello' | 'key' };

/** Before the page asked: nothing is shown for a profile. */
export const NO_PROFILE: ProfileInfo = { served: false, exists: false, name: '', hello: false, open: false };

/** A bank as the unlock hands it over. */
export type UnlockedBank = LinkedBankRef & { pin?: string };

/** A bank and its PIN, as the further banks' chain takes them (FintsProvider openedLinkedRef). */
export type PinnedLogin = { blz: string; userId: string; pin: string };

/**
 * After an unlock: the bank the app logs in to first (the first one with a
 * PIN, in the profile's order), the ones with a PIN that follow it, and,
 * when no bank has a PIN, the one whose login form comes up instead.
 */
export function loginPlan(banks: readonly UnlockedBank[]): { first: UnlockedBank | null; rest: PinnedLogin[]; typed: UnlockedBank | null } {
  const pinned = banks.filter((b): b is UnlockedBank & { pin: string } => !!b.pin);
  if (!pinned.length) return { first: null, rest: [], typed: banks[0] ?? null };
  const [first, ...rest] = pinned;
  return { first, rest: rest.map(({ blz, userId, pin }) => ({ blz, userId, pin })), typed: null };
}

/**
 * The banks a new profile begins with, in the order the view shows them: the
 * bank the app opened with, the further ones logged in, then the ones
 * remembered but not logged in now. Each login once.
 */
export function startingOrder(
  first: LinkedBankRef, links: readonly LinkedBankRef[], remembered: readonly LinkedBankRef[],
): LinkedBankRef[] {
  const out: LinkedBankRef[] = [];
  for (const ref of [first, ...links, ...remembered]) {
    if (!out.some((r) => sameLogin(r, ref))) out.push(ref);
  }
  return out;
}

/**
 * The vault's list of further banks with every bank of the profile in it but
 * the one the app logged in to: so each one shows as a bank to log in to, and
 * the chain after the unlock finds it. Null when nothing is missing.
 */
export function withProfileBanks(
  linked: readonly LinkedBankRef[], profile: readonly LinkedBankRef[], first: { blz: string; userId: string },
): LinkedBankRef[] | null {
  let next = [...linked];
  for (const bank of profile) {
    if (sameLogin(bank, first) || next.some((r) => sameLogin(r, bank))) continue;
    const { blz, name, userId, accounts } = bank;
    next = rememberLinkedBank(next, { blz, name, userId, ...(accounts?.length ? { accounts } : {}) });
  }
  return next.length === linked.length ? null : next;
}

/** The first person of a holder's name, as a profile's name to start from ("Max Mustermann" stays). */
export function suggestedName(holder: string): string {
  return holder.trim().replace(/\s+/g, ' ').slice(0, 40).trimEnd();
}
