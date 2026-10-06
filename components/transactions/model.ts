// What the Umsätze views derive from a booking — kept apart from the React
// code so the list, the Vorgemerkt panel and the detail drawer all read a
// booking the same way, and so the per-booking work (decoding bank text,
// splitting the SEPA tags off the purpose) is done once per booking rather
// than once per render.
//
// Nothing here talks to the bank or the provider: plain functions over the
// bookings that are already loaded.
//
// What it says in words — the second line's "Kartenzahlung", a country, a
// reference's label — is in the language speaking right now (lib/i18n). So
// the per-booking cache is kept per language, and a list that memoises
// anything built here lists the texts (`t`) among its dependencies.

import { facilitatorShop } from '@/lib/analytics';
import type { TransferPrefill } from '@/lib/app-types';
import { parseCardAcceptor, parseCardPurpose, type CardPurpose } from '@/lib/card-purpose';
import { bookingKind, foldText, isBusinessCredit, type BookingKind } from '@/lib/categorize';
import { counterpartyName, intermediaryName, rawCounterparty, txCreditorId, type CategoryId } from '@/lib/categories';
import type { Merchant, SerializedTransaction } from '@/lib/fints-types';
import {
  dayKey, displayName, fmtAmountInput, fmtDate, fmtDayHeader, fmtIban, ibanValid, isFutureDate, prettyBookingText,
  prettyPurpose, repairBankText, toLocalDate,
} from '@/lib/format';
import { activeLocale, intlLocale, msgs, type Locale } from '@/lib/i18n';
import { facilitatorOf, getMerchantKey } from '@/lib/merchant-match';
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
  /**
   * The intermediary the payment went through when the bank names a different
   * party behind it — the card processor of a Visa Debit payment. The IBAN on
   * the booking is this one's, not the shop's. Null otherwise.
   */
  via: string | null;
  /**
   * The counterparty exactly as the bank's FinTS answer names it — the card
   * terminal's whole descriptor ("LS Caf Nova Deutzer F/Frankenwerft 1/Kln/DE")
   * where `name` shows the shop. Only encoding damage is repaired.
   */
  bankName: string;
  /** Where a card payment's terminal stood, from the merchant descriptor. Null for anything else. */
  place: { street: string | null; city: string | null; country: string | null } | null;
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
// object itself is a safe cache key — and the cache dies with it. One cache
// per language: what a booking says in words is said in the language on screen.
const textCaches = new Map<Locale, WeakMap<SerializedTransaction, TxText>>();

function textCache(): WeakMap<SerializedTransaction, TxText> {
  const locale = activeLocale();
  let cache = textCaches.get(locale);
  if (!cache) textCaches.set(locale, (cache = new WeakMap()));
  return cache;
}

const regionNames = new Map<Locale, Intl.DisplayNames | null>();

/** A country code in the language speaking right now ("NL" → "Niederlande", "Netherlands"), or the code itself. */
export function countryName(code: string | null | undefined): string {
  if (!code) return '';
  const locale = activeLocale();
  let names = regionNames.get(locale);
  if (names === undefined) {
    try { names = new Intl.DisplayNames([locale], { type: 'region' }); } catch { names = null; }
    regionNames.set(locale, names);
  }
  try { return names?.of(code) ?? code; } catch { return code; }
}

/**
 * A day and month without the year, the way the language writes them:
 * "30.09." ("30/09"). A leap year stands in for the one a record does not
 * name, so a 29 February stays one; digits that name no day at all are
 * shown as they came rather than as some other day.
 */
function dayMonth(day: number, month: number): string {
  const date = new Date(2000, month - 1, day);
  if (date.getMonth() !== month - 1 || date.getDate() !== day) {
    return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.`;
  }
  return new Intl.DateTimeFormat(intlLocale(), { day: '2-digit', month: '2-digit' }).format(date);
}

/** "Köln" at home, "Amsterdam-Dui, Niederlande" abroad, the country alone for an online shop. */
function placeLabel(place: TxText['place']): string {
  if (!place) return '';
  const abroad = place.country && place.country !== 'DE' ? countryName(place.country) : '';
  return [place.city, abroad].filter(Boolean).join(', ');
}

/** The card the way people name it: "Visa Debit", "girocard", "Debitkarte" — or null. */
function cardName(card: CardPurpose): string | null {
  const words = msgs().transactions.card;
  return card.scheme
    ? card.scheme.replace(/^VISA\b/, 'Visa')
    : card.card === 'credit' ? words.creditCard : card.card === 'debit' ? words.debitCard : null;
}

/** "Visa Debit" / "Debitkarte" / "Kartenzahlung" — and a refund says it is one. */
function cardLabel(card: CardPurpose, credit: boolean): string {
  const words = msgs().transactions.card;
  const base = cardName(card);
  if (!base) return credit ? words.credit : words.payment;
  return credit ? words.creditVia(base) : base;
}

// The payment services whose own spelling the list uses for "über …".
const SERVICE_NAMES: Record<string, string> = {
  paypal: 'PayPal', klarna: 'Klarna', sofort: 'Sofort', stripe: 'Stripe', mollie: 'Mollie', adyen: 'Adyen',
  sumup: 'SumUp', unzer: 'Unzer', payone: 'Payone', giropay: 'giropay', paydirekt: 'paydirekt', wero: 'Wero',
};

/** "PayPal" for "PAYPAL EUROPE S.A.R.L. ET CIE S.C.A". */
export function serviceName(raw: string): string {
  const id = facilitatorOf(raw);
  return (id && SERVICE_NAMES[id]) || displayName(raw);
}

// A cash machine's own record: "GA NR00004471 BLZ57069999 0 17.09/15.55".
const ATM_RECORD = /\bGA\s?NR\S*\s+BLZ\s?\d+\s+\d+\s+(\d{2})\.(\d{2})\/(\d{2})\.(\d{2})\b/;

export function txText(tx: SerializedTransaction): TxText {
  const cache = textCache();
  const hit = cache.get(tx);
  if (hit) return hit;
  const words = msgs().transactions;
  // The shop, when the bank names one behind its card processor — what the
  // Sparkasse's own app shows. The processor stays available as `via`.
  const rawName = repairBankText(counterpartyName(tx)).replace(/\s+/g, ' ').trim();
  const viaRaw = intermediaryName(tx);
  const via = viaRaw ? displayName(repairBankText(viaRaw).replace(/\s+/g, ' ').trim()) : null;
  const parsed = parsePurpose(repairBankText(tx.purpose ?? ''));
  const bookingText = prettyBookingText(repairBankText(tx.bookingText ?? ''));
  // A purchase through a payment service (PayPal) is the shop's, as the
  // purpose names it ("Ihr Einkauf bei ZALANDO SE"); the service is named on
  // the second line and in the drawer, which keeps the bank's name.
  const shop = facilitatorShop(tx);
  const name = (shop && displayName(repairBankText(shop))) || displayName(rawName) || bookingText || words.fallbackName;
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
  // A girocard terminal's record starts with its own descriptor ("REWE SAGT
  // DANKE//MUSTERSTADT/DE"): the shop again, and where it stood.
  const echo = card?.rest ? parseCardAcceptor(card.rest) : null;
  // Where the terminal stood, from the shop's descriptor ("…/Kln/DE" → Köln).
  const acceptor = parseCardAcceptor(rawCounterparty(tx)) ?? echo;
  const place = acceptor && (acceptor.street || acceptor.city || acceptor.country)
    ? { street: acceptor.street, city: acceptor.city, country: acceptor.country }
    : null;
  const where = placeLabel(place);
  const atm = kind === 'bargeld' ? ATM_RECORD.exec(parsed.text) : null;
  let summary = card
    ? [
        cardLabel(card, tx.amount > 0),
        where,
        card.original && card.original.currency !== 'EUR' ? words.card.foreignCurrency(card.original.currency) : '',
        echo ? '' : prettyPurpose(card.rest),
      ].filter(Boolean).join(' · ')
    : atm
      // "Geldautomat · 17.09., 15:55" — what the machine's record says, in words.
      ? words.card.atm(dayMonth(+atm[1], +atm[2]), `${atm[3]}:${atm[4]}`)
      : shop
        ? words.via(serviceName(rawName))
        : condenseRefs(prettyPurpose(parsed.text));
  if (summary && foldText(summary) === foldText(rawName)) summary = '';
  // A card payment's "purpose" is the terminal's own record — the shop name
  // again, a city, a timestamp, a card sequence number. On a scannable list
  // the words "Kartenzahlung" say more; the record stays in the details.
  if (summary && kind === 'karte' && !card) {
    const head = foldText(rawName).split(' ')[0];
    if (!head || foldText(summary).startsWith(head)) summary = '';
  }
  if (!summary && rawName) summary = bookingText || (kind === 'karte' ? words.card.payment : '');
  // The town is worth its place on the line even when the purpose said
  // nothing else ("Kartenzahlung · Köln").
  if (where && !card && kind === 'karte' && summary && !summary.includes(where)) summary = `${summary} · ${where}`;
  const out: TxText = {
    name,
    rawName,
    via,
    bankName: repairBankText(rawCounterparty(tx)).replace(/\s+/g, ' ').trim(),
    place,
    summary,
    purposeLines: purposeLines(parsed.text),
    parsed,
    bookingText,
    kind,
  };
  cache.set(tx, out);
  return out;
}

/**
 * What the list and the drawer show of a booking that its raw strings do not
 * hold — the tidied name, the second line, the shop's town and country, the
 * repaired letters — for the search (lib/analytics SearchContext.shownText).
 * A word read on screen then finds its row.
 */
export function searchText(tx: SerializedTransaction): string {
  const t = txText(tx);
  return [
    t.name, t.rawName, t.via, t.bankName, t.summary, t.bookingText, t.purposeLines.join(' '),
    t.place?.street, t.place?.city, t.place?.country ? countryName(t.place.country) : '',
  ].filter(Boolean).join(' ');
}

/** What a card payment's record says, in the words the drawer uses. */
export type CardFacts = {
  /** When the card was used, as the terminal recorded it: local day and "08:12". */
  usedAt: { day: string; time: string | null } | null;
  /** "girocard", "Visa Debit", "Debitkarte" — null when the record does not say. */
  card: string | null;
  /** The amount in the currency the shop charged, for a foreign-currency payment. */
  original: { amount: number; currency: string; rate: number | null } | null;
  /** The card-usage fee the record names, in EUR. */
  fee: number | null;
  /** The fee demonstrably sits inside the booked amount (original ÷ rate + fee = amount, to the cent). */
  feeIncluded: boolean;
};

export function cardFacts(tx: SerializedTransaction): CardFacts | null {
  const card = parseCardPurpose(txText(tx).parsed.text);
  if (!card) return null;
  const m = card.at ? /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(card.at) : null;
  const original = card.original && card.original.currency !== 'EUR' ? card.original : null;
  let feeIncluded = false;
  if (original?.rate && card.fee != null && (tx.currency || 'EUR') === 'EUR') {
    const converted = cents(original.amount / original.rate);
    feeIncluded = Math.abs(Math.abs(cents(tx.amount)) - (converted + cents(card.fee))) <= 1;
  }
  return {
    usedAt: m ? { day: m[1], time: m[2] } : null,
    card: cardName(card),
    original,
    fee: card.fee,
    feeIncluded,
  };
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
  return merchants[getMerchantKey(tx)] ?? merchants[counterpartyName(tx)] ?? null;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** "30.09." ("30/09") — the year is the one the list is already in. */
export function shortDay(d: Date | string | null | undefined): string {
  const date = toLocalDate(d);
  if (!date) return '';
  return dayMonth(date.getDate(), date.getMonth() + 1);
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
  const words = msgs().transactions;
  const entry = dayKey(tx.entryDate);
  const value = dayKey(tx.valueDate);
  const title = [entry && words.row.entryDate(fmtDate(tx.entryDate)), value && words.row.valueDate(fmtDate(tx.valueDate))]
    .filter(Boolean)
    .join(' · ');
  if (pending) {
    return value
      ? { text: words.row.value(shortDay(tx.valueDate)), title }
      : { text: words.state.pending, title: words.notBooked };
  }
  // Naming the field stops a forward-dated Buchungstag from reading like the
  // day the money moved.
  if (entry && isFutureDate(tx.entryDate)) return { text: words.row.booking(shortDay(tx.entryDate)), title };
  if (entry && value && entry !== value) return { text: words.row.value(shortDay(tx.valueDate)), title };
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
  const { common, transactions: words } = msgs();
  const { kind, bookingText } = txText(tx);
  const tags: StatusTag[] = [];
  if (pending) tags.push({ label: common.booking.pending, tone: 'pending', icon: 'clock' });
  else if (isFutureDate(tx.entryDate)) tags.push({ label: words.notBooked, tone: 'neutral', icon: 'clock' });
  if (kind !== 'sonstige') {
    const label = words.kinds[kind];
    // The bank's own booking text is already shown beside the tags; a tag
    // that only repeats it is noise — and so is one whose word the text
    // already holds ("Gehalt/Rente" beside "Lohn/Gehalt", "Lastschrift"
    // beside "Basislastschrift"). A tag that adds something ("Kartenzahlung"
    // beside "Lastschrift") stays. The bank's text is German, so in another
    // language the tag never repeats it: there it says what the text means.
    const shown = foldText(bookingText).replace(/ /g, '');
    const repeats = !!shown && foldText(label).split(' ').some((w) => w.length >= 5 && shown.includes(w));
    if (!repeats) {
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
  const { common, transactions: { refs } } = msgs();
  const { parsed } = txText(tx);
  const field = (tag: string) => parsed.fields.find((f) => f.tag === tag)?.value ?? '';
  // The tags' own values first, as on paper (lib/print-doc.ts
  // bookingReferences): where a bank ran the tags together, the library files
  // everything after "EREF+" — MREF, CRED and the prose — as the End-to-End
  // reference.
  const rows: RefRow[] = [
    { label: refs.e2e, value: realRef(field('EREF')) || realRef(tx.e2eReference) },
    { label: refs.mandate, value: realRef(field('MREF')) || realRef(tx.mandateReference) },
    { label: common.booking.creditorId, value: txCreditorId(tx) ?? '' },
    { label: refs.customer, value: realRef(tx.customerReference) || realRef(field('KREF')) },
    ...parsed.fields.filter((f) => !OWN_ROW_TAGS.has(f.tag)).map((f) => ({ label: f.label, value: f.value })),
    { label: refs.bank, value: realRef(tx.bankReference) },
    { label: refs.primanota, value: String(tx.primeNotesNr ?? '').trim() },
    { label: refs.statementNo, value: String(tx.statementNumber ?? '').trim() },
    { label: refs.code, value: String(tx.transactionCode ?? '').trim() },
    { label: refs.extra, value: repairBankText(String(tx.additionalInformation ?? '')).trim() },
  ];
  // The purpose exactly as the bank sent it, when the tidy version above
  // took it apart — some disputes need the original string.
  if (parsed.fields.length) rows.push({ label: refs.original, value: repairBankText(tx.purpose ?? '').trim() });
  return rows.filter((r) => r.value);
}

// Kinds that cannot be "sent again" by an Überweisung: the money was pulled
// (Lastschrift), paid at a terminal (Karte), or moved by the bank itself.
const NOT_REPEATABLE = new Set<BookingKind>(['lastschrift', 'karte', 'ruecklastschrift', 'bargeld', 'entgelt', 'zinsen']);
// Credits nobody pays back: what the bank booked itself, a salary or a
// pension (sending an employer its payroll back is not a thing anyone
// means), a card refund from a shop, and a direct debit that came back.
const NOT_REFUNDABLE = new Set<BookingKind>(['bargeld', 'entgelt', 'zinsen', 'gehalt', 'karte', 'lastschrift', 'ruecklastschrift']);

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
 * - "Zurücküberweisen": a credit from a person, for the same amount. Not
 *   income (a booking the bank marks as Gehalt/Rente, or one filed under
 *   "Einkommen" by the app or the user, passed as `category`), and nothing a
 *   business sent: no refund (Erstattung, Retoure, Gutschrift in the
 *   purpose), no counterparty with a Gläubiger-ID or a payment service, no
 *   credit filed under a spending category or an Umbuchung. Nobody sends a
 *   refund back.
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
  const { rawName, kind, parsed, via } = txText(tx);
  if (!rawName) return none;
  // Behind an intermediary the IBAN is the intermediary's and the name is
  // the shop's: a transfer seeded from both would fail the Namensabgleich at
  // best and pay the card processor at worst.
  if (via) return none;
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
  if (tx.amount > 0 && !NOT_REFUNDABLE.has(kind) && category !== 'income' && !isBusinessCredit(tx, category)) {
    // The prefilled reference is the user's own, in the language they read.
    const { seeds } = msgs().transactions;
    const purpose = prose ? seeds.refund(prose) : seeds.refundDated(fmtDate(tx.entryDate || tx.valueDate));
    return {
      repeat: null,
      refund: { name: rawName, iban, amount, purpose: clip(purpose, PURPOSE_MAX), source: 'refund' },
    };
  }
  return none;
}

/**
 * What "Alle Umsätze mit …" searches for: the IBAN when there is one (exact,
 * however the name was spelled on each booking) — in its groups of four, the
 * way people read and recognise one in the search field — else the name.
 * Behind an intermediary the IBAN is shared by every shop it serves — every
 * Visa Debit payment of a Sparkasse customer carries the card processor's —
 * so there the shop's name is the only thing that finds the right bookings;
 * and behind a payment service (PayPal) it is the shop the purpose names.
 */
export function counterpartyQuery(tx: SerializedTransaction): string | null {
  const { rawName, via } = txText(tx);
  const shop = facilitatorShop(tx);
  if (shop) return shop;
  const iban = compactIban(tx.remoteIban);
  if (!via && ibanValid(iban)) return fmtIban(iban);
  return rawName.length >= 2 ? rawName : null;
}
