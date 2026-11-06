'use client';

// The window's caption buttons in the Tauri desktop app on Windows: minimize,
// maximize (restore when maximized) and close at the window's top right, as
// Electron's titleBarOverlay had the OS draw them. The page draws them now;
// the shell does what they do (src-tauri/src/frame.rs).
//
// Like the OS buttons they stand above everything, a dialog's scrim
// included, so the window can always be moved out of the way or closed; their
// own ground is clear, so what shows through is the bar as it looks right
// then — dimmed under a scrim — and only the glyphs take the scrim's colour
// themselves (the dim lib/theme.ts reports, as it did for the overlay).
//
// The maximize button lies under the shell's snap overlay, which takes the
// mouse there for Windows 11's snap layouts: its hover and press come from the
// shell, not from CSS. Its position goes to the shell whenever it moves.
//
// Not in the Tab order, like the OS buttons: Alt+F4, Win+↑ and Win+↓ are the
// keyboard's way, and a screen reader still finds them by name.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useT } from '@/lib/i18n/react';
import { cx } from '../ui';

/** Windows 11's caption glyphs (Segoe Fluent Icons; Segoe MDL2 Assets on Windows 10). */
const GLYPH = { minimize: '\uE921', maximize: '\uE922', restore: '\uE923', close: '\uE8BB' };
/** The glyph colours of the Electron shell's OS-drawn buttons, kept, and Material's scrim at 32 %. */
const INK = { light: [22, 28, 36], dark: [221, 227, 238] };
const SCRIM_ALPHA = 0.32;

function glyphColor(dark: boolean, dim: number): string {
  const keep = (1 - SCRIM_ALPHA) ** Math.min(dim, 3);
  const [r, g, b] = INK[dark ? 'dark' : 'light'].map((v) => Math.round(v * keep));
  return `rgb(${r}, ${g}, ${b})`;
}

export function CaptionButtons() {
  const t = useT();
  const [caption, setCaption] = useState<Window['electronCaption']>(undefined);
  const [maximized, setMaximized] = useState(false);
  const [maxHover, setMaxHover] = useState(false);
  const [maxPress, setMaxPress] = useState(false);
  const [theme, setTheme] = useState({ dark: false, dim: 0 });
  const maxRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const c = window.electronCaption;
    if (!c) return;
    setCaption(c);
    setTheme(c.theme());
    void c.isMaximized().then(setMaximized).catch(() => {});
    const offs = [
      c.on('maximized', (v) => setMaximized(v === true)),
      c.on('hover', (v) => setMaxHover(v === true)),
      c.on('press', (v) => setMaxPress(v === true)),
    ];
    const onTheme = (e: Event) => setTheme((e as CustomEvent<{ dark: boolean; dim: number }>).detail);
    window.addEventListener('girovo:caption-theme', onTheme);
    return () => {
      offs.forEach((off) => off());
      window.removeEventListener('girovo:caption-theme', onTheme);
    };
  }, []);

  // Where the maximize button is, for the snap overlay: on every change of size, zoom or DPI.
  useEffect(() => {
    const button = maxRef.current;
    if (!caption || !button) return;
    let frame = 0;
    const report = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = button.getBoundingClientRect();
        const s = window.devicePixelRatio || 1;
        void caption.setMaxRect({ x: r.left * s, y: r.top * s, width: r.width * s, height: r.height * s });
      });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(button);
    window.addEventListener('resize', report);
    const dpr = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dpr.addEventListener('change', report);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', report);
      dpr.removeEventListener('change', report);
    };
  }, [caption]);

  if (!caption) return null;
  const color = glyphColor(theme.dark, theme.dim);
  const base = 'grid h-full w-[46px] place-items-center outline-none transition-colors duration-100';
  const tint = theme.dark ? 'hover:bg-white/[0.08] active:bg-white/[0.05]' : 'hover:bg-black/[0.05] active:bg-black/[0.03]';
  const glyph = (ch: string) => (
    <span aria-hidden className="text-[10px] leading-none" style={{ fontFamily: '"Segoe Fluent Icons", "Segoe MDL2 Assets"' }}>{ch}</span>
  );

  return (
    <div
      data-caption-buttons
      className="fixed top-0 right-0 z-[2147483000] flex select-none"
      // The bar under them is a drag region (app-region): WebView2 would take their clicks for a drag.
      style={{ height: 'var(--barbar-h)', color, WebkitAppRegion: 'no-drag' } as CSSProperties}
    >
      <button type="button" tabIndex={-1} aria-label={t.shell.caption.minimize} className={cx(base, tint)} onClick={() => void caption.minimize()}>
        {glyph(GLYPH.minimize)}
      </button>
      <button
        ref={maxRef}
        type="button"
        tabIndex={-1}
        aria-label={maximized ? t.shell.caption.restore : t.shell.caption.maximize}
        className={cx(base, maxPress
          ? theme.dark ? 'bg-white/[0.05]' : 'bg-black/[0.03]'
          : maxHover ? theme.dark ? 'bg-white/[0.08]' : 'bg-black/[0.05]' : '')}
        onClick={() => void caption.toggleMaximize()}
      >
        {glyph(maximized ? GLYPH.restore : GLYPH.maximize)}
      </button>
      <button
        type="button"
        tabIndex={-1}
        aria-label={t.shell.caption.close}
        className={cx(base, 'hover:bg-[#c42b1c] hover:text-white active:bg-[#c42b1c]/90 active:text-white/80')}
        onClick={() => void caption.close()}
      >
        {glyph(GLYPH.close)}
      </button>
    </div>
  );
}
