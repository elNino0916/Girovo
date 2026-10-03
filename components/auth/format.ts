// Small presentation helpers shared by the auth screens.

/** A Bankleitzahl the way it is printed on German cards and statements: 570 501 20. */
export function fmtBlz(blz: string): string {
  const d = String(blz || '').replace(/\D/g, '');
  return d.length === 8 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : String(blz || '');
}

/**
 * A bank's answer as the server passes it on — "9931: Anmeldename oder PIN
 * falsch. | 9800: Dialog abgebrochen" — split into the sentences a person
 * reads and the return codes support asks for. The codes stay available, just
 * not in the way. Text without that shape comes back as one line.
 */
export function splitBankAnswer(message: string): { lines: string[]; codes: string[] } {
  const parts = String(message || '').split(/\s+\|\s+/).map((p) => p.trim()).filter(Boolean);
  const answers = parts.map((part) => {
    const m = /^(\d{4}):\s*([\s\S]*)$/.exec(part);
    return { code: m ? m[1] : null, text: (m ? m[2] : part).trim() };
  });
  // The server passes on everything the bank said, notes and warnings
  // included. When there is an error (9xxx) only the errors are the answer —
  // minus 9800 "Dialog abgebrochen", which merely follows any of them.
  const errors = answers.filter((a) => a.code?.startsWith('9'));
  const meaningful = errors.filter((a) => a.code !== '9800');
  const shown = errors.length ? (meaningful.length ? meaningful : errors) : answers;
  const lines: string[] = [];
  for (const a of shown) if (a.text && !lines.includes(a.text)) lines.push(a.text);
  if (!lines.length && message) lines.push(message);
  const codes = answers.map((a) => a.code).filter((c): c is string => !!c);
  return { lines, codes: [...new Set(codes)] };
}

// The bank refused the credentials themselves, as opposed to being out of
// reach or turning the app's product registration down (9078). Banks word
// this differently and do not all use the same return code, so the codes most
// of them send (9931, 9942) are backed up by the words their texts share —
// and by our own "Prüfe … Anmeldename und PIN" fallback.
const CREDENTIAL_CODES = new Set(['9931', '9942']);
const CREDENTIAL_WORDS = /\bPIN\b|Anmeldename|Kennung|Legitimation|Zugangsdaten|Benutzer/i;

export function isCredentialError(message: string): boolean {
  const { lines, codes } = splitBankAnswer(message);
  if (codes.some((c) => CREDENTIAL_CODES.has(c))) return true;
  if (codes.includes('9078')) return false;
  return lines.some((l) => CREDENTIAL_WORDS.test(l)) && !/nicht erreichbar/i.test(message);
}
