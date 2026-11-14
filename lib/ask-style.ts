// Girovo Next: how Girovo AI answers (Einstellungen → Girovo AI → Antworten,
// docs/plan-girovo-ai-style-and-name.md).
//
//   Ton      friendly (the default, the sentences Girovo always had) or plain:
//            the same facts said as short lines ("Im Oktober: 312,40 € an Rewe.")
//   Länge    short (the default): one sentence, the figure first; long: the
//            count of bookings, last month's figure and the largest booking too
//   Anrede   the first name Girovo AI may call you by: the one you typed, else
//            the account holder's from the bank (components/shell/session.ts
//            firstName), unless switched off. Said sparingly: at the start of a
//            conversation's first answer, in the empty conversation and in
//            "Girovo AI ist bereit", never twice, never where the name is also
//            in what the answer is about (a payee "Lea Schmidt" for a user Lea).
//
// Ton only changes the wording; every figure stays the app's own. Länge
// changes what an answer holds (answerDetails). Everything here stays on the
// device: the name is only ever given to the model on it.
//
// Pure: no path aliases, `.ts` on sibling imports.

import type { SerializedTransaction } from './fints-types';
import { monthBefore } from './ask-followup.ts';
import type { TxFilter } from './app-types';
import type { AskAnswer, AskQuery } from './nano-ask';

import { cleanAskName, isAskLength, isAskTone, type AskLength, type AskTone } from './ask-style-fields.ts';

export { cleanAskName, isAskLength, isAskTone, NAME_MAX, type AskLength, type AskTone } from './ask-style-fields.ts';

export type AskStyle = {
  tone: AskTone;
  length: AskLength;
  /** The first name to call the user by, or null: switched off, or none known. */
  name: string | null;
};

export const DEFAULT_TONE: AskTone = 'friendly';
export const DEFAULT_LENGTH: AskLength = 'short';

/** The saved choices, as the vault holds them (each only while it is not the default). */
export type AskStyleFields = {
  askTone?: AskTone;
  askLength?: AskLength;
  askName?: string;
  askNameOff?: true;
};

/** The style to answer in: the saved choices with the defaults filled in, and the name resolved. */
export function askStyle(v: AskStyleFields | null | undefined, suggested: string): AskStyle {
  const tone = isAskTone(v?.askTone) ? v.askTone : DEFAULT_TONE;
  const length = isAskLength(v?.askLength) ? v.askLength : DEFAULT_LENGTH;
  const name = v?.askNameOff ? null : cleanAskName(v?.askName) ?? cleanAskName(suggested) ?? null;
  return { tone, length, name };
}

/** Folded for comparing names: case and accents aside. */
const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('de');

/**
 * Whether the name may be said beside `about` (the words of what the answer is
 * about: the question, the payee, the facts): not when any word of the name
 * stands there as a whole word, so "Lea, von Lea Schmidt hast du …" never happens.
 */
export function nameFits(name: string, about: string): boolean {
  const text = fold(about);
  return !fold(name).split(/[ '’-]+/).filter(Boolean).some((w) => new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(text));
}

/**
 * A sentence's parts with the name in front ("Nino, im Oktober hast du …"):
 * the first part's first letter made small, as it now follows a comma. Parts
 * that do not open with plain words are left as they are.
 */
export function addressed<T>(parts: readonly (string | T)[], name: string | null): (string | T)[] {
  if (!name || typeof parts[0] !== 'string' || !parts[0]) return [...parts];
  const first = parts[0];
  // "Du"/"Dein" after a comma stays as it is said; any other first word loses its capital.
  return [`${name}, ${first.charAt(0).toLocaleLowerCase('de')}${first.slice(1)}`, ...parts.slice(1)];
}

/** What a long answer says besides its figure: last month's figure, and the largest booking among those counted. */
export type AnswerDetails = {
  before?: { month: string; cents: number; filter: TxFilter };
  top?: SerializedTransaction;
};

/**
 * The details of a long answer (Länge: Ausführlich), for a sum over one way
 * (money out, or in) that found bookings: the month before when the question
 * named a whole month that is over (a running month against a whole one would
 * always say "less"), with that month wholly loaded; the largest booking when
 * there are at least two. Worked out by `compute` exactly as the answer was.
 */
export function answerDetails(a: AskAnswer, compute: (q: AskQuery) => AskAnswer, today: string): AnswerDetails | null {
  const q = a.query;
  if (q.kind !== 'sum' || q.dir === 'all' || a.outside || a.count === 0) return null;
  const out: AnswerDetails = {};
  if (q.period.kind === 'month' || q.period.kind === 'lastMonth') {
    const month = monthBefore(q.period, today);
    if (month) {
      const b = compute({ ...q, period: { kind: 'month', month } });
      if (!b.outside && !b.partial && b.count > 0) out.before = { month, cents: b.cents, filter: b.filter };
    }
  }
  if (a.count >= 2) {
    const largest = compute({ ...q, kind: 'largest' });
    if (largest.tx) out.top = largest.tx;
  }
  return out.before || out.top ? out : null;
}
