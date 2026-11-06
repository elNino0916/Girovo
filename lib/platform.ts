// Which build this page belongs to. The desktop app and the website are a
// Next.js server rendering the page; the Android app is the same page,
// exported ahead of time for the app's WebView, with the server's route
// handlers running in that WebView (mobile/, scripts/build-android.mjs).
//
// A build-time constant (next.config.ts), so whatever only one build needs
// drops out of the other's bundle.

export const IS_ANDROID = process.env.NEXT_PUBLIC_GIROVO_PLATFORM === 'android';

/**
 * The Tauri desktop app (6.0): the desktop's page, exported ahead of time
 * like the Android app's, with the route handlers running in the window
 * (desktop/, scripts/build-desktop.mjs). Everything else about it is the
 * desktop's: the page meets the shell through the same window.electron*
 * bridges the Electron shell gave it.
 */
export const IS_DESKTOP_APP = process.env.NEXT_PUBLIC_GIROVO_PLATFORM === 'desktop';

/** The route handlers answer inside this page rather than from a server: the Android app and the Tauri desktop app. */
export const IN_PAGE_SERVER = IS_ANDROID || IS_DESKTOP_APP;
