// A typed TAN: what the entry field accepts and the route sends on.
//
// TANs are short runs of digits (chipTAN, photoTAN, smsTAN) or, at a few
// banks, letters and digits. Nothing a TAN is made of needs FinTS' syntax
// characters, so a value carrying them is a mistype, never a TAN — and is
// never sent. Pure: for the overlay, the route and `node --test`.

/** Longer than any TAN a bank issues, short of anything abusive. */
export const TAN_MAX = 64;

/** What the user typed, as it goes to the bank: spaces anywhere dropped (a TAN read off a display in groups). */
export function cleanTan(typed: string): string {
  return typed.replace(/\s+/g, '');
}

/** Whether `tan` (cleaned) can be a TAN at all; with `numeric`, digits only. */
export function isPlausibleTan(tan: string, numeric?: boolean | null): boolean {
  if (!tan || tan.length > TAN_MAX) return false;
  return numeric ? /^\d+$/.test(tan) : /^[0-9A-Za-z\-_.]+$/.test(tan);
}
