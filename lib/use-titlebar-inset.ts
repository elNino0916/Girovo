'use client';

import { useEffect, useState } from 'react';

/**
 * Width, in CSS pixels, that a window's own top bar must stay clear of on its
 * trailing edge so the OS caption buttons (Window Controls Overlay — see
 * electron/main.cjs) never sit on top of it.
 *
 * The API itself is defined in any recent Chromium build, Electron or not —
 * `.visible` is what actually says whether an overlay is reserved right now.
 * Reading `getTitlebarAreaRect()` while `.visible` is false is meaningless
 * (some hosts return a stale or zeroed rect there), and trusting it anyway is
 * exactly what produced the giant, layout-eating inset seen outside Electron.
 */
export function useTitleBarInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const wco = navigator.windowControlsOverlay;
    if (!wco) return;
    const update = () => {
      if (!wco.visible) { setInset(0); return; }
      const rect = wco.getTitlebarAreaRect();
      setInset(Math.max(0, window.innerWidth - rect.x - rect.width));
    };
    update();
    wco.addEventListener('geometrychange', update);
    return () => wco.removeEventListener('geometrychange', update);
  }, []);
  return inset;
}
