'use client';

// The page's side of telemetry. The desktop shell decides what goes out
// (src-tauri/src/telemetry.rs; mobile/telemetry/telemetry.cjs on the phone): errors always, scrubbed; usage events only after
// the user's yes, and only the events and fields it declares. Outside the
// desktop app every call here does nothing.

import { useSyncExternalStore } from 'react';
import { store } from '@/lib/client-api';

export type UsageConsent = 'on' | 'off' | 'unasked';

// What a yes shares, and that error reports need none, are said where the
// question is asked (lib/i18n/messages/auth.ts, `usage`); the Sitzung panel's
// switch has its own short line (lib/i18n/messages/session.ts).

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

/**
 * Set while the yes was given by choosing the Nightly channel, not by the
 * switch or the question: that yes ends with the channel (the privacy policy
 * says so), one the user gave on their own does not.
 */
const VIA_CHANNEL_KEY = 'fints.usage.viaChannel';

/** Whether the consent in force came with the Nightly channel. */
export function usageCameWithChannel(): boolean {
  return store.get(VIA_CHANNEL_KEY) === '1';
}

/** `viaChannel`: this yes is part of choosing Nightly. Any other answer is the user's own and stands by itself. */
export async function setUsageConsent(on: boolean, viaChannel = false): Promise<void> {
  const t = window.electronTelemetry;
  if (!t) return;
  if (on && viaChannel) store.set(VIA_CHANNEL_KEY, '1');
  else store.del(VIA_CHANNEL_KEY);
  const answer = await t.setConsent(on).catch(() => null);
  cached = answer ?? (on ? 'on' : 'off');
  for (const listener of listeners) listener();
}

/** A usage event; the shell drops it without the yes or when it is not one it declares. */
export function trackUsage(name: string, props?: Record<string, string | number | boolean>): void {
  if (typeof window === 'undefined') return;
  window.electronTelemetry?.event(name, props);
}

// A component failing in a loop must not flood the reports: the same error
// (name and message) goes out once per page, and at most this many in all —
// so one repeating failure cannot use up the reports a different one needs.
const MAX_ERRORS_PER_PAGE = 20;
let reported = 0;
const alreadyReported = new Set<string>();

/** An unexpected failure in the page. Always reported; the shell scrubs it. */
export function reportClientError(err: unknown): void {
  const t = typeof window === 'undefined' ? undefined : window.electronTelemetry;
  if (!t || reported >= MAX_ERRORS_PER_PAGE) return;
  const e = (err && typeof err === 'object' ? err : { message: String(err) }) as { name?: unknown; message?: unknown; stack?: unknown };
  const name = typeof e.name === 'string' ? e.name : 'Error';
  const message = typeof e.message === 'string' ? e.message : '';
  const key = `${name}\n${message}`;
  if (alreadyReported.has(key)) return;
  alreadyReported.add(key);
  reported++;
  t.error({ name, message, stack: typeof e.stack === 'string' ? e.stack : '' });
}
