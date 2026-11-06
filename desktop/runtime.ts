// The desktop runtime: everything the Tauri build adds to the page before the
// app itself starts (scripts/build-desktop.mjs bundles this; app/layout.tsx
// loads it in the desktop export only). The phone's runtime is
// mobile/runtime.ts; the server part is shared, the bridges are not — the
// desktop's (window.electron*) are already up, from src-tauri/src/bridge.js.
//
// Order matters: ./env makes the process the desktop's before any route
// module reads it.

import './env';
import { MOBILE_READY_EVENT } from '../lib/client-api.ts';
import { startBackgroundChecks } from './background';
import { ready } from './server/index';

startBackgroundChecks();

(window as Window & { girovoDesktop?: { ready: Promise<void> } }).girovoDesktop = { ready };
window.dispatchEvent(new Event(MOBILE_READY_EVENT));
