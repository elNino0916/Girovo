// The orders this login sent in the last two weeks, for the duplicate check.
//
// The transfer sheet asks "Schon einmal überwiesen?" when the same amount goes
// to the same IBAN again. Booked statements answer that only once the bank has
// booked the first order — minutes to days later — and the session's own log
// is gone with every logout, including the automatic one. An order that ended
// in "Status unklar" on Friday and is typed in again on Saturday was exactly
// the case nobody warned about. So executed and unclear orders are kept here,
// in the PIN-encrypted vault (lib/vault.ts), for as long as the check looks
// back. Refused orders moved no money and are not kept.
//
// Deliberately little per order: account, IBAN, amount, time, outcome — no
// name, no purpose. Old entries go whenever the vault is read or written, and
// with the vault itself when it is wiped ("Gerät vergessen").
//
// Pure and dependency-free apart from sibling lib modules, for the client, the
// vault and `node --test`.

import { ibanValid } from './format.ts';

export type SentOrder = {
  /** When it was sent (ISO). */
  at: string;
  /** The account it left from. */
  accountNumber: string;
  /** Raw: no spaces, upper case. */
  iban: string;
  cents: number;
  outcome: 'executed' | 'unknown';
};

/** How far back the duplicate check looks — and so how long an order is kept. */
export const SENT_ORDER_DAYS = 14;
/** A backstop for a runaway client; two weeks of a household's transfers stay far below it. */
export const MAX_SENT_ORDERS = 200;
/** 999.999.999,99 € — the most a SEPA order can carry. */
const MAX_CENTS = 99_999_999_999;
/** A clock that is a little ahead is not a reason to drop an order. */
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const OUTCOMES = new Set(['executed', 'unknown']);

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** One entry as this version understands it, or null. */
function entry(v: unknown): SentOrder | null {
  if (!isRecord(v)) return null;
  const t = typeof v.at === 'string' && v.at.length <= 40 ? Date.parse(v.at) : NaN;
  if (Number.isNaN(t)) return null;
  const accountNumber = typeof v.accountNumber === 'string' ? v.accountNumber.trim() : '';
  if (!accountNumber || accountNumber.length > 64 || /[\u0000-\u001f\u007f-\u009f]/.test(accountNumber)) return null;
  const iban = typeof v.iban === 'string' ? v.iban.replace(/\s+/g, '').toUpperCase() : '';
  if (iban.length > 34 || !ibanValid(iban)) return null;
  const cents = v.cents;
  if (typeof cents !== 'number' || !Number.isInteger(cents) || cents <= 0 || cents > MAX_CENTS) return null;
  if (typeof v.outcome !== 'string' || !OUTCOMES.has(v.outcome)) return null;
  return { at: new Date(t).toISOString(), accountNumber, iban, cents, outcome: v.outcome as SentOrder['outcome'] };
}

/**
 * The log as it may be kept at `now`: well-formed entries from the last
 * SENT_ORDER_DAYS days, newest first, at most MAX_SENT_ORDERS of them.
 * Anything else — an older shape, a hand-edited field — is dropped.
 */
export function sanitizeSentOrders(input: unknown, now = Date.now()): SentOrder[] {
  const oldest = now - SENT_ORDER_DAYS * DAY_MS;
  const out: SentOrder[] = [];
  for (const raw of Array.isArray(input) ? input : []) {
    const e = entry(raw);
    if (!e) continue;
    const t = Date.parse(e.at);
    if (t < oldest || t > now + FUTURE_SLACK_MS) continue;
    out.push(e);
  }
  out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return out.slice(0, MAX_SENT_ORDERS);
}

/** `list` with `order` recorded, pruned as sanitizeSentOrders prunes. */
export function recordSentOrder(list: readonly SentOrder[] | null | undefined, order: SentOrder, now = Date.now()): SentOrder[] {
  return sanitizeSentOrders([order, ...(list ?? [])], now);
}
