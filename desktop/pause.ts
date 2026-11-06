// Android's "pause" (the app went to the background, written files must
// reach the disk) on the desktop: the window hiding or the page going away.
// Page-side: the server's worker hears of it across the line
// (desktop/host.ts, desktop/capacitor/app.ts).

export function onPause(listener: () => void): () => void {
  const onHide = () => {
    if (document.visibilityState === 'hidden') listener();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', listener);
  return () => {
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', listener);
  };
}
