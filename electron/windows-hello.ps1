# Windows Hello for Girovo's desktop shell. electron/windows-hello.cjs runs
# this with -File, writes one JSON line to its stdin and reads one JSON line
# back; it keeps nothing itself.
#
# It works with this user account's Windows Hello key for Girovo (a
# KeyCredential, held by the TPM where there is one): creating the key and
# signing with it both ask for the face, the fingerprint or the Windows Hello
# PIN. The shell derives its key from the signature, which only that gesture
# brings about.
#
#   {"op":"probe"}                                  → {"supported":true}
#   {"op":"create","name","challenge","window"}     → {"status","publicKey","signature"}
#   {"op":"sign","name","challenge","window"}       → {"status","signature"}
#   {"op":"delete","name"}                          → {"status"}
#
# `window` is Girovo's window handle: where Windows has the ...ForWindowAsync
# calls (Windows 11 24H2 and later), its prompt opens over that window.
# Elsewhere the plain calls open it on its own, often behind Girovo, and it is
# brought to the front by its window class, as Chromium does
# (crypto/user_verifying_key_win.cc).

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Out-Answer($value) {
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $value -Compress))
}

try {
  $request = [Console]::In.ReadLine() | ConvertFrom-Json

  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $manager = [Windows.Security.Credentials.KeyCredentialManager, Windows.Security.Credentials, ContentType = WindowsRuntime]
  $credentialType = [Windows.Security.Credentials.KeyCredential, Windows.Security.Credentials, ContentType = WindowsRuntime]
  $retrieval = [Windows.Security.Credentials.KeyCredentialRetrievalResult, Windows.Security.Credentials, ContentType = WindowsRuntime]
  $operation = [Windows.Security.Credentials.KeyCredentialOperationResult, Windows.Security.Credentials, ContentType = WindowsRuntime]
  $replace = [Windows.Security.Credentials.KeyCredentialCreationOption]::ReplaceExisting
  $buffers = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions]

  # IAsyncOperation<T> and IAsyncAction as .NET tasks.
  $operationName = 'IAsyncOperation' + [char]96 + '1'
  $extensions = [System.WindowsRuntimeSystemExtensions].GetMethods()
  $asTaskOf = $extensions | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq $operationName
  } | Select-Object -First 1
  $asTaskAction = $extensions | Where-Object {
    $_.Name -eq 'AsTask' -and -not $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction'
  } | Select-Object -First 1

  # Over Girovo's window where Windows can, else brought to the front.
  $windowId = $null
  if ($request.window -and $null -ne $manager.GetMethod('RequestCreateForWindowAsync') -and
      $null -ne $credentialType.GetMethod('RequestSignForWindowAsync')) {
    $null = [Windows.UI.WindowId, Windows.UI, ContentType = WindowsRuntime]
    $windowId = New-Object Windows.UI.WindowId
    $windowId.Value = [UInt64]$request.window
  }
  $raised = $null -ne $windowId
  if (-not $raised -and ($request.op -eq 'create' -or $request.op -eq 'sign')) {
    Add-Type -Namespace GirovoHello -Name Prompt -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string className, string title);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
'@
  }

  function Wait-Result($asyncOperation, [Type]$resultType) {
    $task = $asTaskOf.MakeGenericMethod($resultType).Invoke($null, @($asyncOperation))
    while (-not $task.Wait(100)) {
      if (-not $script:raised) {
        $prompt = [GirovoHello.Prompt]::FindWindow('Credential Dialog Xaml Host', $null)
        if ($prompt -ne [IntPtr]::Zero) {
          [void][GirovoHello.Prompt]::SetForegroundWindow($prompt)
          $script:raised = $true
        }
      }
    }
    $task.Result
  }

  function Request-Signature($credential) {
    $data = $buffers::AsBuffer([Convert]::FromBase64String($request.challenge))
    if ($null -ne $windowId) {
      Wait-Result ($credential.RequestSignForWindowAsync($windowId, $data)) $operation
    } else {
      Wait-Result ($credential.RequestSignAsync($data)) $operation
    }
  }

  function Out-Signed($signed, $extra) {
    $answer = @{ status = [string]$signed.Status }
    if ($signed.Status -eq 'Success') {
      $answer.signature = [Convert]::ToBase64String($buffers::ToArray($signed.Result))
    }
    foreach ($key in $extra.Keys) { $answer[$key] = $extra[$key] }
    Out-Answer $answer
  }

  switch ($request.op) {
    'probe' {
      Out-Answer @{ supported = [bool](Wait-Result ($manager::IsSupportedAsync()) ([bool])) }
    }
    'create' {
      if ($null -ne $windowId) {
        $created = Wait-Result ($manager::RequestCreateForWindowAsync($windowId, $request.name, $replace)) $retrieval
      } else {
        $created = Wait-Result ($manager::RequestCreateAsync($request.name, $replace)) $retrieval
      }
      if ($created.Status -ne 'Success') {
        Out-Answer @{ status = [string]$created.Status }
        break
      }
      $publicKey = [Convert]::ToBase64String($buffers::ToArray($created.Credential.RetrievePublicKey()))
      Out-Signed (Request-Signature $created.Credential) @{ publicKey = $publicKey }
    }
    'sign' {
      $opened = Wait-Result ($manager::OpenAsync($request.name)) $retrieval
      if ($opened.Status -ne 'Success') {
        Out-Answer @{ status = [string]$opened.Status }
        break
      }
      Out-Signed (Request-Signature $opened.Credential) @{}
    }
    'delete' {
      $task = $asTaskAction.Invoke($null, @($manager::DeleteAsync($request.name)))
      try { $task.Wait() } catch { }
      Out-Answer @{ status = 'Success' }
    }
    default {
      Out-Answer @{ error = 'unknown op' }
    }
  }
} catch {
  Out-Answer @{ error = [string]$_.Exception.GetBaseException().Message }
}
