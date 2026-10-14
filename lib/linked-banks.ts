// Several banks in one view: which login a request for an account goes
// through, whether a further login's accounts can join the ones on screen,
// how the account list groups them, when their Gesamtsaldo is one — and what
// the vault keeps about a linked bank.
//
// The first login of a session is the primary one: its vault holds the
// personal data of the whole view. Every further bank is a login of its own
// on the server (its own session, its own PIN in memory, its own device
// profile), linked to the view by the browser alone.
//
// Accounts stay keyed by their account number, as everywhere else in the app
// (caches, aliases, sent orders, category keys). That is only safe while no
// number appears twice, so a bank whose accounts would collide with the ones
// already shown is refused as a whole (joinAccounts) — and every request
// names the session of the login that brought the account (routeFor), never
// a guess.
//
// Pure and dependency-free apart from sibling lib modules, so the
// `node --test` suite can run it under Node's own type stripping.

import { totalBalance, type TotalBalance } from './balances.ts';
import type { SerializedAccount, SerializedBalance } from './fints-types';

/**
 * What the primary login's vault remembers about a linked bank, so the next
 * login can offer it again: the BLZ, the bank's name and the login name.
 * Never a PIN, never an account — those come from the bank each time.
 */
export type LinkedBankRef = { blz: string; name: string; userId: string };

export const LINKED_BANK_LIMITS = {
  /** Banks beside the primary one. */
  count: 8,
  name: 120,
  /** FinTS allows 30 characters; some banks' login names run longer. */
  userId: 64,
};

const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Whether two logins are the same one: the same bank and the same login name. */
export const sameLogin = (a: { blz: string; userId: string }, b: { blz: string; userId: string }): boolean =>
  a.blz === b.blz && a.userId === b.userId;

/**
 * The linked banks as this version understands them: a BLZ of eight digits,
 * a name on one line, a login name exactly as typed — never clipped or
 * cleaned, since a different string is another login — each login once, at
 * most LINKED_BANK_LIMITS.count of them. Any other key (a PIN among them,
 * whatever wrote it) is dropped.
 */
export function sanitizeLinkedBanks(v: unknown): LinkedBankRef[] {
  const out: LinkedBankRef[] = [];
  for (const raw of Array.isArray(v) ? v : []) {
    if (!isRecord(raw)) continue;
    const blz = typeof raw.blz === 'string' ? raw.blz.trim() : '';
    if (!/^\d{8}$/.test(blz)) continue;
    const userId = typeof raw.userId === 'string' ? raw.userId.trim() : '';
    if (!userId || userId.length > LINKED_BANK_LIMITS.userId || CONTROLS.test(userId)) continue;
    const name = typeof raw.name === 'string'
      ? Array.from(raw.name.replace(new RegExp(CONTROLS, 'g'), ' ').replace(/\s+/g, ' ').trim())
        .slice(0, LINKED_BANK_LIMITS.name).join('').trimEnd()
      : '';
    if (!name) continue;
    const ref = { blz, name, userId };
    if (out.some((r) => sameLogin(r, ref))) continue;
    out.push(ref);
    if (out.length === LINKED_BANK_LIMITS.count) break;
  }
  return out;
}

/** `list` with `ref` remembered: added at the end, or its name brought up to date. */
export function rememberLinkedBank(list: readonly LinkedBankRef[], ref: LinkedBankRef): LinkedBankRef[] {
  const at = list.findIndex((r) => sameLogin(r, ref));
  if (at < 0) return sanitizeLinkedBanks([...list, ref]);
  if (list[at].name === ref.name) return [...list];
  return list.map((r, i) => (i === at ? { ...r, name: ref.name } : r));
}

/** `list` without that login. */
export const forgetLinkedBank = (list: readonly LinkedBankRef[], login: { blz: string; userId: string }): LinkedBankRef[] =>
  list.filter((r) => !sameLogin(r, login));

// ---------------------------------------------------------------------------
// Routing

/** A linked login as routing sees it: its session (null once it ended) and the accounts it brought. */
export type LoginRoute = { sessionId: string | null; accountNumbers: readonly string[] };

/**
 * The session a request about `accountNumber` must go through: the linked
 * login that brought the account — null while that login is logged out, so
 * the request is not sent at all — and the primary session for every other
 * account. Never another bank's session as a stand-in.
 */
export function routeFor(accountNumber: string, primary: string | null, links: readonly LoginRoute[]): string | null {
  for (const link of links) if (link.accountNumbers.includes(accountNumber)) return link.sessionId;
  return primary;
}

// ---------------------------------------------------------------------------
// Joining a further login's accounts

type Identified = Pick<SerializedAccount, 'accountNumber' | 'iban'>;

const ibanKey = (iban: string | null | undefined) => String(iban ?? '').replace(/\s+/g, '').toUpperCase();

export type Joined<A> = {
  /** What the new login adds to the view. */
  added: A[];
  /**
   * Accounts already on screen under the same number and IBAN: the same
   * account, seen by both logins (a joint account, a second login at the same
   * bank). It stays with the login that showed it first.
   */
  shared: A[];
  /** The same number as an account on screen, but not that account. Any one refuses the whole login. */
  collisions: Array<{ incoming: A; shown: A }>;
};

/** Sorts a further login's accounts against the ones on screen (see Joined). */
export function joinAccounts<A extends Identified>(shown: readonly A[], incoming: readonly A[]): Joined<A> {
  const byNumber = new Map(shown.map((a) => [a.accountNumber, a] as const));
  const joined: Joined<A> = { added: [], shared: [], collisions: [] };
  const seen = new Set<string>();
  for (const a of incoming) {
    if (seen.has(a.accountNumber)) continue;
    seen.add(a.accountNumber);
    const there = byNumber.get(a.accountNumber);
    if (!there) joined.added.push(a);
    else if (ibanKey(a.iban) && ibanKey(a.iban) === ibanKey(there.iban)) joined.shared.push(a);
    else joined.collisions.push({ incoming: a, shown: there });
  }
  return joined;
}

// ---------------------------------------------------------------------------
// Grouping and the Gesamtsaldo across banks

/** One bank's accounts, in list order: the primary login first (`id` null), then each linked one. */
export type LoginGroup<A> = { id: string | null; accounts: A[] };

export function groupByLogin<A extends Pick<SerializedAccount, 'accountNumber'>>(
  accounts: readonly A[],
  links: ReadonlyArray<{ id: string; accountNumbers: readonly string[] }>,
): LoginGroup<A>[] {
  const owner = new Map<string, string>();
  for (const link of links) for (const n of link.accountNumbers) if (!owner.has(n)) owner.set(n, link.id);
  const groups: LoginGroup<A>[] = [{ id: null, accounts: [] }, ...links.map((l) => ({ id: l.id, accounts: [] as A[] }))];
  for (const a of accounts) {
    const id = owner.get(a.accountNumber) ?? null;
    groups.find((g) => g.id === id)!.accounts.push(a);
  }
  return groups;
}

export type CombinedTotal<A> = TotalBalance<A> & {
  /** Linked banks that are not logged in, whose accounts are not even listed. */
  absent: string[];
};

/**
 * The Gesamtsaldo over every bank in the view. As for one bank
 * (totalBalance): euros only, never a partial sum. A linked bank that is not
 * logged in counts as missing as a whole — its accounts are not listed, so a
 * sum of the rest is not the total either. A bank logged out during the
 * session keeps its accounts, and their balances count as long as they are
 * known.
 */
export function combinedTotal<A extends Pick<SerializedAccount, 'accountNumber' | 'currency' | 'canStatements' | 'canBalance'>>(
  accounts: readonly A[],
  balances: Readonly<Record<string, Pick<SerializedBalance, 'balance' | 'currency'> | null | undefined>>,
  absent: readonly string[] = [],
): CombinedTotal<A> {
  const total = totalBalance(accounts, balances);
  return { ...total, cents: absent.length ? null : total.cents, absent: [...absent] };
}
