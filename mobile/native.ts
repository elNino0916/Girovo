// The app's own native plugins (android/app/src/main/java/de/elnino0916/android/girovo/),
// as the WebView sees them. Each is small and does one thing the WebView
// cannot: talk to a bank without CORS, run the category model, read the
// wallpaper's colours, print, keep a PIN behind the fingerprint, install an
// update.

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { IntegrityFacts } from '../lib/device-integrity.ts';

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
// The category guess: Gemini Nano through Android AICore (NanoPlugin.java).

/**
 * Whether this phone has Nano. `unsupported` covers phones without AICore,
 * without Nano, or whose AICore needs a system update (`reason`).
 */
export type NanoStatus = {
  state: 'available' | 'downloadable' | 'downloading' | 'unsupported';
  /** AICore's name for the model, once available ("nano-v4-fast"). */
  model?: string;
  /** The model questions go to — the newest generation any variant has; "Frag deine Umsätze" needs v4. */
  askModel?: string;
  /** The variant in use ("fast/stable", "full/preview" …): the first AICore had. */
  variant?: string;
  /** What AICore answered for each variant ("fast/stable: unavailable · full/stable: available"). */
  probed?: string;
  /** While downloading: AICore has begun (its own callback said so), not just been asked. */
  started?: boolean;
  reason?: 'unavailable' | 'update' | 'aicore';
  /** While AICore downloads it, in bytes — when AICore says. */
  received?: number;
  total?: number;
};

/** The bookings waiting for Nano, across every batch; `waiting` while AICore makes them wait. */
export type NanoProgress = { active: boolean; done: number; total: number; waiting: 'busy' | 'background' | null };

export interface GirovoNanoPlugin {
  status(): Promise<NanoStatus>;
  /** Asks AICore for Nano where it is downloadable; resolves with the status once AICore is done. */
  download(): Promise<NanoStatus>;
  /**
   * One prompt per item, `prefix + text`, answered in order. An answer is null
   * only after an error AICore calls final — busy and background are waited out.
   */
  classify(opts: { system: string; prefix: string; items: { id: string; text: string }[] }): Promise<{ answers: Record<string, string | null> }>;
  /** One prompt on a worker of its own ("Frag deine Umsätze"); null after an error AICore calls final. */
  prompt(opts: { system: string; text: string; maxTokens?: number }): Promise<{ text: string | null }>;
  progress(): Promise<NanoProgress>;
  addListener(event: 'progress', fn: (progress: NanoProgress) => void): Promise<PluginListenerHandle>;
  addListener(event: 'download', fn: (status: NanoStatus) => void): Promise<PluginListenerHandle>;
}

export const GirovoNano = registerPlugin<GirovoNanoPlugin>('GirovoNano');

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
  /** Key attestation's boot state and the app's signer (DeviceIntegrity.java; lib/device-integrity.ts reads them). */
  integrity(): Promise<IntegrityFacts>;
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
// Fingerprint unlock: a login's PIN, and the further banks' beside it, sealed
// with a key that only a fingerprint opens.

export type BiometricState = { available: boolean; reason?: 'none-enrolled' | 'no-hardware' | 'unavailable' | 'security-update' };

/** One sealed PIN, by its name (a hash). */
export type BiometricItem = { id: string; secret: string };
type PromptOpts = { title: string; subtitle: string; cancel: string };

export interface GirovoBiometricPlugin {
  state(): Promise<BiometricState>;
  /** A new entry for `id` after a fingerprint: `items`, `id`'s own among them. The key dies with a newly enrolled finger. */
  enroll(opts: { id: string; items: BiometricItem[] } & PromptOpts): Promise<{ result: 'enrolled' | 'canceled' }>;
  /** Adds `items` beside `id`'s own after a fingerprint; `missing` when `id` has no entry. */
  seal(opts: { id: string; items: BiometricItem[] } & PromptOpts): Promise<{ result: 'sealed' | 'canceled' | 'invalidated' | 'missing' }>;
  /**
   * `secret`: `id`'s own PIN — sealed by itself in an entry of the old form;
   * `items`: every other one kept beside it.
   */
  unlock(opts: { id: string } & PromptOpts): Promise<{ result: 'unlocked' | 'canceled' | 'invalidated' | 'missing'; secret?: string; items?: BiometricItem[] }>;
  /** `enrolled`: an entry of its own; `held`: kept beside another login's. */
  has(opts: { id: string }): Promise<{ enrolled: boolean; held: boolean }>;
  /** With `item`: that one beside `id`. Without: `id`'s entry and `id` wherever it is kept. */
  remove(opts: { id: string; item?: string }): Promise<void>;
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

// ---------------------------------------------------------------------------
// Girovo Plus: the Play build's supporter subscription (PlusPlugin.java in
// src/play, Play Billing; src/github answers "free"). lib/plus.ts says what
// each state unlocks.

export interface GirovoPlusPlugin {
  /** The state now (the last one Play gave, until it answers again), the offers and the icon. */
  status(): Promise<unknown>;
  /** Play's purchase sheet for a plan; the outcome comes as a "change". */
  buy(opts: { plan: 'monthly' | 'yearly' }): Promise<{ launched: boolean }>;
  /** Play's own page for the subscription. */
  manage(): Promise<void>;
  /** The app icon: the gold one only while Plus is active. */
  setIcon(opts: { icon: 'standard' | 'plus' }): Promise<unknown>;
  /** This installation's ID, and whether an owner key opens Plus on it (scripts/owner-key.mjs). */
  owner(): Promise<{ installId?: unknown; owner?: unknown }>;
  /** An owner key: Plus without a purchase, when it is this installation's; rejected otherwise. */
  setOwnerKey(opts: { key: string }): Promise<unknown>;
  /** Forgets the owner key: Plus is what Play says again. */
  clearOwnerKey(): Promise<unknown>;
  addListener(event: 'change', fn: (status: unknown) => void): Promise<PluginListenerHandle>;
}

export const GirovoPlus = registerPlugin<GirovoPlusPlugin>('GirovoPlus');
