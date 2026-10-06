// What the printed Kontoauszug and Buchungsbeleg say, worked out apart from
// how they look (components/Statement.tsx).
//
// Paper is the record a third party reads — a landlord, the Jobcenter, a tax
// adviser — so everything here follows two rules:
//
//   - Bank text is printed as the bank sent it. Only encoding damage is
//     repaired ("Hessen-ThA.ringen" → "Hessen-Thüringen"); the screen's
//     re-casing and tidying stay on screen. Where the sheet leads with a name
//     the app cut out of a card descriptor, the bank's whole string is printed
//     beside it as "Name laut Bank".
//   - No figure is printed as the bank's unless the bank sent it. A balance
//     the sheet works out itself is marked as worked out, and one that cannot
//     be squared with the bookings says so instead of being made to fit.
//
// The sheet's own words follow the interface language (lib/i18n): a label,
// a credit line's name. What the bank sent never does.
//
// Pure and node-test-safe: no path aliases, `.ts` on sibling imports.

import type { SerializedTransaction, StatementBlock } from './fints-types';
import { isCardAccount } from './balances.ts';
import { counterpartyName, intermediaryName, rawCounterparty, txCreditorId } from './categories.ts';
import { dayKey, fmtDecimal, fmtSignedDecimal, prettyBookingText, repairBankText } from './format.ts';
import { msgs } from './i18n/index.ts';
import { parsePurpose, purposeLines, type ParsedPurpose } from './sepa-purpose.ts';

const cents = (v: number) => Math.round(Number(v) * 100);

/** A bank string on one line, as the bank sent it — only encoding damage repaired. */
export const bankLine = (s: string | null | undefined): string =>
  repairBankText(String(s ?? '')).replace(/\s+/g, ' ').trim();

/** "NOTPROVIDED" / "NONREF" are SEPA's way of saying there is no reference. */
const realRef = (s: string | null | undefined): string => {
  const v = String(s ?? '').trim();
  return v && v !== 'NOTPROVIDED' && v !== 'NONREF' ? v : '';
};

// ---------------------------------------------------------------------------
// One booking, as paper prints it
// ---------------------------------------------------------------------------

/**
 * Where a booking stands on the day the document is made.
 *
 * - `pending`: a Vormerkposten — authorised, not booked.
 * - `ahead`: on the statement, but under a Buchungstag still to come. Banks
 *   stamp a weekend card payment with Monday's date and list it on Saturday;
 *   the screen calls it "noch nicht gebucht", and so must the paper.
 * - `booked`: everything else.
 */
export type BookingState = 'booked' | 'pending' | 'ahead';

export function bookingState(
  tx: Pick<SerializedTransaction, 'entryDate'>,
  pending: boolean,
  now: Date,
): BookingState {
  if (pending) return 'pending';
  const day = dayKey(tx.entryDate);
  return day && day > dayKey(now) ? 'ahead' : 'booked';
}

export type PaperText = {
  /** Who the booking is with — the shop behind a card processor, else the account holder. Bank casing. */
  name: string;
  /** The bank's own counterparty string, when `name` was cut out of it. */
  bankName: string | null;
  /** The intermediary whose account the money went through (a card processor). */
  via: string | null;
  /** The bank's booking text, readable ("Kartenzahlung"). */
  bookingText: string;
  /** The Verwendungszweck prose, one entry per line the bank wrote. */
  purposeLines: string[];
  parsed: ParsedPurpose;
};

export function paperText(tx: SerializedTransaction): PaperText {
  const name = bankLine(counterpartyName(tx));
  const raw = bankLine(rawCounterparty(tx));
  const via = intermediaryName(tx);
  const parsed = parsePurpose(repairBankText(tx.purpose ?? ''));
  return {
    name,
    bankName: raw && raw !== name ? raw : null,
    via: via ? bankLine(via) : null,
    bookingText: prettyBookingText(bankLine(tx.bookingText)),
    purposeLines: purposeLines(parsed.text),
    parsed,
  };
}

export type RefKey = 'eref' | 'mref' | 'cred' | 'kref' | 'field' | 'bank';
export type DocRef = { key: RefKey; label: string; value: string; iban?: boolean };

// Tags that have a row of their own (or are the prose itself).
const OWN_ROW_TAGS = new Set(['SVWZ', 'EREF', 'MREF', 'CRED', 'KREF']);

/**
 * The identifiers a booking carries, labelled in the same words as the detail
 * drawer's "Referenzen" — in the order a dispute or a reconciliation asks for
 * them. A reference that only repeats another one is printed once.
 */
export function bookingReferences(tx: SerializedTransaction, parsed: ParsedPurpose = paperText(tx).parsed): DocRef[] {
  const field = (tag: string) => parsed.fields.find((f) => f.tag === tag)?.value ?? '';
  const { common, transactions: { refs } } = msgs();
  // The tags' own values first: where a bank ran the tags together, the
  // parser files everything after "EREF+" — MREF, CRED and the prose — as
  // the End-to-End reference.
  const rows: DocRef[] = [
    { key: 'eref', label: refs.e2e, value: realRef(field('EREF')) || realRef(tx.e2eReference) },
    { key: 'mref', label: refs.mandate, value: realRef(field('MREF')) || realRef(tx.mandateReference) },
    { key: 'cred', label: common.booking.creditorId, value: txCreditorId(tx) ?? '' },
    { key: 'kref', label: refs.customer, value: realRef(tx.customerReference) || realRef(field('KREF')) },
    ...parsed.fields
      .filter((f) => !OWN_ROW_TAGS.has(f.tag))
      .map((f): DocRef => ({ key: 'field', label: f.label, value: f.value.trim(), iban: f.tag === 'IBAN' })),
    { key: 'bank', label: refs.bank, value: realRef(tx.bankReference) },
  ];
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (!r.value || seen.has(r.value)) return false;
    seen.add(r.value);
    return true;
  });
}

// ---------------------------------------------------------------------------
// The account
// ---------------------------------------------------------------------------

/**
 * The credit line under the name the screen uses: "Dispositionsrahmen" on an
 * account, "Kreditrahmen" on a card ("Overdraft limit", "Credit limit"). A
 * card is decided the way the screen decides it (`isCardAccount`: the
 * Kontoart, named or 50–59), so the paper never calls a card's limit a Dispo.
 * Always the size of the line — a bank that reports it as a negative number
 * must not print "−2.000,00". Null when there is none, or it is zero.
 */
export function creditLine(
  limit: number | null | undefined,
  accountType: string,
): { label: string; amount: number } | null {
  if (limit == null || !Number.isFinite(Number(limit)) || cents(limit) === 0) return null;
  const { doc } = msgs().transactions;
  return {
    label: isCardAccount({ accountType }) ? doc.creditLimit : doc.overdraftLimit,
    amount: Math.abs(cents(limit)) / 100,
  };
}

/** A Bankleitzahl the way statements print it: "570 699 99". Anything else as given. */
export function fmtBlz(blz: string | null | undefined): string {
  const s = String(blz ?? '').replace(/\s+/g, '');
  return /^\d{8}$/.test(s) ? `${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6)}` : String(blz ?? '').trim();
}

/**
 * The period a Kontoauszug covers: the range that was fetched from the bank.
 *
 * Not the span of its booking dates — that would end on tomorrow whenever the
 * bank lists a forward-dated booking, and start late on a quiet first week.
 * Falls back to the span only when the range is unknown.
 */
export function statementPeriod(
  from: string | null | undefined,
  to: string | null | undefined,
  txs: readonly Pick<SerializedTransaction, 'entryDate' | 'valueDate'>[],
): { from: string | null; to: string | null } {
  const days = txs.map((t) => dayKey(t.entryDate || t.valueDate)).filter(Boolean).sort();
  return {
    from: dayKey(from) || days[0] || null,
    to: dayKey(to) || days[days.length - 1] || null,
  };
}

// ---------------------------------------------------------------------------
// The statement's arithmetic
// ---------------------------------------------------------------------------

/** A balance on the sheet, and whose figure it is. */
export type LedgerFigure = { amount: number; date: string | null; source: 'bank' | 'derived' };

export type Tally = { count: number; sum: number };

export type StatementLedger = {
  /** The bookings are in more than one currency: nothing is added up. */
  mixed: boolean;
  /** Alter Kontostand. */
  opening: LedgerFigure | null;
  /** Neuer Kontostand. */
  closing: LedgerFigure | null;
  /** The bookings the closing balance contains, split by direction. */
  credits: Tally;
  debits: Tally;
  /**
   * Bookings dated after the closing balance's day that it does not contain —
   * a statement fetched on a Saturday lists Monday's card payment, while the
   * balance is Saturday's. Printed apart, so the arithmetic above still holds.
   */
  outstanding: (Tally & { firstDay: string }) | null;
  /**
   * The bank's own opening and closing balances do not fit the bookings: the
   * closing minus everything the bookings explain. Printed as it is — the
   * sheet never bends a figure to make the sum work.
   */
  difference: number | null;
};

type Row = { day: string; cents: number };

const tally = (rows: readonly Row[], credit: boolean): Tally => {
  const own = rows.filter((r) => (credit ? r.cents >= 0 : r.cents < 0));
  return { count: own.length, sum: own.reduce((s, r) => s + r.cents, 0) / 100 };
};

/** The oldest block's opening balance — where the bank's own figures start. */
function bankOpening(blocks: readonly StatementBlock[], currency: string): { cents: number; day: string } | null {
  if (blocks.some((b) => (b.currency || currency) !== currency)) return null;
  const dated = blocks
    .filter((b) => b.openingBalance != null && Number.isFinite(b.openingBalance) && dayKey(b.openingDate))
    .map((b) => ({ cents: cents(b.openingBalance as number), day: dayKey(b.openingDate), close: b.closingBalance }));
  if (!dated.length) return null;
  const first = dated.reduce((d, b) => (b.day < d ? b.day : d), dated[0].day);
  const heads = dated.filter((b) => b.day === first);
  // Two blocks opening on the same day: the one no other block closes onto.
  const head = heads.find((b) => !dated.some((o) => o !== b && o.close != null && cents(o.close) === b.cents)) ?? heads[0];
  return { cents: head.cents, day: head.day };
}

/**
 * Alter Kontostand, the two sums and Neuer Kontostand for a Kontoauszug.
 *
 * `closing` is the balance the statement is printed with (today's for a range
 * that reaches today, the range's own closing for a past one); `blocks` are the
 * bank's statement blocks from the same fetch as `txs`, with their own
 * opening balances.
 *
 * With both ends from the bank, the bookings must carry the opening onto the
 * closing — all of them, or all but those dated after the closing's day. When
 * neither reading adds up, the one that leaves the smaller gap is printed,
 * with the gap. A missing end is worked out from the other and marked
 * `derived`.
 */
export function statementLedger(input: {
  txs: readonly Pick<SerializedTransaction, 'amount' | 'currency' | 'entryDate' | 'valueDate'>[];
  closing: { balance: number; date: Date | string | null | undefined } | null;
  blocks?: readonly StatementBlock[] | null;
  /** The account's (and closing balance's) currency. */
  currency: string;
}): StatementLedger {
  const { txs, currency } = input;
  const rows: Row[] = txs.map((t) => ({ day: dayKey(t.entryDate || t.valueDate), cents: cents(t.amount) }));
  const closeIn = input.closing && Number.isFinite(Number(input.closing.balance))
    ? { cents: cents(input.closing.balance), day: dayKey(input.closing.date) || null }
    : null;

  const none = { credits: tally(rows, true), debits: tally(rows, false), outstanding: null, difference: null };
  if (txs.some((t) => (t.currency || currency) !== currency)) {
    return {
      ...none,
      mixed: true,
      opening: null,
      closing: closeIn ? { amount: closeIn.cents / 100, date: closeIn.day, source: 'bank' } : null,
    };
  }

  const total = rows.reduce((s, r) => s + r.cents, 0);
  const open = bankOpening(input.blocks ?? [], currency);
  const figure = (c: number, date: string | null, source: LedgerFigure['source']): LedgerFigure => ({
    amount: c / 100, date, source,
  });

  // Bookings dated after the closing balance's own day.
  const closeDay = closeIn?.day ?? null;
  const ahead = closeDay ? rows.filter((r) => r.day > closeDay) : [];
  const aheadSum = ahead.reduce((s, r) => s + r.cents, 0);
  const setApart = () => {
    const counted = rows.filter((r) => !ahead.includes(r));
    return {
      credits: tally(counted, true),
      debits: tally(counted, false),
      outstanding: {
        count: ahead.length,
        sum: aheadSum / 100,
        firstDay: ahead.reduce((d, r) => (r.day < d ? r.day : d), ahead[0].day),
      },
    };
  };

  if (closeIn && open) {
    const closing = figure(closeIn.cents, closeIn.day, 'bank');
    const opening = figure(open.cents, open.day, 'bank');
    const gapAll = closeIn.cents - open.cents - total;
    if (gapAll === 0) return { ...none, mixed: false, opening, closing };
    const gapCut = gapAll + aheadSum;
    if (ahead.length && Math.abs(gapCut) < Math.abs(gapAll)) {
      return { mixed: false, opening, closing, ...setApart(), difference: gapCut === 0 ? null : gapCut / 100 };
    }
    return { ...none, mixed: false, opening, closing, difference: gapAll / 100 };
  }
  if (closeIn) {
    const closing = figure(closeIn.cents, closeIn.day, 'bank');
    // Nothing from the bank to check against. A balance dated on a day holds
    // the bookings up to that day, so the ones dated later are set apart.
    if (ahead.length) {
      return {
        mixed: false, opening: figure(closeIn.cents - total + aheadSum, null, 'derived'), closing, ...setApart(), difference: null,
      };
    }
    return { ...none, mixed: false, opening: figure(closeIn.cents - total, null, 'derived'), closing };
  }
  if (open) {
    return {
      ...none,
      mixed: false,
      opening: figure(open.cents, open.day, 'bank'),
      closing: figure(open.cents + total, null, 'derived'),
    };
  }
  return { ...none, mixed: false, opening: null, closing: null };
}

// ---------------------------------------------------------------------------
// Figures and identifiers

/** Never "−0,00": a figure that rounds to nothing is plain zero. */
const settle = (v: number) => {
  const c = Math.round(Number(v) * 100);
  return c === 0 ? 0 : c / 100;
};

/**
 * A booking's amount for the amount column: "+3.184,27" for a credit,
 * "−1.090,00" for a debit. Both signs are written out, so the direction reads
 * on a black-and-white copy and to anyone who has never seen the app.
 */
export function fmtMovement(v: number): string {
  const n = settle(v);
  return n > 0 ? `+${fmtDecimal(n)}` : fmtSignedDecimal(n);
}

/** A balance: a real minus when negative, no sign otherwise — a balance is a state, not a movement. */
export function fmtBalance(v: number): string {
  return fmtSignedDecimal(settle(v));
}

/**
 * The statement numbers (MT940 :28C:) the bookings carry, as the range from the
 * oldest booking's to the newest's — in booking order, because their format is
 * the bank's ("00009/001", "0926/001") and does not sort as text.
 */
export function statementNumberRange(oldestFirst: readonly Pick<SerializedTransaction, 'statementNumber'>[]): string | null {
  const nums = oldestFirst.map((t) => String(t.statementNumber ?? '').trim()).filter(Boolean);
  if (!nums.length) return null;
  const first = nums[0];
  const last = nums[nums.length - 1];
  return first === last ? first : `${first} – ${last}`;
}

// ---------------------------------------------------------------------------
// Print plumbing
// ---------------------------------------------------------------------------

/** A value as a CSS string literal, for the page-margin text a sheet injects. */
export function cssString(s: string): string {
  return `"${String(s).replace(/[\\"]/g, (c) => `\\${c}`).replace(/[\r\n]+/g, ' ')}"`;
}
