# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Anyone on Windows** who banks with a German bank that offers FinTS/HBCI
access (PIN/TAN). They install the release `Setup.exe` (or run the portable
build) from GitHub and do their everyday banking in it. They never touch npm,
`config.json` or a FinTS product registration, because the release build
already carries those. They bring a TAN app on their phone (decoupled
approval such as S-pushTAN or SecureGo plus) and the habits of their bank's
own online banking.

**Anyone with an Android phone**, for the same banking on the go. They get the
Android app from Google Play or as the APK from GitHub, and expect it to look
and behave like the other apps on their phone: Material 3 Expressive, the wallpaper's
colours, the back gesture, a fingerprint instead of the PIN if they want one.
The TAN app is usually on the same phone, so an approval means switching apps
and coming back.

They read the app in German or in English. The English-speaking ones are
mostly people who live in Germany and bank here, but read English more
easily than German — their bank's own app rarely offers them that.

The owner and their household are one group among these users. They use the
app against real Sparkasse data. Developers who run it from source
(`npm run dev`) or build their own installer are a secondary audience. The
README still serves them.

The jobs they come to do:

- check the balance and what is available
- read and search Umsätze, and see what is still vorgemerkt
- send a SEPA or Echtzeit transfer safely, or set one up for later
  (Terminüberweisung, Dauerauftrag)
- understand where the money goes and keep to a budget (Analyse,
  Monatsbudgets, Verträge & Abos)
- get statements and receipts out as PDF or CSV — and keep the bank's own
  Kontoauszüge and their own receipts (an invoice, a till receipt) on the
  machine, sealed with the PIN
- see what their Depot holds

## Product Purpose

Girovo is a banking app for German banks. It speaks FinTS 3.0
(HBCI) PIN/TAN, including decoupled TAN, directly from the user's own
machine. It works with any bank behind the 2,721 Bankleitzahlen with FinTS
access in its bundled database, and every one gets the same interface for:

- balances and Umsätze, plus pending entries
- SEPA and Echtzeit transfers with Namensabgleich (Verification of Payee)
- on-device analysis

Success means a non-technical Windows user can install it, find their bank,
log in with their TAN app and do their everyday banking in it. They should
trust that what they see is what the bank reported, and that nothing about
their finances went anywhere except to their bank.

## Positioning

The owner sees the position as the combination of three claims (confirmed
2026-10-04). None of them alone is the point.

1. **Only your bank sees it.** FinTS runs straight from the user's machine to
   the bank. No aggregator, cloud account or third-party access sits in that
   path. The PIN lives only in memory. The device profile, the
   personal-data vault and, if the user keeps them, the Umsätze are encrypted
   with the PIN. Nothing about the user's
   finances goes to the developer: error reports (always) and usage data (with
   a yes) are scrubbed and limited to declared fields (README → Telemetry).
2. **Any German bank, one modern app.** It is free and open source (MIT) and
   works with any FinTS bank, in an interface that feels like familiar online
   banking.
3. **More than the bank's own app.** It goes beyond what a bank app shows,
   all computed on the machine:
   - Umsatzanalyse, with Monatsbudgets and a Kategorie-Check
   - Verträge & Abos
   - the real shop behind a card payment
   - GiroCode reading and Geld anfordern
   - a Kontoverlauf that is checked against the bank's balances

## Operating Context

- **Distribution.** The main form is the Windows desktop app: an Electron
  shell around the same Next.js app, shipped as an NSIS `Setup.exe` and a
  portable `.exe` on GitHub releases. The same shell also ships for Linux, as
  an AppImage and a `.deb`; those do not update themselves.
  - The app checks GitHub for releases. Downloading and installing an update
    are separate clicks, and each download is checked against the SHA-256
    digest GitHub publishes for it.
  - The same app runs as a localhost website for developers. It must never sit
    on a public host or a serverless or multi-worker runtime: there is one
    process, sessions live in memory, and the app has no authentication of its
    own.
  - The Android app is the same page and the same server code on the phone
    (android/README.md): the route handlers run inside the app's WebView and
    the phone talks to the bank directly. It ships on Google Play (Play
    updates it) and as an APK on the GitHub releases (it updates itself, each
    download checked against GitHub's SHA-256). Its look is Material 3
    Expressive, in Material You's colours and the phone's light or dark (neither is a
    setting); the colours that carry a value never follow the wallpaper. It speaks of
    the device as "Telefon", never "Rechner".
- **Getting in.** The login runs in this order:
  1. Pick the bank. Quick picks show real logos; search works by name, city,
     BLZ (also typed with spaces), BIC or IBAN. The IBAN is read on the
     device, and only its BLZ goes to the search.
  2. Enter Anmeldename and PIN.
  3. Choose the security method: approval in the bank's app, or a typed TAN
     (chipTAN optisch, chipTAN QR, photoTAN, chipTAN manuell, smsTAN). When
     the bank offers a single method, it is picked automatically.
  4. Approve: in the banking app, or by typing the TAN into the approval
     dialog — read off the flicker graphic or the bank's graphic it shows,
     or made from the bank's words (a start code, an SMS).
  5. Land on the Finanzübersicht.

  What is needed is said before the PIN is typed: a "Was brauche ich?"
  disclosure on the bank step (the online-banking credentials, the bank's
  FinTS access, approval as in the bank's online banking — app or TAN); on
  the credentials step it holds only what the form does not already say (the
  FinTS access, a forgotten PIN), and a line on the form says how the login
  is approved next, naming the brand's approval app where one name holds.

  More banks join the same view the same way: "Weitere Bank anmelden" runs
  these steps in a sheet over the Übersicht, for a session of its own beside
  the first. The first (primary) login's encrypted vault holds the personal
  data of the whole view and remembers the further banks — BLZ, name and
  Anmeldename, never a PIN — so the next login offers "Auch bei … anmelden".

  Any bank read can cost its own approval, so reads are serialised and cached.
  "Gerät merken" keeps the bank's systemId encrypted with the PIN, so the bank
  may skip TANs during its SCA exemption window (~90 days).
- **Sessions.** The app logs the user out after 5–30 minutes without input
  (default 10). It warns one minute ahead and never logs out while an approval
  is running. The server drops sessions after 30 minutes idle. With several
  banks, each is a session of its own: the keepalive covers all of them, every
  request goes through the session of the account it concerns, and the logout
  (by hand or idle) ends all of them. A further bank whose session ends alone
  is marked logged out, with "Erneut anmelden"; the primary's ending ends the
  view, as before.
- **Data horizon.** The bank's default is about 90 days. Analyse, Verträge and
  Kontoverlauf only know the loaded period. Loading 12 months can cost a TAN,
  and some banks keep less. With "Umsätze auf diesem Rechner behalten" (opt-in,
  per login) they also know what earlier logins kept — up to ten years — and a
  longer period asks the bank only for what is missing. The bank stays the
  source for every day it delivers; the kept part of a list is marked.
  A budget month the loaded period cuts is labelled
  as such, and its spending is a minimum ("mind."), never the month's total.
- **Screen sharing.** "Beträge ausblenden" masks every amount, chart axis and
  tooltip, and the amounts inside the bank's free text (Verwendungszweck,
  references) and the user's own notes as well as text can be read. The
  Monatsbudgets' bars hide too; whether a budget is over stays, in words.
- **Documents.** The app produces:
  - a PDF Kontoauszug and Buchungsbeleg
  - the bank's own Kontoauszüge (HKEKA), fetched on request and each kept
    as it arrives, sealed with the PIN (lib/doc-store.ts): some banks hand
    one out once. They live under the Umsätze's export menu
  - receipts on bookings: a photo or PDF, sealed with the PIN; an invoice
    paid from its GiroCode waits for its booking and goes to it by itself
    (lib/receipts.ts)
  - a PDF of a bank message (Mitteilung), its subject and text as the bank
    sent them, so a notice outlives the logout that clears the inbox
  - a CSV export in the German Excel dialect, holding the booked Umsätze the
    list shows (never Vorgemerkte), with the days and any filter in its file
    name. Its last column ("Notiz") holds the user's notes as typed; the
    printed Buchungsbeleg never carries a note (a third party reads it)
  - a GiroCode PNG for Geld anfordern
  - the Steuer-Jahresübersicht: one year's bookings in the categories the
    user picks, as a sealed PDF for a third party (no notes, accounts named as
    the bank names them), a CSV, or a ZIP of the CSV with the receipts
  - a backup (`.girovo`) of everything the machine keeps for the view's
    logins, sealed with a password of its own (lib/backup.ts)
- **What the bank sends that the UI has to absorb:**
  - bookings dated ahead of today ("noch nicht gebucht")
  - bank messages at login (Mitteilungen)
  - orders and approvals the bank refuses ("nicht ausgeführt", "nicht
    freigegeben"), shown with the bank's sentences verbatim and its code once
    as "Rückmeldung der Bank"
  - transfers whose outcome is unknown ("Status unklar"; never resend
    blindly). "Jetzt nachsehen" checks the Umsätze and Vorgemerkte in place
    and never sends anything — for a Terminüberweisung or a Dauerauftrag it
    reads the bank's list of them instead; a deletion that stays unclear is
    never sent again by itself either
  - reads that fail ("Abruf fehlgeschlagen") or leave a total incomplete
    ("unvollständig"; the Gesamtsaldo is never a partial sum)
  - Namensabgleich results (Match, Close Match, No Match, Not Applicable),
    with the bank's own text shown verbatim

## Capabilities and Constraints

**Current state (4.3.0).** The README is the full feature list:

- Finanzübersicht: Konten und Karten, Gesamtsaldo, Monatsbilanz, Demnächst
  fällig
- several banks in one view ("Weitere Bank anmelden"): accounts grouped by
  bank, one Gesamtsaldo, transfers through the account's own bank
- Kontoverlauf, checked against the bank's balances
- Umsätze: search, filters, detail drawer
- notes on bookings: written in the drawer, marked on the row, found by the
  search, in the CSV, never on paper
- automatic, correctable categories, and a Kategorie-Check of how they fare
  with the user's bookings (on the machine only)
- categories of the user's own (spending or income), made from a booking's
  menu and kept in Einstellungen, and bookings split across up to ten
  categories — counted share by share in every sum, budget and export
- the Steuer-Jahresübersicht (Analyse): a year by picked categories, as PDF,
  CSV or ZIP with receipts, incomplete years said as such
- the month-end forecast ("Kontostand Ende Oktober"): the balance, the
  Vorgemerkten, the regular payments, the bank's own orders and the usual
  spending, with the day it may go below zero or past the Dispo
- Umsatzanalyse
- Monatsbudgets per spending category, compared with the month on view
- Verträge & Abos
- CSV and PDF export
- Vorgemerkte Umsätze (HKVMK on request, or sent with the Umsätze as
  Sparkassen do)
- SEPA-Überweisung (HKCCS) and Echtzeitüberweisung (HKIPZ), with templates,
  recent payees, GiroCode reading and duplicate and overdraft warnings. The
  duplicate check reads a 14-day record of sent orders (account, IBAN,
  amount, time, outcome) kept in the PIN-encrypted vault, so it survives a
  logout; an order is written there as unclear the moment the bank holds it
  for approval
- Namensabgleich (HKVPP/HKVPA)
- Terminüberweisung (HKCSE) and Dauerauftrag (HKCDE) from the transfer
  sheet's "Termin", within the dates, rhythms and days the bank's parameters
  allow; the bank's own Daueraufträge and Terminüberweisungen (HKCDB/HKCSB)
  under Verträge & Abos, read on request, each deletable (HKCDL/HKCSL).
  Built from the specification and open implementations, **not yet tried
  against a real bank** (lib/fints-orders.ts lists what is unverified).
  Changing an order is not offered: delete it and place it again. Placing one
  is logged for the duplicate check with its kind and first date; a new
  Dauerauftrag is compared with Daueraufträge only, a Terminüberweisung with
  payments and other Terminüberweisungen, never with a Dauerauftrag
- Geld anfordern (EPC QR)
- the shop behind card payments
- typed TANs: chipTAN optisch (lib/flicker.ts renders HHD 1.4/1.3 as the
  flicker graphic, with size and speed kept per machine), chipTAN QR and
  photoTAN (the bank's matrix graphic), chipTAN manuell and smsTAN —
  **not yet tried against a real bank**
- the Depot (HKWPD): holdings with quantity, the bank's last price, value
  and the change since purchase; the bank's total is the account's figure
- the bank's own Kontoauszüge (HKEKA, or HKEKP where that is all the account
  offers — not yet tried against a real bank) and receipts on bookings, kept
  on the machine (see Documents above)
- changing a Dauerauftrag or a Terminüberweisung (HKCDN/HKCSA): amount,
  purpose, date or rhythm, never the payee — through the transfer's own
  Namensabgleich, approval and "Status unklar"; not yet tried against a real
  bank
- importing older Umsätze from the online banking's export (CSV, camt, MT940)
  into the kept history, only into days not kept yet
- a backup of the vault, the kept Umsätze and the documents, and its restore
  (merging: what is on the machine wins)
- company logos via Brandfetch
- Gerät merken and the encrypted personal-data vault
- Umsätze auf diesem Rechner behalten: booked Umsätze (never Vorgemerkte)
  kept per login, encrypted with the PIN beside the vault, with the days the
  bank delivered and the balances that prove them; "Alles Gespeicherte" in the
  Zeitraum menu, and fewer approvals for longer periods
- Beträge ausblenden and auto-logout
- Mitteilungen
- command palette (Strg+K) and keyboard shortcuts
- Hell / Dunkel / System appearance
- phone layout with a bottom navigation
- the desktop updater

**Constraints:**

- Accounts are identified by their account number. A further bank that
  lists another account under a number already shown is refused as a whole,
  with a message; the same account seen by two logins (same IBAN) is shown
  once.
- Features depend on the bank and the account (BPD/UPD). Transfers,
  Echtzeit, pending entries and Namensabgleich appear only where the bank
  supports them.
- The app never bypasses SCA (PSD2). Whether a read goes through without a
  TAN is the bank's decision.
- Some banks require a FinTS product registration ID (code 9078). It is baked
  into release builds from `config.json`.
- Two outside requests exist besides the bank, and both are disclosed and can
  be switched off:
  - Brandfetch, which receives cleaned company names only. Off until the user
    agrees (owner decision, 2026-10-04): the app asks once, in a tile on the
    Übersicht, before the first lookup, and the "Firmenlogos" switch in
    Einstellungen changes the answer. Builds without a client ID never offer it.
  - the update check, which goes to GitHub
- Fonts are self-hosted.
- A transfer whose outcome is unclear is never resent automatically.

**Terminology.** Use the banks' own words:

- Kontostand, Verfügbar, Dispositionsrahmen
- Umsätze, Vorgemerkt, Buchungstag, Valuta
- Verwendungszweck, Gläubiger-ID
- Überweisung, Echtzeitüberweisung, Namensabgleich
- Terminüberweisung, Dauerauftrag, Ausführung, Termin, Turnus,
  Ausführungstag
- Kontoauszug, Buchungsbeleg
- Gerät vergessen
- Freigabe for the approval; "TAN" only inside a method's name

Wherever the app shows a tidied counterparty name, it also shows the bank's
raw name as "Name laut Bank" (owner's request).

**Open decisions:**

- **Umsätze auf diesem Rechner behalten** is off by default and chosen per
  login (Claude's choice, from the brief). Owner to confirm the default — and
  that, once older Umsätze are kept, the lists open on "Alles Gespeicherte"
  after the login rather than on 90 days.

- Automatic update checks are on by default. Claude chose that, and it is
  disclosed in the app and README. The owner has not decided whether checks
  should be opt-in instead.
- No accessibility standard has been set yet.
- **Duplicate warning.** "Angaben prüfen" is now the filled primary and
  "Trotzdem überweisen" the outline, as at a name mismatch. Is safe-first
  right here, given that a deliberate repeat payment within 14 days is
  possible?
- **Figure step.** KPIs, amount fields and the Monatsbilanz Differenz use a
  20px/24px figure ladder, now documented as tokens. Keep it, or move the
  figures to an existing size such as the 22px Title?
- **Bottom-bar labels** are 12.5px, the caption floor ("Überweisen" fits from
  360px). Keep, or allow 12px for that bar only?
- **Curated lists in `lib/brands.ts` and the bank picker.** The banks named as
  offering no FinTS (N26, Revolut, Trade Republic, bunq, C24, Tomorrow,
  Vivid) and the approval-app name per brand (S-pushTAN, SecureGo plus,
  Banking to go, DKB-App, BestSign, photoTAN, SecurePlus) need the owner's
  confirmation.
- **Buchungsbeleg balance.** The Beleg no longer prints the account's
  balance, Verfügbar or credit line (a third party reads it). Should it show
  the balance again?
- **Statement density.** At 9.5pt about 13 bookings fit an A4 page (120
  bookings print on 9 pages). Keep, or set the table body at 9pt?
- **Bank logo on paper.** The printed letterhead shows the bank's logo as
  kontoführendes Institut, while the footer says the bank did not issue the
  document. Keep the logo, or print the bank's name only?
- **CSV with Vorgemerkte.** The export holds booked Umsätze only. Is an
  explicit "mit vorgemerkten Umsätzen" option wanted?
- **Day band figure.** A day of bookings now shows the verified end-of-day
  Kontostand where the app can prove it, otherwise a labelled "Summe". Keep
  the balance, or go back to the day's sum?
- **Category share bar.** Keep Analyse's stacked share bar in rank colours,
  or drop it for single-hue row bars (a change to DESIGN.md's chart rule)?
- **What "Beträge ausblenden" hides.** The Monatsbilanz split bar and the
  Monatsbudgets' bars hide today; Analyse's direction and comparison lines
  and the category shares do not. All or none?
- **Budgets.** Should a compact Monatsbudgets tile join the Übersicht's
  summaries once a budget exists (left out for now, to keep the overview
  uncluttered)? Should Vorgemerkte count against the running month's budget
  (today they count once booked, as in the rest of the Analyse)?
- **Gerät merken consent.** The device is remembered after login and the app
  says so beforehand. Is an explicit "Dieses Gerät merken" choice (and
  "Anmeldenamen merken") wanted?
- **Terminology.** The app now says Kartensaldo, Kreditrahmen and
  Gesamtsaldo. Add them to the list above?
- **Several banks.** (1) "Bank entfernen" logs a linked bank out and
  forgets it in the vault, but keeps its device registration (like a logout).
  Should it forget the device too? (2) A remembered bank that is not logged in
  keeps the Gesamtsaldo "unvollständig" (its accounts are not even listed).
  Right, or should a total over the logged-in banks be shown, named as such?
  (3) An account number shown twice is refused rather than keyed per bank —
  enough, or are composite keys wanted? (4) A further bank's Umsätze are kept
  when the first login keeps them, each in its own file; "Bank entfernen"
  leaves that file on disk (like the device registration), and deleting the
  saved data reaches only the banks logged in at that moment. Right?
- **Daueraufträge (open points).** The bank's list closes Verträge & Abos —
  keep it there, or give it a place of its own? A device remembered before
  the feature keeps a BPD without the bank's rules for these orders; the app
  then offers a narrower, safe choice. Should a login refresh the BPD once
  instead (it touches the login, and the stored TAN methods must survive
  it)? Should the list show an
  order to one of your own accounts by its name ("Notgroschen") rather than
  the holder's?
- **Optional extras** proposed during the fix pass: a first-use toast for
  single-key shortcuts with "Kürzel ausschalten".
- **Own categories and splits (Claude's choices, 2026-10-19).** An own
  category is spending or income, never an Umbuchung; the model and the
  keywords never guess one. A split's first share is the rest (worked out, not
  typed), so a split always adds up. Deleting an own category drops its rules,
  budget and every split that used it. Should an own category be able to sit
  under one of the app's (a subcategory) instead?
- **Steuer-Jahresübersicht.** Preselected: Steuern & Abgaben, Versicherungen,
  Gesundheit and every own category; the choice is not remembered. The PDF
  names the accounts by product, never by the user's alias (a third party reads
  it), and has no bank letterhead (it may span several banks). Keep both?
- **Forecast.** Usual spending is learnt from up to three whole loaded months
  of bookings that belong to no series, Umbuchungen included, and a net inflow
  counts as nothing. Shown on the Übersicht's side pane and, without one, at
  the head of Verträge. Right place, right model?
- **Backup.** Its own password (ten characters at least) rather than the PIN,
  because the file is made to leave the machine. A restore merges and never
  replaces; it restores only logins signed in at the time. Replacing on
  request, or restoring a not-signed-in login later, are left out.
- **Import.** Only while "Umsätze behalten" is on, and only into days not kept;
  a CSV vouches for its first to its last booking's day, which a filtered
  export would get wrong — the dialog asks for an unfiltered one. Should the
  import switch keeping on itself instead of asking for it?
- **Changing orders.** The payee never changes (another payee is another
  order); a Dauerauftrag's change applies from its next run the lead time
  allows. Changes are not logged for the duplicate check. The bank's HICDNS /
  HICSAS (which fields it lets change) are not decoded, on purpose: a field it
  refuses comes back as its refusal.

## Brand Commitments

- **Name and mark.** Girovo (called Sooskasse-FinTS up to 4.3), with the "G€" plate and wordmark
  (`components/shell/BrandMark.tsx`). The app has its own identity. It borrows
  a design language, never another bank's or provider's branding.
- **Interface typeface.** Google Sans Flex. This is binding for now (owner,
  2026-10-04).
- **Look.** Material 3 Expressive on every platform (owner, 2026-10-18): the
  Android app's look, which the owner preferred, replaced the desktop's
  Atruvia-style navy chrome, stage and white tiles. One top app bar naming the
  page, the navigation rail (the bar on a phone) with Überweisen as its FAB,
  flat list-first pages whose one container is the balance, and on a wide
  window the Übersicht in two panes. The desktop's colours are a fixed
  "Girovo blue" scheme from the brand's blue; only the Android app takes
  Material You's wallpaper colours, which override it. Other looks may be
  explored, but only as alternatives for the owner to choose, never swapped in
  silently.
- **Language and voice.** German and English (owner, 2026-10-05), switchable
  at any time — on the login bar and in Einstellungen — and defaulting to
  the system's language: German on a German system, English on any other.
  German is the source and addresses the user informally as "du" (e.g. "Deine
  Daten bleiben bei dir"); English says the same in a plain, friendly "you",
  in British spelling, with figures and dates in British conventions. Bank
  terms stay as banks use them, and what a bank sends — its messages, its
  answers, a Verwendungszweck — is never translated. The rules and the
  glossary are in `lib/i18n/README.md`. Austria and Switzerland are out of
  scope: their banks offer no FinTS.

## Evidence on Hand

- **README**: the authoritative feature
  list, security model, update model and architecture. The hero image is
  hosted on GitHub user-attachments.
- **Testing claim** in the README: "tested with Atruvia, Targobank,
  Commerzbank and FI infrastructure". The owner uses the app with real
  Sparkasse data.
- **Bank data.** `banks-data.json` holds 2,721 Bankleitzahlen with FinTS
  access (about 1,870 distinct bank names), from hbci4java's list plus
  fints-institute-db. `public/logos/` holds 17 bank logos from
  Wikimedia Commons; every other bank gets a monogram.
- **Releases.** Tags 4.0.0 (GitHub release, 2026-10-03) and 4.1.0. The repo is public under
  the MIT licence.
- **Design preview.** `/design-preview`, dev only, renders every screen with
  generated data. Use it for screenshots and marketing material instead of
  real accounts.
- **Absent. Never fabricate any of these:**
  - user or download counts
  - testimonials, reviews or press
  - a security audit or certification
  - any affiliation with or endorsement by Atruvia, Finanz Informatik, the
    Sparkassen, the Volksbanken or any other bank

  Make no comparative claims against named products without evidence.

## Product Principles

1. **The bank is the only party.** Anything that leaves the machine for
   another host is disclosed, minimal and can be switched off — with one
   exception the owner chose (2026-10-05): the desktop app's error reports go
   to the developer's server always, scrubbed of anything personal and never
   carrying financial data. Usage data needs the user's yes. Personal data
   stays local and encrypted with the PIN.
2. **Feels like their online banking.** A non-technical user should recognise
   the terms, the flow and the safety steps. Nothing asks for configuration,
   and the only jargon is the bank's own.
3. **More than the bank, never riskier.** The extra intelligence (categories,
   contracts, shop names, analysis) runs on the device and never shortcuts
   moving money. The review step shows exactly what the bank will receive.
4. **Any bank, as it is.** The app offers only what the user's bank and
   account support, and shows bank-specific behaviour as the bank delivered
   it.
