# Girovo Plus — plan

A supporter subscription in the **Google Play build only**. The GitHub APK and
the desktop app keep everything free, as open source.

## The offer

- Name: **Girovo Plus** (de and en).
- Plans in one Play subscription product (`girovo_plus`):
  - monthly, 0,99 € (base plan `monthly`)
  - yearly, 9,99 € (base plan `yearly`)
  - a 3-day free trial on both (Play's shortest; one per Google account)
- What it unlocks:
  1. **More than one bank.** Without Plus only the bank the app opens with
     (the first, main login) works.
  2. **The month-end forecast** ("Kontostand Ende Oktober").
  3. **"Frag deine Umsätze"** (Gemini Nano questions in the Umsatzanalyse).
     A phone without Nano v4 still says so first — Plus can't fix that — and
     the Plus screen lists this perk only where the phone can ask. The
     plain-language search in the Umsätze stays free.
- Everything else stays free, in particular login, balances, Umsätze,
  transfers, TAN, security, export and backup.

## Without Plus

- **Extra banks** stay linked with their accounts and kept data, nothing is
  deleted. They show "Plus nötig"; logging in to one opens the Plus screen.
  "Weitere Bank anmelden" opens the Plus screen too. When Plus ends, the same
  happens — and returns to normal the moment it is active again.
- **Forecast**: the card stays in place, its figure hidden, with
  "Mit Girovo Plus" leading to the Plus screen.
- **Frag deine Umsätze**: the tile stays, with a line on what it does and
  "Girovo Plus" leading to the Plus screen.
- **No Play billing** (no Play services): the Plus screen says it can't be
  bought on this device and that the GitHub version has everything for free.

## Where it goes

- `android/app/src/play/…/PlusPlugin.java`: Play Billing Library 8 — product
  details, purchase flow, acknowledgement, restore on start and on resume,
  "manage subscription" deep link. The `github` flavour gets a stub that
  always answers "unlocked".
- `mobile/bridges/plus.ts` + `window.girovoMobile.plus`: status
  (`active | inactive | unavailable`), offers with Play's localised prices,
  `buy(plan)`, `manage()`, `onChange`.
- `lib/plus.ts` (pure, tested): what is locked for a given status — `bankAllowed(index)`,
  `forecastAllowed` — so desktop, GitHub APK and preview all read "free".
- UI: an Einstellungen row and a Plus screen (offers, trial, what it brings,
  "Abo verwalten"); the lock on extra banks (Übersicht strip, Sitzung panel,
  add-bank flow); the forecast teaser; a design-preview switch `?plus=…`.
- Verification without a server: Play Billing's own purchase state, checked
  on the phone and cached (can be cracked — acceptable at 0,99 €).

## Built (5.10.1)

- As above, plus: a subscriber may switch the app icon to the gold G€
  (launcher entries `.LauncherStandard` / `.LauncherPlus`); it goes back to
  navy when Plus ends. With this update MainActivity stops being the launcher
  entry itself, so some launchers drop the home-screen icon once.
- A reminder toast ("Ansehen" opens the Plus screen) at most every 7 days,
  once logged in, only in the Play build without Plus. Its clock starts the
  first time the app sees the user without Plus (`girovo.plus.reminder`).
- Only Play's own "no purchase" ends Plus; a subscription confirmed within
  7 days stands while Play cannot be asked or takes no purchases.
- Preview: `/design-preview?view=contracts&plus=inactive`, `&second=remembered`
  for the locked bank, `view=settings` for the row.

## The owner key (5.11.0)

The developer's own phone gets Plus without a purchase, so the owner neither
pays for their own app nor runs licence-test subscriptions (which Play renews
every few minutes and ends after six renewals).

- On the phone: Einstellungen → Girovo Plus, tap the gold plate seven times.
  The screen shows this installation's ID ("K7Q2-9XMA-4HTB") and takes a key.
- On the PC: `npm run owner-key -- K7Q2-9XMA-4HTB` prints the key; paste it.
  The private key is `girovo-owner.pem` beside the release keystore (made once
  with `npm run owner-key -- init`), never in this repository.
- A key is an ECDSA P-256 signature over the installation's ID;
  PlusPlugin.java (src/play) carries the public key and checks it. It opens
  Plus whatever Play says, keeps the gold icon, and survives updates; a
  reinstall or "Daten löschen" makes a new ID, which needs a new key.
- Nothing points there and nothing is sold: keys are for the owner's own
  phones. Selling them outside Play would break Play's payments policy.

## Outside the code (yours)

- Play Console: create the subscription `girovo_plus` with both base plans,
  the 3-day trial offer, prices; licence testers for testing.
- Data safety form: purchase history (via Google Play).
- Store listing: say that the GitHub version is free and complete.
