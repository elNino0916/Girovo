'use client';

// Darstellung: Hell, Dunkel or System.
//
// The pre-paint script in app/layout.tsx resolves the stored choice before
// the first frame and writes it to <html> — data-theme (what the CSS reads)
// and data-theme-pref (what the Darstellung control shows). This module owns
// every change after that: a choice from the menu, the OS flipping between
// light and dark while "System" is chosen, another tab changing the setting.
// The attribute on <html> stays the one source of truth the page renders
// from, so a component never holds a copy of the theme that could go stale.
//
// The desktop shell draws its own caption buttons next to the masthead in
// colours it is told about (electron/main.cjs, BAR_COLORS); every path that
// changes the theme tells it too, or the buttons would sit in a navy block
// on a navy-black bar — or the other way round. The same goes for a dialog's
// scrim, which darkens the masthead but cannot reach the OS-drawn buttons:
// the Overlay reports how many scrims cover their corner (setCaptionDim), and
// the shell darkens the buttons to match.

import { store } from './client-api';

export type ThemePref = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

export const THEME_KEY = 'fints.theme';
const CHANGE_EVENT = 'fints:theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

export const isThemePref = (v: unknown): v is ThemePref => v === 'light' || v === 'dark' || v === 'system';

/** The stored choice. Missing or unreadable means "System". */
export function getThemePref(): ThemePref {
  const v = store.get(THEME_KEY);
  return isThemePref(v) ? v : 'system';
}

function systemIsDark(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

/** What a choice looks like right now. */
export function resolveTheme(pref: ThemePref = getThemePref()): Theme {
  if (pref === 'system') return systemIsDark() ? 'dark' : 'light';
  return pref;
}

/** How many dialog scrims lie over the caption buttons' corner right now. */
let captionDim = 0;
const MAX_CAPTION_DIM = 3;

function tellShell(theme: Theme): void {
  try {
    window.electronTitleBar?.setTheme(theme === 'dark', captionDim);
  } catch {
    /* the bridge is best effort — a stale caption colour is not worth a crash */
  }
}

/**
 * Called by the Overlay (components/ui.tsx) whenever a modal layer opens or
 * closes: how many scrims now lie over the top-right corner, where the desktop
 * shell's caption buttons sit. A no-op outside the shell.
 */
export function setCaptionDim(layers: number): void {
  const n = Math.min(Math.max(Math.floor(layers) || 0, 0), MAX_CAPTION_DIM);
  if (n === captionDim) return;
  captionDim = n;
  if (typeof document === 'undefined') return;
  tellShell(appliedTheme());
}

/**
 * Puts a choice on the page: resolves it, writes both attributes, recolours
 * the shell's caption buttons and tells subscribers. Returns what was applied.
 */
export function applyTheme(pref: ThemePref = getThemePref()): Theme {
  const theme = resolveTheme(pref);
  if (typeof document === 'undefined') return theme;
  const root = document.documentElement;
  const changed = root.dataset.theme !== theme || root.dataset.themePref !== pref;

  if (root.dataset.theme !== theme) {
    // Every tile, pill and field has a colour transition for its hover state;
    // without this the whole app would cross-fade for 200 ms on a switch.
    root.dataset.themeSwitching = '';
    requestAnimationFrame(() => requestAnimationFrame(() => delete root.dataset.themeSwitching));
  }
  root.dataset.theme = theme;
  root.dataset.themePref = pref;
  // With the current dim: switching the theme from inside a dialog (the
  // command palette offers it) keeps the buttons as dark as the bar.
  tellShell(theme);
  if (changed) window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  return theme;
}

/** Stores a choice and applies it. */
export function setThemePref(pref: ThemePref): void {
  // 'system' is stored explicitly rather than deleted: the shell store is read
  // before localStorage, and an absent shell value would let a stale
  // localStorage copy from an older version win on the next start.
  store.set(THEME_KEY, pref);
  applyTheme(pref);
}

/** The choice as currently applied to the page (cheap; for render). */
export function appliedThemePref(): ThemePref {
  if (typeof document === 'undefined') return 'system';
  const v = document.documentElement.dataset.themePref;
  return isThemePref(v) ? v : 'system';
}

/** The theme as currently applied to the page (cheap; for render). */
export function appliedTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/**
 * Called whenever the applied theme or choice changes, from any cause.
 * Shaped for useSyncExternalStore.
 */
export function subscribeTheme(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

/**
 * Follows the OS while the choice is "System", and the stored choice when
 * another window of this origin changes it. Installed once per page, from the
 * first import of this module — the Darstellung control is not on every
 * screen, and the page must keep following the OS regardless. Idempotent
 * across hot reloads through a flag on window.
 */
function installListeners(): void {
  if (typeof window === 'undefined') return;
  const w = window as Window & { __fintsThemeListeners?: boolean };
  if (w.__fintsThemeListeners) return;
  w.__fintsThemeListeners = true;

  try {
    window.matchMedia(DARK_QUERY).addEventListener('change', () => {
      if (appliedThemePref() === 'system') applyTheme('system');
    });
  } catch {
    /* no matchMedia: "System" simply stays what it resolved to at load */
  }
  window.addEventListener('storage', (e) => {
    if (e.key === THEME_KEY) applyTheme(isThemePref(e.newValue) ? e.newValue : 'system');
  });
}

installListeners();
