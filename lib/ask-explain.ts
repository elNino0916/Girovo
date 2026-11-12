// Girovo Next, Girovo AI: "Was ist das für eine Zahlung?", one booking
// explained (components/insights/ask/ExplainAnswer.tsx).
//
// Rules only, no model: who it is (the name as the lists show it, handed in),
// what kind of booking (lib/categorize.ts bookingKind, from the booking text
// and code), what its purpose says (the SEPA tags split off and the text
// tidied, as the list's second line reads it), whether it is a SEPA direct
// debit with a mandate reference and a creditor ID, and whether it belongs to
// a contract in Verträge & Abos (found by the caller, which has the
// detection). Said in one to three short lines (explainLines).

import type { SerializedTransaction } from './fints-types';
import type { de } from './i18n/messages/ask.ts';
import { isCardPurpose } from './card-purpose.ts';
import { bookingKind, foldText, type BookingKind } from './categorize.ts';
import { txCreditorId } from './categories.ts';
import { prettyPurpose, repairBankText } from './format.ts';
import { condenseRefs, parsePurpose } from './sepa-purpose.ts';

export type ExplainWords = typeof de.explain;

/** One booking, read for its explanation. */
export type Explained = {
  kind: BookingKind;
  credit: boolean;
  /** The counterparty as the lists show it. */
  name: string;
  /** The purpose, tidied; '' when it says nothing the first line does not (a card record, the name again). */
  purpose: string;
  /** '' when the booking carries none. */
  mandate: string;
  creditorId: string;
  /** A SEPA direct debit: a Lastschrift with its mandate reference or creditor ID. */
  directDebit: boolean;
  /** The contract in Verträge & Abos it belongs to: its rhythm in words. Null when none holds it. */
  contract: { cadence: string } | null;
};

/** "NOTPROVIDED" / "NONREF" are SEPA's way of saying there is no reference. */
const realRef = (s: string | null | undefined): string => {
  const v = String(s ?? '').trim();
  return v && v !== 'NOTPROVIDED' && v !== 'NONREF' ? v : '';
};

// Whose purpose is no prose: a card terminal's or a cash machine's record.
const RECORD_KINDS = new Set<BookingKind>(['karte', 'bargeld']);
// Kinds that may come again on their own: worth saying when no contract holds one.
const MAY_REPEAT = new Set<BookingKind>(['lastschrift', 'dauerauftrag']);
const DEBIT_KINDS = new Set<BookingKind>(['lastschrift', 'ruecklastschrift']);

/** The purpose as a line: SEPA tags off, capitals eased, machine references cut short. */
export function explainPurpose(tx: Pick<SerializedTransaction, 'purpose' | 'bookingText'>, name: string, kind: BookingKind): string {
  if (RECORD_KINDS.has(kind)) return '';
  const text = parsePurpose(repairBankText(String(tx.purpose ?? ''))).text;
  if (!text || isCardPurpose(text)) return '';
  const line = condenseRefs(prettyPurpose(text), 120).replace(/[\s.,;:]+$/, '');
  const folded = foldText(line);
  if (!folded || folded === foldText(name) || folded === foldText(tx.bookingText)) return '';
  return line;
}

export function explainBooking(
  tx: SerializedTransaction,
  { name, contract = null }: { name: string; contract?: { cadence: string } | null },
): Explained {
  const parsed = parsePurpose(repairBankText(String(tx.purpose ?? '')));
  const mandate = realRef(parsed.fields.find((f) => f.tag === 'MREF')?.value) || realRef(tx.mandateReference);
  const creditorId = txCreditorId(tx) ?? '';
  let kind = bookingKind(tx);
  // A booking the text and code leave open, carrying a mandate and a creditor ID, is a direct debit.
  if (kind === 'sonstige' && mandate && creditorId) kind = 'lastschrift';
  return {
    kind,
    credit: Number(tx.amount) > 0,
    name: name.trim(),
    purpose: explainPurpose(tx, name, kind),
    mandate,
    creditorId,
    directDebit: DEBIT_KINDS.has(kind) && !!(mandate || creditorId),
    contract,
  };
}

/** The explanation in one to three short lines: who and what kind, the purpose, the rhythm. */
export function explainLines(e: Explained, words: ExplainWords): string[] {
  const say = e.directDebit && e.kind === 'lastschrift' ? words.kind.sepa : words.kind[e.kind] ?? words.kind.sonstige;
  const lines = [say(e.name, e.credit)];
  if (e.purpose) lines.push(words.purpose(e.purpose));
  if (e.contract) lines.push(words.repeats(e.contract.cadence));
  else if (!e.credit && MAY_REPEAT.has(e.kind)) lines.push(words.noContract);
  return lines;
}

// "Was ist diese Abbuchung?", "Was ist das für eine Zahlung?", "Erklär mir
// diesen Umsatz", "What is this charge?": a question about the one booking in
// front of you. It needs the pointing word right before the booking word, one
// word between at most: "Was ist die größte Abbuchung?" is about all of them,
// and so is "Was ging dieses Jahr an Amazon Payments?".
// i18n-data-start (the words a question is recognised by, in either language)
const ASKS = /^(?:was|wer|worum|wofuer|erklaer|what|who|explain)\b/;
const POINTED = new RegExp(
  '\\b(?:diese[rsnm]?|das fuer|das hier(?: fuer)?|das da|this|that)\\s+(?:\\S+\\s+)?'
  + '(?:abbuchung|zahlung|buchung|umsatz|umsaetze|lastschrift|ueberweisung|einzug|gutschrift|eingang|dauerauftrag|betrag|posten'
  + '|payment|charge|transaction|debit|transfer|deposit|booking)',
);
// i18n-data-end

/** Whether a question asks to explain the booking it was asked from. */
export function isExplainQuestion(question: string): boolean {
  const q = foldText(question).toLowerCase();
  return ASKS.test(q) && POINTED.test(q);
}
