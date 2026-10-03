// GiroCode — the EPC069-12 "SEPA Credit Transfer" QR payload.
//
// The text inside the QR code every German banking app can scan to prefill a
// transfer. It is a fixed sequence of lines, one element per line:
//
//   BCD                  service tag
//   002                  version (002: the BIC may be left empty within the EEA)
//   1                    character set — 1 is UTF-8
//   SCT                  identification: SEPA Credit Transfer
//   GENODEF1S10          BIC (optional in 002)
//   Max Mustermann       beneficiary name, ≤ 70 characters
//   DE02120300000000202051  IBAN, no spaces
//   EUR12.50             amount, "EUR" + '.'-decimal, optional
//                        purpose code (4 letters, optional)
//                        structured creditor reference (RF…), optional
//   Miete Oktober        unstructured remittance text, ≤ 140 characters
//
// The whole payload may not exceed 331 bytes: that is exactly what a version
// 13 QR code holds at error-correction level M, the largest code the standard
// lets a scanner expect.
//
// Pure and dependency-free apart from the IBAN check, so the `node --test`
// suite can run it under Node's own type stripping.

import { ibanValid } from './format.ts';

/** What a GiroCode asks the payer to send. */
export type EpcPayment = {
  name: string;
  /** Normalised: no spaces, upper case, checksum valid. */
  iban: string;
  bic?: string;
  /** Euros. Only ever positive; absent when the payer is to fill it in. */
  amount?: number;
  /** Unstructured remittance text (Verwendungszweck). */
  purpose?: string;
  /** Structured creditor reference (ISO 11649, "RF…"), when the code carries one. */
  reference?: string;
};

export type EpcInput = {
  name: string;
  iban: string;
  bic?: string | null;
  amount?: number | null;
  purpose?: string | null;
};

export const EPC_MAX_BYTES = 331;
export const EPC_MAX_NAME = 70;
export const EPC_MAX_PURPOSE = 140;
const MIN_CENTS = 1;
const MAX_CENTS = 99_999_999_999; // 999 999 999,99 €

const BIC_RE = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/;

/**
 * One payload element, made safe to stand on a line of its own.
 *
 * A line break inside the name or the purpose would not just look odd — it
 * would shift every following element by one line, and the payer's app would
 * read the purpose as the IBAN. So every run of whitespace or control
 * characters (including U+2028/U+2029, which some decoders treat as line
 * breaks) collapses to a single space.
 */
const element = (s: string | null | undefined) => String(s ?? '').replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim();

/** Characters as a person counts them — "ü" is one, however many UTF-16 units. */
const charCount = (s: string) => [...s].length;

const utf8Length = (s: string) => new TextEncoder().encode(s).length;

/** "EUR12.50": two decimals, a point, no grouping — never the German "12,50". */
function amountElement(amount: number): string {
  if (!Number.isFinite(amount)) throw new Error('Der Betrag ist keine gültige Zahl.');
  const cents = Math.round(amount * 100);
  // A third decimal must not be rounded away silently — the payer would see a
  // different figure than the one that was typed.
  if (Math.abs(amount * 100 - cents) > 1e-6) {
    throw new Error('Der Betrag darf höchstens zwei Nachkommastellen haben.');
  }
  if (cents < MIN_CENTS || cents > MAX_CENTS) {
    throw new Error('Der Betrag muss zwischen 0,01 € und 999.999.999,99 € liegen.');
  }
  return `EUR${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/**
 * The GiroCode text for a payment request — EPC069-12 version 002, UTF-8.
 *
 * Throws an Error with a German message the UI can show as-is when the input
 * cannot become a valid code; it never truncates or rounds to make it fit.
 */
export function buildEpcPayload(input: EpcInput): string {
  const name = element(input.name);
  if (!name) throw new Error('Bitte gib den Namen des Empfängers an.');
  if (charCount(name) > EPC_MAX_NAME) {
    throw new Error(`Der Name darf höchstens ${EPC_MAX_NAME} Zeichen lang sein.`);
  }

  const iban = String(input.iban ?? '').replace(/\s+/g, '').toUpperCase();
  if (!ibanValid(iban)) throw new Error('Die IBAN ist ungültig.');

  const bic = String(input.bic ?? '').replace(/\s+/g, '').toUpperCase();
  if (bic && !BIC_RE.test(bic)) throw new Error('Die BIC ist ungültig.');

  const amount = input.amount == null ? '' : amountElement(input.amount);

  const purpose = element(input.purpose);
  if (charCount(purpose) > EPC_MAX_PURPOSE) {
    throw new Error(`Der Verwendungszweck darf höchstens ${EPC_MAX_PURPOSE} Zeichen lang sein.`);
  }

  const lines = [
    'BCD',
    '002',
    '1', // UTF-8 — what TextEncoder and lib/qr.ts put into the code
    'SCT',
    bic,
    name,
    iban,
    amount,
    '', // purpose code: a payment request has none to state
    '', // structured reference: we only ever write free text
    purpose,
  ];
  // "The last populated element may not be followed by any character or
  // element separator" (EPC069-12). A request without a purpose therefore ends
  // at the amount, or at the IBAN when there is no amount either.
  while (lines.length > 7 && lines[lines.length - 1] === '') lines.pop();
  const payload = lines.join('\n');

  // Only reachable with a long name and a long purpose that are both rich in
  // multi-byte characters: 70 + 140 ASCII characters fit comfortably.
  if (utf8Length(payload) > EPC_MAX_BYTES) {
    throw new Error('Name und Verwendungszweck sind zusammen zu lang für einen GiroCode. Bitte kürze den Verwendungszweck.');
  }
  return payload;
}

/** "EUR12.50" → 12.5; "" / "EUR" → null (no amount); anything else → undefined (invalid). */
function parseAmountElement(raw: string): number | null | undefined {
  const s = raw.replace(/\s+/g, '');
  if (s === '' || s.toUpperCase() === 'EUR') return null;
  // Strictly EUR: an SCT cannot carry any other currency, and quietly reading
  // "CHF100" as 100 € would be worse than refusing the code.
  // A decimal comma is a common deviation from the standard; with at most two
  // decimals it cannot be mistaken for a thousands separator.
  const m = /^EUR(\d{1,9})(?:[.,](\d{1,2}))?$/i.exec(s);
  if (!m) return undefined;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  if (cents === 0) return null; // "EUR0.00" — some generators mean "no amount"
  if (cents > MAX_CENTS) return undefined;
  return cents / 100;
}

/**
 * Reads a scanned GiroCode back into a payment, or null when the text is not
 * one this app can act on.
 *
 * Liberal in form (CRLF or LF, version 001 or 002, any of the eight declared
 * character sets — the caller has already turned the bytes into text, see
 * lib/qr-read.ts), strict in substance: it must be a SEPA credit transfer, in
 * euros, to an IBAN whose checksum holds.
 */
export function parseEpcPayload(text: string): EpcPayment | null {
  if (typeof text !== 'string') return null;
  const lines = text.replace(/^﻿/, '').trimStart().split(/\r\n|\n|\r/).map((l) => l.trim());
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  // Twelve elements at most. More lines than that means a field carried a
  // line break of its own, so every element after it is shifted — and an
  // IBAN read from the wrong line is worse than no prefill at all.
  if (lines.length < 7 || lines.length > 12) return null;

  const [service, version, charset, ident, bicRaw, nameRaw, ibanRaw, amountRaw = '', , refRaw = '', purposeRaw = ''] = lines;
  if (service !== 'BCD') return null;
  if (version !== '001' && version !== '002') return null;
  if (!/^[1-8]$/.test(charset)) return null;
  if (ident !== 'SCT') return null;

  const name = element(nameRaw);
  if (!name) return null;

  const iban = ibanRaw.replace(/\s+/g, '').toUpperCase();
  if (!ibanValid(iban)) return null;

  const amount = parseAmountElement(amountRaw);
  if (amount === undefined) return null;

  // Not needed for a SEPA transfer inside the EEA, so a malformed BIC costs
  // the code nothing — it is dropped rather than the whole code refused.
  const bic = bicRaw.replace(/\s+/g, '').toUpperCase();
  const reference = element(refRaw);
  const purpose = element(purposeRaw);

  return {
    name,
    iban,
    ...(BIC_RE.test(bic) ? { bic } : {}),
    ...(amount != null ? { amount } : {}),
    ...(purpose ? { purpose } : {}),
    ...(reference ? { reference } : {}),
  };
}
