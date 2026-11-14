# The MT-Media code-signing certificate on a GitHub runner, for the signing
# jobs of .github/workflows/nightly.yml and build-development.yml only
# (docs/mt-media-code-signing.md).
#
#   import   the PFX from the `signing` environment's secrets
#            (MT_MEDIA_PFX_BASE64, MT_MEDIA_PFX_PASSWORD) into
#            Cert:\CurrentUser\My, its key not exportable, and the public
#            certificate into this runner's Root and TrustedPublisher, so that
#            `signtool verify /pa` and Get-AuthenticodeSignature accept it.
#            The PFX file exists for the moment of the import only.
#   forget   the certificate and its key out of Cert:\CurrentUser\My again.
#
# Refuses a PFX that holds anything but the expected certificate with its key.

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('import', 'forget')]
  [string]$Action
)

$ErrorActionPreference = 'Stop'
$Thumbprint = '07995B7408F1482085F8DC239DEC4294F0CAF149'
$Cer = Join-Path $PSScriptRoot '..\src-tauri\cert-helper\MT-Media-CodeSigning.cer'

function Forget {
  Get-ChildItem Cert:\CurrentUser\My | Where-Object Thumbprint -eq $Thumbprint | ForEach-Object {
    Remove-Item -LiteralPath $_.PSPath -DeleteKey
  }
}

if ($Action -eq 'forget') {
  Forget
  Write-Host 'MT-Media certificate removed from this runner.'
  exit 0
}

if (-not $env:MT_MEDIA_PFX_BASE64 -or -not $env:MT_MEDIA_PFX_PASSWORD) {
  throw 'The signing environment has no MT_MEDIA_PFX_BASE64 or MT_MEDIA_PFX_PASSWORD secret (docs/mt-media-code-signing.md).'
}

$temp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$pfx = Join-Path $temp ([guid]::NewGuid().ToString('N') + '.pfx')
try {
  [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:MT_MEDIA_PFX_BASE64))
  $password = ConvertTo-SecureString $env:MT_MEDIA_PFX_PASSWORD -AsPlainText -Force
  $imported = @(Import-PfxCertificate -FilePath $pfx -CertStoreLocation Cert:\CurrentUser\My -Password $password)
} finally {
  Remove-Item -LiteralPath $pfx -Force -ErrorAction SilentlyContinue
}

$others = @($imported | Where-Object Thumbprint -ne $Thumbprint)
$mine = $imported | Where-Object Thumbprint -eq $Thumbprint | Select-Object -First 1
if ($others.Count -gt 0 -or -not $mine) {
  foreach ($c in $imported) { Remove-Item -LiteralPath "Cert:\CurrentUser\My\$($c.Thumbprint)" -DeleteKey -ErrorAction SilentlyContinue }
  throw "The PFX must hold exactly the MT-Media certificate $Thumbprint; it held: $(($imported | ForEach-Object Thumbprint) -join ', ')"
}
if (-not $mine.HasPrivateKey) {
  Forget
  throw 'The PFX holds the MT-Media certificate but no private key.'
}

Import-Certificate -FilePath $Cer -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
Import-Certificate -FilePath $Cer -CertStoreLocation Cert:\LocalMachine\TrustedPublisher | Out-Null
Write-Host "MT-Media certificate $Thumbprint imported for this job (key not exportable)."
