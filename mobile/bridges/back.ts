// Android's back gesture, mapped onto what the page already does with Escape.
//
// Every layer (dialog, sheet, drawer, menu) closes on Escape, topmost first
// (components/ui.tsx), and so do the search lists (the bank picker), so back
// sends Escape to whatever has focus first; a component that took it says so
// with preventDefault(). With nothing to close, the page gets a "girovo:back"
// event of its own (FintsProvider: from Analyse or Verträge back to the
// Übersicht, from the login form back to the bank list); when nothing takes
// that either, the app goes to the background, as Android's back does at an
// app's root. The session stays as it is: logging out is a decision, not a
// gesture.
//
// Predictive back (Android 14 and later): while a layer is open the gesture
// is the page's (DevicePlugin.setBackLayer), and the topmost sheet follows it
// the way Material's sheets do — it shrinks towards its anchored edge as the
// finger moves, springs back if the gesture is let go, and closes when it
// completes. Before Android 14 the gesture comes only as its end.

import { App } from '@capacitor/app';
import { BACK_EVENT } from '../../lib/client-api.ts';
import { GirovoDevice } from '../native';

/** Something the back gesture should close: a modal layer, a menu, a listbox. */
const LAYER = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

function openLayers(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(LAYER)).filter((el) => el.getClientRects().length > 0);
}

/**
 * Escape to whatever has focus — or, when focus has left the topmost layer
 * (a tap on its plain text moves it to <body>), to that layer itself, which
 * closes on Escape only from within. True when something took it.
 */
function sendEscape(): boolean {
  const layers = openLayers();
  const top = layers[layers.length - 1];
  const focused = document.activeElement as HTMLElement | null;
  const target = top && !(focused && top.contains(focused)) ? top : (focused ?? document.body);
  const init = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true } as KeyboardEventInit;
  const taken = !target.dispatchEvent(new KeyboardEvent('keydown', init));
  target.dispatchEvent(new KeyboardEvent('keyup', init));
  return taken;
}

function back(): void {
  // A layer that closes on Escape without saying so still counts as closed.
  const open = openLayers().length > 0;
  if (sendEscape() || open) return;
  const event = new Event(BACK_EVENT, { cancelable: true });
  if (!window.dispatchEvent(event)) return; // the page went somewhere
  void App.minimizeApp();
}

/**
 * What follows the gesture: the topmost layer's sheet or drawer, and the
 * edge it is anchored to. A menu or a list just closes at the end.
 */
function surface(): { el: HTMLElement; anchor: 'bottom' | 'right' | 'center' } | null {
  const layers = openLayers();
  const top = layers[layers.length - 1];
  if (!top || (top.getAttribute('role') !== 'dialog' && top.getAttribute('role') !== 'alertdialog')) return null;
  const drawer = top.matches('.anim-drawer') ? top : top.querySelector<HTMLElement>('.anim-drawer');
  if (drawer) return { el: drawer, anchor: 'right' };
  const panel = top.querySelector<HTMLElement>('[data-panel]');
  if (panel) return { el: panel, anchor: 'center' };
  const sheet = top.matches('[data-sheet]') ? top : top.querySelector<HTMLElement>('[data-sheet]');
  if (!sheet) return null;
  return { el: sheet, anchor: sheet.matches('[data-dialog="basic"]') || window.innerWidth >= 640 ? 'center' : 'bottom' };
}

let following: { el: HTMLElement; anchor: 'bottom' | 'right' | 'center' } | null = null;

function follow(progress: number, edge: 'left' | 'right'): void {
  following ??= surface();
  if (!following) return;
  const { el, anchor } = following;
  // Material's predictive back: down to 90 % of its size, towards the edge it hangs from.
  const p = Math.min(1, Math.max(0, progress));
  el.style.transition = 'none';
  el.style.transformOrigin = anchor === 'bottom' ? '50% 100%' : anchor === 'right' ? '100% 50%' : '50% 50%';
  el.style.scale = String(1 - 0.1 * p);
  el.style.translate = anchor === 'center' ? `${(edge === 'left' ? 1 : -1) * 8 * p}px 0` : '';
}

function release(): void {
  if (!following) return;
  const { el } = following;
  following = null;
  el.style.transition = 'scale 0.25s cubic-bezier(0.2, 0, 0, 1), translate 0.25s cubic-bezier(0.2, 0, 0, 1)';
  el.style.scale = '';
  el.style.translate = '';
}

export function installBack(): void {
  void App.addListener('backButton', back);

  // The gesture is the page's while something is open to close.
  let held = false;
  let frame = 0;
  const sync = () => {
    frame = 0;
    const open = openLayers().length > 0;
    if (open === held) return;
    held = open;
    void GirovoDevice.setBackLayer({ open }).catch(() => {});
  };
  // The root, not <body>: the runtime runs in <head>, before there is a body.
  new MutationObserver(() => {
    frame ||= requestAnimationFrame(sync);
  }).observe(document.documentElement, { childList: true, subtree: true });

  void GirovoDevice.addListener('backProgress', (e) => follow(e.progress, e.edge));
  void GirovoDevice.addListener('backCancelled', release);
  void GirovoDevice.addListener('backInvoked', () => {
    const was = following;
    back();
    // A layer that stays (one that cannot be dismissed) springs back.
    requestAnimationFrame(() => {
      if (was?.el.isConnected) release();
      else following = null;
    });
  });
}
