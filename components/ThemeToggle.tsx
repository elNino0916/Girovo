'use client';

// Darstellung: Hell, Dunkel or System.
//
// The glyphs on both controls are switched by CSS from the attributes the
// pre-paint script writes on <html> (see .theme-glyph / .mode-glyph in
// globals.css), never by React state: the server renders before anyone knows
// the theme, and a state-driven glyph would paint the wrong one until
// hydration. Text that names the current setting (the trigger's accessible
// name, the checked menu item) comes from useSyncExternalStore, which renders
// the server's answer during hydration and corrects itself right after —
// without a hydration mismatch.

import { useSyncExternalStore } from 'react';
import {
  appliedTheme, appliedThemePref, setThemePref, subscribeTheme, type Theme, type ThemePref,
} from '@/lib/theme';
import { MonitorIcon, MoonIcon, SunIcon } from './icons';
import { IconButton, Menu, MenuGroup, MenuItemRadio, cx, type Placement } from './ui';

/** The stored choice, live. 'system' on the server. */
export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribeTheme, appliedThemePref, () => 'system' as const);
}

/** The theme actually on screen, live. 'light' on the server. */
export function useResolvedTheme(): Theme {
  return useSyncExternalStore(subscribeTheme, appliedTheme, () => 'light' as const);
}

const PREF_LABEL: Record<ThemePref, string> = { light: 'Hell', dark: 'Dunkel', system: 'System' };

/** Sun, moon or screen — whichever the CHOSEN setting is. */
function PrefGlyph({ size = 18 }: { size?: number }) {
  return (
    <>
      <SunIcon size={size} className="theme-glyph" data-glyph="light" />
      <MoonIcon size={size} className="theme-glyph" data-glyph="dark" />
      <MonitorIcon size={size} className="theme-glyph" data-glyph="system" />
    </>
  );
}

/**
 * The masthead's "Darstellung" item: opens a menu of Hell / Dunkel / System.
 *
 * `labelClassName` lets the shell collapse the word to the icon on a narrow
 * window (e.g. "hidden desk:inline"); the accessible name stays either way.
 * `variant="icon"` renders a round icon button instead of the masthead item.
 */
export function ThemeMenu({
  variant = 'navlink', tone = 'bar', labelClassName, className, placement = 'bottom-end',
}: {
  variant?: 'navlink' | 'icon';
  tone?: 'page' | 'bar' | 'stage';
  labelClassName?: string;
  className?: string;
  placement?: Placement;
}) {
  const pref = useThemePref();
  const name = `Darstellung: ${PREF_LABEL[pref]}`;

  return (
    <Menu
      label="Darstellung"
      placement={placement}
      minWidth={240}
      trigger={(props) =>
        variant === 'icon' ? (
          <IconButton {...props} tone={tone} size="md" aria-label={name} className={className}>
            <PrefGlyph />
          </IconButton>
        ) : (
          <button {...props} type="button" aria-label={name} title={name} className={cx('navlink inline-flex', className)}>
            <PrefGlyph />
            <span className={labelClassName}>Darstellung</span>
          </button>
        )
      }
    >
      <MenuGroup label="Darstellung">
        <MenuItemRadio checked={pref === 'light'} icon={<SunIcon />} onSelect={() => setThemePref('light')}>
          Hell
        </MenuItemRadio>
        <MenuItemRadio checked={pref === 'dark'} icon={<MoonIcon />} onSelect={() => setThemePref('dark')}>
          Dunkel
        </MenuItemRadio>
        <MenuItemRadio
          checked={pref === 'system'}
          icon={<MonitorIcon />}
          description="Folgt der Einstellung deines Systems"
          onSelect={() => setThemePref('system')}
        >
          System
        </MenuItemRadio>
      </MenuGroup>
    </Menu>
  );
}

/**
 * A single round button that flips between light and dark — for the auth
 * screens' bar, where a menu would be more than the moment needs. It shows
 * the theme you are looking at, and choosing makes it an explicit setting
 * (no longer "System") — which its name says, so following the system is
 * not given up unawares.
 *
 * `labelled` is the old masthead form; it now renders the full ThemeMenu.
 */
export function ThemeToggle({
  tone = 'page', labelled = false, className,
}: { tone?: 'page' | 'bar' | 'stage'; labelled?: boolean; className?: string }) {
  const pref = useThemePref();
  const shown = useResolvedTheme();
  if (labelled) return <ThemeMenu className={className} labelClassName="hidden sm:inline" />;

  const flip = () => setThemePref(appliedTheme() === 'dark' ? 'light' : 'dark');
  const name = `${shown === 'dark' ? 'Hell' : 'Dunkel'} darstellen${pref === 'system' ? ' (statt System)' : ''}`;
  return (
    <IconButton tone={tone} size="md" onClick={flip} aria-label={name} className={className}>
      <SunIcon size={18} className="mode-glyph" data-glyph="light" />
      <MoonIcon size={18} className="mode-glyph" data-glyph="dark" />
    </IconButton>
  );
}
