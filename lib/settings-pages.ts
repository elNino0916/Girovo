// Einstellungen' pages (6.0, sorted anew in Girovo Next on 2026-11-14): the
// categories the settings are sorted into, one shown at a time. On a phone a
// list of them opens each as a page of its own, as Android's settings do; on
// the desktop the sidebar picks one.
//
//   ask            Girovo AI: asking on or off, what answers, the model
//   api            Girovo API: nothing yet, a line that it comes later
//
//   security       Sicherheit & Datenschutz: Anmeldung (fingerprint, Windows
//                  Hello, security keys, further banks with the first, the
//                  automatic logout), Dieses Gerät (the phone's check, the
//                  remembered device), Was das Gerät verlässt (company logos,
//                  usage data)
//   notifications  Benachrichtigungen: "Neue Umsätze melden" and what it says
//
//   accounts       Umsätze & Kategorien: Beim Anmelden abrufen (balances,
//                  Umsätze), Auf diesem Gerät behalten (balances, Umsätze, the
//                  import), Kategorien
//   devices        Daten & Sicherung: Abgleich (the sync), Sicherung (the
//                  backup), Gespeicherte Daten (what is kept here, what cannot
//                  be read, resetting it all)
//
//   appearance     Sprache & Darstellung
//   updates        Updates: Google Play's update, the channel, staged releases
//                  at once, an update from a file; only in a build that has one
//                  of them (hasUpdateRows)
//   about          Über Girovo: the version and the update's state, the
//                  contact links, the legal pages
//
// The search opens one setting (SettingsTarget): its page is PAGE_OF it.
// Before 2026-11-14 there was a page 'privacy' (Datenschutz): its switches are
// on 'security' now, and a page named by its old id opens there (pageFrom).
//
// Pure: no path aliases, `.ts` on sibling imports.

import type { SettingsTarget } from './app-types.ts';

export type SettingsPage =
  | 'ask' | 'api' | 'security' | 'notifications' | 'accounts' | 'devices' | 'appearance' | 'updates' | 'about';

/**
 * The list's order, in the clusters a phone draws apart: Girovo AI and its API
 * first (owner, 2026-11-11, Girovo Next); how you get in and are told; what is
 * kept; the app itself.
 */
export const PAGE_CLUSTERS: readonly (readonly SettingsPage[])[] = [
  ['ask', 'api'],
  ['security', 'notifications'],
  ['accounts', 'devices'],
  ['appearance', 'updates', 'about'],
];

export const PAGE_ORDER: readonly SettingsPage[] = PAGE_CLUSTERS.flat();

/** The page each setting the search can open lives on. */
export const PAGE_OF: Record<SettingsTarget, SettingsPage> = {
  idle: 'security',
  device: 'security',
  logos: 'security',
  usage: 'security',
  alerts: 'notifications',
  loginBalances: 'accounts',
  loginBookings: 'accounts',
  keepBalances: 'accounts',
  keep: 'accounts',
  categories: 'accounts',
  data: 'devices',
  backup: 'devices',
  language: 'appearance',
  theme: 'appearance',
  black: 'appearance',
  ask: 'ask',
  // The update's state and "Nach Updates suchen" stay in Über Girovo's head.
  updates: 'about',
  channel: 'updates',
  early: 'updates',
  fromFile: 'updates',
};

/** Pages that are gone, and where their settings are now. */
const MOVED: Readonly<Record<string, SettingsPage>> = {
  privacy: 'security',
};

export const isSettingsPage = (v: unknown): v is SettingsPage => typeof v === 'string' && (PAGE_ORDER as readonly string[]).includes(v);

/** A page named somewhere else (a link, the preview's ?page=): its page today, an old id's new home, else null. */
export function pageFrom(v: unknown): SettingsPage | null {
  if (isSettingsPage(v)) return v;
  return typeof v === 'string' && Object.hasOwn(MOVED, v) ? MOVED[v] : null;
}

/**
 * Whether the Updates page has a row: the updater's (the desktop app, the
 * GitHub APK: Update-Kanal, and with it the others that need it), or Google
 * Play's while Play has a newer version (the Play build). F-Droid has neither.
 */
export function hasUpdateRows(build: { updater: boolean; playUpdate: boolean }): boolean {
  return build.updater || build.playUpdate;
}
