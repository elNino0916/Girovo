// Which build this page belongs to. The desktop app and the website are a
// Next.js server rendering the page; the Android app is the same page,
// exported ahead of time for the app's WebView, with the server's route
// handlers running in that WebView (mobile/, scripts/build-android.mjs).
//
// A build-time constant (next.config.ts), so whatever only one build needs
// drops out of the other's bundle.

export const IS_ANDROID = process.env.NEXT_PUBLIC_GIROVO_PLATFORM === 'android';
