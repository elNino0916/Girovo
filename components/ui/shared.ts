// The two things every primitive shares: the class join and the Electron
// no-drag style for layers over the masthead.

import type { CSSProperties } from 'react';

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

/** Electron: a layer over the masthead must not be a window-drag handle. */
export const NO_DRAG = { WebkitAppRegion: 'no-drag' } as CSSProperties;
