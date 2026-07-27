export {};

// Window Controls Overlay API — not yet in TypeScript's lib.dom.d.ts. Present
// only when Electron's titleBarOverlay is active (electron/main.cjs).
interface WindowControlsOverlay extends EventTarget {
  readonly visible: boolean;
  getTitlebarAreaRect(): DOMRect;
}

declare global {
  interface Window {
    /** Exposed by electron/preload.cjs; undefined outside the desktop shell. */
    electronTitleBar?: {
      setTheme: (isDark: boolean) => void;
    };
  }
  interface Navigator {
    readonly windowControlsOverlay?: WindowControlsOverlay;
  }
}
