// Presentation helpers. German locale throughout — this app only talks to
// German banks, so there is no locale to negotiate.

export const fmtMoney = (v: number | null | undefined, cur = 'EUR') =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur }).format(v ?? 0);

/**
 * A bare amount — no currency symbol, always two decimals.
 *
 * What a printed Kontoauszug puts in its amount column: the currency is stated
 * once in the column head, and the figures stay a clean numeric block.
 */
export const fmtDecimal = (v: number | null | undefined) =>
  new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v ?? 0);

/**
 * A debit's minus sign, as a real minus (U+2212) rather than a hyphen.
 *
 * The hyphen Intl emits is narrower than a digit and sits too low, which is
 * exactly wrong in a column of tabular figures.
 */
const properMinus = (s: string) => s.replace('-', '−');

/** Signed amount with currency: "−6,11 €" for a debit, "128,40 €" for a credit. */
export const fmtSignedMoney = (v: number | null | undefined, cur = 'EUR') => properMinus(fmtMoney(v, cur));

/** Signed bare amount for a statement's amount column: "−6,11" / "128,40". */
export const fmtSignedDecimal = (v: number | null | undefined) => properMinus(fmtDecimal(v));

export const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d)) : '';

export const fmtIban = (iban: string | null | undefined) =>
  iban ? String(iban).replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim() : '';

/** Splits a formatted amount so euros can be set large and cents small. */
export function splitMoney(v: number | null | undefined, cur = 'EUR') {
  const parts = new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur }).formatToParts(v ?? 0);
  let euros = '';
  let cents = '';
  let suffix = '';
  let inFraction = false;
  for (const p of parts) {
    if (p.type === 'decimal') { inFraction = true; cents += p.value; continue; }
    if (p.type === 'fraction') { cents += p.value; continue; }
    if (p.type === 'currency') { suffix = p.value; continue; }
    if (p.type === 'literal' && inFraction) continue;
    euros += p.value;
  }
  return { euros: euros.trim(), cents, suffix };
}

export const txTime = (t: { entryDate?: Date | string; valueDate?: Date | string }) => {
  const d = new Date(t.entryDate || t.valueDate || 0);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
};

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/** Whole days between a date and today. Negative means the date is ahead. */
export function daysFromToday(d: Date | string | null | undefined): number | null {
  if (!d) return null;
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  return Math.round((startOfDay(new Date()).getTime() - startOfDay(date).getTime()) / 86400000);
}

/**
 * Whether a date is still ahead of us.
 *
 * Banks routinely stamp a weekend transfer with the *next business day* as its
 * Buchungstag while value-dating it immediately, and date the closing balance
 * of an interim report to that same day — so a statement fetched on Saturday
 * legitimately contains dates in the future. They must never be presented as
 * though they had already happened.
 */
export const isFutureDate = (d: Date | string | null | undefined): boolean => {
  const n = daysFromToday(d);
  return n != null && n < 0;
};

/** "Heute", "Gestern", "Morgen", a weekday for this week, else a written date. */
export function groupLabel(d: Date | string | null | undefined): string {
  const diff = daysFromToday(d);
  if (diff == null) return 'Ohne Datum';
  const date = new Date(d as Date | string);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Gestern';
  if (diff === -1) return 'Morgen';
  // A bare weekday is only unambiguous looking backwards — "Montag" for a date
  // still to come would read as the Monday that just passed.
  if (diff > 1 && diff < 7) return new Intl.DateTimeFormat('de-DE', { weekday: 'long' }).format(date);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat('de-DE', {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}

/**
 * Sequences that are only produced by reading UTF-8 as Latin-1: a lead byte
 * followed by the right number of continuation bytes.
 */
const UTF8_READ_AS_LATIN1 =
  /[Â-ß][-¿]|à[ -¿][-¿]|[á-ï][-¿]{2}|ð[-¿][-¿]{2}/;

/**
 * Repairs text the FinTS transport mis-decoded.
 *
 * FinTS 3.0 puts ISO-8859-1 on the wire and lib-fints decodes the whole
 * response that way. Some banks nonetheless send UTF-8 in newer fields — the
 * Verification-of-Payee texts are where it shows up — so "Zahlungsempfänger"
 * arrives as "ZahlungsempfÃ¤nger".
 *
 * Only strings that really are UTF-8 wearing a Latin-1 costume are touched:
 * there must be a valid multi-byte sequence, every character must fit in a
 * byte, and the re-decode must succeed. Genuine Latin-1 comes back unchanged.
 */
export function repairBankText(text: string): string {
  if (!text || !UTF8_READ_AS_LATIN1.test(text)) return text;
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0xff) return text; // real Unicode already — not a mis-decode
    bytes[i] = code;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return text; // not valid UTF-8 after all
  }
}

/**
 * A name as a person writes it rather than as the bank stores it:
 * "NINO BORNEMANN" → "Nino Bornemann".
 *
 * MT940 carries the account holder in caps, which is fine in a column of data
 * and wrong in a sentence — a greeting that shouts the user's own name back at
 * them reads as a system message, not a welcome. A name the bank already sent
 * in mixed case is left exactly as it is.
 */
export function properName(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim();
  if (!s || s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s\-'’./])(\p{Ll})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/**
 * A counterparty's monogram for the avatar on a booking.
 *
 * Words with no letter in them are skipped before the first and last are taken:
 * card terminals and shops append their own numbers to the name they send
 * ("REWE SAGT DANKE 123456"), and a monogram of "R1" identifies nothing.
 */
export function initials(name: string): string {
  const words = String(name).trim().split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (!words.length) return '•';
  const first = words[0].match(/\p{L}/u)?.[0] ?? '';
  const last = words.length > 1 ? words[words.length - 1].match(/\p{L}/u)?.[0] ?? '' : '';
  return (first + last).toUpperCase();
}

const ACCOUNT_TYPES: Record<string, string> = {
  CheckingAccount: 'Girokonto',
  SavingsAccount: 'Sparkonto',
  FixedDepositAccount: 'Festgeld',
  SecuritiesAccount: 'Depot',
  LoanMortgageAccount: 'Kredit',
  CreditCardAccount: 'Kreditkarte',
  HomeSavingsContract: 'Bausparvertrag',
  InsurancePolicy: 'Versicherung',
  InvestmentCompanyFund: 'Fonds',
  Miscellaneous: 'Konto',
};

export const translateType = (t: string) => ACCOUNT_TYPES[t] || 'Konto';

// Booking texts arrive from MT940 :86: shouting in caps with the umlauts
// transliterated ("ONLINE-UEBERWEISUNG"). The words are the bank's own — only
// their casing is unreadable — so known tokens are restored and everything else
// is title-cased rather than guessed at.
const BOOKING_TOKENS: Record<string, string> = {
  UEBERWEISUNG: 'Überweisung', UEBERTRAG: 'Übertrag', ECHTZEITUEBERWEISUNG: 'Echtzeitüberweisung',
  DAUERAUFTRAG: 'Dauerauftrag', LASTSCHRIFT: 'Lastschrift', BASISLASTSCHRIFT: 'Basislastschrift',
  FIRMENLASTSCHRIFT: 'Firmenlastschrift', RUECKLASTSCHRIFT: 'Rücklastschrift',
  KARTENZAHLUNG: 'Kartenzahlung', KARTENVERFUEGUNG: 'Kartenverfügung',
  BARGELDAUSZAHLUNG: 'Bargeldauszahlung', GELDAUTOMAT: 'Geldautomat',
  GUTSCHRIFT: 'Gutschrift', GUTSCHR: 'Gutschrift', UEBERW: 'Überweisung',
  ENTGELT: 'Entgelt', ENTGELTABSCHLUSS: 'Entgeltabschluss', ABSCHLUSS: 'Abschluss',
  ZINSEN: 'Zinsen', STORNO: 'Storno', RUECKBUCHUNG: 'Rückbuchung',
  VERGUETUNG: 'Vergütung', VERMOEGENSWIRKSAME: 'Vermögenswirksame',
};

/**
 * A booking text a person can read: "ONLINE-UEBERWEISUNG" → "Online-Überweisung".
 *
 * A text the bank already sent in mixed case is left exactly as it is.
 */
export function prettyBookingText(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim();
  if (!s || s !== s.toUpperCase()) return s;
  return s
    .split(/([\s/·+-]+)/)
    .map((part) => {
      if (!part || /^[\s/·+-]+$/.test(part)) return part;
      const known = BOOKING_TOKENS[part];
      if (known) return known;
      // Acronyms the bank means as acronyms — SEPA, POS, ATM, EC.
      if (part.length <= 4 && !/\d/.test(part)) return part;
      return part[0] + part.slice(1).toLowerCase();
    })
    .join('');
}

/**
 * The country an IBAN belongs to, named in German.
 *
 * Derived from the IBAN's own country prefix — the only geography a booking
 * actually carries — and resolved through Intl rather than a table that would
 * go stale.
 */
export function ibanCountry(iban: string | null | undefined): { code: string; name: string } | null {
  const code = String(iban ?? '').replace(/\s+/g, '').slice(0, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  try {
    const name = new Intl.DisplayNames(['de'], { type: 'region' }).of(code);
    return name && name !== code ? { code, name } : null;
  } catch {
    return null;
  }
}

/** Local ISO date (yyyy-mm-dd) for <input type="date"> — never UTC-shifted. */
export function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Mirrors the server's ISO 13616 mod-97 check so the form can validate live. */
export function ibanValid(input: string): boolean {
  const iban = String(input || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith('DE') && iban.length !== 22) return false;
  const re = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of re) {
    const v = ch >= '0' && ch <= '9' ? ch : (ch.charCodeAt(0) - 55).toString();
    for (const d of v) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}
