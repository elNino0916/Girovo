'use client';

// The machinery under every layer that opens over the page (overlay.tsx,
// floating.tsx): what can take focus, where focus goes on open and on close,
// which layer is topmost, the page behind made inert, and its scroll locked.

import type { RefObject } from 'react';
import { setCaptionDim } from '@/lib/theme';

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
  'textarea:not([disabled]), iframe, audio[controls], video[controls], summary, ' +
  '[contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])';

const isShown = (el: HTMLElement) => el.getClientRects().length > 0 && !el.closest('[inert], [hidden]');

/**
 * In the Tab order: tabindex="-1" leaves a control out of it — the unchecked
 * radios of a roving group (Segmented), the items of a menu. Those take
 * focus from their own keys, never from Tab or from a layer opening.
 */
const isTabbable = (el: HTMLElement) => el.getAttribute('tabindex') !== '-1';

export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => isShown(el) && isTabbable(el));
}

/** A field to type into: typing is never consequential, so a form may open there. Not a checkbox, switch or select. */
const TEXT_FIELD = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"])'
  + ':not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]), textarea, [contenteditable]:not([contenteditable="false"])';

/**
 * Where focus goes when a layer opens: the safe, non-destructive place. One
 * rule for every dialog, drawer, sheet and popover:
 *
 *   1. what the layer names — `initialFocus`, or [data-autofocus] on its safe
 *      button ("Abbrechen", "Weiter warten", "Angemeldet bleiben");
 *      [data-autofocus="fine"] only with a fine pointer — on a touch screen
 *      the layer itself, so no on-screen keyboard covers it on open;
 *   2. else its first field to type into (a form starts where you type);
 *   3. else its own close button (a drawer of details: Enter only closes);
 *   4. else the layer itself, which a screen reader announces by its name.
 *
 * Never a checkbox, a switch, a radio, an external link or an action button
 * by default: the first Space or Enter after opening must not arm a data
 * wipe, shorten the auto-logout, switch update checks off — or start a
 * transfer from a booking's "Erneut überweisen".
 */
export function safeFocusTarget(root: HTMLElement, named?: HTMLElement | null): HTMLElement {
  const usable = (el: HTMLElement | null | undefined): el is HTMLElement => !!el && isShown(el) && !el.matches(':disabled');
  if (usable(named)) return named;
  const marked = root.querySelector<HTMLElement>('[data-autofocus]');
  if (usable(marked)) {
    // data-autofocus="fine": a field worth starting in only where there is a
    // keyboard to type with — the palette's search. On a touch screen it would
    // open the on-screen keyboard over the very list the layer opened to show,
    // so the layer itself takes focus and the field waits for a tap.
    if (marked.dataset.autofocus === 'fine' && coarsePointer()) return root;
    return marked;
  }
  const field = focusablesIn(root).find((el) => el.matches(TEXT_FIELD) && !el.matches(':disabled'));
  if (field) return field;
  const close = root.querySelector<HTMLElement>('[data-dialog-close]');
  if (usable(close)) return close;
  return root;
}

/** A touch screen as the main pointer (a phone, a tablet): focusing a field there opens the on-screen keyboard. */
export const coarsePointer = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

/**
 * Focus was put somewhere with preventScroll (the layer must not jump while
 * it animates in), so a target below the fold of its scrolling body — a
 * dialog's buttons on a short window — is brought into view here, inside the
 * layer only. A focused control nobody can see is a lost place (WCAG 2.4.11).
 */
export function revealInLayer(el: HTMLElement, root: HTMLElement) {
  let scroller = el.parentElement;
  while (scroller && scroller !== root) {
    const overflow = getComputedStyle(scroller).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && scroller.scrollHeight > scroller.clientHeight) break;
    scroller = scroller.parentElement;
  }
  if (!scroller || scroller === root) return;
  const r = el.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  const air = 12;
  if (r.bottom > box.bottom) scroller.scrollTop += r.bottom - box.bottom + air;
  else if (r.top < box.top) scroller.scrollTop -= box.top - r.top + air;
}

/**
 * Moves focus to the first candidate still on the page and showing. A
 * heading or a landmark is given tabindex="-1" on the way, so it can take
 * focus without joining the Tab order. True once focus has moved.
 */
export function focusFirst(candidates: Iterable<HTMLElement | null | undefined>): boolean {
  for (const el of candidates) {
    if (!el?.isConnected || !isShown(el) || el.matches(':disabled')) continue;
    if (!el.matches(FOCUSABLE) && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus();
    if (document.activeElement === el) return true;
  }
  return false;
}

/**
 * The controls just after and just before `el` in the page's Tab order,
 * outside `layer` — the user's place, should `el` itself be gone by the time
 * the layer closes. Read when the layer opens, while `el` is still there.
 */
export function neighboursOf(el: Element | null, layer: HTMLElement): HTMLElement[] {
  if (!(el instanceof HTMLElement) || !el.isConnected) return [];
  const before: HTMLElement[] = [];
  let next: HTMLElement | undefined;
  for (const x of document.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (x === el || el.contains(x) || layer.contains(x) || !isTabbable(x)) continue;
    if (el.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_PRECEDING) before.push(x);
    else if (isShown(x)) {
      next = x;
      break;
    }
  }
  const prev = before.reverse().find(isShown);
  return [next, prev].filter((x): x is HTMLElement => !!x);
}

// Modal layers currently open, innermost last. Only the top one answers
// Escape and Tab, so a confirm over a sheet closes the confirm, not both.
export const layerStack: string[] = [];

/**
 * Everything outside an open layer leaves the accessibility tree and the
 * touch path (`inert`): aria-modal alone is a hint a screen reader on a phone
 * may not honour, and a swipe of TalkBack's would walk out of the sheet into
 * the page behind it. Every sibling on the way from the layer up to <body>
 * is marked, except what is inert already and the live regions that must
 * keep speaking (the toasts, [data-live-outlet]); the returned function gives
 * back exactly what it took, before focus returns to the opener.
 */
export function inertOutside(root: HTMLElement): () => void {
  const marked: Element[] = [];
  for (let node: Element = root; node.parentElement && node !== document.body; node = node.parentElement) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (sibling === node || sibling.hasAttribute('inert')) continue;
      if (sibling.matches('script, style, template, [data-live-outlet], [aria-live], [role="alert"], [role="status"], [role="log"]')) continue;
      sibling.setAttribute('inert', '');
      marked.push(sibling);
    }
  }
  return () => {
    for (const el of marked) el.removeAttribute('inert');
  };
}
export const layerRoots = new Map<string, HTMLElement>();
// The layers that are right-hand drawers (see syncCaptionDim).
export const drawerLayers = new Set<string>();

/**
 * Every layer lays the scrim over the whole page, masthead included — but
 * the desktop shell's caption buttons (components/shell/CaptionButtons.tsx)
 * sit above every layer, where no scrim reaches, and would stay a bright navy block in the darkened
 * bar. So the shell is told how many scrims cover their corner and darkens
 * them to match (lib/theme.ts, CaptionButtons.tsx): every layer above the
 * topmost drawer, whose own navy header sits in that corner undimmed.
 */
export function syncCaptionDim() {
  let n = 0;
  for (let i = layerStack.length - 1; i >= 0 && !drawerLayers.has(layerStack[i]); i--) n++;
  setCaptionDim(n);
}

export type FocusFallback = RefObject<HTMLElement | null> | (() => HTMLElement | null | undefined);

/**
 * Runs once a layer has closed and the page has settled. Focus that has
 * fallen to the body — the element it was to return to went away, often in
 * the very commit that closed the layer: a teaser that disappears once its
 * messages are read, a booking a new category filters out of the list — is
 * put back near the user's place: inside a layer still open, else the
 * caller's fallback, the opener's neighbours, the page's own fallback mark,
 * the page title, the main landmark. Never takes focus from anything that
 * has it (a layer opened on the next tick, a field).
 */
export function recoverFocus(fallback: FocusFallback | undefined, neighbours: HTMLElement[]) {
  const active = document.activeElement;
  if (active && active !== document.body) return;
  const own = typeof fallback === 'function' ? fallback() : fallback?.current;
  const candidates = [
    own,
    ...neighbours,
    document.querySelector<HTMLElement>('[data-focus-fallback]'),
    // shell/ids' PAGE_TITLE_ID: the page's h1 in the top app bar.
    document.getElementById('page-title'),
    document.querySelector<HTMLElement>('main'),
  ];
  const top = layerRoots.get(layerStack[layerStack.length - 1] ?? '');
  if (!top) {
    focusFirst(candidates);
  } else if (!focusFirst(candidates.filter((el) => el && top.contains(el)))) {
    (focusablesIn(top)[0] ?? top).focus({ preventScroll: true });
  }
}

// The page scrolls inside the shell's container, not the window (the window
// is fixed under the desktop caption bar). Locking it means locking that
// container — the shell marks it [data-scroll-root] — and the body as well.
// Counted, so nested layers unlock only when the last one closes; the
// scrollbar's width is padded back in so the page does not jump sideways.
let lockDepth = 0;
let unlockPage: (() => void) | null = null;

export function lockPageScroll() {
  if (lockDepth++ > 0) return;
  const targets = [document.body, ...Array.from(document.querySelectorAll<HTMLElement>('[data-scroll-root]'))];
  const saved = targets.map((el) => {
    const bar = el === document.body
      ? window.innerWidth - document.documentElement.clientWidth
      : el.offsetWidth - el.clientWidth;
    const prev = { overflow: el.style.overflow, paddingRight: el.style.paddingRight };
    const pad = parseFloat(getComputedStyle(el).paddingRight) || 0;
    el.style.overflow = 'hidden';
    if (bar > 0) el.style.paddingRight = `${pad + bar}px`;
    return { el, prev };
  });
  unlockPage = () => {
    for (const { el, prev } of saved) {
      el.style.overflow = prev.overflow;
      el.style.paddingRight = prev.paddingRight;
    }
  };
}

export function unlockPageScroll() {
  if (--lockDepth > 0) return;
  lockDepth = 0;
  unlockPage?.();
  unlockPage = null;
}
