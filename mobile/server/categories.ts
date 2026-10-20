// The category guess on the phone: Gemini Nano through Android AICore
// (NanoPlugin.java) instead of the desktop's e5 (lib/category-model.ts).
// scripts/build-mobile.mjs puts this module where the route
// (app/api/category-guesses/route.ts) imports lib/category-model, so the
// route stays the desktop's, unchanged.
//
// Per counterparty, in order:
//  1. one the user filed under a nearly identical name takes that category
//     (lib/nano-categories.ts exampleFor) — Nano never sees the examples;
//  2. an answer Nano gave before for the same name and purpose is used again;
//  3. the rest goes to Nano, one prompt per distinct name and purpose.
//
// Answers are kept for as long as the app runs. FintsProvider asks every
// counterparty again after each rule change — cheap for e5, which keeps its
// vectors, and a minute or more for Nano. Kept in memory only, like e5's
// vectors: nothing about a booking is written down here.

import { GUESSABLE, type GuessExample, type GuessItem, type GuessableCategory } from '../../lib/category-guess.ts';
import {
  NANO_CATEGORY_LIST, NANO_PROMPT_VERSION, NANO_SYSTEM, exampleFor, nanoBookingText, parseNanoAnswer,
} from '../../lib/nano-categories.ts';
import { GirovoNano, type NanoStatus } from '../native';

export { GUESSABLE, type GuessExample, type GuessItem, type GuessableCategory };

let status: NanoStatus | null = null;

/** Nano's answers by prompt; oldest first out past the limit (a Map keeps insertion order). */
const answers = new Map<string, GuessableCategory | null>();
const MAX_ANSWERS = 5000;

/** Asks the plugin whether Nano is here; null where there is no plugin (a desktop browser). */
export async function refreshNano(): Promise<NanoStatus | null> {
  try {
    status = await GirovoNano.status();
  } catch {
    status = null;
  }
  return status;
}

/**
 * At start: whether this phone has Nano, and — where AICore offers it as a
 * download — the request that AICore fetch it. AICore keeps the model for
 * every app and picks the moment (it may wait for Wi-Fi or charging).
 */
export async function startNano(): Promise<void> {
  const now = await refreshNano();
  if (now?.state === 'downloadable') {
    void GirovoNano.download().then(refreshNano, () => {});
  }
}

/** Whether a guess can be made now. The route answers "unavailable" otherwise. */
export function modelAvailable(): boolean {
  return status?.state === 'available';
}

const promptKey = (name: string, purpose: string) => `${NANO_PROMPT_VERSION}\u0000${name}\u0000${purpose}`;

function remember(key: string, category: GuessableCategory | null): void {
  answers.delete(key);
  answers.set(key, category);
  for (const old of answers.keys()) {
    if (answers.size <= MAX_ANSWERS) break;
    answers.delete(old);
  }
}

/** Each item's category guess, or null where none is clear. As lib/category-model.ts's, on Nano. */
export async function guessCategories(
  items: GuessItem[],
  examples: GuessExample[] = [],
): Promise<Record<string, GuessableCategory | null>> {
  const out: Record<string, GuessableCategory | null> = {};
  // Distinct prompts still to ask, with the counterparties waiting on each.
  const pending = new Map<string, { name: string; purpose: string; keys: string[] }>();
  for (const it of items) {
    const name = it.name.trim();
    const purpose = String(it.purpose ?? '').trim();
    const example = exampleFor(name, examples);
    if (example) {
      out[it.key] = example.category;
      continue;
    }
    const key = promptKey(name, purpose);
    if (answers.has(key)) {
      out[it.key] = answers.get(key)!;
      continue;
    }
    const waiting = pending.get(key);
    if (waiting) waiting.keys.push(it.key);
    else pending.set(key, { name, purpose, keys: [it.key] });
  }
  if (!pending.size) return out;

  const asked = [...pending.entries()];
  if (!modelAvailable()) {
    for (const [, p] of asked) for (const k of p.keys) out[k] = null;
    return out;
  }
  const { answers: got } = await GirovoNano.classify({
    system: NANO_SYSTEM,
    prefix: NANO_CATEGORY_LIST,
    items: asked.map(([, p], i) => ({ id: String(i), text: nanoBookingText(p.name, p.purpose) })),
  });
  asked.forEach(([key, p], i) => {
    const raw = got[String(i)];
    const category = raw == null ? null : parseNanoAnswer(raw);
    // A booking AICore finally refused is asked again next time, not remembered as "none".
    if (raw != null) remember(key, category);
    for (const k of p.keys) out[k] = category;
  });
  return out;
}
