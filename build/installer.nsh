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

; Girovo spawns its Next.js server as its own executable re-executed with
; ELECTRON_RUN_AS_NODE=1 (see electron/main.cjs) — so two processes named
; Girovo.exe exist under $INSTDIR while the app is open, not one.
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
;   Silently kill every Girovo.exe process with taskkill /F, then
;   continue without prompting the user. The image name matches the server
;   child (and Electron's helper processes) as well, so an orphaned server is
;   cleaned up too. taskkill exits 128 when nothing was found, which is fine.
;   A brief Sleep lets Windows release file locks before we write to $INSTDIR.
;
;   Deliberately no /T: that also kills every *descendant* of a matching
;   process, whatever its name — and an installer started by the app's own
;   updater (electron/updater.cjs) is exactly that, a child of
;   Girovo.exe. With /T the installer would take itself down.
;
;   --updated is that updater's flag. The app quits right after starting the
;   installer: it closes the window, ends the bank session and stops its
;   server, and it should be left to finish that rather than be killed in the
;   middle of writing its preferences. So under --updated the installer first
;   waits, about ten seconds at most, for the user's Girovo.exe processes
;   to be gone (exact-match tasklist queries like electron-builder's own
;   FIND_PROCESS); taskkill only deals with whatever is left.
;
;   Both steps also cover LEGACY_EXECUTABLE_FILENAME. Up to 4.3 the app was
;   called Sooskasse-FinTS, so the update to Girovo is started by a
;   Sooskasse-FinTS.exe that is still closing — the new name has no process
;   yet. One tasklist per name, each filtered by image name too: the user
;   filter alone has to look up the owner of every process on the machine,
;   which took over 40 s. One round, both queries and the 250 ms, is about
;   0.75 s, hence 13 of them.
!ifndef LEGACY_EXECUTABLE_FILENAME
  !define LEGACY_EXECUTABLE_FILENAME "Sooskasse-FinTS.exe"
!endif
!macro customCheckAppRunning
  ${if} ${isUpdated}
    StrCpy $R1 0
    ${do}
      nsExec::Exec `"$SYSDIR\cmd.exe" /C (tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH & tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${LEGACY_EXECUTABLE_FILENAME}" /FO CSV /NH) | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\"" /C:"\"${LEGACY_EXECUTABLE_FILENAME}\""`
      Pop $R0
      ${if} $R0 != 0
        ${break}
      ${endif}
      Sleep 250
      IntOp $R1 $R1 + 1
    ${loopuntil} $R1 >= 13
  ${endif}
  nsExec::Exec `taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /IM "${LEGACY_EXECUTABLE_FILENAME}"`
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

; customInstall — a copy of this very installer goes into the install, as
;   resources\update-base.bin. The app's updater (electron/updater.cjs) builds
;   the next version's installer from it: it compares the two releases'
;   blockmaps and downloads only the chunks this one does not have, a few MB
;   instead of ~110. The copy goes wherever the install goes — per user or per
;   machine — always matches the installed version, and the next update's
;   uninstall step removes it with everything else. If the copy fails, the
;   next update is simply a whole download, so nothing here is checked.
;   (.bin: it is read for its bytes, never run from there.)
!macro customInstall
  CopyFiles /SILENT "$EXEPATH" "$INSTDIR\resources\update-base.bin"
!macroend

; The installer speaks the app's two languages, German on a German Windows and
; English on any other — the rule the app itself follows until the user picks
; one (electron/i18n.cjs). electron-builder.yml (nsis.installerLanguages) loads
; just those two; NSIS then picks one from the Windows display language before
; the first page shows, so there is no language dialog. A German variant
; (Austria, Switzerland) gets German. Any other language gets the first one
; loaded, English: en_US is listed first, and electron-builder's own messages
; (messages.yml, "en must be first") create the English table before any
; other.
;
; The built-in pages and electron-builder's messages come in both languages.
; A text written here has to as well: a LangString per language, which the
; page names as $(…).

; customHeader — where those LangStrings are defined. electron-builder inserts
;   it right after the languages are loaded (installer.nsi: addLangs, then
;   customHeader), so ${LANG_GERMAN} and ${LANG_ENGLISH} exist by then. Not at
;   the top of this file: electron-builder includes it before its own
;   messages, and a LangString there would create its language's table first
;   — German first would make German the fallback for every other language.
;   The welcome page comes earlier in the script (assistedInstaller.nsh) and
;   names the texts before they are defined, which NSIS allows — it is how
;   MUI's own page texts work, defined only by MUI_LANGUAGE. A text missing in
;   one language fails the build: makensis warns about it, and
;   electron-builder runs it with warnings as errors (-WX). The uninstaller
;   shows none of these texts.
;
;   Checked against electron-builder 26.15's generated script and its NSIS
;   3.0.4.1: two language tables; a test build in the same order picked German
;   for de-DE, de-AT and de-CH, English for en-US, en-GB, fr-FR, ru-RU, ja-JP.
!macro customHeader
  !ifndef BUILD_UNINSTALLER
    LangString girovoWelcomeTitle ${LANG_GERMAN} "Willkommen beim Girovo-Setup"
    LangString girovoWelcomeTitle ${LANG_ENGLISH} "Welcome to the Girovo setup"
    LangString girovoWelcomeText ${LANG_GERMAN} "Dieser Assistent installiert Girovo auf diesem Computer.$\r$\n$\r$\nKlicke auf „Weiter“, um fortzufahren."
    LangString girovoWelcomeText ${LANG_ENGLISH} "This wizard will install Girovo on this computer.$\r$\n$\r$\nClick “Next” to continue."
  !endif
!macroend

; customWelcomePage — the assisted installer has no Welcome page by default: it
;   jumps straight to "install for me or everyone", which wastes the branded
;   sidebar image (build/installerSidebar.bmp) on the Finish page alone. Opting
;   in here via the documented hook gives the sidebar its intended first
;   impression; its title and text are the two LangStrings above.
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "$(girovoWelcomeTitle)"
  !define MUI_WELCOMEPAGE_TEXT "$(girovoWelcomeText)"
  !insertmacro MUI_PAGE_WELCOME
!macroend
