// Writes girovo-update.json for a release: the files the updaters may install,
// with their sizes, SHA-256 and download addresses, the build number they are
// ordered by, and the release notes (docs/updater-v2.md). Sign it afterwards
// with scripts/sign-update.mjs and upload both beside the files.
//
//   node scripts/update-manifest.mjs <release folder> --version 6.0.2
//        [--tag 6.0.2] [--notes release-notes-6.0.2.md] [--out <file>]
//
// The folder holds the release's files as CI and the Android build name them:
// Girovo-<version>-Setup.exe (+ .blockmap), -x86_64.AppImage, -amd64.deb,
// -android.apk. Anything else in it is left out.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNumber, MANIFEST_FORMAT } from '../mobile/updates/update-trust.ts';

export const REPO = 'elNino0916/Girovo';
export const MANIFEST_NAME = 'girovo-update.json';
const MAX_NOTES_CHARS = 20_000;

/** File kinds an updater picks from, by the end of the file's name. */
const KINDS = [
  ['setup', '-Setup.exe'],
  ['appimage', '-x86_64.AppImage'],
  ['deb', '-amd64.deb'],
  ['apk', '-android.apk'],
];

function describe(dir, name, url) {
  const bytes = fs.readFileSync(path.join(dir, name));
  return {
    name,
    size: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    url: url(name),
  };
}

/** The manifest object for the release in `dir`; throws when it would describe nothing. */
export function buildManifest({ dir, version, tag = version, notes = '', published = new Date().toISOString() }) {
  const build = buildNumber(version);
  if (build == null) throw new Error(`${version} has no build number (mobile/updates/update-trust.ts)`);
  const url = (name) => `https://github.com/${REPO}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
  const names = fs.readdirSync(dir);
  const files = [];
  for (const [kind, suffix] of KINDS) {
    const name = `Girovo-${version}${suffix}`;
    if (!names.includes(name)) continue;
    const file = { kind, ...describe(dir, name, url) };
    if (kind === 'setup' && names.includes(`${name}.blockmap`)) file.blockmap = describe(dir, `${name}.blockmap`, url);
    files.push(file);
  }
  if (!files.length) throw new Error(`no release files for ${version} in ${dir}`);
  return {
    format: MANIFEST_FORMAT,
    v: 1,
    version,
    build,
    channel: version.includes('-') ? 'nightly' : 'stable',
    tag,
    published,
    page: `https://github.com/${REPO}/releases/tag/${encodeURIComponent(tag)}`,
    minimum: { windows: '10', android: 30 },
    files,
    notes: String(notes).slice(0, MAX_NOTES_CHARS),
  };
}

/** The manifest's bytes as signed and uploaded. */
export const manifestText = (manifest) => `${JSON.stringify(manifest, null, 2)}\n`;

function arg(args, name) {
  const at = args.indexOf(name);
  return at === -1 ? null : args[at + 1];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dir = args[0];
  const version = arg(args, '--version');
  if (!dir || dir.startsWith('--') || !version) {
    console.error('usage: node scripts/update-manifest.mjs <release folder> --version X.Y.Z [--tag T] [--notes file.md] [--out file]');
    process.exit(2);
  }
  const notesFile = arg(args, '--notes');
  const manifest = buildManifest({
    dir,
    version,
    tag: arg(args, '--tag') ?? version,
    notes: notesFile ? fs.readFileSync(notesFile, 'utf8') : '',
  });
  const out = arg(args, '--out') ?? path.join(dir, MANIFEST_NAME);
  fs.writeFileSync(out, manifestText(manifest));
  console.log(`› ${out}`);
  console.log(`  ${manifest.version} (${manifest.channel}), build ${manifest.build}`);
  for (const f of manifest.files) console.log(`  ${f.kind.padEnd(8)} ${f.name}  ${f.sha256.slice(0, 16)}…${f.blockmap ? '  + blockmap' : ''}`);
}
