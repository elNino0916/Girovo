# Sooskasse-FinTS

A modern, self-hosted banking app for German banks that speaks **FinTS 3.0
(HBCI) PIN/TAN** — including the *decoupled* TAN methods (S-pushTAN, SecureGo
plus, …) where you approve directly in your banking app.

**Features**

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
- **SEPA-Überweisung** (HKCCS) and **Echtzeitüberweisung** (HKIPZ) with IBAN
  check-digit validation, review step and TAN approval. Only offered when the
  bank/account actually supports it (BPD/UPD).
- Light + dark theme (follows the system, manual toggle).

## Run it

```bash
npm install
npm start
```

Then open **http://localhost:3000**.

> ⚠️ **Runs locally only.** Your PIN is held in server memory for the session
> and is never written to disk or logged. Do not expose this on a public host.

## FinTS product registration (important)

FinTS requires a **product registration ID** issued (free) by the ZKA — some
banks reject dialogs without one (code 9078). Register at
<https://www.hbci-zka.de/register/prod_register.htm> and put the ID into
`config.json`:

```json
{ "productId": "YOURID", "productVersion": "1.0" }
```

## How it works

| File | Purpose |
|------|---------|
| `server.mjs` | Express backend around [`lib-fints`](https://github.com/robocode13/lib-fints); one `FinTSClient` per in-memory session; drives sync → TAN method → accounts → statements/transfers. Decoupled TAN operations are continued via `/api/tan-poll`. |
| `fints-sepa.mjs` | Adds the transfer segments **HKCCS**/**HKIPZ** (lib-fints is read-only out of the box): segment definitions, pain.001 XML builder (001.001.03 / 001.003.03 / 001.001.09), SEPA character-set sanitizing, IBAN/BIC/amount validation. |
| `banks.mjs` | Institute database (`banks-data.json`, regenerate via `scripts/update-banks.mjs`): hbci4java's maintained bank list with dead-host rewrites, plus alternate URLs from [`fints-institute-db`](https://www.npmjs.com/package/fints-institute-db); BLZ/BIC lookup, fuzzy search, brand detection for logos. |
| `patches/` | One-line patch (via `patch-package`, applied on `npm install`) exporting lib-fints' internal `registerSegmentDefinition` so the custom segments can be registered. |
| `public/` | Vanilla-JS frontend: login with bank search → TAN method → dashboard with accounts, Umsätze, transaction drawer, Überweisung flow. |

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
| `POST /api/transfer` | SEPA-Überweisung (`instant: true` → HKIPZ) |
| `POST /api/logout` | Drop the session |

## Notes & limitations

- You need a bank contract with **FinTS/HBCI access enabled** and a TAN app.
- Transfers require the bank to offer HKCCS/HKIPZ over FinTS for your account —
  the UI greys the option out otherwise.
- If the bank closes the dialog during a transfer approval, the app shows
  **„Status unklar“** and asks you to check the Umsätze before retrying —
  never blindly resend a transfer.
- Sessions expire after 30 minutes of inactivity.

## Security

- Credentials live only in memory and vanish on logout / restart.
- No third-party services; traffic goes directly from your machine to the
  bank's FinTS endpoint over TLS.
- Keep this on `localhost`. It has no authentication of its own.
