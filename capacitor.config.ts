import type { CapacitorConfig } from '@capacitor/cli';

// The Android app: the page exported for the phone (GIROVO_TARGET=android,
// next.config.ts) plus the phone runtime (mobile/), in a Capacitor shell.
// scripts/build-android.mjs builds both into .next-android and syncs them here.
const config: CapacitorConfig = {
  appId: 'de.elnino0916.android.girovo',
  appName: 'Girovo',
  webDir: '.next-android',
  // The page is served from https://localhost inside the app — a secure
  // context, so WebCrypto and the clipboard work as on the desktop.
  //
  // GIROVO_DEV_SERVER (a debug build only, e.g. http://10.0.2.2:3100 for the
  // emulator): the page comes from `npm run android:preview` on the computer
  // instead, for looking at the Android build of the design preview on a
  // device. Debug builds allow that one cleartext host (src/debug/res/xml).
  server: process.env.GIROVO_DEV_SERVER
    ? { androidScheme: 'https', url: process.env.GIROVO_DEV_SERVER, cleartext: true }
    : { androidScheme: 'https' },
  android: {
    allowMixedContent: false,
    // Release builds cannot be inspected from a computer; debug builds can.
    webContentsDebuggingEnabled: undefined,
  },
  plugins: {
    // Bank traffic goes through the app's own GirovoHttp plugin
    // (mobile/server/fetch.ts); Capacitor's fetch patch stays off so nothing
    // else is rerouted behind its back.
    CapacitorHttp: { enabled: false },
    // Covers the first frame — the page starts in German and in the light
    // theme until it has read the phone's language and Material You colours.
    SplashScreen: { launchAutoHide: false, backgroundColor: '#0a2c5e', showSpinner: false },
  },
};

export default config;
