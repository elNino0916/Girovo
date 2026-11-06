'use client';

// Whether Girovo's window is the one in front: shown and holding the focus.
// The desktop asks for Windows Hello only then — never from a window hidden
// in the notification area (a start with Windows), behind the start window,
// or in the background while the user is in another app.

import { useSyncExternalStore } from 'react';

const subscribe = (onChange: () => void) => {
  window.addEventListener('focus', onChange);
  window.addEventListener('blur', onChange);
  document.addEventListener('visibilitychange', onChange);
  window.addEventListener('girovo:window-shown', onChange);
  return () => {
    window.removeEventListener('focus', onChange);
    window.removeEventListener('blur', onChange);
    document.removeEventListener('visibilitychange', onChange);
    window.removeEventListener('girovo:window-shown', onChange);
  };
};

// The desktop shell also says whether the window is on screen at all:
// WebView2 reports a page in a hidden window as visible, and focused for a
// moment as it loads — behind the start window, through a whole update.
const inFront = () =>
  document.visibilityState === 'visible' && document.hasFocus() && (window.electronWindow?.shown?.() ?? true);

export function useWindowInFront(): boolean {
  return useSyncExternalStore(subscribe, inFront, () => false);
}
