// Payment alerts (6.0): what "Neue Umsätze melden" says besides "something
// new arrived" — a contract that charged more than its usual price, salary
// or another regular income coming in, an account falling under the user's
// limit.
//
// The check runs without the user and without the vault
// (lib/background-check.ts), and it sees two weeks of Umsätze. What a
// contract usually costs is known to Verträge & Abos (lib/recurring.ts),
// which reads the whole loaded history. So while the user is logged in, the
// app hands the check a watch list (components/settings/BackgroundAlerts.tsx,
// AlertWatch): each live fixed-price contract's identity and price, and each
// regular income's identity. It is kept in the check's sealed box beside the
// PINs. A new booking is matched to it exactly the way the detection groups
// bookings (seriesIdentity), so it belongs to the contract Verträge & Abos
// would file it under.
//
// The watch list also carries the user's cancellation reminders
// (lib/contract-watch.ts): the check has no vault to read them from, and a
// reminder is said once, as a notification, from its lead until its day.
// Each login's vault hands over its own, so they are kept by owner.
//
// Pure and node-test-safe: no path aliases, `.ts` on sibling imports.

import type { SerializedTransaction } from './fints-types';
import { bookingKind } from './categorize.ts';
import { seriesBase, seriesIdentity, seriesTitle, type RecurringSeries } from './recurring.ts';
import { AFTER_DAYS, REMINDER_LEADS, REMINDERS_MAX, dayNum } from './contract-watch.ts';

/** What the notices are about. Each booking is told once, by the most specific one that fits. */
export type AlertPrefs = {
  /** Every new booking: the notices "Neue Umsätze melden" always gave. */
  every: boolean;
  /** A watched contract charged more than its usual price. */
  dearer: boolean;
  /** Salary, a pension or another regular income came in. */
  income: boolean;
};

export const DEFAULT_PREFS: AlertPrefs = { every: true, dearer: true, income: true };

export type WatchedContract = {
  /** The series' identity (seriesBase), e.g. "out|cred:DE98ZZZ09999999999|mref:M-1". */
  key: string;
  /** A payment facilitator's shop, when the series is one shop's bookings through it. */
  shop?: string;
  /** As Verträge & Abos names it. With `named` it is shown as it stands; without (a list kept by 6.0), it is the bank's raw name: run it through displayName. */
  name: string;
  /** The name is the one to show — the user's own, or already tidied (6.1, seriesTitle). */
  named?: true;
  /** The usual price in cents, positive. */
  cents: number;
  /** yyyy-mm-dd: when the app last named it. */
  at: string;
};

export type WatchedIncome = { key: string; at: string };

/** A cancellation reminder as the check keeps it: whose vault it is from, and the day it was last said for. */
export type WatchedReminder = {
  /** The login whose vault set it (blz|userId): a vault's new list replaces only its own. */
  owner: string;
  /** The contract's series id. */
  id: string;
  by: string;
  lead: number;
  name: string;
  /** The `by` it was said for: a new date says it again. */
  told?: string;
};

export type Watch = { contracts: WatchedContract[]; income: WatchedIncome[]; reminders?: WatchedReminder[] };

/** One account's limit: below `cents` (signed) it says so, once, until the balance is back above. */
export type Limit = { cents: number; label: string };

/** Einstellungen' view of the alerts: what they are about, and each of the page's accounts, by its key. */
export type AlertsView = {
  prefs: AlertPrefs;
  amounts: boolean;
  /** `checked`: its login is one the checks look at; `cents`: its limit, or null. */
  accounts: Record<string, { checked: boolean; cents: number | null }>;
};

/** What Einstellungen changes: any of the choices, and limits by the page's account key (null: none). */
export type AlertsChange = Partial<AlertPrefs> & {
  amounts?: boolean;
  limits?: Array<{ account: string; cents: number | null; label: string }>;
};

/** How long the check keeps a contract the app stopped naming: its bookings may only have left the loaded period. */
const WATCH_DAYS = 120;
export const CONTRACTS_MAX = 200;
const INCOME_MAX = 60;
const KEY_MAX = 300;
const NAME_MAX = 80;
const LABEL_MAX = 60;
/** What a limit can be, in cents: ten million euros either way. */
const CENTS_MAX = 1_000_000_000;
const DAY_MS = 86_400_000;

const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const CONTROLS_ALL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const cleanText = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(CONTROLS_ALL, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const cleanKey = (v: unknown): string => (typeof v === 'string' && v.length <= KEY_MAX && !CONTROLS.test(v) ? v : '');

/** A limit's or a price's cents as stored: a whole number within bounds, else null. */
export const readCents = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= CENTS_MAX ? v : null;

export function readPrefs(v: unknown): AlertPrefs {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return { every: r.every !== false, dearer: r.dearer !== false, income: r.income !== false };
}

function readContract(v: unknown): WatchedContract | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const key = cleanKey(r.key);
  const cents = readCents(r.cents);
  if (!key || cents === null || cents <= 0 || !isDay(r.at)) return null;
  const shop = cleanText(r.shop, NAME_MAX);
  return { key, ...(shop ? { shop } : {}), name: cleanText(r.name, NAME_MAX), ...(r.named === true ? { named: true as const } : {}), cents, at: r.at };
}

function readIncome(v: unknown): WatchedIncome | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const key = cleanKey(r.key);
  return key && isDay(r.at) ? { key, at: r.at } : null;
}

/** A reminder as stored; `owner` may be left to the caller (the page does not know it, the route does). */
export function readReminder(v: unknown, owner?: string): WatchedReminder | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const who = owner ?? cleanKey(r.owner);
  const id = cleanKey(r.id);
  if (!who || !id || typeof r.by !== 'string' || dayNum(r.by) === null) return null;
  if (!(REMINDER_LEADS as readonly unknown[]).includes(r.lead)) return null;
  const told = typeof r.told === 'string' && dayNum(r.told) !== null ? r.told : undefined;
  return { owner: who, id, by: r.by, lead: r.lead as number, name: cleanText(r.name, NAME_MAX), ...(told ? { told } : {}) };
}

export function readWatch(v: unknown): Watch {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const contracts = (Array.isArray(r.contracts) ? r.contracts : []).map(readContract).filter((c): c is WatchedContract => !!c);
  const income = (Array.isArray(r.income) ? r.income : []).map(readIncome).filter((i): i is WatchedIncome => !!i);
  const reminders = (Array.isArray(r.reminders) ? r.reminders : []).map((x) => readReminder(x)).filter((x): x is WatchedReminder => !!x);
  return {
    contracts: contracts.slice(0, CONTRACTS_MAX),
    income: income.slice(0, INCOME_MAX),
    ...(reminders.length ? { reminders: reminders.slice(0, REMINDERS_MAX) } : {}),
  };
}

export function readLimit(v: unknown): Limit | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const cents = readCents(r.cents);
  return cents === null ? null : { cents, label: cleanText(r.label, LABEL_MAX) };
}

/**
 * The watch list from Verträge & Abos: every live expense series at a fixed
 * price (a phone bill that varies would cry wolf every month) and every live
 * income series. `drop` names the series it shows as ended or hidden, unless
 * a live series shares their identity (one mandate, two amount clusters).
 */
export function watchOf(
  live: readonly RecurringSeries[], gone: readonly RecurringSeries[], today: string,
): Watch & { drop: string[] } {
  const contracts: WatchedContract[] = [];
  const income: WatchedIncome[] = [];
  for (const s of live) {
    const key = seriesBase(s.key);
    if (!cleanKey(key)) continue;
    if (s.kind === 'income') {
      if (!income.some((i) => i.key === key)) income.push({ key, at: today });
      continue;
    }
    if (s.variable) continue;
    const cents = Math.round(Math.abs(s.amount) * 100);
    if (!(cents > 0) || cents > CENTS_MAX) continue;
    const shop = s.transactions[0] ? seriesIdentity(s.transactions[0]).shop : null;
    contracts.push({ key, ...(shop ? { shop } : {}), name: cleanText(seriesTitle(s), NAME_MAX), named: true, cents, at: today });
  }
  const liveKeys = new Set(live.map((s) => seriesBase(s.key)));
  const drop = [...new Set(gone.map((s) => seriesBase(s.key)))].filter((k) => !liveKeys.has(k) && cleanKey(k));
  return { contracts: contracts.slice(0, CONTRACTS_MAX), income: income.slice(0, INCOME_MAX), drop };
}

/**
 * The app's new list over the kept one. An identity it names now takes what
 * it names (its amount clusters may have changed), one it calls ended or
 * hidden goes, and the rest stays until WATCH_DAYS after the app last named
 * it: the app sees only the period it loaded, which may not reach back to a
 * yearly contract's last booking.
 */
export function mergeWatch(prior: Watch, next: Watch & { drop?: readonly string[]; owner?: string }, now = Date.now()): Watch {
  const cutoff = new Date(now - WATCH_DAYS * DAY_MS).toISOString().slice(0, 10);
  const drop = next.drop ?? [];
  const namedContracts = new Set([...next.contracts.map((c) => c.key), ...drop]);
  const namedIncome = new Set([...next.income.map((i) => i.key), ...drop]);
  const reminders = mergeReminders(prior.reminders ?? [], next.reminders, next.owner, now);
  return {
    contracts: [...next.contracts, ...prior.contracts.filter((c) => !namedContracts.has(c.key) && c.at >= cutoff)].slice(0, CONTRACTS_MAX),
    income: [...next.income, ...prior.income.filter((i) => !namedIncome.has(i.key) && i.at >= cutoff)].slice(0, INCOME_MAX),
    ...(reminders.length ? { reminders } : {}),
  };
}

/**
 * One vault's reminders over the kept ones: `owner`'s list is replaced whole
 * (a removed reminder goes, an empty list clears them), what was said for an
 * unchanged date stays said, other owners' stay as they were, and one past
 * its day goes. Without an owner nothing is handed over.
 */
export function mergeReminders(
  prior: readonly WatchedReminder[], next: readonly WatchedReminder[] | undefined, owner: string | undefined, now = Date.now(),
): WatchedReminder[] {
  const today = Math.floor(now / DAY_MS);
  const current = (r: WatchedReminder) => (dayNum(r.by) ?? -Infinity) + AFTER_DAYS >= today;
  if (!owner) return prior.filter(current);
  const fresh = (next ?? []).map(({ told: _told, ...r }) => {
    const was = prior.find((p) => p.owner === owner && p.id === r.id);
    return { ...r, owner, ...(was?.told === r.by ? { told: r.by } : {}) };
  });
  return [...fresh, ...prior.filter((p) => p.owner !== owner)].filter(current).slice(0, REMINDERS_MAX);
}

/** More than `usual` by over 1 % and 0,50 €: Verträge & Abos' own rule for a changed price. */
const dearerBy = (usual: number, paid: number) => paid > usual && (paid - usual) * 100 > usual && paid - usual > 50;

/**
 * The watched contract a new booking is a dearer charge of, or null. Of the
 * contracts under the booking's identity (a utility's one mandate can carry
 * the instalment and the settlement) the nearest in price is taken; a charge
 * at twice that price or more is not a price increase but another charge — a
 * back payment, a settlement — and is not called one.
 */
export function dearerCharge(
  contracts: readonly WatchedContract[], tx: SerializedTransaction,
): { contract: WatchedContract; cents: number } | null {
  const amount = Number(tx.amount);
  if (!(amount < 0) || !Number.isFinite(amount)) return null;
  const { key, shop } = seriesIdentity(tx);
  if (!key) return null;
  const mine = contracts.filter((c) => c.key === key && (!c.shop || c.shop === shop));
  if (!mine.length) return null;
  const paid = Math.round(-amount * 100);
  const nearest = mine.reduce((a, b) => (Math.abs(b.cents - paid) < Math.abs(a.cents - paid) ? b : a));
  return dearerBy(nearest.cents, paid) && paid < nearest.cents * 2 ? { contract: nearest, cents: paid } : null;
}

/** Whether a new booking is salary or a pension (the bank's own code or text says so), or a watched regular income. */
export function isIncome(income: readonly WatchedIncome[], tx: SerializedTransaction): boolean {
  if (!(Number(tx.amount) > 0)) return false;
  if (bookingKind(tx) === 'gehalt') return true;
  const { key } = seriesIdentity(tx);
  return !!key && income.some((i) => i.key === key);
}

/** Whether a balance is under its limit; null with no limit or no balance to tell. */
export function belowLimit(limit: Limit | undefined, balance: number | null | undefined): boolean | null {
  if (!limit || balance == null || !Number.isFinite(balance)) return null;
  return Math.round(balance * 100) < limit.cents;
}
