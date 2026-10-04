// What a bank's answer to an order says, read the one way the whole app reads it.
//
// FinTS answers with numbered return codes, each with a sentence: 0xxx for
// success, 3xxx for notes and warnings, 9xxx for errors. The wire between the
// route handlers and the client carries them as one string,
// "9050: Die Nachricht enthält Fehler. | 9210: Empfänger-IBAN gesperrt.",
// so the bank's own words travel verbatim (lib/serialize.ts, bankAnswerText).
//
// The codes are protocol: the interface shows the sentences, never a code as
// the message. The one exception is a refusal, which names its code once, small,
// as a reference for a call to the bank ("Rückmeldung der Bank: 9210").
//
// Whether an answer is a *refusal* is the money-safety question. An order the
// bank refused moved no money and may simply be corrected and sent again; an
// order whose fate is unclear must never be presented that way, because a user
// told it failed sends it again. So only an answer that refuses the order and
// says nothing else counts — everything doubtful stays "Status unklar".
//
// Pure and dependency-free, for the client, the route handlers and `node --test`.

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
    if (code >= 9000 && code <= 9999 && !ABOUT_THE_DIALOG.has(code)) refused = true;
  }
  return refused;
}

/** One "code: text" item of the wire string, or one line of a bank's multi-line answer. */
const ITEM_SPLIT = /\s+\|\s+|\r?\n/;
/** "9210: …", "20: …" or "0020 …" at the start of an item. */
const LEADING_CODE = /^\s*(?:(\d{1,4}):|(\d{4})(?=\s))\s*/;

/**
 * The bank's answer as lines of its own words: the numeric return codes are
 * protocol and stay out of the interface; the text after them is kept exactly
 * as the bank wrote it. Repeated sentences appear once.
 */
export function bankAnswerLines(text: string | null | undefined): string[] {
  const lines = String(text ?? '')
    .split(ITEM_SPLIT)
    .map((l) => l.replace(LEADING_CODE, '').trim())
    .filter(Boolean);
  return [...new Set(lines)];
}

/** The return codes in a bank's answer string, in order, each once. */
export function bankAnswerCodes(text: string | null | undefined): number[] {
  const codes: number[] = [];
  for (const item of String(text ?? '').split(ITEM_SPLIT)) {
    const m = LEADING_CODE.exec(item);
    const code = m ? Number(m[1] ?? m[2]) : NaN;
    if (Number.isInteger(code) && !codes.includes(code)) codes.push(code);
  }
  return codes;
}

/**
 * The codes a refusal is referred to by, four digits each ("9210"): its errors
 * about the order, without the dialog's own. Empty when there are none.
 */
export function refusalReference(text: string | null | undefined): string {
  return bankAnswerCodes(text)
    .filter((c) => c >= 9000 && c <= 9999 && !ABOUT_THE_DIALOG.has(c))
    .map((c) => String(c).padStart(4, '0'))
    .join(', ');
}
