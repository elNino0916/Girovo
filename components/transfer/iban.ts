// IBAN entry, the way a person types, pastes and checks one.
//
// The field shows the IBAN in groups of four — the form it is printed in on
// every invoice — while the value underneath is the bare, upper-case string.
// Grouping is applied on every keystroke, so the caret has to be carried
// across the spaces that appear and disappear, or typing in the middle of an
// IBAN would throw it to the end.

import { ibanCountry, ibanValid } from '@/lib/format';
import { msgs } from '@/lib/i18n';

/**
 * IBAN lengths in the SEPA area (EPC409-09, 2025 edition). Used to decide
 * WHEN to validate while typing — at the country's full length, never before —
 * and to name the expected length in an error. Validity itself is always the
 * mod-97 check in ibanValid.
 */
export const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AL: 28, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, ES: 24,
  FI: 18, FR: 27, GB: 22, GI: 23, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26, IT: 27, LI: 21, LT: 20,
  LU: 20, LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MT: 31, NL: 18, NO: 15, PL: 28, PT: 25, RO: 24,
  RS: 22, SE: 24, SI: 19, SK: 24, SM: 27, VA: 22,
};

/** The longest IBAN is 34 characters; grouped, that is 42 with the spaces. */
export const IBAN_MAX_RAW = 34;
export const IBAN_MAX_FORMATTED = 42;

/** No spaces, upper case, nothing but letters and digits. */
export const rawIban = (s: string | null | undefined) =>
  String(s ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

/** "DE12 3456 7890 …" — no trailing space, so the caret never sits behind one. */
export const groupIban = (raw: string) => raw.replace(/(.{4})(?=.)/g, '$1 ');

/** The full length expected for the IBAN's country, when it is a SEPA country. */
export const expectedLength = (raw: string): number | null => IBAN_LENGTHS[raw.slice(0, 2)] ?? null;

/**
 * Re-groups `input` and works out where the caret belongs: after the same
 * number of letters and digits as before, whatever spaces moved around it.
 */
export function regroup(input: string, caret: number): { value: string; caret: number } {
  const before = rawIban(input.slice(0, Math.max(0, caret))).length;
  const raw = rawIban(input).slice(0, IBAN_MAX_RAW);
  const value = groupIban(raw);
  const target = Math.min(before, raw.length);
  let pos = 0;
  for (let seen = 0; pos < value.length && seen < target; pos++) {
    if (value[pos] !== ' ') seen++;
  }
  return { value, caret: pos };
}

/** What a pasted IBAN often comes wrapped in: "IBAN: DE12 …", "IBAN DE12…". */
export const stripIbanLabel = (text: string) => text.replace(/^\s*IBAN\s*:?\s*/i, '');

/**
 * Why `raw` is not a usable IBAN, in words (the language speaking right now)
 * — or null when it is one. `own` is the sending account's IBAN: a transfer
 * to itself is refused by the server too, but saying so here is kinder than
 * a round trip.
 */
export function ibanProblem(raw: string, own?: string | null): string | null {
  const words = msgs().transfer.iban;
  if (!raw) return words.missing;
  if (!/^[A-Z]{2}/.test(raw)) return words.countryCode;
  if (!/^[A-Z]{2}\d{2}/.test(raw)) return words.checkDigits;
  const len = expectedLength(raw);
  if (len && raw.length !== len) {
    // The country as the language names it, with its article where it takes one.
    return words.length(len, raw.length, ibanCountry(raw)?.name ?? null);
  }
  if (!ibanValid(raw)) return words.checksum;
  if (own && raw === rawIban(own)) return words.own;
  return null;
}

/** A SEPA transfer can only reach an IBAN inside the SEPA area. */
export const isSepaIban = (raw: string) => raw.length >= 2 && raw.slice(0, 2) in IBAN_LENGTHS;
