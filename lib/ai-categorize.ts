// "Mit Girovo AI kategorisieren" (Girovo Next, desktop): Gemma reads the
// outgoing bookings still in "Sonstiges" with the phone's category prompt
// (lib/nano-categories.ts, as scripts/eval-gemma-bookings.mjs measured it),
// and the user checks every suggestion before anything changes. What is
// taken goes in as the user's own rule for the counterparty, the way a
// category picked "für alle" in a booking's details does.
//
// Here the pure part: which bookings qualify, how they group (one prompt per
// counterparty, as the e5 and Nano guesses are asked), the prompt, the review
// rows and the list Übernehmen applies.
//
// Pure and node-test-safe: no path aliases, `import type` for types, runtime
// imports of sibling modules with their .ts extension.

import type { CategoryId, CategoryResult } from './categories';
import type { SerializedTransaction } from './fints-types';
import type { GuessableCategory } from './category-guess';
import { counterpartyKey, counterpartyName, isCategoryId, txCreditorId } from './categories.ts';
import { isCardPurpose } from './card-purpose.ts';
import { bankDay } from './format.ts';
import { isBusinessBooking, looksLikePerson } from './merchant-match.ts';
import { NANO_CATEGORY_LIST, NANO_PROMPT_VERSION, NANO_SYSTEM, nanoBookingText, parseNanoAnswer } from './nano-categories.ts';
import { parsePurpose } from './sepa-purpose.ts';

/** One counterparty whose outgoing bookings are all still in Sonstiges. */
export type AiGroup = {
  /** counterpartyKey(): what the rule is filed under. */
  key: string;
  /** The counterparty's name, as the lists show it (of the newest booking). */
  name: string;
  /** The Verwendungszweck the prompt carries (of the newest booking); empty for a card payment. */
  purpose: string;
  /** Newest first. */
  txs: SerializedTransaction[];
  /** Reads as a private person: the review leaves it unchecked. */
  person: boolean;
};

type CategoryOf = (tx: SerializedTransaction) => CategoryResult;

/** An outgoing booking nobody filed and the app left in "Sonstiges". */
export function qualifies(tx: SerializedTransaction, categoryOf: CategoryOf): boolean {
  if (!(Number(tx.amount) < 0)) return false;
  const now = categoryOf(tx);
  return now.id === 'other' && now.source === 'auto' && !now.parts;
}

/** The Verwendungszweck as the guesses send it: a card system's record says nothing about what was bought. */
export function promptPurpose(tx: Pick<SerializedTransaction, 'purpose'>): string {
  return isCardPurpose(tx.purpose) ? '' : parsePurpose(tx.purpose).text.trim();
}

/**
 * The counterparties to ask about, most bookings first, then the newest. A
 * counterparty that cannot carry a rule (no IBAN, creditor ID or name) is
 * left out, and so is one the user already filed a booking of: a rule would
 * lift that choice. Each booking counts once, however many lists hold it.
 */
export function aiGroups(txs: readonly SerializedTransaction[], categoryOf: CategoryOf): AiGroup[] {
  const groups = new Map<string, AiGroup>();
  const touched = new Set<string>();
  const seen = new Set<SerializedTransaction>();
  for (const tx of txs) {
    if (seen.has(tx)) continue;
    seen.add(tx);
    const key = counterpartyKey(tx);
    if (key === 'name:?') continue;
    if (categoryOf(tx).source !== 'auto') {
      touched.add(key);
      continue;
    }
    if (!qualifies(tx, categoryOf)) continue;
    const g = groups.get(key);
    if (g) g.txs.push(tx);
    else groups.set(key, { key, name: '', purpose: '', txs: [tx], person: false });
  }
  const out: AiGroup[] = [];
  for (const g of groups.values()) {
    if (touched.has(g.key)) continue;
    g.txs.sort((a, b) => (bankDay(a) === bankDay(b) ? 0 : bankDay(a) < bankDay(b) ? 1 : -1));
    const newest = g.txs[0];
    g.name = counterpartyName(newest).trim();
    if (!g.name) continue;
    g.purpose = promptPurpose(newest);
    // A card payment or a direct debit is always a business's.
    const business = g.txs.some((tx) => isBusinessBooking(tx) || !!txCreditorId(tx));
    g.person = looksLikePerson(g.name, business);
    out.push(g);
  }
  return out.sort((a, b) => b.txs.length - a.txs.length
    || (bankDay(a.txs[0]) === bankDay(b.txs[0]) ? 0 : bankDay(a.txs[0]) < bankDay(b.txs[0]) ? 1 : -1));
}

/** The key an answer is remembered under: the same prompt gets the same answer. */
export function answerKey(group: Pick<AiGroup, 'name' | 'purpose'>): string {
  return `${NANO_PROMPT_VERSION}\u0000${group.name}\u0000${group.purpose}`;
}

/** The prompt for one counterparty, byte for byte the benchmark's. */
export function aiPrompt(group: Pick<AiGroup, 'name' | 'purpose'>): { system: string; user: string; maxTokens: number } {
  return { system: NANO_SYSTEM, user: NANO_CATEGORY_LIST + nanoBookingText(group.name, group.purpose), maxTokens: 8 };
}

/** Gemma's answer as a category, or null for NONE and anything unreadable. */
export const readAnswer = (raw: string | null | undefined): GuessableCategory | null => parseNanoAnswer(raw);

/** One row of the review: a counterparty with an answer. */
export type AiPick = { key: string; category: CategoryId; checked: boolean };

/**
 * The review's rows for the groups answered so far: NONE (null) and groups
 * not asked yet are not listed; a private person starts unchecked.
 */
export function initialPicks(
  groups: readonly AiGroup[],
  answers: ReadonlyMap<string, GuessableCategory | null>,
): AiPick[] {
  const out: AiPick[] = [];
  for (const g of groups) {
    const category = answers.get(answerKey(g));
    if (!category) continue;
    out.push({ key: g.key, category, checked: !g.person });
  }
  return out;
}

/** What Übernehmen files: per checked row, a booking to set the rule on, its category and how many bookings move. */
export type AiApply = { tx: SerializedTransaction; category: CategoryId; count: number };

/** The checked rows, as rules to set; one left on Sonstiges changes nothing and is skipped. */
export function applyList(groups: readonly AiGroup[], picks: readonly AiPick[]): AiApply[] {
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const out: AiApply[] = [];
  for (const p of picks) {
    if (!p.checked || !isCategoryId(p.category) || p.category === 'other') continue;
    const g = byKey.get(p.key);
    if (!g?.txs.length) continue;
    out.push({ tx: g.txs[0], category: p.category, count: g.txs.length });
  }
  return out;
}
