// Kept balances (6.0): the last balance each account was read at, and the
// overview's figures once a day — so the overview (components/overview/
// AccountsOverview.tsx) has every figure the moment the app opens, each
// dated by the read it came from, until a read of this session replaces it.
//
// Kept in the vault, sealed with the PIN like the accounts' names; on unless
// the user switched it off in Einstellungen (owner, 2026-11-03), which deletes
// them. A kept balance is never shown as today's: the overview says "Stand"
// with the day it was read, and the account's own page waits for a read.
//
// Pure and node-test-safe: no path aliases, `.ts` on sibling imports.

import { addDaysKey } from './format.ts';

/** An account's last balance as it was read: in cents, its currency, when (ISO). */
export type KeptBalance = { cents: number; currency: string; readAt: string };

/** The overview's figures on one day, in cents — only from a day every figure was known. */
export type NetWorthDay = { day: string; total: number; assets: number; liabilities: number };

export const KEPT_LIMITS = {
  /** As many accounts as the vault keeps names for. */
  accounts: 50,
  /** Two years of days, about 50 KB: enough for a curve, well inside the vault's size. */
  days: 731,
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isCents = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);
const isIso = (s: unknown): s is string => typeof s === 'string' && s.length <= 40 && !Number.isNaN(Date.parse(s));

/** The kept balances from the vault, cleaned: well-formed entries only, at most KEPT_LIMITS.accounts, newest reads kept. */
export function sanitizeKeptBalances(input: unknown, maxKey = 64): Record<string, KeptBalance> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const ok: Array<[string, KeptBalance]> = [];
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!key || key.length > maxKey || !raw || typeof raw !== 'object') continue;
    const { cents, currency, readAt } = raw as Record<string, unknown>;
    if (!isCents(cents) || typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency) || !isIso(readAt)) continue;
    ok.push([key, { cents, currency, readAt }]);
  }
  ok.sort((a, b) => Date.parse(b[1].readAt) - Date.parse(a[1].readAt));
  return Object.fromEntries(ok.slice(0, KEPT_LIMITS.accounts));
}

/** The daily figures from the vault, cleaned: one per day, oldest first, the newest KEPT_LIMITS.days. */
export function sanitizeNetWorth(input: unknown): NetWorthDay[] {
  if (!Array.isArray(input)) return [];
  const byDay = new Map<string, NetWorthDay>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const { day, total, assets, liabilities } = raw as Record<string, unknown>;
    if (typeof day !== 'string' || !DAY.test(day) || !isCents(total) || !isCents(assets) || !isCents(liabilities)) continue;
    byDay.set(day, { day, total, assets, liabilities });
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-KEPT_LIMITS.days);
}

/**
 * The kept balances with `next` folded in: an account's entry is replaced by
 * a read as new or newer, never by an older one. The same object comes back
 * when nothing changed, so the vault is not written for nothing.
 */
export function keepBalances(
  kept: Readonly<Record<string, KeptBalance>>,
  next: Readonly<Record<string, KeptBalance>>,
): Record<string, KeptBalance> {
  let out: Record<string, KeptBalance> | null = null;
  for (const [key, value] of Object.entries(next)) {
    const had = kept[key];
    if (had && had.cents === value.cents && had.currency === value.currency && had.readAt === value.readAt) continue;
    if (had && Date.parse(had.readAt) > Date.parse(value.readAt)) continue;
    out ??= { ...kept };
    out[key] = value;
  }
  return out ? sanitizeKeptBalances(out) : (kept as Record<string, KeptBalance>);
}

/**
 * The daily figures with today's: a day's entry is the last complete one of
 * that day. The same array comes back when nothing changed.
 */
export function recordNetWorth(days: readonly NetWorthDay[], entry: NetWorthDay): NetWorthDay[] {
  const last = days[days.length - 1];
  if (last && last.day === entry.day && last.total === entry.total && last.assets === entry.assets && last.liabilities === entry.liabilities) {
    return days as NetWorthDay[];
  }
  return sanitizeNetWorth([...days.filter((d) => d.day !== entry.day), entry]);
}

/**
 * The daily figures as a curve, one point per day up to `today` (BalanceChart
 * wants no gaps): a day without a reading carries the last one before it —
 * a staircase, as a Kontoverlauf draws a day without bookings. Null with
 * fewer than two readings: one figure is no curve.
 */
export function netWorthPoints(days: readonly NetWorthDay[], today: string): Array<{ date: string; balance: number }> | null {
  const known = days.filter((d) => d.day <= today);
  if (known.length < 2) return null;
  const points: Array<{ date: string; balance: number }> = [];
  let k = 0;
  for (let day = known[0].day; day <= today; day = addDaysKey(day, 1)) {
    while (k + 1 < known.length && known[k + 1].day <= day) k++;
    points.push({ date: day, balance: known[k].total / 100 });
  }
  return points;
}
