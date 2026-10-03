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

/**
 * Splits a formatted amount so euros can be set large and cents small.
 *
 * A negative balance leads with a real minus (U+2212), like every other signed
 * figure on screen — the hero sets this at display size, where the hyphen's
 * short, low stroke is at its most visibly wrong.
 */
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
    if (p.type === 'minusSign') { euros += '−'; continue; }
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
  return repairSwiftUmlauts(repairLatin1Mojibake(text));
}

function repairLatin1Mojibake(text: string): string {
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

// Words with an umlaut or ß that turn up in counterparty names and purposes:
// places, family names, trades. Lower case, as a person writes them.
const UMLAUT_WORDS = new Set(`
  thüringen thüringer münchen münchner köln kölner düsseldorf düsseldorfer nürnberg
  nürnberger würzburg würzburger göttingen lübeck lübecker saarbrücken osnabrück tübingen
  fürth lüneburg lüdenscheid gütersloh mülheim mönchengladbach märkisch märkische
  märkischen sächsische sächsischen württemberg württembergische zürich österreich
  österreichische rhön bückeburg königswinter jülich düren büdingen schwäbisch
  schwäbische fränkische fränkischer pfälzische oberösterreich
  straße müller schäfer jäger krämer köhler könig königs böhm möller schröder schütz
  schüler günther jürgen jörg björn sören bäcker bäckerei getränke möbel kühne grün
  grüne süd südwest gebühr gebühren überweisung rückzahlung rücküberweisung rückbuchung
  rückerstattung gemüse käse ärzte ärztin zahnärzte tierärztliche förderung büro
  kündigung prämie beiträge städtische öffentliche ärztekammer bürger bürgeramt
  gläubiger grüße größe fußball süß hörgeräte schlüssel kärcher bücher bücherei
`.split(/\s+/).filter(Boolean));

const UMLAUT_STEMS = [...UMLAUT_WORDS].filter((w) => w.length >= 5);

const knownUmlautWord = (w: string) =>
  UMLAUT_WORDS.has(w) || UMLAUT_STEMS.some((s) => w.startsWith(s) || w.endsWith(s));

/**
 * Repairs umlauts a bank's SWIFT conversion turned into "A.".
 *
 * Some institutes — notably the Sparkassen card processor, whose name arrives
 * as "Landesbank Hessen-ThA.ringen" — store UTF-8, read it as Latin-1 and then
 * squeeze it into the SWIFT character set: "ü" (bytes C3 BC) became "Ã¼",
 * the "Ã" lost its tilde and the "¼" became a dot. Every German umlaut and ß
 * starts with that same C3 byte, so "A." alone cannot say which one it was;
 * a word is only repaired when exactly one reading of it is a word we know.
 * Anything else stays as the bank sent it — a visible fault beats a guessed
 * letter.
 */
export function repairSwiftUmlauts(text: string): string {
  if (!text || !text.includes('A.')) return text;
  return text.replace(/[A-Za-zÄÖÜäöüß]*A\.[A-Za-zÄÖÜäöüß]+(?:A\.[A-Za-zÄÖÜäöüß]+)*/g, (token) => {
    const caps = token.replace(/A\./g, '') === token.replace(/A\./g, '').toUpperCase();
    const parts = token.split('A.');
    const letters = ['ü', 'ä', 'ö', 'ß'];
    let match: string | null = null;
    // One letter for every "A." of the token — names with two broken umlauts
    // in one word are rare enough that the same letter twice is the only case
    // tried; mixed pairs stay unrepaired.
    for (const l of letters) {
      const word = parts.join(l).toLowerCase();
      if (!knownUmlautWord(word)) continue;
      if (match) return token; // two readings fit: don't guess
      match = l;
    }
    if (!match) return token;
    return parts.reduce((acc, part, i) => {
      if (i === 0) return part;
      const atStart = acc.length === 0 || !/[A-Za-zÄÖÜäöüß]$/.test(acc);
      const upper = caps || (atStart && match !== 'ß');
      return acc + (upper && match !== 'ß' ? match.toUpperCase() : match) + part;
    }, '');
  });
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

// Legal forms and the joiners between them ("GmbH & Co. KG", "S.a.r.l. et
// Cie"), folded: uppercase, dots and commas gone. They end a company's name
// without naming it, so a monogram skips them.
const LEGAL_SUFFIXES = new Set([
  'GMBH', 'MBH', 'AG', 'EG', 'SE', 'KG', 'KGAA', 'OHG', 'UG', 'GBR', 'EV', 'EK', 'EKFM', 'BV', 'NV', 'SA', 'SARL',
  'SCA', 'SAS', 'SL', 'SPA', 'SRL', 'RL', 'LTD', 'LIMITED', 'INC', 'LLC', 'CO', 'PLC', 'AB', 'CIE', 'ET', 'UND', '&',
]);

// Accents folded too: "S.à r.l." is the SA … RL of "S.A.R.L.".
const foldSuffix = (word: string) =>
  word.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.,;()]/g, '');

// The German forms a branch suffix gets hyphenated onto.
const BRANCH_FORMS = new Set(['GMBH', 'MBH', 'AG', 'EG', 'SE', 'KG', 'KGAA', 'OHG', 'UG', 'GBR', 'EV', 'EK']);

/** "GmbH", "S.C.A." — or a branch joined to one: "GMBH-ZWNL" (Zweigniederlassung). */
const isLegalSuffix = (word: string) =>
  LEGAL_SUFFIXES.has(foldSuffix(word)) || BRANCH_FORMS.has(foldSuffix(word.split(/[-/]/)[0]));

/**
 * A counterparty's monogram for the avatar on a booking.
 *
 * Words with no letter in them are skipped before the first and last are taken:
 * card terminals and shops append their own numbers to the name they send
 * ("REWE SAGT DANKE 123456"), and a monogram of "R1" identifies nothing. So
 * is a trailing legal form: "Hausverwaltung Kraemer GmbH" is HK, not HG, and
 * "Netflix International B.V." is NI.
 */
export function initials(name: string): string {
  const words = String(name).trim().split(/\s+/).filter((w) => /\p{L}/u.test(w) || w === '&');
  while (words.length > 1 && isLegalSuffix(words[words.length - 1])) words.pop();
  const named = words.filter((w) => /\p{L}/u.test(w));
  if (!named.length) return '•';
  const first = named[0].match(/\p{L}/u)?.[0] ?? '';
  const last = named.length > 1 ? named[named.length - 1].match(/\p{L}/u)?.[0] ?? '' : '';
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
  ZINS: 'Zins', ZINSEN: 'Zinsen', STORNO: 'Storno', RUECKBUCHUNG: 'Rückbuchung',
  VERGUETUNG: 'Vergütung', VERMOEGENSWIRKSAME: 'Vermögenswirksame',
  // Short words that would otherwise pass for acronyms below ("LOHN/GEHALT").
  LOHN: 'Lohn', GEHALT: 'Gehalt', MIETE: 'Miete', RATE: 'Rate', RENTE: 'Rente', BEZUEGE: 'Bezüge',
  SEPA: 'SEPA',
};

/**
 * A booking text a person can read: "ONLINE-UEBERWEISUNG" → "Online-Überweisung",
 * "LOHN/GEHALT" → "Lohn/Gehalt". Every part between spaces, slashes and
 * hyphens is looked at on its own.
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

// ---------------------------------------------------------------------------
// Calendar days
//
// Everything that groups, compares or counts days works on the *local*
// calendar day as a yyyy-mm-dd key. The wire carries JSON Dates (UTC ISO
// strings): a booking the bank dates 3 October arrives as
// "2026-10-02T22:00:00.000Z", so slicing the string would file it under the
// day before. Day arithmetic runs on the key itself, through Date.UTC, where
// no day is 23 or 25 hours long.
// ---------------------------------------------------------------------------

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;
const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * A date as a local Date, from anything the app passes around: a Date, the
 * wire's ISO timestamp, or a bare yyyy-mm-dd from a date input.
 *
 * The bare form is read as a *local* day — `new Date('2026-07-05')` would be
 * UTC midnight, which is still the 4th anywhere west of Greenwich.
 */
export function toLocalDate(d: Date | string | number | null | undefined): Date | null {
  if (d == null || d === '') return null;
  if (typeof d === 'string') {
    const m = DAY_KEY.exec(d);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  const date = d instanceof Date ? new Date(d.getTime()) : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The local calendar day a date falls on, as yyyy-mm-dd; '' when there is none. */
export function dayKey(d: Date | string | number | null | undefined): string {
  if (typeof d === 'string' && DAY_KEY.test(d)) return d;
  const date = toLocalDate(d);
  return date ? isoDate(date) : '';
}

/** A day key as a running day count — subtract two to get whole days between them. */
export function dayNumber(key: string): number {
  const m = DAY_KEY.exec(key);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / MS_PER_DAY : Number.NaN;
}

/** The inverse of dayNumber. */
export function dayFromNumber(n: number): string {
  const d = new Date(n * MS_PER_DAY);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** A day key moved by whole calendar days. */
export function addDaysKey(key: string, n: number): string {
  return dayFromNumber(dayNumber(key) + n);
}

const startOfLocalDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// ---------------------------------------------------------------------------
// Amounts as people type them
// ---------------------------------------------------------------------------

/**
 * An amount as a person types it, or null when it is not one.
 *
 * German first — "1.000,50", "12,99 €", "−49,90", and "1.000" is a thousand —
 * but a pasted "1000.5" or "1,000.50" is read the way its writer meant it: the
 * last separator followed by one or two digits is the decimal point. What
 * stays ambiguous is refused rather than guessed: "12,999" could be a typo of
 * either reading, and a wrong guess here becomes a wrong transfer amount.
 */
export function parseAmount(input: string | null | undefined): number | null {
  let s = String(input ?? '')
    .replace(/[\s  ]+/g, '')
    .replace(/€|EUR/gi, '');
  if (!s) return null;

  let sign = 1;
  const lead = /^[+\-−–]/.exec(s);
  if (lead) {
    if (lead[0] !== '+') sign = -1;
    s = s.slice(1);
  } else if (/[\-−–]$/.test(s)) {
    // "49,90-" — the trailing minus of printed statements and Excel exports.
    sign = -1;
    s = s.slice(0, -1);
  }
  if (!/^[\d.,]*\d[\d.,]*$/.test(s)) return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let intPart = s;
  let fraction = '';

  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: the later one is the decimal separator.
    const dec = lastDot > lastComma ? '.' : ',';
    const group = dec === '.' ? ',' : '.';
    const at = s.lastIndexOf(dec);
    intPart = s.slice(0, at);
    fraction = s.slice(at + 1);
    if (intPart.includes(dec) || !validGrouping(intPart, group)) return null;
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const pieces = s.split(sep);
    const tail = pieces[pieces.length - 1];
    if (pieces.length > 2) {
      // "1.000.000" — only grouping can repeat.
      if (!validGrouping(s, sep)) return null;
      intPart = s;
    } else if (sep === '.' && tail.length === 3 && /^[1-9]\d{0,2}$/.test(pieces[0])) {
      // "1.000" — a German thousands dot. (A comma with three digits after it
      // is the ambiguous case, and falls through to the refusal below.)
      intPart = s;
    } else {
      intPart = pieces[0];
      fraction = tail;
    }
  }

  if (fraction.length > 2) return null;
  const digits = intPart.replace(/[.,]/g, '');
  const value = Number(`${digits || '0'}.${fraction || '0'}`);
  if (!Number.isFinite(value)) return null;
  return (sign * Math.round(value * 100)) / 100 || 0;
}

/** Whether separators in an integer part sit exactly every three digits. */
function validGrouping(intPart: string, sep: string): boolean {
  if (!intPart.includes(sep)) return /^\d+$/.test(intPart);
  const groups = intPart.split(sep);
  return /^\d{1,3}$/.test(groups[0]) && groups.slice(1).every((g) => /^\d{3}$/.test(g));
}

/** An amount for an input field to show back: "1.000,00". No currency, no sign games. */
export function fmtAmountInput(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '';
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

// ---------------------------------------------------------------------------
// Names and identifiers
// ---------------------------------------------------------------------------

/**
 * An IBAN cut down for a list: "DE78 ···" and "5932 71".
 *
 * The tail is what people recognise an account by, so it is the part that is
 * kept whole and grouped exactly as in the full IBAN; only the middle goes.
 * Short identifiers (a bare account number) come back whole in `tail`.
 */
export function fmtShortIban(iban: string | null | undefined): { head: string; tail: string } {
  const s = String(iban ?? '').replace(/\s+/g, '').toUpperCase();
  if (!s) return { head: '', tail: '' };
  if (s.length <= 10) return { head: '', tail: fmtIban(s) };
  const cut = s.length - 6;
  // Re-group the last six characters on the full IBAN's own 4-character grid.
  let tail = '';
  for (let i = cut; i < s.length; i++) {
    if (i > cut && i % 4 === 0) tail += ' ';
    tail += s[i];
  }
  return { head: `${s.slice(0, 4)} ···`, tail };
}

// Spelled the way the companies spell them. Looked up on the uppercase token.
const NAME_CASING: Record<string, string> = {
  GMBH: 'GmbH', MBH: 'mbH', KGAA: 'KGaA', GBR: 'GbR', EG: 'eG', 'E.V.': 'e.V.', 'E.K.': 'e.K.',
  'E.KFM.': 'e.Kfm.', CO: 'Co', 'CO.': 'Co.', LTD: 'Ltd', 'LTD.': 'Ltd.', INC: 'Inc', 'INC.': 'Inc.',
  'E.ON': 'E.ON', MC: 'Mc', DR: 'Dr', 'DR.': 'Dr.', 'PROF.': 'Prof.', 'ST.': 'St.', 'STR.': 'Str.',
  'S.P.A.': 'S.p.A.', PLC: 'plc',
};

// Short words a company writes as an acronym although they hold a vowel. Words
// of up to three letters with no vowel at all (DB, BVG, DKB, HVV) are acronyms
// by construction; a longer one is more often a cut-down word ("ZWNL" for
// Zweigniederlassung), so the few real ones are listed.
const ACRONYMS = new Set([
  'AG', 'SE', 'KG', 'OHG', 'UG', 'AOK', 'DAK', 'HUK', 'IKK', 'ADAC', 'AXA', 'EON', 'ING', 'OBI', 'UPS',
  'ARD', 'GEZ', 'DEVK', 'LVM', 'VHV', 'EWE', 'RWE', 'ENBW', 'BAUHAUS', 'TUI', 'EU', 'USA', 'UK', 'SA', 'SAS',
  'SARL', 'SCA', 'BV', 'NV', 'AB', 'AS', 'OY', 'PLC', 'SPA', 'SRL', 'LLC', 'ATM', 'POS', 'EC', 'SEPA',
  'IBAN', 'BIC', 'VR', 'II', 'III', 'IV', 'VI', 'VII', 'XL', 'XXL', 'ID', 'IT', 'AI', 'TV', 'IKEA', 'REWE',
  'ALDI', 'LIDL', 'EDEKA', 'DM', 'HEM', 'OMV', 'AVIA', 'BMW', 'VW', 'AUDI', 'DKMS', 'DLRG',
]);

// "MAC" opens far more German words (Macht, Macher) than names; only these
// Gaelic ones get the inner capital. "MC" + a name is always one.
const MAC_NAMES = /^MAC(DONALD|GREGOR|LEOD|KENZIE|INTOSH|MILLAN|ARTHUR|LEAN|NEIL|PHERSON|KAY|DOUGALL|FARLANE|INNES)/;

// Brands whose own spelling has an inner capital — re-cased from capitals,
// "PAYPAL" would come out as a "Paypal" the company never writes.
const BRAND_CASING: Record<string, string> = { PAYPAL: 'PayPal' };

/** One run of capitals in display case. */
function caseRun(run: string, afterApostrophe: boolean): string {
  const brand = BRAND_CASING[run];
  if (brand) return brand;
  if (ACRONYMS.has(run)) return run;
  // "MCDONALD'S": the possessive s is not a word of its own.
  if (afterApostrophe && run.length <= 2) return run.toLowerCase();
  if (run.length <= 3 && !/[AEIOUYÄÖÜ]/.test(run)) return run;
  if (/^MC\p{Lu}{3,}$/u.test(run)) return `Mc${run[2]}${run.slice(3).toLowerCase()}`;
  const mac = MAC_NAMES.exec(run);
  if (mac) return `Mac${run[3]}${run.slice(4).toLowerCase()}`;
  return run[0] + run.slice(1).toLowerCase();
}

/**
 * One part of a name between hyphens and slashes, re-cased on its own:
 * "GMBH" in "GMBH-ZWNL" is a legal form like any other.
 */
function casePart(part: string): string {
  const known = NAME_CASING[part];
  if (known) return known;
  // Codes and marks: "1&1", "R+V", "O2", "H&M", "S.A.", "E.ON".
  if (/\d|[&+]/.test(part)) return part;
  const dotted = part.split('.').filter(Boolean);
  if (dotted.length >= 2 && dotted.every((p) => p.length <= 2)) return part;
  return part.replace(/\p{L}+/gu, (run: string, at: number) => caseRun(run, at > 0 && /['’]/.test(part[at - 1])));
}

// Lowercase between other words: "Stadtwerke von der Heide", "Müller und Söhne".
const CONNECTORS = new Set([
  'UND', 'VON', 'VOM', 'ZU', 'ZUM', 'ZUR', 'DER', 'DIE', 'DAS', 'DES', 'DEN', 'DEM', 'VAN', 'DE', 'DI',
  'DA', 'DEL', 'LA', 'LE', 'ET', 'OF', 'THE', 'AND', 'FUER', 'FÜR', 'IM', 'IN', 'AM', 'AN', 'AUF', 'BEI', 'MIT',
]);

// A trailing country code, as banks append to a card acceptor's name.
const COUNTRY_TAIL = new Set(['DE', 'AT', 'CH', 'NL', 'LU', 'IE', 'FR', 'GB', 'BE', 'IT', 'ES', 'US', 'PL', 'DK', 'SE']);

/**
 * A counterparty name as a person would write it.
 *
 * "DB VERTRIEB GMBH" → "DB Vertrieb GmbH", "STADTWERKE MUENCHEN" → "Stadtwerke
 * Muenchen", "REWE MARKT GMBH-ZWNL" → "REWE Markt GmbH-Zwnl", "MCDONALDS" →
 * "McDonalds". Only names that arrive entirely in capitals are touched — a
 * name the bank sent in mixed case is the company's own spelling and is kept
 * exactly. Transliterated umlauts are left alone on purpose: "MUELLER" could
 * be Müller, but "QUELLE" is not Qülle, and a wrong letter in a name is worse
 * than a plain one. The raw name stays available for the detail view.
 */
export function displayName(raw: string | null | undefined): string {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s || !/\p{Lu}/u.test(s)) return s;
  // A brand's own spelling is not a bank's mixed case to respect: "Paypal"
  // is a system's title-casing, never PayPal's.
  if (s !== s.toUpperCase()) return s.replace(/\bPaypal\b/g, 'PayPal');
  const words = s.split(' ');
  const out = words
    .map((word, i) => {
      const known = NAME_CASING[word];
      if (known) return known;
      if (i > 0 && i < words.length - 1 && CONNECTORS.has(word)) return word.toLowerCase();
      if (i === words.length - 1 && i > 0 && COUNTRY_TAIL.has(word)) return word;
      // A club's "EV" without its dots, as card terminals and old systems send it.
      if (i === words.length - 1 && i > 0 && word === 'EV') return 'eV';
      // Joined parts are each a word of their own: "HUK-COBURG", "GMBH-ZWNL".
      return word.split(/([-/])/).map((part) => (part === '-' || part === '/' || !part ? part : casePart(part))).join('');
    })
    .join(' ');
  // The Luxembourg form in its own spelling, however the capitals were
  // dotted and spaced ("S.A.R.L.", "S.A R.L."): one form, two words.
  return out.replace(/\bS\.A\.? ?R\.L\b\.?/g, 'S.à r.l.');
}

// ---------------------------------------------------------------------------
// Purpose text
// ---------------------------------------------------------------------------

// PayPal's own reference block, which it puts in front of the shop's words:
// "PP.5840.PP . Muster GmbH, Ihr Einkauf bei Muster GmbH".
const PAYPAL_BLOCK = /PP\.\d+\.PP\s*\.?\s*/g;

// Abbreviations a remittance line is full of, written the way people write
// them. Looked up on the uppercase part.
const PURPOSE_CASING: Record<string, string> = {
  'NR.': 'Nr.', NR: 'Nr', 'KD.': 'Kd.', KD: 'Kd', 'RG.': 'Rg.', 'INKL.': 'inkl.', 'ZZGL.': 'zzgl.',
  'BZW.': 'bzw.', 'GGF.': 'ggf.', 'CA.': 'ca.', MWST: 'MwSt', 'MWST.': 'MwSt.', GA: 'GA',
};

// Small words that are lowercase inside a sentence.
const PURPOSE_LOWER = new Set([
  'UND', 'ODER', 'VON', 'VOM', 'ZU', 'ZUM', 'ZUR', 'DER', 'DIE', 'DAS', 'DES', 'DEN', 'DEM', 'FUER', 'FÜR',
  'IM', 'IN', 'AM', 'AN', 'AUF', 'BEI', 'MIT', 'BIS', 'PER', 'AUS', 'NACH', 'AB',
]);

// "NETFLIX.COM", "HELP.UBER.COM": a web address, written as one.
const DOMAIN = /^\p{Lu}[\p{Lu}\d-]{2,}(\.\p{Lu}[\p{Lu}\d-]*)*\.(COM|DE|NET|ORG|EU|IO|AT|CH|NL|FR|IT|ES|CO|TV|APP)$/u;

/** One word of an all-caps purpose, re-cased; `first` is the sentence's first word. */
function casePurposeWord(word: string, first: boolean): string {
  // Anything holding a digit is a reference, a date or an amount — kept as
  // the bank wrote it, so it can be matched against an invoice.
  if (!/\p{L}/u.test(word) || /\d/.test(word)) return word;
  const known = PURPOSE_CASING[word] ?? BOOKING_TOKENS[word] ?? NAME_CASING[word];
  if (known) return first ? known[0].toUpperCase() + known.slice(1) : known;
  if (!first && PURPOSE_LOWER.has(word)) return word.toLowerCase();
  if (DOMAIN.test(word)) return word[0] + word.slice(1).toLowerCase();
  return word
    .split(/([-/]+)/)
    .map((part, i, parts) => {
      if (!part || /^[-/]+$/.test(part)) return part;
      const k = PURPOSE_CASING[part] ?? BOOKING_TOKENS[part];
      if (k) return k;
      // A masked card number ("XXXX") and a trailing country ("…/DE") are
      // marks, not words.
      if (/^X{2,}$/.test(part)) return part;
      if (i === parts.length - 1 && i > 0 && COUNTRY_TAIL.has(part)) return part;
      return casePart(part);
    })
    .join('');
}

/**
 * A purpose line a person can read — the second line of a booking:
 * "LOHN/GEHALT 09/2026 PERSONALNR. 44821" → "Lohn/Gehalt 09/2026 Personalnr.
 * 44821", "MIETE WHG 3.OG" → "Miete WHG 3.OG", and PayPal's leading
 * "PP.5840.PP ." block dropped.
 *
 * Re-cased with the same per-part rules as a name (short acronyms like WHG
 * stay, "GMBH" is GmbH), and every word that holds a digit — invoice and
 * customer numbers, dates, codes like "P2C8F1A9D2" — is kept exactly, since
 * those are what a person compares with paper. A purpose the bank already sent
 * in mixed case is kept as it is. For the list only: the detail view shows
 * the bank's own text.
 */
export function prettyPurpose(raw: string | null | undefined): string {
  const s = String(raw ?? '').replace(PAYPAL_BLOCK, '').trim();
  if (!s || s !== s.toUpperCase() || !/\p{Lu}/u.test(s)) return s;
  let first = true;
  return s
    .split(/(\s+)/)
    .map((word) => {
      if (!word || /^\s+$/.test(word)) return word;
      const out = casePurposeWord(word, first);
      first = false;
      return out;
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Dates in words
// ---------------------------------------------------------------------------

/** Whole days from `today` to `d` by calendar day; negative means `d` is ahead. */
function daysBefore(d: Date, today: Date): number {
  return dayNumber(isoDate(today)) - dayNumber(isoDate(d));
}

/**
 * The header over one day of bookings: "Heute", "Gestern", "Morgen",
 * "Montag, 28. September" — and "28. September 2025" once the year is not
 * this one, where the weekday stops helping anybody place the date.
 */
export function fmtDayHeader(d: Date | string | null | undefined, today: Date = new Date()): string {
  const date = toLocalDate(d);
  if (!date) return 'Ohne Datum';
  const diff = daysBefore(date, today);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Gestern';
  if (diff === -1) return 'Morgen';
  if (date.getFullYear() === today.getFullYear()) {
    return new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
  }
  return new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

/**
 * A date range the way a statement heading states it: "05.07.–03.10.2026".
 * The year is written once when both ends share it, and a single day is just
 * that day.
 */
export function fmtRange(from: Date | string | null | undefined, to: Date | string | null | undefined): string {
  const a = toLocalDate(from);
  const b = toLocalDate(to);
  if (!a || !b) return '';
  const dm = (d: Date) => `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.`;
  if (isoDate(a) === isoDate(b)) return `${dm(a)}${a.getFullYear()}`;
  if (a.getFullYear() === b.getFullYear()) return `${dm(a)}–${dm(b)}${b.getFullYear()}`;
  return `${dm(a)}${a.getFullYear()}–${dm(b)}${b.getFullYear()}`;
}

/** "2026-10" → "Oktober 2026". A full yyyy-mm-dd is accepted and read for its month. */
export function fmtMonth(yyyyMm: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(yyyyMm ?? ''));
  if (!m) return '';
  return new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(new Date(+m[1], +m[2] - 1, 1));
}

// ---------------------------------------------------------------------------
// TARGET2 business days
//
// SEPA moves money on TARGET2 days: Monday to Friday except New Year's Day,
// Good Friday, Easter Monday, 1 May and the two Christmas holidays. Those are
// the days a bank books on, so they are what an expected booking or credit
// date is rolled to. (Regional public holidays do not stop SEPA clearing.)
// ---------------------------------------------------------------------------

/**
 * Easter Sunday of a Gregorian year — the anonymous Gregorian computus
 * (Meeus/Jones/Butcher). Good Friday and Easter Monday hang off it.
 */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

const targetHolidayCache = new Map<number, Set<string>>();

function targetHolidays(year: number): Set<string> {
  let set = targetHolidayCache.get(year);
  if (!set) {
    const easter = dayKey(easterSunday(year));
    set = new Set([
      `${year}-01-01`,
      addDaysKey(easter, -2), // Karfreitag
      addDaysKey(easter, 1), // Ostermontag
      `${year}-05-01`,
      `${year}-12-25`,
      `${year}-12-26`,
    ]);
    targetHolidayCache.set(year, set);
  }
  return set;
}

/** Whether SEPA settles on this day (weekday and no TARGET2 holiday). */
export function isTargetBusinessDay(date: Date | string): boolean {
  const d = toLocalDate(date);
  if (!d) return false;
  const wd = d.getDay();
  if (wd === 0 || wd === 6) return false;
  return !targetHolidays(d.getFullYear()).has(isoDate(d));
}

/**
 * The day itself when it is a TARGET2 business day, else the next one — the
 * "following" convention banks apply to a due date that lands on a weekend.
 * Always local midnight.
 */
export function nextTargetBusinessDay(date: Date | string): Date {
  const d = startOfLocalDay(toLocalDate(date) ?? new Date());
  while (!isTargetBusinessDay(d)) d.setDate(d.getDate() + 1);
  return d;
}

/**
 * `n` TARGET2 business days after `date` (before it, for negative `n`); the
 * start day itself never counts. `n = 0` rolls forward like
 * nextTargetBusinessDay. Always local midnight.
 */
export function addBusinessDays(date: Date | string, n: number): Date {
  if (!n) return nextTargetBusinessDay(date);
  const d = startOfLocalDay(toLocalDate(date) ?? new Date());
  const step = n > 0 ? 1 : -1;
  for (let left = Math.abs(Math.trunc(n)); left > 0; ) {
    d.setDate(d.getDate() + step);
    if (isTargetBusinessDay(d)) left--;
  }
  return d;
}

/**
 * The local hour after which an order counts as placed the next day. Banks
 * set their own Annahmeschluss, mostly in the early afternoon; this is a
 * deliberately middle-of-the-road figure for an estimate, not a promise.
 */
const SEPA_CUTOFF_HOUR = 15;

/**
 * When a transfer placed `now` should reach the payee — for the review step's
 * "Gutschrift voraussichtlich Montag, 05.10.2026".
 *
 * Instant transfers settle within seconds on any day of the year, so the
 * answer is `now` itself. A standard SEPA transfer is credited on the first
 * TARGET2 business day after the day it is placed; one placed after the
 * cut-off counts as placed the next day, which also makes a Friday-evening
 * and a Saturday order land on the same Monday. Null only for a date that is
 * not one.
 */
export function expectedCreditDate(now: Date, instant: boolean): Date | null {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  if (instant) return new Date(now.getTime());
  const placed = startOfLocalDay(now);
  if (now.getHours() >= SEPA_CUTOFF_HOUR) placed.setDate(placed.getDate() + 1);
  return addBusinessDays(placed, 1);
}

export type RangePreset = '30d' | '90d' | 'thisMonth' | 'lastMonth' | 'thisYear' | '365d';

/**
 * The date range behind one of the period controls' presets, as local
 * yyyy-mm-dd. Rolling presets end today and reach back that many days;
 * calendar presets cover the month or year, but never past today.
 */
export function presetRange(id: RangePreset, today: Date = new Date()): { from: string; to: string } {
  const t = startOfLocalDay(today);
  const to = isoDate(t);
  const back = (days: number) => ({ from: addDaysKey(to, -days), to });
  switch (id) {
    case '30d':
      return back(30);
    case '90d':
      return back(90);
    case '365d':
      return back(365);
    case 'thisMonth':
      return { from: isoDate(new Date(t.getFullYear(), t.getMonth(), 1)), to };
    case 'lastMonth':
      return {
        from: isoDate(new Date(t.getFullYear(), t.getMonth() - 1, 1)),
        to: isoDate(new Date(t.getFullYear(), t.getMonth(), 0)),
      };
    case 'thisYear':
      return { from: `${t.getFullYear()}-01-01`, to };
    default:
      return back(90);
  }
}
