'use client';

// Floating layers: Menu and Popover.
//
// Positioned `fixed` against the trigger's rect and kept inside the viewport:
// below by default, flipped above when there is more room there, clamped 8px
// from either side, and re-measured on scroll (of any container) and resize.
// In the desktop shell a layer that reaches the window's top-right corner
// also stops below the OS caption buttons, which sit on top of everything and
// take every click there (the arithmetic is lib/anchor's).

import {
  createContext, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent,
  type ReactNode, type Ref, type RefCallback, type RefObject, useCallback, useContext, useEffect, useId,
  useLayoutEffect, useRef, useState,
} from 'react';
import { M3eDivider } from '@m3e/react/divider';
import { M3eMenu, M3eMenuItem, M3eMenuItemGroup, M3eMenuItemRadio } from '@m3e/react/menu';
import { anchorPosition, type Placement } from '@/lib/anchor';
import { revealInLayer, safeFocusTarget } from './layers';
import { FOOTER_EDGE, useScrollEdges } from './overlay';
import { cx, NO_DRAG } from './shared';

/**
 * The OS caption buttons' block in the desktop shell (Window Controls
 * Overlay); 0 × 0 everywhere else. Read back from a probe sized by the same
 * env() values --caption-inset is built from — the custom property itself
 * would come back as unresolved calc() text. Measured afresh on every
 * placement, so maximise, restore and zoom are always current.
 */
function captionBlock(): { width: number; height: number } {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;right:0;visibility:hidden;pointer-events:none;' +
    'width:var(--caption-inset,0px);height:env(titlebar-area-height,0px)';
  document.body.appendChild(probe);
  const { width, height } = probe.getBoundingClientRect();
  probe.remove();
  return { width, height };
}

function useAnchoredPosition(
  anchor: RefObject<HTMLElement | null>,
  floating: RefObject<HTMLElement | null>,
  open: boolean,
  placement: Placement,
  gap = 6,
): CSSProperties {
  const [pos, setPos] = useState<CSSProperties>({ position: 'fixed', top: 0, left: 0, visibility: 'hidden' });

  useLayoutEffect(() => {
    if (!open) return;
    let raf = 0;
    const place = () => {
      const a = anchor.current;
      const f = floating.current;
      if (!a || !f) return;
      const { top, left, maxHeight } = anchorPosition({
        anchor: a.getBoundingClientRect(),
        width: f.offsetWidth,
        height: f.scrollHeight,
        viewportWidth: document.documentElement.clientWidth,
        viewportHeight: window.innerHeight,
        placement,
        gap,
        caption: captionBlock(),
      });
      setPos((p) =>
        p.top === top && p.left === left && p.maxHeight === maxHeight && p.visibility === 'visible'
          ? p
          : { position: 'fixed', top, left, maxHeight, visibility: 'visible' },
      );
    };
    place();
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(place);
    };
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    if (floating.current) ro?.observe(floating.current);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      ro?.disconnect();
    };
  }, [open, placement, anchor, floating, gap]);

  return open ? pos : { position: 'fixed', top: 0, left: 0, visibility: 'hidden' };
}

/** Closes on a pointer press outside both the trigger and the layer. */
function useOutsidePress(open: boolean, refs: Array<RefObject<HTMLElement | null>>, onOutside: () => void) {
  const cb = useRef(onOutside);
  cb.current = onOutside;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && refs.some((r) => r.current?.contains(t))) return;
      cb.current();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
    // refs are stable ref objects
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

export type TriggerProps = {
  ref: RefCallback<HTMLElement>;
  id: string;
  'aria-haspopup': 'menu' | 'dialog';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
  onClick: () => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
};

/** M3E's menu element, as Menu drives it. */
type M3eMenuEl = HTMLElement & { readonly isOpen: boolean; show(trigger: HTMLElement): Promise<void>; hide(restoreFocus?: boolean): void };

const MENU_POSITION: Record<Placement, { x: 'before' | 'after'; y: 'above' | 'below' }> = {
  'bottom-start': { x: 'after', y: 'below' },
  'bottom-end': { x: 'before', y: 'below' },
  'top-start': { x: 'after', y: 'above' },
  'top-end': { x: 'before', y: 'above' },
};

const MENU_ITEMS = 'm3e-menu-item, m3e-menu-item-radio, m3e-menu-item-checkbox';

type MenuCtx = { close: (returnFocus?: boolean) => void };
const MenuContext = createContext<MenuCtx | null>(null);

/**
 * A button-triggered menu: M3E's (@m3e/web menu) — its surface, its items'
 * state layers and selected shape, its placement at the trigger (flipping
 * where there is no room), arrows, Home/End, Enter, a press outside and
 * Escape. The trigger is a render prop so any control can open it — a
 * button, a chip, a masthead item:
 *
 *   <Menu label="Export" trigger={(p) => <Button {...p}>Export</Button>}>
 *     <MenuItem onSelect={…}>Kontoauszug als PDF</MenuItem>
 *   </Menu>
 *
 * Girovo's part: ↓ and ↑ on the trigger open on the first and the last
 * item, a set of radios opens on its checked choice, Escape closes the menu
 * and never the dialog under it, and Tab moves on from the trigger.
 */
export function Menu({
  trigger, children, label, placement = 'bottom-start', className, minWidth = 220, onOpenChange,
}: {
  trigger: (props: TriggerProps, state: { open: boolean }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  /** The menu's accessible name; defaults to the trigger's. */
  label?: string;
  placement?: Placement;
  className?: string;
  minWidth?: number;
  onOpenChange?: (open: boolean) => void;
}) {
  const auto = useId();
  const triggerId = `menu${auto}-trigger`;
  const menuId = `menu${auto}`;
  const [open, setOpenState] = useState(false);
  // The items are there while the menu is open and a moment after, so
  // M3E's closing animation has its surface to fold away.
  const [rendered, setRendered] = useState(false);
  const focusOnOpen = useRef<'first' | 'last'>('first');
  const triggerRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<M3eMenuEl | null>(null);

  const setOpen = useCallback((v: boolean) => {
    setOpenState(v);
    onOpenChange?.(v);
  }, [onOpenChange]);

  const openMenu = (from: 'first' | 'last') => {
    focusOnOpen.current = from;
    setRendered(true);
    setOpen(true);
  };

  const close = useCallback((returnFocus = true) => {
    const menu = menuRef.current;
    if (menu?.isOpen) menu.hide(returnFocus);
    else if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  // Once its items are in, M3E shows the menu at its trigger. It puts focus
  // on the first item; ↑ starts on the last, a set of radios on its choice.
  useEffect(() => {
    const menu = menuRef.current;
    const anchor = triggerRef.current;
    if (!open || !rendered || !menu || !anchor || menu.isOpen) return;
    let gone = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void menu.show(anchor).then(() => {
      timer = setTimeout(() => {
        if (gone || !menu.isOpen) return;
        const list = Array.from(menu.querySelectorAll<HTMLElement & { disabled?: boolean; checked?: boolean }>(MENU_ITEMS))
          .filter((el) => !el.disabled);
        const target = focusOnOpen.current === 'last' ? list[list.length - 1] : (list.find((el) => el.checked) ?? list[0]);
        target?.focus({ preventScroll: true });
      }, 80);
    });
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [open, rendered]);

  useEffect(() => {
    if (open || !rendered) return;
    const t = setTimeout(() => setRendered(false), 250);
    return () => clearTimeout(t);
  }, [open, rendered]);

  const triggerProps: TriggerProps = {
    ref: (el) => { triggerRef.current = el; },
    id: triggerId,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    onClick: () => {
      if (open) close(false);
      else openMenu('first');
    },
    onKeyDown: (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      if (!open) openMenu(e.key === 'ArrowUp' ? 'last' : 'first');
    },
  };

  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    // M3E has closed the menu and given focus back; the key ends here, so a
    // dialog under the menu stays open.
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    // M3E closes on Tab; the browser's own move then starts at the trigger,
    // not at an item that is going away.
    if (e.key === 'Tab') triggerRef.current?.focus({ preventScroll: true });
  };

  return (
    <MenuContext.Provider value={{ close }}>
      {trigger(triggerProps, { open })}
      {rendered && (
        <M3eMenu
          ref={menuRef as Ref<never>}
          id={menuId}
          positionX={MENU_POSITION[placement].x}
          positionY={MENU_POSITION[placement].y}
          aria-labelledby={label ? undefined : triggerId}
          aria-label={label}
          onToggle={(e: Event) => {
            if ((e as ToggleEvent).newState === 'closed') setOpen(false);
          }}
          onKeyDown={onMenuKeyDown}
          style={{ minWidth, ...NO_DRAG }}
          className={className}
        >
          {typeof children === 'function' ? children(() => close(true)) : children}
        </M3eMenu>
      )}
    </MenuContext.Provider>
  );
}

type MenuItemBase = {
  children: ReactNode;
  icon?: ReactNode;
  /** Right-aligned extra — a shortcut (Kbd), a value. */
  hint?: ReactNode;
  /** A second line under the label. */
  description?: ReactNode;
  disabled?: boolean;
  /** Keep the menu open after selecting (a toggle among several). */
  keepOpen?: boolean;
  onSelect?: () => void;
  className?: string;
};

function useItemHandlers({ disabled, keepOpen, onSelect }: Pick<MenuItemBase, 'disabled' | 'keepOpen' | 'onSelect'>) {
  const menu = useContext(MenuContext);
  return {
    // M3E closes the menu on an item's click unless it is cancelled, which
    // has to happen before its own handler: in the capture phase.
    onClickCapture: keepOpen ? (e: ReactMouseEvent) => e.preventDefault() : undefined,
    onClick: () => {
      if (disabled) return;
      onSelect?.();
      // At once, focus back on the trigger: a radio's choice M3E closes only
      // after 150ms, and what the choice changes may scroll the page first —
      // which closes an M3E menu without giving focus back.
      if (!keepOpen) menu?.close(true);
    },
  };
}

function ItemBody({ icon, children, description, hint }: Pick<MenuItemBase, 'icon' | 'children' | 'description' | 'hint'>) {
  return (
    <>
      {icon && <span slot="icon" className="inline-flex">{icon}</span>}
      {/* M3E keeps an item to one line; a description makes it two, the
          item's height following (app/material.css). */}
      <span data-two-line={description ? '' : undefined} className={cx('flex w-full items-center gap-3', !!description && 'py-2.5')}>
        <span className="min-w-0 flex-1 whitespace-normal">
          <span className="block">{children}</span>
          {description && <span className="mt-0.5 block text-[13px] font-normal opacity-75">{description}</span>}
        </span>
        {hint && <span className="shrink-0 text-[13px] font-normal opacity-75">{hint}</span>}
      </span>
    </>
  );
}

export function MenuItem({ tone = 'default', className, ...p }: MenuItemBase & { tone?: 'default' | 'danger' }) {
  return (
    <M3eMenuItem
      {...useItemHandlers(p)}
      disabled={!!p.disabled}
      data-tone={tone === 'danger' ? 'danger' : undefined}
      className={className}
    >
      <ItemBody {...p} />
    </M3eMenuItem>
  );
}

/** One of a set of choices; put the set in a MenuGroup. Checked, M3E's selected shape and a check. */
export function MenuItemRadio({ checked, className, ...p }: MenuItemBase & { checked: boolean }) {
  return (
    <M3eMenuItemRadio {...useItemHandlers(p)} checked={checked} disabled={!!p.disabled} className={className}>
      <ItemBody {...p} />
    </M3eMenuItemRadio>
  );
}

export function MenuGroup({ label, children }: { label?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <M3eMenuItemGroup aria-labelledby={label ? id : undefined}>
      {label && <MenuLabel id={id}>{label}</MenuLabel>}
      {children}
    </M3eMenuItemGroup>
  );
}

export function MenuLabel({ id, children }: { id?: string; children: ReactNode }) {
  return <div id={id} role="presentation" className="px-3 pt-2 pb-1 text-[12.5px] font-medium text-ink-3">{children}</div>;
}

export function MenuSeparator() {
  return <M3eDivider className="my-1" />;
}

/**
 * A non-modal floating panel with its own content — a custom date range, a
 * small form. Focus moves in on open; Escape closes and returns it; a press
 * outside or tabbing out closes it.
 *
 * `footer` stays put under the scrolling content, as a Sheet's does: the
 * panel's way out (the Sitzung panel's "Abmelden") is never scrolled out of
 * reach in a short window, with the same hairline once content runs under it.
 */
export function Popover({
  trigger, children, footer, label, labelledBy, placement = 'bottom-start', className, open: openProp, onOpenChange,
}: {
  trigger: (props: TriggerProps, state: { open: boolean }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Fixed below the scrolling content (see Sheet's `footer`). */
  footer?: ReactNode | ((close: () => void) => ReactNode);
  label?: string;
  labelledBy?: string;
  placement?: Placement;
  className?: string;
  /** Controlled open state (optional). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const auto = useId();
  const triggerId = `pop${auto}-trigger`;
  const panelId = `pop${auto}`;
  const [own, setOwn] = useState(false);
  const open = openProp ?? own;
  const triggerRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const style = useAnchoredPosition(triggerRef, panelRef, open, placement);

  const setOpen = useCallback((v: boolean) => {
    if (openProp === undefined) setOwn(v);
    onOpenChange?.(v);
  }, [openProp, onOpenChange]);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
  }, [setOpen]);

  useOutsidePress(open, [triggerRef, panelRef], () => close(false));

  // Focus moves in once the panel is placed (see Menu: hidden can't take
  // focus) — to the safe place, as in a dialog (safeFocusTarget): a panel of
  // settings opens on itself, announced by its name, never on its first
  // radio or switch, where an arrow key or Space would change something.
  const placed = open && style.visibility === 'visible';
  useLayoutEffect(() => {
    if (!placed) return;
    const root = panelRef.current;
    if (!root) return;
    const target = safeFocusTarget(root);
    target.focus({ preventScroll: true });
    if (target !== root) revealInLayer(target, root);
  }, [placed]);

  const triggerProps: TriggerProps = {
    ref: (el) => { triggerRef.current = el; },
    id: triggerId,
    'aria-haspopup': 'dialog',
    'aria-expanded': open,
    'aria-controls': open ? panelId : undefined,
    onClick: () => setOpen(!open),
    onKeyDown: () => {},
  };

  return (
    <>
      {trigger(triggerProps, { open })}
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-modal="false"
          aria-label={labelledBy ? undefined : label}
          aria-labelledby={labelledBy}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              close(true);
            }
          }}
          onBlur={(e) => {
            const next = e.relatedTarget as Node | null;
            if (next && !panelRef.current?.contains(next) && !triggerRef.current?.contains(next)) close(false);
          }}
          style={{ ...style, ...NO_DRAG }}
          className={cx(
            // Opened from the masthead, but a light surface: the page's focus ring.
            'anim-pop z-120 max-w-[calc(100vw-16px)] rounded-[12px] bg-raised text-ink shadow-[var(--shadow-pop)] outline-none [--focus-ring:var(--focus)]',
            // With a footer the panel itself does not scroll: its body does.
            footer ? 'flex flex-col overflow-hidden' : 'overflow-y-auto overscroll-contain p-4',
            className,
          )}
        >
          {footer ? (
            <PopoverBody fit={style.maxHeight} footer={typeof footer === 'function' ? footer(() => close(true)) : footer}>
              {typeof children === 'function' ? children(() => close(true)) : children}
            </PopoverBody>
          ) : typeof children === 'function' ? children(() => close(true)) : children}
        </div>
      )}
    </>
  );
}

/**
 * A Popover's scrolling content and pinned footer. Mounted with the panel;
 * the edge is measured again once the panel is placed and given its height
 * (`fit`), before that frame is painted.
 */
function PopoverBody({ fit, footer, children }: { fit: CSSProperties['maxHeight']; footer: ReactNode; children: ReactNode }) {
  const { ref, edges, measure } = useScrollEdges<HTMLDivElement>();
  useLayoutEffect(measure, [fit, measure]);
  return (
    <>
      <div ref={ref} onScroll={measure} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        {/* One element, so the scroll edge hears the content change size. */}
        <div>{children}</div>
      </div>
      <div className={cx('shrink-0 bg-raised px-4 py-3 transition-shadow duration-150', edges.bottom && FOOTER_EDGE)}>
        {footer}
      </div>
    </>
  );
}
