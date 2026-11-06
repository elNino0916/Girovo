// Contracts that watch themselves (6.0): what changed about a contract, and a
// reminder before it can no longer be cancelled.
//
//   price    a fixed price that changed within the last year
//            (lib/recurring.ts priceChange): since when, by how much, what it
//            comes to in a year — on its row in Verträge & Abos, and in
//            Mitteilungen for a few weeks after it changed.
//   cancel   the user's own date by which a contract can be cancelled
//            ("Kündbar bis") and how long before it to say so: in Mitteilungen
//            from then until a few days after, and — with "Neue Umsätze melden"
//            on — once as a notification (lib/background-check.ts).
//
// A notice counts as new until Mitteilungen has been opened with it in view
// (vault noticedContracts, by noticeKey), so the bell's dot comes once.
//
// Pure and node-test-safe: no path aliases, `.ts` on sibling imports.

import type { RecurringSeries } from './recurring.ts';

/** A contract's cancellation date, how many days before it to remind, and its name (the background check has no vault to look it up in). */
export type ContractReminder = { by: string; lead: number; name: string };

/** The lead times on offer: a week, two weeks, a month. */
export const REMINDER_LEADS = [7, 14, 30] as const;
export const REMINDERS_MAX = 200;
const NOTICED_MAX = 500;
const NAME_MAX = 70;
const KEY_MAX = 200;
/** How long after its day a cancellation reminder stays in Mitteilungen. */
export const AFTER_DAYS = 3;
/** How long a price change is news in Mitteilungen. */
export const PRICE_NEWS_DAYS = 45;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since 1970 for a yyyy-mm-dd, or null. */
export function dayNum(day: string): number | null {
  const m = DAY.exec(day);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? t / 86_400_000 : null;
}

/** The vault's reminders as they may be kept: a real date, a lead on offer, a name — at most REMINDERS_MAX. */
export function sanitizeReminders(raw: unknown): Record<string, ContractReminder> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, ContractReminder> = {};
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= REMINDERS_MAX) break;
    if (!key || key.length > KEY_MAX || !v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    if (typeof r.by !== 'string' || dayNum(r.by) === null) continue;
    if (!(REMINDER_LEADS as readonly unknown[]).includes(r.lead)) continue;
    const name = typeof r.name === 'string' ? r.name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, NAME_MAX) : '';
    out[key] = { by: r.by, lead: r.lead as number, name };
  }
  return Object.keys(out).length ? out : undefined;
}

/** The keys of the notices already shown: strings, the newest NOTICED_MAX. */
export function sanitizeNoticed(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const keys = [...new Set(raw.filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length <= KEY_MAX))];
  return keys.length ? keys.slice(-NOTICED_MAX) : undefined;
}

/** Days until the reminder's date while it is to be said in Mitteilungen (negative: past it), else null. */
export function reminderDaysLeft(r: Pick<ContractReminder, 'by' | 'lead'>, today: string): number | null {
  const by = dayNum(r.by);
  const now = dayNum(today);
  if (by === null || now === null) return null;
  const left = by - now;
  return left <= r.lead && left >= -AFTER_DAYS ? left : null;
}

/** Whether a notification is due for it: from its lead until its day — the background check says it once. */
export function reminderDue(r: Pick<ContractReminder, 'by' | 'lead'>, today: string): boolean {
  const left = reminderDaysLeft(r, today);
  return left !== null && left >= 0;
}

export type ContractNotice =
  | { key: string; kind: 'price'; seriesId: string; name: string; since: string; delta: number; perYear: number; currency: string }
  | { key: string; kind: 'cancel'; seriesId: string; name: string; by: string; daysLeft: number };

/**
 * What Mitteilungen says about contracts today: the reminders in their
 * window, the nearest first, then the price rises of the last weeks, the
 * newest first. `live` is Verträge & Abos' live list (a hidden or ended
 * contract has no news); `nameOf` names a series as Verträge does.
 */
export function contractNotices(
  live: readonly RecurringSeries[],
  reminders: Record<string, ContractReminder> | undefined,
  today: string,
  nameOf: (s: RecurringSeries) => string,
): ContractNotice[] {
  const now = dayNum(today);
  const byId = new Map(live.map((s) => [s.id, s]));
  const cancel: ContractNotice[] = [];
  for (const [id, r] of Object.entries(reminders ?? {})) {
    const left = reminderDaysLeft(r, today);
    if (left === null) continue;
    const s = byId.get(id);
    cancel.push({ key: `cancel|${id}|${r.by}`, kind: 'cancel', seriesId: id, name: s ? nameOf(s) : r.name, by: r.by, daysLeft: left });
  }
  cancel.sort((a, b) => (a.kind === 'cancel' && b.kind === 'cancel' ? a.daysLeft - b.daysLeft : 0));
  const price: ContractNotice[] = [];
  for (const s of live) {
    const p = s.priceChange;
    if (s.kind !== 'expense' || !p || p.delta <= 0) continue;
    const since = dayNum(p.since);
    if (now === null || since === null || now - since > PRICE_NEWS_DAYS || since > now) continue;
    price.push({ key: `price|${s.id}|${p.since}`, kind: 'price', seriesId: s.id, name: nameOf(s), since: p.since, delta: p.delta, perYear: p.perYear, currency: s.currency });
  }
  price.sort((a, b) => (a.kind === 'price' && b.kind === 'price' ? (a.since < b.since ? 1 : a.since > b.since ? -1 : 0) : 0));
  return [...cancel, ...price];
}

/** The notices Mitteilungen has not shown yet. */
export function unseenNotices(notices: readonly ContractNotice[], noticed: readonly string[] | undefined): ContractNotice[] {
  const seen = new Set(noticed ?? []);
  return notices.filter((n) => !seen.has(n.key));
}

/** `noticed` with `notices` added, the oldest let go past NOTICED_MAX. */
export function withNoticed(noticed: readonly string[] | undefined, notices: readonly ContractNotice[]): string[] {
  const keys = [...(noticed ?? []).filter((k) => !notices.some((n) => n.key === k)), ...notices.map((n) => n.key)];
  return keys.slice(-NOTICED_MAX);
}
