'use client';

// The terms of use (girovo.de/nutzungsbedingungen, girovo-website
// pages/terms.vue): agreed to once, at the first start, before a bank is
// chosen — and once more by a copy that was in use before there were any
// (owner, 2026-11-10), which is the same case: nothing stored yet.
//
// What is stored is the version agreed to. Raising TERMS_VERSION asks
// everyone again; do that only for a change people must agree to (§ 14 of the
// terms), together with the date on the website's page.
//
// A preference like the theme (lib/client-api.ts `store`): per device, gone
// with "Girovo zurücksetzen", never in the vault or a backup.

import { useSyncExternalStore } from 'react';
import { store } from './client-api';

export const TERMS_KEY = 'fints.terms';
export const TERMS_VERSION = '2026-11-10';

const listeners = new Set<() => void>();
/** The design preview's answer in place of the stored one (app/design-preview). */
let preview: boolean | null = null;
let cached: boolean | undefined;

function read(): boolean {
  if (preview !== null) return preview;
  if (cached === undefined) cached = store.get(TERMS_KEY) === TERMS_VERSION;
  return cached;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const tell = () => {
  for (const listener of listeners) listener();
};

/** Whether this copy has agreed to the current terms. Null on the server and until the page knows. */
export function useTermsAccepted(): boolean | null {
  return useSyncExternalStore<boolean | null>(subscribe, read, () => null);
}

/** The yes: stored, and every screen that waited for it goes on. */
export function acceptTerms(): void {
  store.set(TERMS_KEY, TERMS_VERSION);
  cached = true;
  if (preview !== null) preview = true;
  tell();
}

/** The design preview: agreed (its screens are past this step) or asked. Null: as stored. */
export function setTermsPreview(accepted: boolean | null): void {
  if (preview === accepted) return;
  preview = accepted;
  tell();
}
