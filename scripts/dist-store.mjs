// Builds Girovo for the Microsoft Store: dist/Girovo-<version>-x64.msix
// (docs/microsoft-store.md).
//
// The same program as the Setup.exe's (scripts/dist-desktop.mjs), packaged
// as an MSIX instead: the category model, the page and its runtime, then
// `tauri build` without Tauri's bundles; the program and its resources go
// into a folder with an AppxManifest.xml and the Store's logos, which
// makeappx.exe (Windows SDK) packs. The package is left unsigned: the Store
// signs what it accepts. Run from that package, the app knows it is the
// Store's (src-tauri/src/store.rs) and leaves updates to the Store.
//
// The package identity comes from Partner Center (Produktidentität) and is
// kept in src-tauri/msix/identity.json; the version is package.json's with a
// fourth part of 0, as the Store asks. Only a release is packaged: a
// nightly's version is no Store version.
//
// Usage (on Windows, with the Windows SDK):
//   node scripts/dist-store.mjs                  build, then package
//   node scripts/dist-store.mjs --skip-build     package the last build again
//   node scripts/dist-store.mjs --test-sign      also sign it with a self-made
//                                                certificate, to install it here first
//   node scripts/dist-store.mjs --identity <file> another identity.json (a test one)

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TAURI = path.join(ROOT, 'src-tauri');
const DIST = path.join(ROOT, 'dist');
const STAGE = path.join(DIST, 'msix');
const RELEASE = path.join(TAURI, 'target', 'release');
const SKIP_BUILD = process.argv.includes('--skip-build');
const TEST_SIGN = process.argv.includes('--test-sign');

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (process.platform !== 'win32') fail('the MSIX is built on Windows (makeappx.exe of the Windows SDK)');

const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(VERSION)) fail(`${VERSION} is no release: the Store takes only versions like 6.3.0`);
const MSIX_VERSION = `${VERSION}.0`;

const identityAt = process.argv.indexOf('--identity');
const identityFile = identityAt === -1 ? path.join(TAURI, 'msix', 'identity.json') : path.resolve(process.argv[identityAt + 1]);
const identity = JSON.parse(fs.readFileSync(identityFile, 'utf8'));
for (const key of ['name', 'publisher', 'publisherDisplayName', 'displayName']) {
  if (!identity[key] || String(identity[key]).includes('<')) {
    fail(`src-tauri/msix/identity.json: "${key}" is not filled in yet (Partner Center → Girovo → Produktidentität)`);
  }
}

function run(cmd, args, opts = {}) {
  console.log(`› ${path.basename(cmd)} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: cmd === 'npx', ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/** The newest x64 tool of the Windows SDK named `exe`. */
function sdkTool(exe) {
  const base = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin');
  const versions = fs.existsSync(base) ? fs.readdirSync(base).filter((v) => /^10\./.test(v)) : [];
  versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const v of versions) {
    const tool = path.join(base, v, 'x64', exe);
    if (fs.existsSync(tool)) return tool;
  }
  fail(`${exe} not found: install the Windows SDK (winget install Microsoft.WindowsSDK.10.0.26100)`);
}

// ---- the program ---------------------------------------------------------------

if (!SKIP_BUILD) {
  const { fetchModel } = await import('./fetch-model.mjs');
  await fetchModel();
  run(process.execPath, [path.join(ROOT, 'scripts', 'build-desktop.mjs')]);
  run('npx', ['tauri', 'build', '--no-bundle']);
}

const conf = JSON.parse(fs.readFileSync(path.join(TAURI, 'tauri.conf.json'), 'utf8'));
const exeName = `${conf.mainBinaryName || conf.productName}.exe`;
const exe = path.join(RELEASE, exeName);
if (!fs.existsSync(exe)) fail(`no ${path.relative(ROOT, exe)}: build first (without --skip-build)`);

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
fs.copyFileSync(exe, path.join(STAGE, exeName));

// The resources, where Tauri's bundles put them: beside the program, under
// the names tauri.conf.json gives them. girovo-update.exe (externalBin) stays
// out: it only installs the Setup.exe's updates.
for (const [from, to] of Object.entries(conf.bundle.resources || {})) {
  const src = path.resolve(TAURI, from);
  if (!fs.existsSync(src)) fail(`resource ${from} is missing: build first (without --skip-build)`);
  fs.cpSync(src, path.join(STAGE, to), { recursive: true });
}

// ---- the logos -------------------------------------------------------------------

// From build/icon.png (scripts/build-brand-assets.mjs), the sizes an MSIX
// names, each at scale 100 and 200; makepri is not needed for plain names,
// so the scale-200 files only serve the Store's own listing.
const ICON = path.join(ROOT, 'build', 'icon.png');
const ASSETS = path.join(STAGE, 'Assets');
fs.mkdirSync(ASSETS, { recursive: true });
const logos = {
  'StoreLogo.png': [50, 50],
  'Square44x44Logo.png': [44, 44],
  'Square150x150Logo.png': [150, 150],
  'Wide310x150Logo.png': [310, 150],
  'Square310x310Logo.png': [310, 310],
};
for (const [name, [w, h]] of Object.entries(logos)) {
  const side = Math.min(w, h);
  const mark = await sharp(ICON).resize(side, side).png().toBuffer();
  await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: mark, gravity: 'centre' }])
    .png()
    .toFile(path.join(ASSETS, name));
}
// The taskbar and the Start list take the 44 one without its plate (altform-unplated).
await sharp(ICON).resize(44, 44).png().toFile(path.join(ASSETS, 'Square44x44Logo.targetsize-44_altform-unplated.png'));

// ---- the manifest -----------------------------------------------------------------

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const description = identity.description || conf.bundle.shortDescription || identity.displayName;
const manifest = `<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap rescap">
  <Identity Name="${xml(identity.name)}" Publisher="${xml(identity.publisher)}" Version="${MSIX_VERSION}" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>${xml(identity.displayName)}</DisplayName>
    <PublisherDisplayName>${xml(identity.publisherDisplayName)}</PublisherDisplayName>
    <Logo>Assets\\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources>
    <Resource Language="de-DE" />
    <Resource Language="en-US" />
  </Resources>
  <Applications>
    <Application Id="Girovo" Executable="${xml(exeName)}" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="${xml(identity.displayName)}"
        Description="${xml(description)}"
        BackgroundColor="transparent"
        Square150x150Logo="Assets\\Square150x150Logo.png"
        Square44x44Logo="Assets\\Square44x44Logo.png">
        <uap:DefaultTile Wide310x150Logo="Assets\\Wide310x150Logo.png" Square310x310Logo="Assets\\Square310x310Logo.png" />
      </uap:VisualElements>
    </Application>
  </Applications>
  <Capabilities>
    <Capability Name="internetClient" />
    <Capability Name="privateNetworkClientServer" />
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
`;
fs.writeFileSync(path.join(STAGE, 'AppxManifest.xml'), manifest);

// ---- pack (and sign for a test) -------------------------------------------------

fs.mkdirSync(DIST, { recursive: true });
const out = path.join(DIST, `Girovo-${VERSION}-x64.msix`);
fs.rmSync(out, { force: true });
run(sdkTool('makeappx.exe'), ['pack', '/d', STAGE, '/p', out, '/o']);

if (TEST_SIGN) {
  // A certificate of this machine's own, whose subject is the package's
  // publisher: Windows installs the package once the certificate is trusted
  // (docs/microsoft-store.md, "Vorher hier testen"). The Store's own package
  // is signed by the Store; this one never goes there.
  const pfx = path.join(DIST, 'girovo-store-test.pfx');
  const cer = path.join(DIST, 'girovo-store-test.cer');
  if (!fs.existsSync(pfx)) {
    const ps = [
      `$c = New-SelfSignedCertificate -Type Custom -Subject '${identity.publisher.replace(/'/g, "''")}'`,
      `-KeyUsage DigitalSignature -FriendlyName 'Girovo Store test' -CertStoreLocation 'Cert:\\CurrentUser\\My'`,
      `-TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}');`,
      `$p = ConvertTo-SecureString -String 'girovo' -Force -AsPlainText;`,
      `Export-PfxCertificate -Cert $c -FilePath '${pfx}' -Password $p | Out-Null;`,
      `Export-Certificate -Cert $c -FilePath '${cer}' | Out-Null`,
    ].join(' ');
    run('powershell.exe', ['-NoProfile', '-Command', ps]);
  }
  run(sdkTool('signtool.exe'), ['sign', '/fd', 'SHA256', '/f', pfx, '/p', 'girovo', out]);
  console.log(`✓ signed for a test: trust ${path.relative(ROOT, cer)} once (Lokaler Computer → Vertrauenswürdige Personen), then open the .msix`);
}

const mb = (fs.statSync(out).size / 1048576).toFixed(0);
console.log(`✓ ${path.relative(ROOT, out)}  ${mb} MB  (${identity.name} ${MSIX_VERSION})`);
