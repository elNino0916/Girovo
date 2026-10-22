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
  exactly what Node seals — `mobile/shims/crypto.test.ts`). The category
  guess is the one module swapped for another engine: the desktop's e5
  (`lib/category-model.ts`) becomes Gemini Nano through AICore
  (`mobile/server/categories.ts`, `NanoPlugin.java`).
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
                               Gemini Nano's status and progress, updates
android/                       the Capacitor project
  app/src/main/java/…/girovo/  HttpPlugin, DevicePlugin (+ DeviceIntegrity: key attestation, signer), BiometricPlugin, NanoPlugin (Gemini Nano)
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
otherwise. Since 5.9.0 the Android Gradle plugin is 9.4 on Gradle 9.8
(AGP 9.4 needs Gradle 9.6 or later; the wrapper pins the distribution's
SHA-256).

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

### Runtime integrity

At start, `RuntimeIntegrity.java` reads `/proc/self/mountinfo`, the hosts
file's metadata, a fixed set of root-interface path metadata and exact
manager-package queries from Girovo's own process. It never executes a root
binary, requests root, reads the manager's private files or inventories apps.
The mount-table read is bounded to 256 KiB. The manifest declares only the
four manager packages being queried.

Each check returns `found`, `nothing seen` or `unavailable`, with a bounded
explanation. `EACCES`/`EPERM`, failed reads and incomplete mount tables are
unavailable, not clean. A negative package query is scoped to the current
profile and declared query. A missing path is scoped to the app's own view.
These local probes cannot prove the absence of root on a modified kernel.

Any `found` result of the system checks (mounts, hosts, `su` paths)
overrides even a verified, locked boot in `lib/device-integrity.ts`: the
device is `modified`, the settings row shows the red cross, the login warns,
and the existing storage refusal applies. An installed root manager app alone
is logged but decides nothing — it runs without root, as on the owner's S26
(KernelSU's manager beside a locked, verified boot and no module mounts).
A tmpfs over an app folder (`/app`, `/priv-app`) hides a preinstalled app and
is no finding either; one over `bin` or `lib` folders is.
An overlay over a system partition counts only when a root tool made it: its
source names one (KSU, Magisk, APatch), a layer lies in writable storage or
memory (`/data`, `/debug_ramdisk`, `/sbin`, `/dev`, `/mnt` …), or it has a
writable upper layer. Phone makers overlay their own read-only partitions —
Xiaomi's HyperOS stacks `/mi_ext` onto `/product`, OPPO and OnePlus their
`my_*` partitions — and every HyperOS phone read as rooted before 5.9.1.
Likewise a writable ext4 or EROFS mount counts only on a partition root or
its `bin`/`lib` folders, not on vendor firmware or persist folders.
Debug builds cannot bypass storage refusal for a modified device. The debug
exception for an emulator with unknown attestation and no finding remains.
The new runtime probe is read-only; the pre-existing boot-attestation check
still creates and deletes its temporary AndroidKeyStore key.

The native `GirovoIntegrity` log tag reports the app PID/UID, each check and
the attested boot, in release builds too. It contains no banking data or
hosts-file content:

```bash
adb logcat -d -s GirovoIntegrity:I '*:S'
```

On the owner's SM-S948B (Android 17, 21 October 2026), the signed release ran
as UID 10453 in `untrusted_app_34`. It found three tmpfs covers over
`/product/app/YouTube` and `me.weishu.kernelsu`, despite hardware attestation
reporting `boot=verified locked=true`. In that app's view, hosts had normal
metadata and `su` was absent; `/data/adb/ksu/bin/ksud` returned permission
denied and was correctly reported as unavailable. ADB's privileged view
must not be substituted for these app-process results.

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

Since 5.8.0 a release is shrunk and obfuscated by R8 (`minifyEnabled`,
`shrinkResources`; Play flagged 5.7.0's 1 % obfuscation). The plugins the
page calls keep their names through Capacitor's own keep rules for
`@CapacitorPlugin` classes; `app/proguard-rules.pro` keeps line numbers for
Play's crash reports, and Play receives the mapping inside the bundle. A new
plugin needs nothing extra as long as it is a `@CapacitorPlugin`; anything
reached by reflection or by name from elsewhere needs a `-keep` rule there. A
debug build is not minified — test a release build on a phone after such a
change (`build-android.mjs --release`, then `adb install -r`).

AGP 9 reads keep rules strictly by default: `-keep class X` no longer keeps
X's default constructor. The libraries' own rules predate that — ML Kit's
component registrars lost theirs and the code scanner and Gemini Nano
failed (`NoSuchMethodException … Registrar.<init>`, NanoPlugin's variants a
NullPointerException) — so `gradle.properties` sets
`android.r8.strictFullModeForKeepRules=false`. `EdgeToEdge`, and the names of
its parameter types, are kept so Play's scan still sees the
`EdgeToEdge.enable()` call; renamed, Play reported the app as not edge to
edge. Look for both in `adb logcat` / `dexdump` after a toolchain update.

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
    Brandfetch for logos (lib/merchants.ts). The category guess runs on
    Gemini Nano inside the phone's own AICore; nothing of it leaves the
    phone. No analytics and no crash reporting in the Android app.
  - *Target API level:* the project targets SDK 36.
  - *Foreground service:* one, of type `shortService`, only while the user
    approves an order in their bank's app (see "On the phone" below).
- **Store listing:** the icon is `android/store/icon-512.png`
  (`scripts/build-android-assets.mjs` draws it, and the launcher icon, from
  `lib/brand-mark.ts`).

#### Girovo Plus

The Play build's supporter subscription (docs/plus-plan.md, `lib/plus.ts`):
more than one bank and the month-end forecast, and a gold app icon on
request. The GitHub build's `PlusPlugin` (src/github) answers "free".

- **Play Console:** a subscription `girovo_plus` with the base plans
  `monthly` (0,99 €) and `yearly` (9,99 €), each with a 3-day free-trial
  offer. Play shows its own localised prices; nothing is hard-coded. Add
  licence testers to buy without being charged.
- **Proof:** Play Billing's purchase state on the phone (no server). A
  subscription confirmed within the last 7 days stands while Play cannot be
  asked or takes no purchases (signed out, updating); only Play's own "no
  purchase" ends it.
- **The icon:** two launcher entries in the manifest, `.LauncherStandard`
  (navy, enabled) and `.LauncherPlus` (gold, disabled), both for
  MainActivity. PlusPlugin enables one and disables the other; the gold one
  is switched back when Plus ends. Since 5.10.1 MainActivity itself is no
  launcher entry — launchers may drop the old home-screen icon once with that
  update.
- **Testing without Play:** the emulator without a Google account answers
  `BILLING_UNAVAILABLE` (state `unavailable`); the design preview has
  `?plus=free|active|inactive|unavailable`.

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
- **Categories with Gemini Nano.** What the keyword rules leave as
  "Sonstiges" goes to Gemini Nano, the language model Android's AICore runs on
  the phone for every app (ML Kit's Prompt API, `NanoPlugin.java`), in place
  of the desktop's e5:
  - *Which phones:* those whose AICore offers Nano (recent Pixel and Galaxy
    flagships among them); Einstellungen shows "Nicht unterstütztes Telefon"
    elsewhere, and there the rules sort alone. Where AICore offers it as a
    download, the app asks AICore for it at start; AICore picks the moment.
    The client asks for the fast, released variant (`ModelConfig` FAST,
    STABLE): on the S26 the default client waited for a download that never
    came, while that variant was there at once.
  - *How it decides:* one prompt per counterparty — the calibrated
    instruction and category list (`lib/nano-categories.ts`, temperature 0),
    then the name and Verwendungszweck. A counterparty the user filed under a
    nearly identical name takes that rule's category before Nano is asked;
    examples in the prompt made Nano copy look-alikes. Answers are kept for as
    long as the app runs, in memory only.
  - *AICore's limits:* under sustained use AICore refuses about every 14th
    request as busy, and none while the app is in the background. Both are
    waited out — the booking is asked again after a growing pause, or once
    the app is back — so every booking gets its answer. The Umsätze and the
    Analyse show "Kategorien werden zugeordnet · 120 von 300" meanwhile.
  - *Calibration:* on the owner's Galaxy S26 Ultra (nano-v4-fast), tuned on
    hand-made bookings and measured once on others: of 115 with a category,
    104 right and 12 wrong guesses, where e5 had 85 and 13; about 0.24 s a
    booking. Its weak spot is money between people whose purpose names
    something ("Familie Braun – Urlaubskasse" → Freizeit).
  - The e5 model of 5.6 and before (an optional 280 MB download) is deleted
    from the phone at the first start of this version.
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
