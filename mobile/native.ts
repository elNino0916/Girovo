// The app's own native plugins (android/app/src/main/java/de/elnino0916/android/girovo/),
// as the WebView sees them. Each is small and does one thing the WebView
// cannot: talk to a bank without CORS, run the category model, read the
// wallpaper's colours, print, keep a PIN behind the fingerprint, install an
// update.

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

// ---------------------------------------------------------------------------
// Bank and web requests outside the WebView's origin rules.

export type HttpRequest = {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  /** The body's bytes, base64 — exact, whatever its encoding. */
  body?: string;
  connectTimeoutMs?: number;
};

/** The head of an answer: open() resolves once it is in, before the body. */
export type HttpHead = { status: number; statusText: string; headers: Record<string, string> };

/**
 * Why a request failed, in the error codes Node's fetch reports
 * (lib/bank-fetch.ts sorts them): ENOTFOUND, ECONNREFUSED, ECONNRESET,
 * ETIMEDOUT, CERT_INVALID, or EUNKNOWN.
 */
export type HttpErrorCode = string;

export interface GirovoHttpPlugin {
  /** Sends the request and resolves with the answer's head — lib/bank-fetch.ts times the first byte on it. */
  open(req: HttpRequest): Promise<HttpHead>;
  /** The whole body of an opened answer, base64; the connection is done after it. */
  body(opts: { id: string }): Promise<{ body: string }>;
  /** Ends a request in any state. */
  cancel(opts: { id: string }): Promise<void>;
}

export const GirovoHttp = registerPlugin<GirovoHttpPlugin>('GirovoHttp');

// ---------------------------------------------------------------------------
// The category model: download it once, then run it natively.

export type ModelFile = { name: string; url: string; size: number; sha256?: string; gitBlob?: string };

export type ModelStatus = {
  installed: boolean;
  files: { name: string; size: number }[];
  downloading: boolean;
  received: number;
  total: number;
};

export interface GirovoModelPlugin {
  status(): Promise<ModelStatus>;
  download(opts: { files: ModelFile[] }): Promise<ModelStatus>;
  cancelDownload(): Promise<void>;
  remove(): Promise<void>;
  load(opts: { file: string; threads: number }): Promise<{ inputNames: string[]; outputNames: string[] }>;
  /** Per row, the sum of the last hidden state over its masked tokens: float32 [rows × dim], base64. */
  embed(opts: { ids: number[][]; mask: number[][] }): Promise<{ dim: number; pooled: string }>;
  release(): Promise<void>;
  addListener(event: 'progress', fn: (status: ModelStatus) => void): Promise<PluginListenerHandle>;
}

export const GirovoModel = registerPlugin<GirovoModelPlugin>('GirovoModel');

// ---------------------------------------------------------------------------
// The device: wallpaper colours, printing, saving, sharing, the screen-capture guard.

/** Material You's tonal palettes, each Material tone ("0" … "100") → #rrggbb (Android 12+). */
export type DynamicPalette = Record<'primary' | 'secondary' | 'tertiary' | 'neutral' | 'neutralVariant', Record<string, string>>;

/** Material You's colour roles as Android 14+ publishes them, per theme: "surface-container-high" → #rrggbb. */
export type DynamicRoles = Record<'light' | 'dark', Record<string, string>>;

export interface GirovoDevicePlugin {
  /** The wallpaper's tonal palettes (Android 12+) and, from Android 14, the finished roles. */
  palette(): Promise<{ available: boolean; palette?: DynamicPalette; roles?: DynamicRoles }>;
  /** Hands the page as it would print (@media print) to Android's print dialog, where "Save as PDF" is one of the printers. */
  print(opts: { name: string }): Promise<{ result: 'queued' | 'canceled' | 'failed' }>;
  /** Asks where to save, through the system's file picker. */
  saveFile(opts: { name: string; mime: string; data: string }): Promise<{ result: 'saved' | 'canceled' }>;
  /** Hands a file to another app through the share sheet. */
  shareFile(opts: { name: string; mime: string; data: string; title?: string }): Promise<void>;
  /** FLAG_SECURE: no screenshots, no screen recording. */
  setSecure(opts: { secure: boolean }): Promise<void>;
  info(): Promise<{ versionName: string; versionCode: number; flavor: 'play' | 'github'; debug: boolean; sdk: number; locale: string }>;
  /** Opens an https page in the phone's browser. */
  openExternal(opts: { url: string }): Promise<void>;
  /**
   * Keeps the app's network while the user approves in their bank's app
   * (ApprovalService, a short foreground service with a quiet notification).
   * `held` is false when Android refused it.
   */
  holdForApproval(opts: { title: string; text: string }): Promise<{ held: boolean }>;
  releaseApproval(): Promise<void>;
  /** The system's own short touch: sent or approved, refused or failed, a gesture's threshold. */
  haptic(opts: { kind: HapticKind }): Promise<void>;
  /** While a layer is open the back gesture is the page's, with its progress (mobile/bridges/back.ts). */
  setBackLayer(opts: { open: boolean }): Promise<void>;
  addListener(event: 'backProgress', fn: (e: { progress: number; edge: 'left' | 'right' }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'backCancelled' | 'backInvoked', fn: () => void): Promise<PluginListenerHandle>;
}

export type HapticKind = 'confirm' | 'reject' | 'threshold';

export const GirovoDevice = registerPlugin<GirovoDevicePlugin>('GirovoDevice');

// ---------------------------------------------------------------------------
// Launches: a shortcut on the icon, or an invoice another app shared.

export type Launch =
  | { kind: 'transfer' | 'scan' | 'request' }
  | { kind: 'file'; uri: string; mime?: string };

export interface GirovoLaunchPlugin {
  /** A shared file's bytes (base64), its name and type. */
  readShared(opts: { uri: string; mime?: string }): Promise<{ name: string; mime?: string; data: string }>;
  /** A PDF's first pages, each drawn on white as a PNG (base64). */
  renderPdf(opts: { data: string }): Promise<{ pages: string[] }>;
  /** Kept by the app until the page listens: the launch that opened it comes then. */
  addListener(event: 'launch', fn: (launch: Launch) => void): Promise<PluginListenerHandle>;
}

export const GirovoLaunch = registerPlugin<GirovoLaunchPlugin>('GirovoLaunch');

// ---------------------------------------------------------------------------
// "GiroCode scannen": Google's code scanner, from Play services.

export interface GirovoScannerPlugin {
  /** The QR code's text, or canceled; fails ("unavailable") without Play services. */
  scan(): Promise<{ value?: string; canceled?: boolean }>;
}

export const GirovoScanner = registerPlugin<GirovoScannerPlugin>('GirovoScanner');

// ---------------------------------------------------------------------------
// Fingerprint unlock: the PIN sealed with a key that only a fingerprint opens.

export type BiometricState = { available: boolean; reason?: 'none-enrolled' | 'no-hardware' | 'unavailable' | 'security-update' };

export interface GirovoBiometricPlugin {
  state(): Promise<BiometricState>;
  /** Seals `secret` under `id` after a fingerprint; the key dies with a newly enrolled finger. */
  enroll(opts: { id: string; secret: string; title: string; subtitle: string; cancel: string }): Promise<{ result: 'enrolled' | 'canceled' }>;
  unlock(opts: { id: string; title: string; subtitle: string; cancel: string }): Promise<{ result: 'unlocked' | 'canceled' | 'invalidated' | 'missing'; secret?: string }>;
  has(opts: { id: string }): Promise<{ enrolled: boolean }>;
  remove(opts: { id: string }): Promise<void>;
  removeAll(): Promise<void>;
}

export const GirovoBiometric = registerPlugin<GirovoBiometricPlugin>('GirovoBiometric');

// ---------------------------------------------------------------------------
// Updates: GitHub's APK (the "github" flavour) or Google Play's own (the "play" one).

export type UpdaterState = {
  phase: 'idle' | 'downloading' | 'ready' | 'installing' | 'failed';
  received: number;
  total: number;
  error?: string;
};

export interface GirovoUpdaterPlugin {
  /** Downloads `url`, checks it against `sha256`, keeps it for install(). */
  download(opts: { url: string; sha256: string; size: number }): Promise<UpdaterState>;
  cancel(): Promise<void>;
  /** Hands the checked APK to Android's package installer — or, the first time, to the setting that allows it. */
  install(): Promise<{ result: 'started' | 'permission' }>;
  /** Google Play's in-app update (the "play" flavour only). */
  playCheck(): Promise<{ available: boolean; versionCode?: number }>;
  playUpdate(): Promise<{ result: 'started' | 'canceled' | 'failed' }>;
  addListener(event: 'state', fn: (state: UpdaterState) => void): Promise<PluginListenerHandle>;
}

export const GirovoUpdater = registerPlugin<GirovoUpdaterPlugin>('GirovoUpdater');
