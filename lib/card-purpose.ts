// The card-payment record German banks write into a Verwendungszweck.
//
// A Visa/Mastercard debit or credit card payment arrives with a purpose that
// is not prose at all but the terminal's and the card system's bookkeeping:
//
//   2026-08-18T10:12 Debitk.0 2030-12 Einsatzentgelt 1,00 EUR Zahl.System VISA Debit
//   2026-08-31T09:01 Debitk.0 2030-12 Original 9,85 USD 1 Euro=1,1563 USD Einsatzentgelt 0,15 EUR …
//
// That is: when it happened, which card (sequence number and expiry), the
// amount in the original currency and the rate, the fee the bank added for
// using the card ("Einsatzentgelt", abroad "Auslandseinsatzentgelt"), and the
// card scheme. None of it says *what was bought* — and read as words it is
// actively misleading: "…entgelt" is the German for a fee, which is how a
// 9,99 € purchase used to be filed under "Bankentgelte".
//
// Pure and dependency-free, like the other lib modules the tests run directly.

export type CardPurpose = {
  /** "2026-08-18T10:12" as the bank wrote it, or null. */
  at: string | null;
  card: 'debit' | 'credit' | null;
  /** The card scheme as written ("VISA Debit", "Mastercard"), or null. */
  scheme: string | null;
  /** The amount in the currency the merchant charged, for a foreign-currency payment. */
  original: { amount: number; currency: string; rate: number | null } | null;
  /** The card-usage fee included in the booking, in EUR. */
  fee: number | null;
  /** Whatever the record leaves once its known parts are taken out — sometimes a note ("Teillieferung(Final)"). */
  rest: string;
};

const TIMESTAMP = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?\b/;
// "Debitk.0 2030-12": the card's sequence number and its expiry.
const CARD = /\b(Debitk|Kreditk)\.?\s?\d{1,2}\s+\d{4}-\d{2}\b/i;
const SCHEME = /\bZahl\.?\s?System\s+(VISA\s+Debit|Visa|Mastercard(?:\s+Debit)?|Maestro|V\s?PAY|girocard)\b/i;
const ORIGINAL = /\bOriginal\s+([\d.,]+)\s+([A-Z]{3})(?:\s+1\s+Euro\s*=\s*([\d.,]+)\s+[A-Z]{3})?/i;
const FEE = /\b(?:Auslandseinsatz|Einsatz|Fremdw(?:ae|ä)hrungs?|Kursaufschlag\s?)entgelt\s+([\d.,]+)\s*EUR\b/i;

/** "1.234,56" / "9,85" / "1,1563" → number (German decimals as banks write them). */
function decimal(s: string): number | null {
  const t = s.trim();
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : null;
}

/** Whether a purpose is a card system's record rather than prose. */
export function isCardPurpose(text: string | null | undefined): boolean {
  const s = String(text ?? '');
  return CARD.test(s) || SCHEME.test(s);
}

/** The parts of a card record, or null when the purpose isn't one. */
export function parseCardPurpose(text: string | null | undefined): CardPurpose | null {
  const s = String(text ?? '');
  if (!isCardPurpose(s)) return null;

  const card = CARD.exec(s);
  const scheme = SCHEME.exec(s);
  const original = ORIGINAL.exec(s);
  const fee = FEE.exec(s);
  const origAmount = original ? decimal(original[1]) : null;

  return {
    at: TIMESTAMP.exec(s)?.[0] ?? null,
    card: card ? (/^debit/i.test(card[1]) ? 'debit' : 'credit') : null,
    scheme: scheme ? scheme[1].replace(/\s+/g, ' ') : null,
    original: original && origAmount != null
      ? { amount: origAmount, currency: original[2].toUpperCase(), rate: original[3] ? decimal(original[3]) : null }
      : null,
    fee: fee ? decimal(fee[1]) : null,
    rest: stripCardBoilerplate(s),
  };
}

/**
 * The purpose with the card record taken out — what is left for a reader or a
 * keyword table to work with. A purpose that isn't a card record comes back
 * untouched.
 */
export function stripCardBoilerplate(text: string | null | undefined): string {
  const s = String(text ?? '');
  if (!isCardPurpose(s)) return s;
  return [TIMESTAMP, CARD, SCHEME, ORIGINAL, FEE]
    .reduce((acc, re) => acc.replace(new RegExp(re.source, 'gi'), ' '), s)
    .replace(/\s+/g, ' ')
    .replace(/^[\s·,;:/-]+|[\s·,;:/-]+$/g, '')
    .trim();
}
