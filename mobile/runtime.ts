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
import { startTelemetry } from './bridges/telemetry';
import { installUpdates, playUpdate } from './bridges/updates';
import { Buffer } from 'buffer';
import { GirovoDevice, GirovoLaunch, GirovoScanner } from './native';
import { ready } from './server/index';

// First, so a failure in what follows is reported too.
startTelemetry();
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
  launch: {
    on: (fn) => {
      const handle = GirovoLaunch.addListener('launch', fn);
      return () => void handle.then((h) => h.remove());
    },
    readShared: async (uri, mime) => {
      const file = await GirovoLaunch.readShared({ uri, mime });
      return new File([Buffer.from(file.data, 'base64')], file.name, { type: file.mime ?? '' });
    },
  },
  pdfPages: async (pdf) => {
    const data = Buffer.from(await pdf.arrayBuffer()).toString('base64');
    const { pages } = await GirovoLaunch.renderPdf({ data });
    return pages.map((page) => new Blob([Buffer.from(page, 'base64')], { type: 'image/png' }));
  },
  scanner: {
    scan: () => GirovoScanner.scan().then(
      (r) => (r.canceled ? { canceled: true as const } : { value: r.value ?? '' }),
      (err: { code?: string }) => (err?.code === 'unavailable' ? { unavailable: true as const } : { failed: true as const }),
    ),
  },
  haptic: (kind) => {
    void GirovoDevice.haptic({ kind }).catch(() => {});
  },
};
window.dispatchEvent(new Event(MOBILE_READY_EVENT));

void revealWhenReady([ready, appearance, updates]);
