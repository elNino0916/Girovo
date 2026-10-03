'use client';

// The dialog body both money sheets share: a fixed header (title, close, the
// stepper), a scrolling middle, and a fixed footer for the actions.
//
// The plain Sheet scrolls everything together, which is right for a short
// confirmation but not for a form taller than a 900×600 window: there the
// "Weiter" button would scroll out of reach and the step you are on would
// scroll out of sight. The edges only draw a hairline once something is
// actually scrolled under them, so a sheet that fits looks like one surface.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentProps, ReactNode, Ref } from 'react';
import { CloseIcon } from '../icons';
import { IconButton, cx } from '../ui';

const WIDTHS = { md: 'sm:max-w-[560px]', lg: 'sm:max-w-[720px]' } as const;

export function Panel({
  size = 'md', title, titleId, titleRef, eyebrow, onClose, closeDisabled, headerExtra, footer, children, className, bodyClassName,
  ...rest
}: Omit<ComponentProps<'div'>, 'title'> & {
  size?: keyof typeof WIDTHS;
  title: ReactNode;
  titleId: string;
  /** The heading takes focus on a step change, so it is focusable from script. */
  titleRef?: Ref<HTMLHeadingElement>;
  eyebrow?: ReactNode;
  /** Omit to show no close button (while an order is on its way). */
  onClose?: () => void;
  closeDisabled?: boolean;
  /** Under the title: the stepper. */
  headerExtra?: ReactNode;
  footer?: ReactNode;
  bodyClassName?: string;
}) {
  const body = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });

  const measure = useCallback(() => {
    const el = body.current;
    if (!el) return;
    const top = el.scrollTop > 1;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    // The thin scrollbar a tall form gets takes its width from the body's
    // right gutter, not from the fields: the content's right padding gives
    // it back (see below), so the fields end where the header and footer
    // end, scrollbar or not.
    el.style.setProperty('--sbw', `${Math.max(0, el.offsetWidth - el.clientWidth)}px`);
    setEdges((e) => (e.top === top && e.bottom === bottom ? e : { top, bottom }));
  }, []);

  useEffect(() => {
    const el = body.current;
    if (!el) return;
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    // The content grows and shrinks (an error appears, a step changes)
    // without the scroller itself changing size.
    const inner = el.firstElementChild;
    if (inner) ro?.observe(inner);
    return () => ro?.disconnect();
  }, [measure]);

  return (
    <div
      {...rest}
      className={cx(
        'anim-sheet relative flex max-h-full w-full flex-col overflow-hidden bg-raised shadow-[var(--shadow-pop)]',
        'rounded-t-[var(--radius-sheet)] sm:rounded-[var(--radius-sheet)]',
        WIDTHS[size],
        className,
      )}
    >
      <header
        className={cx(
          'relative z-1 shrink-0 px-5 pt-5 pb-4 transition-shadow duration-150 sm:px-7 sm:pt-6',
          edges.top && 'shadow-[0_1px_0_var(--line)]',
        )}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {eyebrow && <p className="mb-0.5 text-[13px] font-semibold text-ink-3">{eyebrow}</p>}
            <h2
              id={titleId}
              ref={titleRef}
              tabIndex={-1}
              className="text-[22px] leading-tight font-bold text-headline outline-none sm:text-[24px]"
            >
              {title}
            </h2>
          </div>
          {onClose && (
            <IconButton
              data-dialog-close
              size="md"
              aria-label="Schließen"
              onClick={onClose}
              disabled={closeDisabled}
              className="-mt-1.5 -mr-2"
            >
              <CloseIcon />
            </IconButton>
          )}
        </div>
        {headerExtra && <div className="mt-4">{headerExtra}</div>}
      </header>

      <div
        ref={body}
        onScroll={measure}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-color:var(--line-strong)_transparent] [scrollbar-width:thin]"
      >
        <div
          className={cx(
            'pr-[max(0px,calc(1.25rem_-_var(--sbw,0px)))] pl-5 sm:pr-[max(0px,calc(1.75rem_-_var(--sbw,0px)))] sm:pl-7',
            bodyClassName ?? 'pt-1 pb-6',
          )}
        >
          {children}
        </div>
      </div>

      {footer && (
        <footer
          className={cx(
            'relative z-1 shrink-0 px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] transition-shadow duration-150 sm:px-7 sm:pt-4 sm:pb-6',
            edges.bottom && 'shadow-[0_-1px_0_var(--line)]',
          )}
        >
          {footer}
        </footer>
      )}
    </div>
  );
}
