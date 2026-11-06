; Girovo's hooks into Tauri's NSIS installer (tauri.conf.json,
; bundle.windows.nsis.installerHooks). 6.0 is the first Tauri version: it
; replaces the Electron app in place, and an update to it is started by the
; Electron app's own updater (electron/updater.cjs: `/S --updated --force-run`).
;
; Install:   the Electron app's silent uninstaller first — it keeps the data
;            in %APPDATA% (it deletes it only when told to) — after the Electron
;            app had its moment to quit; then Girovo goes where it was, under
;            %LOCALAPPDATA%\Programs, so taskbar pins, shortcuts and the start
;            with Windows still name the right Girovo.exe. `--force-run`
;            starts the new version, as the Electron installer did.
; Uninstall: the start with Windows goes too, and with "delete the app's data"
;            ticked, Girovo's own data folders — the template only knows
;            folders named after the bundle id, which Girovo's are not.

!define GIROVO_ELECTRON_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\d9e7f93b-a8ce-5852-b6dc-dd552e8c0f46"
!define GIROVO_RUN_NAME "de.elnino0916.sooskasse-fints"

; $R9: the path between the quotes at the start of $R8 (an UninstallString).
!macro GIROVO_QUOTED_PATH
  StrCpy $R9 ""
  StrCpy $R7 $R8 1
  ${If} $R7 == '"'
    StrCpy $R6 1
    ${Do}
      StrCpy $R7 $R8 1 $R6
      ${If} $R7 == '"'
      ${OrIf} $R7 == ""
        ${ExitDo}
      ${EndIf}
      IntOp $R6 $R6 + 1
    ${Loop}
    IntOp $R6 $R6 - 1
    StrCpy $R9 $R8 $R6 1
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $R8 HKCU "${GIROVO_ELECTRON_KEY}" "UninstallString"
  ${If} $R8 != ""
    !insertmacro GIROVO_QUOTED_PATH
    ${If} ${FileExists} "$R9"
      ${GetParent} "$R9" $R5
      ; The Electron app quits right after starting this installer (ending
      ; the bank session); it gets up to 15 s before its uninstaller would
      ; close it by force.
      StrCpy $R4 0
      ${Do}
        nsis_tauri_utils::FindProcess "Girovo.exe"
        Pop $R3
        ${If} $R3 != 0
        ${OrIf} $R4 >= 30
          ${ExitDo}
        ${EndIf}
        Sleep 500
        IntOp $R4 $R4 + 1
      ${Loop}
      ; _?= keeps it in place, so it is done before a file is copied; no
      ; --updated, whose atomic move of the folder fails with the uninstaller in it.
      ExecWait '"$R9" /currentuser /S --keep-shortcuts _?=$R5'
      Delete "$R9"
      ${If} $INSTDIR == "$LOCALAPPDATA\${PRODUCTNAME}"
        StrCpy $INSTDIR $R5
      ${EndIf}
    ${EndIf}
    DeleteRegKey HKCU "${GIROVO_ELECTRON_KEY}"
  ${EndIf}
  ; Every Girovo lives under Programs, as the Electron one did.
  ${If} $INSTDIR == "$LOCALAPPDATA\${PRODUCTNAME}"
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${PRODUCTNAME}"
  ${EndIf}
  SetOutPath $INSTDIR
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; The Electron app's updater asked for the new version to start
  ; (`--force-run`). The Tauri one passes /R as well, which the template's own
  ; .onInstSuccess answers: started once, not twice.
  ${GetOptions} $CMDLINE "--force-run" $R0
  ${IfNot} ${Errors}
    ${GetOptions} $CMDLINE "/R" $R0
    ${If} ${Errors}
      nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" "--updated"
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${GIROVO_RUN_NAME}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    SetShellVarContext current
    RmDir /r "$APPDATA\Girovo"
    RmDir /r "$APPDATA\Sooskasse-FinTS"
  ${EndIf}
!macroend
