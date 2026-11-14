// Authenticode signing for Girovo's Windows programs with the MT-Media
// code-signing certificate (docs/mt-media-code-signing.md).
//
// The certificate and its private key come from the Windows certificate
// store (CurrentUser\My, found by thumbprint), never from a file: on the
// owner's PC it is installed there; on GitHub's signing job the workflow
// imports it from the `signing` environment's secrets first. No password is
// ever read here.
//
// Every file is signed with SignTool (SHA-256 file digest, RFC 3161
// timestamp with a SHA-256 digest) and then checked twice, by
// `signtool verify /pa` and by PowerShell's Get-AuthenticodeSignature: the
// signer must be exactly this certificate and the timestamp must be there.
// A timestamp server that fails is retried, then the next one is asked;
// when none answers the file counts as failed (GIROVO_SIGN_ALLOW_NO_TIMESTAMP=1
// signs without one and says so in the log, for local test builds only).
// Each file gets one line in the log (dist/signing-log.jsonl): name, SHA-256,
// thumbprint, publisher, result, timestamp.
//
// Usage:
//   node scripts/sign-windows.mjs <file>              sign one program (Tauri's signCommand, `%1`)
//   node scripts/sign-windows.mjs --sign <paths…>     sign Girovo's release files in these folders/files
//   node scripts/sign-windows.mjs --verify <paths…>   check them, sign nothing
//   node scripts/sign-windows.mjs --check             is SignTool there, and the certificate with its key?
//
// Environment: GIROVO_SIGN_THUMBPRINT, GIROVO_SIGN_TIMESTAMP (one server),
// GIROVO_SIGN_LOG, SIGNTOOL (its path).

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const THUMBPRINT = (process.env.GIROVO_SIGN_THUMBPRINT || '07995B7408F1482085F8DC239DEC4294F0CAF149').replace(/\s/g, '').toUpperCase();
export const PUBLISHER = 'MT-Media';
export const TIMESTAMP_SERVERS = process.env.GIROVO_SIGN_TIMESTAMP
  ? [process.env.GIROVO_SIGN_TIMESTAMP]
  : ['http://timestamp.digicert.com', 'http://timestamp.sectigo.com'];
const ALLOW_NO_TIMESTAMP = process.env.GIROVO_SIGN_ALLOW_NO_TIMESTAMP === '1';
export const LOG = process.env.GIROVO_SIGN_LOG || path.join(ROOT, 'dist', 'signing-log.jsonl');

/**
 * The release files a folder may hold that get signed: the installer, an MSI
 * should one ever be built, the app and its two helpers. Anything else in a
 * folder is left alone.
 */
export const ARTIFACT = /^(Girovo-[\w.+-]+-Setup\.exe|Girovo[\w.+-]*\.msi|Girovo\.exe|girovo-(update|cert)\.exe)$/i;

/** Is this one of Girovo's release files, by its name? */
export function isArtifact(file) {
  return ARTIFACT.test(path.basename(file));
}

/**
 * Where Tauri's build hands files to sign from: this checkout (the app, its
 * helpers, the installer), the temp folder (NSIS writes the uninstaller
 * there) and Tauri's NSIS tool folder. Nothing outside is ever signed.
 */
export function inBuildPlace(file, { root = ROOT, temp = os.tmpdir(), localAppData = process.env.LOCALAPPDATA } = {}) {
  const abs = path.resolve(file).toLowerCase();
  const places = [root, temp, localAppData && path.join(localAppData, 'tauri')].filter(Boolean);
  return places.some((p) => {
    const dir = path.resolve(p).toLowerCase();
    return abs === dir || abs.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
  });
}

/** A Windows program or library: starts with "MZ". */
export function isPortableExecutable(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(2);
    fs.readSync(fd, head, 0, 2, 0);
    fs.closeSync(fd);
    return head.toString('latin1') === 'MZ';
  } catch {
    return false;
  }
}

/** The newest x64 SignTool of an installed Windows SDK, or SIGNTOOL. */
export function findSigntool() {
  if (process.env.SIGNTOOL) return fs.existsSync(process.env.SIGNTOOL) ? process.env.SIGNTOOL : null;
  const kits = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin');
  if (!fs.existsSync(kits)) return null;
  const versions = fs.readdirSync(kits)
    .filter((v) => /^\d+\.\d+\.\d+\.\d+$/.test(v))
    .sort((a, b) => {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pb[i] - pa[i];
      return 0;
    });
  for (const v of versions) {
    const exe = path.join(kits, v, 'x64', 'signtool.exe');
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function powershell(script) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `[Console]::OutputEncoding = [Text.Encoding]::UTF8; ${script}`], { encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

/** Is the certificate in CurrentUser\My, with its private key and still valid? 'ok' | 'missing' | 'nokey' | 'expired'. */
export function keyState(thumbprint = THUMBPRINT) {
  const r = powershell(
    `$c = Get-Item -LiteralPath 'Cert:\\CurrentUser\\My\\${thumbprint}' -ErrorAction SilentlyContinue; ` +
      `if (-not $c) { 'missing' } elseif (-not $c.HasPrivateKey) { 'nokey' } elseif ($c.NotAfter -lt (Get-Date)) { 'expired' } else { 'ok' }`,
  );
  return r.out || 'missing';
}

const KEY_PROBLEM = {
  missing: `The MT-Media certificate (${THUMBPRINT}) is not in Cert:\\CurrentUser\\My on this machine. Import MT-Media-CodeSigning.pfx there (docs/mt-media-code-signing.md).`,
  nokey: `The MT-Media certificate is in Cert:\\CurrentUser\\My, but without its private key. Import it from the .pfx again (docs/mt-media-code-signing.md).`,
  expired: 'The MT-Media certificate has expired. Renew it (docs/mt-media-code-signing.md) before signing.',
};

/** What a missing key or SignTool means, in one sentence; null when signing can go ahead. */
export function readiness() {
  if (process.platform !== 'win32') return 'Signing needs Windows (SignTool).';
  if (!findSigntool()) return 'SignTool was not found. Install the Windows SDK, or set SIGNTOOL to signtool.exe.';
  const state = keyState();
  return state === 'ok' ? null : KEY_PROBLEM[state] || `Unexpected certificate state: ${state}`;
}

/** The timestamp line of `signtool verify /v`, or null when the file has none. */
export function timestampOf(verifyOutput) {
  if (/File is not timestamped/i.test(verifyOutput)) return null;
  const m = verifyOutput.match(/The signature is timestamped:\s*(.+)/i);
  return m ? m[1].trim() : null;
}

/** Writes an entry to the log and the console. */
export function record(entry) {
  append(entry);
  say(entry);
}

function append(entry) {
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.appendFileSync(LOG, `${JSON.stringify(entry)}\n`);
}

function say(entry) {
  const mark = entry.result === 'ok' ? '✓' : '✗';
  const ts = entry.timestamp ? `timestamp ${entry.timestamp}` : 'NO timestamp';
  console.log(`${mark} ${entry.action} ${entry.file}  sha256 ${entry.sha256 ?? '-'}  signer ${entry.publisher ?? '-'} ${entry.thumbprint ?? '-'}  ${ts}${entry.error ? `  (${entry.error})` : ''}`);
}

/**
 * Checks one file: SignTool's Authenticode policy and Get-AuthenticodeSignature
 * must both accept it, the signer must be the MT-Media certificate and the
 * timestamp must be there. Never signs.
 */
export function verify(file, { requireTimestamp = !ALLOW_NO_TIMESTAMP } = {}) {
  const tool = findSigntool();
  const entry = { time: new Date().toISOString(), action: 'verify', file: path.basename(file), path: path.resolve(file), sha256: sha256(file) };
  const problems = [];
  if (!tool) problems.push('SignTool not found');
  const st = tool ? spawnSync(tool, ['verify', '/pa', '/v', file], { encoding: 'utf8' }) : null;
  const stOut = st ? `${st.stdout || ''}${st.stderr || ''}` : '';
  if (st && st.status !== 0) problems.push(`signtool verify failed: ${stOut.split(/\r?\n/).find((l) => /error/i.test(l))?.trim() || `exit ${st.status}`}`);
  const ps = powershell(
    `$s = Get-AuthenticodeSignature -LiteralPath '${path.resolve(file).replace(/'/g, "''")}'; ` +
      `[pscustomobject]@{ status = [string]$s.Status; message = $s.StatusMessage; thumbprint = $s.SignerCertificate.Thumbprint; ` +
      `subject = $s.SignerCertificate.Subject; tsa = $s.TimeStamperCertificate.Subject } | ConvertTo-Json -Compress`,
  );
  let sig = {};
  try {
    sig = JSON.parse(ps.out);
  } catch {
    problems.push(`Get-AuthenticodeSignature gave no answer${ps.err ? `: ${ps.err}` : ''}`);
  }
  entry.thumbprint = sig.thumbprint || null;
  entry.publisher = /CN=([^,]+)/.exec(sig.subject || '')?.[1] ?? null;
  entry.status = sig.status || null;
  entry.timestamp = timestampOf(stOut);
  entry.timestampAuthority = /CN=([^,]+)/.exec(sig.tsa || '')?.[1] ?? null;
  if (sig.status && sig.status !== 'Valid') problems.push(`Get-AuthenticodeSignature: ${sig.status} (${sig.message})`);
  if (sig.status && (sig.thumbprint || '').toUpperCase() !== THUMBPRINT) problems.push(`signed by ${sig.thumbprint || 'nobody'}, not ${THUMBPRINT}`);
  if (sig.status && entry.publisher !== PUBLISHER) problems.push(`publisher is ${entry.publisher || 'missing'}, not ${PUBLISHER}`);
  if (requireTimestamp && !entry.timestamp) problems.push('not timestamped');
  entry.result = problems.length ? 'failed' : 'ok';
  if (problems.length) entry.error = problems.join('; ');
  return entry;
}

/** Signs one file and checks the result. Returns the log entry; never throws. */
export function sign(file) {
  const entry = { time: new Date().toISOString(), action: 'sign', file: path.basename(file), path: path.resolve(file) };
  const fail = (error) => {
    Object.assign(entry, { result: 'failed', error, sha256: fs.existsSync(file) ? sha256(file) : null });
    return entry;
  };
  if (!fs.existsSync(file)) return fail('no such file');
  if (!isPortableExecutable(file)) return fail('not a Windows program');
  const ready = readiness();
  if (ready) return fail(ready);
  const tool = findSigntool();
  const base = ['sign', '/sha1', THUMBPRINT, '/s', 'My', '/fd', 'SHA256', '/d', 'Girovo', '/du', 'https://girovo.de'];
  let timestamped = null;
  const tried = [];
  for (const server of TIMESTAMP_SERVERS) {
    for (let attempt = 1; attempt <= 2 && !timestamped; attempt++) {
      const r = spawnSync(tool, [...base, '/tr', server, '/td', 'SHA256', file], { encoding: 'utf8' });
      if (r.status === 0) timestamped = server;
      else tried.push(`${server}: ${`${r.stdout || ''}${r.stderr || ''}`.split(/\r?\n/).find((l) => /error/i.test(l))?.trim() || `exit ${r.status}`}`);
    }
    if (timestamped) break;
  }
  if (!timestamped) {
    if (!ALLOW_NO_TIMESTAMP) return fail(`timestamping failed, file not signed: ${tried.join(' | ')}`);
    const r = spawnSync(tool, [...base, file], { encoding: 'utf8' });
    if (r.status !== 0) return fail(`signtool sign failed: ${(r.stdout || '') + (r.stderr || '')}`.trim());
    entry.warning = `signed WITHOUT a timestamp (GIROVO_SIGN_ALLOW_NO_TIMESTAMP): ${tried.join(' | ')}`;
  }
  const checked = verify(file);
  return Object.assign(entry, {
    sha256: checked.sha256,
    thumbprint: checked.thumbprint,
    publisher: checked.publisher,
    timestamp: checked.timestamp,
    timestampServer: timestamped,
    result: checked.result,
    ...(checked.error ? { error: checked.error } : {}),
  });
}

/** The release files under these paths: files as given (if they are release files), folders one level deep. */
export function collect(paths) {
  const out = [];
  for (const p of paths) {
    if (!fs.existsSync(p)) throw new Error(`no such path: ${p}`);
    if (fs.statSync(p).isDirectory()) {
      for (const f of fs.readdirSync(p)) if (isArtifact(f) && fs.statSync(path.join(p, f)).isFile()) out.push(path.join(p, f));
    } else if (isArtifact(p)) {
      out.push(p);
    } else {
      throw new Error(`not one of Girovo's release files: ${p}`);
    }
  }
  return out;
}

function main(argv) {
  const [first, ...rest] = argv;
  if (first === '--check') {
    const ready = readiness();
    if (ready) {
      console.error(`✗ ${ready}`);
      return 1;
    }
    console.log(`✓ SignTool ${findSigntool()}; MT-Media certificate ${THUMBPRINT} with its key in CurrentUser\\My`);
    return 0;
  }
  if (first === '--sign' || first === '--verify') {
    let files;
    try {
      files = collect(rest);
    } catch (e) {
      console.error(`✗ ${e.message}`);
      return 1;
    }
    if (!files.length) {
      console.error(`✗ no Girovo release files in ${rest.join(', ') || '(nothing given)'}`);
      return 1;
    }
    let failed = 0;
    for (const f of files) {
      const entry = first === '--sign' ? sign(f) : verify(f);
      append(entry);
      say(entry);
      if (entry.result !== 'ok') failed++;
    }
    if (failed) console.error(`✗ ${failed} of ${files.length} file(s) not validly signed`);
    return failed ? 1 : 0;
  }
  if (!first || first.startsWith('--') || rest.length) {
    console.error('usage: sign-windows.mjs <file> | --sign <paths…> | --verify <paths…> | --check');
    return 2;
  }
  // Tauri's signCommand: whatever its build hands over, from its own places only.
  if (!inBuildPlace(first)) {
    console.error(`✗ refusing to sign ${first}: outside this checkout and the build's temp folders`);
    return 1;
  }
  const entry = sign(first);
  append(entry);
  say(entry);
  return entry.result === 'ok' ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  process.exit(main(process.argv.slice(2)));
}
