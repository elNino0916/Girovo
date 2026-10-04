// The bank's answer, the way a person reads it.
//
// The server passes on what the bank said as one string —
// "9931: Anmeldename oder PIN falsch. | 9800: Dialog abgebrochen"
// (lib/serialize.ts bankAnswerText). On screen that becomes the bank's own
// sentences, word for word, and a small "Rückmeldung der Bank: 9931" for
// whoever has to call the bank about it. The codes stay available; they just
// do not lead (DESIGN.md: the protocol stays out of the interface).
//
// Also the home of the app's own sentence for a bank that does not answer
// (lib/bank-fetch.ts produces it on the server): a screen recognises it here
// and adds the next step that fits where it is.
//
// Pure and client-safe: the login screens, the method screen and the order
// screens can all read an answer through this one formatter.

/**
 * The bank did not answer usefully: an HTTP error page (maintenance), a reply
 * that is no FinTS message, or no first byte within the time limit. Says what
 * happened and nothing about what to do — that depends on the screen.
 */
export const BANK_UNAVAILABLE = 'Deine Bank antwortet gerade nicht – oft ist das eine Wartung.';

/** The bank could not be reached at all (no connection, name not resolved). */
export const BANK_UNREACHABLE = 'Deine Bank ist gerade nicht erreichbar. Prüfe deine Internetverbindung.';

/**
 * The next step a login or a read adds to either sentence above. Never on an
 * order once it has gone out — that outcome stays "Status unklar".
 */
export const TRY_AGAIN_LATER = 'Versuche es in ein paar Minuten noch einmal.';

/** Whether a message is one of the two "the bank is not answering" sentences. */
export function isBankOutage(message: string | null | undefined): boolean {
  const m = String(message ?? '');
  return m.startsWith(BANK_UNAVAILABLE) || m.startsWith(BANK_UNREACHABLE);
}

export type BankAnswer = {
  /** The bank's sentences, verbatim and without their codes, each once. */
  lines: string[];
  /** The return codes behind those sentences, for "Rückmeldung der Bank: …". */
  codes: string[];
  /**
   * The bank says something is locked — the access, the PIN, the account —
   * in its own words ("gesperrt"), because the codes alone are ambiguous:
   * some banks send 9942 for a plain wrong PIN. Only the bank can lift it.
   */
  locked: boolean;
};

type Part = { code: string | null; text: string };

/** Return code 9800, "Dialog abgebrochen": it follows any error and adds nothing. */
const DIALOG_ENDED = '9800';

/**
 * A warning (3xxx) that still matters next to an error: how many tries are
 * left, or that the access is (about to be) locked.
 */
const LOCK_WARNING = /sperr|fehlversuch|fehleingabe|versuch/i;

const LOCK_WORDS = /gesperrt|zugangssperre|pin-?sperre/i;
/** A lock announced, not happened: "… wird nach drei Fehlversuchen gesperrt". */
const LOCK_NOT_YET = /\b(?:wird|werden|würde|würden|droht|drohen|sonst|bevor)\b/i;
const LOCK_NEGATED = /nicht\s+(?:mehr\s+)?gesperrt|entsperrt/i;

const FALLBACK_LINE = 'Deine Bank hat keine Begründung mitgeschickt.';

function parts(message: string): Part[] {
  return message
    .split(/\s+\|\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = /^(\d{4}):\s*([\s\S]*)$/.exec(p);
      return { code: m ? m[1] : null, text: (m ? m[2] : p).trim() };
    });
}

function isLockLine(line: string): boolean {
  return LOCK_WORDS.test(line) && !LOCK_NOT_YET.test(line) && !LOCK_NEGATED.test(line);
}

export function formatBankAnswer(message: string | null | undefined): BankAnswer {
  const all = parts(String(message ?? ''));
  if (!all.length) return { lines: [], codes: [], locked: false };

  // When the bank reports an error (9xxx), the errors are the answer; its
  // notes and warnings ride along on every reply and would bury it. Kept are
  // the warnings about tries and locks: "noch 1 Versuch" next to "PIN falsch"
  // is the one thing the user must not miss.
  const errors = all.filter((p) => p.code?.startsWith('9'));
  const meaningful = errors.filter((p) => p.code !== DIALOG_ENDED);
  const lockWarnings = all.filter((p) => p.code?.startsWith('3') && LOCK_WARNING.test(p.text));
  const shown = errors.length ? [...(meaningful.length ? meaningful : errors), ...lockWarnings] : all;

  const lines: string[] = [];
  for (const p of shown) if (p.text && !lines.includes(p.text)) lines.push(p.text);
  const codes = [...new Set(shown.map((p) => p.code).filter((c): c is string => !!c))];
  if (!lines.length) lines.push(FALLBACK_LINE);

  return { lines, codes, locked: lines.some(isLockLine) };
}

// The bank turned the credentials themselves down — as opposed to being out
// of reach, or refusing the app's product registration (9078). Banks word
// this differently and do not all send the same code, so the codes most of
// them use (9931, 9942) are backed up by the words their texts share, and by
// the server's own "Prüfe Anmeldename und PIN" fallback.
const CREDENTIAL_CODES = new Set(['9931', '9942']);
const CREDENTIAL_WORDS = /\bPIN\b|Anmeldename|Kennung|Legitimation|Zugangsdaten|Benutzer|Passwort/i;

export function isCredentialAnswer(message: string | null | undefined): boolean {
  if (isBankOutage(message)) return false;
  const all = parts(String(message ?? ''));
  const codes = new Set(all.map((p) => p.code));
  if ([...CREDENTIAL_CODES].some((c) => codes.has(c))) return true;
  if (codes.has('9078')) return false;
  return formatBankAnswer(message).lines.some((l) => CREDENTIAL_WORDS.test(l)) && !/nicht erreichbar/i.test(String(message));
}
