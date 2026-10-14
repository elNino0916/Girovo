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

import { App } from '@capacitor/app';
import { BACK_EVENT } from '../../lib/client-api.ts';

/** Something the back gesture should close: a modal layer, a menu, a listbox. */
const LAYER = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

function layerOpen(): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>(LAYER)).some((el) => el.getClientRects().length > 0);
}

/** Escape to whatever has focus. True when something took it. */
function sendEscape(): boolean {
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  const init = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true } as KeyboardEventInit;
  const taken = !target.dispatchEvent(new KeyboardEvent('keydown', init));
  target.dispatchEvent(new KeyboardEvent('keyup', init));
  return taken;
}

export function installBack(): void {
  void App.addListener('backButton', () => {
    // A layer that closes on Escape without saying so still counts as closed.
    const open = layerOpen();
    if (sendEscape() || open) return;
    const event = new Event(BACK_EVENT, { cancelable: true });
    if (!window.dispatchEvent(event)) return; // the page went somewhere
    void App.minimizeApp();
  });
}
