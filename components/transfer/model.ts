// What the transfer sheet works out from data the session already holds —
// recent payees, a possible duplicate, the figures on the review step. Pure
// functions over loaded bookings: nothing here asks the bank anything.

import type { ActivityEntry, TransferTemplate } from '@/lib/app-types';
import type { SerializedBalance, SerializedTransaction } from '@/lib/fints-types';
import { intermediaryName } from '@/lib/categories';
import { bookingKind } from '@/lib/categorize';
import {
  dayKey, dayNumber, displayName, fmtDate, fmtShortIban, ibanValid, isoDate, parseAmount, toLocalDate,
} from '@/lib/format';
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

/** Same order to the same account for the same amount within this many days → ask. */
export const DUPLICATE_WINDOW_DAYS = 14;
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
// Balances
// ---------------------------------------------------------------------------

/**
 * What the account can spend right now, as far as the session knows: the
 * bank's own "verfügbar" figure when it sent one, otherwise the booked balance
 * (labelled as such — a balance is not an availability).
 */
export function spendable(b: SerializedBalance | null | undefined): { kind: 'available' | 'balance'; value: number; date: Date | null } | null {
  if (!b) return null;
  const date = toLocalDate(b.date);
  if (b.availableAmount != null && Number.isFinite(b.availableAmount)) return { kind: 'available', value: b.availableAmount, date };
  if (Number.isFinite(b.balance)) return { kind: 'balance', value: b.balance, date };
  return null;
}

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
// Duplicate check
// ---------------------------------------------------------------------------

export type Duplicate = { sentence: string };

const fmtTime = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')} Uhr`;

/**
 * Whether the same amount already went to the same IBAN within the last two
 * weeks — from this session's own orders first (they are the freshest and
 * may not be booked yet), then from the loaded statements. A hint, never a
 * block: paying the same person twice is often exactly right.
 */
export function findDuplicate(input: {
  iban: string;
  cents: number;
  name: string;
  txByAccount: Record<string, SerializedTransaction[]>;
  activity: readonly ActivityEntry[];
  fmt: (value: number) => string;
  now?: Date;
}): Duplicate | null {
  const now = input.now ?? new Date();
  const today = dayNumber(isoDate(now));
  const within = (key: string) => {
    const n = dayNumber(key);
    return Number.isFinite(n) && today - n <= DUPLICATE_WINDOW_DAYS && n - today <= DUPLICATE_WINDOW_DAYS;
  };
  const money = input.fmt(input.cents / 100);

  for (const a of input.activity) {
    if (a.outcome === 'failed' || rawIban(a.iban) !== input.iban || Math.round(a.amount * 100) !== input.cents) continue;
    const at = new Date(a.at);
    if (!within(dayKey(at))) continue;
    const when = dayKey(at) === isoDate(now) ? `Heute um ${fmtTime(at)}` : `Am ${fmtDate(at)} um ${fmtTime(at)}`;
    const who = displayName(a.name) || input.name;
    return {
      sentence: a.outcome === 'executed'
        ? `${when} hast du bereits ${money} an ${who} überwiesen.`
        : `${when} hast du bereits eine Überweisung über ${money} an ${who} gesendet, deren Ausführung nicht bestätigt wurde.`,
    };
  }

  let best: { tx: SerializedTransaction; day: string } | null = null;
  for (const list of Object.values(input.txByAccount)) {
    for (const tx of list ?? []) {
      if (!(tx.amount < 0) || Math.round(-tx.amount * 100) !== input.cents) continue;
      if (rawIban(tx.remoteIban) !== input.iban) continue;
      const day = dayKey(tx.entryDate);
      if (!within(day)) continue;
      if (!best || day > best.day) best = { tx, day };
    }
  }
  if (!best) return null;
  const who = displayName(best.tx.remoteName) || input.name;
  const date = fmtDate(toLocalDate(best.day) ?? best.day);
  const kind = bookingKind(best.tx);
  return {
    sentence: kind === 'lastschrift'
      ? `Am ${date} hat ${who} bereits ${money} per Lastschrift eingezogen.`
      : `Am ${date} hast du bereits ${money} an ${who} überwiesen.`,
  };
}

// ---------------------------------------------------------------------------
// The bank's answer
// ---------------------------------------------------------------------------

/**
 * The bank's answer to an executed order as lines of its own words. The wire
 * carries "20: Auftrag ausgeführt. | 3076: Keine starke Kundenauthentifizierung
 * notwendig." — the numeric return codes are protocol and stay out of the
 * interface; the text after them is kept exactly as the bank wrote it.
 */
export function bankAnswerLines(text: string | null | undefined): string[] {
  const lines = String(text ?? '')
    .split(/\s+\|\s+|\r?\n/)
    .map((l) => l.replace(/^\s*(?:\d{1,4}:|\d{4}(?=\s))\s*/, '').trim())
    .filter(Boolean);
  return [...new Set(lines)];
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
