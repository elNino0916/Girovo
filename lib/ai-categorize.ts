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
import { counterpartyName, counterpartyRuleKeys, isCategoryId, txCreditorId } from './categories.ts';
import { isCardPurpose } from './card-purpose.ts';
import { bankDay } from './format.ts';
import { isBusinessBooking, looksLikePerson } from './merchant-match.ts';
import { NANO_CATEGORY_LIST, NANO_PROMPT_VERSION, NANO_SYSTEM, nanoBookingText, parseNanoAnswer } from './nano-categories.ts';
import { parsePurpose } from './sepa-purpose.ts';

/** One counterparty whose bookings a rule would reach are all outgoing and still in Sonstiges. */
export type AiGroup = {
  /** counterpartyKey(): what the rule is filed under. */
  key: string;
  /** The counterparty's name, as the lists show it (of the anchor). */
  name: string;
  /** The Verwendungszweck the prompt carries (of the anchor); empty for a card payment. */
  purpose: string;
  /** Every listed booking the rule moves, newest first: its own and those under another spelling of the name. */
  txs: SerializedTransaction[];
  /** The booking the rule is set on: the newest whose own key is `key`, so the rule lands under it. */
  anchor: SerializedTransaction;
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

const newestFirst = (a: SerializedTransaction, b: SerializedTransaction) =>
  (bankDay(a) === bankDay(b) ? 0 : bankDay(a) < bankDay(b) ? 1 : -1);

/**
 * The counterparties to ask about, most bookings first, then the newest.
 *
 * Übernehmen sets a rule for the counterparty (setCategory with `rule`), and
 * a rule files every booking it reaches: both directions, Vorgemerkte too,
 * and the name in its other spelling ("BAECKEREI MUELLER" beside "Bäckerei
 * Müller"). So the review must hold all of them, or it would move bookings
 * nobody saw. A counterparty is asked about only when every booking the rule
 * reaches is an outgoing one nobody filed and the app left in Sonstiges; one
 * with money coming in, a booking the user filed (the rule would lift that
 * choice) or one the app put in another category is left out. So is one that
 * cannot carry a rule (no IBAN, creditor ID or name).
 *
 * `txs` are the listed bookings, which the review counts; `alsoLoaded` are
 * further loaded ones the rule reaches but no list shows (Vorgemerkte the
 * bank has booked since): they are checked, not counted. Each booking counts
 * once, however many lists hold it.
 */
export function aiGroups(
  txs: readonly SerializedTransaction[],
  categoryOf: CategoryOf,
  alsoLoaded: readonly SerializedTransaction[] = [],
): AiGroup[] {
  const listed = new Set(txs);
  // Every loaded booking under each key a rule could reach it by.
  const reachedBy = new Map<string, SerializedTransaction[]>();
  const ownKey = new Map<SerializedTransaction, string>();
  for (const tx of new Set([...txs, ...alsoLoaded])) {
    const keys = counterpartyRuleKeys(tx);
    ownKey.set(tx, keys[0]);
    for (const k of keys) {
      const list = reachedBy.get(k);
      if (list) list.push(tx);
      else reachedBy.set(k, [tx]);
    }
  }
  const candidates: AiGroup[] = [];
  const looked = new Set<string>();
  for (const tx of listed) {
    const key = ownKey.get(tx)!;
    if (key === 'name:?' || looked.has(key) || !qualifies(tx, categoryOf)) continue;
    looked.add(key);
    const reached = reachedBy.get(key) ?? [];
    if (!reached.every((t) => qualifies(t, categoryOf))) continue;
    const moved = reached.filter((t) => listed.has(t)).sort(newestFirst);
    const anchor = moved.find((t) => ownKey.get(t) === key)!;
    const name = counterpartyName(anchor).trim();
    if (!name) continue;
    // A card payment or a direct debit is always a business's.
    const business = moved.some((t) => isBusinessBooking(t) || !!txCreditorId(t));
    candidates.push({ key, name, purpose: promptPurpose(anchor), txs: moved, anchor, person: looksLikePerson(name, business) });
  }
  candidates.sort((a, b) => b.txs.length - a.txs.length || newestFirst(a.txs[0], b.txs[0]));
  // Two spellings of one name reach each other's bookings: the first rule
  // takes them all, a second one would move them again and count them twice.
  const claimed = new Set<SerializedTransaction>();
  const out: AiGroup[] = [];
  for (const g of candidates) {
    if (g.txs.some((t) => claimed.has(t))) continue;
    for (const t of g.txs) claimed.add(t);
    out.push(g);
  }
  return out;
}

// i18n-data-start — the desktop model's additions to the phone's list (lib/nano-categories.ts stays Nano's, as calibrated)
/**
 * The phone's category list with two boundaries Gemma got wrong in the demo:
 * a sports club is Freizeit, a town's Kita or waste fee is Steuern & Abgaben.
 */
export const AI_CATEGORY_LIST = NANO_CATEGORY_LIST
  .replace('Fitnessstudio, Sport;', 'Fitnessstudio, Sport, Sportverein und Vereinsbeitrag;')
  .replace('Gebühren, Bußgeld;', 'Gebühren wie Kita-, Schul- oder Müllgebühren der Stadt, Bußgeld;')
  + 'Empfänger: SV Grün-Weiß 1921 e.V. · Verwendungszweck: Mitgliedsbeitrag → leisure\n'
  + 'Empfänger: Gemeinde Talheim · Verwendungszweck: Kita-Gebühr Oktober → taxes\n';
// i18n-data-end

/** Raised with every change to AI_CATEGORY_LIST: answers remembered under another version are asked again. */
export const AI_CATEGORY_VERSION = `${NANO_PROMPT_VERSION}.g1`;

/** The key an answer is remembered under: the same prompt gets the same answer. */
export function answerKey(group: Pick<AiGroup, 'name' | 'purpose'>): string {
  return `${AI_CATEGORY_VERSION}\u0000${group.name}\u0000${group.purpose}`;
}

/** The prompt for one counterparty, as scripts/eval-gemma-bookings.mjs measures it. */
export function aiPrompt(group: Pick<AiGroup, 'name' | 'purpose'>): { system: string; user: string; maxTokens: number } {
  return { system: NANO_SYSTEM, user: AI_CATEGORY_LIST + nanoBookingText(group.name, group.purpose), maxTokens: 8 };
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
    out.push({ tx: g.anchor, category: p.category, count: g.txs.length });
  }
  return out;
}
