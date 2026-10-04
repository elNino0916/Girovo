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

import { CheckIcon, CloseIcon } from '../icons';
import { cx } from '../ui';

export const TRANSFER_STEPS = ['Erfassen', 'Prüfen', 'Freigabe', 'Fertig'] as const;

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
  const last = TRANSFER_STEPS.length - 1;
  return (
    <ol aria-label="Fortschritt der Überweisung" className={cx('flex items-center gap-2', className)}>
      {TRANSFER_STEPS.map((label, i) => {
        // Reaching "Fertig" with a known outcome completes it; an unknown
        // outcome leaves it current, marked with a question mark. A refusal
        // stops at "Freigabe", marked with a cross — "Fertig" never came.
        const done = i < current || (i === current && i === last && !unsure && !refused);
        const here = i === current && !done;
        const state = done ? 'erledigt' : here && refused ? 'abgelehnt' : here ? 'aktuell' : 'offen';
        return (
          <li
            key={label}
            aria-current={i === current ? 'step' : undefined}
            // The current step keeps its whole word; the others may shrink.
            className={cx('flex items-center gap-2', i < last && 'flex-1', i < last && i !== current && 'min-w-0')}
          >
            <span
              aria-hidden
              className={cx(
                'tnum grid size-6 shrink-0 place-items-center rounded-full text-[12px] leading-none font-bold',
                done && 'bg-accent text-accent-ink',
                here && !unsure && !refused && 'border-2 border-accent bg-raised text-accent',
                here && unsure && 'border-2 border-ink-3 bg-raised text-ink-2',
                here && refused && 'border-2 border-red bg-raised text-red',
                !done && !here && 'border-[1.5px] border-line-strong text-ink-3',
              )}
            >
              {done ? <CheckIcon size={13} strokeWidth={2.8} />
                : here && refused ? <CloseIcon size={12} strokeWidth={2.8} />
                  : here && unsure ? '?' : i + 1}
            </span>
            <span className="sr-only">Schritt {i + 1} von {TRANSFER_STEPS.length}: {label} ({state})</span>
            <span
              aria-hidden
              className={cx(
                'text-[13px] leading-none whitespace-nowrap',
                i === current ? 'font-semibold text-ink' : 'hidden font-medium sm:inline',
                i !== current && (done ? 'text-ink-2' : 'text-ink-3'),
              )}
            >
              {label}
            </span>
            {i < last && (
              <span
                aria-hidden
                className={cx('h-[2px] min-w-3 flex-1 rounded-full', i < current ? 'bg-accent' : 'bg-line-strong')}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
