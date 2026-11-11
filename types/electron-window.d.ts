export {};

declare global {
  /** The desktop app's updater as src-tauri/src/updater reports it. */
  type ElectronUpdatePhase = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'installing';

  /**
   * Which releases the updater offers (Einstellungen → Update-Kanal): 'stable',
   * 'preview' (shown as Nightly), or a channel girovo.de lists
   * (docs/update-channels.md).
   */
  type UpdateChannel = string;

  /** A channel the updater can offer, as the shell reports it. */
  interface UpdateChannelInfo {
    id: UpdateChannel;
    /** Stabil and Nightly: named by the app's own texts. */
    builtin: boolean;
    /** Choosing it comes with usage data, as Nightly does. */
    usage: boolean;
    /** A listed channel's name and one-line hint; missing for the built-in ones. */
    name?: { de: string; en: string };
    hint?: { de: string; en: string };
  }

  interface ElectronUpdateState {
    /** The running version. */
    current: string;
    /**
     * nsis: installed · manual: other packaging (the Linux packages) · dev: unpackaged ·
     * android: the Android app from GitHub (mobile/bridges/updates.ts provides this bridge there).
     */
    kind: 'nsis' | 'manual' | 'dev' | 'android';
    /** Automatic checks (at start, then every 6 hours). */
    auto: boolean;
    /**
     * A Setup.exe or .girovoupdate picked to install (chooseFile, dropped on
     * the window, or double-clicked): being checked against Girovo's signed
     * releases, ready (its version; older or the installed one), or refused
     * with the reason. The desktop app only.
     */
    file?: {
      phase: 'checking' | 'ready' | 'refused';
      name: string;
      version: string | null;
      older: boolean;
      same: boolean;
      message: string | null;
    } | null;
    /** The update being saved as a .girovoupdate (saveBundle); undefined from shells without it. */
    saving?: {
      phase: 'working' | 'done' | 'failed';
      name: string;
      message: string | null;
    } | null;
    /** Staged releases at once (setEarly); undefined from shells and builds from before it. */
    early?: boolean;
    channel: UpdateChannel;
    /** The channels to offer, Stabil and Nightly first; undefined from shells before 6.2.0. */
    channels?: UpdateChannelInfo[];
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
      /** An older stable release, offered as the way back from a preview (the desktop's "Stabil"). */
      back?: boolean;
      /**
       * The start will not install this release by itself: its install failed
       * before, or the user went back to an older version from it. It takes a
       * click, so nothing may say "at the next start". The desktop app only.
       */
      waitsForUser?: boolean;
    } | null;
    received: number;
    total: number;
    error: { during: 'check' | 'download' | 'install'; message: string } | null;
    /** An install was started for this version, and this start is not it (the installer failed or was cancelled). */
    failedInstall: string | null;
    /** This start is the result of an update to `version`. */
    installed: {
      version: string;
      from: string;
      notes: string;
      url: string;
    } | null;
  }

  /**
   * Girovo Next's local model on the desktop (src-tauri/src/gemma.rs), as
   * electronGemma.getState and onState report it.
   */
  interface GirovoGemmaState {
    /**
     * absent: not downloaded (or only partly: a cancelled download goes on from
     * where it stopped) · downloading · ready: runtime and model on the disk ·
     * error: the last download failed, `error` says why; download() tries again.
     */
    state: 'absent' | 'downloading' | 'ready' | 'error';
    /** While downloading: llama.cpp's runtime first (about 36 MB), then the model (about 3.4 GB). */
    phase?: 'runtime' | 'model';
    /**
     * Bytes of the file being downloaded now (the phase's, not both together):
     * what is on the disk, and all of it. The model's total is an estimate
     * (3.35 GB) until the server says its exact size.
     */
    received: number;
    total: number;
    /** state 'error' (the download failed) or `unavailable`: one short line in the app's language, ready to show. */
    error?: string;
    /**
     * Bytes of a download that stopped on its way (cancelled or failed) and
     * goes on from there with the next download(); 0 when there is none and
     * while downloading. Above 0, offer "Löschen" (remove()).
     */
    partial: number;
    /**
     * The model could start neither on the GPU nor on the CPU in this run:
     * prompt() answers null at once until the app starts again or remove().
     * state stays 'ready'; `error` says why.
     */
    unavailable: boolean;
    /**
     * Whether the model runs on the GPU; null until a start has told. False
     * also once the GPU failed, hung or answered too slowly (busy): the CPU
     * then for the rest of this run; the next app start tries the GPU again.
     */
    gpu: boolean | null;
    /** The server is up: the next answer comes without the start's wait. It stops after 5 minutes without a prompt. */
    warm: boolean;
    /** The server is starting for a prompt: the first start on a GPU takes about half a minute. */
    starting: boolean;
    /** This system has a runtime to download (Windows and Linux, x64 and arm64); false: hide the feature. */
    supported: boolean;
  }

  /** window.electronGemma (src-tauri/src/bridge.js). */
  interface GirovoGemmaBridge {
    getState: () => Promise<GirovoGemmaState>;
    /** Starts the download (runtime, then model) unless ready or under way; answers at once, progress comes through onState. */
    download: () => Promise<GirovoGemmaState>;
    /** Stops the download; what arrived stays for the next download(). The state turns 'absent' shortly after, through onState. */
    cancel: () => Promise<GirovoGemmaState>;
    /**
     * Stops the server and the download and deletes the runtime, the model and
     * any partial file. Works in every state (absent and error too); a
     * download() asked for while it runs is ignored.
     */
    remove: () => Promise<GirovoGemmaState>;
    /**
     * One question, one answer: the model's text, trimmed, or null when not
     * ready, unavailable, on any failure, or for an empty answer. Prompts run
     * one at a time; the first one starts the server (up to 90 s, twice that
     * when the GPU fails and the CPU takes over), then each answer has 30 s;
     * a server that takes longer is ended and started afresh for the next
     * prompt (on the CPU if it was on the GPU). `json`: asks
     * the server for a JSON object (response_format). Temperature 0, thinking off.
     */
    prompt: (system: string, user: string, maxTokens: number, json?: boolean) => Promise<string | null>;
    /** Hears every change, download progress included (at most four a second); returns its unsubscribe. */
    onState: (callback: (state: GirovoGemmaState) => void) => () => void;
  }

  interface Window {
    /**
     * Girovo Next's "Fragen" with Gemma 4 E2B on this computer (src-tauri/src/gemma.rs).
     * Undefined outside the desktop shell (and in shells from before it).
     */
    electronGemma?: GirovoGemmaBridge;
    /**
     * Exposed by src-tauri/src/bridge.js (the Electron preload's names); undefined outside the desktop shell.
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
      /** The installed Windows app: quits, and the start window of the next start installs the update. */
      restartToUpdate?: () => Promise<ElectronUpdateState | null>;
      setAuto: (on: boolean) => Promise<ElectronUpdateState | null>;
      /** "Neueste Updates sofort erhalten": a staged release at once (docs/updater-v2.md). Absent in shells from before it. */
      setEarly?: (on: boolean) => Promise<ElectronUpdateState | null>;
      /** "Update aus Datei installieren …": the native file dialog, then the check (state.file). The installed Windows app only. */
      chooseFile?: () => Promise<ElectronUpdateState | null>;
      /** Installs the file state.file is ready with: the app quits, girovo-update.exe installs it. */
      installFile?: () => Promise<ElectronUpdateState | null>;
      dismissFile?: () => Promise<ElectronUpdateState | null>;
      /** "Als Datei speichern": asks where, downloads the update, writes the .girovoupdate (state.saving). The installed Windows app only. */
      saveBundle?: () => Promise<ElectronUpdateState | null>;
      /** The page has said how the save went. */
      dismissSaved?: () => Promise<ElectronUpdateState | null>;
      /** Answers once the check in the new channel is done. */
      setChannel: (channel: UpdateChannel) => Promise<ElectronUpdateState | null>;
      openRelease: () => Promise<ElectronUpdateState | null>;
      onState: (callback: (state: ElectronUpdateState) => void) => () => void;
    };
    /**
     * Exposed by src-tauri/src/bridge.js (the Electron preload's names); undefined outside the desktop shell.
     * `requestAttention(true)` flashes the taskbar button while the window is
     * not the one in front, until it is focused; `false` stops it. Never
     * brings the window forward.
     */
    /** Exposed by src-tauri/src/bridge.js; undefined outside the desktop shell. */
    electronApp?: {
      /** "Girovo zurücksetzen": deletes everything Girovo keeps on this computer and starts it again. */
      reset: () => Promise<void>;
    };
    electronWindow?: {
      requestAttention: (on: boolean) => void;
      /** Whether the shell has the window on screen; WebView2's own visibility says yes for a hidden one. */
      shown?: () => boolean;
    };
    /** Exposed by src-tauri/src/bridge.js (the Electron preload's names); undefined outside the desktop shell. */
    electronTitleBar?: {
      /** `dim`: how many dialog scrims lie over the caption buttons (0 = none). */
      setTheme: (isDark: boolean, dim?: number) => void;
    };
    /**
     * The Tauri shell on Windows (src-tauri/src/bridge.js, frame.rs): the page
     * draws the caption buttons (components/shell/CaptionButtons.tsx), the
     * shell does what they do and lays Windows 11's snap layouts over the
     * maximize button. Undefined everywhere else.
     */
    electronCaption?: {
      /** The last theme and dim the page reported through electronTitleBar.setTheme. */
      theme: () => { dark: boolean; dim: number };
      minimize: () => Promise<void>;
      toggleMaximize: () => Promise<void>;
      close: () => Promise<void>;
      isMaximized: () => Promise<boolean>;
      /** Where the maximize button is, in physical pixels of the client area. */
      setMaxRect: (rect: { x: number; y: number; width: number; height: number }) => Promise<void>;
      /** Returns its own unsubscribe. */
      on: (what: 'maximized' | 'hover' | 'press', callback: (value: boolean) => void) => () => void;
    };
    /**
     * Exposed by src-tauri/src/bridge.js (the Electron preload's names); undefined outside the desktop shell.
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
     * Exposed by src-tauri/src/bridge.js (the Electron preload's names); undefined outside the desktop shell.
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
     * Exposed by src-tauri/src/bridge.js (the Electron preload's names); undefined outside the desktop shell.
     * Errors are always reported (scrubbed in the main process); events count
     * only after the user's yes, which `consent()` answers synchronously.
     * The main process accepts only the events and fields it declares
     * (src-tauri/src/telemetry.rs).
     */
    electronTelemetry?: {
      consent: () => 'on' | 'off' | 'unasked';
      setConsent: (on: boolean) => Promise<'on' | 'off' | 'unasked' | null>;
      event: (name: string, props?: Record<string, string | number | boolean>) => void;
      error: (err: { name?: string; message?: string; stack?: string }) => void;
    };
    /**
     * Exposed by src-tauri/src/bridge.js (the Electron preload's names); undefined outside the desktop shell.
     * The secret of this user account that the further banks' PINs are sealed
     * with, besides the first login's PIN (src-tauri/src/secret.rs,
     * lib/linked-unlock.ts): base64, or null where the system has no
     * protected store for it (or the main process refused the caller).
     */
    electronLinkedUnlock?: {
      secret: () => Promise<string | null>;
    };
    /**
     * Exposed by src-tauri/src/bridge.js (the Electron preload's names); undefined outside the desktop shell.
     * Windows Hello (src-tauri/src/hello.rs): whether this Windows has it
     * set up, and the key a gesture brings about — enroll makes the Windows
     * Hello key the first time — for lib/windows-hello.ts to keep the first
     * login's PIN under, with the secret above. Never a PIN.
     */
    /**
     * Exposed by src-tauri/src/bridge.js (the Electron preload's names); undefined outside the desktop shell.
     * "Neue Umsätze melden" (src-tauri/src/background.rs): plans or stops the
     * six-hourly checks, with the notification area and the start with
     * Windows; answers whether they are on now.
     */
    /**
     * Exposed by src-tauri/src/bridge.js (the Electron preload's names); undefined outside the desktop shell.
     * Sync between devices (lib/sync.ts): "Direkt im WLAN" on — answering the
     * port and this computer's private addresses — or off; a folder picked by
     * the user; this computer's name.
     */
    electronSync?: {
      lan: (on: boolean) => Promise<{ port: number; addresses: string[] } | null>;
      pickFolder: () => Promise<string | null>;
      deviceName: () => Promise<string | null>;
    };
    electronBackground?: {
      set: (on: boolean) => Promise<boolean>;
      /** The window closed into the notification area (main.cjs): the page logs out. */
      onHidden?: (callback: () => void) => () => void;
      /** A system notice while the window is hidden (src-tauri/src/background.rs background_notice). */
      notice?: (notice: { title: string; text: string }) => Promise<void>;
    };
    /**
     * Security keys (src-tauri/src/security_key.rs): whether this Windows can
     * use one, and the key a touch brings about, for lib/security-key.ts to
     * keep the first login's PIN under, with the secret above. Never a PIN.
     */
    electronSecurityKey?: {
      available: () => Promise<boolean>;
      /** `exclude`: the login's keys already set up. Two touches. */
      register: (salt: string, exclude: string[]) => Promise<{ result: 'registered' | 'canceled' | 'exists' | 'unsupported' | 'unavailable' | 'busy' | 'failed'; credential?: string; key?: string; code?: string }>;
      open: (salt: string, credentials: string[]) => Promise<{ result: 'opened' | 'canceled' | 'wrong' | 'unsupported' | 'unavailable' | 'busy' | 'failed'; credential?: string; key?: string; code?: string }>;
    };
    electronHello?: {
      available: () => Promise<boolean>;
      /** `code`: the HRESULT Windows threw, where it threw ("0x80090011"). */
      enroll: () => Promise<{ result: 'enrolled' | 'canceled' | 'failed' | 'unavailable'; key?: string; fresh?: boolean; code?: string }>;
      /** 'busy': another unlock still waits for its gesture; its prompt was brought to the front. */
      unlock: () => Promise<{ result: 'unlocked' | 'canceled' | 'invalidated' | 'missing' | 'failed' | 'busy'; key?: string; code?: string }>;
    };
    /**
     * Exposed by src-tauri/src/bridge.js (the Electron preload's names); undefined outside the desktop shell.
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
