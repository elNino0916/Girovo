'use client';

// Whether the window is a phone's: narrower than 640px, where the
// navigation is the bar at the foot and the Übersicht opens on its search
// (DESIGN.md, Layout). For what CSS alone cannot switch — a part rendered
// once, not twice with one of them hidden. The Android build starts from
// "yes" so a phone never paints the wide window's bar first; a tablet
// corrects it on the first frame.

import { useSyncExternalStore } from 'react';
import { IS_ANDROID } from '@/lib/platform';

const QUERY = '(max-width: 639.98px)';

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

export function usePhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => IS_ANDROID,
  );
}
