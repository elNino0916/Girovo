// Reading an invoice for a transfer when the paper carries no GiroCode: the
// page's text, as the phone's text recognition returns it (mobile/, Google's
// ML Kit), searched for what a transfer needs — the payee's IBAN, the amount
// to pay, the invoice number for the Verwendungszweck, and the payee's name.
//
// The reading is a proposal, never an order. Nothing it finds goes anywhere
// on its own: it fills the transfer form, which checks every field as typed
// ones are, and the review and the bank's Namensabgleich follow. So the rule
// here is to leave a field out rather than guess it:
//
// - an IBAN only when its check digits hold (a misread digit fails mod 97);
//   the common misreadings of a digit (O, I, l) are tried in a German IBAN's
//   number part, and only a result that then holds is taken;
// - an IBAN the text marks as the reader's own (a Lastschrift "von Ihrem
//   Konto") is never the payee's; the caller also drops the user's own
//   accounts;
// - the amount only from a line that names it the amount to pay
//   (Rechnungsbetrag, Gesamtbetrag, zu zahlen …), never a net figure, a tax
//   line or a subtotal, and never "the largest number on the page";
// - the name only from a label (Empfänger, Kontoinhaber) or from a line that
//   reads as a company's (a legal form), near the top, where letterheads are.
//
// An invoice that says it is paid by Lastschrift is marked: there is likely
// nothing to transfer, and the form says so.

import { ibanValid } from './format.ts';

export type InvoiceRead = {
  /** The payee's IBAN, compact and upper case; null when none holds. */
  iban: string | null;
  /** The amount to pay in euros; null when no line names it. */
  amount: number | null;
  /** The Verwendungszweck the invoice asks for, or its invoice number as one. */
  purpose: string | null;
  /** The payee, from a label or a letterhead with a legal form. */
  name: string | null;
  /** The invoice says it is collected by Lastschrift. */
  debit: boolean;
  /** Where each value was found: its line in the text (0-based), to mark it on the page. */
  at: { iban?: number; amount?: number; purpose?: number; name?: number };
};

const EMPTY: InvoiceRead = { iban: null, amount: null, purpose: null, name: null, debit: false, at: {} };

// i18n-data-start — the German words invoices use, matched against their text
const IBAN_NEAR = /\b(iban|bankverbindung|empf(ae|ä)nger|zahlbar|überweis|ueberweis|konto(?:nummer)?|bank)\b/i;
const OWN_NEAR = /(lastschrift|abgebucht|abbuchung|einzug|eingezogen|ihr(?:em|es)? konto|ihre iban|mandat)/i;
const DEBIT = /(per|mittels|durch|im wege der)\s+(sepa-)?lastschrift|wird .{0,40}(abgebucht|eingezogen)|buchen .{0,40}\bab\b/i;
/** "inkl. 19 % MwSt" on a total's own line says what the total holds; it does not make it a tax line. */
const INCLUDED_TAX = /inkl\.?\s*(\d+(?:[,.]\d+)?\s*%\s*)?(mwst|ust|umsatzsteuer|mehrwertsteuer)\.?/gi;
const AMOUNT_LABELS: Array<{ re: RegExp; rank: number }> = [
  { re: /zu zahlen(?:der betrag)?|zahlbetrag|offener betrag|zahlbarer betrag|bitte überweisen|bitte ueberweisen/i, rank: 1 },
  { re: /rechnungsbetrag|rechnungssumme|endbetrag|gesamtbetrag|bruttobetrag|endsumme/i, rank: 2 },
  { re: /\b(gesamt|summe|total|brutto)\b/i, rank: 3 },
  { re: /\bbetrag\b/i, rank: 4 },
];
const NOT_AMOUNT = /\b(netto|nettobetrag|zwischensumme|mwst|ust|umsatzsteuer|mehrwertsteuer|steuer|rabatt|skonto|anzahlung|bereits bezahlt|guthaben)\b/i;
const PURPOSE_LABEL = /verwendungszweck|zahlungsreferenz|referenz/i;
const REFERENCE_LABEL = /rechnungs-?\s?(?:nummer|nr\.?)|rechnung nr\.?|rg\.?-?\s?nr\.?|re\.?-?\s?nr\.?|belegnummer|beleg-?nr\.?/i;
const CUSTOMER_LABEL = /kunden-?\s?(?:nummer|nr\.?)|kd\.?-?\s?nr\.?|vertragskonto|vertragsnummer/i;
const NAME_LABEL = /(zahlungsempf(ae|ä)nger|empf(ae|ä)nger|kontoinhaber(?:in)?|inhaber)\s*:?\s*/i;
const LEGAL_FORM = /\b(gmbh|ag|kg|ohg|ug|se|gbr|e\.\s?k\.|e\.\s?v\.|mbh|partg|kgaa|ltd\.?|limited|inc\.?|sarl|bv)\b/i;
const NOT_NAME = /(rechnung\w*|iban|bic|datum|seite|kunden\w*|telefon|tel\.|fax|e-mail|ust(?:-?id)?|steuer\w*|amtsgericht|hrb|geschäftsführ\w*)(?=\W|$)|www\./i;
// i18n-data-end

/** "1.234,56", "84,20", "84.20" (a dot before exactly two digits at the end), with an optional € or EUR. */
const AMOUNT = /(?:€|eur)?\s*(\d{1,3}(?:[.\s]\d{3})+|\d+)([,.])(\d{2})(?!\d)\s*(?:€|eur)?/gi;

/** The amounts on a line, those marked € or EUR first; dates and percentages are not amounts. */
function amountsIn(line: string): number[] {
  const clean = line
    .replace(/\b\d{1,2}\.\d{1,2}\.(?:\d{2,4})?/g, ' ')
    .replace(/\d+(?:[,.]\d+)?\s*%/g, ' ');
  const marked: number[] = [];
  const plain: number[] = [];
  for (const m of clean.matchAll(AMOUNT)) {
    // A thousands group joined by a dot is only German when the decimal is a comma.
    if (m[2] === '.' && /\./.test(m[1])) continue;
    const whole = m[1].replace(/[.\s]/g, '');
    const value = Number(`${whole}.${m[3]}`);
    if (!Number.isFinite(value) || value <= 0) continue;
    (/€|eur/i.test(m[0]) ? marked : plain).push(value);
  }
  return marked.length ? marked : plain;
}

/** The common misreadings of a digit, tried where a German IBAN has only digits. */
function repairDigits(s: string): string {
  return s.replace(/[OoQD]/g, '0').replace(/[IlL|!]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2');
}

type IbanHit = { iban: string; line: number; score: number };

function ibansIn(lines: string[]): IbanHit[] {
  const hits: IbanHit[] = [];
  lines.forEach((raw, i) => {
    // An IBAN may be printed in groups of four, or wrap: join the line with the next.
    const text = `${raw} ${lines[i + 1] ?? ''}`;
    for (const m of text.matchAll(/\b([A-Z]{2})\s?(\d{2}|[0-9OIl]{2})((?:\s?[A-Z0-9|!]){11,32})/g)) {
      // Found in the next line's own text: that line's pass takes it, under its own number.
      if ((m.index ?? 0) >= raw.length) continue;
      const country = m[1];
      let body = `${m[2]}${m[3]}`.replace(/\s+/g, '');
      if (country === 'DE') body = repairDigits(body).slice(0, 20);
      // Try the longest candidate first, then shorter ones: the match may run into the next word.
      for (let len = Math.min(body.length, 32); len >= 13; len--) {
        const candidate = `${country}${body.slice(0, len)}`;
        if (!ibanValid(candidate)) continue;
        const context = `${lines[i - 1] ?? ''} ${raw}`;
        let score = 0;
        if (IBAN_NEAR.test(context)) score += 2;
        if (OWN_NEAR.test(context)) score -= 5;
        hits.push({ iban: candidate, line: i, score });
        break;
      }
    }
  });
  return hits;
}

function amountFrom(lines: string[]): { value: number; line: number } | null {
  let best: { value: number; rank: number; line: number } | null = null;
  lines.forEach((raw, i) => {
    const line = raw.replace(INCLUDED_TAX, ' ');
    const label = AMOUNT_LABELS.find((l) => l.re.test(line));
    if (!label || NOT_AMOUNT.test(line)) return;
    // The figure on the label's line, else on the next one (a table's two columns).
    const values = amountsIn(line);
    const next = values.length || NOT_AMOUNT.test(lines[i + 1] ?? '') ? [] : amountsIn(lines[i + 1] ?? '');
    const found = values.length ? values : next;
    if (!found.length) return;
    // A total sits last on its line ("Gesamt 3 Pos. 84,20 €").
    const value = found[found.length - 1];
    const at = values.length ? i : i + 1;
    // A better label wins; between equals, the later line (the total under the items).
    if (!best || label.rank < best.rank || (label.rank === best.rank && i > best.line)) best = { value, rank: label.rank, line: at };
  });
  return best ? { value: (best as { value: number }).value, line: (best as { line: number }).line } : null;
}

type Found = { value: string; line: number };

/** What follows a label on its line ("Rechnungsnummer: 2026-104417"), else the next line. */
function valueAfter(lines: string[], label: RegExp): Found | null {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(label);
    if (!m || m.index == null) continue;
    const rest = lines[i].slice(m.index + m[0].length).replace(/^[\s:#.-]+/, '').trim();
    const value = rest || (lines[i + 1] ?? '').trim();
    const token = value.match(/^[A-Z0-9][A-Z0-9/._-]{2,34}/i)?.[0];
    if (token && /\d/.test(token)) return { value: token.replace(/[.,:;-]+$/, ''), line: rest ? i : i + 1 };
  }
  return null;
}

function purposeFrom(lines: string[]): Found | null {
  // An invoice that spells out its Verwendungszweck is followed to the letter.
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(PURPOSE_LABEL);
    if (!m || m.index == null) continue;
    const rest = lines[i].slice(m.index + m[0].length).replace(/^[\s:]+/, '').trim();
    const value = rest || (lines[i + 1] ?? '').trim();
    if (value && /\d/.test(value)) return { value: value.slice(0, 140), line: rest ? i : i + 1 };
  }
  const invoice = valueAfter(lines, REFERENCE_LABEL);
  const customer = valueAfter(lines, CUSTOMER_LABEL);
  // i18n-data-start — the Verwendungszweck is written to the payee, in German
  const parts = [invoice && `Rechnung ${invoice.value}`, customer && `Kd.-Nr. ${customer.value}`].filter(Boolean);
  // i18n-data-end
  return parts.length ? { value: parts.join(' '), line: (invoice ?? customer)!.line } : null;
}

function nameFrom(lines: string[]): Found | null {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(NAME_LABEL);
    if (!m || m.index == null) continue;
    const value = lines[i].slice(m.index + m[0].length).trim();
    if (value.length >= 3 && !/\d{4}/.test(value) && !NOT_NAME.test(value)) return { value: value.slice(0, 70), line: i };
  }
  // A letterhead: the first lines that read as a company's name.
  for (let i = 0; i < Math.min(lines.length, 12); i++) {
    const value = lines[i].trim();
    if (value.length < 4 || value.length > 70 || NOT_NAME.test(value) || /\d{5}/.test(value)) continue;
    if (LEGAL_FORM.test(value)) return { value, line: i };
  }
  return null;
}

/**
 * What a transfer can take from an invoice's text. `own` lists the user's
 * own IBANs (compact), which are never the payee's.
 */
export function readInvoiceText(text: string, own: readonly string[] = []): InvoiceRead {
  // Every line kept, blank ones too, so a value's line is the caller's line.
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim());
  if (!lines.some(Boolean)) return EMPTY;
  const mine = new Set(own.map((i) => i.replace(/\s+/g, '').toUpperCase()));
  const ibans = ibansIn(lines).filter((h) => !mine.has(h.iban) && h.score > -3);
  // The best-placed IBAN; several distinct ones equally placed are no answer at all.
  ibans.sort((a, b) => b.score - a.score);
  const top = ibans[0];
  const tied = ibans.filter((h) => h.score === top?.score && h.iban !== top?.iban);
  const iban = top && !tied.length ? top : null;
  const amount = amountFrom(lines);
  const purpose = purposeFrom(lines);
  const name = nameFrom(lines);
  return {
    iban: iban?.iban ?? null,
    amount: amount?.value ?? null,
    purpose: purpose?.value ?? null,
    name: name?.value ?? null,
    debit: DEBIT.test(lines.join(' ')),
    at: {
      ...(iban ? { iban: iban.line } : {}),
      ...(amount ? { amount: amount.line } : {}),
      ...(purpose ? { purpose: purpose.line } : {}),
      ...(name ? { name: name.line } : {}),
    },
  };
}

/** Whether a reading found anything worth putting in a form. */
export const readSomething = (r: InvoiceRead): boolean => !!(r.iban || r.amount != null || r.purpose || r.name);
