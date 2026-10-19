// The user's own categories, and bookings split across several categories.
//
// Own categories ("Spenden", "Handwerker", "Hund") sit beside the app's fixed
// set (lib/categories.ts). They are the user's words, shown as typed in either
// language, and they take a booking only by the user's hand — a pick, a rule,
// a split. The keywords and the on-device model never guess one: they know
// nothing of what the user meant by "Hund".
//
// A split is one booking filed under several categories at once: the
// supermarket receipt that is half groceries and half a present, the
// Sammelbuchung of rent and electricity. It is kept in the vault under the
// booking's txKey, as whole cents per category, and counted wherever a sum is
// made — the Analyse, the Monatsbudgets, the Monatsbilanz, the CSV — as if the
// booking were that many smaller ones. A split must add up to the booking to
// the cent; one that no longer does (the bank re-issued the booking with
// another amount) is ignored, and the booking goes back to its category.
//
// Sanitised the same way on both sides (lib/vault.ts on the way in and out,
// FintsProvider's normalizeVault), so what the user sees is what comes back
// after the next login.
//
// Pure and node-test-safe: no path aliases, `.ts` on sibling imports.

import type { CategoryId, CategoryPart, CustomCategory, CustomCategoryId } from './categories';
import { CUSTOM_ID, isBuiltinCategoryId } from './categories.ts';

export const CUSTOM_LIMITS = {
  /** Own categories per login. */
  count: 50,
  /** A name, in characters — about what a menu row shows without cutting it. */
  name: 40,
};

export const SPLIT_LIMITS = {
  /** Split bookings per login. */
  count: 2000,
  /** Shares in one split. */
  parts: 10,
  /** txKey() length — the vault's limit for every map key. */
  key: 200,
  /** The largest share: 99.999.999,99 €, beyond any booking a person makes. */
  cents: 9_999_999_999,
};

/** One share of a split booking as the vault keeps it: a category and whole cents, always positive. */
export type SplitPart = { id: CategoryId; cents: number };

// C0/C1 controls and the line/paragraph separators, as lib/vault.ts.
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const HAS_CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A category name as it may be kept: one line, trimmed, at most CUSTOM_LIMITS.name characters. '' for nothing. */
export function cleanCategoryName(v: unknown): string {
  if (typeof v !== 'string') return '';
  const s = v.replace(CONTROLS, ' ').replace(/\s+/g, ' ').trim();
  const chars = Array.from(s);
  return chars.length > CUSTOM_LIMITS.name ? chars.slice(0, CUSTOM_LIMITS.name).join('').trimEnd() : s;
}

/** Folded for comparing names: "Spenden" and " spenden " are one category. */
export const nameKey = (name: string): string => cleanCategoryName(name).toLocaleLowerCase('de');

/**
 * The user's own categories as this version understands them: valid ids,
 * a name, a direction; the first of two with the same id or the same name
 * wins; at most CUSTOM_LIMITS.count, the oldest kept (a new one is refused
 * on screen before it would push one out).
 */
export function sanitizeCustomCategories(v: unknown): CustomCategory[] {
  const out: CustomCategory[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const raw of Array.isArray(v) ? v : []) {
    if (out.length >= CUSTOM_LIMITS.count) break;
    if (!isRecord(raw)) continue;
    const id = raw.id;
    if (typeof id !== 'string' || !CUSTOM_ID.test(id) || ids.has(id)) continue;
    const name = cleanCategoryName(raw.name);
    if (!name || names.has(nameKey(name))) continue;
    if (raw.direction !== 'in' && raw.direction !== 'out') continue;
    ids.add(id);
    names.add(nameKey(name));
    out.push({ id: id as CustomCategoryId, name, direction: raw.direction });
  }
  return out;
}

/** Whether `v` names a category of the app's or one of `customs`. */
export function categoryValidator(customs: readonly CustomCategory[]): (v: unknown) => v is CategoryId {
  const own = new Set<string>(customs.map((c) => c.id));
  return (v: unknown): v is CategoryId => isBuiltinCategoryId(v) || (typeof v === 'string' && own.has(v));
}

const centsOk = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= SPLIT_LIMITS.cents;

/**
 * One split as it may be kept: two to SPLIT_LIMITS.parts shares, each a known
 * category and whole cents above zero; two shares of one category become one.
 * Null for anything less — a split of one share is no split.
 */
export function sanitizeSplit(v: unknown, known: (v: unknown) => v is CategoryId): SplitPart[] | null {
  if (!Array.isArray(v)) return null;
  const by = new Map<CategoryId, number>();
  for (const raw of v.slice(0, SPLIT_LIMITS.parts)) {
    if (!isRecord(raw) || !known(raw.id) || !centsOk(raw.cents)) continue;
    by.set(raw.id, (by.get(raw.id) ?? 0) + raw.cents);
  }
  if (by.size < 2) return null;
  return [...by].map(([id, cents]) => ({ id, cents }));
}

const keyOk = (k: string) => k.length > 0 && k.length <= SPLIT_LIMITS.key && k !== '__proto__' && !HAS_CONTROL.test(k);

/** Every split as it may be kept, keyed by txKey; over the cap the newest (last) survive. */
export function sanitizeSplits(v: unknown, known: (v: unknown) => v is CategoryId): Record<string, SplitPart[]> {
  const entries: [string, SplitPart[]][] = [];
  if (isRecord(v)) {
    for (const [k, raw] of Object.entries(v)) {
      if (!keyOk(k)) continue;
      const split = sanitizeSplit(raw, known);
      if (split) entries.push([k, split]);
    }
  }
  const out: Record<string, SplitPart[]> = {};
  for (const [k, split] of entries.slice(-SPLIT_LIMITS.count)) out[k] = split;
  return out;
}

/**
 * A booking's split as signed shares, largest first — or null when there is
 * none, or it no longer adds up to `amount` to the cent (the bank re-issued
 * the booking with another figure: the split was for a different booking).
 */
export function splitParts(split: readonly SplitPart[] | null | undefined, amount: number): CategoryPart[] | null {
  if (!split || split.length < 2) return null;
  const total = Math.round(Math.abs(Number(amount)) * 100);
  if (!total || split.reduce((s, p) => s + p.cents, 0) !== total) return null;
  const sign = Number(amount) < 0 ? -1 : 1;
  return [...split]
    .sort((a, b) => b.cents - a.cents)
    .map((p) => ({ id: p.id, amount: (sign * p.cents) / 100 }));
}

/**
 * What the split dialog leaves for the first share: the booking's cents less
 * every other share's. Negative when the others already take more.
 */
export function remainderCents(amount: number, others: readonly number[]): number {
  return Math.round(Math.abs(Number(amount)) * 100) - others.reduce((s, c) => s + c, 0);
}

/** A fresh id for an own category: `c_` and twelve random letters and digits. */
export function newCustomId(random: () => number = Math.random): CustomCategoryId {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 12; i++) id += alphabet[Math.floor(random() * alphabet.length)];
  return `c_${id}`;
}

/**
 * The vault's category maps without `id`: rules and single-booking choices
 * that named it go back to the automatic guess, a budget for it goes, and a
 * split that used it is undone as a whole (its shares no longer add up).
 */
export function withoutCategory<T extends {
  categoryRules: Record<string, CategoryId>;
  txCategories: Record<string, CategoryId>;
  budgets: Partial<Record<CategoryId, number>>;
  splits?: Record<string, SplitPart[]>;
}>(v: T, id: CategoryId): T {
  const keep = <V>(rec: Record<string, V>, drop: (val: V) => boolean) => {
    let changed = false;
    const out: Record<string, V> = {};
    for (const [k, val] of Object.entries(rec)) {
      if (drop(val)) changed = true;
      else out[k] = val;
    }
    return changed ? out : rec;
  };
  const budgets = { ...v.budgets };
  const hadBudget = Object.prototype.hasOwnProperty.call(budgets, id);
  delete budgets[id];
  return {
    ...v,
    categoryRules: keep(v.categoryRules, (c) => c === id),
    txCategories: keep(v.txCategories, (c) => c === id),
    budgets: hadBudget ? budgets : v.budgets,
    ...(v.splits ? { splits: keep(v.splits, (parts) => parts.some((p) => p.id === id)) } : {}),
  };
}
