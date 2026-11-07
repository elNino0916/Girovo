// Contracts the user adds (6.0): a booking Verträge & Abos did not recognise —
// a yearly insurance with one booking in the loaded days, a subscription that
// has charged once — marked "Als Vertrag merken". What is kept is who
// collects it (the identity detection groups bookings by, lib/recurring.ts
// seriesIdentity), the amount it was made from and the rhythm; every loaded
// booking from that payer at a similar amount belongs to it, earlier and
// later ones alike (lib/recurring.ts detectRecurring, `manual`).
//
// Kept in the vault by series id and synced, the counterpart of the series
// the user dismissed.
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
    out[id] = {
      key: r.key,
      ...(shop ? { shop } : {}),
      cents: r.cents,
      cadence: r.cadence as Cadence,
      name,
      at: isDay(r.at) ? r.at : '1970-01-01',
    };
  }
  return Object.keys(out).length ? out : undefined;
}
