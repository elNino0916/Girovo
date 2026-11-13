// Girovo Next, Girovo AI: the "Verstanden als" chips under an answer
// (components/insights/ask/ReadingChips.tsx). Each chip says one part of how
// Girovo read the question (the money's way, the topic, the period, what a
// ranking orders by) and opens a menu that changes that part. What the chips
// say and what a change makes of the reading are worked out here, pure, so
// the tests run them on the desktop.

import { ASKABLE, periodDays, type AskDir, type AskPeriod, type AskQuery, type AskRank } from './nano-ask.ts';
import { categoryDef, categoryLabel, type CategoryId } from './categories.ts';
import { fmtMonth, fmtRange } from './format.ts';
import { msgs } from './i18n/index.ts';

/** Which part of the reading a chip stands for. */
export type ChipSlot = 'dir' | 'topic' | 'period' | 'against' | 'rankBy' | 'metric' | 'per';

export type ReadingChip = { slot: ChipSlot; label: string };

/** The user's own categories, as the thread knows them. */
export type OwnCategories = readonly { id: string; name: string }[];

/** A label as a menu item says it: its first letter capitalised ("Diesen Monat" for the chip's "diesen Monat"). */
export const sentenceCase = (s: string): string => (s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s);

/** A category's name: the user's own as they typed it, else the app's. */
export function categoryName(id: CategoryId, own: OwnCategories = []): string {
  return own.find((c) => c.id === id)?.name ?? categoryLabel(id);
}

/**
 * A period in a chip: the relative ones as the user would say them ("diesen
 * Monat", "dieses Jahr"), a month by its name, a year by its number.
 * `concrete` names the relative ones by month and year too ("gegenüber
 * Oktober 2026" reads where "gegenüber letzten Monat" would not).
 */
export function periodLabel(p: AskPeriod, today: string, concrete = false): string {
  const words = msgs().ask;
  const days = periodDays(p, today);
  switch (p.kind) {
    case 'all': return words.chips.period.all;
    case 'today': return words.period.today;
    case 'days': return words.period.days(p.days);
    case 'months': return words.period.months(p.months);
    case 'since': return words.period.since(fmtMonth(p.month));
    case 'range': return days ? fmtRange(days.from, days.to) : words.chips.period.all;
    case 'month': return fmtMonth(p.month);
    case 'year': return String(p.year);
    case 'thisMonth':
    case 'lastMonth':
      return concrete && days ? fmtMonth(days.from.slice(0, 7)) : words.chips.period[p.kind];
    case 'thisYear':
    case 'lastYear':
      return concrete && days ? days.from.slice(0, 4) : words.chips.period[p.kind];
  }
}

/** Whether two periods cover the same days ("letzten Monat" and "Oktober 2026" in November 2026). */
export function samePeriod(a: AskPeriod, b: AskPeriod, today: string): boolean {
  const x = periodDays(a, today);
  const y = periodDays(b, today);
  if (!x || !y) return !x && !y;
  return x.from === y.from && x.to === y.to;
}

/** What the topic chip says: the name looked for, the category, or "alle Kategorien". */
export function topicLabel(q: AskQuery, own: OwnCategories = []): string {
  if (q.search) return q.search;
  if (q.category) return categoryName(q.category, own);
  return msgs().ask.chips.allCategories;
}

/**
 * The chips for one reading, in the order they are drawn. A ranking of the
 * categories with no topic has no topic chip: what it ranks is the topic.
 */
export function readingChips(q: AskQuery, today: string, own: OwnCategories = []): ReadingChip[] {
  const words = msgs().ask;
  const out: ReadingChip[] = [{ slot: 'dir', label: words.dir[q.dir] }];
  const rank = q.kind === 'rank' ? q.rank : undefined;
  if (!(rank?.by === 'category' && !q.category && !q.search)) out.push({ slot: 'topic', label: topicLabel(q, own) });
  out.push({ slot: 'period', label: periodLabel(q.period, today) });
  if (q.kind === 'compare' && q.against) out.push({ slot: 'against', label: words.versus(periodLabel(q.against, today, true)) });
  if (q.kind === 'average') out.push({ slot: 'per', label: words.chips.per[q.per ?? 'month'] });
  if (rank) {
    out.push({ slot: 'rankBy', label: words.chips.rankBy[rank.by] });
    out.push({ slot: 'metric', label: words.chips.metric[rank.metric] });
  }
  return out;
}

/**
 * The periods the period menu offers: this and last month, this and last
 * year, everything, then each month of the loaded bookings, newest first
 * (this and last month only once, as the first two). A period the question
 * named that is none of these ("letzte 3 Monate", "seit März") leads the
 * list, so the menu shows what is set.
 */
export function periodChoices(current: AskPeriod, loaded: { from: string; to: string }, today: string): AskPeriod[] {
  const quick: AskPeriod[] = [{ kind: 'thisMonth' }, { kind: 'lastMonth' }, { kind: 'thisYear' }, { kind: 'lastYear' }, { kind: 'all' }];
  const months: AskPeriod[] = [];
  const first = loaded.from.slice(0, 7);
  let [y, m] = loaded.to.slice(0, 7).split('-').map(Number);
  for (let guard = 0; guard < 240; guard++) {
    const month = `${y}-${String(m).padStart(2, '0')}`;
    if (month < first) break;
    const p: AskPeriod = { kind: 'month', month };
    if (!quick.slice(0, 2).some((q) => samePeriod(q, p, today))) months.push(p);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  const all = [...quick, ...months];
  return all.some((p) => samePeriod(p, current, today)) ? all : [current, ...all];
}

/** The categories the topic menu offers: those a question can mean, then the user's own. */
export function topicChoices(own: OwnCategories = []): CategoryId[] {
  return [...ASKABLE, ...own.map((c) => c.id as CategoryId)];
}

/**
 * Which ways of money a reading can be switched to. "Beides" only where one
 * figure still means something: a sum, a count, the largest or the latest
 * booking, a list (an average, a ranking or a comparison of both ways adds them up).
 */
export function dirChoices(q: AskQuery): AskDir[] {
  return q.kind === 'sum' || q.kind === 'count' || q.kind === 'largest' || q.kind === 'last' || q.kind === 'list' ? ['out', 'in', 'all'] : ['out', 'in'];
}

/**
 * A new topic: a category (null: none, "alle Kategorien"), the name looked
 * for gone either way. A category that only goes one way turns the money's
 * way with it (Einkommen is money in), and a ranking of the categories
 * within one category ranks the places instead.
 */
export function withTopic(q: AskQuery, category: CategoryId | null): AskQuery {
  const next: AskQuery = { ...q, category, search: null, hint: null };
  if (!category) return next;
  const way = categoryDef(category).direction;
  if (way === 'in' && q.dir === 'out') next.dir = 'in';
  if (way === 'out' && q.dir === 'in') next.dir = 'out';
  if (q.kind === 'rank' && q.rank?.by === 'category') next.rank = { ...q.rank, by: 'payee' };
  return next;
}

/**
 * Whether two readings are the same, field by field (key order and fields left
 * undefined aside): a chip set to the value it already shows changes nothing.
 */
export function sameQuery(a: AskQuery, b: AskQuery): boolean {
  return same(a, b);
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = (o: object) => Object.keys(o).filter((k) => (o as Record<string, unknown>)[k] !== undefined);
  const ka = keys(a);
  const kb = keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export function withDir(q: AskQuery, dir: AskDir): AskQuery {
  return { ...q, dir };
}

export function withPeriod(q: AskQuery, period: AskPeriod): AskQuery {
  return { ...q, period };
}

export function withAgainst(q: AskQuery, against: AskPeriod): AskQuery {
  return { ...q, against };
}

/** An average per month or per year. Per month is the default and leaves the field out, as a question read so has it. */
export function withPer(q: AskQuery, per: 'month' | 'year'): AskQuery {
  const next: AskQuery = { ...q, per };
  if (per === 'month') delete next.per;
  return next;
}

/** A ranking ordered another way. Ranked by category, a category it was narrowed to goes: it would rank one row. */
export function withRank(q: AskQuery, patch: Partial<AskRank>): AskQuery {
  const rank: AskRank = { by: 'payee', metric: 'sum', ...q.rank, ...patch };
  return rank.by === 'category' && q.category ? { ...q, rank, category: null, hint: null } : { ...q, rank };
}
