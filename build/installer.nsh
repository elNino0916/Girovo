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
;   Silently kill every Sooskasse-FinTS.exe process with taskkill /F /T so
;   any orphaned server child is cleaned up, then continue without prompting
;   the user.  taskkill exits 128 when nothing was found, which is fine.
;   A brief Sleep lets Windows release file locks before we write to $INSTDIR.
!macro customCheckAppRunning
  nsExec::Exec `taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T`
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
