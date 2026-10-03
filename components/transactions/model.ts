// What the Umsätze views derive from a booking — kept apart from the React
// code so the list, the Vorgemerkt panel and the detail drawer all read a
// booking the same way, and so the per-booking work (decoding bank text,
// splitting the SEPA tags off the purpose) is done once per booking rather
// than once per render.
//
// Nothing here talks to the bank or the provider: plain functions over the
// bookings that are already loaded.

import type { TransferPrefill } from '@/lib/app-types';
import { parseCardPurpose } from '@/lib/card-purpose';
import { bookingKind, bookingKindLabel, foldText, type BookingKind } from '@/lib/categorize';
import { txCreditorId, type CategoryId } from '@/lib/categories';
import type { Merchant, SerializedTransaction } from '@/lib/fints-types';
import {
  dayKey, displayName, fmtAmountInput, fmtDate, fmtDayHeader, ibanValid, isFutureDate, prettyBookingText,
  prettyPurpose, repairBankText, toLocalDate,
} from '@/lib/format';
import { getMerchantKey } from '@/lib/merchant-match';
import { condenseRefs, parsePurpose, purposeLines, type ParsedPurpose } from '@/lib/sepa-purpose';

const cents = (v: number) => Math.round(Number(v) * 100);

/** "NOTPROVIDED" / "NONREF" are SEPA's way of saying there is no reference. */
export const realRef = (s: string | null | undefined): string => {
  const v = String(s ?? '').trim();
  return v && v !== 'NOTPROVIDED' && v !== 'NONREF' ? v : '';
};

const compactIban = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, '').toUpperCase();

// ---------------------------------------------------------------------------
// One booking, read once
// ---------------------------------------------------------------------------

export type TxText = {
  /** The counterparty as a person would write it ("DB VERTRIEB GMBH" → "DB Vertrieb GmbH"). */
  name: string;
  /** Exactly as the bank stored it (mis-decoded umlauts repaired) — for the detail view and prefills. */
  rawName: string;
  /** The SVWZ prose in readable case, machine identifiers cut to a stub — the list's second line. */
  summary: string;
  /** The SVWZ prose, uncut, one entry per line the bank wrote. */
  purposeLines: string[];
  /** The whole purpose split into prose and tagged identifiers. */
  parsed: ParsedPurpose;
  /** The bank's booking text in readable case ("Folgelastschrift"). */
  bookingText: string;
  kind: BookingKind;
};

// Bookings are immutable once loaded (a refresh brings new objects), so the
// object itself is a safe cache key — and the cache dies with it.
const textCache = new WeakMap<SerializedTransaction, TxText>();

export function txText(tx: SerializedTransaction): TxText {
  const hit = textCache.get(tx);
  if (hit) return hit;
  const rawName = repairBankText(tx.remoteName ?? '').replace(/\s+/g, ' ').trim();
  const parsed = parsePurpose(repairBankText(tx.purpose ?? ''));
  const bookingText = prettyBookingText(repairBankText(tx.bookingText ?? ''));
  const name = displayName(rawName) || bookingText || 'Buchung';
  // The second line repeats nothing the first already says: a purpose that
  // is just the payee's name again gives way to the booking text.
  const kind = bookingKind(tx);
  // Re-cased for reading ("MIETE WHG 3.OG" → "Miete WHG 3.OG") and rid of
  // PayPal's reference block — the list only; the drawer keeps the bank's
  // own text.
  // A card system's record ("2026-08-18T10:12 Debitk.0 2030-12 Einsatzentgelt
  // 1,00 EUR Zahl.System VISA Debit") is said in words a person scans for:
  // the scheme, a foreign currency if there was one, and whatever note the
  // record doesn't explain. No amounts — this line is a plain string, and
  // "Beträge ausblenden" can only mask what goes through <Money>.
  const card = parseCardPurpose(parsed.text);
  let summary = card
    ? [
        card.scheme ? card.scheme.replace(/^VISA\b/, 'Visa') : card.card === 'credit' ? 'Kreditkarte' : 'Debitkarte',
        card.original && card.original.currency !== 'EUR' ? `Fremdwährung ${card.original.currency}` : '',
        prettyPurpose(card.rest),
      ].filter(Boolean).join(' · ')
    : condenseRefs(prettyPurpose(parsed.text));
  if (summary && foldText(summary) === foldText(rawName)) summary = '';
  // A card payment's "purpose" is the terminal's own record — the shop name
  // again, a city, a timestamp, a card sequence number. On a scannable list
  // the words "Kartenzahlung" say more; the record stays in the details.
  if (summary && kind === 'karte') {
    const head = foldText(rawName).split(' ')[0];
    if (!head || foldText(summary).startsWith(head)) summary = '';
  }
  if (!summary && rawName) summary = bookingText || (kind === 'karte' ? 'Kartenzahlung' : '');
  const out: TxText = {
    name,
    rawName,
    summary,
    purposeLines: purposeLines(parsed.text),
    parsed,
    bookingText,
    kind,
  };
  textCache.set(tx, out);
  return out;
}

// A stable React key per loaded booking. Two bookings can be identical in
// every field (two coffees, same shop, same day), so the key is the object's
// identity, not its content.
const keys = new WeakMap<SerializedTransaction, number>();
let nextKey = 1;
export function rowKey(tx: SerializedTransaction): number {
  let k = keys.get(tx);
  if (k === undefined) {
    k = nextKey++;
    keys.set(tx, k);
  }
  return k;
}

/**
 * The brand behind a booking — the same lookup `useMerchant` makes, as a plain
 * function so a long list can resolve every row once in its parent instead of
 * subscribing each row to the provider.
 */
export function merchantFor(merchants: Record<string, Merchant | null>, tx: SerializedTransaction): Merchant | null {
  return merchants[getMerchantKey(tx)] ?? merchants[(tx.remoteName || '').trim()] ?? null;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** "30.09." — the year is the one the list is already in. */
export function shortDay(d: Date | string | null | undefined): string {
  const date = toLocalDate(d);
  if (!date) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.`;
}

/**
 * The small note under a row's amount — only when it tells the reader
 * something the day header above it does not:
 *
 * - a Vormerkposten: the day it will be value-dated, if the bank said;
 * - a Buchungstag still ahead: when it will actually be booked;
 * - a Wertstellung on another day than the Buchung (card payments, weekend
 *   transfers): the day the money really moved, which is what interest and
 *   an overdraft are counted from.
 */
export function rowNote(tx: SerializedTransaction, pending: boolean): { text: string; title: string } | null {
  const entry = dayKey(tx.entryDate);
  const value = dayKey(tx.valueDate);
  const title = [entry && `Buchungstag ${fmtDate(tx.entryDate)}`, value && `Wertstellung ${fmtDate(tx.valueDate)}`]
    .filter(Boolean)
    .join(' · ');
  if (pending) {
    return value ? { text: `Wert ${shortDay(tx.valueDate)}`, title } : { text: 'vorgemerkt', title: 'Noch nicht gebucht' };
  }
  // Naming the field stops a forward-dated Buchungstag from reading like the
  // day the money moved.
  if (entry && isFutureDate(tx.entryDate)) return { text: `Buchung ${shortDay(tx.entryDate)}`, title };
  if (entry && value && entry !== value) return { text: `Wert ${shortDay(tx.valueDate)}`, title };
  return null;
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

/**
 * Newest first, by local Buchungstag. Within one day the statement's own
 * order is reversed rather than re-sorted: banks list a day's bookings in the
 * order they posted, and that order is the only time-of-day there is.
 */
export function newestFirst(txs: readonly SerializedTransaction[]): SerializedTransaction[] {
  return txs
    .map((tx, i) => ({ tx, i, day: dayKey(tx.entryDate || tx.valueDate) }))
    .sort((a, b) => (a.day === b.day ? b.i - a.i : a.day < b.day ? 1 : -1))
    .map((x) => x.tx);
}

export type DayGroup = {
  key: string;
  label: string;
  /** The Buchungstag is still ahead — the bank has stamped it, not booked it. */
  future: boolean;
  /** The day's net in one currency; null when a day mixes currencies (never added together). */
  net: number | null;
  currency: string;
  txs: SerializedTransaction[];
};

/** Consecutive bookings of one local day, in the order given. */
export function groupByDay(txs: readonly SerializedTransaction[], today = new Date()): DayGroup[] {
  const out: DayGroup[] = [];
  let netCents = 0;
  for (const tx of txs) {
    const date = tx.entryDate || tx.valueDate;
    const key = dayKey(date) || 'none';
    let g = out[out.length - 1];
    if (!g || g.key !== key) {
      if (g && g.net !== null) g.net = netCents / 100;
      netCents = 0;
      g = { key, label: fmtDayHeader(date, today), future: isFutureDate(date), net: 0, currency: tx.currency || 'EUR', txs: [] };
      out.push(g);
    }
    g.txs.push(tx);
    if (g.net !== null) {
      if ((tx.currency || 'EUR') !== g.currency) g.net = null;
      else netCents += cents(tx.amount);
    }
  }
  const last = out[out.length - 1];
  if (last && last.net !== null) last.net = netCents / 100;
  return out;
}

export type Totals = { count: number; income: number; expense: number; currency: string; otherCurrency: number };

/**
 * What the filtered list adds up to — plainly the credits and the debits it
 * shows, Umbuchungen included (this is a sum of the rows on screen, not the
 * Analyse tab's income/expense). One currency only: rows in another are
 * counted, not added.
 */
export function listTotals(txs: readonly SerializedTransaction[], currency: string): Totals {
  let inC = 0;
  let outC = 0;
  let otherCurrency = 0;
  for (const tx of txs) {
    if ((tx.currency || 'EUR') !== currency) {
      otherCurrency++;
      continue;
    }
    const c = cents(tx.amount);
    if (c > 0) inC += c;
    else outC += c;
  }
  return { count: txs.length, income: inC / 100, expense: outC / 100, currency, otherCurrency };
}

// ---------------------------------------------------------------------------
// The detail drawer
// ---------------------------------------------------------------------------

export type StatusTag = { label: string; tone: 'neutral' | 'info' | 'positive' | 'pending' | 'emphasis'; icon?: 'clock' | 'bolt' | 'repeat' };

const KIND_TONE: Partial<Record<BookingKind, StatusTag['tone']>> = {
  echtzeit: 'info',
  gutschrift: 'positive',
  gehalt: 'positive',
  // A returned direct debit wants a look; orange marks it without claiming
  // an error the bank did not report.
  ruecklastschrift: 'emphasis',
};

/** The words for the kind of booking and its state — never a code. */
export function statusTags(tx: SerializedTransaction, pending: boolean): StatusTag[] {
  const { kind, bookingText } = txText(tx);
  const tags: StatusTag[] = [];
  if (pending) tags.push({ label: 'Vorgemerkt', tone: 'pending', icon: 'clock' });
  else if (isFutureDate(tx.entryDate)) tags.push({ label: 'Noch nicht gebucht', tone: 'neutral', icon: 'clock' });
  if (kind !== 'sonstige') {
    const label = bookingKindLabel(kind);
    // The bank's own booking text is already shown beside the tags; a tag
    // that only repeats it is noise.
    if (foldText(label) !== foldText(bookingText)) {
      tags.push({
        label,
        tone: KIND_TONE[kind] ?? 'neutral',
        icon: kind === 'echtzeit' ? 'bolt' : kind === 'dauerauftrag' ? 'repeat' : undefined,
      });
    }
  }
  return tags;
}

export type RefRow = { label: string; value: string };

// Tags that have a row of their own below (or are the prose itself).
const OWN_ROW_TAGS = new Set(['SVWZ', 'EREF', 'MREF', 'CRED', 'KREF']);

/**
 * The identifiers a booking carries, labelled in words. Everything a support
 * call or a dispute might ask for, and nothing the list itself needs — so it
 * lives behind the collapsed "Referenzen" section.
 */
export function referenceRows(tx: SerializedTransaction): RefRow[] {
  const { parsed } = txText(tx);
  const field = (tag: string) => parsed.fields.find((f) => f.tag === tag)?.value ?? '';
  const rows: RefRow[] = [
    { label: 'End-to-End-Referenz', value: realRef(tx.e2eReference) || realRef(field('EREF')) },
    { label: 'Mandatsreferenz', value: realRef(tx.mandateReference) || realRef(field('MREF')) },
    { label: 'Gläubiger-ID', value: txCreditorId(tx) ?? '' },
    { label: 'Kundenreferenz', value: realRef(tx.customerReference) || realRef(field('KREF')) },
    ...parsed.fields.filter((f) => !OWN_ROW_TAGS.has(f.tag)).map((f) => ({ label: f.label, value: f.value })),
    { label: 'Bankreferenz', value: realRef(tx.bankReference) },
    { label: 'Primanota', value: String(tx.primeNotesNr ?? '').trim() },
    { label: 'Auszug-Nr.', value: String(tx.statementNumber ?? '').trim() },
    { label: 'Geschäftsvorfall-Code', value: String(tx.transactionCode ?? '').trim() },
    { label: 'Zusatzinformation', value: repairBankText(String(tx.additionalInformation ?? '')).trim() },
  ];
  // The purpose exactly as the bank sent it, when the tidy version above
  // took it apart — some disputes need the original string.
  if (parsed.fields.length) rows.push({ label: 'Verwendungszweck (Original)', value: repairBankText(tx.purpose ?? '').trim() });
  return rows.filter((r) => r.value);
}

// Kinds that cannot be "sent again" by an Überweisung: the money was pulled
// (Lastschrift), paid at a terminal (Karte), or moved by the bank itself.
const NOT_REPEATABLE = new Set<BookingKind>(['lastschrift', 'karte', 'ruecklastschrift', 'bargeld', 'entgelt', 'zinsen']);
// Credits nobody pays back: what the bank booked itself, and a salary or a
// pension — sending an employer its payroll back is not a thing anyone means.
const NOT_REFUNDABLE = new Set<BookingKind>(['bargeld', 'entgelt', 'zinsen', 'gehalt']);

const PURPOSE_MAX = 140;
const clip = (s: string, n: number) => {
  const chars = [...s];
  return chars.length > n ? `${chars.slice(0, n - 1).join('').trimEnd()}…` : s;
};

/**
 * The transfers a booking can seed. Prefill only — the form, its review step,
 * the Namensabgleich and the TAN all still follow.
 *
 * - "Erneut überweisen": a debit to a valid IBAN that was an Überweisung
 *   (not a Lastschrift or a card payment, which were never yours to send).
 * - "Zurücküberweisen": a credit from a valid IBAN, for the same amount —
 *   but not income: neither a booking the bank marks as Gehalt/Rente nor one
 *   filed under "Einkommen" (by the app or by the user), passed as `category`.
 */
export function transferSeeds(
  tx: SerializedTransaction,
  canTransfer: boolean,
  category?: CategoryId,
): { repeat: TransferPrefill | null; refund: TransferPrefill | null } {
  const none = { repeat: null, refund: null };
  if (!canTransfer) return none;
  const iban = compactIban(tx.remoteIban);
  if (!ibanValid(iban)) return none;
  const { rawName, kind, parsed } = txText(tx);
  if (!rawName) return none;
  const prose = purposeLines(parsed.text).join(' ').replace(/\s+/g, ' ').trim();
  const amount = fmtAmountInput(Math.abs(tx.amount));
  // Only euro bookings: the transfer form sends SEPA, and SEPA is euro.
  if ((tx.currency || 'EUR') !== 'EUR') return none;

  if (tx.amount < 0 && !NOT_REPEATABLE.has(kind)) {
    return {
      repeat: { name: rawName, iban, amount, purpose: prose ? clip(prose, PURPOSE_MAX) : undefined, source: 'repeat' },
      refund: null,
    };
  }
  if (tx.amount > 0 && !NOT_REFUNDABLE.has(kind) && category !== 'income') {
    const purpose = prose ? `Rückzahlung: ${prose}` : `Rückzahlung vom ${fmtDate(tx.entryDate || tx.valueDate)}`;
    return {
      repeat: null,
      refund: { name: rawName, iban, amount, purpose: clip(purpose, PURPOSE_MAX), source: 'refund' },
    };
  }
  return none;
}

/**
 * What "Alle Umsätze mit …" searches for: the IBAN when there is one (exact,
 * however the name was spelled on each booking), else the name.
 */
export function counterpartyQuery(tx: SerializedTransaction): string | null {
  const iban = compactIban(tx.remoteIban);
  if (ibanValid(iban)) return iban;
  const name = txText(tx).rawName;
  return name.length >= 2 ? name : null;
}
