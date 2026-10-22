// The phone's integrity check (DeviceIntegrity.java), once per start: it
// makes a key in the secure hardware, which takes a moment on a StrongBox
// phone. Runtime observations are a snapshot of this process at start.
//
// On an unsafe phone the user may let Girovo keep its data anyway, past the
// big warning in Gerätesicherheit (components/android/AndroidSettings.tsx).
// That choice is kept in the WebView's storage, never under /data (which such
// a phone refuses to write), for the verdict it was made on; it counts from
// the next start, when the phone server decides whether to load /data.

import { integrityOf, keepsNothing, type DeviceVerdict, type Integrity } from '../../lib/device-integrity.ts';
import { GirovoDevice } from '../native';

/** The verdict the user let Girovo save on despite the warning. */
const CHOICE_KEY = 'girovo.integrity.keepAnyway';

let once: Promise<Integrity | null> | null = null;

function allowedFor(): DeviceVerdict | null {
  try {
    const v = window.localStorage.getItem(CHOICE_KEY);
    return v === 'modified' || v === 'unknown' ? v : null;
  } catch {
    return null;
  }
}

export function integrity(): Promise<Integrity | null> {
  once ??= GirovoDevice.integrity().then((facts) => {
    const result = integrityOf(facts, allowedFor());
    console.info('[GirovoIntegrity]', JSON.stringify({
      device: result.device, copy: result.copy, keepsNothing: keepsNothing(result), savingAllowed: !!result.savingAllowed,
    }));
    return result;
  }, () => null);
  return once;
}

/**
 * Lets Girovo keep its data on this unsafe phone (`verdict`, as the warning
 * showed it), or — null — keep nothing again; then starts the app afresh, so
 * the phone server loads /data or leaves it unread from the first request on.
 * What was saved meanwhile stays on the phone, unread, until saving is allowed again.
 */
export function chooseSaving(verdict: DeviceVerdict | null): void {
  try {
    if (verdict) window.localStorage.setItem(CHOICE_KEY, verdict);
    else window.localStorage.removeItem(CHOICE_KEY);
  } catch {
    return;
  }
  window.location.reload();
}
