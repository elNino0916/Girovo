// Girovo Next, "Fragen": the conversations about the bookings (components/insights/AskThread.tsx).
//
// One module-level store, so any place can open the thread with a question
// (the search, Analyse's month recap, a booking's details) without the
// provider knowing about it. The conversations live for the session only:
// they are about bookings, and nothing about them is written anywhere.
//
// A turn is the user's question and Girovo's answer to it. The store only
// holds what was asked and how it was read (an AskQuery); the figures are
// worked out from the bookings in view each time the thread draws
// (lib/nano-ask.ts computeAnswer), so an answer follows a booking that
// arrives later. Reading a question (Gemini Nano, or the desktop's own model)
// happens in the thread's host, which has the provider; the store marks the
// turn 'reading' until then.

import { useSyncExternalStore } from 'react';
import { isExplainQuestion } from '@/lib/ask-explain';
import type { AskIntent } from '@/lib/ask-intents';
import type { SerializedTransaction } from '@/lib/fints-types';
import type { AskQuery } from '@/lib/nano-ask';

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
  /** "Was ist das für eine Zahlung?": that booking explained by the rules (lib/ask-explain.ts), no model asked. */
  explain?: true;
};

export type Conversation = {
  id: number;
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

function startConversation(title: string, turns: Turn[]): void {
  const c: Conversation = { id: nextId++, title, turns };
  // Newest first, as Verläufe and the sidebar list them.
  set({ open: true, current: c.id, conversations: [c, ...state.conversations] });
}

function turnOf(question: string, booking?: SerializedTransaction): Turn {
  const about = booking ? { booking } : {};
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
  startConversation(title, [{ id: nextId++, question: '', state: 'answered', query, seed: { kind: 'recap', month } }]);
}

/** A follow-up in the open conversation; it keeps the booking the conversation is about. */
export function askInThread(question: string, booking?: SerializedTransaction): void {
  const q = question.trim();
  if (!q) return;
  if (!currentConversation()) {
    startConversation(q, [turnOf(q, booking)]);
    return;
  }
  withConversation((c) => ({
    ...c,
    turns: [...c.turns, turnOf(q, booking ?? [...c.turns].reverse().find((t) => t.booking)?.booking)],
  }));
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

/** A turn's reading changed by a chip: the answer is worked out again, and Gemma's sentences go with the old one. */
export function updateTurnQuery(id: number, query: AskQuery): void {
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

/** "Später" on the first-use sheet: the conversation it was opened with goes, unasked. */
export function dropCurrent(): void {
  set({ open: false, current: null, conversations: state.conversations.filter((c) => c.id !== state.current) });
}

/** Month recaps hidden this session ("Rückblick ausblenden"): kept nowhere, forgotten with the session. */
export const hiddenRecaps = new Set<string>();

/** Everything forgotten: at logout, and when asking is switched off. */
export function clearAsk(): void {
  hiddenRecaps.clear();
  set({ open: false, current: null, conversations: [] });
}
