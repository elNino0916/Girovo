// Girovo AI's answer style as the vault keeps it (lib/ask-style.ts reads it):
// the checks every place that rebuilds the saved data uses, with nothing
// imported, so the server's vault code stays light.
//
// Pure: no path aliases, no imports.

export type AskTone = 'friendly' | 'plain';
export type AskLength = 'short' | 'long';

/** Longer than any first name: what is typed beyond it is cut. */
export const NAME_MAX = 30;

export const isAskTone = (v: unknown): v is AskTone => v === 'friendly' || v === 'plain';
export const isAskLength = (v: unknown): v is AskLength => v === 'short' || v === 'long';

/**
 * A typed name as Girovo keeps it: one line, letters with spaces, hyphens and
 * apostrophes between them ("Anna-Lena", "D'Arcy"), at most NAME_MAX long.
 * Anything else (digits, a link, an empty field) is no name: undefined.
 */
export function cleanAskName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
  return /^\p{L}+(?:[ '’-]\p{L}+)*$/u.test(s) ? s : undefined;
}
