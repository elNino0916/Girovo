// @capacitor/app for the phone server's bundle: the page's App plugin, across
// the line (./core.ts) — the server listens for "pause" to flush its files.

import type { AppPlugin } from '@capacitor/app';
import { registerPlugin } from './core';

export const App = registerPlugin<AppPlugin>('App');
