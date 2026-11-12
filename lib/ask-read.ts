// Girovo AI: what a message asks, in one place for the app
// (components/insights/AskThread.tsx AskReader) and for the question set's
// score (scripts/eval-fragen). The model's part (Gemma's or Gemini Nano's
// reading, or Gemma's plan) is asked by the caller and handed in; everything
// here is pure, so the score measures exactly what the app does.
//
// Order: Verträge & Abos, a setting or a change (lib/ask-intents.ts); small
// talk; a plan from Gemma that passed its checks (lib/ask-planner.ts); else
// the rules over the model's reading (lib/nano-ask.ts readQuestion), completed
// from the question before it (lib/ask-followup.ts).
//
// Pure: no path aliases, `.ts` on sibling imports.

import { aboutBookings, continuesFrom, followUp, ordersSomething, saysItContinues } from './ask-followup.ts';
import { intentOf, type AskIntent } from './ask-intents.ts';
import { readQuestion, type AskQuery, type NanoReading } from './nano-ask.ts';

export type ReadResult =
  | { intent: AskIntent }
  | { offTopic: true }
  | { query: AskQuery; by: 'plan' | 'rules' }
  | { notUnderstood: true };

export type ReadInput = {
  today: string;
  /** The user's own categories. */
  own: readonly { id: string; name: string }[];
  /** The model's reading of the question (Gemini Nano's, Gemma's, the built-in model's), or none. */
  reading: NanoReading | null;
  /** Gemma's plan, already checked against the bookings (lib/ask-planner.ts checkPlan); null when there is none. */
  plan?: AskQuery | null;
  /** The live contracts' names (Verträge & Abos): "Was kostet mich Netflix im Jahr?" is a contract's year only for one of them. */
  contracts?: readonly string[];
};

/** What a message asks, given what the question before it was read as. */
export function readAsked(question: string, prev: AskQuery | null, input: ReadInput): ReadResult {
  const { today, own, reading } = input;
  const intent = intentOf(question, input.contracts);
  if (intent) return { intent };
  // An order ("Und überweise 500 Euro an Lea") is never read as a question, follow-up or not.
  if (ordersSomething(question)) return { offTopic: true };
  const rules = readQuestion(question, null, today, own);
  if (input.plan) return { query: input.plan, by: 'plan' };
  // A message that goes on from the question before is never small talk: "Und sie mir?" keeps its topic.
  const continues = !!prev && continuesFrom(question);
  if (!continues && !aboutBookings(question, rules, reading)) return { offTopic: true };
  // "Und sie mir?": nothing the rules can read, but it says it goes on, so the question before stands.
  const read = readQuestion(question, reading, today, own) ?? (prev && saysItContinues(question) ? prev : null);
  if (!read) return { notUnderstood: true };
  return { query: followUp(prev, question, read, today), by: 'rules' };
}
