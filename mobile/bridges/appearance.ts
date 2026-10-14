// How the Android app looks, beyond what the page decides itself:
//
//  - the palette: Material You, the wallpaper's colours, wherever the phone
//    has them (Android 12 and later); Girovo's own navy and blue before that.
//    <html data-palette="dynamic" | "girovo">; app/android.css does the rest.
//  - the system bars' icons, light or dark, so they stay readable on whatever
//    the app draws under them (the bars are transparent — edge to edge).
//
// Neither is a setting: like light and dark (lib/theme.ts), the colours are
// the phone's.

import { SystemBars, SystemBarsStyle, SystemBarType } from '@capacitor/core';
import { GirovoDevice, type DynamicPalette, type DynamicRoles } from '../native';
import { materialYouCss } from './material-you';

type PaletteMode = 'dynamic' | 'girovo';
/** Where an earlier version kept a choice between the two. */
const OLD_PALETTE_PREF = 'fints.palette';
const STYLE_ID = 'girovo-material-you';

let dynamic: DynamicPalette | null = null;
/** Android 14+: the roles as the phone itself draws them. */
let roles: DynamicRoles | undefined;

/** The palette in use: the wallpaper's, where the phone can give it. */
const paletteMode = (): PaletteMode => (dynamic ? 'dynamic' : 'girovo');

function applyBars(): void {
  const root = document.documentElement;
  const dark = root.dataset.theme === 'dark';
  // Girovo's masthead is navy in both themes; Material You's top bar is a
  // surface, light by day and dark by night.
  const statusOnDark = paletteMode() === 'girovo' || dark;
  void SystemBars.setStyle({ bar: SystemBarType.StatusBar, style: statusOnDark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
  void SystemBars.setStyle({ bar: SystemBarType.NavigationBar, style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
}

function applyPalette(): void {
  const root = document.documentElement;
  const mode = paletteMode();
  root.dataset.palette = mode;
  let style = document.getElementById(STYLE_ID);
  if (mode === 'dynamic' && dynamic) {
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent = materialYouCss(dynamic, roles);
  } else {
    style?.remove();
  }
  applyBars();
}

/** Reads the wallpaper's colours and keeps the bars in step with the theme. Before the splash goes. */
export async function startAppearance(): Promise<void> {
  try {
    localStorage.removeItem(OLD_PALETTE_PREF);
  } catch { /* nothing to tidy */ }
  try {
    const answer = await GirovoDevice.palette();
    dynamic = answer.available && answer.palette ? answer.palette : null;
    roles = answer.roles;
  } catch {
    dynamic = null;
  }
  applyPalette();
  // The theme script and lib/theme.ts switch <html data-theme>; the bars follow.
  new MutationObserver(applyBars).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  // A new wallpaper while the app is in the background: Android restarts the
  // activity for it on most phones, but not on all.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void GirovoDevice.palette()
      .then((answer) => {
        const next = answer.available && answer.palette ? answer.palette : null;
        if (JSON.stringify([next, answer.roles]) === JSON.stringify([dynamic, roles])) return;
        dynamic = next;
        roles = answer.roles;
        applyPalette();
      })
      .catch(() => {});
  });
}
