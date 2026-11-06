// @capacitor/app for the desktop runtime: Android's "pause" (the app went to
// the background, written files must reach the disk) is the window hiding or
// the page going away here.

type Listener = () => void;

export const App = {
  addListener(event: string, listener: Listener): Promise<{ remove: () => Promise<void> }> {
    if (event !== 'pause') return Promise.resolve({ remove: async () => {} });
    const onHide = () => {
      if (document.visibilityState === 'hidden') listener();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', listener);
    return Promise.resolve({
      remove: async () => {
        document.removeEventListener('visibilitychange', onHide);
        window.removeEventListener('pagehide', listener);
      },
    });
  },
};
