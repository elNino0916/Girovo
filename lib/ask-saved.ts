// Girovo AI's conversations as the vault keeps them (VaultData.askConversations).
//
// Only what is needed to show a conversation again: each question as typed,
// how it was read (an AskQuery, or an intent for what is no sum of bookings),
// Gemma's sentences where it wrote some, and the day it was asked. Never a
// booking or a figure from one: the answers are worked out from the bookings
// loaded when the conversation is shown (components/insights/AskThread.tsx),
// and a question about one booking keeps only that booking's key.
//
// Everything is sanitised on the way in, wherever it comes from (an older or
// newer version, a backup): unknown kinds go, strings are clipped, and the
// list is capped by count and by size so the vault never grows without bound.
//
// Pure: no path aliases, `.ts` on sibling imports.

import { isBuiltinCategoryId, type CategoryId } from './categories.ts';
import { isRecord } from './guards.ts';
import type { AskIntent } from './ask-intents';
import type { AskPeriod, AskQuery } from './nano-ask';

export const ASK_SAVED_LIMITS = {
  /** The newest conversations kept. */
  conversations: 30,
  /** The newest turns of each. */
  turns: 20,
  /** All of them together, as JSON characters: the oldest go first beyond it. */
  bytes: 48 * 1024,
  question: 200,
  title: 120,
  written: 600,
  search: 80,
  name: 80,
  purpose: 140,
  key: 200,
} as const;

/** A finished turn's state; one still being read is never kept. */
export type SavedState = 'answered' | 'failed' | 'notUnderstood' | 'offTopic';

export type SavedTurn = {
  /** As typed; empty only for Girovo's own opening, the month recap. */
  question: string;
  state: SavedState;
  /** The yyyy-mm-dd it was asked on: "letzten Monat" stays the month it meant. */
  day: string;
  query?: AskQuery;
  intent?: AskIntent;
  /** The month recap's month (yyyy-mm), for the opening "Weiter fragen" carries in. */
  recap?: string;
  /** Gemma's sentences, or false: the template said it. Only with `writtenFor`. */
  written?: string | false;
  /** A hash of the figures the sentences were written for (answerHash). */
  writtenFor?: string;
  outcome?: 'done' | 'cancelled' | 'already';
  edited?: true;
  explain?: true;
  /** The booking it was asked about, by its key (lib/categories.ts txKey); never the booking. */
  bookingKey?: string;
};

export type SavedConversation = {
  /** Stable across logins and devices, unlike the session's numbers. */
  id: string;
  title: string;
  /** ISO, when it was started: the newest are kept. */
  at: string;
  turns: SavedTurn[];
};

/** Intents that ask before they change something: kept only once answered, never as a question still open. */
const ASKS_FIRST = new Set(['set', 'refresh', 'fileUnder', 'createGoal', 'budget', 'remindContract', 'prepareTransfer']);

const STATES = new Set<string>(['answered', 'failed', 'notUnderstood', 'offTopic']);
const OUTCOMES = new Set<string>(['done', 'cancelled', 'already']);
const KINDS = new Set<string>(['sum', 'count', 'largest', 'last', 'average', 'rank', 'compare', 'list']);
const DIRS = new Set<string>(['out', 'in', 'all']);
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const ID = /^[A-Za-z0-9-]{1,40}$/;
const HASH = /^[0-9a-z]{1,16}$/;

type IsCategory = (v: unknown) => v is CategoryId;

/** One line, clipped by character (never between an emoji's halves); '' for anything else. */
function line(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  const flat = raw.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  return [...flat].slice(0, max).join('').trim();
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isDay = (v: unknown): v is string => typeof v === 'string' && DAY.test(v);
/** A name in an intent: null, or one clipped line (an empty one reads as null). */
const nameOrNull = (v: unknown, max: number = ASK_SAVED_LIMITS.name): string | null | undefined =>
  v === null ? null : typeof v === 'string' ? line(v, max) || null : undefined;
const centsOrNull = (v: unknown): number | null | undefined =>
  v === null ? null : isInt(v, 1, 100_000_000_00) ? v : undefined;

export function sanitizePeriod(raw: unknown): AskPeriod | null {
  if (!isRecord(raw)) return null;
  switch (raw.kind) {
    case 'all': case 'today': case 'thisMonth': case 'lastMonth': case 'thisYear': case 'lastYear':
      return { kind: raw.kind };
    case 'month': case 'since':
      return typeof raw.month === 'string' && MONTH.test(raw.month) ? { kind: raw.kind, month: raw.month } : null;
    case 'year':
      return isInt(raw.year, 1900, 2200) ? { kind: 'year', year: raw.year } : null;
    case 'days':
      return isInt(raw.days, 1, 3660) ? { kind: 'days', days: raw.days } : null;
    case 'months':
      return isInt(raw.months, 1, 240) ? { kind: 'months', months: raw.months } : null;
    case 'range':
      return isDay(raw.from) && isDay(raw.to) && raw.from <= raw.to ? { kind: 'range', from: raw.from, to: raw.to } : null;
    default:
      return null;
  }
}

/** A question as it was read, or null when any part of it is not one this version knows. */
export function sanitizeQuery(raw: unknown, isCategory: IsCategory): AskQuery | null {
  if (!isRecord(raw) || !KINDS.has(raw.kind as string) || !DIRS.has(raw.dir as string)) return null;
  if (raw.category !== null && !isCategory(raw.category)) return null;
  if (raw.search !== null && typeof raw.search !== 'string') return null;
  const period = sanitizePeriod(raw.period);
  if (!period) return null;
  const q: AskQuery = {
    kind: raw.kind as AskQuery['kind'],
    dir: raw.dir as AskQuery['dir'],
    category: raw.category as CategoryId | null,
    search: raw.search === null ? null : line(raw.search, ASK_SAVED_LIMITS.search) || null,
    period,
  };
  if (raw.hint === null || isCategory(raw.hint)) q.hint = raw.hint as CategoryId | null;
  if (q.kind === 'rank') {
    const r = raw.rank;
    if (!isRecord(r) || (r.by !== 'category' && r.by !== 'payee') || (r.metric !== 'sum' && r.metric !== 'count')) return null;
    q.rank = { by: r.by, metric: r.metric };
  }
  if (raw.against !== undefined) {
    const against = sanitizePeriod(raw.against);
    if (!against) return null;
    q.against = against;
  }
  if (raw.per === 'month' || raw.per === 'year') q.per = raw.per;
  return q;
}

/** What a turn asked for that is no sum of bookings, or null when it is not one this version knows. */
export function sanitizeIntent(raw: unknown, isCategory: IsCategory): AskIntent | null {
  if (!isRecord(raw)) return null;
  const L = ASK_SAVED_LIMITS;
  switch (raw.kind) {
    case 'contracts': case 'refresh': case 'balance': case 'monthEnd': case 'priceRises': case 'salary': case 'budgetsOver':
      return { kind: raw.kind };
    case 'read':
      return ['theme', 'privacy', 'language', 'idle', 'all'].includes(raw.setting as string)
        ? { kind: 'read', setting: raw.setting as Extract<AskIntent, { kind: 'read' }>['setting'] } : null;
    case 'set':
      if (raw.setting === 'theme' && (raw.value === 'light' || raw.value === 'dark' || raw.value === 'system')) return { kind: 'set', setting: 'theme', value: raw.value };
      if (raw.setting === 'privacy' && typeof raw.value === 'boolean') return { kind: 'set', setting: 'privacy', value: raw.value };
      if (raw.setting === 'language' && (raw.value === 'de' || raw.value === 'en')) return { kind: 'set', setting: 'language', value: raw.value };
      return null;
    case 'balanceAt':
      return isDay(raw.day) ? { kind: 'balanceAt', day: raw.day } : null;
    case 'contractCost': case 'owed': case 'goal': {
      const name = nameOrNull(raw.name);
      return name === undefined ? null : { kind: raw.kind, name };
    }
    case 'budgetLeft': {
      const name = nameOrNull(raw.name);
      if (name === undefined || (raw.category !== null && !isBuiltinCategoryId(raw.category))) return null;
      return { kind: 'budgetLeft', category: raw.category, name };
    }
    case 'afford': {
      const cents = centsOrNull(raw.cents);
      const month = raw.month === null ? null : typeof raw.month === 'string' && MONTH.test(raw.month) ? raw.month : undefined;
      if (cents === undefined || month === undefined) return null;
      return { kind: 'afford', cents, month };
    }
    case 'cancelBy':
      return raw.until === null || isDay(raw.until) ? { kind: 'cancelBy', until: raw.until } : null;
    case 'renewal': {
      const name = line(raw.name, L.name);
      return name ? { kind: 'renewal', name } : null;
    }
    case 'fileUnder': {
      const name = nameOrNull(raw.name);
      if (name === undefined || (raw.category !== null && !isCategory(raw.category))) return null;
      return { kind: 'fileUnder', name, category: raw.category as CategoryId | null };
    }
    case 'createGoal': {
      const name = nameOrNull(raw.name);
      const cents = centsOrNull(raw.cents);
      const by = raw.by === null ? null : typeof raw.by === 'string' && (MONTH.test(raw.by) || DAY.test(raw.by)) ? raw.by : undefined;
      if (name === undefined || cents === undefined || by === undefined) return null;
      return { kind: 'createGoal', name, cents, by };
    }
    case 'budget': {
      const cents = centsOrNull(raw.cents);
      if (cents === undefined || (raw.category !== null && !isCategory(raw.category))) return null;
      return {
        kind: 'budget', category: raw.category as CategoryId | null, cents,
        ...(raw.remove === true ? { remove: true as const } : {}),
        ...(raw.step === 1 || raw.step === -1 ? { step: raw.step } : {}),
      };
    }
    case 'remindContract': {
      const name = nameOrNull(raw.name);
      const by = raw.by === null ? null : isDay(raw.by) ? raw.by : undefined;
      const lead = raw.lead === null ? null : isInt(raw.lead, 0, 366) ? raw.lead : undefined;
      if (name === undefined || by === undefined || lead === undefined) return null;
      return { kind: 'remindContract', name, by, lead };
    }
    case 'prepareTransfer': {
      const name = nameOrNull(raw.name);
      const cents = centsOrNull(raw.cents);
      const purpose = nameOrNull(raw.purpose, L.purpose);
      if (name === undefined || cents === undefined || purpose === undefined) return null;
      return { kind: 'prepareTransfer', name, cents, purpose };
    }
    default:
      return null;
  }
}

/** One turn as it may be kept, or null: a state, kind or reading this version does not know, or nothing to show. */
export function sanitizeTurn(raw: unknown, isCategory: IsCategory): SavedTurn | null {
  if (!isRecord(raw) || !STATES.has(raw.state as string) || !isDay(raw.day)) return null;
  const recap = typeof raw.recap === 'string' && MONTH.test(raw.recap) ? raw.recap : undefined;
  const question = recap ? '' : line(raw.question, ASK_SAVED_LIMITS.question);
  if (!question && !recap) return null;
  const turn: SavedTurn = { question, state: raw.state as SavedState, day: raw.day };
  if (recap) turn.recap = recap;
  if (raw.query !== undefined) {
    const query = sanitizeQuery(raw.query, isCategory);
    if (!query) return null;
    turn.query = query;
  }
  if (raw.intent !== undefined) {
    const intent = sanitizeIntent(raw.intent, isCategory);
    if (!intent) return null;
    turn.intent = intent;
  }
  if (OUTCOMES.has(raw.outcome as string)) turn.outcome = raw.outcome as SavedTurn['outcome'];
  if (raw.edited === true) turn.edited = true;
  if (raw.explain === true) turn.explain = true;
  const bookingKey = typeof raw.bookingKey === 'string' && raw.bookingKey.length <= ASK_SAVED_LIMITS.key && !/[\u0000-\u001f\u007f]/.test(raw.bookingKey)
    ? raw.bookingKey : '';
  if (bookingKey) turn.bookingKey = bookingKey;
  if (typeof raw.writtenFor === 'string' && HASH.test(raw.writtenFor)) {
    const written = raw.written === false ? false : line(raw.written, ASK_SAVED_LIMITS.written);
    if (written !== '') {
      turn.written = written;
      turn.writtenFor = raw.writtenFor;
    }
  }
  if (turn.state === 'answered') {
    // An answer needs something to answer from.
    if (!turn.query && !turn.intent && !turn.explain && !turn.recap) return null;
    // A change still waiting for its yes is no answer to show again.
    if (turn.intent && ASKS_FIRST.has(turn.intent.kind) && !turn.outcome) return null;
  }
  return turn;
}

/** One conversation as it may be kept (its newest turns), or null. */
export function sanitizeConversation(raw: unknown, isCategory: IsCategory): SavedConversation | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !ID.test(raw.id)) return null;
  if (typeof raw.at !== 'string' || !Number.isFinite(Date.parse(raw.at))) return null;
  if (!Array.isArray(raw.turns)) return null;
  const turns = raw.turns.map((t) => sanitizeTurn(t, isCategory)).filter((t): t is SavedTurn => !!t).slice(-ASK_SAVED_LIMITS.turns);
  if (!turns.length) return null;
  const title = line(raw.title, ASK_SAVED_LIMITS.title) || turns.find((t) => t.question)?.question || '';
  if (!title) return null;
  return { id: raw.id, title, at: new Date(Date.parse(raw.at)).toISOString(), turns };
}

/**
 * The conversations as the vault keeps them: each well formed, each id once,
 * the newest first, at most ASK_SAVED_LIMITS.conversations of them and
 * ASK_SAVED_LIMITS.bytes together. Anything that is not a list is none.
 */
export function sanitizeAskConversations(raw: unknown, isCategory: IsCategory): SavedConversation[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const all: SavedConversation[] = [];
  for (const item of raw) {
    const c = sanitizeConversation(item, isCategory);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    all.push(c);
  }
  // Newest first; the same moment keeps the order it came in.
  all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const out: SavedConversation[] = [];
  let bytes = 2;
  for (const c of all.slice(0, ASK_SAVED_LIMITS.conversations)) {
    bytes += JSON.stringify(c).length + 1;
    if (bytes > ASK_SAVED_LIMITS.bytes) break;
    out.push(c);
  }
  return out;
}

/** A backup's conversations beside this device's: this device's where both have one; capped as ever. */
export function mergeAskConversations(
  current: readonly SavedConversation[] | undefined, other: readonly SavedConversation[] | undefined,
): SavedConversation[] {
  const here = new Set((current ?? []).map((c) => c.id));
  return [...(current ?? []), ...(other ?? []).filter((c) => !here.has(c.id))];
}

/**
 * A short hash of what an answer's figures are (AskThread.tsx answerKey):
 * Gemma's sentences are kept with it, and written again when it changes. A
 * hash, so the vault holds no figure beside the sentences themselves.
 */
export function answerHash(key: string): string {
  // FNV-1a, twice with different seeds: 64 bits are plenty to tell one set of figures from the next.
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 15);
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}
