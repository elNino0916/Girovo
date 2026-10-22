# Google Play Data safety — draft answers

What the Android app sends where, for Policy › App content › Data safety.
These are drafts from reading the code; the declaration is the developer's
own, so check each answer against Google's current definitions before
submitting.

## Where data goes

| Destination | What | When |
|---|---|---|
| The user's own bank (FinTS) | Login name, PIN, TANs, orders, the account data the bank answers with | Every login, read and transfer — the app's purpose |
| Brandfetch (api.brandfetch.io, cdn.brandfetch.io) | Merchant names from the transactions; Brandfetch sees the IP address | Only after the user turned on "Firmenlogos" |
| Hugging Face (huggingface.co) | Nothing of the user's — a file download | Only when the user downloads the category model |
| GitHub (api.github.com) | Nothing of the user's — the release list | Update check, GitHub APK only |
| Google Play services | Nothing — the code scanner runs on the phone and returns only the code's text | "GiroCode scannen" |
| Google Play (Billing) | The Girovo Plus purchase, handled by Play; Girovo only reads whether it is active (product, purchase state, purchase token) and keeps that status on the phone | Play build, when the user subscribes |
| MT-Media, through the Play Console | Play's order data for each purchase: order number, product, price, country, date — not the buyer's name or e-mail | Play build, per purchase; kept as tax and commercial law require |
| The developer's telemetry server (telemetry.elnino0916.de) | Error reports — scrubbed of account data, amounts and names (electron/telemetry-scrub.cjs), tagged only with where they happened | Always (release builds) |
| The same | Usage: which areas are used, how logins go, how long the bank takes, with its BLZ; an install id | Only after the user agreed ("Nutzungsdaten teilen") |

No advertising ID, no third-party analytics SDK, no account with the
developer. The rules are the desktop app's (mobile/bridges/telemetry.ts runs
electron/telemetry.cjs).

## Form answers

**Does your app collect or share any of the required user data types?**
Yes — financial information passes through the app to the user's bank.

The connection to the bank is direct from the phone; the developer never
receives any of it. Whether that counts as "collected" is the judgement call
in this form: Google counts data "transmitted off the device", and the
exception for data the user expects to send for a function they started is
written for sharing. The cautious answer is to declare it:

| Data type | Collected | Shared | Optional | Purpose | Ephemeral |
|---|---|---|---|---|---|
| Financial info › User payment info (IBAN, payee) | Yes | No | No | App functionality | No — the bank stores orders |
| Financial info › Purchase history (transactions) | Yes | No | No | App functionality | — received from the bank, stored only on the phone, encrypted, if the user turns that on |
| Personal info › Name (account holder, as the bank sends it) | Yes | No | No | App functionality | — |
| App activity › Other user-generated content (merchant names to Brandfetch) | Yes | Yes (Brandfetch) | Yes | App functionality (logos) | Yes |
| Financial info › Purchase history (the Girovo Plus subscription, through Google Play Billing) | Yes | No | Yes | App functionality | No — Play keeps it |
| App info and performance › Crash logs, Diagnostics (error reports) | Yes | No | No | Analytics | No |
| App activity › App interactions (usage, with consent) | Yes | No | Yes | Analytics | No |
| Device or other IDs (install id, only with the usage consent) | Yes | No | Yes | Analytics | No |

**Is all of the user data collected by your app encrypted in transit?** Yes —
https/TLS only (FinTS over https; cleartext is refused by the network
security config).

**Do you provide a way for users to request that their data is deleted?**
Yes — everything is on the phone: the Sitzung panel deletes saved data
("Gespeicherte Daten löschen", "Gerät vergessen"), and uninstalling removes
the rest. The developer holds no banking data; Girovo Plus order data from the
Play Console is kept as tax and commercial law require (privacy policy § 7).

**Independent security review:** no.
