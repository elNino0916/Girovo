'use client';

/** Whether this shell has the Girovo API at all (window.electronGirovoApi): the desktop app, or the design preview's fake. */
export const hasApiBridge = (): boolean => typeof window !== 'undefined' && !!window.electronGirovoApi;

/**
 * Brings Girovo's window to the front for something the user must answer (a
 * consent dialog, a transfer request, the bank's Freigabe for an app's
 * refresh): the shell's focus where it has one (phase 2), which flashes the
 * taskbar itself when Windows keeps the window behind; else the taskbar
 * button flashes until Girovo is in front.
 */
export function bringForward(): void {
  if (typeof window === 'undefined') return;
  const focus = window.electronGirovoApi?.focus;
  if (focus) {
    void focus().catch(() => window.electronWindow?.requestAttention(true));
    return;
  }
  window.electronWindow?.requestAttention(true);
}
