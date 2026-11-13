// Girovo AI on the desktop, "Namen mit Girovo AI aufräumen": which names a
// booking's counterparty is cleaned under, and the cleaned names kept in the
// vault (aiNames). The prompt and its check are lib/ai-names.ts; asking the
// model is components/insights/ai/useAiNames.ts; the lists read the names
// through components/transactions/model.ts txText, the path Android's Gemini
// Nano brands take.
//
// One name per counterparty as the bank writes it. A payment service (PayPal,
// Klarna) is the exception: every purchase through it carries the service's
// name, so the shop its purpose names (lib/analytics.ts facilitatorShop) is
// part of the key, and the only purpose the model sees. Any other name is
// asked without a purpose: the answer is kept for every booking with that
// name, so it must not hang on one booking's text.
//
// Kept in the vault, which is sealed with the PIN, on this device only: the
// field never syncs (lib/sync-entries.ts), so the phone keeps its own names.
// Capped (AI_NAMES_LIMITS): only names the loaded bookings no longer need
// go, the oldest first; the cap gives way to the ones they need.
//
// Pure: no path aliases, `.ts` on sibling imports.

import type { SerializedTransaction } from './fints-types';
import { facilitatorShop } from './analytics.ts';
import { counterpartyName } from './categories.ts';
import { repairBankText } from './format.ts';
import { isRecord } from './guards.ts';

/** The cleaned names: by aiNameKey, '' where the model gave nothing usable (asked again only with a new prompt version). */
export type AiNamesCache = { version: number; names: Record<string, string> };

export const AI_NAMES_LIMITS = {
  /** Names kept: a year of an ordinary account has a few hundred counterparties. */
  entries: 500,
  /** Names kept at most, while the loaded bookings need more than `entries` (a long kept history). */
  stored: 2000,
  /** A key's characters: the SEPA name (70), a separator and the shop from the purpose. */
  key: 120,
  shop: 40,
  /** As parseCleanAnswer allows. */
  name: 48,
};

/** Between the name and the shop in a payment service's key; a name never holds it. */
const SHOP_MARK = ' \u00bb ';

/** What the model is asked for one booking: the bank's name, the shop behind a payment service, and the key both are kept under. */
export type AiNameSource = { key: string; name: string; shop: string | null };

const tidy = (s: string) => repairBankText(s).replace(/\s+/g, ' ').trim();

/** The booking's counterparty as the model is asked about it, or null when the bank names none. */
export function aiNameSource(
  tx: Pick<SerializedTransaction, 'purpose' | 'remoteName'> & { ultimateName?: string },
): AiNameSource | null {
  const name = tidy(counterpartyName(tx));
  if (!name) return null;
  const rawShop = facilitatorShop(tx);
  const shop = rawShop ? tidy(rawShop).slice(0, AI_NAMES_LIMITS.shop).trim() || null : null;
  const key = (shop ? `${name}${SHOP_MARK}${shop}` : name).slice(0, AI_NAMES_LIMITS.key);
  return { key, name, shop };
}

/** The key a booking's cleaned name is kept under ('' when it has no counterparty). */
export function aiNameKey(tx: Pick<SerializedTransaction, 'purpose' | 'remoteName'> & { ultimateName?: string }): string {
  return aiNameSource(tx)?.key ?? '';
}

/** The names to show, for this prompt version: only real ones, nothing for a cache of another version. */
export function aiNamesMap(cache: AiNamesCache | undefined, version: number): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  if (!cache || cache.version !== version) return out;
  for (const [k, v] of Object.entries(cache.names)) if (v) out.set(k, v);
  return out;
}

/** Each counterparty of `txs` once that the cache (of this version) has not answered yet, and not in `skip`. */
export function namesToClean(
  txs: Iterable<SerializedTransaction>,
  cache: AiNamesCache | undefined,
  version: number,
  skip: ReadonlySet<string> = new Set(),
): AiNameSource[] {
  const known = cache && cache.version === version ? cache.names : {};
  const seen = new Set<string>();
  const out: AiNameSource[] = [];
  for (const tx of txs) {
    const src = aiNameSource(tx);
    if (!src || seen.has(src.key)) continue;
    seen.add(src.key);
    if (Object.hasOwn(known, src.key) || skip.has(src.key)) continue;
    out.push(src);
  }
  return out;
}

/**
 * The cache with `found` added, under `version` (a cache of another version
 * starts empty). Over the cap, only names the loaded bookings no longer need
 * go, the oldest first: a name in `keep` (the loaded bookings' keys) stays,
 * and the cap gives way to as many as they need, up to AI_NAMES_LIMITS.stored.
 * Dropping one the lists still show would have it asked again at every start.
 */
export function withCleanedNames(
  cache: AiNamesCache | undefined,
  version: number,
  found: Iterable<readonly [string, string]>,
  keep: ReadonlySet<string> = new Set(),
): AiNamesCache {
  const names: Record<string, string> = cache && cache.version === version ? { ...cache.names } : {};
  for (const [k, v] of found) {
    if (!k || k.length > AI_NAMES_LIMITS.key) continue;
    // Moved to the end: the newest answer is the last to go.
    delete names[k];
    names[k] = String(v ?? '').slice(0, AI_NAMES_LIMITS.name);
  }
  const keys = Object.keys(names);
  const kept = keys.reduce((n, k) => (keep.has(k) ? n + 1 : n), 0);
  const cap = Math.min(AI_NAMES_LIMITS.stored, Math.max(AI_NAMES_LIMITS.entries, kept));
  let over = keys.length - cap;
  for (const k of keys) {
    if (over <= 0) break;
    if (keep.has(k)) continue;
    delete names[k];
    over--;
  }
  // More loaded names than the vault holds at all: the oldest of them go.
  if (over > 0) for (const k of Object.keys(names).slice(0, over)) delete names[k];
  return { version, names };
}

const CONTROL = /[\u0000-\u001f\u007f]/;

/** The cache as the vault keeps it, or null when there is nothing (well formed) to keep. */
export function sanitizeAiNames(raw: unknown): AiNamesCache | null {
  if (!isRecord(raw) || typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 0) return null;
  if (!isRecord(raw.names)) return null;
  const entries: [string, string][] = [];
  for (const [k, v] of Object.entries(raw.names)) {
    if (!k || k.length > AI_NAMES_LIMITS.key || k === '__proto__' || CONTROL.test(k)) continue;
    if (typeof v !== 'string' || v.length > AI_NAMES_LIMITS.name || CONTROL.test(v)) continue;
    entries.push([k, v]);
  }
  if (!entries.length) return null;
  // Up to `stored`: withCleanedNames keeps more than `entries` while the loaded bookings need them.
  return { version: raw.version, names: Object.fromEntries(entries.slice(-AI_NAMES_LIMITS.stored)) };
}

/** Both caches as one (restoring a backup): this device's names win; another version's are dropped. */
export function mergeAiNames(current: AiNamesCache | undefined, other: AiNamesCache | undefined): AiNamesCache | null {
  if (!current) return other ? sanitizeAiNames(other) : null;
  if (!other || other.version !== current.version) return sanitizeAiNames(current);
  return sanitizeAiNames({ version: current.version, names: { ...other.names, ...current.names } });
}
