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
import { chooseSaving, integrity } from './bridges/integrity';
import * as plus from './bridges/plus';
import * as categories from './bridges/categories';
import { installRipple } from './bridges/ripple';
import { installSheetDrag } from './bridges/sheet-drag';
import { startTelemetry } from './bridges/telemetry';
import { installUpdates, playUpdate } from './bridges/updates';
import { Buffer } from 'buffer';
import { GirovoDevice, GirovoDocScanner, GirovoLaunch, GirovoNano, GirovoScanner, GirovoText } from './native';
import { ready } from './server/index';

/** Android AICore in Google Play: Play opens the https link as its own page. */
const AICORE_IN_PLAY = 'https://play.google.com/store/apps/details?id=com.google.android.aicore';

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
    isOn: biometric.isOn,
    enroll: biometric.enroll,
    seal: biometric.seal,
    unlock: biometric.unlock,
    forget: biometric.forget,
    forgetLinked: biometric.forgetLinked,
  },
  categories: {
    status: categories.status,
    onStatus: categories.onStatus,
    download: categories.download,
    progress: categories.progress,
    onProgress: categories.onProgress,
  },
  playUpdate,
  integrity,
  chooseSaving,
  // Girovo Plus (lib/plus.ts): Play Billing in the Play build, "free" in the GitHub build.
  plus: {
    status: plus.status,
    onChange: plus.onChange,
    buy: plus.buy,
    manage: plus.manage,
    setIcon: plus.setIcon,
    ownerInfo: plus.ownerInfo,
    setOwnerKey: plus.setOwnerKey,
    clearOwnerKey: plus.clearOwnerKey,
    openGitHub: plus.openGitHub,
  },
  // "Frag deine Umsätze": one question to Gemini Nano (lib/nano-ask.ts builds and reads it).
  ask: (system, text, maxTokens) => GirovoNano.prompt({ system, text, maxTokens }).then((r) => r.text, () => null),
  // Where Nano is missing or too old: AICore's page in Google Play, to update it.
  openAICore: () => GirovoDevice.openExternal({ url: AICORE_IN_PLAY }).catch(() => {}),
  approval: {
    hold: (texts) => GirovoDevice.holdForApproval(texts).then((r) => r.held, () => false),
    release: () => GirovoDevice.releaseApproval().catch(() => {}),
    app: (packages) => GirovoDevice.approvalApp({ packages: [...packages] }).then((r) => r.package ?? null, () => null),
    open: (packages) => GirovoDevice.openApprovalApp({ packages: [...packages] }).then(() => true, () => false),
  },
  docScanner: {
    scan: (opts = {}) => GirovoDocScanner.scan(opts).then(
      (r) => {
        if (r.canceled) return { canceled: true as const };
        const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
        const pages = (r.pages ?? []).map((data, i) =>
          new File([Buffer.from(data, 'base64')], `Scan-${stamp}-${i + 1}.jpg`, { type: 'image/jpeg' }));
        if (!pages.length) return { failed: true as const };
        const pdf = r.pdf ? new File([Buffer.from(r.pdf, 'base64')], `Scan-${stamp}.pdf`, { type: 'application/pdf' }) : undefined;
        return pdf ? { pages, pdf } : { pages };
      },
      (err: { code?: string }) => (err?.code === 'unavailable' ? { unavailable: true as const } : { failed: true as const }),
    ),
  },
  readText: async (image) => {
    const data = Buffer.from(await image.arrayBuffer()).toString('base64');
    return GirovoText.recognize({ data }).then(
      (r) => ({
        text: r.text ?? '',
        lines: (r.lines ?? []).map((l) => ({
          text: l.text ?? '',
          box: l.box?.length === 4 ? [l.box[0], l.box[1], l.box[2], l.box[3]] as [number, number, number, number] : undefined,
        })),
        width: r.width ?? 0,
        height: r.height ?? 0,
      }),
      (err: { code?: string }) => (err?.code === 'unavailable' ? { unavailable: true as const } : null),
    );
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
