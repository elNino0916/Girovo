// Einstellungen' pages (6.0): the categories the settings are sorted into,
// one shown at a time — on a phone a list of them opens each as a page of its
// own, as Android's settings do; on the desktop the sidebar picks one.
//
//   security       Anmeldung & Sicherheit — unlocking (fingerprint, Windows
//                  Hello, the further banks with the first), the automatic
//                  logout, what the phone's check found, the remembered device
//   notifications  Benachrichtigungen — "Neue Umsätze melden" and what it says
//   accounts       Konten & Umsätze — the balances and Umsätze kept and read,
//                  the import, the categories
//   devices        Daten & Geräte — the sync, the backup, what is kept here,
//                  and resetting it all
//   appearance     Sprache & Darstellung (on Android: Sprache)
//   privacy        Datenschutz — what can leave the device besides the bank's traffic
//   ask            Frag deine Umsätze (Girovo Next) — asking on or off, where the
//                  answers come from, their language
//   about          Über Girovo — updates, the version, the links
//
// The search opens one setting (SettingsTarget): its page is PAGE_OF it.
//
// Pure: no path aliases, `.ts` on sibling imports.

import type { SettingsTarget } from './app-types.ts';

export type SettingsPage = 'security' | 'notifications' | 'accounts' | 'devices' | 'appearance' | 'privacy' | 'ask' | 'about';

/**
 * The list's order, in the clusters a phone draws apart: Girovo AI first, on
 * its own (owner, 2026-11-11, Girovo Next); how you get in and are told; what is
 * kept; the app itself.
 */
export const PAGE_CLUSTERS: readonly (readonly SettingsPage[])[] = [
  ['ask'],
  ['security', 'notifications'],
  ['accounts', 'devices', 'privacy'],
  ['appearance', 'about'],
];

export const PAGE_ORDER: readonly SettingsPage[] = PAGE_CLUSTERS.flat();

/** The page each setting the search can open lives on. */
export const PAGE_OF: Record<SettingsTarget, SettingsPage> = {
  idle: 'security',
  device: 'security',
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
  logos: 'privacy',
  usage: 'privacy',
  ask: 'ask',
  updates: 'about',
  channel: 'about',
  early: 'about',
  fromFile: 'about',
};

export const isSettingsPage = (v: unknown): v is SettingsPage => typeof v === 'string' && (PAGE_ORDER as readonly string[]).includes(v);
