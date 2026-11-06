// @capacitor/app for the desktop runtime: Android's "pause" (the app went to
// the background, written files must reach the disk) is the window hiding or
// the page going away here (desktop/pause.ts). The server's worker has no
// window to watch: it hears of it from the page, across the line.

import { page } from '../../mobile/worker/server';
import { onPause } from '../pause';

type Listener = () => void;

export const App = {
  addListener(event: string, listener: Listener): Promise<{ remove: () => Promise<void> }> {
    if (event !== 'pause') return Promise.resolve({ remove: async () => {} });
    const stop = typeof document !== 'undefined' ? onPause(listener) : page().listen('pause', [], () => listener());
    return Promise.resolve({ remove: async () => stop() });
  },
};
