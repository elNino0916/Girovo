// What a bank's answer says, read the one way the whole app reads it.
//
// FinTS answers with numbered return codes, each with a sentence: 0xxx for
// success, 3xxx for notes and warnings, 9xxx for errors. The wire between the
// route handlers and the client carries them as one string,
// "9050: Die Nachricht enthält Fehler. | 9210: Empfänger-IBAN gesperrt.",
// so the bank's own words travel verbatim (lib/serialize.ts, bankAnswerText).
//
// The codes are protocol: the interface shows the sentences, never a code as
// the message, and names the codes once, small, as a reference for whoever has
// to call the bank ("Rückmeldung der Bank: 9210"). DESIGN.md: the protocol
// stays out of the interface.
//
// Two readings share one parser here:
// - Orders (transfer, approval): whether an answer is a *refusal* is the
//   money-safety question. An order the bank refused moved no money and may
//   simply be corrected and sent again; an order whose fate is unclear must
//   never be presented that way, because a user told it failed sends it again.
//   So only an answer that refuses the order and says nothing else counts —
//   everything doubtful stays "Status unklar" (isDefiniteRefusal,
//   refusalReference, bankAnswerLines). A refusal, once definite, is told the
//   way a login error is (formatBankAnswer), so one answer reads the same on
//   every screen; an unclear outcome keeps every line the bank sent.
// - Login and reads: the bank's errors lead, notes that ride along on every
//   reply are left out, warnings about tries and locks stay, and a lock is told
//   by the bank's own words (formatBankAnswer, isCredentialAnswer).
//
// Also the home of the app's own sentence for a bank that does not answer
// (lib/bank-fetch.ts produces it on the server): a screen recognises it here
// and adds the next step that fits where it is.
//
// The bank's words are never translated. The app's own sentences come from
// lib/i18n/messages/provider.ts, and are recognised in either language.
//
// Pure, depending on nothing but the texts — for the client, the route
// handlers and `node --test`.

import { LOCALES, MESSAGES, msgs } from './i18n/index.ts';

// ---------------------------------------------------------------------------
// Reading the wire string
// ---------------------------------------------------------------------------

/** One "code: text" item of the wire string, or one line of a bank's multi-line answer. */
const ITEM_SPLIT = /\s+\|\s+|\r?\n/;
/** "9210: …", "20: …" or "0020 …" at the start of an item. */
const LEADING_CODE = /^\s*(?:(\d{1,4}):|(\d{4})(?=\s))\s*/;

type Part = {
  /** The return code (0020 → 20), or null for text that carries none. */
  code: number | null;
  /** The bank's sentence after the code, trimmed; may be empty. */
  text: string;
};

/**
 * The items of a bank's answer, in order. An item with a code but no sentence
 * is kept (its code still counts); an empty item without a code is dropped.
 */
function parts(text: string | null | undefined): Part[] {
  const out: Part[] = [];
  for (const item of String(text ?? '').split(ITEM_SPLIT)) {
    const m = LEADING_CODE.exec(item);
    const n = m ? Number(m[1] ?? m[2]) : NaN;
    const code = Number.isInteger(n) ? n : null;
    const sentence = (m ? item.slice(m[0].length) : item).trim();
    if (code === null && !sentence) continue;
    out.push({ code, text: sentence });
  }
  return out;
}

/** A return code as the bank writes it, four digits: 20 → "0020". */
const fourDigits = (code: number) => String(code).padStart(4, '0');

const isError = (code: number | null): code is number => code !== null && code >= 9000 && code <= 9999;
const isWarning = (code: number | null): code is number => code !== null && code >= 3000 && code <= 3999;

/**
 * The bank's answer as lines of its own words: the numeric return codes are
 * protocol and stay out of the interface; the text after them is kept exactly
 * as the bank wrote it. Repeated sentences appear once.
 */
export function bankAnswerLines(text: string | null | undefined): string[] {
  return [...new Set(parts(text).map((p) => p.text).filter(Boolean))];
}

/** The return codes in a bank's answer string, in order, each once. */
export function bankAnswerCodes(text: string | null | undefined): number[] {
  const codes: number[] = [];
  for (const p of parts(text)) if (p.code !== null && !codes.includes(p.code)) codes.push(p.code);
  return codes;
}

// ---------------------------------------------------------------------------
// Orders: refused, or unclear
// ---------------------------------------------------------------------------

/**
 * 9xxx codes about the message or the dialog as a whole rather than the order:
 * 9050 "Die Nachricht enthält Fehler", 9800 "Dialog abgebrochen" (and 9000,
 * which lib-fints treats as the dialog's end). On their own they say that the
 * exchange broke off — not what became of the order inside it.
 */
const ABOUT_THE_DIALOG = new Set([9000, 9050, 9800]);

/**
 * The success codes that say nothing about an order having been carried out:
 * 0010 "Nachricht entgegengenommen" and 0100 "Dialog beendet". Any other 0xxx
 * code beside an error (0020 "Auftrag ausgeführt", above all) leaves open
 * whether the order went through.
 */
const SAYS_NOTHING_ABOUT_THE_ORDER = new Set([10, 100]);

/**
 * Whether a bank's answer is a definite refusal of the order: at least one
 * error code that concerns the order itself, and no success code that might
 * mean it was executed after all. A dialog abort alone, or an error next to
 * "Auftrag ausgeführt", is not one — the order may have gone through.
 */
export function isDefiniteRefusal(codes: Iterable<number>): boolean {
  let refused = false;
  for (const code of codes) {
    if (!Number.isInteger(code) || code < 0) continue;
    if (code < 1000 && !SAYS_NOTHING_ABOUT_THE_ORDER.has(code)) return false;
    if (isError(code) && !ABOUT_THE_DIALOG.has(code)) refused = true;
  }
  return refused;
}

/**
 * The codes a refusal is referred to by, four digits each ("9210"): its errors
 * about the order, without the dialog's own. Empty when there are none.
 */
export function refusalReference(text: string | null | undefined): string {
  return bankAnswerCodes(text)
    .filter((c) => isError(c) && !ABOUT_THE_DIALOG.has(c))
    .map(fourDigits)
    .join(', ');
}

// ---------------------------------------------------------------------------
// The bank not answering
// ---------------------------------------------------------------------------

// The sentences themselves are msgs().provider.bank (lib/i18n/messages/
// provider.ts): `unavailable` — the bank did not answer usefully (an HTTP
// error page, a reply that is no FinTS message, or no first byte within the
// time limit); `unreachable` — it could not be reached at all (no connection,
// name not resolved). Each says what happened and nothing about what to do —
// that depends on the screen. `tryAgainLater` is the next step a login or a
// read adds to either; never an order once it has gone out — that outcome
// stays "Status unklar".

/**
 * @deprecated The German sentence, for code that compares — a screen shows
 * msgs().provider.bank.unavailable, in the language on screen.
 */
export const BANK_UNAVAILABLE = MESSAGES.de.provider.bank.unavailable;

/** @deprecated The German sentence, for code that compares — a screen shows msgs().provider.bank.unreachable. */
export const BANK_UNREACHABLE = MESSAGES.de.provider.bank.unreachable;

/** @deprecated The German sentence — a screen shows msgs().provider.bank.tryAgainLater (t.provider.bank.tryAgainLater). */
export const TRY_AGAIN_LATER = MESSAGES.de.provider.bank.tryAgainLater;

/**
 * Whether a message is one of the two "the bank is not answering" sentences —
 * in either language: the server wrote it in the language of the request,
 * which the page may have changed since.
 */
export function isBankOutage(message: string | null | undefined): boolean {
  const m = String(message ?? '');
  return LOCALES.some((l) => {
    const bank = MESSAGES[l].provider.bank;
    return m.startsWith(bank.unavailable) || m.startsWith(bank.unreachable);
  });
}

// ---------------------------------------------------------------------------
// Login and reads: the answer a person reads
// ---------------------------------------------------------------------------

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

// The bank's own words, as German banks write them — data, never translated.
// i18n-data-start
/**
 * A warning (3xxx) that still matters next to an error: how many tries are
 * left, or that the access is (about to be) locked.
 */
const LOCK_WARNING = /sperr|fehlversuch|fehleingabe|versuch/i;

const LOCK_WORDS = /gesperrt|zugangssperre|pin-?sperre/i;
/** A lock announced, not happened: "… wird nach drei Fehlversuchen gesperrt". */
const LOCK_NOT_YET = /\b(?:wird|werden|würde|würden|droht|drohen|sonst|bevor)\b/i;
const LOCK_NEGATED = /nicht\s+(?:mehr\s+)?gesperrt|entsperrt/i;
// i18n-data-end

function isLockLine(line: string): boolean {
  return LOCK_WORDS.test(line) && !LOCK_NOT_YET.test(line) && !LOCK_NEGATED.test(line);
}

export function formatBankAnswer(message: string | null | undefined): BankAnswer {
  const all = parts(message);
  if (!all.length) return { lines: [], codes: [], locked: false };

  // When the bank reports an error (9xxx), the errors are the answer; its
  // notes and warnings ride along on every reply and would bury it. Kept are
  // the warnings about tries and locks: "noch 1 Versuch" next to "PIN falsch"
  // is the one thing the user must not miss. The dialog's own errors (9000,
  // 9050 "Die Nachricht enthält Fehler", 9800 "Dialog abgebrochen") follow any
  // real error and add nothing, so they show only when nothing else was said.
  const errors = all.filter((p) => isError(p.code));
  const meaningful = errors.filter((p) => !ABOUT_THE_DIALOG.has(p.code as number));
  const lockWarnings = all.filter((p) => isWarning(p.code) && LOCK_WARNING.test(p.text));
  const shown = errors.length ? [...(meaningful.length ? meaningful : errors), ...lockWarnings] : all;

  const lines: string[] = [];
  for (const p of shown) if (p.text && !lines.includes(p.text)) lines.push(p.text);
  const codes = [...new Set(shown.flatMap((p) => (p.code === null ? [] : [fourDigits(p.code)])))];
  if (!lines.length) lines.push(msgs().provider.bank.noReason);

  return { lines, codes, locked: lines.some(isLockLine) };
}

// The bank turned the credentials themselves down — as opposed to being out
// of reach, or refusing the app's product registration (9078). Banks word
// this differently and do not all send the same code, so the codes most of
// them use (9931, 9942) are backed up by the words their texts share, and by
// the server's own "Prüfe Anmeldename und PIN" fallback (in English it names
// the PIN too).
const CREDENTIAL_CODES = [9931, 9942];
const PRODUCT_NOT_REGISTERED = 9078;
const CREDENTIAL_WORDS = /\bPIN\b|Anmeldename|Kennung|Legitimation|Zugangsdaten|Benutzer|Passwort/i; // i18n-data
/** A bank that says it cannot be reached is no refusal of the credentials. */
const NOT_REACHABLE = /nicht erreichbar/i; // i18n-data

export function isCredentialAnswer(message: string | null | undefined): boolean {
  if (isBankOutage(message)) return false;
  const codes = new Set(parts(message).map((p) => p.code));
  if (CREDENTIAL_CODES.some((c) => codes.has(c))) return true;
  if (codes.has(PRODUCT_NOT_REGISTERED)) return false;
  return formatBankAnswer(message).lines.some((l) => CREDENTIAL_WORDS.test(l)) && !NOT_REACHABLE.test(String(message));
}
