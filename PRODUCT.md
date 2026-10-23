# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

One Next.js page in three shells: the Android app (Capacitor WebView,
Google Play and a GitHub APK), the desktop app (Electron, Windows and Linux)
and localhost for developers. Design work is phone-first (owner, 2026-10-23);
the desktop follows the phone later.

## Users

People who bank with a German bank that offers FinTS PIN/TAN access and want
their everyday banking in one modern app. They are not technical: they never
see npm, a config file or a FinTS registration, because release builds carry
them.

- **On Android** (the main audience since the Play release, 2026-10): they
  install from Google Play or the GitHub APK and expect the app to behave like
  the rest of their phone: the wallpaper's colours, the back gesture, a
  fingerprint instead of the PIN. The TAN app is usually on the same phone, so
  an approval means switching apps and coming back.
- **On the desktop**: the Windows `Setup.exe` or portable build, or the Linux
  AppImage or `.deb`, from GitHub releases.
- They read German or English. The English readers mostly live and bank in
  Germany but read English more easily.
- The owner and their household use it daily with real Sparkasse data.
  Developers running it from source are a secondary audience; the README
  serves them.

The jobs they come to do:

- check the balance and what is available
- read and search Umsätze, and see what is still vorgemerkt
- send a SEPA or Echtzeit transfer safely, or set one up for later
  (Terminüberweisung, Dauerauftrag)
- understand where the money goes and keep to a budget (Analyse,
  Monatsbudgets, Verträge & Abos, the month-end forecast)
- get documents out (PDF, CSV) and keep the bank's Kontoauszüge and their own
  receipts on the device, sealed with the PIN
- see what their Depot holds

## Product Purpose

Girovo is a banking app for German banks. It speaks FinTS 3.0 PIN/TAN,
including decoupled approval and typed TANs, directly from the user's device
to their bank. Every bank behind the 2,721 Bankleitzahlen in its database
gets the same interface.

Success means a non-technical person can install it, find their bank, log in
with their TAN app and do their everyday banking in it, trusting that what
they see is what the bank reported and that nothing about their finances went
anywhere but to their bank.

## Positioning

Three claims together; none alone is the point (owner, 2026-10-04):

1. **Only your bank sees it.** FinTS runs straight from the device to the
   bank, with no aggregator, cloud account or third party in the path. The PIN
   lives only in memory; everything kept on the device is encrypted with it.
2. **Any German bank, one modern app.** Free and open source (MIT), the same
   interface for every FinTS bank.
3. **More than the bank's own app**, all computed on the device: Umsatzanalyse
   with Monatsbudgets, Verträge & Abos, the month-end forecast, the real shop
   behind a card payment, GiroCode reading and Geld anfordern, a Kontoverlauf
   checked against the bank's balances, and on Android "Frag deine Umsätze"
   with Gemini Nano.

## Operating Context

- **Updates.** Play updates the Play build. The GitHub APK and the desktop app
  check GitHub; downloading and installing are separate steps, and every
  download is checked against GitHub's SHA-256. The localhost build must never
  sit on a public host: one process, sessions in memory, no authentication of
  its own.
- **Getting in.** Pick the bank (by name, city, BLZ, BIC or IBAN; the IBAN is
  read on the device and only its BLZ is searched), enter Anmeldename and PIN,
  choose the security method (approval in the bank's app, or a typed TAN),
  approve, land on the Übersicht. What the login needs is said before the PIN
  is typed. Further banks join the same view through "Weitere Bank anmelden".
- **Approvals.** Any bank read can cost a Freigabe, so reads are serialised
  and cached. "Gerät merken" keeps the bank's systemId, so the bank may skip
  TANs during its exemption window (about 90 days). The app never bypasses
  SCA.
- **Sessions.** Logout after 5–30 minutes without input (default 10), with a
  warning one minute ahead, never during an approval. Several banks are
  several sessions; one logout ends all of them.
- **Data horizon.** Banks deliver about 90 days by default; more can cost a
  TAN. "Umsätze behalten" (opt-in, per login) keeps booked Umsätze encrypted
  on the device for up to ten years. Anything computed over a cut period says
  so ("mind.", "unvollständig").
- **Phone integrity.** On a modified phone, or one that cannot prove it is
  not, Girovo keeps nothing on the device (owner, 2026-10-20); the session
  lives in memory until logout. The owner can override this for their own
  rooted phone with a deliberate "Trotzdem speichern".
- **Screen sharing.** "Beträge ausblenden" removes every amount from the
  screen and the DOM, including amounts inside bank text and the user's notes.
  The transfer review and the approval show the amount regardless.
- **What the bank sends that the interface must absorb:** bookings dated ahead
  of today, bank messages (Mitteilungen), refused orders and approvals (the
  bank's sentences verbatim, its code once as "Rückmeldung der Bank"),
  transfers whose outcome is unknown ("Status unklar", never resent blindly;
  "Jetzt nachsehen" only reads), failed or incomplete reads (a total is never
  a partial sum), and Namensabgleich results with the bank's own text.
- **Paper.** A PDF Kontoauszug, Buchungsbeleg, Mitteilung and
  Steuer-Jahresübersicht are read by third parties (a landlord, the
  Jobcenter, a Steuerberater): plain, exact, in the third person, never a
  note or a balance they do not need.

## Capabilities and Constraints

The README is the authoritative feature list (version 5.11.0). Not yet tried
against a real bank: Terminüberweisung and Dauerauftrag (placing, listing,
changing, deleting), typed TANs, and HKEKP statements.

**Girovo Plus** (Play build only): a supporter subscription, 0,99 € a month or
9,99 € a year with three days free. It opens a second bank, the month-end
forecast and "Frag deine Umsätze", plus a gold app icon on request. The GitHub
APK and the desktop app keep everything free.

**Constraints:**

- Features depend on the bank and the account (BPD/UPD). The app offers only
  what the user's bank supports and shows its behaviour as delivered.
- Accounts are identified by account number; a further bank listing a number
  already shown is refused, and the same IBAN seen by two logins shows once.
- Outside requests besides the bank are disclosed and can be switched off:
  company logos via Brandfetch (cleaned company names only, off until the user
  agrees) and the update check (GitHub). Desktop error reports always go to
  the developer, scrubbed of anything personal; usage data only with a yes.
  Gemini Nano runs on the phone.
- Fonts are self-hosted.
- A transfer whose outcome is unclear is never resent automatically.

**Terminology.** Use the banks' own words: Kontostand, Verfügbar,
Dispositionsrahmen, Kreditrahmen, Kartensaldo, Gesamtsaldo; Umsätze,
Vorgemerkt, Buchungstag, Valuta; Verwendungszweck, Gläubiger-ID; Überweisung,
Echtzeitüberweisung, Namensabgleich; Terminüberweisung, Dauerauftrag,
Ausführung, Turnus; Kontoauszug, Buchungsbeleg; Gerät vergessen. "Freigabe"
is the approval; "TAN" appears only inside a method's name. Wherever the app
shows a tidied counterparty name, the bank's raw name is available as "Name
laut Bank". On Android the device is the "Telefon", never the "Rechner".

## Brand Commitments

- **Name and mark.** Girovo (Sooskasse-FinTS up to 4.3), with the navy "G€"
  plate. The app has its own identity and never borrows a bank's or
  provider's branding.
- **Personality.** Calm and precise (owner, 2026-10-23): trust from exactness
  and quiet confidence, not ornament.
- **Design language.** Material 3 Expressive with the real M3E web components
  (owner, 2026-10-18 and 2026-10-19; kept 2026-10-23). On Android the
  wallpaper's Material You colours tint the app, and light and dark follow the
  system; colours that carry a value (credit, error, vorgemerkt) never follow
  the wallpaper.
- **Typeface.** Google Sans Flex (owner, 2026-10-04; kept 2026-10-23).
- **Redesign (owner, 2026-10-23).** The shipped rendering reads as a generic
  Material template, with weak hierarchy, poor density and unsatisfying type
  and figures. The redesign keeps the three commitments above and changes
  everything they leave open.
- **Language and voice.** German is the source and says "du" ("Deine Daten
  bleiben bei dir"); English says the same in a plain, friendly "you", in
  British spelling and conventions. Bank terms stay as banks use them, and
  what a bank sends is never translated. Rules and glossary:
  `lib/i18n/README.md`.

## Evidence on Hand

- **Website and contact (owner, 2026-10-23):** girovo.de is Girovo's
  website, and contact@girovo.de its contact address. Both are linked in
  Einstellungen → Über Girovo. The privacy policy and the Impressum are still
  linked at elnino0916.de/girovo until they move.
- `README.md`: features, security model, update model, architecture.
- `/design-preview` (dev only) renders every screen with generated data; use
  it for screenshots and store material instead of real accounts.
- `android/store/screenshots/`: the current Play listing's screenshots.
- `banks-data.json`: 2,721 Bankleitzahlen with FinTS access. `public/logos/`
  holds 17 bank logos from Wikimedia Commons; every other bank gets a
  monogram.
- Testing claim in the README: tested with Atruvia, Targobank, Commerzbank and
  Finanz Informatik infrastructure; the owner uses it with real Sparkasse
  data. The Play listing was approved in October 2026.
- **Absent; never fabricate:** user or download counts, ratings, testimonials,
  reviews or press, a security audit or certification, and any affiliation
  with or endorsement by Atruvia, Finanz Informatik, the Sparkassen, the
  Volksbanken or any other bank. No comparative claims against named
  products.

## Product Principles

1. **The bank is the only party.** Anything that leaves the device for
   another host is disclosed, minimal and can be switched off; personal data
   stays local and encrypted with the PIN.
2. **Feels like their online banking.** A non-technical user recognises the
   terms, the flow and the safety steps. Nothing asks for configuration, and
   the only jargon is the bank's own.
3. **More than the bank, never riskier.** The extra intelligence runs on the
   device and never shortcuts moving money. The review step shows exactly
   what the bank will receive, and at every risk decision the safe answer is
   the easy one.
4. **Any bank, as it is.** Only what the user's bank and account support,
   shown the way the bank delivered it.

## Accessibility & Inclusion

No formal standard has been chosen yet (open). German and English are both
first-class.

## Open Decisions

- **Umsätze behalten** is off by default and chosen per login (Claude's
  choice). Owner to confirm, and whether lists then open on everything kept.
- **Update checks** are on by default (desktop and GitHub APK). Opt-in
  instead?
- **Curated lists** in `lib/brands.ts`: the banks named as offering no FinTS,
  and the approval-app name per brand, need the owner's confirmation.
- **Several banks.** Should "Bank entfernen" also forget the device? Should a
  total over only the logged-in banks be shown, named as such? Are composite
  account keys wanted instead of refusing a duplicate number?
- **Daueraufträge and Terminüberweisungen** from the bank close Verträge &
  Abos today. Keep them there, or give them a place of their own?
- **Paper.** Should the Buchungsbeleg show the balance again? Keep the bank's
  logo on the letterhead? Offer a CSV that includes Vorgemerkte?
