// How long a toast stays (components/Toasts.tsx), apart from the DOM.
//
// A toast's clock only runs while someone could be reading it: Toasts.tsx
// stops it while the pointer or the keyboard is on it, while the window is in
// the background and while it is not the focused window. This decides how
// long that running time is:
//
// - at least as long as the provider asked for (a notice after an idle
//   logout asks for ten minutes);
// - long enough to read: a bank's error is often two sentences, and it must
//   not vanish while the user glances at the phone;
// - an error longer than a notice, and a toast with an action longer still:
//   someone has to read it, decide, and reach the button.

export type ToastTiming = {
  tone: 'info' | 'error' | 'success';
  /** What the provider asked for. */
  ms: number;
  message: string;
  hasAction: boolean;
};

/** The shortest life of a toast of each tone. */
export const MIN_MS = { info: 4200, success: 4200, error: 10_000 } as const;
/** …and of one that offers an action, which someone has to reach in time. */
export const MIN_ACTION_MS = 12_000;
export const MIN_ERROR_ACTION_MS = 20_000;
/** A slow, careful reader: about 15 characters a second, plus a moment to look over. */
export const READ_MS_PER_CHAR = 65;
export const LOOK_MS = 1500;

/** Milliseconds of running time before the toast leaves. */
export function toastLifetime({ tone, ms, message, hasAction }: ToastTiming): number {
  const floor = hasAction
    ? tone === 'error' ? MIN_ERROR_ACTION_MS : MIN_ACTION_MS
    : MIN_MS[tone] ?? MIN_MS.info;
  const reading = LOOK_MS + [...message.trim()].length * READ_MS_PER_CHAR;
  return Math.max(Number.isFinite(ms) ? ms : 0, floor, reading);
}
