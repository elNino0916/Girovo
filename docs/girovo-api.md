# Girovo API

Spec from 2026-11-15 (owner's answers the same day). Girovo Next, desktop
(Windows and Linux); the phone later.

## What it is

A local API on the user's computer through which other apps can work with
Girovo: read accounts and bookings, change categories, notes, budgets and
settings, and ask for transfers. Girovo decides who gets in. MCP (for AI
assistants) is one adapter on top of it, not the API itself.

Owner's rules:

- **Any app may ask**, none gets in on its own. Girovo shows a dialog like
  Windows' UAC: the app, its **publisher read from its code-signing
  certificate**, and the permissions it asks for. The user allows or refuses.
- **MT-Media is always trusted** and shown as MT-Media (Girovo's own
  publisher), even where the certificate is not installed in Windows.
- **Revocable** in Einstellungen → Girovo API: per app, per permission.
- **Everything is possible** through the API, including settings, so an app
  can set Girovo up. **Transfers** (and anything else that moves money or
  gives an order to the bank) always need an approval **inside Girovo**, and
  the bank's own Freigabe as ever.

## Transport

- **Windows:** a named pipe `\\.\pipe\girovo-api-<user SID>` whose ACL admits
  only the current user. **Linux:** a Unix socket
  `$XDG_RUNTIME_DIR/girovo-api.sock`, mode 0600.
- No TCP and no HTTP: a web page in a browser can reach `localhost`, it can't
  reach a pipe or a socket. Nothing listens on the network.
- **Protocol:** JSON-RPC 2.0, one JSON message per line (as MCP's stdio). A
  connection opens with `girovo.hello`; nothing else is answered before it.
- The API is **off** until the user switches it on in Einstellungen → Girovo
  API. Off, the pipe does not exist. The shell keeps the switch (prefs.json
  `fints.api.on`), so while it is on the pipe is there from the app's start,
  logged in or not, in the tray too.
- It answers only while Girovo is **open and unlocked** (the vault is open).
  A call that comes while Girovo is logged out or still starting is **held**
  by the shell (in order, at most 64 in all): Girovo's window comes out of the
  tray and to the front (else its taskbar button flashes), the login says
  which app asks ("<App> (<Herausgeber>) möchte auf Girovo zugreifen. Melde
  dich an, um zu entscheiden."), and once the user has logged in the held
  calls reach the page as if they had just come, a consent dialog first where
  one is needed. Not logged in within 2 minutes, the call answers `locked`
  (an app may retry). A held call whose app hangs up is dropped.

## Who is asking

The shell (Rust) identifies the other end of each connection itself; nothing
an app says about itself is trusted for this.

1. The process: `GetNamedPipeClientProcessId` on Windows, `SO_PEERCRED` on
   Linux.
2. Its executable: `QueryFullProcessImageNameW`, `/proc/<pid>/exe`; its
   SHA-256.
3. **Windows: its Authenticode signature** (`WinVerifyTrust`, then the
   signer certificate's organisation, else common name). Three outcomes:
   - **MT-Media**: the signer certificate's thumbprint is Girovo's pinned
     MT-Media certificate (cert-helper/src/identity.rs). Always trusted.
   - **Verified publisher**: Windows trusts the chain. Shown with its name.
   - **Unknown publisher**: unsigned, invalid, revoked or untrusted. Shown as
     Windows does it, a clear warning, the path of the file. The user may still
     allow it (like UAC).
4. **Linux:** programs carry no signatures; every app is an unknown publisher,
   shown by its path.
5. The app's **display name**: the signature's program name, else the
   executable's FileDescription (Windows version info), else its file name.
   The name the app sends in `girovo.hello` is shown only as "says it is …".

A grant is bound to **(publisher, executable path)** for a signed app, so an
update by the same publisher keeps it; to **(path, SHA-256)** for an unknown
publisher, so any change asks again.

**Through a helper** (MCP): when the client is Girovo's own `girovo-mcp`
helper (signed by MT-Media), the shell also identifies the helper's **parent
process** (the assistant that started it) the same way, and the dialog shows
that one: "Claude (Anthropic PBC) über Girovo MCP". The grant is the parent's.

## The dialog

Like UAC, inside Girovo's window, which comes out of the tray and to the
front (else its taskbar button flashes):

- the app's icon (from its executable) and name, "Herausgeber: <name>" with a
  verified mark, or "Herausgeber: unbekannt" on a warning tone, and the path;
- what it asks for, one row per permission, each a switch (on as asked; the
  user may turn single ones off);
- the app's own reason line from `girovo.hello`, set apart and marked as the
  app's words (an app's text is never an instruction to Girovo);
- **Zulassen** and **Ablehnen**. Allowed is remembered until revoked; refused
  is remembered until Girovo restarts, so an app can't nag.

Every later request for a permission the app does not have opens the dialog
again for just that permission.

## Permissions

| Permission | Allows |
|---|---|
| `accounts.read` | accounts, balances, Verfügbar, the Gesamtsaldo |
| `transactions.read` | bookings (with notes and categories), search |
| `insights.read` | Analyse figures, Verträge & Abos, budgets, Sparziele, the forecast |
| `ask` | asking Girovo AI and getting its answer |
| `categories.write` | a booking's category, category rules, own categories |
| `notes.write` | notes on bookings |
| `budgets.write` | Monatsbudgets, Sparziele, reminders and contract names |
| `settings.read` | Girovo's settings |
| `settings.write` | changing settings (see the list below) |
| `bank.refresh` | reading new data from the bank (may cost a Freigabe, asked in Girovo) |
| `transfers.request` | asking for a transfer, Terminüberweisung or Dauerauftrag, each approved in Girovo |

**Approved in Girovo every time:** `transfers.request` (the transfer review
opens filled in; the user checks and sends it, then the bank's Freigabe) and
`bank.refresh` when the bank would ask for a Freigabe.

**Never through the API**, whatever is granted: the PIN, Windows Hello,
security keys, "Weitere Banken mit anmelden", forgetting the device, deleting
or resetting saved data, restoring a backup, the Girovo API's own switch and
grants (an app can't grant itself more), the update channel and update
installs. These stay in Girovo's own hands. *(Decision for the owner: anything
to add or take off this list.)*

## Methods (first set)

All under `girovo.`; answers in the app's own shapes (amounts in cents with a
currency, days as `yyyy-mm-dd`).

- `hello { app, version, permissions[], reason? }` → `{ granted[], girovo }`
- `accounts.list` → accounts with balances
- `transactions.list { account?, from?, to?, query?, category?, limit, cursor? }`
- `insights.month { month }`, `contracts.list`, `budgets.list`, `goals.list`, `forecast`
- `ask { question }` → the answer as text plus its figures
- `categories.set { booking, category }`, `rules.add`, `notes.set`, `budgets.set`, `reminders.set`
- `settings.get`, `settings.set { key, value }` (only the keys on the list)
- `bank.refresh { account? }`
- `transfers.request { iban, name, amount, purpose, executeOn? }` → `pending` until the user acts, then `sent` or `refused`
- `events.subscribe { kinds[] }` → notifications (new bookings, balance changed) while connected

Errors: `locked`, `denied`, `not_permitted` (with the permission it needs),
`invalid`, `refused_by_user`, `bank_error` (the bank's text).

## Einstellungen → Girovo API

- **Girovo API zulassen** (off by default).
- **Apps**: each allowed app with publisher, permissions as switches, last
  use; **Zugriff entziehen**.
- **Verlauf**: the last calls per app (what, when, allowed or refused), kept
  on the device.
- **Für Entwickler**: a link to the documentation (girovo.de, later).

## Where it lives

- **Shell (Rust)**, `src-tauri/src/api/`: the pipe or socket, identification,
  signatures, JSON-RPC framing, rate limits, routing each call to the page.
- **Page**, `lib/api/` and `components/settings/Api*.tsx`: the grants (vault,
  device-own, never synced), the permission checks, the methods (the vault and
  the FinTS session live in the page), the dialog, the settings page.
- **Bridge:** the shell emits `api:call { id, client, method, params }` to the
  main window (as `background:run` does); the page answers with
  `invoke('api_reply', { id, result | error })`. The client identity comes
  from the shell, never from the call. Listening and readiness are apart:
  `api_set_enabled { on }` is the user's switch (remembered by the shell),
  `api_page_ready { ready }` says the page can answer (true once logged in
  with the vault open, false at the logout and with every page load). While
  it is false calls are held and `api:waiting { clients }` (and
  `api_waiting`) says who waits. Builds before 2026-11-14 kept the switch in
  the vault (`apiOn`); at the first login it moves to the shell and leaves
  the vault.
- **MCP helper** `girovo-mcp` (phase 3, below): stdio MCP server for assistants,
  JSON-RPC client of the pipe; tools are made from the methods the app is
  allowed.

## Phase 2 as built (2026-11-15)

Page side in `lib/api/` (writes.ts, settings.ts, transfers.ts, events.ts,
router.ts) and `components/api/` (ApiHost.tsx, host-actions.tsx,
transfer-requests.ts). Every write goes through the provider's own setters,
the ones the screens and Girovo AI's actions use, so it is kept, cleaned and
synced like a change made by hand. Every call is in the Verlauf; writes show a
pencil, settings.set names the setting, a transfer request names its outcome.

| Method | Permission | Params → result |
|---|---|---|
| `categories.set` | categories.write | `{ booking, category\|null }` (null: back to the rule or the guess) |
| `rules.add` | categories.write | `{ booking, category }` or `{ payee, category }`; a payee the user filed by hand is left alone (`applied: false, reason: 'filed_by_hand'`) |
| `categories.create` | categories.write | `{ name, direction?: 'out'\|'in' }` → `{ category: { id, name } }` |
| `notes.set` | notes.write | `{ booking, text\|null }` (one line, 280 characters) |
| `budgets.set` | budgets.write | `{ category, cents\|null }` (spending categories only) |
| `goals.set` | budgets.write | `{ account, name, target\|null, by? }` (savings accounts, Plus where it applies) |
| `reminders.set` | budgets.write | `{ contract, by\|null, lead?: 7\|14\|30 }` |
| `contracts.rename` | budgets.write | `{ contract, name\|null }` |
| `settings.get` | settings.read | → `{ settings, onlyOn[], onlyOff[] }` |
| `settings.set` | settings.write | `{ key, value }` → `{ key, value, changed }` |
| `bank.refresh` | bank.refresh | `{ account? }` → `{ accounts: [{ account, state, newBookings?, balance? }], newBookings }`; `refused_by_user`, `bank_error` (data.text: the bank's words) |
| `transfers.request` | transfers.request | `{ iban, name, cents, purpose?, executeOn?, account? }` → `{ request, state: 'pending' }` |
| `transfers.status` | transfers.request | `{ request }` → `{ request, state, text?, changed? }` (own requests only) |
| `events.subscribe` / `events.unsubscribe` | per kind | `{ kinds[] }` → `{ subscribed[] }` |

**Settings allowlist:** `language`, `theme`, `blackBackground`, `idleMinutes`
(5, 10, 15, 30), `balancesAtLogin`, `bookingsAtLogin`, `keepBalances` and
`keepBookings` (on only: off deletes kept data, which Einstellungen asks
about first; refused with reason `deletes_data`), `companyLogos` (off only:
on sends shop names to the logo service, the user's own consent; reason
`consent`), `ai`, `aiTone`, `aiLength`, `aiUseName`, `aiNames` (with the
desktop's Gemma), `singleKeyShortcuts`, `accountOrder` (every account id
once), `accountGrouping` (type, bank, none), `hiddenAccounts` (one stays
shown). A key the app does not offer right now is left out of settings.get
and `invalid` (reason `unavailable`) for settings.set.

**Never** (reason `never`), beyond the list above: usage data (consent),
"Neue Umsätze melden" (keeps PINs, asks the system) and the sync (pairs
devices). The payment alerts' own switches live in the shell's sealed box
and are not on the list yet. *(For the owner: confirm these three.)*

**Transfers:** the sheet opens filled in, marked "Angefragt von <app>
(<publisher>)", in front (`focus()`, else the taskbar flashes); one at a
time behind a sheet already open; at most 3 waiting per app, 10 in all
(reason `busy`). States: `sent` (the bank took it), `refused` (closed
without sending, or the logout), `failed` (the bank refused it or it could
not be sent, its words in `text`), `unclear` (the sheet's "Status unklar":
nobody can say yet whether it went through). `changed: true` when the user
sent other values than asked, never which. The final state goes to the
asking connection as `girovo.transfer.updated` and to the app's other
connections subscribed to `transfer.updated`.

**Events:** `bookings.new` (transactions.read) `{ account, count,
bookings[] }` for an account already loaded; `balances.changed`
(accounts.read) `{ account, balance, available }`; `transfer.updated`
(transfers.request). An account first loaded after the API went on is a
starting point, not news. A permission taken back stops its events at once.

## Phase 3 as built (2026-11-15)

`girovo-mcp` (src-tauri/mcp-helper/, its own crate like cert-helper/: no
Tauri, no async runtime, serde_json and on Windows the windows crate for the
user's SID). src-tauri/build.rs builds it on Windows and Linux into
`binaries/`; the bundle puts it beside Girovo.exe (tauri.windows.conf.json)
or in /usr/bin beside girovo (tauri.linux.conf.json); sign-windows.mjs and
dist-desktop.mjs sign and check it with the other helpers. The nightly
workflow needs no change: the windows job already hands `src-tauri/binaries/`
to the signing job.

- **MCP:** stdio, one JSON-RPC message per line. `initialize` (protocol
  2025-06-18; 2025-03-26 and 2024-11-05 are answered in their own version),
  `notifications/initialized`, `ping`, `tools/list`, `tools/call`;
  `notifications/tools/list_changed` when what Girovo allows changes. Results:
  a short German line, the method's JSON as text, and `structuredContent`
  from 2025-06-18 on. The line only counts and quotes what the method answered.
- **Girovo side:** the same pipe or socket as scripts/girovo-api-client.mjs
  (GIROVO_API_ADDRESS overrides it). The first tool call connects and says
  `girovo.hello { app: "Girovo MCP" }` for accounts.read, transactions.read,
  insights.read and the permission that tool needs, so one dialog covers
  the start. A later tool whose permission is missing gets `not_permitted`;
  the helper says hello for just that permission (the dialog opens in
  Girovo) and tries once more. Refused, switched off or denied: a tool error
  "Der Nutzer hat das in Girovo nicht erlaubt." Girovo closed or the API off:
  "Girovo ist nicht geöffnet oder Girovo API ist aus.", and the next call
  connects again (a connection Girovo dropped meanwhile is redone at once
  when the write fails, so nothing was sent twice).
- **Recognised** by the page (lib/api/grants.ts `isMcpHelper`) as an
  MT-Media signature on a file named girovo-mcp(.exe) with a parent; any other
  MT-Media program with a parent stays itself. On Linux every program is an
  unknown publisher, so there the grant is the helper's own (path and
  SHA-256), shown by its path, not the assistant's.

| Tool | Method | Permission |
|---|---|---|
| `list_accounts` | accounts.list | accounts.read |
| `search_transactions` | transactions.list | transactions.read |
| `month_summary` | insights.month | insights.read |
| `list_contracts` | contracts.list | insights.read |
| `list_budgets` | budgets.list | insights.read |
| `list_savings_goals` | goals.list | insights.read |
| `set_booking_category` | categories.set | categories.write |
| `add_category_rule` | rules.add | categories.write |
| `create_category` | categories.create | categories.write |
| `set_note` | notes.set | notes.write |
| `set_budget` | budgets.set | budgets.write |
| `set_savings_goal` | goals.set | budgets.write |
| `set_reminder` | reminders.set | budgets.write |
| `rename_contract` | contracts.rename | budgets.write |
| `get_settings` | settings.get | settings.read |
| `set_setting` | settings.set | settings.write |
| `refresh_from_bank` | bank.refresh | bank.refresh |
| `request_transfer` | transfers.request | transfers.request |
| `transfer_status` | transfers.status | transfers.request |

**Einstellungen → Girovo API → Mit KI-Assistenten verbinden** (desktop app):
the helper's path from `api_mcp_path` (bridge `mcpPath()`; an AppImage gets a
copy in the data folder, since its mount moves every start), Claude
Desktop's `claude_desktop_config.json` snippet
`{"mcpServers":{"girovo":{"command":"<path>"}}}` with a copy button, and the
note that a cloud assistant sends what it reads to its provider.

## Phases

1. Transport, identification and signatures, `hello`, the dialog, grants,
   the settings page, the read methods.
2. The write methods, settings, `bank.refresh`, `transfers.request` with the
   in-app approval, events.
3. `girovo-mcp` and its parent-process identification.
4. Documentation on girovo.de, an example client.
