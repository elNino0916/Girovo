// What the transfer sheet works out from data the session already holds —
// recent payees, amounts, templates. Pure functions over loaded bookings:
// nothing here asks the bank anything. The checks before sending (duplicate,
// funds) live in lib/transfer-checks.ts, the reading of the bank's answer in
// lib/bank-answer.ts — both with tests.

import type { TransferTemplate } from '@/lib/app-types';
import type { SerializedTransaction } from '@/lib/fints-types';
import { intermediaryName } from '@/lib/categories';
import { bookingKind } from '@/lib/categorize';
import { dayKey, displayName, fmtShortIban, ibanValid, parseAmount } from '@/lib/format';
import { rawIban } from './iban';

/** The order as the review step shows it and the bank receives it. */
export type TransferDraft = {
  accountNumber: string;
  name: string;
  /** Raw: no spaces, upper case, checksum valid. */
  iban: string;
  cents: number;
  purpose: string;
  instant: boolean;
};

/** "DE78 ··· 5932 71" as one string, for a native <option> or a summary line. */
export const shortIbanText = (iban: string | null | undefined) => {
  const s = fmtShortIban(iban);
  return s.head ? `${s.head} ${s.tail}` : s.tail;
};

export const MAX_RECENT = 6;
export const MAX_NAME = 70;
export const MAX_PURPOSE = 140;
/** 999.999.999,99 € — the most a SEPA order can carry, and what the server accepts. */
const MAX_CENTS = 99_999_999_999;

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

export type AmountCheck = { cents: number; error: null } | { cents: null; error: string | null };

/**
 * The typed amount as whole cents, or why it cannot be sent. Empty input is
 * `{ cents: null, error: null }` — not an error until the form is submitted.
 */
export function checkAmount(text: string): AmountCheck {
  if (!text.trim()) return { cents: null, error: null };
  const n = parseAmount(text);
  if (n == null) return { cents: null, error: 'Bitte gib einen gültigen Betrag an, zum Beispiel 25,00.' };
  const cents = Math.round(n * 100);
  if (cents <= 0) return { cents: null, error: 'Der Betrag muss größer als 0,00 € sein.' };
  if (cents > MAX_CENTS) return { cents: null, error: 'Der Betrag darf höchstens 999.999.999,99 € betragen.' };
  return { cents, error: null };
}

/**
 * The amount as the order carries it: "1000.00". The server parses the string
 * it is given with its own, stricter reader (a German "1.000" would not get
 * through it), so the sheet sends the figure it has already parsed, checked
 * and shown on the review step — in the one spelling both readers agree on.
 */
export const wireAmount = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

// ---------------------------------------------------------------------------
// Recent payees
// ---------------------------------------------------------------------------

export type RecentPayee = { name: string; iban: string; day: string };

// Bookings whose counterparty pulled the money or is not a payee at all —
// a direct-debit creditor, a card acquirer, the bank's own fees. Sending
// them a transfer is almost never what someone means.
const NOT_A_PAYEE = new Set(['lastschrift', 'karte', 'entgelt', 'zinsen', 'bargeld', 'ruecklastschrift']);

/**
 * The people this session's statements show you paying, newest first, one
 * entry per IBAN. Only debits to a checksum-valid IBAN, and never `exclude`
 * (the account the transfer goes out from).
 */
export function recentPayees(
  txByAccount: Record<string, SerializedTransaction[]>,
  opts: { exclude?: string | null; limit?: number } = {},
): RecentPayee[] {
  const exclude = rawIban(opts.exclude);
  const debits: Array<{ tx: SerializedTransaction; day: string }> = [];
  for (const list of Object.values(txByAccount)) {
    for (const tx of list ?? []) {
      if (!(tx.amount < 0)) continue;
      debits.push({ tx, day: dayKey(tx.entryDate) });
    }
  }
  debits.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));

  const out: RecentPayee[] = [];
  const seen = new Set<string>();
  for (const { tx, day } of debits) {
    const iban = rawIban(tx.remoteIban);
    if (!iban || seen.has(iban) || iban === exclude || !ibanValid(iban)) continue;
    if (NOT_A_PAYEE.has(bookingKind(tx))) continue;
    // Paid through an intermediary for someone else (a card processor for a
    // shop): its IBAN is not one you would send a transfer to.
    if (intermediaryName(tx)) continue;
    const name = displayName(tx.remoteName);
    if (!name) continue;
    seen.add(iban);
    out.push({ name: name.slice(0, MAX_NAME), iban, day });
    if (out.length >= (opts.limit ?? MAX_RECENT)) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dates and templates
// ---------------------------------------------------------------------------

/** "Montag, 05.10.2026" */
export const fmtLongDate = (d: Date) =>
  new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);

/** Most recently used first, then newest. */
export function sortTemplates(list: readonly TransferTemplate[]): TransferTemplate[] {
  const stamp = (t: TransferTemplate) => t.lastUsedAt ?? t.createdAt ?? '';
  return [...list].sort((a, b) => (stamp(a) < stamp(b) ? 1 : stamp(a) > stamp(b) ? -1 : 0));
}

/** Whether a template already says exactly this. */
export function sameTemplate(t: TransferTemplate, d: { name: string; iban: string; amount?: string; purpose?: string }): boolean {
  const amt = (s?: string) => {
    const n = s ? parseAmount(s) : null;
    return n == null ? '' : n.toFixed(2);
  };
  return rawIban(t.iban) === d.iban
    && t.name.trim() === d.name.trim()
    && amt(t.amount) === amt(d.amount)
    && (t.purpose ?? '').trim() === (d.purpose ?? '').trim();
}
