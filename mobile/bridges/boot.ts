// The app's first second: the splash screen stays until the page has drawn
// itself in the right language and colours (the page is exported in German
// and the light theme, and LocaleProvider and the theme script correct that
// on their first run), then fades.

import { SplashScreen } from '@capacitor/splash-screen';

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function loaded(): Promise<void> {
  if (document.readyState === 'complete') return Promise.resolve();
  return new Promise((resolve) => window.addEventListener('load', () => resolve(), { once: true }));
}

/** Hides the splash once the page has painted after `before` settled. */
export async function revealWhenReady(before: Promise<unknown>[]): Promise<void> {
  // Never longer than this, whatever hangs: a splash that does not go away is
  // a broken app.
  const limit = new Promise<void>((resolve) => setTimeout(resolve, 4000));
  await Promise.race([
    (async () => {
      await Promise.allSettled([loaded(), ...before]);
      // Hydration and LocaleProvider's first effect run right after load.
      await frame();
      await frame();
    })(),
    limit,
  ]);
  await SplashScreen.hide({ fadeOutDuration: 180 });
}
