<p align="center">
  <img
    src="https://github.com/user-attachments/assets/fee12f69-f988-40d3-97e2-fedd203e1e36"
    width="348"
    height="398"
    alt="Image"
  />
</p>

# Sooskasse-FinTS

A modern, self-hosted banking app for German banks that speaks **FinTS 3.0
(HBCI) PIN/TAN** — including the *decoupled* TAN methods (S-pushTAN, SecureGo
plus, …) where you approve directly in your banking app.

**Features**
- **Tested with major banks** — Sooskasse-FinTS has been tested with Atruvia, Targobank and FI infrastructure.
- **All German FinTS banks** — bundled institute database (~2.700 institutes)
  with BLZ / name / city / **BIC** search; quick picks with the real bank
  logos (`public/logos/`, sourced from Wikimedia Commons) and a monogram
  fallback for banks without one. URLs come from hbci4java's actively
  maintained bank list, with dead hosts (fiducia.de / gad.de / Dresdner)
  rewritten to their live successors — refresh anytime with
  `node scripts/update-banks.mjs`. If a bank's primary endpoint is down,
  the server automatically retries the known alternate URL.
- **Kontostand & Umsätze** with search, date-range filter and a full detail
  view per transaction (IBAN, BIC, Referenzen, GVC, Primanota, … with
  copy-to-clipboard).
- **Vorgemerkte Umsätze** (pending / not-yet-booked entries via `HKVMK`) —
  loaded on demand, shows incoming SEPA-Lastschriften *before* they book.
  Only offered when the bank/account supports it.
- **SEPA-Überweisung** (HKCCS) and **Echtzeitüberweisung** (HKIPZ) with IBAN
  check-digit validation, review step and TAN approval. Only offered when the
  bank/account actually supports it (BPD/UPD).
- **Verification of Payee** (Namensabgleich via `HKVPP`/`HKVPA`) — where the
  bank offers it, the payee name is checked against the name behind the IBAN
  before you authorise. Match, Close Match, No Match and Not Applicable each
  get their own screen, with the bank's own explanatory text shown verbatim and
  an explicit "trotzdem überweisen" for a name that doesn't line up.
- **Company logos on transactions** — counterparties are matched against
  [Brandfetch](https://brandfetch.com) so `PayPal Europe S.a.r.l et Cie S.C.A.`
  shows the PayPal mark. A match has to clear a deliberately high bar; anything
  short of it keeps the plain avatar rather than risking a wrong logo. Requires
  a free Brandfetch client ID and sends counterparty names to Brandfetch — see
  [Company logos](#company-logos) before you turn it on.
- **Remember this device** — after the first login the bank's device identity
  (systemId) plus the cached accounts and TAN method are saved **encrypted with
  your PIN**, so subsequent logins reuse the device and the bank can serve
  balance/transaction reads without a fresh TAN for the duration of its
  exemption window (typically ~90 days). "Gerät vergessen" wipes it. See
  [Fewer TAN prompts](#fewer-tan-prompts).
- Light + dark theme (follows the system, manual toggle).

Built with **Next.js 16** (App Router, React 19, TypeScript) and **Tailwind CSS
v4**. Fonts are self-hosted through `next/font` — no request leaves your machine
except the one to your bank.

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
browser tab:

```bash
npm run electron:dist
```

That leaves two files in `dist/`: an installer
(`Sooskasse-FinTS-<version>-Setup.exe`) and a portable single executable. Both
are ~100 MB, most of which is the Electron runtime.

Nothing about the website workflow changes — `npm run dev`, `npm run build` and
`npm start` behave exactly as before.

| Script | What it does |
|--------|--------------|
| `npm run electron:build` | `next build` in standalone mode, plus the two folders a standalone build leaves behind (`.next/static`, `public`). Output: `.next/standalone/`. |
| `npm run electron:start` | Opens the desktop window against that build — a packaging-free way to check it. |
| `npm run electron:dist` | The above, then wraps it with electron-builder into `dist/`. |
| `npm run electron:dev` | Points the desktop window at a running `npm run dev` (start that first), so the app hot-reloads. |

**It is not a static export.** The API routes hold the live FinTS dialog, so the
desktop app ships the real server: Electron starts `.next/standalone/server.js`
as a child process — its own binary re-run with `ELECTRON_RUN_AS_NODE=1`, so no
Node install is required — bound to `127.0.0.1` on a random free port, and
points a window at it. Nothing is reachable from the network, and the port never
collides with a dev server.

Remembered device profiles (see *Fewer TAN prompts*) cannot live next to a
program installed under `Program Files`, so the desktop app puts them in
`%APPDATA%\sooskasse-fints\fints-state` via the `FINTS_STATE_DIR` environment
variable. The website keeps using `.fints-state/` in the project root.

`config.json` is baked into the package at build time — set your product ID
before building.

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
| `lib/banks.ts` | Institute database (`banks-data.json`, regenerate via `npm run update-banks`): hbci4java's maintained bank list with dead-host rewrites, plus alternate URLs from [`fints-institute-db`](https://www.npmjs.com/package/fints-institute-db); BLZ/BIC lookup, fuzzy search, brand detection for logos. |
| `lib/serialize.ts` | Maps lib-fints objects to the JSON the browser sees; `lib/fints-types.ts` holds that contract, imported by both sides. |
| `lib/merchant-match.ts` | The company-detection model: name cleaning, the corporate-marker privacy gate, the candidate ladder and the scoring thresholds. Deterministic and inspectable — no network, no data files. |
| `lib/merchants.ts` | The Brandfetch lookup behind it: Brand Search API for recall, name/domain scoring for precision, the Logo CDN fetch, process-level caching of hits *and* misses, and the logo proxy's allowlist. |
| `lib/state-store.ts` | Encrypted device-profile persistence (`.fints-state/`, gitignored, or wherever `FINTS_STATE_DIR` points): AES-256-GCM, key derived from the PIN via scrypt. Stores systemId + cached BPD/UPD + TAN method so logins skip a fresh sync SCA. |
| `patches/` | One-line patch (via `patch-package`, applied on `npm install`) exporting lib-fints' internal `registerSegmentDefinition` so the custom segments can be registered. |
| `components/FintsProvider.tsx` | The client state machine: login → TAN method → dashboard, with every bank read serialised behind one `busy` flag (each read can cost its own approval) and the decoupled poll loop. |
| `components/*.tsx` | The UI: bank picker, TAN method + wait overlay, dashboard, ledger, transaction drawer, Überweisung flow. |
| `app/globals.css` | Design tokens (paper/ink, banknote green, Soll red, vorgemerkt amber) as CSS variables mapped into Tailwind v4 via `@theme inline`. |
| `electron/main.cjs` | The desktop shell: boots the standalone server on loopback, opens the window, denies every device permission and sends outside links to the real browser. Paired with `scripts/build-electron.mjs` and `electron-builder.yml`. |

### API surface

| Endpoint | Purpose |
|----------|---------|
| `GET  /api/meta` | Product-ID status, bank count |
| `GET  /api/banks` | Curated quick-pick banks |
| `GET  /api/bank-search?q=` | Search all institutes (BLZ, name, city) |
| `POST /api/connect` | First sync; returns TAN methods |
| `POST /api/select-tan` | Select method/media + authenticated sync (accounts) |
| `POST /api/tan-poll` | Poll/continue the pending decoupled approval |
| `POST /api/cancel-pending` | Abandon the pending approval client-side |
| `POST /api/balance` | Kontostand for one account |
| `POST /api/transactions` | Umsätze (optional date range) |
| `POST /api/pending` | Vorgemerkte Umsätze (HKVMK; on-demand) |
| `POST /api/transfer` | SEPA-Überweisung (`instant: true` → HKIPZ); answers `needsVop` when a Namensabgleich needs the user's decision |
| `POST /api/vop-confirm` | Send the parked transfer anyway, confirming the Namensabgleich result (HKVPA) |
| `POST /api/merchants` | Resolve counterparty names to company logos (Brandfetch) |
| `GET  /api/merchant-logo?id=` | Proxy a resolved logo; only ids this process minted |
| `GET  /api/device-status` | Whether a remembered device exists for (BLZ, user) |
| `POST /api/forget-device` | Delete the encrypted device profile |
| `POST /api/logout` | Drop the session |

## Company logos

Bank statements name a counterparty in its full legal form, which is rarely the
brand you'd recognise. Sooskasse-FinTS resolves the brand against
**[Brandfetch](https://brandfetch.com)**: a Brand Search API to turn the cleaned
name into a company + domain, and Brandfetch's Logo CDN to fetch a correctly
sized mark for that domain.

**This is the only feature that contacts a host other than your bank.** It
requires a free client ID from <https://developers.brandfetch.com>:

```json
{ "brandfetchClientId": "YOUR_CLIENT_ID" }
```

or `BRANDFETCH_CLIENT_ID=...`. Without a client ID the feature is force-disabled
regardless of the toggle below, since there is nothing to call. With a client ID
configured it is on by default; turn it off explicitly with either:

```json
{ "merchantLogos": false }
```

or `FINTS_MERCHANT_LOGOS=0`. Off means the app talks to nothing but your bank,
and every transaction keeps its plain avatar.

**What is and isn't sent.** Only the cleaned company core leaves the machine —
`PayPal`, not `PayPal Europe S.a.r.l et Cie S.C.A.` — and never an amount, IBAN,
date or reference. A name is only ever sent if it carries a *corporate marker*:
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

- You need a bank contract with **FinTS/HBCI access enabled** and a TAN app.
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
- Sessions expire after 30 minutes of inactivity.

## Security

- Credentials live only in memory and vanish on logout / restart.
- Banking traffic goes directly from your machine to the bank's FinTS endpoint
  over TLS — no third party sits in that path.
- The **one** exception is [company logos](#company-logos), which sends cleaned
  merchant names to Brandfetch. Set `"merchantLogos": false` in `config.json`
  (or omit `brandfetchClientId`) and the app contacts nothing but your bank.
- Keep this on `localhost`. It has no authentication of its own.
