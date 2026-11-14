'use client';

// Girovo AI: "Was kannst du?", "Hilfe", "Wie funktionierst du?" (lib/ask-intents.ts
// help). What it can do in short groups, each a title, one line and two or
// three questions to tap; a tapped question goes into the conversation as if
// typed, like the next-question chips. The first groups show, "Mehr zeigen"
// opens the rest. Under them one line on where every amount comes from and
// the way to Einstellungen → Girovo AI for Ton, Länge and Anrede. Longer than
// the panel, so the newest one is shown from its question down, not from its
// end as the thread scrolls to.
//
// The examples are read by the same rules as a typed question
// (lib/ask-help.test.ts keeps each one read as what it shows). The same
// groups on both platforms: nothing in them needs the desktop's Gemma.
//
// Routed from components/insights/AskThread.tsx IntentAnswer.

import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../../FintsProvider';
import { askInThread, currentConversation, useAskThread, type Turn } from '../ask-thread-store';

const TEXT = 'text-[16px] leading-6 text-ink sm:text-[14px] sm:leading-[22px] [text-wrap:pretty]';

export function HelpAnswer({ turn, onShown }: { turn: Turn; onShown: () => void }) {
  const words = useT().ask.help;
  const { openSettings } = useFints();
  const s = useAskThread();
  const [open, setOpen] = useState(false);
  const restId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const latest = currentConversation(s)?.turns.at(-1)?.id === turn.id;
  // One question at a time, as the field and the next-question chips ask.
  const busy = s.conversations.some((c) => c.turns.some((t) => t.state === 'reading'));
  const groups = open ? words.groups : words.groups.slice(0, words.shown);
  const hidden = words.groups.length - words.shown;

  // Once, when it appears as the newest answer: its question at the top, after the thread's own scroll to the end.
  useEffect(() => {
    if (!latest) return;
    const id = window.setTimeout(() => {
      const item = ref.current?.closest('li');
      const list = item?.closest<HTMLElement>('.overflow-y-auto');
      if (!item || !list) return;
      const top = list.scrollTop + item.getBoundingClientRect().top - list.getBoundingClientRect().top - 4;
      list.scrollTo({ top, behavior: 'smooth' });
    }, 400);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={ref}>
      <p className={TEXT}>{words.intro}</p>
      <ul id={restId} className="mt-3 flex flex-col gap-4">
        {groups.map((g) => (
          <li key={g.title}>
            <h3 className="text-[14px] leading-5 font-medium text-ink">{g.title}</h3>
            <p className="mt-0.5 text-[14px] leading-5 text-ink-2 sm:text-[13px] sm:leading-[18px] [text-wrap:pretty]">{g.text}</p>
            {g.examples.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2">
                {g.examples.map((q) => (
                  <li key={q} className="flex max-w-full">
                    {/* The thread's next-question chip, allowed a second line; 40px to touch, 32 to see. */}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => askInThread(q)}
                      className="relative min-h-8 max-w-full rounded-[8px] bg-paper px-3 py-1.5 text-left text-[14px] leading-5 font-medium text-ink shadow-[inset_0_0_0_1px_var(--md-outline-variant)] [overflow-wrap:anywhere] before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] hover:bg-[color-mix(in_srgb,var(--ink)_6%,var(--paper))] disabled:opacity-50"
                    >
                      {q}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={restId}
          onClick={() => setOpen((v) => !v)}
          className="mt-3 inline-flex min-h-10 items-center rounded-sm text-[14px] leading-5 font-medium text-accent underline-offset-4 hover:underline"
        >
          {open ? words.less : words.more}
        </button>
      )}
      <p className="mt-3 text-[14px] leading-5 text-ink-2 sm:text-[13px] sm:leading-[18px]">{words.how}</p>
      <p className="mt-1 text-[14px] leading-5 text-ink-2 sm:text-[13px] sm:leading-[18px]">
        {words.style}{' '}
        <button
          type="button"
          onClick={() => {
            openSettings('askTone');
            onShown();
          }}
          className="font-medium text-accent underline-offset-2 hover:underline"
        >
          {words.styleLink}
        </button>
      </p>
    </div>
  );
}
