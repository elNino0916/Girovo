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

The owner and their household are one group among these users. They use the
app against real Sparkasse data. Developers who run it from source
(`npm run dev`) or build their own installer are a secondary audience. The
README still serves them.

The jobs they come to do:

- check the balance and what is available
- read and search Umsätze, and see what is still vorgemerkt
- send a SEPA or Echtzeit transfer safely
- understand where the money goes (Analyse, Verträge & Abos)
- get statements and receipts out as PDF or CSV

## Product Purpose

Sooskasse-FinTS is a banking app for German banks. It speaks FinTS 3.0
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
   path. The PIN lives only in memory. The device profile and the
   personal-data vault are encrypted with the PIN.
2. **Any German bank, one modern app.** It is free and open source (MIT) and
   works with any FinTS bank, in an interface that feels like familiar online
   banking.
3. **More than the bank's own app.** It goes beyond what a bank app shows,
   all computed on the machine:
   - Umsatzanalyse
   - Verträge & Abos
   - the real shop behind a card payment
   - GiroCode reading and Geld anfordern
   - a Kontoverlauf that is checked against the bank's balances

## Operating Context

- **Distribution.** The main form is the Windows desktop app: an Electron
  shell around the same Next.js app, shipped as an NSIS `Setup.exe` and a
  portable `.exe` on GitHub releases.
  - The app checks GitHub for releases. Downloading and installing an update
    are separate clicks, and each download is checked against the SHA-256
    digest GitHub publishes for it.
  - The same app runs as a localhost website for developers. It must never sit
    on a public host or a serverless or multi-worker runtime: there is one
    process, sessions live in memory, and the app has no authentication of its
    own.
- **Getting in.** The login runs in this order:
  1. Pick the bank. Quick picks show real logos; search works by name, city,
     BLZ (also typed with spaces), BIC or IBAN. The IBAN is read on the
     device, and only its BLZ goes to the search.
  2. Enter Anmeldename and PIN.
  3. Choose the security method. Only approval in the bank's app works; when
     the bank offers a single method and it is one, it is picked
     automatically.
  4. Approve in the banking app.
  5. Land on the Finanzübersicht.

  What is needed is said before the PIN is typed: a "Was brauche ich?"
  disclosure on the bank and credentials steps (the online-banking
  credentials, the bank's FinTS access, approval in the bank's app; chipTAN,
  smsTAN and TAN generators do not work), and a line on the credentials form
  that names the brand's approval app where one name holds.

  Any bank read can cost its own approval, so reads are serialised and cached.
  "Gerät merken" keeps the bank's systemId encrypted with the PIN, so the bank
  may skip TANs during its SCA exemption window (~90 days).
- **Sessions.** The app logs the user out after 5–30 minutes without input
  (default 10). It warns one minute ahead and never logs out while an approval
  is running. The server drops sessions after 30 minutes idle.
- **Data horizon.** The bank's default is about 90 days. Analyse, Verträge and
  Kontoverlauf only know the loaded period. Loading 12 months can cost a TAN,
  and some banks keep less.
- **Screen sharing.** "Beträge ausblenden" masks every amount, chart axis and
  tooltip, and the amounts inside the bank's free text (Verwendungszweck,
  references) as well as text can be read.
- **Documents.** The app produces:
  - a PDF Kontoauszug and Buchungsbeleg
  - a CSV export in the German Excel dialect, holding the booked Umsätze the
    list shows (never Vorgemerkte), with the days and any filter in its file
    name
  - a GiroCode PNG for Geld anfordern
- **What the bank sends that the UI has to absorb:**
  - bookings dated ahead of today ("noch nicht gebucht")
  - bank messages at login (Mitteilungen)
  - orders and approvals the bank refuses ("nicht ausgeführt", "nicht
    freigegeben"), shown with the bank's sentences verbatim and its code once
    as "Rückmeldung der Bank"
  - transfers whose outcome is unknown ("Status unklar"; never resend
    blindly). "Jetzt nachsehen" checks the Umsätze and Vorgemerkte in place
    and never sends anything
  - reads that fail ("Abruf fehlgeschlagen") or leave a total incomplete
    ("unvollständig"; the Gesamtsaldo is never a partial sum)
  - Namensabgleich results (Match, Close Match, No Match, Not Applicable),
    with the bank's own text shown verbatim

## Capabilities and Constraints

**Current state (4.2.0).** The README is the full feature list:

- Finanzübersicht: Konten und Karten, Gesamtsaldo, Monatsbilanz, Demnächst
  fällig
- Kontoverlauf, checked against the bank's balances
- Umsätze: search, filters, detail drawer
- automatic, correctable categories
- Umsatzanalyse
- Verträge & Abos
- CSV and PDF export
- Vorgemerkte Umsätze (HKVMK)
- SEPA-Überweisung (HKCCS) and Echtzeitüberweisung (HKIPZ), with templates,
  recent payees, GiroCode reading and duplicate and overdraft warnings. The
  duplicate check reads a 14-day record of sent orders (account, IBAN,
  amount, time, outcome) kept in the PIN-encrypted vault, so it survives a
  logout; an order is written there as unclear the moment the bank holds it
  for approval
- Namensabgleich (HKVPP/HKVPA)
- Geld anfordern (EPC QR)
- the shop behind card payments
- company logos via Brandfetch
- Gerät merken and the encrypted personal-data vault
- Beträge ausblenden and auto-logout
- Mitteilungen
- command palette (Strg+K) and keyboard shortcuts
- Hell / Dunkel / System appearance
- phone layout with a bottom navigation
- the desktop updater

**Constraints:**

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
    Übersicht, before the first lookup, and the Sitzung panel's "Firmenlogos"
    switch changes the answer. Builds without a client ID never offer it.
  - the update check, which goes to GitHub
- Fonts are self-hosted.
- A transfer whose outcome is unclear is never resent automatically.

**Terminology.** Use the banks' own words:

- Kontostand, Verfügbar, Dispositionsrahmen
- Umsätze, Vorgemerkt, Buchungstag, Valuta
- Verwendungszweck, Gläubiger-ID
- Überweisung, Echtzeitüberweisung, Namensabgleich
- Kontoauszug, Buchungsbeleg
- Gerät vergessen
- Freigabe for the approval; "TAN" only inside a method's name

Wherever the app shows a tidied counterparty name, it also shows the bank's
raw name as "Name laut Bank" (owner's request).

**Open decisions:**

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
- **What "Beträge ausblenden" hides.** The Monatsbilanz split bar hides
  today; Analyse's direction and comparison lines and the category shares do
  not. All or none?
- **Gerät merken consent.** The device is remembered after login and the app
  says so beforehand. Is an explicit "Dieses Gerät merken" choice (and
  "Anmeldenamen merken") wanted?
- **Terminology.** The app now says Kartensaldo, Kreditrahmen and
  Gesamtsaldo. Add them to the list above?
- **Optional extras** proposed during the fix pass: a "Drucken / als PDF" for
  a bank message, and a first-use toast for single-key shortcuts with
  "Kürzel ausschalten".

## Brand Commitments

- **Name and mark.** Sooskasse-FinTS, with the "€" plate and wordmark
  (`components/shell/BrandMark.tsx`). The app has its own identity. It borrows
  a design language, never another bank's or provider's branding.
- **Interface typeface.** Google Sans Flex. This is binding for now (owner,
  2026-10-04).
- **Look.** The current look is the modernised Atruvia online-banking
  language: navy chrome and stage, action blue, white tiles, pill buttons. The
  owner likes it and it stays the default. It is not locked: other looks may be
  explored, but only as alternatives for the owner to choose, never swapped in
  silently.
- **Language and voice.** German only, addressing the user informally as "du"
  (e.g. "Deine Daten bleiben bei dir"). Bank terms stay as banks use them.

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
   another host is disclosed, minimal and can be switched off. Personal data
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
