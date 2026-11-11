'use client';

// Girovo Next: the asking bar at the foot of a booking's details. Two
// questions about the counterparty and a field for one's own; any of them
// closes the details and opens "Fragen" with the question in a new
// conversation (components/insights/ask-thread-store.ts), so two layers never
// stack. It stands in the drawer's footer, outside the scrolling body, so it
// never covers the details. TxDetail shows it only where asking is on
// (useCanAsk) and the booking has a counterparty to ask about.

import { useId, useState, type FormEvent } from 'react';
import { useT } from '@/lib/i18n/react';
import { openAsk } from '../insights/ask-thread-store';
import { ArrowRightIcon, GeminiSparkIcon } from '../icons';
import { Chip } from '../ui';

export function AskAboutBooking({ name, credit, onClose }: {
  /** The counterparty's tidied name, as the drawer's head shows it. */
  name: string;
  credit: boolean;
  /** Closes the booking's details. */
  onClose: () => void;
}) {
  const t = useT();
  const words = t.transactions.detail.ask;
  const headingId = useId();
  const fieldId = useId();
  const [question, setQuestion] = useState('');
  const suggestions = credit ? words.credit(name) : words.debit(name);

  const ask = (q: string) => {
    const text = q.trim();
    if (!text) return;
    onClose();
    // On the next tick, once the drawer has handed focus back to the row, as a transfer opened from here does.
    setTimeout(() => openAsk({ question: text, fresh: true }), 0);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    ask(question);
  };

  return (
    <section
      data-gemini
      aria-labelledby={headingId}
      className="rounded-t-[24px] px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6"
    >
      <h3 id={headingId} className="flex items-center gap-2 text-[14px] leading-5 font-medium text-ink">
        <GeminiSparkIcon size={16} />
        {words.title}
      </h3>
      <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-6 sm:px-6 [&::-webkit-scrollbar]:hidden">
        {suggestions.map((s) => (
          <Chip key={s} className="shrink-0" onClick={() => ask(s)}>{s}</Chip>
        ))}
      </div>
      {/* The thread's own composer (components/insights/AskThread.tsx): one shape for every way into it. */}
      <form onSubmit={submit} noValidate className="mt-2 flex h-14 items-center gap-2 rounded-full bg-[color-mix(in_srgb,var(--paper)_80%,transparent)] pr-1.5 pl-5 sm:h-12">
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
