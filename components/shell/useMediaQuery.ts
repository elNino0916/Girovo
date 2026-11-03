'use client';

// One media query as React state, for what CSS alone cannot switch: which of
// two parts renders at all (usePhone, useWide, the transfer's invoice pane).
// `serverValue` is the answer before there is a window to ask — the server's
// render and the first frame of hydration.

import { useCallback, useSyncExternalStore } from 'react';

export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => serverValue);
}
