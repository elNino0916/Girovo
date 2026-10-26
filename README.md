<p align="center">
  <img
    width="1024" height="500"
    src="https://github.com/user-attachments/assets/99e4e1df-baa5-4505-8b48-3a505428ceda"
    alt="Image"
  />
</p>

A modern, self-hosted banking app for German banks that speaks **FinTS 3.0
(HBCI) PIN/TAN** — with approval in your bank's app (the *decoupled* methods
such as S-pushTAN, SecureGo plus or BestSign) or with a TAN you type: chipTAN
optisch (flicker code), chipTAN QR, photoTAN, chipTAN manuell and smsTAN.

**Features**
- **Tested with major banks** — Girovo has been tested with Atruvia, Targobank, Commerzbank and FI infrastructure.
- **All German FinTS banks** — bundled institute database (~2.700 institutes)
  with name / city / BLZ / **BIC** search, or a pasted **IBAN** (read in the
  browser — only its BLZ is sent to the search); quick picks with the real bank
  logos (`public/logos/`, sourced from Wikimedia Commons) and a monogram
  fallback for banks without one. URLs come from hbci4java's actively
  maintained bank list, with dead hosts (fiducia.de / gad.de / Dresdner)
  rewritten to their live successors — refresh anytime with
  `node scripts/update-banks.mjs`. If a bank's primary endpoint is down,
  the server automatically retries the known alternate URL.
- **German or English** — switch at any time on the login screen or in
  *Einstellungen*; without a choice the app follows the system's language
  (German on a German system, English otherwise), and so does the Windows
  installer. Figures and dates follow
  the language (1.234,56 € / €1,234.56). What your bank sends — its messages,
  answers and Verwendungszwecke — is shown as the bank wrote it, and the CSV
  export stays in the German Excel dialect either way.
- **Finanzübersicht** in Material 3 Expressive (the phone has a layout of its
  own, see [Android app](#android-app)); on the desktop a top app bar naming the page, the navigation rail with
  *Überweisen* as its floating button, *Konten und Karten* with a Gesamtsaldo that appears once every
  euro account's balance is known (*Alle Salden abrufen* asks for the missing
  ones by balance enquiry; rename accounts locally), the selected account's
  balance with Verfügbar / Dispositionsrahmen (Kreditrahmen for a card) /
  Vorgemerkt — or, when a fetch failed, the bank's reason and *Erneut
  versuchen* in its place — *Monatsbilanz* (compared with the same days of the
  month before) and *Demnächst fällig* in a side pane beside the bookings on a
  wide window; *Geld anfordern* and *Kontoauszug* under *Mehr*.
- **Several banks in one view** — *Weitere Bank anmelden* (in the Sitzung
  panel, and under the account list) runs the same login — bank, login name
  and PIN, security method, approval — for another bank, as a session of its
  own beside the first. *Konten und Karten* groups the accounts under each
  bank, the Gesamtsaldo, *Alle Konten* in Analyse, Verträge & Abos, the
  command palette and the transfer form cover all of them, and every request
  goes through the login of the account it concerns. The first login's
  encrypted vault remembers the further banks (BLZ, name, login name — never a
  PIN), so the next login offers *Auch bei … anmelden*; *Bank entfernen*
  forgets one. A bank whose session ends on its own is marked logged out, the
  others stay.
- **Kontoverlauf** — the end-of-day balance over the loaded period as a step
  chart, reconstructed from the bookings and *checked against every opening and
  closing balance the bank sent*. If the numbers don't add up, no chart is drawn.
- **Kontostand & Umsätze** with search (names, Verwendungszweck, IBAN with or
  without spaces, amounts like `12,99` or `>100`), Eingänge/Ausgänge and
  category filters, quick periods (30/90 Tage, Monat, Jahr, eigener Zeitraum),
  day totals and a full detail drawer (Referenzen, Gläubiger-ID, copy buttons,
  "Erneut überweisen" / "Zurücküberweisen", "Alle Umsätze mit …").
- **Notes on bookings** — a line of your own on any booking ("Geschenk für
  Mama", up to 280 characters), written in its detail drawer and marked on its
  row. The Umsätze search and the command palette find it, the CSV export
  carries it in a last "Notiz" column; the printed Buchungsbeleg never shows it.
  Kept encrypted in the personal-data vault, under "Beträge ausblenden" its
  amounts are masked like the bank's own text.
- **Automatic categories** (Wohnen & Energie, Lebensmittel, Mobilität, Abos, …)
  from booking codes (MT940 GVC and CAMT ISO codes), creditor IDs and a German
  keyword table, and for what those miss a small text model that runs on the
  machine (see [Category model](#category-model)) — correctable per booking or
  as a rule for a counterparty, and every rule teaches the model.
- **Your own categories and split bookings** — make a category of your own
  ("Spenden", "Handwerker", "Hund") from a booking's category menu, as spending
  or income; it counts in the Analyse, the Monatsbudgets and the CSV like any
  other, and is kept, renamed or deleted under *Einstellungen → Eigene
  Kategorien*. The keywords and the model never guess one — it takes a booking
  only by your choice or rule. *Aufteilen …* spreads one booking across up to
  ten categories (the supermarket receipt that was half a present): every sum
  counts each share in its own category, the filter and the search find it
  under each, the row says "Lebensmittel + Geschenke", and the CSV names every
  share with its amount. A split that no longer adds up to the booking (the
  bank re-issued it with another amount) is set aside, never forced.
- **Umsatzanalyse** — Einnahmen/Ausgaben/Differenz, spending by category,
  month-by-month comparison, top payees and largest expenses for one or all
  loaded accounts. Umbuchungen between your own accounts are left out, refunds
  are netted, and every figure states its basis.
- **Monatsbudgets** — a monthly amount for any spending category, set in the
  Analyse and compared with the month on view, counted exactly as "Ausgaben
  nach Kategorie" counts (refunds netted, Umbuchungen out): "212,40 € von
  300,00 €", what is left, or how far over. The running month says it is
  still running; a month the loaded period cuts says so and gives its
  spending as a minimum ("mind."), never as the month's total.
- **Steuer-Jahresübersicht** — at the foot of the Analyse: one calendar year's
  bookings in the categories you pick (Steuern, Versicherungen, Gesundheit and
  your own ones by default), grouped and summed per category, a split booking
  with its share only — as a printed PDF for whoever does the return (no notes,
  your accounts named as the bank names them, its seal like every sheet), as a
  CSV, or as a ZIP of that CSV with the receipts kept on those bookings. Each
  account says which days of the year are loaded; a year not loaded whole is
  said to be incomplete and its sums are minimums, with *Ganzes Jahr laden* per
  account. A compilation, not tax advice.
- **Kategorie-Check** — how the automatic categories fare with your own
  bookings, worked out on the machine: how many the app filed by its rules or
  by the on-device model, how many of those you left as they were, which you
  changed (automatic → yours), and the ones still without a category, each
  with the category menu to file it. Nothing of it is sent anywhere.
- **Verträge & Abos** — recurring payments detected from the bookings (direct
  debits, standing orders, subscriptions, salary) with rhythm, next expected
  date, yearly cost and a "Betrag gestiegen" flag. Labelled as an estimate;
  "Kein Vertrag" hides a false hit.
- **Kontostand am Monatsende** — where the selected account is heading by the
  month's end, worked out day by day from today's balance, the Vorgemerkten,
  the regular payments the bookings show, the bank's own Daueraufträge and
  Terminüberweisungen where they were read (counted once where both name the
  same payment), and what the account usually spends besides them (the last up
  to three whole loaded months). Whole euros after "ca.", the basis in words,
  and the day the balance may go below zero — or past the Dispositionsrahmen —
  said in time, as a warning, not an error. In the Übersicht's side pane, and
  at the head of Verträge where there is none (phones).
- **CSV export** of the Umsätze list — all of the loaded period, or what the
  filter shows (the file name says which days, and "_gefiltert") — booked
  Umsätze only, in the German Excel dialect (`;`, UTF-8 BOM, decimal comma,
  formula-injection guard), your notes in the last column, plus the existing
  PDF Kontoauszug and Buchungsbeleg.
- **Your bank's own Kontoauszüge** (HKEKA, or HKEKP — "Kontoauszug im
  PDF-Format" — where that is all the account offers, as some Sparkassen do)
  — fetched as PDF where the bank offers them, from the Umsätze's export menu,
  and every one kept on this machine as it arrives, sealed with your PIN: some
  banks hand a statement out once and mark it as delivered.
- **Receipts on bookings** — attach a photo or PDF (an invoice, a till
  receipt) to any booking, sealed with your PIN on this machine. An invoice
  paid from its GiroCode (shared to the app, dropped or pasted) can go to its
  booking by itself: once the bank books the transfer — same IBAN, same
  amount, within two weeks — the booking takes it.
- **Depot** (HKWPD) — a securities account shows its holdings in place of the
  Umsätze: name, ISIN/WKN, quantity, the bank's last price, value and the
  change since purchase where the bank reports a purchase price; the bank's
  total as the account's figure.
- **Vorgemerkte Umsätze** (pending / not-yet-booked entries) — shows incoming
  SEPA-Lastschriften and card payments *before* they book. Loaded on demand
  via `HKVMK` where the bank offers it; banks that send them with the Umsätze
  instead (Sparkassen: the "nicht gebuchte Umsätze" of `HIKAZ`/`HICAZ`) show
  them with every statement read.
- **SEPA-Überweisung** (HKCCS) and **Echtzeitüberweisung** (HKIPZ) with IBAN
  check-digit validation, review step and TAN approval. Only offered when the
  bank/account actually supports it (BPD/UPD). The form knows your recent
  payees and saved templates, can **read a GiroCode** from a pasted or dropped
  screenshot of an invoice, shows the bank name for a German IBAN, warns about
  a likely duplicate and about exceeding the available amount, and the review
  step shows name and purpose exactly as the bank will receive them.
- **Terminüberweisung and Dauerauftrag** (HKCSE, HKCDE) — the transfer sheet's
  „Termin“: *Sofort*, *An einem Datum* or *Regelmäßig*, with the dates, rhythms
  and execution days your bank allows (its HICSES/HICDES parameters). The
  review states the schedule in plain words, and the order goes through the
  same Namensabgleich, approval and „Status unklar“ as a transfer. Only offered
  where the bank and the account support it.
- **The bank's Daueraufträge and Terminüberweisungen** (HKCDB, HKCSB) — under
  *Verträge & Abos*, read on request (it can cost an approval): payee, amount,
  rhythm or date and purpose, each deletable where the bank allows it (HKCDL,
  HKCSL) after a confirmation that names exactly what goes — and changeable
  (HKCDN, HKCSA): *Ändern …* lets the amount, the purpose and the date or
  rhythm change (a Dauerauftrag from its next run the bank's lead time allows),
  never the payee, through the same Namensabgleich, approval and "Status
  unklar" as placing one.
- **Geld anfordern** — a GiroCode (EPC QR) for your own IBAN, optionally with
  amount and purpose, that any German banking app can scan; save as PNG or copy
  the account details.
- **Verification of Payee** (Namensabgleich via `HKVPP`/`HKVPA`) — where the
  bank offers it, the payee name is checked against the name behind the IBAN
  before you authorise. Match, Close Match, No Match and Not Applicable each
  get their own screen, with the bank's own explanatory text shown verbatim and
  an explicit "trotzdem überweisen" for a name that doesn't line up.
- **The real shop on card payments** — a card payment's account holder is
  usually a payment provider (every Sparkasse Visa Debit payment goes to
  "Landesbank Hessen-Thüringen", terminals often to "Adyen N.V."); the shop
  travels as the *abweichender Empfänger*. The app shows the shop, as the
  bank's own app does, cleans the terminal's descriptor
  (`LS Caf Nova Deutzer F/Frankenwerft 1/Kln/DE` → "Café Nova Deutzer F",
  Frankenwerft 1, Köln) and keeps the provider and the bank's original name in
  the booking's details.
- **Company logos on transactions** — counterparties are matched against
  [Brandfetch](https://brandfetch.com) so `PayPal Europe S.a.r.l et Cie S.C.A.`
  shows the PayPal mark. A match has to clear a deliberately high bar; anything
  short of it keeps the plain avatar rather than risking a wrong logo. It sends
  cleaned company names to Brandfetch, so it is **off until you agree**: the
  app asks once, before the first lookup, and *Einstellungen → Firmenlogos* switches
  it later. See [Company logos](#company-logos).
- **Remember this device** — after the first login the bank's device identity
  (systemId) plus the cached accounts and TAN method are saved **encrypted with
  your PIN**, so subsequent logins reuse the device and the bank can serve
  balance/transaction reads without a fresh TAN for the duration of its
  exemption window (typically ~90 days). "Gerät vergessen" wipes it. See
  [Fewer TAN prompts](#fewer-tan-prompts).
- **Personal data vault** — templates, account names, category rules,
  monthly budgets and notes on bookings are stored **encrypted with your PIN**
  (AES-256-GCM, scrypt) next to the device profile, so they exist only while
  you are logged in. "Gerät vergessen" can delete them too.
- **Umsätze auf diesem Rechner behalten** (opt-in per login, off by default,
  *Einstellungen → Auf diesem Rechner*) — every statement the bank delivers is kept
  **encrypted with your PIN** beside the vault: booked Umsätze only (never
  Vorgemerkte), the days the bank provably delivered, and the end-of-day
  balances its figures proved. Analyse, Verträge & Abos and the Kontoverlauf
  then reach as far back as what is kept (the Zeitraum menu's "Alles
  Gespeicherte", the default once something older is kept), and a longer
  period asks the bank only for what is missing — its free 90-day window, or
  from a week before the kept days end — so 12 months rarely need a TAN once
  they are kept. The bank stays authoritative: for the days it delivers, its
  answer replaces what was kept. A quiet line in the list marks where the kept
  days begin, and the Kontoverlauf over them is still checked against the
  bank's balances. Switching it off deletes them. With several banks the
  choice is the first login's and covers every bank in the view; each login
  keeps its own file, sealed with its own PIN.
- **Older Umsätze from your online banking** — while *Umsätze behalten* is on,
  *Einstellungen → Ältere Umsätze importieren* reads an export you downloaded
  from your bank's online banking — CSV in the Sparkasse, Volksbank (Atruvia)
  and similar layouts, Girovo's own CSV, camt.052/053 or MT940 — says what it
  holds and which account it names, and adds the days it covers to the kept
  Umsätze where nothing is kept for them yet. What the bank delivered over
  FinTS is never replaced by a file; camt and MT940 bring the bank's balances,
  so their days stay proven for the Kontoverlauf. Use an unfiltered export of a
  whole period: a CSV vouches for the days from its first booking to its last.
- **Backup and restore** — *Einstellungen → Sicherung* puts everything this
  machine keeps for the logins in the view — personal data (templates,
  categories, rules, notes, budgets, splits), the kept Umsätze and the kept
  documents — into one `.girovo` file, encrypted (AES-256-GCM, scrypt) with a
  password you choose for it (at least ten characters; it is made to leave the
  machine, so not the PIN). Restoring it on a new computer, the phone, or this
  machine after a loss writes each login's part anew under that machine's PIN,
  only for a login signed in there (same bank and login name), and only adds:
  what is already there wins, Umsätze fill only days not kept yet, a document
  is not added twice.
- **Beträge ausblenden** (privacy mode for screen sharing — every amount,
  chart axis and tooltip is masked, amounts inside the bank's own text as far
  as they can be recognised, and the Kontoverlauf keeps its trend but not
  whether it dipped below zero), **automatic logout** after 5–30 minutes of
  inactivity with a one-minute warning (also in the window title, and in the
  desktop app on a flashing taskbar button), **Mitteilungen** (the bank's messages
  from the login — each one can be copied or saved as a PDF, its text exactly
  as the bank sent it — plus this session's transfer outcomes), a **command palette**
  (Strg+K) and keyboard shortcuts (switchable).
- Hell / Dunkel / System appearance; phone layout with a bottom navigation.
- **Updates in the desktop app** — the Windows app looks for a new release on
  GitHub, shows what's new, and installs it on request: the download is checked
  against the SHA-256 digest GitHub publishes for every release file before it
  runs. See [Updates](#updates).

Built with **Next.js 16** (App Router, React 19, TypeScript) and **Tailwind CSS
v4**, its controls **M3E**'s Material 3 Expressive web components
(`@m3e/web`), set in **Google Sans Flex**. Fonts are self-hosted through `next/font`, so
they add no outside request of their own.

## Run it

```bash
npm install
node scripts/fetch-model.mjs
npm run dev
```

Then open **http://localhost:3000**. The second line fetches the category
model (300 MB, once); without it the app runs on the keyword rules alone.

For a production run:

```bash
npm run build && npm start
```

> ⚠️ **Single process only.** Each login is a live `FinTSClient` with an open
> FinTS dialog held in the server's memory, which cannot be serialised. Never
> deploy this to a serverless/edge runtime or behind more than one worker — a
> request landing on the wrong instance loses the session mid-approval.

> ⚠️ **Runs locally only.** Your PIN is held in server memory for the session
> and is never written to disk or logged. Do not expose this on a public host.

## Windows desktop app

The same app also builds into a normal Windows program — no terminal, no
browser tab, and **no Node.js or separate backend setup required**. The build
produces a self-contained installer that bundles **both the backend and
Electron into one package**:

```bash
npm run electron:dist
```

That produces the installer in `dist/`:

| File | What it is |
|------|------------|
| `Girovo-<version>-Setup.exe` | Standard NSIS installer — double-click to install, uninstall via *Programs & Features*. German on a German Windows, English on any other; its own texts are in `build/installer.nsh`. |
| `Girovo-<version>-Setup.exe.blockmap` | What the updater compares to download only what changed (see [Updates](#updates)). |

It is about 400 MB: the category model is most of it, the Electron runtime
most of the rest. There is no portable build since 5.13.0.

### What the installer contains

The package is entirely self-contained. You only need the one file — **no Node,
no npm, no extra software**:

- **Electron shell** — the desktop window.
- **Next.js standalone server** — the full backend API (FinTS session, SEPA,
  transfers, …), bundled without any dependency on a system-level Node install.
  Electron starts it as a child process using its own embedded Node runtime
  (`ELECTRON_RUN_AS_NODE=1`), bound to `127.0.0.1` on a random free port.
  Nothing is reachable from the network, and the port never collides with a dev
  server.
- **Category model** — `resources/models/category-model` (280 MB) and
  the ONNX runtime for Windows x64 (29 MB, CPU only). See
  [Category model](#category-model).

End users simply run the installer. Developers building from source only need
`npm run electron:dist`.

Nothing about the website workflow changes — `npm run dev`, `npm run build` and
`npm start` behave exactly as before.

| Script | What it does |
|--------|--------------|
| `npm run electron:build` | `next build` in standalone mode, plus the two folders a standalone build leaves behind (`.next/static`, `public`). Output: `.next/standalone/`. |
| `npm run electron:start` | Opens the desktop window against that build — a packaging-free way to check it. |
| `npm run electron:dist` | The above, then wraps it with electron-builder into `dist/`. |
| `npm run electron:dev` | Points the desktop window at a running `npm run dev` (start that first), so the app hot-reloads. |

Remembered device profiles (see *Fewer TAN prompts*) cannot live next to a
program installed under `Program Files`, so the desktop app puts them in
`%APPDATA%\Girovo\fints-state` via the `FINTS_STATE_DIR` environment
variable. The website keeps using `.fints-state/` in the project root.
The app was called Sooskasse-FinTS up to 4.3, and a machine that already has
`%APPDATA%\Sooskasse-FinTS` keeps using that folder (`electron/main.cjs`), so
the update to Girovo carries the device profile, the vault and the settings
over as they are.

`config.json` is baked into the package at build time — set your product ID
before building.

### Linux

The same app also builds for Linux (x64), on a Linux machine — electron-builder
cannot make these packages on Windows:

```bash
npm run electron:dist:linux
```

| File | What it is |
|------|------------|
| `Girovo-<version>-x86_64.AppImage` | Single file, no installation needed — `chmod +x` it and run it. Needs FUSE (`libfuse2` on Debian and Ubuntu). |
| `Girovo-<version>-amd64.deb` | Package for Debian, Ubuntu and their relatives — installs to `/opt/Girovo`, with the `girovo` command and a menu entry. |

CI builds both on every push to `main`, next to the Windows files
(`.github/workflows/build-development.yml`). The packages are the Windows app
with three differences: the ONNX runtime is Linux's (`libonnxruntime.so.1`,
46 MB), there is no update window (`build/update-window` is Windows only, so a
failed start is said in a plain message box), and neither package updates
itself — the update dialog offers the release page instead
(see [Updates](#updates)). The settings, the vault and the device profiles go
to `~/.config/girovo`.

The `.deb` sets up Chromium's sandbox when it installs, including the
AppArmor profile Ubuntu 24.04 and later need for it. The AppImage cannot do
that: on those systems it stops at start with a sandbox error. Use the `.deb`
there.

### Updates

The desktop app updates itself from this repository's
[GitHub releases](https://github.com/elNino0916/Girovo/releases)
(`electron/updater.cjs`):

- **Checking** — 15 seconds after the start and then every 6 hours, the app asks
  GitHub's API for the latest release. The request carries the app's version
  (`User-Agent: Girovo/<version>`) and nothing about you or your
  accounts; it goes through a session of its own without cookies or cache.
  Switch it off under *Einstellungen → Updates* — a check is then only made when you
  press "Nach Updates suchen".
- **Nothing happens without a click.** A newer version shows up in
  *Mitteilungen* (and on the login screen's bar); downloading it and restarting
  into it are separate, explicit steps. The restart waits while a TAN approval
  is open, and says that it signs you out.
- **Verified** — GitHub computes a SHA-256 digest for every file attached to a
  release. The download is checked against it before it is kept and again right
  before it runs; a file that does not match is deleted. A release without
  digests is only offered as a link to its page.
- **Installed copies** (from the `Setup.exe`): the new `Setup.exe` runs silently
  over the existing installation and starts the app again. The installer waits
  for the old app to close on its own before it touches a file
  (`build/installer.nsh`); an installation "for all users" asks for
  administrator rights. While it works, a small window in the app's look shows
  how far it is and closes once the new version is up
  (`build/update-window/UpdateWindow.cs`, built with the C# compiler that comes
  with Windows by `scripts/build-update-window.mjs` — `--demo light|dark|failure`
  shows it, `--lang en` in English; it carries the app's font inside it, made by
  `scripts/make-window-fonts.py`). It only watches: the update runs the same
  without it. The same window says it when the app cannot go on — it could not
  start, or its server stopped — in the app's look and language, with "Restart
  Girovo"; Windows' plain message box is left only as the fallback.
- **Only what changed** — the installer keeps a copy of itself in the
  installation (`resources\update-base.bin`). An update compares the new
  release's blockmap with the installed release's, copies the unchanged parts
  of the installer from that file and downloads only the rest from GitHub in
  byte ranges: usually 1–3 MB instead of ~400 MB. A release that changes nearly
  everything (a new Electron) still reuses the few MB that stayed. The result
  is checked against GitHub's digest like any download; if anything does not
  fit (no blockmap, an installation from a local build, nothing reusable at
  all), the whole `Setup.exe` is downloaded instead.
- **Portable copies** (up to 5.12.1; there is no portable build since): a newer
  release has no `portable.exe`, so the dialog links to the release page, where
  the `Setup.exe` is.
- **Linux** (AppImage and `.deb`): the check and "what's new" work the same,
  but the app does not replace itself — the dialog links to the release page
  to download the new file from.
- After the update the app says so once, with the release notes.

**Publishing a release** the updater picks up needs nothing beyond what
`npm run electron:dist` produces: create a normal GitHub release (not a draft,
not a pre-release) whose tag is the version (`4.1.0` or `v4.1.0`) and attach
`Girovo-<version>-Setup.exe` and `Girovo-<version>-Setup.exe.blockmap`
from `dist/` — upload the files of one build, the blockmap has to describe
exactly that `Setup.exe`. GitHub adds
the digests by itself; no `latest.yml` is needed. Without the blockmap the
release still works, it is just downloaded whole — by the copies updating to
it and, later, by the copies updating *from* it. Attach the `.AppImage` and
the `.deb` from `npm run electron:dist:linux` (or CI's Linux artifact) too, for
the Linux users the dialog sends there.
The release text becomes the app's "Was ist neu" (Markdown: headings, lists,
bold, links). Development builds (`<version>-dev.<n>`) are newer than the
release they are numbered after, so they are only offered a higher version.

**The old repository.** Up to 4.3 the app was Sooskasse-FinTS, and its
updater asks `elNino0916/Sooskasse-FinTS` for updates and accepts files from
there only; 5.0.0, built before the switch, asks there too. Since the rename
that name belongs to a small repository of its own: it carries 5.0.1 (the same
files as here) as its latest, and beside it the releases older installs
compare with to download only what changed — `v4.2.0`–`v4.3.0` and `5.0.0`,
each with its original `Setup.exe` and blockmap (`v`, because GitHub keeps the
tags of the old repository's immutable releases reserved under that name).
From 5.0.1 on, the app asks this repository. The old one needs no further
releases — and must not be deleted while older installs may still be around.

To try the flow without publishing anything, point an unpackaged build at a
local feed: `GIROVO_UPDATE_FEED=http://127.0.0.1:<port>/latest` (an answer
shaped like GitHub's `/releases/latest`) and `GIROVO_UPDATE_KIND=nsis` or
`portable`, then `npm run electron:dev` (`GIROVO_UPDATE_BASE=<path to a
Setup.exe>` stands in for the installed copy's `update-base.bin`; the feed then
also needs `/tags/<version>`). A packaged app ignores all of them. The
design preview shows every state of the update dialog with a fake updater
(`/design-preview?view=update`, `update-ready`, `update-installed`, …).

### Telemetry

The desktop app reports to the developer's own server
(`config.json` → `telemetry: { endpoint, key }`), through a vendored copy of
its SDK (`electron/telemetry-sdk.mjs` — never loaded from the network). The
main process decides what goes out (`electron/telemetry.cjs`):

- **Error reports, always.** Crashes and unexpected failures of the shell, the
  server (`wrap()` in `lib/api.ts`, `instrumentation.ts`) and the page, with
  where they happened: the source, the API route, the bank's BLZ when known.
  Messages and stacks are scrubbed first (`electron/telemetry-scrub.cjs`):
  IBANs, amounts, dates, long numbers, e-mail addresses, quoted text, names
  after labels like "Empfänger", URL queries and the Windows user folder are
  masked. Without the user's yes a report carries no install id, only the SDK's
  per-start session id.
- **Usage, only after the user's yes** — asked once by a tile on the Übersicht,
  changeable under *Einstellungen → Nutzungsdaten teilen*: which screens are used,
  how logins end (with the BLZ, never the login name), how long the bank takes
  to answer, how long the app takes to start, exports made (format and kind of document only), update events, and a random install
  id. Switching it off deletes the id.

Only the events and fields declared in `electron/telemetry.cjs` are sent, each
of a fixed type, so no free text from the bookings can travel in a property.
Never sent: login name, PIN, IBANs, balances, bookings, amounts, payees,
Verwendungszwecke. Every report shows the server the user's IP address.

The server process does not send anything itself: `lib/telemetry.ts` writes one
marked line per report to its stdout, which the shell takes out of the log and
judges like its own. `npm run dev` and an unpackaged `electron:dev` send nothing
(set `GIROVO_TELEMETRY=1` to try it). A build without the `telemetry` block in
`config.json` sends nothing at all. The design preview fakes the bridge with
`?usage=unasked|on|off`.

## Android app

The same app also runs on Android phones (Android 11 and later), with the
banking done on the phone itself: the desktop server's route handlers run
inside the app (`mobile/`), and the phone talks to the bank directly — no
server in between, no cloud account.

```bash
npm run android            # debug build, installed on the connected phone or emulator
npm run android:release    # signed releases into dist/ (see android/README.md)
```

| File | What it is |
|------|------------|
| `Girovo-<version>-android.apk` | The app from GitHub, for every current phone (arm64). It updates itself from this repository's releases, like the desktop app: downloaded, checked against GitHub's SHA-256, installed by Android. |
| `Girovo-<version>-play.aab` | The same app for Google Play, which installs its updates. |

[Obtainium](https://github.com/ImranR98/Obtainium) can install the APK and keep
it current from this repository's releases, beside the app's own update check:

[<img src="https://raw.githubusercontent.com/ImranR98/Obtainium/main/assets/graphics/badge_obtainium.png" alt="Get it on Obtainium" height="54">](https://apps.obtainium.imranr.dev/redirect?r=obtainium://add/https://github.com/elNino0916/Girovo)

The APK's signing certificate — the same since the first one — and how to
check it are in [SECURITY.md](SECURITY.md#checking-that-a-download-is-girovo).
The Play app is signed by Google's key instead, so the two cannot update over
each other.

On the phone the app looks the way Android apps look now: Material 3
Expressive, with springy motion, shape-morphing buttons and Material Symbols,
in the wallpaper's colours (Material You), the very colours the phone's own
apps use, in the phone's light or dark; the desktop keeps Girovo's blue. The
colours that carry meaning (credit, negative balance, vorgemerkt) stay
Girovo's on every phone. The layout is the phone's own (since 5.11):

- **Three places** in the navigation bar: *Übersicht*, *Zahlungen*
  (Überweisen, Geld anfordern, GiroCode scannen, Vorlagen and Zuletzt bezahlt
  above Verträge & Abos) and *Analyse*.
- **Search first**: the Übersicht opens with a search bar for Umsätze, payees
  and the app's actions, where a question goes on to *Frag deine Umsätze*;
  then the balance with Verfügbar and its course, the accounts as a bottom
  sheet behind the account's name, and the bookings.
- **A transfer starts with the amount**, on the number pad, then the payee,
  then the review.
- **A booking's details in tabs**: Details, Notiz & Belege, Kategorie.
- **The Sitzung panel** as a bottom sheet, with the bank's Mitteilungen.

Beyond the desktop app's features it has:

- **Fingerprint login** (opt-in): the PIN of the login the app opens with,
  and those of the further banks logged in beside it, sealed under a key in
  the Android Keystore that only a fingerprint opens. One fingerprint logs in
  every one of them, the approvals still as each bank asks. Adding a
  fingerprint to the phone deletes them all; a PIN the bank refuses, or
  "Bank entfernen", deletes that bank's.
- **Categories with Gemini Nano** instead of the desktop's model: the
  language model Android's AICore runs on the phone itself, so there is
  nothing to download in the app. On a phone without it Einstellungen says
  "Nicht unterstütztes Telefon" and the keyword rules sort alone
  (android/README.md).
- **A check of the phone itself**, on the phone alone — no server, no request
  to Google: a fresh key in the phone's secure hardware, its attestation
  verified up to Google's roots, says whether the bootloader is locked and the
  system verified; the app's signing certificate says whether this is Girovo
  as released. A modified phone or a copy someone else signed gets a warning
  before the PIN is typed; *Einstellungen → Gerätesicherheit* always says what
  was found. Nothing is blocked. (Google's Play Integrity verdict can only be
  read on a server, which Girovo does not have.)
- **The share sheet** for a GiroCode, Android's file picker for the CSV
  export, and Android's print dialog ("Save as PDF") for Kontoauszug,
  Buchungsbeleg and Mitteilungen.

The Android app reports errors and, with the user's yes, usage by the
desktop app's rules ([Telemetry](#telemetry); `mobile/bridges/telemetry.ts`).
How it is built, signed and published —
and what Google Play asks of an app like this — is in
[android/README.md](android/README.md).

## FinTS product registration (important)

FinTS requires a **product registration ID** issued (free) by the ZKA — some
banks reject dialogs without one (code 9078). Register at
<https://www.fints.org/de/hersteller/produktregistrierung> and put the ID into
`config.json`:

```json
{ "productId": "YOURID", "productVersion": "1.0" }
```
If you do not want to request a product ID from DK, a simple Google search will give you plenty of IDs you could use,
however, using a officially obtained key is recommended to prevent your Girovo from being detected as automated
traffic and therefore being blocked by your bank's infrastructure.

## How it works

| File | Purpose |
|------|---------|
| `app/api/*/route.ts` | The Node-runtime route handlers. Each one is thin: validate → call the session's `FinTSClient` → serialise. Decoupled TAN operations are continued via `/api/tan-poll`. |
| `lib/session.ts` | Product registration (`config.json` / `FINTS_PRODUCT_ID`) and the in-memory session store. Pinned to `globalThis` so hot reload doesn't drop logged-in users; 30-minute idle sweep. |
| `lib/fints-sepa.ts` | Adds the transfer segments **HKCCS**/**HKIPZ** (lib-fints is read-only out of the box): segment definitions, pain.001 XML builder (001.001.03 / 001.003.03 / 001.001.09), SEPA character-set sanitizing, IBAN/BIC/amount validation. The descriptor is picked per segment — HKIPZ has its own format list in **HIIPZS**, HKCCS falls back to the bank-wide one in **HISPAS**. |
| `lib/fints-orders.ts` | Adds the orders a bank keeps for later: **HKCSE**/**HKCSB**/**HKCSL** (terminierte SEPA-Überweisung) and **HKCDE**/**HKCDB**/**HKCDL** (SEPA-Dauerauftrag) with their answers and parameter segments, the bank's rules for dates, rhythms and days, the Bestand read (Aufsetzpunkt followed) with each order's pain.001 decoded (`lib/xml-tree.ts`), and the deletion that sends the bank's own order data back. The sources for each layout are listed at the top of the file; `lib/order-schedule.ts` checks a schedule and says it in words. |
| `lib/fints-vop.ts` | Adds **HKVPP**/**HKVPA** (Namensabgleich — Verification of Payee): segment definitions, a collector that merges a result delivered over several messages (Aufsetzpunkt, return code 3040) incl. a pain.002 fallback, the HIVPPS lookup that says which transactions the bank checks, and the return codes that steer the flow (3090/3091/3945/9076). |
| `lib/fints-pending.ts` | Adds **HKVMK** (Vormerkposten / pending entries): segment definitions + a `PendingInteraction` that parses the returned **MT942** with lib-fints' MT940 parser (MT942 reuses the `:61:`/`:86:` entry format). |
| `lib/fints-statements.ts`, `lib/noted.ts` | Umsätze with the Vormerkposten a bank sends beside them (**HIKAZ** MT942, **HICAZ** camt.052 `PDNG`), which lib-fints decodes but drops — the only way Sparkassen deliver them. Subclasses of lib-fints' statement interactions keep its request and its reading of the booked part, and parse the noted part on its own, so it can never cost the Umsätze. |
| `lib/fints-internals.js` + `.d.ts` | Re-exports the lib-fints internals its `exports` map hides (segment definitions, data elements, `registerSegmentDefinition`, the statement interactions and the CAMT parser). Kept as one shim so the library's segment registry stays a single module instance — see the note in `next.config.ts`. |
| `lib/banks.ts` | Institute database (`banks-data.json`, regenerate via `npm run update-banks`): hbci4java's maintained bank list with dead-host rewrites, plus alternate URLs from [`fints-institute-db`](https://www.npmjs.com/package/fints-institute-db); BLZ/BIC lookup, fuzzy search (with short names such as DKB, HVB, OLB), brand detection for logos. `lib/bank-query.ts` reads a query as name, BLZ or IBAN — in the browser, so an IBAN never leaves it. |
| `lib/bank-fetch.ts` | Every lib-fints request under one policy, attached from outside the library: a 60 s limit on the bank's first byte, cancellation (a login called off), and HTTP error pages or unreadable replies turned into one German sentence — bodies go to the server log only. Also the route handlers' error translator. `lib/bank-answer.ts` reads a bank's `code: text \| code: text` answer the one way the whole app does: sentences plus a small list of codes, lock detection by the bank's own wording, and the refusal test the order routes share — only an answer that refuses the order and says nothing else is a refusal; anything doubtful stays „Status unklar“. |
| `lib/serialize.ts` | Maps lib-fints objects to the JSON the browser sees; `lib/fints-types.ts` holds that contract, imported by both sides. |
| `lib/merchant-match.ts` | The company-detection model: name cleaning, the corporate-marker privacy gate, the candidate ladder and the scoring thresholds. Deterministic and inspectable — no network, no data files. |
| `lib/merchants.ts` | The Brandfetch lookup behind it: Brand Search API for recall, name/domain scoring for precision, the Logo CDN fetch, process-level caching of hits *and* misses, and the logo proxy's allowlist. |
| `lib/state-store.ts` | Encrypted device-profile persistence (`.fints-state/`, gitignored, or wherever `FINTS_STATE_DIR` points): AES-256-GCM, key derived from the PIN via scrypt. Stores systemId + cached BPD/UPD + TAN method so logins skip a fresh sync SCA. |
| `patches/` | Patch for lib-fints (via `patch-package`, applied on `npm install`): exports the internal `registerSegmentDefinition` so the custom segments can be registered, reads camt.053 as well as camt.052, and keeps the ultimate creditor/debtor (MT940 `ABWE+`/`ABWA+`, CAMT `UltmtCdtr`/`UltmtDbtr`) that the parser otherwise drops — where the shop behind a card payment is named. |
| `lib/vault.ts`, `lib/crypto-box.ts` | The encrypted personal-data vault (templates, account names, category rules, budgets, notes) and the AES-256-GCM/scrypt helpers it shares with the device profile. Sanitised server-side, written atomically. |
| `lib/budgets.ts`, `lib/notes.ts`, `lib/category-check.ts` | Monthly budgets (what counts, a month's coverage of the loaded days, under/over), notes on bookings (one line each, capped to stay well inside the vault) and the Kategorie-Check's counting. Pure and tested; the vault and the page sanitise with the same functions. |
| `lib/history.ts`, `lib/history-store.ts` | The Umsätze kept on this computer: the pure rules (what the bank delivered, the merge where the bank is authoritative for its days, caps, what to ask the bank for, the list and the Kontoverlauf over kept days — shared by server and browser) and the sealed per-login file. The server keeps each statement answer itself once it is sent, when the vault says so; the browser never uploads a booking. `lib/sealed-file.ts` is the atomic-write plumbing both stores share. |
| `lib/categorize.ts`, `lib/analytics.ts`, `lib/recurring.ts`, `lib/balance-history.ts` | Pure, tested analysis: categories, period totals and comparisons, recurring-payment detection, and the verified balance history. They handle both MT940 and CAMT shapes. |
| `lib/csv.ts`, `lib/girocode.ts`, `lib/qr.ts`, `lib/qr-read.ts` | CSV export, the EPC069-12 GiroCode payload (build + parse) and QR rendering/reading (bundled `qrcode-generator` and `jsqr`, no network). |
| `components/FintsProvider.tsx` | The client state machine: login → TAN method → dashboard, with every bank read serialised behind one `busy` flag (each read can cost its own approval), the decoupled poll loop, the applied date range, auto-logout, the vault and the inbox. Further banks are logins of their own beside the first (`links`); `lib/linked-banks.ts` routes each request to the session of the account's login, refuses a bank whose account numbers would collide with ones shown, and sanitises what the vault keeps about it. |
| `components/*` | The UI: `shell/` (top app bar, navigation bar and rail, Sitzung panel), `settings/` (the Einstellungen page), `overview/`, `transactions/`, `insights/` (Analyse, Verträge), `transfer/`, `auth/`, `updates/` (the desktop updater's dialog and notices), plus the command palette, inbox and primitives in `ui.tsx`. |
| `app/globals.css`, `app/material.css`, `app/android.css` | Design tokens as CSS variables mapped into Tailwind v4 via `@theme inline` (`globals.css`); the Material 3 Expressive look on every platform — the Girovo-blue scheme mapped onto Material's standard tokens for M3E's components, shapes, motion, the flat page (`material.css`, its springs generated by `scripts/build-m3e-css.mjs`); the phone's own behaviour (`android.css`). The print styles for the Kontoauszug are frozen separately. |
| `app/design-preview` | Dev-only harness that renders every screen with generated data (`/design-preview?view=overview`, `analysis`, `analysis-budgets`, `category-check`, `detail-note`, `contracts`, `transfer`, `login`, …; `&theme=dark`, `&privacy=1`). Returns 404 in production. |
| `electron/main.cjs` | The desktop shell: boots the standalone server on loopback, opens the window, denies every device permission and sends outside links to the real browser. Paired with `scripts/build-electron.mjs` and `electron-builder.yml`. |
| `electron/updater.cjs`, `electron/update-logic.cjs` | The [updater](#updates): checks GitHub releases, downloads and verifies against GitHub's SHA-256 digest, starts the installer (or the new portable build). Node built-ins and Electron only; the decisions (versions, files, install kind) are pure and tested on their own. The page side is `components/updates/`. |

### API surface

| Endpoint | Purpose |
|----------|---------|
| `GET  /api/meta` | Product-ID status, bank count |
| `GET  /api/banks` | Curated quick-pick banks; `?blz=` checks that one BLZ is still listed |
| `GET  /api/bank-search?q=` | Search all institutes (name, city, BLZ, BIC — never an IBAN) |
| `POST /api/connect` | First sync; returns TAN methods |
| `POST /api/connect/cancel` | Call off a login in flight (`attemptId`); drops any session it created |
| `POST /api/select-tan` | Select a TAN method/media + authenticated sync (accounts) |
| `POST /api/tan-poll` | Continue the pending approval: polled for a decoupled one, sent once with `tan` for a typed one (a flicker code or a matrix graphic travels with the challenge, `lib/flicker.ts`) |
| `POST /api/cancel-pending` | Abandon the pending approval client-side |
| `POST /api/balance` | Kontostand for one account |
| `POST /api/portfolio` | A Depot's holdings (HKWPD) |
| `POST /api/bank-statements` | The bank's own Kontoauszüge for one account (HKEKA), kept as they arrive |
| `POST /api/docs` | Kept documents (`op`: list, get, addReceipt, link, remove) — statements and receipts, sealed with the PIN (`lib/doc-store.ts`) |
| `POST /api/transactions` | Umsätze (optional date range), with the Vorgemerkte the bank sent beside them |
| `POST /api/pending` | Vorgemerkte Umsätze (HKVMK; on-demand) |
| `POST /api/transfer` | SEPA-Überweisung (`instant: true` → HKIPZ; a `schedule` → HKCSE or HKCDE); answers `needsVop` when a Namensabgleich needs the user's decision |
| `POST /api/vop-confirm` | Send the parked transfer anyway, confirming the Namensabgleich result (HKVPA) |
| `POST /api/bank-orders` | The bank's Daueraufträge or Terminüberweisungen for one account (HKCDB/HKCSB; `kind`) |
| `POST /api/bank-orders/delete` | Delete one of them (HKCDL/HKCSL), named by the handle the last read gave it |
| `POST /api/merchants` | Resolve counterparty names to company logos (Brandfetch) |
| `GET  /api/merchant-logo?id=` | Proxy a resolved logo; only ids this process minted |
| `POST /api/device-status` | Whether a remembered device exists for (BLZ, user) — a POST so the login name never lands in a URL |
| `POST /api/forget-device` | Delete the encrypted device profile (`wipeData: true` also deletes the vault and the kept Umsätze) |
| `POST /api/vault` | Read / save / reset / wipe the encrypted personal-data vault (`op`; `wipe` takes the kept Umsätze too) |
| `POST /api/history` | Read / start over / wipe the Umsätze kept on this computer (`op`: `get`, `reset`, `wipe`) — there is no op that writes bookings |
| `POST /api/keepalive` | Keep an active session alive (no bank traffic) |
| `POST /api/logout` | Drop the session |

## Category model

Categories come first from the bank's booking codes, creditor IDs and a German
keyword table (`lib/categorize.ts`). For the outgoing bookings none of those
recognise — a local bakery, a physiotherapist, a parking app — a text model
decides, on the machine (`lib/category-model.ts`):

- **The model** is [multilingual-e5-base](https://huggingface.co/intfloat/multilingual-e5-base)
  (MIT), int8-quantised ONNX from
  [Xenova/multilingual-e5-base](https://huggingface.co/Xenova/multilingual-e5-base),
  run by `onnxruntime-node` on the CPU in the app's own server. Its weights are
  over GitHub's file limit, so they are not in the repository:
  `scripts/fetch-model.mjs` downloads them pinned to one revision and checks
  every file's hash; `npm run electron:build` runs it before every build.
- **Switching models:** `scripts/fetch-model.mjs` is the only file that names
  the model. It keeps each calibrated one — e5-base, and e5-small (118 MB,
  used in 5.0.2 and 5.0.3) — with its pins and thresholds; `MODEL` picks the one to
  ship, and the thresholds go beside the weights as `model.json`, which the
  app reads. Switching is that one word and a rerun of the script.
- **How it decides:** the booking's counterparty and Verwendungszweck are
  compared with short descriptions of each spending category, with a
  counter-class for money between people (a gift, a repayment), and with the
  counterparties the user has filed by rule — a near-identical name takes the
  rule's category. Only a clear winner counts; anything else stays
  "Sonstiges". Money coming in is never guessed.
- **Where it shows:** the guess comes after the keywords and is labelled as a
  guess like theirs. The contract detection (`lib/recurring.ts`) uses it too,
  so a card payment at a shop the keywords do not know is judged as a habit,
  not a subscription. The Analyse's Kategorie-Check counts how many bookings
  it filed and how many of those you changed — on the machine, for you alone.
- **Privacy:** nothing leaves the machine — the page asks the app's own server
  on `127.0.0.1`, and the server keeps the vectors in memory only, logging no
  text. The model takes about 600 MB of memory while loaded; it is loaded on
  first use and released after a quiet minute.
- **On Android** the same place is taken by Gemini Nano through the phone's
  AICore (`lib/nano-categories.ts`, `mobile/server/categories.ts`), with the
  user's rules matched by name before it is asked; see android/README.md.
- **Calibration:** `node scripts/eval-category-model.mjs` (`--sweep` to search)
  scores two labelled sets of German bookings. The thresholds and the
  category descriptions are tuned on the first (87 of 99 right, 3 wrong); the
  second is never tuned on and is what tells how the model does on names
  nobody has looked at — 66 of 83 right, 7 of its 73 guesses wrong (90 %).
  The thresholds accept a few wrong guesses for many more right ones; a wrong
  one is fixed with a click, and a rule then teaches the model that name.

## Company logos

Bank statements name a counterparty in its full legal form, which is rarely the
brand you'd recognise. Girovo resolves the brand against
**[Brandfetch](https://brandfetch.com)**: a Brand Search API to turn the cleaned
name into a company + domain, and Brandfetch's Logo CDN to fetch a correctly
sized mark for that domain.

**This is the only feature that sends anything from your bookings to a host
other than your bank, so it is off until you agree.** The first Übersicht asks
once — *Firmenlogos anzeigen?*, with exactly what is sent — and every lookup
waits for the answer. The answer is kept on this machine with the other
preferences; *Einstellungen → Firmenlogos* changes it at any time, and switching it
off drops the logos at once.

A build offers the feature only with a free client ID from
<https://developers.brandfetch.com> (release builds carry one):

```json
{ "brandfetchClientId": "YOUR_CLIENT_ID" }
```

or `BRANDFETCH_CLIENT_ID=...`. To take it out of a build entirely — no
question, no switch — leave the client ID out or set:

```json
{ "merchantLogos": false }
```

or `FINTS_MERCHANT_LOGOS=0`. Off means the app talks to nothing but your bank,
and every transaction keeps its plain avatar.

**What is and isn't sent.** Only the cleaned company core leaves the machine —
`PayPal`, not `PayPal Europe S.a.r.l et Cie S.C.A.` — and never an amount, IBAN,
date or reference. Like any web request, each lookup shows Brandfetch your IP
address. A name is only ever sent if it carries a *corporate marker*:
a legal form (`GmbH`, `AG`, `S.a.r.l`, `Ltd`, …), a mostly-uppercase spelling, or
a corporate keyword. A private transfer from `Anna Beispiel` has none of these
and is never looked up. Names are resolved at most once per server run — misses
are cached too — and logo images are proxied through the app, so the browser
itself never talks to Brandfetch directly. Nothing is written to disk.

**How a match is decided** (`lib/merchant-match.ts`, `lib/merchants.ts`). The
model is deterministic and biased towards showing nothing:

1. Trailing legal forms and qualifiers are stripped into an ordered ladder of
   candidates — `DB Vertrieb GmbH` → `DB Vertrieb`, then `DB`. The more
   aggressively stripped a candidate is, the higher the bar it must clear; a
   two-or-three letter core is only accepted on an *exact* label or alias hit.
2. Each candidate is looked up via Brandfetch's Brand Search API, which returns
   a small set of `{ name, domain, claimed }` hits for recall.
3. Every hit is scored against the candidate on both its name and its bare
   domain (`paypal.com` → `paypal`); only a hit that clears the rung's score
   threshold is accepted, and Brandfetch-verified (`claimed`) brands are
   preferred on a tie.
4. The winning hit's domain is fetched through Brandfetch's Logo CDN at a fixed
   size with `fallback/404` — a domain with no real logo comes back as a plain
   miss instead of a generic placeholder mark.

Anything that fails at any step resolves to null and the row keeps its avatar.

## Fewer TAN prompts

By default a FinTS app connects "for the first time" every login, throwing away
the bank's *Kundensystem-ID* (systemId). The bank then never recognises a
returning device and is entitled to demand a fresh TAN each session — and this
app additionally used to fetch each account in its own dialog (one TAN per
account).

Two things reduce that:

1. **Batch-friendly caching** — one statement query returns both the Umsätze and
   the Kontostand, and results are cached per account, so switching accounts
   doesn't re-approve.
2. **Remember this device** — after a successful login the app saves the
   systemId + cached BPD/UPD + selected TAN method to `.fints-state/`,
   **encrypted with your PIN** (AES-256-GCM, scrypt-derived key). On the next
   login the same PIN unlocks it and the app restores the device instead of
   re-syncing, so the bank can apply its SCA-exemption window (usually ~90 days)
   and serve balance/last-90-days reads without a new TAN.

**What this does *not* do:** it never bypasses SCA. Strong Customer
Authentication is mandated by PSD2; whether reads are actually TAN-free within
the window is the **bank's** decision, and many decoupled-TAN banks still
require approval at least on login. The PIN is **never** stored — only a salt,
IV and ciphertext are; without the correct PIN the profile can't be decrypted.
A short numeric PIN is low-entropy, so this protects the file if it's copied off
your machine but a determined attacker with the file could brute-force a short
PIN offline (scrypt only slows this) — keep the machine trusted. Use **"Gerät
vergessen"** to wipe the saved profile, and profiles auto-expire after 60 days.

## Notes & limitations

- You need a bank contract with **FinTS/HBCI access enabled** and a TAN
  method: approval in your bank's app (S-pushTAN, SecureGo plus, BestSign, …)
  or a typed TAN — chipTAN optisch (the flicker code, HHD 1.4 and 1.3, with
  size and speed controls), chipTAN QR and photoTAN (the bank's graphic),
  chipTAN manuell and smsTAN (the bank's words). The typed methods are built
  from the specification and the reference vectors of open implementations
  and have not yet been tried against every bank's flavour of them.
- The bank's own Kontoauszüge come over HKEKA, or over HKEKP where the account
  offers only that. HKEKP is built from the specification and open
  implementations and **not yet tried against a real bank**; its answer is read
  by what each element is (lib/fints-statement-pdf.ts), because its versions
  order them differently. No receipt (Quittung) is sent back for either.
- A bank must start answering within 60 seconds, or the request is reported as
  "Deine Bank antwortet gerade nicht" (error pages and unreadable replies too —
  their content stays in the server log). A login can be cancelled after a few
  seconds of waiting. A transfer whose answer is lost this way still ends as
  **„Status unklar“**, never as failed.
- Transfers require the bank to offer HKCCS/HKIPZ over FinTS for your account —
  the UI greys the option out otherwise.
- The Namensabgleich runs only where the bank advertises HKVPP/HKVPA and lists
  the transfer type in HIVPPS. Banks that deliver the result across several
  round trips (return code 3040) are followed for up to four extra check
  requests; beyond that the app reports "Prüfung läuft noch" rather than
  hammering the endpoint. The bank's requested pause between requests is not
  honoured — see the note on `MAX_VOP_POLLS` in `lib/fints-vop.ts`.
- Opt-Out (`HKVOO`, waiving the name check) is a business-customer feature for
  Sammelaufträge and is not implemented.
- Terminüberweisungen and Daueraufträge are built from the specification and
  open implementations (see the top of `lib/fints-orders.ts`) and have **not
  yet been tried against a real bank** — changing one (HKCSA/HKCDN) neither.
  A change keeps the payee; the bank's parameters for it (which fields it lets
  change) are not read, so a field it does not allow comes back as its
  refusal, in its own words. A device remembered by an earlier
  version keeps its stored BPD, which lacks the parameters for them; until the bank sends a
  new BPD the app offers a narrower, safe choice (monthly, quarterly,
  half-yearly, yearly on the 1st–28th, up to a year ahead) and says so.
- If the bank closes the dialog during a transfer approval, the app shows
  **„Status unklar“** and asks you to check the Umsätze before retrying —
  never blindly resend a transfer.
- **Dates ahead of today are normal.** Fetch a statement on a weekend and the
  bank will stamp a fresh entry with the next business day as its *Buchungstag*
  while value-dating it immediately, and date the closing balance of its interim
  report to that same day. Such entries are labelled **„noch nicht gebucht“**
  and show `Buchung <date>`; the balance line reads *Buchungstag* instead of
  *Stand*. Nothing is being predicted — it is the bank's own dating.
- The app logs you out after 5–30 minutes without input (your choice, default
  10, with a one-minute warning; never while an approval is in flight). The
  server drops sessions after 30 minutes of inactivity regardless. With more
  than one bank, the keepalive covers every session, and logging out (by hand
  or idle) ends all of them.
- Accounts are told apart by their account number. A further bank that lists
  an account under a number already shown (another account than the one
  shown) is not added — the login says so. The same account seen by two
  logins (same number and IBAN) is shown once.
- Analysis, Verträge & Abos and the Kontoverlauf only know the period you have
  loaded (the bank's default is ~90 days). "Mehr Verlauf laden (12 Monate)" asks
  the bank for more — that can require a TAN, and some banks keep less. With
  *Umsätze auf diesem Rechner behalten* on they also know what was kept from
  earlier logins (at most ten years and 20,000 bookings per account; the oldest
  days go first).

## Security

Found a weakness? Report it privately, as [SECURITY.md](SECURITY.md) says.

- Credentials live only in memory and vanish on logout / restart — with
  several banks, each bank's PIN in its own session, all of them dropped at the
  logout.
- Banking traffic goes directly from your machine to the bank's FinTS endpoint
  over TLS — no third party sits in that path.
- Besides the bank, the app makes these outside requests:
  - [company logos](#company-logos) send cleaned merchant names to Brandfetch —
    only once you have agreed (the app asks before the first lookup); switch
    them under *Einstellungen → Firmenlogos*;
  - the desktop app's [update check](#updates) asks GitHub for the latest
    release, carrying the app's version and nothing else — switch it off under
    *Einstellungen → Updates*;
  - the [telemetry](#telemetry) of the desktop and Android apps sends error
    reports to the developer's server — always, scrubbed of anything personal — and usage
    data only once you have agreed (*Einstellungen → Nutzungsdaten teilen*).

  Like any web request, each one shows the service your IP address. Error
  reports cannot be switched off in the app; everything else can, and with it
  off the app contacts nothing but your bank and, when something breaks, the
  developer's error reporting.
- Updates are verified against the SHA-256 digest GitHub publishes for the
  release file before they run, and are only downloaded and installed when you
  click.
- Templates, account names and category rules are encrypted with your PIN —
  with several banks, in the first login's vault, which also keeps the further
  banks' BLZ, name and login name (never their PIN).
- With *Umsätze auf diesem Rechner behalten* on (off by default), the booked
  Umsätze themselves — names, IBANs, Verwendungszweck, amounts — and the
  balances proven for them are on disk too: one file per login in the state
  directory, named by a hash, sealed with AES-256-GCM under a key from your PIN
  like the vault, and never in a log. The same offline-brute-force caveat as
  for the device profile applies to a short PIN. A file another PIN sealed is
  never overwritten; *Neu beginnen …* sets it aside. Switching the option off,
  *Gespeicherte Daten → Löschen …* and *Gerät vergessen* with its box ticked
  delete the file and every backup of it — for every bank logged in at that
  moment (a further bank that is not logged in keeps its file until it is).
  Preferences are plain settings: theme, privacy mode, logout timer, the
  company-logo and usage-data answers (with usage data shared, a random install
  id), and the last bank with its login name (to fill in the
  login form) — never a PIN, a balance or a booking. *Von diesem Rechner
  löschen …* and *Gerät vergessen* with its box ticked remove that login name
  too. A CSV or PNG you export is a normal file — treat it like a printed
  statement; so is a Steuer-Jahresübersicht's ZIP with its receipts.
- A backup (`.girovo`) is sealed with its own password, not the PIN, because
  it is made to be stored elsewhere: AES-256-GCM under scrypt, nothing readable
  without it — not even which bank it is for. Choose a long one: a stolen copy
  can be tried offline. The password is never stored or logged.
- An imported export of your online banking is read on this machine by the
  app's own server and goes nowhere else; the file itself stays where you
  saved it.
- Keep this on `localhost`. It has no authentication of its own.

## Legal

Girovo is provided by MT-Media (owner Moritz Krug). The
[legal notice (Impressum)](https://elnino0916.de/girovo/impressum) and the
[privacy policy](https://elnino0916.de/girovo/privacy) cover every version —
Google Play, the GitHub APK and the desktop app — and are linked in the app
under *Einstellungen → Über Girovo*, as are Girovo's website,
[girovo.de](https://girovo.de), and its contact address,
[contact@girovo.de](mailto:contact@girovo.de).

## Development

```bash
npm test          # node --test over lib/**/*.test.ts and electron/**/*.test.cjs (needs Node ≥ 23.6 for built-in TypeScript stripping)
npm run typecheck
```

Open `http://localhost:3000/design-preview` during `npm run dev` to see every
screen with generated data — no bank login needed.

Every text on screen lives in `lib/i18n/messages`, German and English side by
side; `lib/i18n/README.md` has the rules and the glossary. A text written
straight into a component fails the test suite —
`node scripts/i18n-check.mjs [files…]` lists them.
