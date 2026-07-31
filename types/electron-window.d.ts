export {};

declare global {
  interface Window {
    /** Exposed by electron/preload.cjs; undefined outside the desktop shell. */
    electronTitleBar?: {
      setTheme: (isDark: boolean) => void;
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
  }
}
