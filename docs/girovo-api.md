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
  API. Off, the pipe does not exist.
- It answers only while Girovo is **open and unlocked** (the vault is open).
  Locked or logged out, a call answers `locked` (an app may wait and retry);
  a waiting consent dialog appears once the user has logged in, or the request
  times out after 2 minutes.

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

Like UAC, inside Girovo's window, which comes to the front (or asks for
attention when hidden in the tray):

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
  from the shell, never from the call.
- **MCP helper** `girovo-mcp` (later phase): stdio MCP server for assistants,
  JSON-RPC client of the pipe; tools are made from the methods the app is
  allowed.

## Phases

1. Transport, identification and signatures, `hello`, the dialog, grants,
   the settings page, the read methods.
2. The write methods, settings, `bank.refresh`, `transfers.request` with the
   in-app approval, events.
3. `girovo-mcp` and its parent-process identification.
4. Documentation on girovo.de, an example client.
