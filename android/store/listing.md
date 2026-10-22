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
| Phone screenshots | `screenshots/1-…png` to `7-…png` — 1080 × 2160 (9:18, Play's 2:1 limit), 24-bit PNG, German interface, in upload order | 2–8 |

The screenshots show the design preview's sample data (no real account):
Übersicht, its Umsätze, "Frag deine Umsätze" answering "Wie viel ging an
Amazon?", the Analyse's categories, Verträge, a filled-in Überweisung and
Geld anfordern. Last made for 5.8.0.

### Making them again

On the emulator (`Pixel_10_Pro_XL`), with the debug app loading the Android
design preview from this computer:

1. `npm run android:preview` (port 3100), and the phone runtime beside it:
   `node scripts/build-mobile.mjs --out public --dev`
2. `GIROVO_DEV_SERVER=http://10.0.2.2:3100 npx cap sync android`, then
   `gradlew assembleGithubDebug` and install it on the emulator
3. The emulator headless at Play's size — its skin file is missing, so give
   the size instead: `emulator -avd Pixel_10_Pro_XL -skin 1080x2160 -no-window`
4. `adb shell wm density 420`, `adb shell cmd uimode night no`, and the
   demo status bar: `settings put global sysui_demo_allowed 1`, then
   `am broadcast -a com.android.systemui.demo -e command …` with `enter`,
   `clock -e hhmm 0941`, `battery -e level 100 -e plugged false`,
   `network -e wifi show -e level 4 -e fully true`,
   `network -e mobile show -e datatype none -e level 4 -e fully true`,
   `notifications -e visible false`
5. Open each view in the app's WebView over the debug bridge
   (`adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`, then
   CDP `Runtime.evaluate` of `location.href = …`):
   `/design-preview?view=overview-single`, the same scrolled to "Umsätze",
   `view=analysis` with the question typed and sent, `view=analysis` scrolled
   to "Ausgaben nach Kategorie", `view=contracts`, `view=transfer-filled`,
   `view=share` — each with `&nano=available`. Hide the dev server's badge
   (`nextjs-portal { display: none }`) before `adb exec-out screencap -p`.
6. Afterwards: delete `public/mobile-runtime.js` (the desktop build must not
   find it) and run `npx cap sync android` without `GIROVO_DEV_SERVER`.

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
