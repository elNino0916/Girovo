// A credit card's bill, seen from two accounts at once.
//
// The card's purchases are bookings on the card account. Once a month the
// bank collects their sum from the current account ("Kreditkartenabrechnung")
// and books it on the card as a credit ("Ausgleich Kreditkarte"). Add the
// two accounts up and the bill is there twice: once as the purchases, once as
// the debit that paid them — and its credit on the card reads as income.
//
// Only that sum has the problem, so only that sum is touched: "Alle geladenen
// Konten" in the Umsatzanalyse (components/insights/analysis-model.ts) leaves
// each bill and its credit out, as it leaves out a transfer between two own
// IBANs. Nothing else changes — not a booking's category, not one account's
// figures, not Verträge, the forecast or a budget: each of those looks at one
// account, where the bill is the only trace of the card's spending.
//
// A pair is strict, since what it leaves out is money. The debit must say it
// is a card's bill in the words banks use for one (readsLikeCardBill); the
// credit on the card must name no shop or payee of its own; the sums must
// match to the cent. A refund on the card and a purchase of the same price
// on the current account are two real bookings, and stay.
//
// Pure and node-test-safe: no path aliases, `.ts` on sibling imports.

import type { SerializedAccount, SerializedTransaction } from './fints-types';
import { isCardAccount } from './balances.ts';
import { rawCounterparty } from './categories.ts';
import { bookingKind, foldText } from './categorize.ts';
import { dayKey, dayNumber } from './format.ts';
import { de as wordsDe, en as wordsEn } from './i18n/messages/transactions.ts';

/** How far apart the bill and its credit may be booked: ten days when the credit says it settles the card, else five. */
const WORDED_DAYS = 10;
const PLAIN_DAYS = 5;

/** A whole word, or a run of them, on folded text (foldText: upper case, umlauts spelled out, one space between words). */
const word = (alternatives: string) => `(?:^| )(?:${alternatives})(?= |$)`;

const CARDS = 'VISA|VISACARD|MASTERCARD|MASTER CARD|AMEX|AMERICAN EXPRESS';

/** A card, by name: what "Ausgleich" or "Umsatzabrechnung" needs beside it. */
const CARD_WORD = new RegExp(word(`KREDITKARTE|KREDITKARTEN|KARTE|${CARDS}`));

/** A card's number, as a statement prints it: digits, X-masked digits ("5232XXXXXXXX1234", "XXXX"). */
const CARD_NUMBER = '[0-9]*X{2,}[0-9X]*';

/**
 * A card's bill in the words banks use for one, on the debit — every one of
 * them whole words:
 *   KREDITKARTENABRECHNUNG, KREDITKARTENAUSGLEICH, KARTENABRECHNUNG, KARTENABR(.)
 *   K(REDIT)K(ARTE(N)) ABR(ECHNUNG): "KK-Abrechnung", "KK Abr 10/26", "Kreditkarten-Abrechnung"
 *   UMSATZABRECHNUNG followed by a card's masked number ("Umsatzabrechnung 5232XXXX…")
 *   CARD SETTLEMENT
 * then ABR(ECHNUNG) and a card's name in either order, near each other
 * (BILL_AND_CARD); and two that count only beside a card's name (CARD_WORD):
 * AUSGLEICH and UMSATZABRECHNUNG. "Ausgleich Rechnung 4711" is not a card's bill.
 */
const BILL = new RegExp([
  word('KREDITKARTENABRECHNUNG|KREDITKARTENAUSGLEICH|KARTENABRECHNUNG|KARTENABR'),
  word('K(?:REDIT)?K(?:ARTEN?)? ?ABR(?:ECHNUNG)?'),
  word(`UMSATZABRECHNUNG(?: [0-9]{4})? ${CARD_NUMBER}`),
  word('CARD SETTLEMENT'),
].join('|'));
const BESIDE_A_CARD = new RegExp(word('AUSGLEICH|UMSATZABRECHNUNG'));

/** The cards by name as single words, for BILL_AND_CARD ("MASTER CARD" and "AMERICAN EXPRESS" joined first). */
const CARD_NAMES = new Set(['KREDITKARTE', 'KREDITKARTEN', 'KREDITK', 'VISA', 'VISACARD', 'MASTERCARD', 'AMEX']);
const BILL_WORDS = new Set(['ABRECHNUNG', 'ABR']);
/** A date's or a number's part, a masked card number: what may stand between the two without meaning anything. */
const FILLER = new RegExp(`^(?:[0-9][0-9X]*|${CARD_NUMBER})$`);
/** How far apart ABRECHNUNG and the card's name may be: six words between, at most two of them real words. */
const BETWEEN = 6;
const REAL_BETWEEN = 2;

/**
 * Whether ABR(ECHNUNG) and a card's name stand near each other, in either
 * order: "Abrechnung vom 15.10.2026 Mastercard 5232XX…", "Kreditkarte 5232
 * XXXX … Abrechnung 10/26", "KREDITK. 5232 ABR.", "Abrechnung Ihrer
 * Mastercard". Dates and card numbers between them do not count against it;
 * real words do — "Abrechnung Stadtwerke Strom Zahlung per Visa" is no card's bill.
 */
function billAndCard(text: string): boolean {
  const tokens = text.replace(/(^| )MASTER CARD(?= |$)/g, '$1MASTERCARD').replace(/(^| )AMERICAN EXPRESS(?= |$)/g, '$1AMEX').split(' ');
  const bills = tokens.flatMap((t, i) => (BILL_WORDS.has(t) ? [i] : []));
  const cards = tokens.flatMap((t, i) => (CARD_NAMES.has(t) ? [i] : []));
  return bills.some((b) => cards.some((c) => {
    const between = tokens.slice(Math.min(b, c) + 1, Math.max(b, c));
    return between.length <= BETWEEN && between.filter((t) => !FILLER.test(t)).length <= REAL_BETWEEN;
  }));
}

/**
 * Girovo's own words, never the bank's: the Buchungstext lib/fints-cards.ts
 * gives every card booking read over DKKKU, in the language it was read in,
 * and its kin. A card purchase is not a bill because Girovo called it a
 * "Kreditkartenumsatz".
 */
const OWN_LABELS = new RegExp(word([
  foldText(wordsDe.api.cardBooking), foldText(wordsEn.api.cardBooking),
  'KREDITKARTENUMSATZ', 'KREDITKARTENUMSAETZE', 'KREDITKARTENZAHLUNG', 'KREDITKARTENENTGELT',
].join('|')), 'g');

/** What a booking says, folded, without Girovo's own labels. */
const said = (tx: Pick<SerializedTransaction, 'bookingText' | 'purpose' | 'remoteName'>) =>
  foldText(`${tx.bookingText ?? ''} ${tx.purpose ?? ''} ${tx.remoteName ?? ''}`).replace(OWN_LABELS, ' ').replace(/ +/g, ' ').trim();

/** Whether a booking calls itself a credit card's bill (BILL; AUSGLEICH or UMSATZABRECHNUNG only beside a card's name). */
export function readsLikeCardBill(tx: Pick<SerializedTransaction, 'bookingText' | 'purpose' | 'remoteName'>): boolean {
  const text = said(tx);
  return BILL.test(text) || billAndCard(text) || (BESIDE_A_CARD.test(text) && CARD_WORD.test(text));
}

/** A payment's words: where a card's credit says it was paid. Not "Gutschrift" — every credit is one. */
const PAYMENT = new RegExp(word('AUSGLEICH|ZAHLUNG|ZAHLUNGSEINGANG|EINZAHLUNG|PAYMENT'));
/**
 * The words a bank puts where a payee's name would be on a payment to the
 * card — "IHRE ZAHLUNG – DANKE", "Einzug vom Girokonto", "Habenbuchung
 * Ausgleich", what a card read over DKKKU carries as its "shop": no name of anyone.
 */
const NOT_A_NAME = new Set([
  'GUTSCHRIFT', 'HABENBUCHUNG', 'AUSGLEICH', 'ZAHLUNG', 'ZAHLUNGSEINGANG', 'EINZAHLUNG', 'PAYMENT', 'RECEIVED', 'THANK', 'YOU',
  'IHRE', 'IHR', 'FUER', 'DANKE', 'VIELEN', 'DANK', 'ERHALTEN', 'EINZUG', 'LASTSCHRIFT', 'LASTSCHRIFTEINZUG', 'UEBERWEISUNG', 'SEPA',
  'VOM', 'VON', 'KONTO', 'GIROKONTO', 'KARTENKONTO', 'KREDITKARTENKONTO', 'KREDITKARTE', 'KARTE',
  'VISA', 'VISACARD', 'MASTERCARD', 'MASTER', 'CARD', 'AMEX',
]);
/** A refund says so, nameless or not. */
const REFUND = /(^| )((RUECK)?ERSTATTUNG|STORNO|RETOURE|RUECKSENDUNG|REFUND|CHARGEBACK)/;

/**
 * Whether a credit on the card can be the bill's: it names no shop or payee,
 * and it is no refund. Payment words where a name would be are no name
 * (NOT_A_NAME), and neither are the words of `known`: the accounts' holder —
 * every transfer to the card carries the payer's name — and their banks.
 */
function payingIn(tx: SerializedTransaction, known: ReadonlySet<string>): boolean {
  const name = foldText(rawCounterparty(tx)).replace(OWN_LABELS, ' ').split(' ')
    .filter((t) => t && !NOT_A_NAME.has(t) && !FILLER.test(t) && !known.has(t));
  return !name.length && !REFUND.test(said(tx));
}

type Accountish = Pick<SerializedAccount, 'accountNumber' | 'accountType'> & { holder?: string | null };
type Loaded = Readonly<Record<string, readonly SerializedTransaction[] | undefined>>;
/** What the caller knows beyond the bookings: the bank an account is kept at, by name. */
export type CardBillOptions = { bankName?: (account: Accountish) => string | null | undefined };

/** The words of the accounts' holders and of their banks' names: a payment to the card may carry them where a name would be. */
function knownNames(accounts: readonly Accountish[], opts: CardBillOptions): Set<string> {
  const out = new Set<string>();
  for (const a of accounts) {
    for (const name of [a.holder, opts.bankName?.(a)]) {
      for (const t of foldText(name).split(' ')) if (t.length > 1) out.add(t);
    }
  }
  return out;
}

/**
 * The bookings that are a card's bill and its credit on the card, found
 * among `accounts` (their bookings in `txByAccount`, by account key) — the
 * booking objects themselves, so two alike are still two.
 *
 * A pair: a debit on an account that is no card (lib/balances.ts
 * isCardAccount), never cash, that readsLikeCardBill; and a credit on a card
 * account that names no payee — its holder and its bank are none — and is
 * no refund (payingIn). The same sum to
 * the cent in the same currency, at most WORDED_DAYS apart when the credit
 * says it pays the card, else PLAIN_DAYS. Each booking pairs once; where
 * several fit, the credit that says so goes first, then the nearest in days.
 * Without both accounts there is no pair.
 */
export function cardBills(accounts: readonly Accountish[], txByAccount: Loaded, opts: CardBillOptions = {}): Set<SerializedTransaction> {
  type Side = { tx: SerializedTransaction; day: number; worded: boolean };
  const side = (tx: SerializedTransaction, worded: boolean): Side | null => {
    const day = dayNumber(dayKey(tx.entryDate || tx.valueDate));
    return Number.isFinite(day) ? { tx, day, worded } : null;
  };
  const sumOf = (tx: SerializedTransaction) => `${tx.currency || 'EUR'}|${Math.round(Math.abs(Number(tx.amount)) * 100)}`;

  const bySum = new Map<string, { bills: Side[]; credits: Side[] }>();
  const group = (sum: string) => {
    let g = bySum.get(sum);
    if (!g) bySum.set(sum, (g = { bills: [], credits: [] }));
    return g;
  };
  const known = knownNames(accounts, opts);
  for (const a of accounts) {
    if (!isCardAccount(a)) continue;
    for (const tx of txByAccount[a.accountNumber] ?? []) {
      if (!(Number(tx.amount) > 0) || !payingIn(tx, known)) continue;
      const s = side(tx, PAYMENT.test(said(tx)) || readsLikeCardBill(tx));
      if (s) group(sumOf(tx)).credits.push(s);
    }
  }
  const out = new Set<SerializedTransaction>();
  if (!bySum.size) return out;
  for (const a of accounts) {
    if (isCardAccount(a)) continue;
    for (const tx of txByAccount[a.accountNumber] ?? []) {
      if (!(Number(tx.amount) < 0)) continue;
      const g = bySum.get(sumOf(tx));
      if (!g || bookingKind(tx) === 'bargeld' || !readsLikeCardBill(tx)) continue;
      const s = side(tx, true);
      if (s) g.bills.push(s);
    }
  }

  for (const { bills, credits } of bySum.values()) {
    const fits: { bill: Side; credit: Side; gap: number }[] = [];
    for (const bill of bills) {
      for (const credit of credits) {
        const gap = Math.abs(bill.day - credit.day);
        if (gap <= (credit.worded ? WORDED_DAYS : PLAIN_DAYS)) fits.push({ bill, credit, gap });
      }
    }
    fits.sort((x, y) => +y.credit.worded - +x.credit.worded || x.gap - y.gap);
    const taken = new Set<Side>();
    for (const { bill, credit } of fits) {
      if (taken.has(bill) || taken.has(credit)) continue;
      taken.add(bill).add(credit);
      out.add(bill.tx).add(credit.tx);
    }
  }
  return out;
}

/**
 * The bookings of several accounts to add up together — "Alle geladenen
 * Konten" — with each card's bill and its credit on the card left out
 * (`left`), in the accounts' order.
 */
export function withoutCardBills(
  accounts: readonly Accountish[], txByAccount: Loaded, opts: CardBillOptions = {},
): { txs: SerializedTransaction[]; left: SerializedTransaction[] } {
  const bills = cardBills(accounts, txByAccount, opts);
  const txs: SerializedTransaction[] = [];
  const left: SerializedTransaction[] = [];
  for (const a of accounts) for (const tx of txByAccount[a.accountNumber] ?? []) (bills.has(tx) ? left : txs).push(tx);
  return { txs, left };
}

/**
 * The bookings several accounts add up to together, wherever that sum is
 * shown — the Analyse's "Alle geladenen Konten" and the desktop Übersicht's
 * month with several accounts ticked — so both leave out the same card
 * bills. One account is its bookings, all of them: only a sum across
 * accounts counts the bill twice.
 */
export function acrossAccounts(
  accounts: readonly Accountish[], txByAccount: Loaded, opts: CardBillOptions = {},
): { txs: SerializedTransaction[]; left: SerializedTransaction[] } {
  if (accounts.length < 2) return { txs: accounts.flatMap((a) => [...(txByAccount[a.accountNumber] ?? [])]), left: [] };
  return withoutCardBills(accounts, txByAccount, opts);
}
