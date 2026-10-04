'use client';

// The dialog body both money sheets share: a fixed header (title, close, the
// stepper), a scrolling middle, and a fixed footer for the actions.
//
// The plain Sheet scrolls everything together, which is right for a short
// confirmation but not for a form taller than a 900×600 window: there the
// "Weiter" button would scroll out of reach and the step you are on would
// scroll out of sight. The edges only draw a hairline once something is
// actually scrolled under them, so a sheet that fits looks like one surface.
//
// In a short window (the 900×600 minimum, 200 % zoom) the fixed parts give
// room back to the form: a smaller title, tighter padding, and — with
// `compactExtra`, for the stepper — the line under the title moves up beside
// it. What a step asks for then starts above the fold.

import { useLayoutEffect } from 'react';
import type { ComponentProps, ReactNode, Ref } from 'react';
import { CloseIcon } from '../icons';
import { IconButton, cx, useScrollEdges } from '../ui';

const WIDTHS = { md: 'sm:max-w-[560px]', lg: 'sm:max-w-[720px]' } as const;

export function Panel({
  size = 'md', title, titleId, titleRef, eyebrow, onClose, closeDisabled, headerExtra, compactExtra = false, footer, children,
  className, bodyClassName, scrollKey, ...rest
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
  /** In a short window the header line sits beside the title instead of under it (one line: the stepper). */
  compactExtra?: boolean;
  footer?: ReactNode;
  bodyClassName?: string;
  /**
   * The body scrolls back to its top whenever this changes — a new step
   * starts at its beginning, where its warnings are, not at the scroll
   * offset the last step was left at.
   */
  scrollKey?: string | number;
}) {
  // The thin scrollbar a tall form gets takes its width from the body's
  // right gutter, not from the fields: the content's right padding gives it
  // back (--sbw, see below), so the fields end where the header and footer
  // end, scrollbar or not.
  const { ref: body, edges, measure } = useScrollEdges<HTMLDivElement>();

  // Before paint, so the new step is never seen scrolled.
  useLayoutEffect(() => {
    const el = body.current;
    if (!el || scrollKey === undefined) return;
    el.scrollTop = 0;
    measure();
  }, [scrollKey, measure, body]);

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
          'relative z-1 shrink-0 px-5 pt-5 pb-4 transition-shadow duration-150 sm:px-7 sm:pt-6 short:pt-4 short:pb-3',
          edges.top && 'shadow-[0_1px_0_var(--line)]',
        )}
      >
        {/* One wrapping row: the title, then the line under it. In a short
            window a compact line asks for a place beside the title and only
            drops under it when a long title leaves too little room. The close
            button sits in the corner, so the order stays title, line, close. */}
        <div
          className={cx(
            'flex flex-wrap items-center gap-x-5 gap-y-4 short:gap-y-3',
            onClose && compactExtra && 'short:pr-9',
          )}
        >
          <div className={cx('min-w-0 max-w-full', onClose && 'pr-9', onClose && compactExtra && 'short:pr-0')}>
            {eyebrow && <p className="mb-0.5 text-[13px] font-semibold text-ink-3">{eyebrow}</p>}
            <h2
              id={titleId}
              ref={titleRef}
              tabIndex={-1}
              className="text-[22px] leading-tight font-bold text-headline outline-none short:text-[20px]"
            >
              {title}
            </h2>
          </div>
          {headerExtra && (
            <div className={cx('min-w-0 basis-full', compactExtra && 'short:grow short:basis-40')}>{headerExtra}</div>
          )}
        </div>
        {onClose && (
          <IconButton
            data-dialog-close
            size="md"
            aria-label="Schließen"
            onClick={onClose}
            disabled={closeDisabled}
            className="absolute top-3.5 right-3 sm:top-[18px] sm:right-5 short:top-2.5!"
          >
            <CloseIcon />
          </IconButton>
        )}
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
            'relative z-1 shrink-0 px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] transition-shadow duration-150 sm:px-7 sm:pt-4 sm:pb-6 short:pt-3 sm:short:pb-4',
            edges.bottom && 'shadow-[0_-1px_0_var(--line)]',
          )}
        >
          {footer}
        </footer>
      )}
    </div>
  );
}
