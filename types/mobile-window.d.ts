export {};

declare global {
  /**
   * What the Android app's runtime (mobile/runtime.ts) adds to the page;
   * undefined on the desktop and the website. Only the Android build's own
   * controls use it — everything the desktop shell offers the page as well
   * (saving files, PDFs) the runtime provides under the same names as the
   * shell does (types/electron-window.d.ts).
   */
  interface GirovoMobile {
    /** Resolves once the route handlers in the page answer (lib/client-api.ts waits for it). */
    ready: Promise<void>;
    /** Hands a file to another app through Android's share sheet. */
    share(name: string, blob: Blob, title?: string): Promise<void>;
    /** Fingerprint login (mobile/bridges/biometric.ts). */
    biometric: {
      state(): Promise<GirovoBiometricState>;
      enrolled(blz: string, userId: string): Promise<boolean>;
      /** Seals the PIN of this session's login behind a fingerprint. */
      enroll(sessionId: string, texts: GirovoPromptTexts): Promise<'enrolled' | 'canceled' | 'failed'>;
      unlock(blz: string, userId: string, texts: GirovoPromptTexts): Promise<{ result: 'unlocked' | 'canceled' | 'invalidated' | 'missing'; pin?: string }>;
      forget(blz: string, userId: string): Promise<void>;
    };
    /** The category model as a download (mobile/bridges/model.ts). */
    model: {
      bytes: number;
      status(): Promise<GirovoModelStatus>;
      onProgress(fn: (s: GirovoModelStatus) => void): () => void;
      download(): Promise<GirovoModelStatus>;
      cancel(): Promise<void>;
      remove(): Promise<void>;
    };
    /**
     * Whether this phone is one a PIN is safe on, and whether this is Girovo
     * as elNino0916 builds it (mobile/bridges/integrity.ts). Checked once per
     * start; null when the check itself failed.
     */
    integrity(): Promise<GirovoIntegrity | null>;
    /** The Google Play build: whether Play has a newer version, and Play's own update flow. */
    playUpdate(): Promise<{ available: boolean; start: () => Promise<'started' | 'canceled' | 'failed'> }>;
    /**
     * While an approval in the bank's app is awaited: keeps the app's network
     * when the user switches to that app (Android 15 cuts it off otherwise).
     */
    approval: {
      hold(texts: { title: string; text: string }): Promise<boolean>;
      release(): Promise<void>;
    };
    /**
     * How the app was opened beyond its icon: a shortcut (Überweisen, GiroCode
     * scannen, Geld anfordern) or an invoice shared with it. The launch that
     * opened the app is kept until something listens.
     */
    launch: {
      on(fn: (launch: GirovoLaunch) => void): () => void;
      /** A shared file, read through Android's content provider. */
      readShared(uri: string, mime?: string): Promise<File>;
    };
    /** A PDF's first pages as PNG images, for reading a GiroCode off them. */
    pdfPages(pdf: Blob): Promise<Blob[]>;
    /** Google's code scanner: a QR code's text. */
    scanner: {
      scan(): Promise<{ value: string } | { canceled: true } | { unavailable: true } | { failed: true }>;
    };
    /** A short system touch; follows the phone's touch-feedback setting. */
    haptic(kind: 'confirm' | 'reject' | 'threshold'): void;
  }

  type GirovoLaunch =
    | { kind: 'transfer' | 'scan' | 'request' }
    | { kind: 'file'; uri: string; mime?: string };

  type GirovoBiometricState = { available: boolean; reason?: 'none-enrolled' | 'no-hardware' | 'unavailable' | 'security-update' };
  type GirovoPromptTexts = { title: string; subtitle: string; cancel: string };
  type GirovoIntegrity = import('../lib/device-integrity').Integrity;
  type GirovoModelStatus = { installed: boolean; files: { name: string; size: number }[]; downloading: boolean; received: number; total: number };

  interface Window {
    girovoMobile?: GirovoMobile;
  }
}
