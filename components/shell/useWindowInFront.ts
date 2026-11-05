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
  return () => {
    window.removeEventListener('focus', onChange);
    window.removeEventListener('blur', onChange);
    document.removeEventListener('visibilitychange', onChange);
  };
};

const inFront = () => document.visibilityState === 'visible' && document.hasFocus();

export function useWindowInFront(): boolean {
  return useSyncExternalStore(subscribe, inFront, () => false);
}
