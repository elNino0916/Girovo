; Without a DPI manifest, Windows bitmap-stretches the installer UI to match
; the display scale instead of letting it render at native resolution — the
; classic blurry-installer look on anything above 100% scaling (e.g. 4K/150%).
; PerMonitorV2 is the correct modern answer (also keeps it sharp if the window
; is dragged between monitors running different scale factors); the plain
; dpiAware fallback covers Windows versions that predate PerMonitorV2
; (pre-1703). Both compile fine against electron-builder's pinned NSIS 3.0.4.1
; — verified directly against the cached makensis.exe.
ManifestDPIAware true
ManifestDPIAwareness PerMonitorV2

; Sooskasse-FinTS spawns its Next.js server as its own executable re-executed
; with ELECTRON_RUN_AS_NODE=1 (see electron/main.cjs) — so two processes named
; Sooskasse-FinTS.exe exist under $INSTDIR while the app is open, not one.
;
; electron-builder's built-in "is the app running?" check (app-builder-lib's
; _CHECK_APP_RUNNING, in allowOnlyOneInstallerInstance.nsh) scans for any
; process with that name or path and force-kills what it finds before letting
; the install proceed. It runs on every update: once by the new installer,
; and once silently inside the *old* version's uninstaller, which the new
; installer launches automatically to clear the previous install first. It
; cannot distinguish the GUI process from the server child, and in practice
; reports the app as running — and un-killable — even when nothing is open,
; landing on "cannot be closed" until the uninstaller is run by hand first.
;
; Fix, part 1 — customCheckAppRunning (replaces _CHECK_APP_RUNNING):
;   Silently kill every Sooskasse-FinTS.exe process with taskkill /F, then
;   continue without prompting the user. The image name matches the server
;   child (and Electron's helper processes) as well, so an orphaned server is
;   cleaned up too. taskkill exits 128 when nothing was found, which is fine.
;   A brief Sleep lets Windows release file locks before we write to $INSTDIR.
;
;   Deliberately no /T: that also kills every *descendant* of a matching
;   process, whatever its name — and an installer started by the app's own
;   updater (electron/updater.cjs) is exactly that, a child of
;   Sooskasse-FinTS.exe. With /T the installer would take itself down.
;
;   --updated is that updater's flag. The app quits right after starting the
;   installer: it closes the window, ends the bank session and stops its
;   server, and it should be left to finish that rather than be killed in the
;   middle of writing its preferences. So under --updated the installer first
;   waits, about ten seconds at most, for the user's Sooskasse-FinTS.exe
;   processes to be gone (the same exact-match tasklist query as
;   electron-builder's own FIND_PROCESS — each one takes ~0.3 s, hence 20
;   rounds of it plus 250 ms); taskkill only deals with whatever is left.
!macro customCheckAppRunning
  ${if} ${isUpdated}
    StrCpy $R1 0
    ${do}
      nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
      Pop $R0
      ${if} $R0 != 0
        ${break}
      ${endif}
      Sleep 250
      IntOp $R1 $R1 + 1
    ${loopuntil} $R1 >= 20
  ${endif}
  nsExec::Exec `taskkill /F /IM "${APP_EXECUTABLE_FILENAME}"`
  Pop $0
  Sleep 500
!macroend

; Fix, part 2 — customUnInstallCheck / customUnInstallCheckCurrentUser:
;   When updating, the new installer silently runs the *old* uninstaller to
;   clear the previous install.  Old versions (built before this fix) still
;   have the original _CHECK_APP_RUNNING; if that check produces a false
;   positive it exits non-zero, and the new installer's handleUninstallResult
;   would otherwise Quit with "uninstall failed".  These hooks return
;   immediately, skipping that error gate, so the new installer continues
;   and overwrites whatever old files remain on disk.
!macro customUnInstallCheck
!macroend
!macro customUnInstallCheckCurrentUser
!macroend

; The assisted installer has no Welcome page by default — it jumps straight to
; "install for me or everyone", which wastes the branded sidebar image
; (build/installerSidebar.bmp) on the Finish page alone. Opting in here via the
; documented customWelcomePage hook gives the sidebar its intended first
; impression and adds a page that matches every other string in this installer
; in being German (NSIS auto-selects its built-in language pack from the OS
; language — no messages.yml override needed for the stock strings, but this
; custom page's own text has to be written by hand).
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Willkommen beim Sooskasse-FinTS-Setup"
  !define MUI_WELCOMEPAGE_TEXT "Dieser Assistent installiert Sooskasse-FinTS auf diesem Computer.$\r$\n$\r$\nKlicke auf „Weiter“, um fortzufahren."
  !insertmacro MUI_PAGE_WELCOME
!macroend
