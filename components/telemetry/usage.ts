'use client';

// The page's side of telemetry. The desktop shell decides what goes out
// (electron/telemetry.cjs): errors always, scrubbed; usage events only after
// the user's yes, and only the events and fields it declares. Outside the
// desktop app every call here does nothing.

import { useSyncExternalStore } from 'react';

export type UsageConsent = 'on' | 'off' | 'unasked';

/**
 * What a yes shares, said the same way on the Übersicht tile and at the
 * Sitzung panel's switch.
 */
export const USAGE_DISCLOSURE =
  'Dann erfährt der Entwickler von Girovo, welche Bereiche du nutzt, wie Anmeldungen ausgehen und wie lange ' +
  'deine Bank für Abrufe braucht – mit ihrer Bankleitzahl. Nie dabei: Anmeldename, PIN, IBANs, Salden, Umsätze, ' +
  'Beträge oder Empfänger. Wie bei jeder Verbindung sieht der Server deine IP-Adresse.';

/**
 * The Sitzung panel's switch, where room is short: the gist, and that error
 * reports go regardless. The full account is the Übersicht tile's, where the
 * question is asked.
 */
export const USAGE_SUMMARY = 'Welche Bereiche du nutzt – nie Kontodaten. Fehlerberichte gehen immer.';

/** Error reports need no yes; the user is told so wherever they are asked. */
export const ERROR_REPORTS_NOTE =
  'Fehlerberichte schickt Girovo immer – ohne Kontodaten, Beträge und Namen.';

const listeners = new Set<() => void>();
let cached: UsageConsent | null | undefined;

function read(): UsageConsent | null {
  if (cached === undefined) {
    const t = typeof window === 'undefined' ? undefined : window.electronTelemetry;
    cached = t ? t.consent() : null;
  }
  return cached;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The user's answer to "Nutzungsdaten teilen?" — null outside the desktop app, where nothing is asked. */
export function useUsageConsent(): UsageConsent | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

/** The design preview swaps the bridge per view: forget what was read from the last one. */
export function forgetUsageConsent(): void {
  cached = undefined;
  for (const listener of listeners) listener();
}

export async function setUsageConsent(on: boolean): Promise<void> {
  const t = window.electronTelemetry;
  if (!t) return;
  const answer = await t.setConsent(on).catch(() => null);
  cached = answer ?? (on ? 'on' : 'off');
  for (const listener of listeners) listener();
}

/** A usage event; the shell drops it without the yes or when it is not one it declares. */
export function trackUsage(name: string, props?: Record<string, string | number | boolean>): void {
  if (typeof window === 'undefined') return;
  window.electronTelemetry?.event(name, props);
}

// A component failing in a loop must not flood the reports.
const MAX_ERRORS_PER_PAGE = 20;
let reported = 0;

/** An unexpected failure in the page. Always reported; the shell scrubs it. */
export function reportClientError(err: unknown): void {
  const t = typeof window === 'undefined' ? undefined : window.electronTelemetry;
  if (!t || reported >= MAX_ERRORS_PER_PAGE) return;
  reported++;
  const e = (err && typeof err === 'object' ? err : { message: String(err) }) as { name?: unknown; message?: unknown; stack?: unknown };
  t.error({
    name: typeof e.name === 'string' ? e.name : 'Error',
    message: typeof e.message === 'string' ? e.message : '',
    stack: typeof e.stack === 'string' ? e.stack : '',
  });
}
