// The phone runtime: everything the Android app adds to the page before the
// app itself starts (scripts/build-mobile.mjs bundles this; app/layout.tsx
// loads it in the Android build only).
//
//  - mobile/server: the route handlers, answering the page's /api calls
//  - mobile/bridges: what the desktop shell provides the page (saving files,
//    PDFs), and what only a phone has (the back gesture, Material You)
//
// window.girovoMobile (types/mobile-window.d.ts) is how the page reaches the
// Android-only parts; lib/client-api.ts waits for it before its first call.

// First: banks-data.json and config.json in place before any module that
// reads them while it loads (lib/banks.ts, lib/session.ts) — the bridges
// below reach lib/session.ts as well as the route handlers do.
import './server/assets';
import { MOBILE_READY_EVENT } from '../lib/client-api.ts';
import { startAppearance } from './bridges/appearance';
import { installBack } from './bridges/back';
import * as biometric from './bridges/biometric';
import { revealWhenReady } from './bridges/boot';
import { installFiles, shareFile } from './bridges/files';
import * as model from './bridges/model';
import { installRipple } from './bridges/ripple';
import { installSheetDrag } from './bridges/sheet-drag';
import { installUpdates, playUpdate } from './bridges/updates';
import { GirovoDevice } from './native';
import { ready } from './server/index';

installFiles();
installBack();
installSheetDrag();
installRipple();
const updates = installUpdates();
const appearance = startAppearance();

window.girovoMobile = {
  ready,
  share: shareFile,
  biometric: {
    state: biometric.state,
    enrolled: biometric.enrolled,
    enroll: biometric.enroll,
    unlock: biometric.unlock,
    forget: biometric.forget,
  },
  model: {
    bytes: model.MODEL_BYTES,
    status: model.status,
    onProgress: model.onProgress,
    download: model.download,
    cancel: model.cancel,
    remove: model.remove,
  },
  playUpdate,
  approval: {
    hold: (texts) => GirovoDevice.holdForApproval(texts).then((r) => r.held, () => false),
    release: () => GirovoDevice.releaseApproval().catch(() => {}),
  },
};
window.dispatchEvent(new Event(MOBILE_READY_EVENT));

void revealWhenReady([ready, appearance, updates]);
