// Kreditkartenumsätze over DKKKU (6.0): the Sparkassen's own business
// transaction for a credit card's bookings, offered where a card account has
// neither HKCAZ nor HKKAZ (lib/fints-statements.ts picks it then).
//
// lib-fints brings the request (DKKKU v2) and the answer's frame (DIKKU v2),
// and an interaction of its own — whose reading splits each booking at every
// ':' (an escaped '?:' in a Verwendungszweck breaks it apart) and answers in
// a shape of its own. Here only the reading is replaced: each booking is split
// the way FinTS escapes it (lib-fints' splitBySeparator), and the answer is
// the Statement lib-fints' MT940 and camt readers give, so the Umsätze list,
// the kept Umsätze, the Kontostand and an approval's continuation
// (getAccountStatementsWithTan) all take it as they take any other.
//
// DKKKU is not in the FinTS catalogue; its fields follow hbci4java
// (hbci-300.xml, KreditkartenUmsatz / GVRKreditkartenUmsatz), which several
// institutes answer to:
//   0 card number   1 Buchungsdatum   2 Umsatzdatum     3 reference
//   4 original amount  5 its currency  6 its C/D      7 exchange rate
//   8 amount        9 currency       10 C/D           11 purpose (the shop)
//   12 location     13–19 details    20 finalized     …
// Dates come as yyyymmdd and, from some institutes, as yyyy-mm-dd; amounts as
// "12,34" with C/D beside them, and from some with a sign as well.

import type { Balance, Message, Segment, Statement, StatementResponse, Transaction } from 'lib-fints';
import { CreditCardStatementInteraction, splitBySeparator } from './fints-internals.js';
import { continuesAfterApproval } from './fints-continuation.ts';
import { msgs } from './i18n/index.ts';

export const CARD_STATEMENT_SEG = 'DKKKU';

/** A DIKKU segment as lib-fints decodes it: the bookings stay raw data groups. */
type DikkuSegment = Segment & {
  accountNumber?: string;
  balance?: { creditDebit?: string; amount?: { value?: number; currency?: string }; date?: Date; time?: Date };
  transactions?: string[];
};

/** One booking from a DIKKU data group, read; null when it carries no date or no amount. */
export type CardBooking = {
  bookingDate: Date;
  valueDate: Date;
  amount: number;
  currency: string;
  shop: string;
  location: string;
  reference: string;
  original: { amount: number; currency: string; rate: number | null } | null;
};

/** Undoes FinTS' escaping: '?' before a separator, a '?' or an '@' stands for that character. */
const unescape = (s: string): string => s.replace(/\?([?:+'@])/g, '$1').trim();

/** yyyymmdd or yyyy-mm-dd, as the local day — the way lib-fints' MT940 reader dates a booking. */
export function cardDay(text: string | undefined): Date | null {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec((text ?? '').trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const day = new Date(y, mo - 1, d);
  return day.getFullYear() === y && day.getMonth() === mo - 1 && day.getDate() === d ? day : null;
}

/**
 * An amount as the card answers it — "1.234,56", "12,34", "-12,34" or
 * "12.34" — signed by C/D where the bank says which: a debit is negative
 * whatever sign the figure carried. Null when it is no number.
 */
export function cardAmount(text: string | undefined, creditDebit: string | undefined): number | null {
  let s = (text ?? '').replace(/\s/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  // FinTS writes a whole amount with its separator and nothing after it ("50,").
  if (!/^[+-]?\d+(\.\d*)?$/.test(s)) return null;
  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  const cd = (creditDebit ?? '').trim().toUpperCase();
  if (cd === 'D') return -Math.abs(value);
  if (cd === 'C') return Math.abs(value);
  return value;
}

/** One booking's data group (raw, as DIKKU carries it), read. */
export function readCardBooking(raw: string): CardBooking | null {
  const f = splitBySeparator(raw, ':').map(unescape);
  const bookingDate = cardDay(f[1]);
  const valueDate = cardDay(f[2]) ?? bookingDate;
  const amount = cardAmount(f[8], f[10]);
  if (!bookingDate || !valueDate || amount === null) return null;
  const currency = (f[9] || 'EUR').toUpperCase();
  const originalAmount = cardAmount(f[4], f[6]);
  const originalCurrency = (f[5] ?? '').toUpperCase();
  const rate = cardAmount(f[7], undefined);
  return {
    bookingDate,
    valueDate,
    amount,
    currency,
    shop: f[11] ?? '',
    location: f[12] ?? '',
    reference: f[3] ?? '',
    // Only a payment in another currency says what it was there.
    original: originalAmount !== null && /^[A-Z]{3}$/.test(originalCurrency) && originalCurrency !== currency
      ? { amount: originalAmount, currency: originalCurrency, rate: rate && rate > 0 ? Math.abs(rate) : null }
      : null,
  };
}

/** A card booking as lib-fints' statement readers give one: the shop as the counterparty. */
function asTransaction(b: CardBooking): Transaction {
  const said = msgs().transactions.api;
  const foreign = b.original ? said.cardForeign(Math.abs(b.original.amount), b.original.currency, b.original.rate) : '';
  return {
    valueDate: b.valueDate,
    entryDate: b.bookingDate,
    fundsCode: '',
    amount: b.amount,
    transactionType: '',
    customerReference: '',
    bankReference: b.reference,
    bookingText: said.cardBooking,
    remoteName: b.shop,
    purpose: [b.location, foreign].filter(Boolean).join(' · '),
  };
}

/** The card's balance from DIKKU, signed: what is owed is negative. */
function balanceOf(seg: DikkuSegment | undefined, fallbackCurrency: string): Balance | null {
  const bal = seg?.balance;
  const value = bal?.amount?.value;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const date = bal?.date instanceof Date && !Number.isNaN(bal.date.getTime()) ? new Date(bal.date) : new Date();
  return {
    value: (bal?.creditDebit ?? '').toUpperCase() === 'D' ? -Math.abs(value) : Math.abs(value),
    currency: bal?.amount?.currency || fallbackCurrency,
    date,
  };
}

/**
 * The DIKKU segments of one answer as one Statement. A long list spread over
 * several messages arrives as several DIKKU — the balance in each, the
 * bookings not. The opening balance is unknown: it is marked as invented
 * (0 on the closing day, lib/serialize.ts statementBlocks), never a figure
 * the Kontoverlauf could check against.
 */
export function cardStatements(segments: readonly DikkuSegment[]): { statements: Statement[]; unread: number } {
  const raws = segments.flatMap((s) => (Array.isArray(s.transactions) ? s.transactions : []));
  const bookings: CardBooking[] = [];
  let unread = 0;
  for (const raw of raws) {
    const b = typeof raw === 'string' ? readCardBooking(raw) : null;
    if (b) bookings.push(b);
    else unread++;
  }
  if (!segments.length) return { statements: [], unread };
  const currency = bookings[0]?.currency || 'EUR';
  const closing = balanceOf(segments[0], currency);
  const statement = {
    account: segments[0]?.accountNumber,
    transactions: bookings.map(asTransaction),
    ...(closing
      ? { closingBalance: closing, openingBalance: { value: 0, currency: closing.currency, date: closing.date } }
      : {}),
  } as Statement;
  return { statements: [statement], unread };
}

/**
 * lib-fints' DKKKU request, read here (see the top of this file); a long list's
 * further pages arrive after an approval as without one (lib/fints-continuation.ts).
 */
export class CardStatementInteraction extends continuesAfterApproval(CreditCardStatementInteraction) {
  handleResponse(response: Message, answer: Parameters<CreditCardStatementInteraction['handleResponse']>[1]): void {
    // Answered as a statement answer, not lib-fints' own card shape (see the top of this file).
    const clientResponse = answer as unknown as StatementResponse;
    const segments = response.findAllSegments<DikkuSegment>('DIKKU');
    try {
      const { statements, unread } = cardStatements(segments);
      clientResponse.statements = statements;
      // Counts only — never a shop, an amount or a card number.
      console.log(`[stmt-card] segs=${segments.length} tx=${statements[0]?.transactions.length ?? 0}${unread ? ` unread=${unread}` : ''}`);
    } catch (err) {
      console.warn('[stmt-card] DIKKU not readable:', (err as Error)?.message || err);
      clientResponse.statements = [];
    }
  }
}
