'use client';

// Erfassen · Prüfen · Freigabe · Fertig — where in the transfer you are.
//
// Four steps, because that is what actually happens: you write the order, you
// check it, the bank (Namensabgleich, then your approval in the app) clears
// it, and it is done. On a phone only the current step keeps its word; the
// others are numbered marks, and a screen reader hears all of it.
//
// Finished steps are filled, the current one is a ring, open ones are grey
// outlines — distinguishable by shape as well as colour, in both themes.
// Drawn in navy, not Signal Blue: progress cannot be pressed, and blue is
// what can (DESIGN.md, the One Signal Rule).
//
// In a short window the marks alone remain — the sheet's title already names
// the step — so the row fits beside the title (see Panel's compactExtra).

import { useT } from '@/lib/i18n/react';
import { CheckIcon, CloseIcon } from '../icons';
import { cx } from '../ui';

/** The four steps, by id; each is named where it is shown. */
export const TRANSFER_STEPS = ['enter', 'review', 'approve', 'done'] as const;

export function Stepper({
  current, unsure = false, refused = false, className,
}: {
  /** 0-based index into TRANSFER_STEPS. */
  current: number;
  /** The last step is reached but its outcome is unknown — no check mark for it. */
  unsure?: boolean;
  /** The bank refused the order at the current step: it stops there, marked with a cross. */
  refused?: boolean;
  className?: string;
}) {
  const t = useT();
  const words = t.transfer.stepper;
  const labels = { enter: words.enter, review: words.review, approve: t.common.approval, done: t.common.done };
  const last = TRANSFER_STEPS.length - 1;
  return (
    <ol aria-label={words.label} className={cx('flex items-center gap-2 short:gap-1.5', className)}>
      {TRANSFER_STEPS.map((id, i) => {
        const label = labels[id];
        // Reaching "Fertig" with a known outcome completes it; an unknown
        // outcome leaves it current, marked with a question mark. A refusal
        // stops at "Freigabe", marked with a cross — "Fertig" never came.
        const done = i < current || (i === current && i === last && !unsure && !refused);
        const here = i === current && !done;
        const state = done ? words.states.done
          : here && refused ? words.states.refused
            : here ? words.states.current : words.states.open;
        return (
          <li
            key={id}
            aria-current={i === current ? 'step' : undefined}
            // The current step keeps its whole word; the others may shrink.
            className={cx(
              'flex items-center gap-2 short:gap-1.5',
              i < last && 'flex-1',
              i < last && i !== current && 'min-w-0',
            )}
          >
            <span
              aria-hidden
              className={cx(
                'tnum grid size-6 shrink-0 place-items-center rounded-full text-[12px] leading-none font-bold short:size-5',
                done && 'bg-headline text-raised',
                here && !unsure && !refused && 'border-2 border-headline bg-raised text-headline',
                // Status unklar: the orange edge it carries everywhere, the mark in ink.
                here && unsure && 'border-2 border-emphasis bg-raised text-ink',
                here && refused && 'border-2 border-red bg-raised text-red',
                !done && !here && 'border-[1.5px] border-line-strong text-ink-3',
              )}
            >
              {done ? <CheckIcon size={13} strokeWidth={2.8} />
                : here && refused ? <CloseIcon size={12} strokeWidth={2.8} />
                  : here && unsure ? '?' : i + 1}
            </span>
            <span className="sr-only">{words.step(i + 1, TRANSFER_STEPS.length, label, state)}</span>
            <span
              aria-hidden
              className={cx(
                'text-[13px] leading-none whitespace-nowrap short:hidden',
                i === current ? 'font-semibold text-ink' : 'hidden font-medium sm:inline',
                i !== current && (done ? 'text-ink-2' : 'text-ink-3'),
              )}
            >
              {label}
            </span>
            {i < last && (
              <span
                aria-hidden
                className={cx('h-[2px] min-w-3 flex-1 rounded-full short:min-w-2', i < current ? 'bg-headline' : 'bg-line-strong')}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
