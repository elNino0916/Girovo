// What someone typed into "Bank suchen", read the way they meant it.
//
// People find their bank by name or town, by the BLZ printed the way the app
// itself prints it ("370 400 44"), or — most of all — by the IBAN on their
// card or statement, whose 5th to 12th characters are the BLZ. The IBAN is
// read here, in the browser: only the 8-digit BLZ ever goes to the search
// route, because a GET puts its query in the URL, and a URL ends up in logs.
//
// Shared by the picker (components/auth/BankPicker.tsx) and the search itself
// (lib/banks.ts), so both agree on what counts as a BLZ.

import { ibanValid } from './format.ts';

export type BankQuery =
  | { kind: 'empty' }
  /** Digits, spaces allowed between them: a BLZ or the start of one. Spaces removed. */
  | { kind: 'blz'; digits: string }
  /**
   * Something IBAN-shaped: two letters, two check digits, more.
   * `blz` is set once a German IBAN has its 12 characters (and its BLZ
   * digits are digits); `valid` once it is complete — 22 characters, or
   * more, which no German IBAN has.
   */
  | { kind: 'iban'; country: string; blz: string | null; complete: boolean; valid: boolean | null }
  | { kind: 'text'; text: string };

/** A German IBAN is 22 characters; the BLZ sits at characters 5 to 12. */
const DE_IBAN_LENGTH = 22;

export function parseBankQuery(input: string): BankQuery {
  const text = String(input ?? '').trim();
  if (!text) return { kind: 'empty' };

  // Only when the query is digits and spaces alone: "Sparkasse 1822" is a
  // name, not a BLZ with a word in front.
  if (/^[\d\s]+$/.test(text)) return { kind: 'blz', digits: text.replace(/\s+/g, '') };

  const compact = text.replace(/\s+/g, '').toUpperCase();
  // No bank name starts with two letters and a digit, so this cannot swallow
  // a name search ("N26" has one letter in front) — and an IBAN being typed
  // is recognised from its first check digit on, before "DE8" can come back
  // as "no bank of that name".
  if (/^[A-Z]{2}\d(\d[A-Z0-9]*)?$/.test(compact)) {
    const country = compact.slice(0, 2);
    if (country !== 'DE') return { kind: 'iban', country, blz: null, complete: false, valid: null };
    const bankPart = compact.slice(4, 12);
    const blz = compact.length >= 12 && /^\d{8}$/.test(bankPart) ? bankPart : null;
    const complete = compact.length >= DE_IBAN_LENGTH;
    return { kind: 'iban', country, blz, complete, valid: complete ? ibanValid(compact) : null };
  }

  return { kind: 'text', text };
}

/**
 * What goes to /api/bank-search for this query — never more than a BLZ for
 * an IBAN, and nothing at all while there is not yet enough to look for.
 */
export function bankSearchTerm(q: BankQuery): string | null {
  switch (q.kind) {
    case 'blz':
      // The route matches a BLZ from three digits on.
      return q.digits.length >= 3 ? q.digits : null;
    case 'iban':
      // A complete IBAN with a wrong check number may carry a mistyped BLZ:
      // looking that up could name the wrong bank.
      return q.blz && q.valid !== false ? q.blz : null;
    case 'text':
      return q.text.length >= 2 ? q.text : null;
    default:
      return null;
  }
}
