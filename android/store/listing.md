# Google Play store listing

Everything for Play Console › Store presence › Main store listing. German is
the default language, English a translation (add it under "Manage
translations").

| Play Console field | File | Limit |
|---|---|---|
| App name | `de-DE/title.txt`, `en-US/title.txt` | 30 characters |
| Short description | `de-DE/short-description.txt`, `en-US/short-description.txt` | 80 characters |
| Full description | `de-DE/full-description.txt`, `en-US/full-description.txt` | 4,000 characters |
| App icon | `icon-512.png` — 512 × 512, 32-bit PNG, full square (Play rounds it) | 1 MB |
| Feature graphic | `feature-graphic.png` — 1024 × 500, 24-bit PNG | 15 MB |
| Phone screenshots | `screenshots/1-…png` to `8-…png` — 1080 × 2160 (9:18, Play's 2:1 limit), 24-bit PNG, German interface, in upload order | 2–8 |

The screenshots show the design preview's sample data (no real account):
the Übersicht, the search ("dm"), "Frag deine Umsätze" answering "Wie viel
ging an Amazon?", the Analyse's categories, Zahlungen, an Überweisung at its
amount, a booking's Umsatzdetails and the bank choice at login. Last made for
5.11.0.

### Making them again

On the emulator (`Pixel_10_Pro_XL`), with the debug app loading the Android
design preview from this computer:

1. `npm run android:preview` (port 3100), and the phone runtime beside it:
   `node scripts/build-mobile.mjs --out public --dev`
2. `GIROVO_DEV_SERVER=http://10.0.2.2:3100 npx cap sync android`, then
   `gradlew assembleGithubDebug` and install it on the emulator
3. The emulator headless at Play's size — its skin file is missing, so give
   the size instead: `emulator -avd Pixel_10_Pro_XL -skin 1080x2160 -no-window`
4. The phone's own look at that size (5.11.0): the AVD's Pixel profile puts a
   camera hole into the status bar and makes it 61 dp tall at 1080 × 2160, so
   switch it off — `cmd overlay disable com.android.internal.emulation.pixel_10_pro_xl`
   and `… com.android.systemui.emulation.pixel_10_pro_xl` — then
   `wm density 420` (set 421 first and back if the status bar keeps its old
   159 px; `dumpsys window | grep type=statusBars` should say 63).
   `cmd uimode night no`, `settings put system time_12_24 24`.
5. The real status bar, not demo mode: demo mode's mobile signal ignores the
   network type and shows "3G". The emulator's modem is 5G already; turn
   Wi-Fi off (`svc wifi disable`, else Android hides "5G"), `adb emu gsm
   signal-profile 4`, and check `adb emu power display` says discharging at
   100. The clock is then the emulator's own, the same one the app's "Stand"
   shows. The signal still dips now and then: retake a shot until the fourth
   bar is dark.
6. The app in German: in its WebView `localStorage.setItem('fints.locale',
   'de')` and the cookie `girovo-locale=de`, then reload.
7. Open each view in the app's WebView over the debug bridge
   (`adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`, then
   CDP `Runtime.evaluate` of `location.href = …`), each with `&nano=available`:
   `/design-preview?view=overview-single`; the same with the search bar
   tapped and "dm" typed (`adb shell input text`); `view=analysis` with "Wie
   viel ging an Amazon?" typed and sent; `view=analysis` scrolled to "Ausgaben
   nach Kategorie"; `view=contracts`; `view=transfer-filled`; `view=detail`;
   `view=login`. Before `adb exec-out screencap -p`: blur the focused element
   (no keyboard, no focus ring) and hide the dev server's badge
   (`nextjs-portal { display: none }`). Save as 24-bit PNG (screencap's has
   an alpha channel).
8. Afterwards: put the emulator back (both overlays enabled, `wm density
   reset`, Wi-Fi on, `settings delete system time_12_24`), delete
   `public/mobile-runtime.js` (the desktop build must not find it) and run
   `npx cap sync android` without `GIROVO_DEV_SERVER`.

## Store settings

- **Category:** Finance
- **Tags:** Banking, Finance, Budget
- **Developer:** MT-Media (owner Moritz Krug), as in the legal notice
- **Contact e-mail:** moritz@mt-media.eu (as in the legal notice and the privacy policy)
- **Website:** https://elnino0916.de/girovo
- **Privacy policy:** https://elnino0916.de/girovo/privacy
- **Legal notice (Impressum):** https://elnino0916.de/girovo/impressum — also linked in the app (Einstellungen → Über Girovo)
- **Ads:** no
- **Content rating:** answer the questionnaire with "Finance", no user-generated content, no ads
- **Target audience:** 18 and over
- **Data safety:** see `data-safety.md`
- **Financial features declaration** (Policy › App content): "Banking — the app accesses the user's own accounts at their bank"; Girovo is not a bank and holds no money
