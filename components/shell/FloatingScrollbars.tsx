'use client';

// Floating scrollbars (6.0, the desktop; owner's pick "D" of the mockups in
// .impeccable/mocks/scrollbar/): no native bar and no gutter — Windows'
// classic 15px bar with its arrows and grey channel cut into the sheets'
// round corners. Instead a thin thumb is drawn over the content of whatever
// scrolls, as the phone does: it shows while that scroller moves, or while
// the mouse is near its edge (wider then), turns Girovo blue while dragged,
// and fades a second later. A scroller that goes — the search closing, a
// drawer — takes its thumb with it at once, not a second later.
//
// One module for every scroller in the app — the page, the sidebar, sheets,
// dialogs, the search — without any of them taking part: scrolling is found
// by a capturing scroll listener, the edge by the pointer. The thumbs are
// fixed-position elements on the body above everything (the overlays render
// in place, none in the browser's top layer), placed from the scroller's box
// each time they show. The native bars are hidden by CSS under
// `:root[data-scrollbars='float']` (app/globals.css); scrolling itself — the
// wheel, the keyboard, touch, a screen reader — is the browser's, untouched.
//
// Android keeps its own overlay bars: nothing is installed there.

import { useEffect } from 'react';
import { IS_ANDROID } from '@/lib/platform';

/** How long a thumb stays after the last movement. */
const HIDE_MS = 1000;
/** How near the edge the mouse wakes a thumb. */
const EDGE = 16;
/** The thumb's distance from the scroller's edge, and from its ends. */
const INSET = 4;
const END = 8;
const MIN = 32;

type Axis = 'y' | 'x';
type Bar = {
  el: HTMLElement;
  axis: Axis;
  thumb: HTMLDivElement;
  timer: number;
  hover: boolean;
  drag: boolean;
};

export function FloatingScrollbars() {
  useEffect(() => (IS_ANDROID ? undefined : install()), []);
  return null;
}

const page = () => document.scrollingElement as HTMLElement | null;

/** Whether `el` scrolls along `axis` (and has somewhere to go). */
function scrolls(el: Element, axis: Axis): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const more = axis === 'y' ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
  if (more <= 1) return false;
  if (el === page()) return true;
  const o = getComputedStyle(el)[axis === 'y' ? 'overflowY' : 'overflowX'];
  return o === 'auto' || o === 'scroll';
}

/** The scroller's visible box: the window's for the page itself. */
function boxOf(el: HTMLElement): { top: number; left: number; right: number; bottom: number } {
  if (el === page()) return { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight };
  const r = el.getBoundingClientRect();
  // Within its borders: a sheet's outline is not where the thumb runs.
  return { top: r.top + el.clientTop, left: r.left + el.clientLeft, right: r.left + el.clientLeft + el.clientWidth, bottom: r.top + el.clientTop + el.clientHeight };
}

function install(): () => void {
  const root = document.documentElement;
  root.dataset.scrollbars = 'float';
  const bars = new Map<HTMLElement, Partial<Record<Axis, Bar>>>();
  let near: Bar | null = null;

  const place = (bar: Bar) => {
    const { el, axis, thumb } = bar;
    const box = boxOf(el);
    if (axis === 'y') {
      const track = box.bottom - box.top - END * 2;
      const size = Math.max(MIN, (track * el.clientHeight) / el.scrollHeight);
      const max = el.scrollHeight - el.clientHeight;
      const at = max > 0 ? (el.scrollTop / max) * (track - size) : 0;
      thumb.style.top = `${box.top + END + at}px`;
      thumb.style.height = `${size}px`;
      thumb.style.right = `${window.innerWidth - box.right + INSET}px`;
    } else {
      const track = box.right - box.left - END * 2;
      const size = Math.max(MIN, (track * el.clientWidth) / el.scrollWidth);
      const max = el.scrollWidth - el.clientWidth;
      const at = max > 0 ? (Math.abs(el.scrollLeft) / max) * (track - size) : 0;
      thumb.style.left = `${box.left + END + at}px`;
      thumb.style.width = `${size}px`;
      thumb.style.bottom = `${window.innerHeight - box.bottom + INSET}px`;
    }
  };

  const hide = (bar: Bar) => {
    // Its scroller has gone (a drawer closed): so does the thumb.
    if (!bar.el.isConnected) return drop(bar);
    if (bar.drag || bar.hover || near === bar) return;
    delete bar.thumb.dataset.on;
    delete bar.thumb.dataset.near;
  };

  const show = (bar: Bar) => {
    if (!bar.el.isConnected) return drop(bar);
    place(bar);
    bar.thumb.dataset.on = '';
    window.clearTimeout(bar.timer);
    bar.timer = window.setTimeout(() => hide(bar), HIDE_MS);
  };

  const drop = (bar: Bar) => {
    window.clearTimeout(bar.timer);
    bar.thumb.remove();
    const both = bars.get(bar.el);
    if (both) {
      delete both[bar.axis];
      if (!both.x && !both.y) bars.delete(bar.el);
    }
    if (near === bar) near = null;
  };

  /** Every thumb whose scroller has left the page. */
  const sweep = () => {
    for (const [el, both] of [...bars]) if (!el.isConnected) for (const bar of Object.values(both)) if (bar) drop(bar);
  };

  const barFor = (el: HTMLElement, axis: Axis): Bar => {
    if (!bars.has(el)) sweep();
    const both = bars.get(el) ?? {};
    const had = both[axis];
    if (had) return had;
    const thumb = document.createElement('div');
    thumb.className = 'float-thumb';
    thumb.dataset.axis = axis;
    thumb.setAttribute('aria-hidden', 'true');
    document.body.appendChild(thumb);
    const bar: Bar = { el, axis, thumb, timer: 0, hover: false, drag: false };
    both[axis] = bar;
    bars.set(el, both);

    thumb.addEventListener('pointerenter', () => {
      bar.hover = true;
      thumb.dataset.near = '';
      show(bar);
    });
    thumb.addEventListener('pointerleave', () => {
      bar.hover = false;
      show(bar);
    });
    // Dragged, the thumb moves the scroller as a native one does.
    thumb.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      thumb.setPointerCapture(e.pointerId);
      bar.drag = true;
      thumb.dataset.drag = '';
      const start = axis === 'y' ? e.clientY : e.clientX;
      const from = axis === 'y' ? el.scrollTop : el.scrollLeft;
      const box = boxOf(el);
      const track = axis === 'y' ? box.bottom - box.top - END * 2 : box.right - box.left - END * 2;
      const size = axis === 'y' ? thumb.offsetHeight : thumb.offsetWidth;
      const range = axis === 'y' ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
      const ratio = range / Math.max(1, track - size);
      const move = (ev: PointerEvent) => {
        const d = ((axis === 'y' ? ev.clientY : ev.clientX) - start) * ratio;
        if (axis === 'y') el.scrollTop = from + d;
        else el.scrollLeft = from + d;
      };
      const up = () => {
        bar.drag = false;
        delete thumb.dataset.drag;
        thumb.removeEventListener('pointermove', move);
        thumb.removeEventListener('pointerup', up);
        thumb.removeEventListener('pointercancel', up);
        show(bar);
      };
      thumb.addEventListener('pointermove', move);
      thumb.addEventListener('pointerup', up);
      thumb.addEventListener('pointercancel', up);
    });
    return bar;
  };

  // Whatever scrolls shows its thumb.
  const onScroll = (e: Event) => {
    const el = e.target === document ? page() : e.target;
    if (!(el instanceof HTMLElement)) return;
    for (const axis of ['y', 'x'] as const) {
      const had = bars.get(el)?.[axis];
      if (had || scrolls(el, axis)) show(had ?? barFor(el, axis));
    }
  };

  // The mouse near a scroller's edge wakes its thumb, wider, as a target to grab.
  let frame = 0;
  let pointer: { x: number; y: number } | null = null;
  const findNear = () => {
    frame = 0;
    if (!pointer) return;
    const { x, y } = pointer;
    let found: Bar | null = null;
    const under = document.elementFromPoint(x, y);
    if (under && !(under as HTMLElement).classList?.contains('float-thumb')) {
      for (let n: Element | null = under; n && !found; n = n === root ? null : n.parentElement ?? page()) {
        for (const axis of ['y', 'x'] as const) {
          if (!scrolls(n, axis)) continue;
          const box = boxOf(n);
          const gap = axis === 'y' ? box.right - x : box.bottom - y;
          if (gap >= 0 && gap <= EDGE) {
            found = barFor(n, axis);
            break;
          }
        }
        if (n === page()) break;
      }
    }
    if (near && near !== found) {
      const was = near;
      near = null;
      if (!was.el.isConnected) drop(was);
      else {
        if (!was.hover) delete was.thumb.dataset.near;
        show(was);
      }
    }
    if (found) {
      near = found;
      found.thumb.dataset.near = '';
      show(found);
    }
  };
  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.buttons) return;
    pointer = { x: e.clientX, y: e.clientY };
    if (!frame) frame = requestAnimationFrame(findNear);
  };
  const onLeave = () => {
    pointer = null;
    if (near) {
      const was = near;
      near = null;
      if (!was.el.isConnected) drop(was);
      else {
        delete was.thumb.dataset.near;
        show(was);
      }
    }
  };
  // A scroller that leaves the page or is hidden (the search closed, a dialog
  // gone) takes its thumb at once, with no fade: the thumb is not left
  // floating over what is behind for a second.
  let vanishFrame = 0;
  const vanish = () => {
    vanishFrame = 0;
    for (const both of [...bars.values()]) {
      for (const bar of Object.values(both)) {
        if (!bar) continue;
        if (!bar.el.isConnected) drop(bar);
        else if (bar.thumb.dataset.on !== undefined && bar.el !== page() && bar.el.getClientRects().length === 0) {
          window.clearTimeout(bar.timer);
          bar.thumb.style.transition = 'none';
          delete bar.thumb.dataset.on;
          delete bar.thumb.dataset.near;
          void bar.thumb.offsetWidth;
          bar.thumb.style.transition = '';
        }
      }
    }
  };
  const watcher = new MutationObserver((records) => {
    // The thumbs' own coming and going is no news.
    if (records.every((r) => r.target instanceof HTMLElement && r.target.classList.contains('float-thumb'))) return;
    if (bars.size && !vanishFrame) vanishFrame = requestAnimationFrame(vanish);
  });
  watcher.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'open'] });

  // The window resized: what shows moves with it.
  const onResize = () => {
    sweep();
    for (const both of bars.values()) for (const bar of Object.values(both)) if (bar?.thumb.dataset.on !== undefined) show(bar);
  };

  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.documentElement.addEventListener('pointerleave', onLeave);
  window.addEventListener('resize', onResize);
  return () => {
    document.removeEventListener('scroll', onScroll, { capture: true });
    document.removeEventListener('pointermove', onPointerMove);
    document.documentElement.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('resize', onResize);
    watcher.disconnect();
    cancelAnimationFrame(frame);
    cancelAnimationFrame(vanishFrame);
    for (const both of [...bars.values()]) for (const bar of Object.values(both)) if (bar) drop(bar);
    delete root.dataset.scrollbars;
  };
}
