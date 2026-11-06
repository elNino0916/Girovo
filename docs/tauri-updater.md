# Girovo's own updater in the Tauri shell

Status: 2026-11-06, branch `6.0`. Built and tested in `src-tauri/src/updater/`.
The installer side (tauri.conf.json, NSIS hooks, CI) is still to do; this page
says what it needs.

The owner kept Girovo's own updater: no Tauri updater plugin, no signing keys.
Every download is checked against the SHA-256 that GitHub computes for each
release file, as under Electron.

## What is there

| File | What it is |
|---|---|
| `updater/logic.rs` | `electron/update-logic.cjs`, function for function: versions (`X.Y.Z-preview.N`, nightly `X.Y.Z-preview.<yyyymmddhhmm>.g<sha7>`, CI's `-dev.N`), Stabil / 6.0-Vorschau, the way back from a preview, which file fits which install, blockmaps, the install arguments |
| `updater/engine.rs` | `electron/updater.cjs`: check (with the one retry on 502/503/504), download with progress, stall limit and cancel, the digest check, the differential download, install, the marker across the restart, auto check every 6 h, the channel switch |
| `updater/chunks.rs` | the content-defined chunker for differential downloads (below) |
| `updater/start.rs` | the update at start, for the start window |
| `updater/texts.rs` | the messages, German and English (`electron/i18n.cjs` `updates`) |
| `updater/mod.rs` | the Tauri side: plugin, commands, `updater:state` event, starting the installer once the app has quit |
| `updater/tests.rs` | `electron/updater.test.cjs` against a local stand-in for GitHub |
| `scripts/blockmap.mjs` | writes the blockmap beside the Setup.exe, for CI |

Preferences, cache folder and marker are Electron's: `fints.updates.auto`,
`fints.updates.channel`, `%LOCALAPPDATA%\sooskasse-fints-updater\installing.json`
(Linux: `~/.cache/girovo-updater`). So the first Tauri start after an update from
5.x finds the marker 5.x wrote and says "Aktualisiert auf 6.0.0".

The version is package.json's (`app.package_info().version`), so a nightly
knows its stamp. Note: `shell.rs` `boot_script` still hands the page
`CARGO_PKG_VERSION` (always 6.0.0) as `__girovoShell.version`.

### For the page

`window.electronUpdater` in `src/bridge.js`, with the preload's names and the
same state object (`types/electron-window.d.ts`). Every state change goes out
as the Tauri event `updater:state`; `onState` listens to it. Checked in the
debug app over CDP against a local feed: check, download with 6 progress pushes,
`ready`, `setAuto`, both channel switches, and an install through the real exit
(below).

### For the start window (`lib.rs` `start()`, its own thread)

```rust
let updater = updater::get(&app);
let check = updater.start_check(&*splash);          // calls splash.set_checks(true) when it checks
// … migration, page load …
if updater.update_at_start_blocking(check, &*splash) {
  return; // the app is quitting; the installer starts once it has
}
```

`splash::Splash` implements `updater::StartWindow` (`step("checking" |
"downloading" | "installing")`, `set_update`, `progress`). The rules are
`updateAtStart`'s: the installed app only, the switch on or `--update` given,
6 s for GitHub's answer, the way back only with `--update`. Never call it for
a start with Windows (`--background`).

### For the install window

`updater::set_install_window(&app, |started| …)` is called at
`RunEvent::Exit`, right after the installer started. It gets the installer's
pid, the version, the app's exe, the releases page, the cache folder and the
install folder. That is what `install_window::Options` takes, beside the start
window's header, footer and steps:

```rust
updater::set_install_window(&handle, move |s| {
  let _ = install_window::spawn(&install_window::Options {
    installer_pid: s.installer_pid,
    app_exe: s.app_exe.as_ref().map(|p| p.display().to_string()).unwrap_or_default(),
    version: s.version.clone(),
    releases_url: s.releases_url.clone(),
    // dark, lang, header, footer, steps: as the start window left them
    ..Default::default()
  });
});
```

The process ends right after the hook returns.

`Updater::on_before_install` runs before the app quits for an install, with
`back: true` for the way back to 5.x. Electron used it to take the start with
Windows away; that belongs to the background checks' port.

`restartToUpdate` quits and starts the app again with `--update`, at
`RunEvent::Exit`. The new process can start before the old one is fully gone.
That is safe because the single-instance plugin is registered before the
updater's: it lets go of its lock and its message window in its own
`RunEvent::Exit` first, so a new start is not taken for a second instance.
Keep that order in `lib.rs`.

## Running the installer

`install()` checks the file against GitHub's digest once more, writes the
marker, and quits the app. At `RunEvent::Exit` the plugin starts the Setup.exe
detached (outside a job object if it can):

```
Girovo-<version>-Setup.exe /S /UPDATE /R /ARGS --updated --force-run
```

Both installer kinds understand this line:

- **Tauri's NSIS:** `/S` silent, `/UPDATE` keeps the shortcuts and skips
  WebView2, and `/R` starts the app with `/ARGS`.
- **electron-builder's** (the way back to 5.x): `/S`, `--updated` and
  `--force-run`. It ignores the rest.

The installer starts after the app's windows are gone. That matters: Tauri's
template closes a running Girovo.exe through the Restart Manager without
waiting (`CheckIfAppIsRunning`). If the installer cannot start, the app starts
again by itself and its marker says "Das Update auf Version … wurde nicht
abgeschlossen". This was checked end to end in the debug app, with a fake
installer that Windows refused (os error 216).

**Linux.** Unchanged from Electron: the AppImage and the .deb do not update
themselves (`installKind` returned `manual` for both, see electron-builder.yml).
The updater offers the release page. An AppImage could replace itself (verified
file, `rename` over `$APPIMAGE`, start again) if that is wanted later.

## Decision: differential updates

Electron downloaded only the changed parts of the Setup.exe. electron-builder
wrote a blockmap, and each install kept a copy of its own installer as the
base (`update-base.bin`, 355 MB on disk). Tauri writes no blockmap. Worse, its
NSIS installer is one solid LZMA stream with Girovo.exe first, so a change in
the app changes every compressed byte after it, the model included. A blockmap
of that file would find nothing to reuse.

| Option | Each update downloads | Extra disk | Work |
|---|---|---|---|
| Drop differential | the whole installer, ~230 MB (est.) | none | none |
| Blockmap in CI + kept installer, as before | little, but only with an uncompressed installer, see the next row | +300 MB copy | CI + installer hook |
| **Uncompressed installer, blockmap in CI, the installed files as the base** (built) | the changed parts of Girovo.exe and NSIS's own part (est. ≤ 25 MB) | none | CI: compression off, run `scripts/blockmap.mjs` |
| Model as a separate, versioned download | the app only (est. < 20 MB) | none | model download, versioning; out of scope here |

**Recommendation: the third row, now. The model as its own download later.**
Once the model is its own download, the differential path matters little.

How it works:

- In an uncompressed NSIS installer every file is stored as it is. So the
  chunks of the files already installed reappear in the next installer: the
  283 MB model, and most of Girovo.exe, whose embedded page assets are
  compressed one by one.
- CI cuts the Setup.exe with a content-defined chunker (gear hash, 8–128 KiB
  chunks, ~40 KiB on average) and publishes `<Setup.exe>.blockmap`. It uses
  electron-builder's v2 JSON format, gzipped, plus a mark:
  `"chunker": "girovo-cdc-1"`.
- The app cuts its own install folder the same way and plans copies and range
  fetches (`plan_differential`, as before). It builds the file and checks it
  against GitHub's digest. Anything that fails falls back to the whole file.
- No base copy is kept.
- A blockmap without the mark (5.x's, the way back) is not used.
- 5.x copies try our blockmap against their own, match nothing, and download
  the whole file. That is harmless.
- The Rust and JS chunkers are held together by one shared test vector.

Costs:

- **Full installer is bigger.** The model shrinks from 278.6 MB to 214.7 MB
  with LZMA (measured, xz -6). Uncompressed, the installer grows by about
  75 MB, to roughly 310 MB. That is still below 5.16.2's 366 MB.
- **CPU per check.** Each check that finds a newer release reads the install
  folder once (~300 MB, off the async runtime). The JS chunker takes 2.5 s for
  the model; the Rust one is expected to be faster but was not measured in a
  release build.

What CI must do:

1. Set `bundle.windows.nsis.compression` to `"none"` in tauri.conf.json.
2. After renaming the installer, run `node scripts/blockmap.mjs
   dist/Girovo-<version>-Setup.exe`.
3. Upload both files. On the model, the script took 2.5 s and wrote a 143 KB
   blockmap.

Without these steps the updater simply downloads whole files.

## The first Tauri release reaching 5.x and 6.0-preview (Electron) copies

What installed Electron copies do with a release (`electron/updater.cjs`,
`update-logic.cjs`), checked against the live API on 2026-11-06:

- **Feed.** Stabil asks `releases/latest`. The 6.0-Vorschau channel reads
  `releases?per_page=100` on 6.0 previews and `per_page=20` on 5.x builds from
  main. Only a release with a Setup.exe counts on that channel.
- **The file.** The first asset whose name matches `/-Setup\.exe$/i` and
  `^[A-Za-z0-9][A-Za-z0-9._+-]{0,150}$` (no `..`). It must be under
  `https://github.com/elNino0916/Girovo/releases/download/`, at most 1 GiB,
  with GitHub's `digest: sha256:…`. Without a digest, only the release page is
  offered.
- **Blockmap.** If `<name>.blockmap` exists, they try a differential download:
  their release by tag, its blockmap, and `update-base.bin` hashed. They find
  nothing in common with ours and download the whole file.
- **Install.** They write `installing.json`, then run
  `Setup.exe /S --updated --force-run` from `%LOCALAPPDATA%\sooskasse-fints-updater`.
- **Install window.** It is copied there too, and starts with `--install-dir`
  (the old folder) and `--app-exe` (the old Girovo.exe). Then the app quits.
- **What the window waits for.** It waits for the installer to exit with code
  0. Then it waits up to 45 s for a process named `Girovo` with a window. A
  non-zero exit code shows "Update nicht abgeschlossen".

### Asset naming

Rename in CI to the names every release so far had:

- `Girovo-<version>-Setup.exe`
- `Girovo-<version>-Setup.exe.blockmap`
- `Girovo-<version>-x86_64.AppImage`
- `Girovo-<version>-amd64.deb`

Tauri's own `Girovo_<version>_x64-setup.exe` would also be found, because the
underscore and the case-insensitive suffix pass. But the website, Obtainium,
`nightly.yml` (`dist/*-Setup.exe`) and the blockmap name expect the old names.
Exactly one `-Setup.exe` per release.

### What the Tauri NSIS installer must accept

Tauri's template, read from the CLI 3.0.0-alpha.5 binary:

1. **`/S` silent.** It works as is.
2. **5.x's `--updated --force-run`.** The template knows neither, so nothing
   starts the app after the install. The old install window then gives up
   after 45 s. A hook must start `Girovo.exe --updated` when `--force-run` is
   given without `/R`.
3. **The old Electron install.** Tauri looks for its own install under
   `Software\Microsoft\Windows\CurrentVersion\Uninstall\Girovo` and
   `Software\MT-Media\Girovo`. electron-builder's is at
   `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\d9e7f93b-a8ce-5852-b6dc-dd552e8c0f46`
   (InstallLocation in `HKCU\Software\d9e7f93b-a8ce-5852-b6dc-dd552e8c0f46`,
   e.g. `%LOCALAPPDATA%\Programs\Girovo`, on older installs `…\Sooskasse-FinTS`).
   Without a hook, Tauri installs beside it into `%LOCALAPPDATA%\Girovo`. The
   Electron app (~1.1 GB) and its "Girovo 5.x" entry in Apps & features stay
   behind, and a taskbar pin points to the old exe.

   **Recommended:** a PREINSTALL hook that, when that key exists:
   - waits up to ~10 s for the old Girovo.exe to exit (build/installer.nsh's
     loop);
   - runs the old uninstaller silently in place:
     `"<dir>\Uninstall Girovo.exe" /S /currentuser _?=<dir>`;
   - deletes what is left of it;
   - installs into that same folder (`StrCpy $INSTDIR <dir>`, `SetOutPath
     $INSTDIR`).

   Then taskbar pins, the Run entry (`de.elnino0916.sooskasse-fints` →
   `…\Girovo.exe --background`) and firewall or Defender exceptions keep
   pointing to a real file.
4. **The installed exe must be `Girovo.exe`.** 5.x's install window waits for
   a process named Girovo. electron-builder's installer (the way back)
   taskkills `Girovo.exe`. Set `mainBinaryName` if the bundler names it after
   the Cargo package.
5. **Keep `allowDowngrades` true** (the default). Silent downgrades are aborted
   otherwise, and the way back from a preview to Stabil is a downgrade.
6. **Nightly versions are not numeric.** Nightlies are versioned
   `6.0.0-preview.<stamp>.g<sha>`. Check that the bundler accepts that for
   NSIS's numeric `VIProductVersion`, or give the bundle a numeric version
   while package.json keeps the stamp.

A draft of the hooks for `bundle.windows.nsis.installerHooks`. It is untested,
and nothing here compiled it (there is no NSIS on this machine):

```nsis
!define EB_KEY "Software\d9e7f93b-a8ce-5852-b6dc-dd552e8c0f46"
!define EB_UNINSTALL "Software\Microsoft\Windows\CurrentVersion\Uninstall\d9e7f93b-a8ce-5852-b6dc-dd552e8c0f46"

!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $R5 HKCU "${EB_KEY}" "InstallLocation"
  ${If} $R5 != ""
  ${AndIf} ${FileExists} "$R5\Uninstall Girovo.exe"
    ; 5.x quits right after starting this installer: let it finish.
    StrCpy $R1 0
    ${Do}
      nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq Girovo.exe" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"Girovo.exe\""`
      Pop $R0
      ${IfThen} $R0 != 0 ${|} ${Break} ${|}
      Sleep 250
      IntOp $R1 $R1 + 1
    ${LoopUntil} $R1 >= 40
    ExecWait `"$R5\Uninstall Girovo.exe" /S /currentuser _?=$R5`
    Delete "$R5\Uninstall Girovo.exe"
    DeleteRegKey HKCU "${EB_UNINSTALL}"
    DeleteRegKey HKCU "${EB_KEY}"
    ; Into the old folder: pins, the Run entry and exceptions stay valid.
    StrCpy $INSTDIR $R5
    SetOutPath $INSTDIR
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; 5.x passes electron-builder's --force-run; Tauri's own restart is /R.
  ${StrLoc} $R0 $CMDLINE "--force-run" ">"
  ClearErrors
  ${GetOptions} $CMDLINE "/R" $R1
  ${If} $R0 != ""
  ${AndIf} ${Errors}
    nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" "--updated"
  ${EndIf}
!macroend
```

### The way back across the switch

From a Tauri 6.x on Stabil, the way back is 5.16.x's electron-builder
Setup.exe. The argument line above makes it install silently and start
Electron. With the hook above it reuses the same folder. Tauri's
`uninstall.exe` and its "Girovo" entry in Apps & features stay behind until the
next 6.x install. Both shells use the same data folder.

## Verified

- `cargo test --lib updater` (src-tauri): 79 tests pass. They cover logic,
  chunks, texts and the whole flow against a local server, including the
  update at start and the at-exit paths.
- `cargo test --lib live_github -- --ignored --nocapture`: a read-only dry run
  against the real releases, 2026-11-06:

  | Installed | Stabil | 6.0-Vorschau |
  |---|---|---|
  | 5.16.2 | current | 6.0.0-preview.202611061124.g58e5a57, 371 MB |
  | 5.16.1 | 5.16.2, 366 MB (5.16.2's electron-builder blockmap turned down) | 6.0.0-preview.202611061124.g58e5a57 |
  | 6.0.0-preview.1 | 5.16.2 as the way back (`back: true`) | 6.0.0-preview.202611061124.g58e5a57 |
  | 6.0.0-preview.202611061124.g58e5a57 | 5.16.2 as the way back | current |

- `node --test scripts/blockmap.test.mjs`: the JS chunker matches the Rust one
  on the shared vector.
- **Debug app over CDP** (throwaway data folder, local feed, placeholder page
  on :3000):
  - the bridge's 10 methods;
  - check, download with pushed progress, `ready`;
  - prefs written as `fints.updates.auto` and `fints.updates.channel`;
  - install, quit, failed installer start, the app back by itself, and
    "nicht abgeschlossen".

## Not tested

- A real Tauri NSIS installer: none was built here.
- The update from 5.x to the first Tauri release.
- The installer hooks above.
- `/S /UPDATE /R /ARGS` against Tauri's template, and electron-builder's
  installer with that line.
- The differential download against real uncompressed installers. The tests
  use synthetic files.
- The update at start in the real start window: `lib.rs` does not call it yet.
- The install window hook.
- `CREATE_BREAKAWAY_FROM_JOB` inside a job object.
- The Linux build.
- `scripts/blockmap.test.mjs` is not in `npm test`'s glob (package.json was not
  touched).
