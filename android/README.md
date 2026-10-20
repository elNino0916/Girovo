# Girovo for Android

The Android app is Girovo's own page and Girovo's own server code, on the
phone. Nothing about a session leaves the phone except the FinTS messages to
the bank — the same promise the desktop app makes.

- **The page** is the app's Next.js page, exported ahead of time for the phone
  (`GIROVO_TARGET=android`, `next.config.ts`) and shown in the app's WebView.
- **The server** is the desktop server's route handlers (`app/api/**/route.ts`),
  unchanged, bundled for the WebView by `scripts/build-mobile.mjs` into
  `mobile-runtime.js`. The page's `fetch('/api/…')` is answered inside the page
  (`mobile/server`), and requests to the bank leave through Android's own HTTPS
  stack (`HttpPlugin.java`), which the WebView's CORS rules do not bind.
- **Node's modules** the handlers import are replaced at bundle time
  (`mobile/shims`): `node:fs` by a file tree in memory written through to the
  app's private storage, `node:crypto` by the audited @noble libraries (sealing
  exactly what Node seals — `mobile/shims/crypto.test.ts`), `onnxruntime-node`
  by ONNX Runtime for Android.
- **What the desktop shell gives the page** — saving a file, a PDF — the
  runtime gives it under the same names (`mobile/bridges`), the Android way:
  the system's "save to" picker, Android's print dialog ("Save as PDF").
- **What only a phone has** — the back gesture, Material You, fingerprint
  login, the share sheet — is in `mobile/bridges` and the plugins here.

```
app/, components/, lib/        the app — the same files as the desktop's
app/android.css                Material 3 Expressive for <html data-platform="android"> only
mobile/runtime.ts              what the Android page loads before the app
  server/                      the route handlers in the page, the fetch router
  shims/                       node:fs, node:crypto, … for the WebView
  bridges/                     files, PDFs, back, Material You, ripple, fingerprint,
                               the category model download, updates
android/                       the Capacitor project
  app/src/main/java/…/girovo/  HttpPlugin, DevicePlugin (+ DeviceIntegrity: key attestation, signer), BiometricPlugin, ModelPlugin
  app/src/github/…             UpdaterPlugin: APK updates from GitHub
  app/src/play/…               UpdaterPlugin: Google Play's in-app update
scripts/build-android.mjs      the whole build
scripts/build-m3e-css.mjs      the M3 Expressive springs in app/material.css
```

### Material 3 Expressive

The look is Material 3 Expressive with the values of Compose's material3
token sources (androidx), not an imitation of them: the expressive motion
scheme's springs, the corner scale, the type scale with its emphasized
styles, and the specs of the flexible navigation bar, buttons and their press
shapes, connected button groups, filter chips, outlined text fields, the
switch, menus, dialogs, bottom sheets, the snackbar, the loading indicator
and the wavy progress indicator. They are applied by `app/android.css` to
Girovo's own components, which the desktop shares — `components/ui.tsx` gives
the stylesheet its hooks (`data-size`, `data-segmented`, `data-field`, …).

The colours are the phone's: on Android 14 and later the roles it publishes
(`system_primary_light`, `system_surface_container_high_dark`, …) as they are,
on Android 12 and 13 roles made from its tonal palettes.

## Build

Needs Node, and Android Studio (or the Android SDK with a JDK 21+). The SDK
packages the project names are fetched by Gradle on the first build.

```bash
npm run android
```

builds a debug APK of the GitHub flavour and installs it on the connected
phone or emulator (`adb`). The steps:

1. `GIROVO_TARGET=android next build` exports the page into `.next-android/`
2. `scripts/build-mobile.mjs` writes `mobile-runtime.js` beside it
3. `npx cap sync android` copies both into the Android project
4. Gradle builds the app

`node scripts/build-android.mjs --web-only` stops after step 3, for Android
Studio to build and run from there. `--flavor play` builds the Google Play
flavour.

Gradle runs on Android Studio's own JDK (`jbr`) unless `JAVA_HOME` says
otherwise. The wrapper is Gradle 9.5: Android Studio's JDK 25 needs Gradle
9.1 or later, and the Android Gradle plugin 8.x stops at Gradle 9.5.

### The Android look in a browser

```bash
npm run android:preview
```

serves the Android build of the page at <http://localhost:3100>. With the
design preview (`/design-preview`) and the browser at phone width it shows the
Material 3 Expressive layer on the preview's mock data. Material You's colours come from
the phone; in the browser the page shows Girovo's palette unless a palette is
injected (`mobile/bridges/material-you.ts` writes the stylesheet the phone uses).

### Inside the running app

A debug build's WebView can be inspected from Chrome on the computer:
`chrome://inspect` lists it while the phone is connected over `adb`.

## Release builds

A release is signed with your own upload key. Create it once and keep it
safe — Google Play and every installed GitHub APK are tied to it:

```bash
keytool -genkeypair -v -keystore girovo-upload.jks -alias girovo -keyalg RSA -keysize 4096 -validity 10000
```

and put `android/keystore.properties` (never committed) beside this file:

```properties
storeFile=../girovo-upload.jks
storePassword=…
keyAlias=girovo
keyPassword=…
```

Then

```bash
npm run android:release
```

writes both releases to `dist/`:

| File | Where it goes |
|------|---------------|
| `Girovo-<version>-android.apk` | GitHub release, beside `Setup.exe`. arm64-v8a, every current phone. The name is what the app's updater looks for. |
| `Girovo-<version>-play.aab` | The Play Console. Play serves each device its own ABI. |

The version is `package.json`'s; the version code counts it as `MMmmpp × 10`
(5.2.2 → 502020), so every release is higher than the last.

## Distribution

The app ID is `de.elnino0916.android.girovo` in both flavours. It can never
change on Google Play.

### GitHub (the `github` flavour)

The app checks the repository's latest release at start and every six hours
(Sitzung → Updates can turn that off), with the desktop's own rules
(`electron/update-logic.cjs`). It downloads `Girovo-<version>-android.apk`,
keeps it only when its size and SHA-256 are what GitHub published for it, and
hands it to Android's installer — which refuses it unless it is signed with
the same key as the installed app. The first time, Android asks to allow
Girovo to install apps (`REQUEST_INSTALL_PACKAGES`, in this flavour only).

### Google Play (the `play` flavour)

Play installs the updates; this build has no updater of its own (Play does not
allow one) and offers Play's in-app update in the Sitzung panel when Play has
a newer version.

Before the first upload:

- **Play App Signing.** Let Google create the app signing key, or upload your
  own. If both the GitHub APK and the Play app should update over each other,
  the GitHub APK must be signed with the same key Play uses to sign — upload
  your own key to Play App Signing for that. Otherwise switching between them
  means uninstalling (and with it the phone's remembered device and vault).
  The app's own integrity check (`lib/device-integrity.ts`) knows Girovo's
  release key; a Play build signed with Google's key counts as genuine when
  Google Play installed it.
- **Developer account.** Google asks developers of apps that offer financial
  services, banking included, to register as an organisation (D-U-N-S
  number). A personal account may be refused for this app. A personal account
  created after November 2023 also has to run a closed test with at least 12
  testers for 14 days before the first production release.
- **App content declarations:**
  - *Financial features:* the app shows bank accounts and makes transfers
    through the user's own bank (FinTS); it offers no financial products of
    its own.
  - *Data safety:* nothing is collected by the developer. Account data goes
    from the phone straight to the user's bank at the user's request. With
    the user's consent, counterparty names that look like companies go to
    Brandfetch for logos (lib/merchants.ts). The category model is downloaded
    from Hugging Face on request. No analytics and no crash reporting in the
    Android app.
  - *Target API level:* the project targets SDK 36.
  - *Foreground service:* one, of type `shortService`, only while the user
    approves an order in their bank's app (see "On the phone" below).
- **Store listing:** the icon is `android/store/icon-512.png`
  (`scripts/build-android-assets.mjs` draws it, and the launcher icon, from
  `lib/brand-mark.ts`).

## On the phone

- **Storage.** The remembered device profiles, the vault and the kept Umsätze
  are the desktop's files, sealed with the PIN, in the app's private storage
  (`files/fints-state`). No backup or device transfer carries them
  (`res/xml/data_extraction_rules.xml`).
- **Recent apps.** The overview shows a blank card for Girovo (Android 13+).
  Screenshots stay possible; "Beträge ausblenden" is there for showing the
  screen to someone.
- **Network.** Only https leaves the app, against the system's certificate
  authorities (`res/xml/network_security_config.xml`).
- **Approving in the bank's app.** From Android 15 an app in the background
  has no network: about five seconds after the user switches to S-pushTAN,
  Android destroys Girovo's connections and every "approved yet?" to the bank
  would fail. While an approval is awaited, Girovo therefore runs a short
  foreground service (`ApprovalService`, type `shortService`, at most about
  three minutes) with a quiet "Warte auf deine Freigabe" notification, which
  keeps its network. A bank request that still fails before it leaves the
  phone (no address, no connection) is sent again, byte for byte, once
  Girovo is back in front (`mobile/server/fetch.ts`); and the bank's minute
  to start answering is timed natively (`HttpPlugin.java`), not by a page
  timer that stops in the background.
- **Fingerprint login** (opt-in, Sitzung panel) keeps the PIN of one login,
  sealed with a Keystore key that only a strong biometric opens and that
  Android destroys when a fingerprint is added. A stored PIN the bank refuses
  is deleted at once, so it is never tried twice. Without the switch the PIN
  lives only in memory, as on the desktop.
- **The category model** is an optional download (Sitzung panel, about
  300 MB from Hugging Face, the revision `scripts/category-models.json` pins,
  each file checked against its digest). Without it the keyword rules sort
  alone, as on a desktop without the model.
- **Material You** wherever the phone has wallpaper colours (Android 12+),
  Girovo's navy and blue before that, and always the phone's light or dark —
  neither is a setting. The colours that mean something — credit, negative,
  vorgemerkt — never follow the wallpaper.
- **Back** closes the topmost sheet or dialog, then returns to the Übersicht,
  then sends the app to the background. It never logs out. From Android 14
  the sheet follows the gesture (predictive back).
- **Shortcuts and sharing:** long-press the icon for Überweisen, GiroCode
  scannen, Geld anfordern (LaunchPlugin); share an invoice (image or PDF) with
  Girovo and its GiroCode opens a transfer — a PDF's first pages are drawn on
  the phone (PdfRenderer) and read like an image.
- **GiroCode scannen** is Google's code scanner from Play services
  (ScannerPlugin): no camera permission, only the code's text comes back.
  Without Play services the page offers an image or a PDF instead.
- **Telemetry** follows the desktop's rules (mobile/bridges/telemetry.ts runs
  electron/telemetry.cjs): error reports always, usage only after the user's
  yes. A debug build sends nothing unless `localStorage['fints.telemetry.debug']`
  is `'1'`, and then as "development".
- **Store listing:** texts, Data safety draft, feature graphic and phone
  screenshots are in `android/store/`.
