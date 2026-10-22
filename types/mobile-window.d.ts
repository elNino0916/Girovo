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
    /**
     * The category guess: Gemini Nano through AICore (mobile/bridges/categories.ts)
     * — whether this phone has it, AICore's download, and how far the bookings
     * waiting for it are.
     */
    categories: {
      status(): Promise<GirovoNanoStatus>;
      onStatus(fn: (s: GirovoNanoStatus) => void): () => void;
      download(): Promise<GirovoNanoStatus>;
      progress(): Promise<GirovoNanoProgress>;
      onProgress(fn: (p: GirovoNanoProgress) => void): () => void;
    };
    /**
     * Whether this phone is one a PIN is safe on, and whether this is Girovo
     * as elNino0916 builds it (mobile/bridges/integrity.ts). Checked once per
     * start; null when the check itself failed.
     */
    integrity(): Promise<GirovoIntegrity | null>;
    /**
     * On an unsafe phone: lets Girovo keep its data anyway, for the verdict
     * the warning showed (null: keep nothing again), and restarts the app.
     */
    chooseSaving(verdict: import('../lib/device-integrity').DeviceVerdict | null): void;
    /**
     * Girovo Plus (lib/plus.ts, mobile/bridges/plus.ts): the Play build's
     * subscription — its state, Play's offers, the purchase, the gold icon.
     */
    plus: {
      status(): Promise<import('../lib/plus').PlusStatus>;
      onChange(fn: (s: import('../lib/plus').PlusStatus) => void): () => void;
      buy(plan: import('../lib/plus').PlusPlan): Promise<boolean>;
      manage(): Promise<void>;
      setIcon(icon: import('../lib/plus').PlusIcon): Promise<import('../lib/plus').PlusStatus | null>;
      openGitHub(): Promise<void>;
    };
    /**
     * One question to Gemini Nano, on a worker of its own ("Frag deine
     * Umsätze", lib/nano-ask.ts): its answer, or null when AICore gave none.
     */
    ask(system: string, text: string, maxTokens?: number): Promise<string | null>;
    /** Opens Android AICore in Google Play, where Nano is missing or too old for questions. */
    openAICore(): Promise<void>;
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
  type GirovoNanoStatus = import('../mobile/native').NanoStatus;
  type GirovoNanoProgress = import('../mobile/native').NanoProgress;

  interface Window {
    girovoMobile?: GirovoMobile;
  }
}
