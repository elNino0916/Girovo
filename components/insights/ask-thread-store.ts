// Girovo Next, "Fragen": the conversations about the bookings (components/insights/AskThread.tsx).
//
// One module-level store, so any place can open the thread with a question
// (the search, Analyse's month recap, a booking's details) without the
// provider knowing about it. Finished conversations are kept in the vault
// (VaultData.askConversations, lib/ask-saved.ts), sealed with the PIN:
// components/insights/ask/useKeptConversations.ts brings them back after the
// login and writes each change. Only the questions and their readings are
// kept, never a booking or its figures.
//
// A turn is the user's question and Girovo's answer to it. The store only
// holds what was asked and how it was read (an AskQuery); the figures are
// worked out from the bookings in view each time the thread draws
// (lib/nano-ask.ts computeAnswer), so an answer follows a booking that
// arrives later. Reading a question (Gemini Nano, or the desktop's own model)
// happens in the thread's host, which has the provider; the store marks the
// turn 'reading' until then.

import { useSyncExternalStore } from 'react';
import { sameQuery } from '@/lib/ask-chips';
import { isExplainQuestion } from '@/lib/ask-explain';
import type { AskIntent } from '@/lib/ask-intents';
import { sanitizeAskConversations, type SavedConversation, type SavedTurn } from '@/lib/ask-saved';
import { txKey, type CategoryId } from '@/lib/categories';
import type { SerializedTransaction } from '@/lib/fints-types';
import { dayKey } from '@/lib/format';
import { pinQuery, type AskQuery } from '@/lib/nano-ask';

export type TurnState = 'reading' | 'answered' | 'failed' | 'notUnderstood' | 'offTopic';

/** Girovo's own opening, without a question: the month recap that "Weiter fragen" carries in. */
export type RecapSeed = { kind: 'recap'; month: string };

export type Turn = {
  id: number;
  /** What the user asked; empty for an opening Girovo wrote itself (a recap). */
  question: string;
  state: TurnState;
  query?: AskQuery;
  seed?: RecapSeed;
  /**
   * Gemma's sentences for the answer (lib/gemma-writer.ts), for the figures they
   * were written from (`writtenFor`); false when Gemma could not say it and the
   * template stands. Absent until asked.
   */
  written?: string | false;
  writtenFor?: string;
  /** Not a sum of bookings (lib/ask-intents.ts): Verträge & Abos, a setting read, or a change asked first. */
  intent?: AskIntent;
  /** A change's end: made, said no to, or already so. Absent while it waits for the user's answer. */
  outcome?: 'done' | 'cancelled' | 'already';
  /** Its reading changed by a chip (ask/ReadingChips.tsx): the template says it, Gemma's sentences were about the question as asked. */
  edited?: boolean;
  /**
   * The booking the question is about: asked from its details ("Frag zu diesem
   * Umsatz"), or a follow-up in a conversation that began there. Absent
   * everywhere else.
   */
  booking?: SerializedTransaction;
  /**
   * That booking by its key alone (lib/categories.ts txKey): a conversation
   * brought back from the vault, which never holds the booking. Looked up
   * among the bookings loaded now.
   */
  bookingKey?: string;
  /** "Was ist das für eine Zahlung?": that booking explained by the rules (lib/ask-explain.ts), no model asked. */
  explain?: true;
  /** The yyyy-mm-dd it was asked on, kept with it: shown again later, its periods stay the days they meant. */
  day?: string;
};

export type Conversation = {
  id: number;
  /** Its name in the vault, the same after every login (the session's `id` is not). */
  key: string;
  /** ISO, when it was started. */
  at: string;
  /** The first question, as the sidebar and Verläufe name it. */
  title: string;
  turns: Turn[];
};

type State = {
  open: boolean;
  current: number | null;
  conversations: Conversation[];
};

let state: State = { open: false, current: null, conversations: [] };
let nextId = 1;
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** The store as React reads it. */
export function useAskThread(): State {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export function currentConversation(s: State = state): Conversation | null {
  return s.conversations.find((c) => c.id === s.current) ?? null;
}

function withConversation(fn: (c: Conversation) => Conversation): void {
  const cur = currentConversation();
  if (!cur) return;
  set({ ...state, conversations: state.conversations.map((c) => (c.id === cur.id ? fn(c) : c)) });
}

/** A conversation's name in the vault: unique enough for one person's few dozen. */
function newKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function startConversation(title: string, turns: Turn[]): void {
  const c: Conversation = { id: nextId++, key: newKey(), at: new Date().toISOString(), title, turns };
  // Newest first, as Verläufe and the sidebar list them.
  set({ open: true, current: c.id, conversations: [c, ...state.conversations] });
}

function turnOf(question: string, booking?: SerializedTransaction, bookingKey?: string): Turn {
  const about = { day: dayKey(new Date()), ...(booking ? { booking } : bookingKey ? { bookingKey } : {}) };
  // Explained by the rules at once, with or without a booking (without one it asks to open one first).
  if (isExplainQuestion(question)) return { id: nextId++, question, state: 'answered', explain: true, ...about };
  return { id: nextId++, question, state: 'reading', ...about };
}

/**
 * Opens "Fragen". With a question it is asked: in the open conversation when
 * one is open and `fresh` is not set, else in a new one. Without one the last
 * conversation shows again (or an empty thread). `booking`: the booking it is
 * asked about; `title`: the new conversation's name, where the question is
 * not.
 */
export function openAsk({ question, fresh = false, booking, title }: {
  question?: string; fresh?: boolean; booking?: SerializedTransaction; title?: string;
} = {}): void {
  const q = question?.trim();
  if (!q) {
    set({ ...state, open: true });
    return;
  }
  if (!fresh && state.open && currentConversation()) {
    askInThread(q, booking);
    return;
  }
  startConversation(title || q, [turnOf(q, booking)]);
}

/** Opens a new conversation that starts with the month recap, as "Weiter fragen" does. */
export function openAskWithRecap(month: string, title: string): void {
  // Read as a question about that month's spending, so a follow-up ("Und Lebensmittel?") keeps the month.
  const query: AskQuery = { kind: 'sum', dir: 'out', category: null, search: null, period: { kind: 'month', month } };
  startConversation(title, [{ id: nextId++, question: '', state: 'answered', query, seed: { kind: 'recap', month }, day: dayKey(new Date()) }]);
}

/** A follow-up in the open conversation; it keeps the booking the conversation is about. */
export function askInThread(question: string, booking?: SerializedTransaction): void {
  const q = question.trim();
  if (!q) return;
  if (!currentConversation()) {
    startConversation(q, [turnOf(q, booking)]);
    return;
  }
  withConversation((c) => {
    // The booking the conversation is about: held, or by its key in one brought back from the vault.
    const about = booking ? null : [...c.turns].reverse().find((t) => t.booking || t.bookingKey);
    return { ...c, turns: [...c.turns, turnOf(q, booking ?? about?.booking, about?.bookingKey)] };
  });
}

/** The host's reading of a turn's question. */
export function settleTurn(id: number, result: { state: Exclude<TurnState, 'reading'>; query?: AskQuery; intent?: AskIntent }): void {
  set({
    ...state,
    conversations: state.conversations.map((c) => (c.turns.some((t) => t.id === id)
      ? { ...c, turns: c.turns.map((t) => (t.id === id ? { ...t, ...result } : t)) }
      : c)),
  });
}

/** Gemma's sentences for a turn's answer, or false: the template says it. */
export function settleWritten(id: number, written: string | false, writtenFor: string): void {
  set({
    ...state,
    conversations: state.conversations.map((c) => (c.turns.some((t) => t.id === id)
      ? { ...c, turns: c.turns.map((t) => (t.id === id ? { ...t, written, writtenFor } : t)) }
      : c)),
  });
}

/**
 * A turn's reading changed by a chip: the answer is worked out again, and Gemma's sentences go with the old one.
 * The value a chip already shows changes nothing, so Gemma's sentences stay.
 */
export function updateTurnQuery(id: number, query: AskQuery): void {
  const turn = state.conversations.flatMap((c) => c.turns).find((t) => t.id === id);
  if (turn?.query && sameQuery(turn.query, query)) return;
  set({
    ...state,
    conversations: state.conversations.map((c) => (c.turns.some((t) => t.id === id)
      ? { ...c, turns: c.turns.map((t) => (t.id === id ? { ...t, query, edited: true, written: undefined, writtenFor: undefined } : t)) }
      : c)),
  });
}

/** A change asked in the thread, answered: made, said no to, or already so. */
export function settleOutcome(id: number, outcome: NonNullable<Turn['outcome']>): void {
  set({
    ...state,
    conversations: state.conversations.map((c) => (c.turns.some((t) => t.id === id)
      ? { ...c, turns: c.turns.map((t) => (t.id === id ? { ...t, outcome } : t)) }
      : c)),
  });
}

/** An empty thread to start again ("Neues Gespräch"). */
export function newConversation(): void {
  set({ ...state, open: true, current: null });
}

export function showConversation(id: number): void {
  set({ ...state, open: true, current: id });
}

export function closeAsk(): void {
  set({ ...state, open: false });
}

/** One conversation gone ("Gespräch löschen"); the open one leaves an empty thread behind. */
export function deleteConversation(id: number): void {
  set({ ...state, current: state.current === id ? null : state.current, conversations: state.conversations.filter((c) => c.id !== id) });
}

/** Every conversation gone ("Alle Gespräche löschen"), the thread left open and empty. */
export function deleteAllConversations(): void {
  set({ ...state, current: null, conversations: [] });
}

/** Month recaps hidden this session ("Rückblick ausblenden"): kept nowhere, forgotten with the session. */
export const hiddenRecaps = new Set<string>();

/**
 * Everything forgotten in memory: at logout, and when asking is switched off.
 * What the vault keeps stays there and comes back with the next login (or
 * when asking is switched on again).
 */
export function clearAsk(): void {
  hiddenRecaps.clear();
  restored = false;
  set({ open: false, current: null, conversations: [] });
}

// ---------------------------------------------------------------------------
// Kept in the vault (lib/ask-saved.ts)

/** Whether this session's conversations were brought back from the vault yet: until then, nothing is written there. */
let restored = false;

export const isRestored = (): boolean => restored;

/** Accepts every category: the vault checks them against its own when it loads (lib/vault.ts, provider/model.ts). */
const anyCategory = (v: unknown): v is CategoryId => typeof v === 'string';

/** One turn as the vault keeps it; null while it is still being read. */
function savedTurn(t: Turn, fallbackDay: string): SavedTurn | null {
  if (t.state === 'reading') return null;
  const bookingKey = t.booking ? txKey(t.booking) : t.bookingKey;
  return {
    question: t.question,
    state: t.state,
    day: t.day ?? fallbackDay,
    ...(t.query ? { query: t.query } : {}),
    ...(t.intent ? { intent: t.intent } : {}),
    ...(t.seed ? { recap: t.seed.month } : {}),
    ...(t.written !== undefined && t.writtenFor ? { written: t.written, writtenFor: t.writtenFor } : {}),
    ...(t.outcome ? { outcome: t.outcome } : {}),
    ...(t.edited ? { edited: true as const } : {}),
    ...(t.explain ? { explain: true as const } : {}),
    ...(bookingKey ? { bookingKey } : {}),
  };
}

/**
 * The conversations as the vault keeps them: finished turns only, a change
 * still waiting for its yes left out, the newest within the caps.
 */
export function savedConversations(s: State = state): SavedConversation[] {
  const today = dayKey(new Date());
  const raw = s.conversations.map((c) => ({
    id: c.key,
    title: c.title,
    at: c.at,
    turns: c.turns.map((t) => savedTurn(t, today)).filter(Boolean),
  }));
  return sanitizeAskConversations(raw, anyCategory);
}

/**
 * Brings the vault's conversations back, after those already here (the vault's
 * are older): each one not here yet, with new numbers for this session. A
 * question asked on an earlier day keeps the days it meant (lib/nano-ask.ts
 * pinQuery); Gemma's sentences go where that changed its reading, since they
 * may say "letzten Monat". Marks the session as restored, so changes are
 * written from now on.
 */
export function restoreConversations(saved: readonly SavedConversation[], today: string): void {
  restored = true;
  const here = new Set(state.conversations.map((c) => c.key));
  const back: Conversation[] = [];
  for (const sc of saved) {
    if (here.has(sc.id)) continue;
    const turns = sc.turns.map((st): Turn => {
      const query = st.query ? pinQuery(st.query, st.day, today) : undefined;
      const keepWritten = st.writtenFor !== undefined && query === st.query;
      return {
        id: nextId++,
        question: st.question,
        state: st.state,
        day: st.day,
        ...(query ? { query } : {}),
        ...(st.intent ? { intent: st.intent } : {}),
        ...(st.recap ? { seed: { kind: 'recap' as const, month: st.recap } } : {}),
        ...(keepWritten ? { written: st.written, writtenFor: st.writtenFor } : {}),
        ...(st.outcome ? { outcome: st.outcome } : {}),
        ...(st.edited ? { edited: true as const } : {}),
        ...(st.explain ? { explain: true as const } : {}),
        ...(st.bookingKey ? { bookingKey: st.bookingKey } : {}),
      };
    });
    back.push({ id: nextId++, key: sc.id, at: sc.at, title: sc.title, turns });
  }
  if (back.length) set({ ...state, conversations: [...state.conversations, ...back] });
}
