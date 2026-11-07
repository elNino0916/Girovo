# Updater 2: signed manifests on girovo.de

Status: plan, 2026-11-07, for 6.0.2 (branch `nightly`). The owner's picks are
in the "Decisions" section; this page says how they fit together and in what
order they are built. `docs/tauri-updater.md` describes the updater as it is.

## Why

Today the desktop app and the GitHub APK ask `api.github.com` themselves:

- GitHub allows 60 unauthenticated requests an hour per public IP, shared by
  every device at home; a 304 still counts (measured 2026-11-07).
- Clients order versions by parsing their names, so renaming nightlies
  stranded old copies until a bridge release (6.0.0-preview.202611071208).
- The only check of a download is GitHub's own SHA-256: whoever controls the
  GitHub account or the download host controls the update.
- There is no way to install an update from a file, and the install window is
  Girovo.exe itself on WebView2, so a broken app can't update itself.

## Decisions (owner, 2026-11-07)

| Question | Pick |
|---|---|
| Scope for 6.0.2 | manifest on girovo.de, install from a file, a small update helper (the model stays in the installer for now) |
| Signing | Girovo's own Ed25519 keys: the stable key on the owner's PC, password-protected, in the keys folder beside the Android keystore; nightlies with a separate key as a GitHub Actions secret |
| Manifest source | girovo.de's Worker builds it |
| Controls | a halt switch and staged rollout, in Cloudflare KV (editable in the dashboard, also from a phone) |
| Install from a file | older versions allowed too (rollback), with a warning |
| Staged rollout and manual checks | a setting like Windows' "Erhalte die neuesten Updates, sobald sie verfügbar sind": on, the device skips the rollout wait; off, every check waits for its bucket |

## How it fits together

```
release (CI or local)                 girovo.de Worker                   app
─────────────────────                 ────────────────                   ───
girovo-update.json  ─┐                 /updates/v1/stable.json            reads girovo.de first,
girovo-update.json.sig├─ release ──►   /updates/v1/nightly.json  ──────►  checks the signature,
Setup.exe, AppImage… ─┘   assets       (+ KV: halted, rollout %)          orders by build number,
                                                                          falls back to GitHub's API
```

### 1. The release manifest (`girovo-update.json`)

One per release, uploaded as a release asset beside the files it describes,
with a detached Ed25519 signature `girovo-update.json.sig`:

- `version` (display only), `build` (one increasing number, Android's
  versionCode scheme times 10000 plus a nightly counter, so 6.0.2 > every
  6.0.2-nightly > 6.0.1), `channel` (`stable` | `nightly`), `published`
- `files`: for each file its name, kind (`setup` | `appimage` | `deb` |
  `apk`), size, SHA-256, URL, and the blockmap's URL and SHA-256
- `minimum`: the oldest Windows / Android version it runs on
- `notes`: the release notes' first lines, German and English

`scripts/update-manifest.mjs` writes it from the release folder;
`scripts/sign-update.mjs` signs it. The stable key file is encrypted
(scrypt + AES-256-GCM, @noble); signing asks for its password in a terminal,
which only the owner types. Nightlies are signed in `nightly.yml` with the
nightly key from the Actions secret `GIROVO_NIGHTLY_SIGNING_KEY`.

Both public keys are built into the app. A stable manifest must carry the
stable key's signature; the Nightly channel accepts either.

### 2. The Worker (`girovo-website/src/worker.ts`)

No GitHub token and no API calls:

- stable: `github.com/elNino0916/Girovo/releases/latest` redirects to the
  newest stable tag;
- nightly: `github.com/elNino0916/Girovo/releases.atom` lists the ten newest
  releases, pre-releases included;
- per tag it fetches `releases/download/<tag>/girovo-update.json` and `.sig`
  (downloads, not the API).

It answers `/updates/v1/<channel>.json` with the newest signed manifest of
that channel, bytes and signature unchanged, plus the controls from KV
(`update-controls`: `{"halted": [...], "rollout": {"6.0.3": 20}}`). Halted
versions are skipped (the one before is offered). Responses are cached for a
few minutes and carry an ETag; invalid KV JSON keeps the last good value.

### 3. The clients (desktop Rust updater, GitHub APK)

- Check `girovo.de/updates/v1/<channel>.json` (ETag), verify the signature
  with the built-in key, compare `build`, not version names.
- Staged rollout: a random installation ID (its own pref, not telemetry's)
  hashed with the version gives a bucket 0–99; the update is offered when the
  bucket is below the percentage, or when "Updates sofort erhalten" is on.
- Every download is checked against the signed SHA-256 (the blockmap too).
- girovo.de unreachable: fall back to today's GitHub API path, and still
  require the signed manifest asset when the release has one.
- No bridge release is needed: older copies find 6.0.2 through GitHub's API,
  and from 6.0.2 on they read girovo.de.

### 4. The update helper (`girovo-update.exe`, Windows)

A small Rust program with a plain Win32 window (no WebView2), shipped beside
Girovo.exe and copied to `%TEMP%` before use. Girovo hands it the installer,
its signed SHA-256 and the arguments, then quits; the helper waits for the
exit, checks the file again, runs the installer with progress, and starts
Girovo. It replaces today's install window (`install_window.rs`).

### 5. Install from a file (Windows)

Einstellungen → Updates → "Update aus Datei installieren …" or dropping a
Setup.exe on the window. Girovo accepts the file when its SHA-256 is listed in
a signed release manifest (fetched from girovo.de, or from GitHub when
offline from girovo.de), older versions included after a warning that data a
newer version wrote may not open. The helper installs it.

## Order of work

1. Manifest format, `update-manifest.mjs`, `sign-update.mjs`, the keys
   (owner types the stable password), signing in `nightly.yml`.
2. The Worker endpoint and the KV namespace (`update-controls`).
3. The desktop updater on the manifest: signature, build numbers, rollout,
   the setting, the fallback; then the GitHub APK.
4. The update helper.
5. Install from a file.

Each step lands on `nightly` and goes out as a 6.0.2 nightly when it works.
