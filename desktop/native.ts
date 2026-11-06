// The phone's native plugins (mobile/native.ts) as the desktop has them,
// for the shared server code (scripts/build-desktop.mjs puts this module in
// mobile/native.ts's place). Only what that code reaches on the desktop is
// real; everything else answers that it is not there.

import { registerPlugin } from './capacitor/core';
import { invoke } from './shell';

/** The bank's traffic, past CORS (src-tauri/src/http.rs; mobile/server/fetch.ts drives it). */
export const GirovoHttp = {
  open: (args: { id: string; url: string; method: string; headers: Record<string, string>; body?: string }) =>
    invoke<{ status: number; statusText: string; headers: Record<string, string> }>('http_open', { args }),
  body: ({ id }: { id: string }) => invoke<{ body: string }>('http_body', { id }),
  cancel: ({ id }: { id: string }) => invoke<void>('http_cancel', { id }),
};

export const GirovoNano = registerPlugin('GirovoNano');
export const GirovoDevice = registerPlugin('GirovoDevice');
export const GirovoLaunch = registerPlugin('GirovoLaunch');
export const GirovoWidget = registerPlugin('GirovoWidget');
export const GirovoBackground = registerPlugin('GirovoBackground');
export const GirovoSync = registerPlugin('GirovoSync');
export const GirovoScanner = registerPlugin('GirovoScanner');
export const GirovoDocScanner = registerPlugin('GirovoDocScanner');
export const GirovoText = registerPlugin('GirovoText');
export const GirovoBiometric = registerPlugin('GirovoBiometric');
export const GirovoUpdater = registerPlugin('GirovoUpdater');
export const GirovoPlus = registerPlugin('GirovoPlus');
export const GirovoReview = registerPlugin('GirovoReview');
