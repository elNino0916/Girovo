'use client';

// Girovo Next: the asking bar at the foot of a booking's details. Three
// questions, "Was ist das für eine Zahlung?" first (the booking explained,
// components/insights/ask/ExplainAnswer.tsx) and two about the counterparty,
// then a field for one's own. Any of them closes the details and opens
// "Fragen" with the question in a new conversation that knows the booking
// (components/insights/ask-thread-store.ts `booking`), so two layers never
// stack. The questions are outlined chips like the thread's next questions,
// wrapping onto as many lines as they need: a long name is read whole, never
// cut or scrolled. It stands in the drawer's footer, outside the scrolling
// body, so it never covers the details. TxDetail shows it only where asking
// is on (useCanAsk) and the booking has a counterparty to ask about.

import { useId, useState, type FormEvent } from 'react';
import { isExplainQuestion } from '@/lib/ask-explain';
import type { SerializedTransaction } from '@/lib/fints-types';
import { useT } from '@/lib/i18n/react';
import { openAsk } from '../insights/ask-thread-store';
import { ArrowRightIcon, AiMarkIcon } from '../icons';

export function AskAboutBooking({ tx, name, credit, onClose }: {
  /** The booking the questions are about: the conversation carries it. */
  tx: SerializedTransaction;
  /** The counterparty's tidied name, as the drawer's head shows it. */
  name: string;
  credit: boolean;
  /** Closes the booking's details. */
  onClose: () => void;
}) {
  const t = useT();
  const words = t.transactions.detail.ask;
  const explain = t.ask.explain;
  const headingId = useId();
  const fieldId = useId();
  const [question, setQuestion] = useState('');
  const suggestions = [explain.question, ...(credit ? words.credit(name) : words.debit(name))].slice(0, 3);

  const ask = (q: string) => {
    const text = q.trim();
    if (!text) return;
    onClose();
    // An explanation's conversation is named after the booking: every one of them asks the same question.
    const title = isExplainQuestion(text) ? explain.title(name) : undefined;
    // On the next tick, once the drawer has handed focus back to the row, as a transfer opened from here does.
    setTimeout(() => openAsk({ question: text, fresh: true, booking: tx, title }), 0);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    ask(question);
  };

  return (
    <section
      data-ai
      aria-labelledby={headingId}
      className="rounded-t-[24px] px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6"
    >
      <h3 id={headingId} className="flex items-center gap-2 text-[14px] leading-5 font-medium text-ink">
        <AiMarkIcon size={16} />
        {words.title}
      </h3>
      <ul className="mt-2 flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <li key={s} className="flex max-w-full">
            {/* The thread's next-question chip, allowed a second line; 40px to touch, 32 to see. */}
            <button
              type="button"
              onClick={() => ask(s)}
              className="relative min-h-8 max-w-full rounded-[8px] bg-paper px-3.5 py-1.5 text-left text-[14px] leading-5 font-medium text-ink shadow-[inset_0_0_0_1px_var(--md-outline-variant)] [overflow-wrap:anywhere] before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] hover:bg-[color-mix(in_srgb,var(--ink)_6%,var(--paper))]"
            >
              {s}
            </button>
          </li>
        ))}
      </ul>
      {/* The thread's own composer (components/insights/AskThread.tsx): one shape for every way into it. */}
      <form onSubmit={submit} noValidate className="mt-3 flex h-14 items-center gap-2 rounded-full bg-[color-mix(in_srgb,var(--paper)_80%,transparent)] pr-1.5 pl-5 sm:h-12">
        <label htmlFor={fieldId} className="sr-only">{words.own}</label>
        <input
          id={fieldId}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={words.own}
          enterKeyHint="send"
          autoComplete="off"
          maxLength={160}
          className="min-w-0 flex-1 bg-transparent text-[16px] leading-6 text-ink outline-none placeholder:text-ink-2 sm:text-[14px]"
        />
        <button
          type="submit"
          aria-label={words.send}
          disabled={!question.trim()}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-accent-ink disabled:bg-[color-mix(in_srgb,var(--ink)_10%,transparent)] disabled:text-ink-3 sm:size-9"
        >
          <ArrowRightIcon size={20} />
        </button>
      </form>
    </section>
  );
}
