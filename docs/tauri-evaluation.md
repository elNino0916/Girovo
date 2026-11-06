# Tauri 2 instead of Electron: first evaluation

Status: desk evaluation, 2026-11-06; the owner then chose route B on Tauri 3
(alpha) for 6.0.0, and the work started on `6.0` (`src-tauri/`, `desktop/`).
Every size below marked "est." is an estimate, still to be measured.

## Bottom line

- **Worth doing, but not for 6.0.0.** It is a 7.0-sized change: every native
  piece of the shell is rewritten in Rust, and the Linux build moves from
  Chromium to WebKitGTK.
- **Two routes:**
  - **A — Tauri window, Node sidecar.** Keeps the Next server as it is.
    Little gain: Node still ships, and only Electron's Chromium goes.
  - **B — the phone's architecture on the desktop.** A static export, the
    route handlers running inside the WebView (as `mobile/server` already
    does on Android), and Rust for bank HTTP, files and secrets. This is the
    real prize: no Node, one runtime for phone and desktop, the smallest app.
- **The biggest size win doesn't need Tauri at all.** The category model is
  283 MB, and the updater keeps a 355 MB copy of the installer. Shrinking or
  splitting the model, and dropping that copy, pays off under Electron too.

## Where the size goes today

Measured on the owner's install of `6.0.0-preview.202611051912.g757f0c8`.

| Part | Size |
|---|---|
| Installer (`Setup.exe`) | 354 MB; the `.deb` and AppImage are about the same |
| Installed, on disk | 1.1 GB |
| Electron runtime (`Girovo.exe` 238 MB, plus DLLs) | ~280 MB |
| Category model (`resources/models`, e5 + onnxruntime-node) | 283 MB |
| `resources/update-base.bin` (the installer kept for differential updates) | 355 MB |
| Next standalone server (`resources/server`) | 116 MB |
| Shell code (`app.asar`), update window, Hello helper | < 1 MB |

The machine already has WebView2 156. Rust is not installed.

## How the shell works now, and what each route changes

The Electron main process (`electron/main.cjs`, ~1,500 lines; ~7,000 with
helpers and tests):
- starts the Next standalone server as a child process, using Electron's own
  Node (`ELECTRON_RUN_AS_NODE`), on 127.0.0.1 and an ephemeral port;
- points a sandboxed, context-isolated window at it;
- gives the page 11 bridges (`electronTitleBar`, `electronUpdater`,
  `electronHello`, `electronBackground`, …) over 16 IPC channels.

**Route A** swaps Electron for Tauri, and swaps Electron's Node for a shipped
`node.exe` (Tauri sidecar, `externalBin`). The server, the route handlers and
`onnxruntime-node` stay as they are. JS parts of the shell, such as the LAN
shelf and the six-hourly check, can move into that Node process instead of
being ported. Est. install about 500 MB, installer about 300 MB: the model
dominates.

**Route B** is what the Android app already does:
- `next build` with `output: 'export'` (the Android build's config);
- `scripts/build-mobile.mjs` bundles the 33 route handlers and lib-fints for
  the WebView, with `mobile/shims` standing in for `node:fs`, `node:crypto`,
  `node:async_hooks` and `node:path`;
- `mobile/server/fetch.ts` answers the page's `/api` calls in-page, and sends
  bank requests through native HTTP, because banks send no CORS headers.

On Tauri:
- `GirovoHttp` becomes `tauri-plugin-http` (reqwest, not bound by CORS) or a
  small Rust command;
- the Capacitor filesystem becomes Tauri's fs plugin or a Rust command;
- the bridges become `invoke` calls.

Est. install about 330 MB with today's model. Est. installer under 20 MB if
the model is a separate download.

## Feature by feature

Effort: S = a day or less, M = a few days, L = a week or more, or real
uncertainty.

| Electron today | Tauri 2 | Effort / risk |
|---|---|---|
| Custom frame: `titleBarOverlay` with native caption buttons and Windows 11 snap layouts, colours per theme and layer, `app-region` rectangles | `decorations: false` plus caption buttons drawn in HTML. Core has no native overlay; snap layouts need a community plugin that returns `HTMAXBUTTON` from `WM_NCHITTEST` ([tauri-plugin-decoration](https://docs.rs/crate/tauri-plugin-decoration/2.0.3/source/src/lib.rs), [tauri-plugin-frame](https://github.com/clarifei/tauri-plugin-frame)). Drag regions become `data-tauri-drag-region`. | **M, risk** — the frame is the face of 6.0 |
| Start window with steps (`splash.cjs`/`splash.html`) | A second window, driven from Rust | S |
| Own updater (`updater.cjs`, `update-logic.cjs`): GitHub, SHA-256 against GitHub's digests, stable / preview / nightly channels, the way back, differential via blockmap, install at start, WPF install window | `tauri-plugin-updater`: minisign signatures and a `latest.json`, NSIS/MSI and AppImage; channels by picking the endpoint at runtime. No differential updates, but a small installer makes that moot. Needs ≥ 2.12.0 ([CVE-2026-95625](https://ubuntu.com/security/CVE-2026-95625), downgrade). Keeping the own logic in Rust is the alternative. | M |
| Windows Hello (`build/windows-hello/WindowsHello.cs` → `Girovo-Hello.exe`) | `KeyCredentialManager` straight from Rust through the `windows` crate; the helper exe goes | M |
| `safeStorage` (DPAPI / keyring): linked-unlock secret, background-check secret | `CryptProtectData` via the `windows` crate; the `keyring` crate on Linux | S |
| Tray, close to tray, login item with `--background` | Built-in tray API; `tauri-plugin-autostart` | S |
| Notifications (background checks) | `tauri-plugin-notification` | S |
| Six-hourly background check (`background.cjs` → server route) | A: unchanged in the sidecar. B: a hidden webview running the check bundle, like Android's job. Tauri's `backgroundThrottling` option covers WebKit only ([tauri-runtime 2.4.0](https://v2.tauri.app/release/tauri-runtime/v2.4.0/)), so WebView2's behaviour for a hidden window has to be tested. | **M, risk** for B |
| LAN sync shelf (`sync-lan.cjs`, HTTP server on the LAN) | A: in the sidecar. B: port 142 lines to Rust (axum or tiny_http). | M |
| PDF export (`webContents.printToPDF`) | No Tauri API. A Rust command calling `ICoreWebView2_7::PrintToPdf` ([WebView2 docs](https://learn.microsoft.com/es-es/microsoft-edge/webview2/reference/win32/icorewebview2_7)); WebKitGTK's print operation on Linux | M |
| Save and open dialogs (`file-save.cjs`) | `tauri-plugin-dialog` and fs | S |
| Single instance, zoom keys, flash frame, external links to the browser, permission denials | `tauri-plugin-single-instance`, `set_zoom`, `request_user_attention`, the opener plugin plus navigation handlers, capabilities | S |
| Telemetry hub and scrubbing (`telemetry*.cjs`) | Port it, or keep it in the page's JS | S–M |
| Category model (`onnxruntime-node`, e5, 283 MB) | A: unchanged. B: `onnxruntime-web` (WASM) in the WebView, or the `ort` crate in Rust. Quantise either way. | M |
| pdf.js invoice reading, tesseract.js OCR | Already browser libraries | — |
| Linux on Chromium | WebKitGTK. The CSS in use (`color-mix`, `:has`, `@container`, `popover`, `round()`, `lh`, `@property`) is in recent WebKitGTK (2.44+). Untested: M3E's components on WebKit, and WebKitGTK's known rendering problems on some GPU drivers. | **M, risk** for Linux |

Other differences to weigh:
- **Rendering engine version:** Electron pins Chromium per release; WebView2
  updates itself under the app. It is evergreen and present on every
  Windows 10/11, but a rendering change can arrive without a Girovo release.
- **Bank TLS:** reqwest uses rustls by default, not Node's OpenSSL. A bank
  with an unusual TLS setup could behave differently; native-tls is a
  feature flag away.
- **Memory:** WebView2 is Chromium too, so the page's renderer costs about
  the same. The saving is Electron's main process and, in route B, the Node
  server. Est. 30–40 % less in total; to be measured.
- **Startup:** B starts no server, so the window can show sooner. A still
  waits for Node.

## Open questions for a spike

1. A real FinTS login and Umsätze through `tauri-plugin-http` or reqwest:
   TLS against a few banks, and the first-byte timing that
   `lib/bank-fetch.ts` relies on (the Android HTTP plugin had to stream).
2. The frame with snap layouts through one of the plugins, colours following
   the theme, and the folded rail and drag regions.
3. Whether a hidden WebView2 window keeps running a six-hour timer and a
   long approval poll.
4. `PrintToPdf` from Rust, output matching today's statement PDFs.
5. Measured installer size, disk size, RAM and time to window, against
   Electron.

Suggested shape: a throwaway `tauri/` folder that loads the Android static
export with `mobile/server` re-targeted to Tauri. About 3–5 days. It needs
the Rust toolchain and the MSVC build tools on this PC.

## Independent of Tauri

- **A smaller model.** The e5 model is already int8
  (`model_quantized.onnx`, 278 MB; its multilingual vocabulary is most of
  that). Only a smaller model, such as multilingual-e5-small, would shrink
  it; check it against the existing category eval first.
- **Make the model a separate, versioned download.** Updates then carry only
  the app.
- **Reconsider `update-base.bin`.** It doubles the disk use, for differential
  updates whose download is dominated by the model anyway.
