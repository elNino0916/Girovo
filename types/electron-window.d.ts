export {};

declare global {
  interface Window {
    /** Exposed by electron/preload.cjs; undefined outside the desktop shell. */
    electronTitleBar?: {
      setTheme: (isDark: boolean) => void;
    };
  }
}
