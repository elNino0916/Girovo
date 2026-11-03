// The Konten overview (issue #19): the Übersicht's start once there is more
// than one account. Which group an account belongs to, the order and grouping
// the user chose for them ("Konten anordnen", kept in the vault), and the
// figures over all of them — Gesamtsaldo, Vermögen, Verbindlichkeiten and
// each group's sum.
//
// The rules of a Gesamtsaldo stay those of lib/balances.ts: euros only, a
// balance never fetched is not zero, and a total of some accounts is a
// different number — so a figure is only given once every account it is
// about is known. A Depot counts with the value its holdings were last read
// at; one not read yet is left out and named, as before.
//
// Pure and node-test-safe: no path aliases, `.ts` on sibling imports.

import { canReportBalance, isCardAccount, isDepot } from './balances.ts';
import type { SerializedAccount } from './fints-types';

/** The overview's groups, in the order a Kontenübersicht lists them. */
export type AccountGroupKind = 'giro' | 'saving' | 'credit' | 'other';
export const GROUP_KINDS: readonly AccountGroupKind[] = ['giro', 'saving', 'credit', 'other'];

/** How "Konten anordnen" groups the accounts: by kind (the default), by bank, or not at all. */
export type AccountGrouping = 'type' | 'bank' | 'none';
export const GROUPINGS: readonly AccountGrouping[] = ['type', 'bank', 'none'];

/** The most account numbers an order keeps — the vault's cap for aliases, for the same accounts. */
export const MAX_ORDER = 50;

const SAVING_TYPES = new Set(['SavingsAccount', 'FixedDepositAccount', 'SecuritiesAccount', 'InvestmentCompanyFund', 'HomeSavingsContract']);

/**
 * An account's group, by its FinTS Kontoart (lib-fints' names, or the bare
 * number) and never by its product name, as for a card (lib/balances.ts):
 *
 *   1–9    Girokonten (Kontokorrent)
 *   10–39  Sparen & Anlegen: Spar- und Festgeld, Depots
 *   40–59  Karten & Kredite: Kredite und Darlehen, Kreditkarten
 *   60–79  Sparen & Anlegen: Fonds, Bausparverträge
 *   80–99  Weitere: Versicherungen, Sonstiges
 *
 * A Depot whose holdings stand in for Umsätze is "Sparen & Anlegen"
 * whatever its Kontoart says.
 */
export function groupKindOf(a: Pick<SerializedAccount, 'accountType' | 'canStatements' | 'canPortfolio'>): AccountGroupKind {
  if (isDepot(a)) return 'saving';
  if (isCardAccount(a)) return 'credit';
  const t = String(a.accountType ?? '').trim();
  if (t === 'CheckingAccount') return 'giro';
  if (t === 'LoanMortgageAccount') return 'credit';
  if (SAVING_TYPES.has(t)) return 'saving';
  if (/^\d{1,2}$/.test(t)) {
    const n = Number(t);
    if (n < 10) return 'giro';
    if (n < 40 || (n >= 60 && n < 80)) return 'saving';
    if (n < 60) return 'credit';
  }
  return 'other';
}

/** The order kept in the vault, cleaned: account keys only, each once, within the cap. */
export function sanitizeAccountOrder(input: unknown, maxKey = 64): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const n of input) {
    if (typeof n !== 'string' || !n || n.length > maxKey) continue;
    seen.add(n);
    if (seen.size >= MAX_ORDER) break;
  }
  return [...seen];
}

export const isGrouping = (v: unknown): v is AccountGrouping => GROUPINGS.includes(v as AccountGrouping);

/**
 * The accounts in the user's order: those the order names by their place in
 * it, every other one after them in the order the banks listed them — an
 * account that joins later turns up at the end, never in the middle.
 */
export function orderAccounts<A extends Pick<SerializedAccount, 'accountNumber'>>(
  accounts: readonly A[],
  order: readonly string[] | null | undefined,
): A[] {
  if (!order?.length) return [...accounts];
  const rank = new Map(order.map((n, i) => [n, i]));
  return accounts
    .map((a, i) => ({ a, i, r: rank.get(a.accountNumber) ?? Number.POSITIVE_INFINITY }))
    .sort((x, y) => x.r - y.r || x.i - y.i)
    .map((x) => x.a);
}

/**
 * Moves one account within its group. `order` is every account in the order
 * shown, `members` the group's accounts in that order (a subset of it);
 * `from` and `to` are places inside the group. The group's places in the
 * whole order stay where they were and take the group's new sequence, so an
 * account never leaves its group and the other groups do not move.
 */
export function moveAccount(order: readonly string[], members: readonly string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= members.length || to >= members.length) return [...order];
  const next = [...members];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  const inGroup = new Set(members);
  let k = 0;
  return order.map((n) => (inGroup.has(n) ? next[k++] : n));
}

export type AccountGroup<A> = {
  /** 'giro' … for a kind, the bank's key for a bank, 'all' without grouping. */
  key: string;
  kind: AccountGroupKind | null;
  accounts: A[];
};

/**
 * The accounts under their groups, each group in the given order of
 * accounts. By kind in the fixed sequence (Girokonten first), by bank in the
 * order of `banks` (the primary login first); a group with no account is
 * left out.
 */
export function groupAccounts<A>(
  ordered: readonly A[],
  grouping: AccountGrouping,
  how: { kindOf: (a: A) => AccountGroupKind; bankOf: (a: A) => string; banks: readonly string[] },
): AccountGroup<A>[] {
  if (grouping === 'none') return ordered.length ? [{ key: 'all', kind: null, accounts: [...ordered] }] : [];
  if (grouping === 'type') {
    return GROUP_KINDS
      .map((kind) => ({ key: kind, kind, accounts: ordered.filter((a) => how.kindOf(a) === kind) }))
      .filter((g) => g.accounts.length > 0);
  }
  const keys = [...how.banks, ...ordered.map(how.bankOf).filter((k) => !how.banks.includes(k))];
  return [...new Set(keys)]
    .map((key) => ({ key, kind: null, accounts: ordered.filter((a) => how.bankOf(a) === key) }))
    .filter((g) => g.accounts.length > 0);
}

/**
 * What the overview knows of one account's figure:
 *   known    the balance (a Depot: its value at the last read), in cents
 *   missing  the bank can report it, and this session does not know it yet
 *            (or the read failed)
 *   unread   a Depot whose holdings were not read yet
 *   never    the bank reports no figure for it over FinTS
 */
export type AccountValue =
  | { state: 'known'; cents: number; currency: string; /** From an earlier session (lib/kept-balances.ts). */ kept?: true }
  | { state: 'missing'; currency: string }
  | { state: 'unread' }
  | { state: 'never' };

/**
 * What this session read of an account's figure: its balance, or a Depot's
 * value at the last read of its holdings.
 */
export function liveValue(
  a: Pick<SerializedAccount, 'currency' | 'canStatements' | 'canBalance' | 'canPortfolio'>,
  balance: { balance: number; currency?: string | null } | null | undefined,
  portfolio: { totalValue: number | null; currency?: string | null } | null | undefined,
): AccountValue {
  if (isDepot(a)) {
    if (portfolio?.totalValue != null) return { state: 'known', cents: Math.round(portfolio.totalValue * 100), currency: portfolio.currency || 'EUR' };
    // Read, but the bank stated no total: nothing to add, for good.
    return portfolio ? { state: 'never' } : { state: 'unread' };
  }
  if (balance) return { state: 'known', cents: Math.round(balance.balance * 100), currency: balance.currency || a.currency || 'EUR' };
  return canReportBalance(a) ? { state: 'missing', currency: a.currency || 'EUR' } : { state: 'never' };
}

export type OverviewFigures<A> = {
  /** Accounts whose euro figure the total is about. */
  counted: A[];
  /** Counted accounts whose figure is not known yet: they keep every figure open. */
  missing: A[];
  /** Accounts that do not count, and why — each named under the total. */
  excluded: Array<{ account: A; reason: 'unsupported' | 'currency' | 'unread'; currency: string }>;
  /** The Gesamtsaldo in cents, once complete. */
  total: number | null;
  /** The sum of the positive figures (Vermögen), once complete. */
  assets: number | null;
  /** The sum of the negative figures (Verbindlichkeiten, negative), once complete. */
  liabilities: number | null;
};

/**
 * Gesamtsaldo, Vermögen and Verbindlichkeiten over `accounts`. Vermögen and
 * Verbindlichkeiten go by each account's own sign, not by its kind: an
 * overdrawn Girokonto is owed, a credit card paid in advance is owned. A
 * bank of the view that is not logged in (`absent`) keeps every figure open:
 * its accounts are not even listed.
 */
export function overviewFigures<A>(
  accounts: readonly A[],
  valueOf: (a: A) => AccountValue,
  absent = 0,
): OverviewFigures<A> {
  const counted: A[] = [];
  const missing: A[] = [];
  const excluded: OverviewFigures<A>['excluded'] = [];
  let total = 0;
  let assets = 0;
  let liabilities = 0;
  for (const account of accounts) {
    const v = valueOf(account);
    if (v.state === 'never') {
      excluded.push({ account, reason: 'unsupported', currency: '' });
      continue;
    }
    if (v.state === 'unread') {
      excluded.push({ account, reason: 'unread', currency: '' });
      continue;
    }
    const currency = (v.currency || 'EUR').toUpperCase();
    if (currency !== 'EUR') {
      excluded.push({ account, reason: 'currency', currency });
      continue;
    }
    counted.push(account);
    if (v.state === 'missing') {
      missing.push(account);
      continue;
    }
    total += v.cents;
    if (v.cents >= 0) assets += v.cents;
    else liabilities += v.cents;
  }
  const open = missing.length > 0 || absent > 0;
  return {
    counted,
    missing,
    excluded,
    total: open ? null : total,
    assets: open ? null : assets,
    liabilities: open ? null : liabilities,
  };
}

/**
 * A group's sum in cents: its euro figures, once each of them is known. A
 * Depot not read yet keeps it open like a missing balance (its value is a
 * read away); an account in another currency, or one the bank reports no
 * figure for, is left out — the Gesamtsaldo names those. Null for a group
 * with nothing to add up.
 */
export function groupSum<A>(accounts: readonly A[], valueOf: (a: A) => AccountValue): number | null {
  let sum = 0;
  let any = false;
  for (const a of accounts) {
    const v = valueOf(a);
    if (v.state === 'missing' || v.state === 'unread') {
      if (v.state === 'missing' && (v.currency || 'EUR').toUpperCase() !== 'EUR') continue;
      return null;
    }
    if (v.state === 'never' || (v.currency || 'EUR').toUpperCase() !== 'EUR') continue;
    sum += v.cents;
    any = true;
  }
  return any ? sum : null;
}
