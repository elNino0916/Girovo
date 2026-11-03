'use client';

// Overlays
//
// One Overlay underlies every modal surface — centred dialog, bottom sheet,
// right drawer. It owns the contract a modal must keep: focus moves in and is
// trapped, Escape closes the topmost layer only, focus returns to whatever
// opened it, and the page behind stops scrolling.

import {
  type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject, useCallback, useEffect, useId,
  useLayoutEffect, useRef, useState,
} from 'react';
import { useT } from '@/lib/i18n/react';
import { CloseIcon } from '../icons';
import { usePhone } from '../shell/usePhone';
import { IconButton } from './button';
import {
  drawerLayers, focusablesIn, type FocusFallback, inertOutside, layerRoots, layerStack, lockPageScroll, neighboursOf,
  recoverFocus, revealInLayer, safeFocusTarget, syncCaptionDim, unlockPageScroll,
} from './layers';
import { cx, NO_DRAG } from './shared';

export type OverlayProps = {
  open: boolean;
  /** Escape and (unless onBackdrop says otherwise) a backdrop click. Omit for a layer that must not be dismissed. */
  onClose?: () => void;
  /** A backdrop click; defaults to onClose. Pass a no-op to keep a dirty form open. */
  onBackdrop?: () => void;
  /** center: dialog (a bottom sheet below 640px) · right: drawer · bottom: always a bottom sheet. */
  align?: 'center' | 'right' | 'bottom';
  labelledBy?: string;
  describedBy?: string;
  /** Accessible name when there is no visible title. */
  label?: string;
  /** Where focus goes on open. Defaults to the safe place (see safeFocusTarget): [data-autofocus], a field, the close button, the layer. */
  initialFocus?: RefObject<HTMLElement | null>;
  /**
   * Where focus goes on close. Defaults to whatever had focus when the layer
   * opened — pass the real opener when the layer can be re-mounted from
   * somewhere else (a sheet that steps aside for the TAN dialog and comes back).
   */
  returnFocus?: Element | null;
  /**
   * Where focus goes on close when that element is no longer on the page —
   * a ref, or a function asked at that moment. Without one (or when it is
   * gone too) focus lands on the opener's neighbour, else the page title.
   */
  fallbackFocus?: FocusFallback;
  className?: string;
  children: ReactNode;
};

export function Overlay(props: OverlayProps) {
  if (!props.open) return null;
  return <OverlayLayer {...props} />;
}

function OverlayLayer({
  onClose, onBackdrop, align = 'center', labelledBy, describedBy, label, initialFocus, returnFocus, fallbackFocus, className, children,
}: OverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const layerId = useId();
  // Captured during the first render — before any child's autoFocus runs —
  // so focus goes back to what opened the layer, not to its first field.
  // Above every layer already open when this one opens. Overlays render in
  // place, so two of them at the same z-index paint in page order: the
  // Umsatzdetails drawer, hosted by the Umsätze tile, opened from the
  // Vorgemerkt sheet further down the page and stayed under it — hidden
  // behind a sheet that was inert, so nothing on the screen took a tap.
  const [depth] = useState(() => layerStack.length);
  const [returnTo] = useState<Element | null>(
    () => returnFocus ?? (typeof document === 'undefined' ? null : document.activeElement),
  );
  const downOnBackdrop = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const fallbackRef = useRef(fallbackFocus);
  fallbackRef.current = fallbackFocus;

  useLayoutEffect(() => {
    const root = rootRef.current!;
    layerStack.push(layerId);
    layerRoots.set(layerId, root);
    if (align === 'right') drawerLayers.add(layerId);
    syncCaptionDim();
    lockPageScroll();
    const neighbours = neighboursOf(returnTo, root);
    const releaseInert = inertOutside(root);

    if (!root.contains(document.activeElement)) {
      const target = safeFocusTarget(root, initialFocus?.current);
      target.focus({ preventScroll: true });
      if (target !== root) revealInLayer(target, root);
      // An M3E control is focusable only once it has rendered (its tabindex
      // arrives in Lit's first update): until then focus() does nothing, and a
      // screen reader would stay on the row behind the scrim. Once it has
      // rendered — and only while nothing else took focus — again.
      if (document.activeElement !== target) {
        const retry = () => {
          if (!root.contains(document.activeElement)) target.focus({ preventScroll: true });
        };
        const rendered = (target as HTMLElement & { updateComplete?: Promise<unknown> }).updateComplete;
        if (rendered) void rendered.then(() => requestAnimationFrame(retry));
        else requestAnimationFrame(retry);
      }
    }

    // Focus that leaves the top layer by any route (a click on something
    // behind it, a script) is brought back in.
    const onFocusIn = (e: FocusEvent) => {
      if (layerStack[layerStack.length - 1] !== layerId) return;
      if (e.target instanceof Node && !root.contains(e.target)) {
        (focusablesIn(root)[0] ?? root).focus({ preventScroll: true });
      }
    };
    document.addEventListener('focusin', onFocusIn);

    return () => {
      document.removeEventListener('focusin', onFocusIn);
      const i = layerStack.lastIndexOf(layerId);
      if (i >= 0) layerStack.splice(i, 1);
      layerRoots.delete(layerId);
      drawerLayers.delete(layerId);
      syncCaptionDim();
      unlockPageScroll();
      // The page comes back before focus does: an inert opener takes none.
      releaseInert();
      if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus({ preventScroll: true });
      // Checked again once the commit is through: the opener can still be
      // connected here and leave in the same commit that closes the layer.
      const fallback = fallbackRef.current;
      setTimeout(() => recoverFocus(fallback, neighbours), 0);
    };
    // Mount/unmount only: the layer's identity is its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (layerStack[layerStack.length - 1] !== layerId) return;
    if (e.key === 'Escape') {
      if (!onCloseRef.current) return;
      e.stopPropagation();
      e.preventDefault();
      onCloseRef.current();
      return;
    }
    if (e.key !== 'Tab') return;
    const root = rootRef.current!;
    const items = focusablesIn(root);
    if (!items.length) {
      e.preventDefault();
      root.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === root)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const placement = {
    // On a phone a centred dialog becomes a bottom sheet. Inside the desktop
    // shell the top padding grows by up to 36px, so a tall dialog never
    // slides its close button under the OS caption buttons — at every width,
    // since zooming the shell's 900px minimum past ~141% puts it in the
    // bottom-sheet range with the buttons still there (the min() is 0
    // outside the shell, where --caption-inset is 0).
    center: 'items-end justify-center pt-[calc(1.5rem+min(var(--caption-inset),2.25rem))] sm:items-center sm:px-6 sm:pb-6',
    bottom: 'items-end justify-center pt-[calc(1.5rem+min(var(--caption-inset),2.25rem))] sm:px-6',
    right: 'justify-end',
  }[align];

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-label={labelledBy ? undefined : label}
      tabIndex={-1}
      data-align={align}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        // Only a press that also started on the backdrop: dragging a text
        // selection out of a field must not close the form under it.
        if (e.target !== e.currentTarget || !downOnBackdrop.current) return;
        (onBackdrop ?? onClose)?.();
      }}
      // A light surface: the page's focus ring, also when opened from inside
      // the navy masthead (see :focus-visible in globals.css).
      className={cx('anim-fade fixed inset-0 z-100 flex bg-scrim outline-none [--focus-ring:var(--focus)]', placement, className)}
      // z-100 for the first layer, one more for each above it; a layer that
      // must stay on top (SessionGuard's z-110!) overrides it.
      style={depth ? { ...NO_DRAG, zIndex: 100 + depth } : NO_DRAG}
    >
      {children}
    </div>
  );
}

const SHEET_WIDTHS = { sm: 'sm:max-w-[440px]', md: 'sm:max-w-[540px]', lg: 'sm:max-w-[680px]' } as const;

/**
 * Whether a scroller has content hidden below its visible part — the cue for
 * the hairline a fixed footer draws over it (and above, for a fixed header).
 * Also publishes the scroller's own scrollbar width as `--sbw` on it, so its
 * content can hand that room back (see Panel). Re-measured on scroll, and
 * whenever the scroller or its content changes size.
 */
export function useScrollEdges<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const top = el.scrollTop > 1;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    el.style.setProperty('--sbw', `${Math.max(0, el.offsetWidth - el.clientWidth)}px`);
    setEdges((e) => (e.top === top && e.bottom === bottom ? e : { top, bottom }));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    // A size change is measured in the next frame, not inside the observer's
    // callback: writing --sbw there resizes the content it watches within the
    // same delivery, which Chromium reports as a "ResizeObserver loop" — on
    // Windows' classic scrollbars, whose width in CSS pixels changes with
    // every zoom step.
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(later) : null;
    ro?.observe(el);
    // The content grows and shrinks (an error appears, a step changes)
    // without the scroller itself changing size.
    const inner = el.firstElementChild;
    if (inner) ro?.observe(inner);
    return () => {
      cancelAnimationFrame(frame);
      ro?.disconnect();
    };
  }, [measure]);

  return { ref, edges, measure };
}

/** The hairline a pinned footer draws once content scrolls under it (Sheet, Popover). */
export const FOOTER_EDGE = 'shadow-[0_-1px_0_var(--line)]';

/**
 * The panel of a centred dialog: 16px corners, a bottom sheet on phones.
 * `band` adds the navy header band with a centred pictogram — the dialog
 * form the reference uses for anything that needs your attention.
 *
 * `footer` (the dialog's buttons) stays put under the scrolling body, so in a
 * short window the way out is never scrolled out of reach; a hairline marks
 * it once there is more above it to scroll to. In a short window the band
 * also slims down, giving its room to what the dialog says.
 */
export function Sheet({
  size, band, onClose, closeLabel, className, bodyClassName, footer, basic, children,
}: {
  size?: 'sm' | 'md' | 'lg';
  band?: { icon: ReactNode; tone?: 'navy' | 'plain' };
  /** Renders a close button in the top-right corner. */
  onClose?: () => void;
  closeLabel?: string;
  className?: string;
  bodyClassName?: string;
  /** The actions row, fixed below the scrolling body (see DialogActions). */
  footer?: ReactNode;
  /** A short question or notice (Dialog): Material's basic dialog on Android, centred rather than a bottom sheet. */
  basic?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  const navy = band && band.tone !== 'plain';
  const { ref: bodyRef, edges, measure } = useScrollEdges<HTMLDivElement>();
  const sheetRef = useRef<HTMLDivElement>(null);
  const unpinned = useUnpinned(sheetRef);
  return (
    <div
      ref={sheetRef}
      data-sheet
      data-unpinned={unpinned || undefined}
      data-dialog={basic ? 'basic' : undefined}
      className={cx(
        'anim-sheet relative flex max-h-full w-full flex-col overflow-hidden bg-raised shadow-[var(--shadow-pop)]',
        'rounded-t-[var(--radius-sheet)] sm:rounded-[var(--radius-sheet)]',
        SHEET_WIDTHS[size ?? 'sm'],
        className,
      )}
    >
      {band && (
        <div
          aria-hidden
          data-pinned
          className={cx(
            'grid h-[88px] shrink-0 place-items-center short:h-14',
            navy ? 'bg-stage text-stage-ink dark:bg-bar' : 'bg-accent-soft text-accent',
          )}
        >
          <span
            className={cx(
              'grid size-12 place-items-center rounded-full short:scale-[0.8]',
              navy ? 'bg-[color-mix(in_srgb,var(--stage-ink)_14%,transparent)]' : 'bg-surface',
            )}
          >
            {band.icon}
          </span>
        </div>
      )}
      {onClose && (
        <IconButton
          data-dialog-close
          tone={navy ? 'stage' : 'page'}
          aria-label={closeLabel ?? t.common.close}
          onClick={onClose}
          className="absolute top-3 right-3 z-1"
        >
          <CloseIcon />
        </IconButton>
      )}
      <div
        ref={bodyRef}
        onScroll={measure}
        data-sheet-body
        className={cx(
          'min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-6 sm:px-7 sm:pt-7 short:pt-5',
          // With a footer the body keeps only room for a focus ring at its
          // edge; the footer's own top padding is the gap to the buttons.
          footer ? 'pb-1' : 'pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-7',
          bodyClassName,
        )}
      >
        {/* One element, so the scroll edge hears the content change size. */}
        <div>{children}</div>
      </div>
      {footer && (
        <div
          data-pinned
          className={cx(
            'relative shrink-0 px-5 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] transition-shadow duration-150 sm:px-7 sm:pb-7',
            'short:pt-3 short:pb-[max(1rem,env(safe-area-inset-bottom))] sm:short:pb-5',
            edges.bottom && FOOTER_EDGE,
          )}
        >
          {footer}
        </div>
      )}
    </div>
  );
}

/** More than this share of the screen pinned, and a sheet scrolls as one (useUnpinned). */
const PINNED_SHARE = 0.45;

/**
 * Whether a sheet's pinned parts — its band or header and its footer
 * ([data-pinned]) — would take more than PINNED_SHARE of the screen, as the
 * system's largest text does on a phone. Then the sheet scrolls as one
 * ([data-unpinned], app/material.css): what it says gets the screen, and the
 * way out is a scroll away at its end, rather than both pinned with two
 * lines between them. Measured as the parts change size.
 */
export function useUnpinned(sheet: RefObject<HTMLElement | null>): boolean {
  const [unpinned, setUnpinned] = useState(false);
  useLayoutEffect(() => {
    const el = sheet.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      let pinned = 0;
      for (const part of Array.from(el.querySelectorAll<HTMLElement>(':scope > [data-pinned]'))) pinned += part.offsetHeight;
      setUnpinned(pinned > window.innerHeight * PINNED_SHARE);
    };
    const ro = new ResizeObserver(measure);
    for (const part of Array.from(el.children)) ro.observe(part);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [sheet]);
  return unpinned;
}

/** Title row of a dialog: an optional pictogram, the title, a line of context, a close button. */
export function DialogHeader({
  title, titleId, description, onClose, closeLabel, icon, className,
}: {
  title: ReactNode;
  titleId?: string;
  description?: ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  icon?: ReactNode;
  className?: string;
}) {
  const t = useT();
  return (
    <div data-dialog-header className={cx('flex items-start gap-3.5', className ?? 'mb-5')}>
      {icon && <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">{icon}</span>}
      <div className="min-w-0 flex-1">
        <h2 id={titleId} className="text-[22px] leading-tight font-medium text-headline">{title}</h2>
        {description && <div className="mt-1.5 text-[15px] leading-snug text-ink-2">{description}</div>}
      </div>
      {onClose && (
        <IconButton data-dialog-close aria-label={closeLabel ?? t.common.close} onClick={onClose} size="md" className="-mt-1.5 -mr-2">
          <CloseIcon />
        </IconButton>
      )}
    </div>
  );
}

/**
 * The button row at the foot of a dialog. Primary goes LAST in the markup:
 * rightmost on desktop, topmost (closest to the thumb's reach and the eye)
 * when the row stacks on a phone. Hand it to Sheet as its `footer` (Dialog
 * does), with `className=""`, so it stays in view however far the dialog's
 * text has to scroll in a short window.
 */
export function DialogActions({
  children, align = 'end', className,
}: { children: ReactNode; align?: 'end' | 'center' | 'stretch' | 'between'; className?: string }) {
  return (
    <div
      data-dialog-actions
      className={cx(
        'flex flex-col-reverse gap-3 sm:flex-row sm:items-center',
        align === 'end' && 'sm:justify-end',
        align === 'center' && 'sm:justify-center',
        align === 'between' && 'sm:justify-between',
        align === 'stretch' && 'sm:[&>*]:flex-1',
        className ?? 'mt-6',
      )}
    >
      {children}
    </div>
  );
}

/** A complete small dialog — confirmations, notices. */
export function Dialog({
  open, onClose, onBackdrop, title, description, icon, band, size = 'sm', actions, children, initialFocus, fallbackFocus,
}: {
  open: boolean;
  onClose?: () => void;
  onBackdrop?: () => void;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  band?: { icon: ReactNode; tone?: 'navy' | 'plain' };
  size?: 'sm' | 'md' | 'lg';
  actions?: ReactNode;
  children?: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  fallbackFocus?: FocusFallback;
}) {
  const id = useId();
  const titleId = `dlg${id}-title`;
  const descId = description ? `dlg${id}-desc` : undefined;
  return (
    <Overlay open={open} onClose={onClose} onBackdrop={onBackdrop} labelledBy={titleId} describedBy={descId} initialFocus={initialFocus} fallbackFocus={fallbackFocus}>
      <Sheet
        basic
        size={size}
        band={band}
        onClose={band ? onClose : undefined}
        footer={actions ? <DialogActions align={band ? 'center' : 'end'} className="">{actions}</DialogActions> : undefined}
      >
        <DialogHeader
          title={title}
          titleId={titleId}
          icon={band ? undefined : icon}
          onClose={band ? undefined : onClose}
          description={description ? <span id={descId}>{description}</span> : undefined}
          // Nothing follows the header but the pinned buttons: no gap to keep.
          className={cx(band && 'text-center', children ? (band ? 'mb-4' : 'mb-5') : 'mb-0')}
        />
        {children}
      </Sheet>
    </Overlay>
  );
}

/**
 * A panel from the right edge — details, Mitteilungen. Its header is a navy
 * band exactly as tall as the masthead, so in the desktop shell the OS
 * caption buttons (which stay on top of everything) sit on the same navy and
 * the header's own controls are padded clear of them. The drawer grows by
 * their width there, so its title keeps the room it has in a browser
 * ("Vorgemerkter Umsatz" was cut to "Vorgemerkter Umsa…"), and from 640px up
 * its close button leads the header: at the trailing end it stood right
 * beside the window's own close and read as a fourth caption button.
 */
export function Drawer({
  open, onClose, title, titleId, actions, footer, width = 'md', children, bodyClassName, fallbackFocus,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  titleId?: string;
  /** Extra controls in the header row, left of the close button. */
  actions?: ReactNode;
  footer?: ReactNode;
  width?: 'md' | 'lg';
  bodyClassName?: string;
  /** Where focus goes on close when the control that opened the drawer is gone. */
  fallbackFocus?: FocusFallback;
  children: ReactNode;
}) {
  const t = useT();
  const auto = useId();
  const phone = usePhone();
  const id = titleId ?? `drawer${auto}-title`;
  // Rendered where it shows, not moved with CSS order: focus and a screen
  // reader then meet it in the order the eye does.
  const close = (
    // -ml-1: the glyph lines up with the body's 24px edge.
    <IconButton data-dialog-close tone="bar" size="md" aria-label={t.common.close} onClick={onClose} className={phone ? '-mr-2' : '-ml-1'}>
      <CloseIcon />
    </IconButton>
  );
  return (
    <Overlay open={open} onClose={onClose} align="right" labelledBy={id} fallbackFocus={fallbackFocus}>
      <div
        className={cx(
          'anim-drawer flex h-dvh w-full flex-col bg-raised shadow-[var(--shadow-pop)]',
          // Plus the caption buttons' width: 0 outside the desktop shell.
          width === 'lg' ? 'sm:max-w-[calc(560px_+_var(--caption-inset))]' : 'sm:max-w-[calc(440px_+_var(--caption-inset))]',
        )}
      >
        <header data-topbar className="on-bar bar-caption-safe flex shrink-0 items-center gap-2 bg-bar pl-4 text-bar-ink" style={{ height: 'var(--barbar-h)' }}>
          {!phone && close}
          <h2 id={id} className="min-w-0 flex-1 truncate text-[17px] font-bold">{title}</h2>
          {actions}
          {phone && close}
        </header>
        <div className={cx('min-h-0 flex-1 overflow-y-auto overscroll-contain', bodyClassName ?? 'px-4 py-5 sm:px-6')}>
          {children}
        </div>
        {footer && (
          <div className="shrink-0 border-t border-line px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">{footer}</div>
        )}
      </div>
    </Overlay>
  );
}
