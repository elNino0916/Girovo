// SEPA text: what a name or Verwendungszweck becomes on its way to the bank.
//
// The pain.001 the transfer route builds (lib/fints-sepa.ts) only carries the
// EPC basic Latin character set, so every name and purpose is rewritten
// first: ä → ae, ß → ss, € → EUR, @ → (at), anything else outside the set
// becomes a space. That rewrite makes text longer, and the field limits (70
// for the name, 140 for the purpose) apply to the rewritten form.
//
// The transfer sheet therefore needs the very same function: to count the
// limit the bank will count, and to show on the review step what the bank
// will actually receive instead of what was typed. Pure and import-free on
// purpose — lib/fints-sepa.ts pulls in lib-fints and must never reach the
// browser, and `node --test` loads this directly (lib/sepa-text.test.ts).

const TRANSLIT: Record<string, string> = {
  'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss',
  'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'å': 'a', 'ç': 'c', 'è': 'e', 'é': 'e',
  'ê': 'e', 'ë': 'e', 'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i', 'ñ': 'n', 'ò': 'o',
  'ó': 'o', 'ô': 'o', 'õ': 'o', 'ù': 'u', 'ú': 'u', 'û': 'u', 'ý': 'y',
  'À': 'A', 'Á': 'A', 'Â': 'A', 'Ã': 'A', 'Å': 'A', 'Ç': 'C', 'È': 'E', 'É': 'E',
  'Ê': 'E', 'Ë': 'E', 'Ì': 'I', 'Í': 'I', 'Î': 'I', 'Ï': 'I', 'Ñ': 'N', 'Ò': 'O',
  'Ó': 'O', 'Ô': 'O', 'Õ': 'O', 'Ù': 'U', 'Ú': 'U', 'Û': 'U', 'Ý': 'Y',
  '&': '+', '€': 'EUR', '@': '(at)', '*': '.', '_': '-', '"': "'",
};

/** The SEPA field limits, counted on the rewritten text. */
export const SEPA_NAME_MAX = 70;
export const SEPA_PURPOSE_MAX = 140;

// Reduce any text to the SEPA/EPC allowed character set (pure ASCII), so the
// pain.001 byte length always equals its JS string length regardless of the
// transport encoding.
//
// `maxLength` cuts the result. Only for fields nobody typed (an end-to-end
// reference, the account holder's name from the bank): a name or purpose the
// user entered is refused when too long, never silently shortened.
export function sepaSanitize(text: unknown, maxLength?: number): string {
  let out = '';
  for (const ch of String(text ?? '')) {
    if (/[A-Za-z0-9\/\-?:().,'+ ]/.test(ch)) out += ch;
    else if (TRANSLIT[ch] !== undefined) out += TRANSLIT[ch];
    else out += ' ';
  }
  out = out.replace(/\s+/g, ' ').trim();
  return maxLength ? out.slice(0, maxLength) : out;
}

/** How long `text` is once rewritten — the length the bank's limit applies to. */
export const sepaLength = (text: unknown): number => sepaSanitize(text).length;
