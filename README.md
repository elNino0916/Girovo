<p align="center">
  <img
    src="https://github.com/user-attachments/assets/03253665-9042-4637-b241-d53b8757d573"
    alt="Image"
  />
</p>

A modern, self-hosted banking app for German banks that speaks **FinTS 3.0
(HBCI) PIN/TAN** with approval in your bank's app — the *decoupled* TAN
methods such as S-pushTAN, SecureGo plus or BestSign. Methods where you type a
TAN (chipTAN, smsTAN, TAN generators) are not supported.

**Features**
- **Tested with major banks** — Sooskasse-FinTS has been tested with Atruvia, Targobank, Commerzbank and FI infrastructure.
- **All German FinTS banks** — bundled institute database (~2.700 institutes)
  with name / city / BLZ / **BIC** search, or a pasted **IBAN** (read in the
  browser — only its BLZ is sent to the search); quick picks with the real bank
  logos (`public/logos/`, sourced from Wikimedia Commons) and a monogram
  fallback for banks without one. URLs come from hbci4java's actively
  maintained bank list, with dead hosts (fiducia.de / gad.de / Dresdner)
  rewritten to their live successors — refresh anytime with
  `node scripts/update-banks.mjs`. If a bank's primary endpoint is down,
  the server automatically retries the known alternate URL.
- **Finanzübersicht** in the Atruvia online-banking language: navy masthead
  and stage, *Konten und Karten* with a Gesamtsaldo that appears once every
  euro account's balance is known (*Alle Salden abrufen* asks for the missing
  ones by balance enquiry; rename accounts locally), the selected account's
  balance with Verfügbar / Dispositionsrahmen (Kreditrahmen for a card) /
  Vorgemerkt — or, when a fetch failed, the bank's reason and *Erneut
  versuchen* in its place — *Monatsbilanz* (compared with the same days of the
  month before) and *Demnächst fällig* tiles, and Schnellzugriffe (Überweisen,
  Geld anfordern, Kontoauszug).
- **Kontoverlauf** — the end-of-day balance over the loaded period as a step
  chart, reconstructed from the bookings and *checked against every opening and
  closing balance the bank sent*. If the numbers don't add up, no chart is drawn.
- **Kontostand & Umsätze** with search (names, Verwendungszweck, IBAN with or
  without spaces, amounts like `12,99` or `>100`), Eingänge/Ausgänge and
  category filters, quick periods (30/90 Tage, Monat, Jahr, eigener Zeitraum),
  day totals and a full detail drawer (Referenzen, Gläubiger-ID, copy buttons,
  "Erneut überweisen" / "Zurücküberweisen", "Alle Umsätze mit …").
- **Automatic categories** (Wohnen & Energie, Lebensmittel, Mobilität, Abos, …)
  from booking codes (MT940 GVC and CAMT ISO codes), creditor IDs and a German
  keyword table — deterministic, on-device, correctable per booking or as a
  rule for a counterparty.
- **Umsatzanalyse** — Einnahmen/Ausgaben/Differenz, spending by category,
  month-by-month comparison, top payees and largest expenses for one or all
  loaded accounts. Umbuchungen between your own accounts are left out, refunds
  are netted, and every figure states its basis.
- **Verträge & Abos** — recurring payments detected from the bookings (direct
  debits, standing orders, subscriptions, salary) with rhythm, next expected
  date, yearly cost and a "Betrag gestiegen" flag. Labelled as an estimate;
  "Kein Vertrag" hides a false hit.
- **CSV export** of the Umsätze list — all of the loaded period, or what the
  filter shows (the file name says which days, and "_gefiltert") — booked
  Umsätze only, in the German Excel dialect (`;`, UTF-8 BOM, decimal comma,
  formula-injection guard), plus the existing PDF Kontoauszug and Buchungsbeleg.
- **Vorgemerkte Umsätze** (pending / not-yet-booked entries via `HKVMK`) —
  loaded on demand, shows incoming SEPA-Lastschriften *before* they book.
  Only offered when the bank/account supports it.
- **SEPA-Überweisung** (HKCCS) and **Echtzeitüberweisung** (HKIPZ) with IBAN
  check-digit validation, review step and TAN approval. Only offered when the
  bank/account actually supports it (BPD/UPD). The form knows your recent
  payees and saved templates, can **read a GiroCode** from a pasted or dropped
  screenshot of an invoice, shows the bank name for a German IBAN, warns about
  a likely duplicate and about exceeding the available amount, and the review
  step shows name and purpose exactly as the bank will receive them.
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
  app asks once, before the first lookup, and *Sitzung → Firmenlogos* switches
  it later. See [Company logos](#company-logos).
- **Remember this device** — after the first login the bank's device identity
  (systemId) plus the cached accounts and TAN method are saved **encrypted with
  your PIN**, so subsequent logins reuse the device and the bank can serve
  balance/transaction reads without a fresh TAN for the duration of its
  exemption window (typically ~90 days). "Gerät vergessen" wipes it. See
  [Fewer TAN prompts](#fewer-tan-prompts).
- **Personal data vault** — templates, account names and category rules are
  stored **encrypted with your PIN** (AES-256-GCM, scrypt) next to the device
  profile, so they exist only while you are logged in. "Gerät vergessen" can
  delete them too.
- **Beträge ausblenden** (privacy mode for screen sharing — every amount,
  chart axis and tooltip is masked, amounts inside the bank's own text as far
  as they can be recognised, and the Kontoverlauf keeps its trend but not
  whether it dipped below zero), **automatic logout** after 5–30 minutes of
  inactivity with a one-minute warning (also in the window title, and in the
  desktop app on a flashing taskbar button), **Mitteilungen** (the bank's messages
  from the login plus this session's transfer outcomes), a **command palette**
  (Strg+K) and keyboard shortcuts (switchable).
- Hell / Dunkel / System appearance; phone layout with a bottom navigation.
- **Updates in the desktop app** — the Windows app looks for a new release on
  GitHub, shows what's new, and installs it on request: the download is checked
  against the SHA-256 digest GitHub publishes for every release file before it
  runs. See [Updates](#updates).

Built with **Next.js 16** (App Router, React 19, TypeScript) and **Tailwind CSS
v4**, set in **Google Sans Flex**. Fonts are self-hosted through `next/font`, so
they add no outside request of their own.

## Run it

```bash
npm install
npm run dev
```

Then open **http://localhost:3000**.

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

That produces two files in `dist/`:

| File | What it is |
|------|------------|
| `Sooskasse-FinTS-<version>-Setup.exe` | Standard NSIS installer — double-click to install, uninstall via *Programs & Features*. |
| `Sooskasse-FinTS-<version>-portable.exe` | Single executable, no installation needed — run from anywhere. |

Both are ~100 MB, most of which is the Electron runtime.

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
`%APPDATA%\sooskasse-fints\fints-state` via the `FINTS_STATE_DIR` environment
variable. The website keeps using `.fints-state/` in the project root.

`config.json` is baked into the package at build time — set your product ID
before building.

### Updates

The desktop app updates itself from this repository's
[GitHub releases](https://github.com/elNino0916/Sooskasse-FinTS/releases)
(`electron/updater.cjs`):

- **Checking** — 15 seconds after the start and then every 6 hours, the app asks
  GitHub's API for the latest release. The request carries the app's version
  (`User-Agent: Sooskasse-FinTS/<version>`) and nothing about you or your
  accounts; it goes through a session of its own without cookies or cache.
  Switch it off under *Sitzung → Updates* — a check is then only made when you
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
  shows it). It only watches: the update runs the same without it.
- **Only what changed** — the installer keeps a copy of itself in the
  installation (`resources\update-base.bin`). An update compares the new
  release's blockmap with the installed release's, copies the unchanged parts
  of the installer from that file and downloads only the rest from GitHub in
  byte ranges: usually 1–3 MB instead of ~110 MB. The result is checked against
  GitHub's digest like any download; if anything does not fit (no blockmap, an
  installation from a local build, a changed Electron that changes nearly
  everything), the whole `Setup.exe` is downloaded instead.
- **Portable copies**: the new `portable.exe` is saved next to the old one (or in
  *Downloads* if that folder is read-only) and started instead. The old file
  stays — delete it when you like.
- After the update the app says so once, with the release notes.

**Publishing a release** the updater picks up needs nothing beyond what
`npm run electron:dist` produces: create a normal GitHub release (not a draft,
not a pre-release) whose tag is the version (`4.1.0` or `v4.1.0`) and attach
`Sooskasse-FinTS-<version>-Setup.exe`, `Sooskasse-FinTS-<version>-Setup.exe.blockmap`
and `Sooskasse-FinTS-<version>-portable.exe` from `dist/` — upload the files of
one build, the blockmap has to describe exactly that `Setup.exe`. GitHub adds
the digests by itself; no `latest.yml` is needed. Without the blockmap the
release still works, it is just downloaded whole — by the copies updating to
it and, later, by the copies updating *from* it.
The release text becomes the app's "Was ist neu" (Markdown: headings, lists,
bold, links). Development builds (`<version>-dev.<n>`) are newer than the
release they are numbered after, so they are only offered a higher version.

To try the flow without publishing anything, point an unpackaged build at a
local feed: `SOOSKASSE_UPDATE_FEED=http://127.0.0.1:<port>/latest` (an answer
shaped like GitHub's `/releases/latest`) and `SOOSKASSE_UPDATE_KIND=nsis` or
`portable`, then `npm run electron:dev` (`SOOSKASSE_UPDATE_BASE=<path to a
Setup.exe>` stands in for the installed copy's `update-base.bin`; the feed then
also needs `/tags/<version>`). A packaged app ignores all of them. The
design preview shows every state of the update dialog with a fake updater
(`/design-preview?view=update`, `update-ready`, `update-installed`, …).

## FinTS product registration (important)

FinTS requires a **product registration ID** issued (free) by the ZKA — some
banks reject dialogs without one (code 9078). Register at
<https://www.fints.org/de/hersteller/produktregistrierung> and put the ID into
`config.json`:

```json
{ "productId": "YOURID", "productVersion": "1.0" }
```
If you do not want to request a product ID from DK, a simple Google search will give you plenty of IDs you could use,
however, using a officially obtained key is recommended to prevent your Sooskasse-FinTS from being detected as automated
traffic and therefore being blocked by your bank's infrastructure.

## How it works

| File | Purpose |
|------|---------|
| `app/api/*/route.ts` | The Node-runtime route handlers. Each one is thin: validate → call the session's `FinTSClient` → serialise. Decoupled TAN operations are continued via `/api/tan-poll`. |
| `lib/session.ts` | Product registration (`config.json` / `FINTS_PRODUCT_ID`) and the in-memory session store. Pinned to `globalThis` so hot reload doesn't drop logged-in users; 30-minute idle sweep. |
| `lib/fints-sepa.ts` | Adds the transfer segments **HKCCS**/**HKIPZ** (lib-fints is read-only out of the box): segment definitions, pain.001 XML builder (001.001.03 / 001.003.03 / 001.001.09), SEPA character-set sanitizing, IBAN/BIC/amount validation. The descriptor is picked per segment — HKIPZ has its own format list in **HIIPZS**, HKCCS falls back to the bank-wide one in **HISPAS**. |
| `lib/fints-vop.ts` | Adds **HKVPP**/**HKVPA** (Namensabgleich — Verification of Payee): segment definitions, a collector that merges a result delivered over several messages (Aufsetzpunkt, return code 3040) incl. a pain.002 fallback, the HIVPPS lookup that says which transactions the bank checks, and the return codes that steer the flow (3090/3091/3945/9076). |
| `lib/fints-pending.ts` | Adds **HKVMK** (Vormerkposten / pending entries): segment definitions + a `PendingInteraction` that parses the returned **MT942** with lib-fints' MT940 parser (MT942 reuses the `:61:`/`:86:` entry format). |
| `lib/fints-internals.js` + `.d.ts` | Re-exports the lib-fints internals its `exports` map hides (segment definitions, data elements, `registerSegmentDefinition`). Kept as one shim so the library's segment registry stays a single module instance — see the note in `next.config.ts`. |
| `lib/banks.ts` | Institute database (`banks-data.json`, regenerate via `npm run update-banks`): hbci4java's maintained bank list with dead-host rewrites, plus alternate URLs from [`fints-institute-db`](https://www.npmjs.com/package/fints-institute-db); BLZ/BIC lookup, fuzzy search (with short names such as DKB, HVB, OLB), brand detection for logos. `lib/bank-query.ts` reads a query as name, BLZ or IBAN — in the browser, so an IBAN never leaves it. |
| `lib/bank-fetch.ts` | Every lib-fints request under one policy, attached from outside the library: a 60 s limit on the bank's first byte, cancellation (a login called off), and HTTP error pages or unreadable replies turned into one German sentence — bodies go to the server log only. Also the route handlers' error translator. `lib/bank-answer.ts` reads a bank's `code: text \| code: text` answer the one way the whole app does: sentences plus a small list of codes, lock detection by the bank's own wording, and the refusal test the order routes share — only an answer that refuses the order and says nothing else is a refusal; anything doubtful stays „Status unklar“. |
| `lib/serialize.ts` | Maps lib-fints objects to the JSON the browser sees; `lib/fints-types.ts` holds that contract, imported by both sides. |
| `lib/merchant-match.ts` | The company-detection model: name cleaning, the corporate-marker privacy gate, the candidate ladder and the scoring thresholds. Deterministic and inspectable — no network, no data files. |
| `lib/merchants.ts` | The Brandfetch lookup behind it: Brand Search API for recall, name/domain scoring for precision, the Logo CDN fetch, process-level caching of hits *and* misses, and the logo proxy's allowlist. |
| `lib/state-store.ts` | Encrypted device-profile persistence (`.fints-state/`, gitignored, or wherever `FINTS_STATE_DIR` points): AES-256-GCM, key derived from the PIN via scrypt. Stores systemId + cached BPD/UPD + TAN method so logins skip a fresh sync SCA. |
| `patches/` | Patch for lib-fints (via `patch-package`, applied on `npm install`): exports the internal `registerSegmentDefinition` so the custom segments can be registered, reads camt.053 as well as camt.052, and keeps the ultimate creditor/debtor (MT940 `ABWE+`/`ABWA+`, CAMT `UltmtCdtr`/`UltmtDbtr`) that the parser otherwise drops — where the shop behind a card payment is named. |
| `lib/vault.ts`, `lib/crypto-box.ts` | The encrypted personal-data vault (templates, account names, category rules) and the AES-256-GCM/scrypt helpers it shares with the device profile. Sanitised server-side, written atomically. |
| `lib/categorize.ts`, `lib/analytics.ts`, `lib/recurring.ts`, `lib/balance-history.ts` | Pure, tested analysis: categories, period totals and comparisons, recurring-payment detection, and the verified balance history. They handle both MT940 and CAMT shapes. |
| `lib/csv.ts`, `lib/girocode.ts`, `lib/qr.ts`, `lib/qr-read.ts` | CSV export, the EPC069-12 GiroCode payload (build + parse) and QR rendering/reading (bundled `qrcode-generator` and `jsqr`, no network). |
| `components/FintsProvider.tsx` | The client state machine: login → TAN method → dashboard, with every bank read serialised behind one `busy` flag (each read can cost its own approval), the decoupled poll loop, the applied date range, auto-logout, the vault and the inbox. |
| `components/*` | The UI: `shell/` (masthead, tabs, stage, footer, bottom bar), `overview/`, `transactions/`, `insights/` (Analyse, Verträge), `transfer/`, `auth/`, `updates/` (the desktop updater's dialog and notices), plus the command palette, inbox and primitives in `ui.tsx`. |
| `app/globals.css` | Design tokens (chrome navy, action blue, white tiles on a blue-grey page, navy-black dark theme, chart palette) as CSS variables mapped into Tailwind v4 via `@theme inline`. The print styles for the Kontoauszug are frozen separately. |
| `app/design-preview` | Dev-only harness that renders every screen with generated data (`/design-preview?view=overview`, `analysis`, `contracts`, `transfer`, `login`, …; `&theme=dark`, `&privacy=1`). Returns 404 in production. |
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
| `POST /api/select-tan` | Select an app-approval method/media + authenticated sync (accounts); refuses methods that need a typed TAN |
| `POST /api/tan-poll` | Poll/continue the pending decoupled approval |
| `POST /api/cancel-pending` | Abandon the pending approval client-side |
| `POST /api/balance` | Kontostand for one account |
| `POST /api/transactions` | Umsätze (optional date range) |
| `POST /api/pending` | Vorgemerkte Umsätze (HKVMK; on-demand) |
| `POST /api/transfer` | SEPA-Überweisung (`instant: true` → HKIPZ); answers `needsVop` when a Namensabgleich needs the user's decision |
| `POST /api/vop-confirm` | Send the parked transfer anyway, confirming the Namensabgleich result (HKVPA) |
| `POST /api/merchants` | Resolve counterparty names to company logos (Brandfetch) |
| `GET  /api/merchant-logo?id=` | Proxy a resolved logo; only ids this process minted |
| `POST /api/device-status` | Whether a remembered device exists for (BLZ, user) — a POST so the login name never lands in a URL |
| `POST /api/forget-device` | Delete the encrypted device profile (`wipeData: true` also deletes the vault) |
| `POST /api/vault` | Read / save / reset / wipe the encrypted personal-data vault (`op`) |
| `POST /api/keepalive` | Keep an active session alive (no bank traffic) |
| `POST /api/logout` | Drop the session |

## Company logos

Bank statements name a counterparty in its full legal form, which is rarely the
brand you'd recognise. Sooskasse-FinTS resolves the brand against
**[Brandfetch](https://brandfetch.com)**: a Brand Search API to turn the cleaned
name into a company + domain, and Brandfetch's Logo CDN to fetch a correctly
sized mark for that domain.

**This is the only feature that sends anything from your bookings to a host
other than your bank, so it is off until you agree.** The first Übersicht asks
once — *Firmenlogos anzeigen?*, with exactly what is sent — and every lookup
waits for the answer. The answer is kept on this machine with the other
preferences; *Sitzung → Firmenlogos* changes it at any time, and switching it
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

- You need a bank contract with **FinTS/HBCI access enabled** and **approval
  in your bank's app** (decoupled TAN: S-pushTAN, SecureGo plus, BestSign, …).
  The app has no TAN entry field, so chipTAN, smsTAN and other methods where
  you type a TAN do not work; the login says so before you enter your PIN.
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
  server drops sessions after 30 minutes of inactivity regardless.
- Analysis, Verträge & Abos and the Kontoverlauf only know the period you have
  loaded (the bank's default is ~90 days). "Mehr Verlauf laden (12 Monate)" asks
  the bank for more — that can require a TAN, and some banks keep less.

## Security

- Credentials live only in memory and vanish on logout / restart.
- Banking traffic goes directly from your machine to the bank's FinTS endpoint
  over TLS — no third party sits in that path.
- Besides the bank, the app makes two kinds of outside request, each of which
  can be switched off in the app:
  - [company logos](#company-logos) send cleaned merchant names to Brandfetch —
    only once you have agreed (the app asks before the first lookup); switch
    them under *Sitzung → Firmenlogos*;
  - the desktop app's [update check](#updates) asks GitHub for the latest
    release, carrying the app's version and nothing else — switch it off under
    *Sitzung → Updates*.

  Like any web request, each one shows the service your IP address. With both
  off, the app contacts nothing but your bank.
- Updates are verified against the SHA-256 digest GitHub publishes for the
  release file before they run, and are only downloaded and installed when you
  click.
- Templates, account names and category rules are encrypted with your PIN.
  Preferences are plain settings: theme, privacy mode, logout timer, the
  company-logo answer, and the last bank with its login name (to fill in the
  login form) — never a PIN, a balance or a booking. *Von diesem Rechner
  löschen …* and *Gerät vergessen* with its box ticked remove that login name
  too. A CSV or PNG you export is a normal file — treat it like a printed
  statement.
- Keep this on `localhost`. It has no authentication of its own.

## Development

```bash
npm test          # node --test over lib/**/*.test.ts and electron/**/*.test.cjs (needs Node ≥ 23.6 for built-in TypeScript stripping)
npm run typecheck
```

Open `http://localhost:3000/design-preview` during `npm run dev` to see every
screen with generated data — no bank login needed.
