# MT-Media code signing

Girovo's Windows programs are signed with MT-Media's own code-signing
certificate. This page covers what that certificate is, what installing it
on a PC changes, how builds get signed and what to do when it expires or
leaks.

## The certificate

| | |
|---|---|
| Subject | CN=MT-Media, O=MT-Media, OU=Software Development, L=Mömlingen, S=Bayern, C=DE |
| Key | RSA 3072, signed with SHA-256 |
| Use | Code Signing only (EKU 1.3.6.1.5.5.7.3.3), key usage Digital Signature |
| Basic constraints | end entity (not a CA), marked critical |
| Valid | 2026-11-14 to 2028-11-14 |
| Thumbprint (SHA-1) | `07995B7408F1482085F8DC239DEC4294F0CAF149` |
| Fingerprint (SHA-256) | `0F12F14D595982FF1B017F860169A51EBD464CEAA60230E04192B7E2E0895AB5` |

The public part is in the repository at
`src-tauri/cert-helper/MT-Media-CodeSigning.cer` and compiled into Girovo.
The private key (`MT-Media-CodeSigning.pfx`) exists in two places only: the
owner's PC (`Cert:\CurrentUser\My`, plus a password-protected backup outside
the repository) and the `signing` environment on GitHub. It must never be in
the repository, the app, the installer, an update or a release asset: anyone
holding it can sign programs that every PC with the certificate installed
accepts as MT-Media's.

### Why it is self-signed

A certificate from a public certification authority would be trusted by
every Windows PC without any installing, but it needs a verified company
and costs money every year. MT-Media issued this one itself. Windows
therefore trusts it only on PCs where someone installed it on purpose. On
every other PC a signed Girovo shows the signature in the file's
properties, but Windows reports the publisher as unverified.

Because the certificate is an end entity and allows Code Signing only,
putting it into the trusted root store does not let it vouch for other
certificates: what it can sign is code, with this one key.

## Installing it (optional)

In Girovo on Windows: **Einstellungen → Sicherheit → Signatur →
MT-Media-Zertifikat → Zertifikat installieren.** The dialog explains
what installing means and shows the fingerprint. After the confirmation
Windows asks for administrator rights (UAC), and `girovo-cert.exe` adds the
certificate to:

- `LocalMachine\Root`, so the signature's chain ends in a trusted root;
- `LocalMachine\TrustedPublisher`, so Windows treats MT-Media as a trusted publisher.

Both stores belong to the whole machine, so the certificate applies to every
user of that PC. Girovo then reads the stores again and reports success only
when Windows confirms the certificate is there and trusted for code signing.

What changes afterwards:

- The file properties of Girovo's programs show a valid MT-Media signature.
- The download warning ("Open File – Security Warning") names MT-Media as the publisher.
- A signed program that asks for administrator rights shows "Verified
  publisher: MT-Media" in its UAC prompt. Girovo itself installs per user
  and never asks, so the UAC prompt you are most likely to see it in is
  the one for removing the certificate again.

What does not change: SmartScreen and antivirus products judge by
reputation and their own rules, not by a self-signed certificate. They may
still warn about or flag Girovo.

Girovo never installs the certificate by itself, neither during setup nor
during an update.

### Removing it

The same page: **Zertifikat entfernen.** Windows asks for administrator
rights, and `girovo-cert.exe` deletes the certificate with exactly this
thumbprint from both stores. No other certificate is touched. Girovo keeps
working as before. Windows just stops recognising MT-Media as the publisher.

By hand, in an elevated PowerShell:

```powershell
$t = '07995B7408F1482085F8DC239DEC4294F0CAF149'
Remove-Item "Cert:\LocalMachine\Root\$t", "Cert:\LocalMachine\TrustedPublisher\$t"
```

### What the status means

| Status | Meaning |
|---|---|
| Optional, damit Windows MT-Media als Herausgeber erkennt | in neither store (the dialog says "Zertifikat nicht installiert") |
| Installiert, Windows vertraut MT-Media | in both stores, and Windows builds a valid chain for code signing |
| Installiert, aber Windows vertraut ihm nicht | in only one store, in a Disallowed store, or Windows rejects the chain |
| Abgelaufen | the certificate's validity has ended |
| Ein anderes MT-Media-Zertifikat ist installiert | a certificate named MT-Media with another thumbprint is installed and this one is not |

### How the helper is kept small and strict

`girovo-cert.exe` (`src-tauri/cert-helper`) is a separate program of about
120 KB, with no window and no Tauri. Its manifest asks for administrator
rights, so Windows always shows UAC before it runs. It takes one word,
`install` or `remove`, and no path. The certificate bytes are compiled in
and must pass `identity::check` first: exact thumbprint, exact subject,
Code Signing as the only extended use, end entity. It never touches a
private key, never changes a Windows setting and reports only an exit code.
Girovo then reads the stores itself (`src-tauri/src/publisher_cert.rs`).

## Signing builds

Signing uses Microsoft's SignTool (Authenticode): a SHA-256 file digest, an
RFC 3161 timestamp with a SHA-256 digest (DigiCert's server, Sectigo's as a
second), and the certificate found by thumbprint in `Cert:\CurrentUser\My`.
`scripts/sign-windows.mjs` does the signing. After each signature it checks
the file with `signtool verify /pa` and `Get-AuthenticodeSignature`: the
signer must be this certificate, and the timestamp must be there. A file
that fails either check, or that could not be timestamped, fails the build.
Every file gets one line in `dist/signing-log.jsonl` with its name, SHA-256,
thumbprint, publisher, result and timestamp.

What gets signed, in order: `Girovo.exe`, `girovo-update.exe`,
`girovo-cert.exe` and the uninstaller, before NSIS packs them; then the
installer `Girovo-<version>-Setup.exe`. Tauri's bundler does this through
its `signCommand`, which `scripts/dist-desktop.mjs --sign` hands to it in a
temporary config file. The committed `tauri.conf.json` never signs, so a
build without `--sign` is exactly the unsigned build. The blockmap and the
update manifest are made after signing, so their hashes are those of the
signed installer.

### On the owner's PC

```bash
node scripts/sign-windows.mjs --check     # SignTool there, certificate with key in CurrentUser\My?
npm run desktop:dist -- --sign            # build, sign, check: dist/Girovo-<version>-Setup.exe
node scripts/sign-windows.mjs --sign dist/release-7.0.0     # sign Girovo's release files in a folder
node scripts/sign-windows.mjs --verify dist/release-7.0.0   # check them, sign nothing
```

`--sign` and `--verify` accept only Girovo's own file names
(`Girovo-*-Setup.exe`, `Girovo*.msi`, `Girovo.exe`, `girovo-update.exe`,
`girovo-cert.exe`) in the folders you give. Everything else in those folders
is left alone. Tauri's `signCommand` signs only files inside this checkout,
the temp folder (the uninstaller) and Tauri's own NSIS folder.

If the certificate is missing from `CurrentUser\My`, import the backup:

```powershell
Import-PfxCertificate -FilePath <backup>\MT-Media-CodeSigning.pfx -CertStoreLocation Cert:\CurrentUser\My
```

PowerShell asks for the PFX password itself.

### On GitHub

The private key is in the repository's `signing` environment as two secrets:
`MT_MEDIA_PFX_BASE64` (the PFX, base64) and `MT_MEDIA_PFX_PASSWORD`. The
environment needs the owner's approval for every run and accepts runs from
`main` only. Both workflows run from `main`.

The Windows build is split so that no third-party package runs next to the
key:

1. The build job (`npm ci`, cargo, no secrets) builds the programs only:
   `dist-desktop.mjs --no-bundle`. It uploads `Girovo.exe`, the two helpers,
   ONNX Runtime, the category model and `package.json`.
2. The signing job (`environment: signing`) checks out the same commit and
   downloads those programs. It installs the Tauri CLI alone into a temp
   folder (`--ignore-scripts`), with no `npm ci` and no cargo build.
   `scripts/ci-signing-cert.ps1 import` puts the key into the runner's
   `CurrentUser\My` (not exportable) and the public certificate into the
   runner's Root and TrustedPublisher, so the checks can pass. Then
   `dist-desktop.mjs --bundle-only --sign` packs and signs, and the step
   `ci-signing-cert.ps1 forget` takes the key out again. The signing log is
   kept as an artifact for 30 days.

Which runs sign:

- `nightly.yml` started by hand (nightly, Next, preview), on a branch that
  has `scripts/sign-windows.mjs`. Scheduled nights build unsigned, so a night
  never waits for an approval.
- `build-development.yml` with `release=true`, the stable release build.
  Development builds of every push stay unsigned.

Branches without `scripts/sign-windows.mjs` (5.x, 6.x) build as before.

#### Setting up the environment (once)

Repository → Settings → Environments → New environment `signing`:

- Required reviewers: the owner.
- Deployment branches and tags: selected, `main`.
- Secrets: `MT_MEDIA_PFX_BASE64` and `MT_MEDIA_PFX_PASSWORD`.

In a terminal, from the folder with the PFX:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\MT-Media-CodeSigning.pfx")) | gh secret set MT_MEDIA_PFX_BASE64 --env signing
gh secret set MT_MEDIA_PFX_PASSWORD --env signing    # gh asks for the value; type the PFX password
```

## The updater

An update is checked before anything runs it, signed or not: the installer's
SHA-256 must match the update manifest, and the manifest must carry a valid
Ed25519 signature from Girovo's update keys (`docs/updater-v2.md`).
`girovo-update.exe` checks the hash once more right before it starts the
installer. Requiring the Authenticode signature as well would break every
PC without the certificate, where Windows reports a self-signed signature as
untrusted, and every unsigned nightly. So the updater does not require it.

## Checking a signature by hand

```powershell
Get-AuthenticodeSignature .\Girovo-7.0.0-Setup.exe | Format-List Status, SignerCertificate, TimeStamperCertificate
& "C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe" verify /pa /v .\Girovo-7.0.0-Setup.exe
```

The signer's thumbprint must be `07995B7408F1482085F8DC239DEC4294F0CAF149`.
On a PC without the certificate installed, `Status` is `UnknownError` and
SignTool reports an untrusted root. The signature is still intact. Windows
just does not trust its issuer. Right-click → Properties → Digital
Signatures shows the same thing.

## Expiry and renewal

The certificate is valid until **2028-11-14**. Signatures made before then
stay valid after it, because each carries an RFC 3161 timestamp. Before it
expires:

1. Make a new certificate (same subject, RSA 3072, Code Signing, end entity).
2. Put its `.cer` at `src-tauri/cert-helper/MT-Media-CodeSigning.cer` and
   update `THUMBPRINT`, `THUMBPRINT_HEX` and `SHA256_HEX` in
   `cert-helper/src/identity.rs`, `THUMBPRINT` in `scripts/sign-windows.mjs`
   and `scripts/ci-signing-cert.ps1`.
3. Add the old thumbprint to `EARLIER` in `identity.rs`. Installing the new
   certificate then removes the old one, and only that one.
4. Replace the two secrets in the `signing` environment and the certificate
   in `CurrentUser\My`.
5. PCs with the old certificate see "Ein anderes MT-Media-Zertifikat ist
   installiert" or "Abgelaufen" and can install the new one from the same page.

## If the private key leaks

1. Delete the two secrets from the `signing` environment at once, and the
   certificate from `CurrentUser\My` on every machine that has it.
2. Tell users who installed the certificate to remove it (Einstellungen →
   Sicherheit, or the PowerShell lines above), say why on girovo.de, and
   ship a release that marks the old certificate as no longer trusted.
3. Make a new certificate as under renewal, and sign the next release with it.
4. Anything signed with the old key after the leak must be treated as not
   from MT-Media, even though its signature looks valid.

Girovo's updates do not depend on this certificate. They are protected by
the Ed25519 update keys, so a leaked code-signing key cannot push an update
to anyone.
