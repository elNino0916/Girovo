export {};

declare global {
  interface Window {
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
     * Synchronous preference storage in userData/prefs.json — the packaged
     * app's localStorage does not survive a restart (random port per start).
     * Keys must match /^fints\.[\w.-]{1,80}$/ and values be ≤ 4096 chars;
     * anything else is ignored (get → null). For preferences only, never
     * personal data — that goes in the encrypted vault.
     */
    electronStore?: {
      get: (key: string) => string | null;
      set: (key: string, value: string) => void;
      del: (key: string) => void;
    };
  }
}
