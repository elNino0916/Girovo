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
- **Remember this device** — after the first login the bank's device identity
  (systemId) plus the cached accounts and TAN method are saved **encrypted with
  your PIN**, so subsequent logins reuse the device and the bank can serve
  balance/transaction reads without a fresh TAN for the duration of its
  exemption window (typically ~90 days). "Gerät vergessen" wipes it. See
  [Fewer TAN prompts](#fewer-tan-prompts).
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
| `server.mjs` | Express backend around [`lib-fints`](https://github.com/robocode13/lib-fints); one `FinTSClient` per in-memory session; drives sync → TAN method → accounts → statements/transfers. Decoupled TAN operations are continued via `/api/tan-poll`. |
| `fints-sepa.mjs` | Adds the transfer segments **HKCCS**/**HKIPZ** (lib-fints is read-only out of the box): segment definitions, pain.001 XML builder (001.001.03 / 001.003.03 / 001.001.09), SEPA character-set sanitizing, IBAN/BIC/amount validation. |
| `fints-pending.mjs` | Adds **HKVMK** (Vormerkposten / pending entries): segment definitions + a `PendingInteraction` that parses the returned **MT942** with lib-fints' MT940 parser (MT942 reuses the `:61:`/`:86:` entry format). |
| `banks.mjs` | Institute database (`banks-data.json`, regenerate via `scripts/update-banks.mjs`): hbci4java's maintained bank list with dead-host rewrites, plus alternate URLs from [`fints-institute-db`](https://www.npmjs.com/package/fints-institute-db); BLZ/BIC lookup, fuzzy search, brand detection for logos. |
| `state-store.mjs` | Encrypted device-profile persistence (`.fints-state/`, gitignored): AES-256-GCM, key derived from the PIN via scrypt. Stores systemId + cached BPD/UPD + TAN method so logins skip a fresh sync SCA. |
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
| `POST /api/pending` | Vorgemerkte Umsätze (HKVMK; on-demand) |
| `POST /api/transfer` | SEPA-Überweisung (`instant: true` → HKIPZ) |
| `GET  /api/device-status` | Whether a remembered device exists for (BLZ, user) |
| `POST /api/forget-device` | Delete the encrypted device profile |
| `POST /api/logout` | Drop the session |

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
- If the bank closes the dialog during a transfer approval, the app shows
  **„Status unklar“** and asks you to check the Umsätze before retrying —
  never blindly resend a transfer.
- Sessions expire after 30 minutes of inactivity.

## Security

- Credentials live only in memory and vanish on logout / restart.
- No third-party services; traffic goes directly from your machine to the
  bank's FinTS endpoint over TLS.
- Keep this on `localhost`. It has no authentication of its own.
