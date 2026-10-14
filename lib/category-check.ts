// The Kategorie-Check: how the automatic categories are doing with this
// user's own bookings. Worked out on this machine from the bookings already
// loaded, shown in the Umsatzanalyse, and never sent anywhere — not as a
// count, not as a log line, not as telemetry.
//
// For every booking it compares two answers: what the app says on its own
// (lib/categorize.ts explainGuess — the app's rules, that is the user's own
// accounts, the booking codes and the keyword table, or else the on-device
// model) and what the booking is filed under now (the provider's categoryOf,
// which puts the user's choice for one booking and their rule for a
// counterparty first). From that:
//
//   filed     the app found a category on its own (by its rules, or by the model)
//   kept      … and the user left it — or chose the very same one
//   changed   … and the user filed it elsewhere, for this booking or by a rule
//   byYou     the app found nothing, and the user filed it
//   open      the app found nothing, and nobody has filed it yet: still
//             "Sonstiges" or "Sonstige Eingänge"
//
// The lists group by counterparty, the way a correction is usually made.
//
// Pure and node-test-safe.

import type { CategoryId, CategoryResult } from './categories';
import type { CategoryGuess } from './categorize';
import type { SerializedTransaction } from './fints-types';
import { counterpartyKey, txKey } from './categories.ts';
import { dayKey } from './format.ts';

/** How the app filed a booking on its own: its rules (own accounts, booking codes, keywords) or the model. */
export type CheckSource = 'rules' | 'model';

export type ChangeGroup = {
  key: string;
  /** The newest booking of the group — its name and avatar stand for all. */
  tx: SerializedTransaction;
  count: number;
  /** What the app chose on its own. */
  from: CategoryId;
  /** What the user chose. */
  to: CategoryId;
  /** How: a choice for single bookings, a rule for the counterparty, or both. */
  by: 'manual' | 'rule' | 'mixed';
  source: CheckSource;
};

export type OpenGroup = {
  /** counterpartyKey(), or `tx:` and the booking's txKey() where there is no counterparty to name. */
  key: string;
  /** Newest first. */
  txs: SerializedTransaction[];
  /** Whether one rule can file them all: the counterparty can carry one. */
  ruleable: boolean;
};

export type CategoryCheck = {
  /** The bookings looked at. */
  total: number;
  /** Filed by the app on its own, and how many of those the user filed elsewhere — per source. */
  auto: Record<CheckSource, { filed: number; changed: number }>;
  /** Filed by the app and left that way. */
  kept: number;
  /** Not filed by the app; filed by the user. */
  byYou: number;
  /** Not filed by anyone yet. */
  open: number;
  /** Most bookings first, then the newest. */
  changes: ChangeGroup[];
  /** Most bookings first, then the newest. */
  uncategorised: OpenGroup[];
};

const dayOf = (tx: SerializedTransaction) => dayKey(tx.entryDate || tx.valueDate);
const latestFirst = (a: string, b: string) => (a === b ? 0 : a < b ? 1 : -1);

/**
 * The check over `txs` (booked Umsätze — the caller decides which).
 * `categoryOf` is what a booking is filed under now, `guessOf` what the app
 * says on its own; the two must be built from the same own accounts, logos
 * and model guesses, or a booking nobody touched would count as changed.
 */
export function categoryCheck(
  txs: readonly SerializedTransaction[],
  { categoryOf, guessOf }: {
    categoryOf: (tx: SerializedTransaction) => CategoryResult;
    guessOf: (tx: SerializedTransaction) => CategoryGuess;
  },
): CategoryCheck {
  const auto: CategoryCheck['auto'] = { rules: { filed: 0, changed: 0 }, model: { filed: 0, changed: 0 } };
  let kept = 0;
  let byYou = 0;
  let open = 0;
  const changes = new Map<string, ChangeGroup>();
  const openGroups = new Map<string, OpenGroup>();
  // The newest Buchungstag per group, for the order.
  const newest = new Map<string, string>();

  for (const tx of txs) {
    const now = categoryOf(tx);
    const guess = guessOf(tx);
    const decided = now.source !== 'auto';
    const day = dayOf(tx);

    if (guess.basis === 'none') {
      if (decided) {
        byYou++;
        continue;
      }
      open++;
      const who = counterpartyKey(tx);
      const ruleable = who !== 'name:?';
      const key = ruleable ? who : `tx:${txKey(tx)}`;
      const g = openGroups.get(key);
      if (g) g.txs.push(tx);
      else openGroups.set(key, { key, txs: [tx], ruleable });
      if (day > (newest.get(key) ?? '')) newest.set(key, day);
      continue;
    }

    const source: CheckSource = guess.basis === 'model' ? 'model' : 'rules';
    auto[source].filed++;
    if (!decided || now.id === guess.id) {
      kept++;
      continue;
    }
    auto[source].changed++;
    const by = now.source === 'rule' ? 'rule' : 'manual';
    const key = `${counterpartyKey(tx)}|${guess.id}|${now.id}|${source}`;
    const g = changes.get(key);
    if (!g) changes.set(key, { key, tx, count: 1, from: guess.id, to: now.id, by, source });
    else {
      g.count++;
      if (g.by !== by) g.by = 'mixed';
      if (day > (newest.get(key) ?? '')) g.tx = tx;
    }
    if (day > (newest.get(key) ?? '')) newest.set(key, day);
  }

  const order = <G extends { key: string }>(size: (g: G) => number) => (a: G, b: G) =>
    size(b) - size(a) || latestFirst(newest.get(a.key) ?? '', newest.get(b.key) ?? '');

  return {
    total: txs.length,
    auto,
    kept,
    byYou,
    open,
    changes: [...changes.values()].sort(order((g) => g.count)),
    uncategorised: [...openGroups.values()]
      .sort(order((g) => g.txs.length))
      .map((g) => ({ ...g, txs: [...g.txs].sort((a, b) => latestFirst(dayOf(a), dayOf(b))) })),
  };
}
