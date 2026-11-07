// Contracts the user adds (6.0): a booking Verträge & Abos did not recognise —
// a yearly insurance with one booking in the loaded days, a subscription that
// has charged once — marked "Als Vertrag merken". What is kept is who
// collects it (the identity detection groups bookings by, lib/recurring.ts
// seriesIdentity), the amount it was made from and the rhythm; every loaded
// booking from that payer at a similar amount belongs to it, earlier and
// later ones alike (lib/recurring.ts detectRecurring, `manual`).
//
// Kept in the vault by series id and synced, the counterpart of the series
// the user dismissed. Its newest booking is kept too (`day`, `label`), so a
// yearly contract stays listed once that booking has left the loaded days
// (components/insights/AddContract.tsx ManualContractDays moves it on).
//
// Pure and node-test-safe: no path aliases, `.ts` on sibling imports.

import type { Cadence } from './recurring.ts';

export type ManualContract = {
  /** seriesIdentity(tx).key of the booking it was made from: who collects it, and which way the money goes. */
  key: string;
  /** The shop behind a payment facilitator (seriesIdentity(tx).shop), when it was one. */
  shop?: string;
  /** The amount it was made from, in cents, unsigned. */
  cents: number;
  cadence: Cadence;
  /** The user's name for it; empty keeps the bank's. */
  name: string;
  /** yyyy-mm-dd it was added. */
  at: string;
  /** yyyy-mm-dd of the newest booking it was seen with: listed from that booking when none is loaded. */
  day?: string;
  /** The bank's name for the payer on that booking. */
  label?: string;
};

export const MANUAL_MAX = 100;
export const MANUAL_CADENCES: readonly Cadence[] = ['weekly', 'monthly', 'quarterly', 'halfyearly', 'yearly'];
const KEY_MAX = 300;
const NAME_MAX = 70;
/** Up to ten million euros. */
const CENTS_MAX = 1_000_000_000;

/**
 * Whether a booking's amount is the contract's: within a quarter of the one it
 * was made from, and at least a euro — a price change still fits, a shop's
 * other purchases do not.
 */
export const nearAmount = (cents: number, abs: number): boolean => Math.abs(abs - cents) <= Math.max(100, cents * 0.25);

const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * The newest booking a device has seen of a contract the user added: kept
 * apart from the contract (vault manualDays), so moving it on is never a
 * newer change of the contract itself — a sync must not bring back one
 * removed on another device, nor undo a rename made there.
 */
export type ManualDay = { day: string; label?: string };

/** A contract with the newest booking any device saw of it. */
export function withDays(
  manual: Readonly<Record<string, ManualContract>> | undefined, days: Readonly<Record<string, ManualDay>> | undefined,
): Record<string, ManualContract> | undefined {
  if (!manual || !days) return manual as Record<string, ManualContract> | undefined;
  const out: Record<string, ManualContract> = {};
  for (const [id, m] of Object.entries(manual)) {
    const d = days[id];
    const later = d && (!m.day || d.day > m.day);
    out[id] = later || (d?.label && !m.label)
      ? { ...m, ...(later ? { day: d.day } : {}), ...(m.label || !d.label ? {} : { label: d.label }) }
      : m;
  }
  return out;
}

/** The vault's newest bookings as they may be kept: a real day, a short label. */
export function sanitizeManualDays(raw: unknown): Record<string, ManualDay> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, ManualDay> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MANUAL_MAX) break;
    if (!id || id.length > 64 || CONTROLS.test(id) || !v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    if (!isDay(r.day)) continue;
    const label = typeof r.label === 'string' ? r.label.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, NAME_MAX) : '';
    out[id] = { day: r.day, ...(label ? { label } : {}) };
  }
  return Object.keys(out).length ? out : undefined;
}

/** The vault's manual contracts as they may be kept: a key, a real amount, a rhythm on offer, a name — at most MANUAL_MAX. */
export function sanitizeManual(raw: unknown): Record<string, ManualContract> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, ManualContract> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MANUAL_MAX) break;
    if (!id || id.length > 64 || CONTROLS.test(id) || !v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    if (typeof r.key !== 'string' || !r.key || r.key.length > KEY_MAX || CONTROLS.test(r.key)) continue;
    if (typeof r.cents !== 'number' || !Number.isInteger(r.cents) || r.cents <= 0 || r.cents > CENTS_MAX) continue;
    if (!(MANUAL_CADENCES as readonly unknown[]).includes(r.cadence)) continue;
    const shop = typeof r.shop === 'string' && r.shop && r.shop.length <= KEY_MAX && !CONTROLS.test(r.shop) ? r.shop : undefined;
    const name = typeof r.name === 'string' ? r.name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, NAME_MAX) : '';
    const label = typeof r.label === 'string' ? r.label.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, NAME_MAX) : '';
    out[id] = {
      key: r.key,
      ...(shop ? { shop } : {}),
      cents: r.cents,
      cadence: r.cadence as Cadence,
      name,
      at: isDay(r.at) ? r.at : '1970-01-01',
      ...(isDay(r.day) ? { day: r.day } : {}),
      ...(label ? { label } : {}),
    };
  }
  return Object.keys(out).length ? out : undefined;
}
