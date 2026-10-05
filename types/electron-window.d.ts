export {};

declare global {
  /** The desktop app's updater as electron/updater.cjs reports it. */
  type ElectronUpdatePhase = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'installing';

  interface ElectronUpdateState {
    /** The running version. */
    current: string;
    /** nsis: installed · portable: the portable .exe · manual: other packaging · dev: unpackaged. */
    kind: 'nsis' | 'portable' | 'manual' | 'dev';
    /** Automatic checks (at start, then every 6 hours). */
    auto: boolean;
    phase: ElectronUpdatePhase;
    /** When GitHub last answered, ms since the epoch. */
    checkedAt: number | null;
    /** The newer release, while there is one. */
    release: {
      version: string;
      name: string;
      /** The release notes, Markdown as written on GitHub. */
      notes: string;
      url: string;
      publishedAt: string | null;
      /** Bytes of the file this install would download; null when none fits. */
      size: number | null;
      /** False: only the download page can be offered (no verifiable file for this install). */
      canInstall: boolean;
    } | null;
    received: number;
    total: number;
    /** The folder a portable update was saved to. */
    location: string | null;
    error: { during: 'check' | 'download' | 'install'; message: string } | null;
    /** An install was started for this version, and this start is not it (the installer failed or was cancelled). */
    failedInstall: string | null;
    /** This start is the result of an update to `version`. */
    installed: {
      version: string;
      from: string;
      notes: string;
      url: string;
      /** The portable .exe that was replaced (full path); it is still on disk. */
      previousFile: string | null;
    } | null;
  }

  interface Window {
    /**
     * Exposed by electron/preload.cjs; undefined outside the desktop shell.
     * Every call answers with the updater's state (null if the main process
     * refused the caller); onState hears every change and returns its
     * unsubscribe.
     */
    electronUpdater?: {
      getState: () => Promise<ElectronUpdateState | null>;
      check: () => Promise<ElectronUpdateState | null>;
      download: () => Promise<ElectronUpdateState | null>;
      cancel: () => Promise<ElectronUpdateState | null>;
      install: () => Promise<ElectronUpdateState | null>;
      setAuto: (on: boolean) => Promise<ElectronUpdateState | null>;
      openRelease: () => Promise<ElectronUpdateState | null>;
      onState: (callback: (state: ElectronUpdateState) => void) => () => void;
    };
    /**
     * Exposed by electron/preload.cjs; undefined outside the desktop shell.
     * `requestAttention(true)` flashes the taskbar button while the window is
     * not the one in front, until it is focused; `false` stops it. Never
     * brings the window forward.
     */
    electronWindow?: {
      requestAttention: (on: boolean) => void;
    };
    /** Exposed by electron/preload.cjs; undefined outside the desktop shell. */
    electronTitleBar?: {
      /** `dim`: how many dialog scrims lie over the caption buttons (0 = none). */
      setTheme: (isDark: boolean, dim?: number) => void;
    };
    /**
     * Exposed by electron/preload.cjs; undefined outside the desktop shell.
     * Renders the current page to PDF via Chromium's printToPDF and prompts a
     * native save dialog — bypasses the OS print dialog and its "Microsoft
     * Print to PDF" driver entirely (see main.cjs's pdf:export handler).
     */
    electronPDF?: {
      exportPDF: (suggestedName: string) => Promise<
        | { ok: true; filePath: string }
        | { ok: false; canceled: true }
        | { ok: false; error: string }
      >;
    };
    /**
     * Exposed by electron/preload.cjs; undefined outside the desktop shell.
     * Saves a file the app made (the CSV export) through a native Save-As
     * and answers once it is written or the dialog was dismissed — see
     * main.cjs's file:save handler and saveFile() in lib/download.ts.
     */
    electronFiles?: {
      save: (suggestedName: string, bytes: Uint8Array) => Promise<
        | { ok: true }
        | { ok: false; canceled: true }
        | { ok: false; error: string }
      >;
    };
    /**
     * Exposed by electron/preload.cjs; undefined outside the desktop shell.
     * Errors are always reported (scrubbed in the main process); events count
     * only after the user's yes, which `consent()` answers synchronously.
     * The main process accepts only the events and fields it declares
     * (electron/telemetry.cjs).
     */
    electronTelemetry?: {
      consent: () => 'on' | 'off' | 'unasked';
      setConsent: (on: boolean) => Promise<'on' | 'off' | 'unasked' | null>;
      event: (name: string, props?: Record<string, string | number | boolean>) => void;
      error: (err: { name?: string; message?: string; stack?: string }) => void;
    };
    /**
     * Exposed by electron/preload.cjs; undefined outside the desktop shell.
     * Synchronous preference storage in userData/prefs.json — the packaged
     * app's localStorage does not survive a restart (random port per start).
     * Keys must match /^fints\.[\w.-]{1,80}$/ and values be ≤ 4096 chars;
     * anything else is ignored (get → null). For preferences, plus the bank
     * and login name the login screen fills in before a PIN exists; any
     * other personal data goes in the encrypted vault.
     */
    electronStore?: {
      get: (key: string) => string | null;
      set: (key: string, value: string) => void;
      del: (key: string) => void;
    };
  }
}
