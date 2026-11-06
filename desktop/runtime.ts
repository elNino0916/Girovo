// The desktop runtime: everything the Tauri build adds to the page before the
// app itself starts (scripts/build-desktop.mjs bundles this; app/layout.tsx
// loads it in the desktop export only). The phone's runtime is
// mobile/runtime.ts; the server part is shared, the bridges are not — the
// desktop's (window.electron*) are already up, from src-tauri/src/bridge.js.
//
// The server itself is desktop-server.js, in a worker beside the page
// (./host.ts; desktop/server/entry.ts).

import { MOBILE_READY_EVENT } from '../lib/runtime-ready.ts';
import { startBackgroundChecks } from './background';
import { startDesktopServer } from './host';

const { ready } = startDesktopServer();
startBackgroundChecks();

(window as Window & { girovoDesktop?: { ready: Promise<void> } }).girovoDesktop = { ready };
window.dispatchEvent(new Event(MOBILE_READY_EVENT));
