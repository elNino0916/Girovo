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

/**
 * A card's bill in the words banks use for one, on the debit — every one of
 * them whole words:
 *   KREDITKARTENABRECHNUNG, KREDITKARTENAUSGLEICH, KARTENABRECHNUNG, KARTENABR(.)
 *   K(REDIT)K(ARTE(N)) ABR(ECHNUNG): "KK-Abrechnung", "KK Abr 10/26", "Kreditkarten-Abrechnung"
 *   VISA / MASTERCARD / AMEX …ABR(ECHNUNG), up to four words between ("Mastercard 5232XX… Abrechnung")
 *   ABRECHNUNG … a card, up to two words between ("Abrechnung Ihrer Mastercard")
 *   CARD SETTLEMENT
 * and two that count only beside a card's name (CARD_WORD): AUSGLEICH and
 * UMSATZABRECHNUNG. "Ausgleich Rechnung 4711" is not a card's bill.
 */
const BILL = new RegExp([
  word('KREDITKARTENABRECHNUNG|KREDITKARTENAUSGLEICH|KARTENABRECHNUNG|KARTENABR'),
  word('K(?:REDIT)?K(?:ARTEN?)? ?ABR(?:ECHNUNG)?'),
  word(`(?:${CARDS})(?: [A-Z0-9]+){0,4} ABR(?:ECHNUNG)?`),
  word(`ABRECHNUNG(?: [A-Z0-9]+){0,2} (?:KREDITKARTE|KREDITKARTEN|${CARDS})`),
  word('CARD SETTLEMENT'),
].join('|'));
const BESIDE_A_CARD = new RegExp(word('AUSGLEICH|UMSATZABRECHNUNG'));

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
  return BILL.test(text) || (BESIDE_A_CARD.test(text) && CARD_WORD.test(text));
}

/** A payment's words: where a card's credit says it was paid. Not "Gutschrift" — every credit is one. */
const PAYMENT = new RegExp(word('AUSGLEICH|ZAHLUNG|ZAHLUNGSEINGANG|EINZAHLUNG|PAYMENT'));
/** The words a bank puts where a payee's name would be on a payment to the card: no name of anyone. */
const NOT_A_NAME = new RegExp(word(
  `GUTSCHRIFT|AUSGLEICH|ZAHLUNG|ZAHLUNGSEINGANG|EINZAHLUNG|PAYMENT|RECEIVED|THANK|YOU|DANKE|VIELEN|DANK|KREDITKARTE|KARTE|${CARDS}|[0-9X]+`,
), 'g');
/** A refund says so, nameless or not. */
const REFUND = /(^| )((RUECK)?ERSTATTUNG|STORNO|RETOURE|RUECKSENDUNG|REFUND|CHARGEBACK)/;

/**
 * Whether a credit on the card can be the bill's: it names no shop or payee
 * (payment words where a name would be are none), and it is no refund.
 */
function payingIn(tx: SerializedTransaction): boolean {
  const name = foldText(rawCounterparty(tx)).replace(OWN_LABELS, ' ').replace(NOT_A_NAME, ' ').trim();
  return !name && !REFUND.test(said(tx));
}

type Accountish = Pick<SerializedAccount, 'accountNumber' | 'accountType'>;
type Loaded = Readonly<Record<string, readonly SerializedTransaction[] | undefined>>;

/**
 * The bookings that are a card's bill and its credit on the card, found
 * among `accounts` (their bookings in `txByAccount`, by account key) — the
 * booking objects themselves, so two alike are still two.
 *
 * A pair: a debit on an account that is no card (lib/balances.ts
 * isCardAccount), never cash, that readsLikeCardBill; and a credit on a card
 * account that names no payee and is no refund (payingIn). The same sum to
 * the cent in the same currency, at most WORDED_DAYS apart when the credit
 * says it pays the card, else PLAIN_DAYS. Each booking pairs once; where
 * several fit, the credit that says so goes first, then the nearest in days.
 * Without both accounts there is no pair.
 */
export function cardBills(accounts: readonly Accountish[], txByAccount: Loaded): Set<SerializedTransaction> {
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
  for (const a of accounts) {
    if (!isCardAccount(a)) continue;
    for (const tx of txByAccount[a.accountNumber] ?? []) {
      if (!(Number(tx.amount) > 0) || !payingIn(tx)) continue;
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
export function withoutCardBills(accounts: readonly Accountish[], txByAccount: Loaded): { txs: SerializedTransaction[]; left: SerializedTransaction[] } {
  const bills = cardBills(accounts, txByAccount);
  const txs: SerializedTransaction[] = [];
  const left: SerializedTransaction[] = [];
  for (const a of accounts) for (const tx of txByAccount[a.accountNumber] ?? []) (bills.has(tx) ? left : txs).push(tx);
  return { txs, left };
}
