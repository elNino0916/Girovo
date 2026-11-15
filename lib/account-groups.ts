// Girovo Next: the user's own account groups, "Eigene" (issue #22, as
// Banking4's Kontogruppen). A fourth way to group the accounts beside Nach
// Art, Nach Bank and Keine, for the desktop's sidebar (components/overview/
// AccountLayers.tsx) and its "Konten anordnen" (ArrangeSheet.tsx, `flat`):
// the user names groups, puts accounts in them, orders both, folds a group,
// and each group's head carries its sum.
//
// Kept in the vault and synced (lib/sync-entries.ts) like accountOrder:
//   accountGroups        the groups in their order, each with its accounts
//   accountGroupsOn      "Eigene" is chosen
//   accountGroupsFolded  the folded groups, by id (REST_GROUP for "Weitere Konten")
// Why "Eigene" is a field of its own and not a fourth value of
// accountGrouping: see VaultData.accountGroupsOn (lib/app-types.ts).
//
// A group's members are account keys, the ones accountOrder uses (the number,
// `number:sub` or `number@BLZ`, lib/account-key.ts). A key stays in its group
// while its account is not on screen (a further bank not logged in, an account
// the bank stopped listing for a while), so the account is back in its group
// when it comes back. Every account in no group is in "Weitere Konten", at
// the bottom, shown only while it has accounts.
//
// Pure and node-test-safe: no path aliases, `.ts` on sibling imports.

import {
  MAX_ORDER, keepAbsentPlaces, orderAccounts, overviewFigures, type AccountGroupKind, type AccountValue, type OverviewFigures,
} from './account-overview.ts';

export type OwnGroup = {
  /** Never shown: what the folded list and a move name it by. */
  id: string;
  /** The user's name for it. */
  name: string;
  /** Account keys, in the order shown, absent accounts included. */
  accounts: string[];
};

/** "Weitere Konten": every account in no group. Not a group of its own in the vault, only its fold. */
export const REST_GROUP = 'rest';

export const OWN_GROUP_LIMITS = {
  /** Groups the user can have. */
  groups: 20,
  /** A name's length, in characters. */
  name: 40,
} as const;

const ID = /^[a-z0-9]{1,12}$/;
// Control characters, line and paragraph separators: a name is one line.
const NOT_IN_NAME = /[\p{Cc}\p{Zl}\p{Zp}]/gu;

/** A name as a group keeps it: one line, spaces collapsed, within the cap. Empty when nothing is left. */
export function cleanGroupName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const one = raw.replace(NOT_IN_NAME, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(one).slice(0, OWN_GROUP_LIMITS.name).join('').trim();
}

/**
 * The groups kept in the vault, cleaned: a well-formed id each once (never
 * REST_GROUP), a name, account keys within `maxKey` and each in one group
 * only (the first that names it), at most MAX_ORDER keys in all, at most
 * OWN_GROUP_LIMITS.groups groups. Null when it is no list at all: the user
 * has not chosen "Eigene" yet. An empty list stays one (every group deleted).
 */
export function sanitizeOwnGroups(input: unknown, maxKey = 64): OwnGroup[] | null {
  if (!Array.isArray(input)) return null;
  const out: OwnGroup[] = [];
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const raw of input) {
    if (out.length >= OWN_GROUP_LIMITS.groups) break;
    if (!raw || typeof raw !== 'object') continue;
    const g = raw as Record<string, unknown>;
    const id = typeof g.id === 'string' ? g.id : '';
    const name = cleanGroupName(g.name);
    if (!ID.test(id) || id === REST_GROUP || ids.has(id) || !name) continue;
    const accounts: string[] = [];
    for (const k of Array.isArray(g.accounts) ? g.accounts : []) {
      if (typeof k !== 'string' || !k || k.length > maxKey || keys.has(k) || keys.size >= MAX_ORDER) continue;
      keys.add(k);
      accounts.push(k);
    }
    ids.add(id);
    out.push({ id, name, accounts });
  }
  return out;
}

/** The folded groups kept in the vault: ids of `groups` or REST_GROUP, each once. */
export function sanitizeFolded(input: unknown, groups: readonly OwnGroup[] | null): string[] {
  if (!Array.isArray(input)) return [];
  const known = new Set([REST_GROUP, ...(groups ?? []).map((g) => g.id)]);
  return [...new Set(input.filter((id): id is string => typeof id === 'string' && known.has(id)))];
}

/** A free id for a new group: g1, g2, … */
export function nextGroupId(groups: readonly OwnGroup[]): string {
  const taken = new Set(groups.map((g) => g.id));
  let n = 1;
  while (taken.has(`g${n}`)) n++;
  return `g${n}`;
}

/**
 * The groups "Eigene" starts with, the first time it is chosen: the groups
 * of Nach Art, under their names, with their accounts in the order shown.
 * Nach Art's last group is "Weitere Konten" itself (REST_GROUP), so its
 * accounts stay in no group: the copy looks the same as Nach Art did.
 */
export function groupsFromKinds<A>(
  ordered: readonly A[],
  how: { kindOf: (a: A) => AccountGroupKind; keyOf: (a: A) => string; names: Record<AccountGroupKind, string> },
): OwnGroup[] {
  const kinds: AccountGroupKind[] = ['giro', 'saving', 'credit'];
  return kinds
    .map((kind) => ({ id: kind, name: cleanGroupName(how.names[kind]), accounts: ordered.filter((a) => how.kindOf(a) === kind).map(how.keyOf) }))
    .filter((g) => g.accounts.length > 0 && g.name);
}

/** A new group at the end; null at the cap or without a name. */
export function addGroup(groups: readonly OwnGroup[], name: string): { groups: OwnGroup[]; id: string } | null {
  const clean = cleanGroupName(name);
  if (!clean || groups.length >= OWN_GROUP_LIMITS.groups) return null;
  const id = nextGroupId(groups);
  return { groups: [...groups, { id, name: clean, accounts: [] }], id };
}

/** A group under a new name; unchanged when the name is empty. */
export function renameGroup(groups: readonly OwnGroup[], id: string, name: string): OwnGroup[] {
  const clean = cleanGroupName(name);
  if (!clean) return [...groups];
  return groups.map((g) => (g.id === id ? { ...g, name: clean } : g));
}

/** A group gone; its accounts are in no group then, so in "Weitere Konten". */
export function deleteGroup(groups: readonly OwnGroup[], id: string): OwnGroup[] {
  return groups.filter((g) => g.id !== id);
}

/** A group moved to another place among the groups. */
export function moveGroup(groups: readonly OwnGroup[], id: string, to: number): OwnGroup[] {
  const from = groups.findIndex((g) => g.id === id);
  if (from < 0 || to < 0 || to >= groups.length || from === to) return [...groups];
  const next = [...groups];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * An account put into a group (`target` a group's id), before the account
 * `before` there or at its end, and out of the group it was in. REST_GROUP
 * takes it out of every group. Within its own group this is a move to
 * another place. Unchanged for an unknown group, or when the key would be
 * one more than the groups can keep (MAX_ORDER).
 */
export function moveIntoGroup(groups: readonly OwnGroup[], key: string, target: string, before: string | null = null): OwnGroup[] {
  const out = groups.map((g) => ({ ...g, accounts: g.accounts.filter((k) => k !== key) }));
  if (target === REST_GROUP) return out;
  const dest = out.find((g) => g.id === target);
  if (!dest) return [...groups];
  const member = groups.some((g) => g.accounts.includes(key));
  if (!member && groups.reduce((n, g) => n + g.accounts.length, 0) >= MAX_ORDER) return [...groups];
  const at = before === null || before === key ? -1 : dest.accounts.indexOf(before);
  if (at < 0) dest.accounts.push(key);
  else dest.accounts.splice(at, 0, key);
  return out;
}

/**
 * A group's accounts on screen in a new sequence, kept over the old one:
 * the accounts not on screen keep their places among them (lib/account-
 * overview.ts keepAbsentPlaces).
 */
export function reorderGroup(groups: readonly OwnGroup[], id: string, onScreen: readonly string[]): OwnGroup[] {
  return groups.map((g) => (g.id === id ? { ...g, accounts: keepAbsentPlaces(g.accounts, onScreen) } : g));
}

/** A group folded or unfolded. */
export function toggleFolded(folded: readonly string[], id: string): string[] {
  return folded.includes(id) ? folded.filter((x) => x !== id) : [...folded, id];
}

export type ShownGroup<A> = {
  /** The group's id, or REST_GROUP. */
  id: string;
  /** The user's name; null for "Weitere Konten", which the page names. */
  name: string | null;
  accounts: A[];
};

/**
 * The accounts on screen under the user's groups: each group in its order
 * with its accounts on screen in theirs (an empty group too, so accounts can
 * be put in it), then "Weitere Konten" with every account in no group in the
 * order given, once it has any.
 */
export function ownGroupsOf<A>(ordered: readonly A[], groups: readonly OwnGroup[], keyOf: (a: A) => string): ShownGroup<A>[] {
  const byKey = new Map(ordered.map((a) => [keyOf(a), a]));
  const placed = new Set<string>();
  const out: ShownGroup<A>[] = groups.map((g) => {
    const accounts: A[] = [];
    for (const k of g.accounts) {
      const a = byKey.get(k);
      if (a === undefined || placed.has(k)) continue;
      placed.add(k);
      accounts.push(a);
    }
    return { id: g.id, name: g.name, accounts };
  });
  const rest = ordered.filter((a) => !placed.has(keyOf(a)));
  if (rest.length) out.push({ id: REST_GROUP, name: null, accounts: rest });
  return out;
}

type Arranged = { accountOrder?: string[]; accountGroups?: OwnGroup[]; accountGroupsOn?: true; accountGroupsFolded?: string[] };

/**
 * The accounts in the order the desktop's sidebar shows them: with "Eigene",
 * group by group (the layers' colours and the keys 1 to 9 follow it), else
 * the user's order.
 */
export function frameOrder<A extends { accountNumber: string }>(accounts: readonly A[], v: Arranged | null | undefined): A[] {
  const ordered = orderAccounts(accounts, v?.accountOrder);
  if (!v?.accountGroupsOn) return ordered;
  return ownGroupsOf(ordered, v.accountGroups ?? [], (a) => a.accountNumber).flatMap((g) => g.accounts);
}

/**
 * The accounts the keys 1 to 9 count on the desktop's sidebar: the ones it
 * shows, so a folded group's accounts are skipped (the colours keep
 * frameOrder's sequence, the keys follow what is on screen).
 */
export function keyOrder<A extends { accountNumber: string }>(accounts: readonly A[], v: Arranged | null | undefined): A[] {
  const ordered = orderAccounts(accounts, v?.accountOrder);
  if (!v?.accountGroupsOn) return ordered;
  const folded = new Set(v.accountGroupsFolded ?? []);
  return ownGroupsOf(ordered, v.accountGroups ?? [], (a) => a.accountNumber)
    .filter((g) => !folded.has(g.id))
    .flatMap((g) => g.accounts);
}

export type GroupFigure<A> = {
  /** The euro sum in cents; null while a figure is missing, or with nothing to add. */
  sum: number | null;
  /** A figure the sum needs is not known yet: no part sum, as for the Gesamtsaldo. */
  open: boolean;
  /** What the sum leaves out and why, named under it as under the Gesamtsaldo. */
  excluded: OverviewFigures<A>['excluded'];
};

/**
 * A group head's sum, by the Gesamtsaldo's rules (overviewFigures): the
 * accounts not hidden only, euros only, a missing figure keeps it open, an
 * account in another currency or without a figure is left out and named.
 * `standIns`: the group's accounts at a bank not logged in, by the balance
 * kept from its last session (lib/account-overview.ts keptStandIns), which
 * count as they do in the Gesamtsaldo.
 */
export function ownGroupFigure<A>(
  accounts: readonly A[], valueOf: (a: A) => AccountValue, hidden: (a: A) => boolean, standIns: readonly { cents: number }[] = [],
): GroupFigure<A> {
  const f = overviewFigures(accounts.filter((a) => !hidden(a)), valueOf, 0, standIns);
  const open = f.missing.length > 0;
  return { sum: open || (!f.counted.length && !standIns.length) ? null : f.total, open, excluded: f.excluded };
}
