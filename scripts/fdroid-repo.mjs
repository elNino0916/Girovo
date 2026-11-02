// Girovo's own F-Droid repository, https://girovo.de/fdroid/repo.
//
// F-Droid, Droid-ify or Neo Store add it once and update the F-Droid build
// from it like any other app. Its APKs are the release's own, signed with the
// GitHub APK's key, so either installs over the other. (IzzyOnDroid refuses
// apps written with AI help, and F-Droid itself builds from source — see
// android/README.md.)
//
//   1. the release's F-Droid APK      dist/Girovo-<version>-fdroid.apk → fdroid/repo/
//   2. its texts and pictures         fastlane/metadata/android → fdroid/metadata/<app id>/
//   3. the signed index               fdroid update (fdroidserver in fdroid/.venv, via scripts/fdroid-update.py)
//   4. the website's copy             fdroid/repo → <girovo-website>/public/fdroid/repo
//
// Usage:
//   node scripts/fdroid-repo.mjs                  this version's APK, then the website's copy
//   node scripts/fdroid-repo.mjs --apk <file>     another F-Droid APK
//   node scripts/fdroid-repo.mjs --no-site        the repository only
//
// Once: python -m venv fdroid/.venv, then fdroid/.venv/Scripts/pip install
// fdroidserver (bin/ outside Windows). fdroid/repo-key.properties (never
// committed) names the repository key: storeFile, storePassword, keyAlias.
// The website checkout is GIROVO_WEBSITE, else ~/Documents/GitHub/girovo-website;
// `npm run build` and `npx wrangler deploy` there publish the copy.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = path.join(ROOT, 'fdroid');
const APP_ID = 'de.elnino0916.android.girovo';
const WIN = process.platform === 'win32';

const has = (flag) => process.argv.includes(flag);
const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
};
const fail = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (result.status !== 0) fail(`${path.basename(cmd)} ${args.join(' ')} failed`);
  return result;
}

const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const apk = path.resolve(arg('--apk', path.join(ROOT, 'dist', `Girovo-${version}-fdroid.apk`)));
if (!fs.existsSync(apk)) fail(`${path.relative(ROOT, apk)} is missing — node scripts/build-android.mjs --release --flavor fdroid`);

const python = path.join(WORK, '.venv', WIN ? 'Scripts' : 'bin', WIN ? 'python.exe' : 'python');
if (!fs.existsSync(python)) fail('fdroidserver is missing — python -m venv fdroid/.venv && fdroid/.venv/Scripts/pip install fdroidserver');

const keyFile = path.join(WORK, 'repo-key.properties');
if (!fs.existsSync(keyFile)) fail('fdroid/repo-key.properties is missing — it names the repository key (android/README.md)');
const key = Object.fromEntries(fs.readFileSync(keyFile, 'utf8').split(/\r?\n/)
  .filter((line) => /^\w+=/.test(line)).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
if (!key.storeFile || !key.storePassword || !key.keyAlias) fail('fdroid/repo-key.properties needs storeFile, storePassword and keyAlias');
if (!fs.existsSync(key.storeFile)) fail(`the repository keystore ${key.storeFile} is missing — restore it from the backup`);

const sdk = process.env.ANDROID_HOME ?? path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk');
const buildTools = path.join(sdk, 'build-tools');
const newest = fs.existsSync(buildTools) ? fs.readdirSync(buildTools).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))[0] : null;
if (!newest) fail(`no Android build-tools under ${sdk}`);
const javaHome = process.env.JAVA_HOME ?? {
  win32: path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Android Studio', 'jbr'),
  darwin: '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
  linux: '/opt/android-studio/jbr',
}[process.platform];
// apksigner checks the APKs (their v2/v3 signatures; there is no v1 to show
// jarsigner) and signs the index, on Android Studio's Java.
const env = {
  ...process.env,
  // Python reads text files in the system's encoding unless told otherwise:
  // on Windows the store texts' dashes and umlauts came out as "â€“".
  PYTHONUTF8: '1',
  ANDROID_HOME: sdk,
  JAVA_HOME: javaHome,
  PATH: [path.join(javaHome, 'bin'), process.env.PATH].join(path.delimiter),
  GIROVO_APKSIGNER: path.join(buildTools, newest, WIN ? 'apksigner.bat' : 'apksigner'),
  GIROVO_FDROID_KEYSTORE: key.storeFile,
  GIROVO_FDROID_STOREPASS: key.storePassword,
  GIROVO_FDROID_KEYALIAS: key.keyAlias,
};

// 1. The APK, named as fdroidserver names them: <app id>_<versionCode>.apk.
const badging = spawnSync(path.join(buildTools, newest, WIN ? 'aapt2.exe' : 'aapt2'), ['dump', 'badging', apk], { encoding: 'utf8' }).stdout ?? '';
const id = badging.match(/package: name='([^']+)'/)?.[1];
const versionCode = badging.match(/versionCode='(\d+)'/)?.[1];
if (id !== APP_ID || !versionCode) fail(`${path.basename(apk)} is not a Girovo APK`);
const repo = path.join(WORK, 'repo');
fs.mkdirSync(repo, { recursive: true });
const target = path.join(repo, `${APP_ID}_${versionCode}.apk`);
fs.copyFileSync(apk, target);
console.log(`› ${path.basename(apk)} → fdroid/repo/${path.basename(target)}`);

// 2. Texts, pictures and changelogs, fresh each time. The repository's icon is
// the app's: fdroid update takes it from fdroid/icon.png into repo/icons/.
const fastlane = path.join(ROOT, 'fastlane', 'metadata', 'android');
const localized = path.join(WORK, 'metadata', APP_ID);
fs.rmSync(localized, { recursive: true, force: true });
fs.cpSync(fastlane, localized, { recursive: true });
fs.copyFileSync(path.join(fastlane, 'en-US', 'images', 'icon.png'), path.join(WORK, 'icon.png'));

// 3. The index. A rebuilt APK under a known versionCode is read anew.
fs.rmSync(path.join(WORK, 'tmp', 'apkcache.json'), { force: true });
console.log('› fdroid update');
run(python, [path.join(ROOT, 'scripts', 'fdroid-update.py')], { cwd: WORK, env });
for (const file of ['entry.jar', 'index-v2.json', 'index-v1.jar']) {
  if (!fs.existsSync(path.join(repo, file))) fail(`fdroid update wrote no repo/${file}`);
}

// The address to add, with the key's fingerprint: a client refuses an index signed by any other.
const keytool = path.join(javaHome, 'bin', WIN ? 'keytool.exe' : 'keytool');
const listing = spawnSync(keytool, ['-list', '-v', '-keystore', key.storeFile, '-storepass:env', 'GIROVO_FDROID_STOREPASS', '-alias', key.keyAlias],
  { encoding: 'utf8', env }).stdout ?? '';
const fingerprint = listing.match(/SHA256:\s*([0-9A-F:]+)/)?.[1]?.replaceAll(':', '').toLowerCase();
const digest = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
console.log(`› repository  https://girovo.de/fdroid/repo?fingerprint=${fingerprint ?? '?'}
  apk sha256  ${digest}`);

// 4. The website's copy: the repository as it stands, nothing else.
if (!has('--no-site')) {
  const site = process.env.GIROVO_WEBSITE ?? path.join(os.homedir(), 'Documents', 'GitHub', 'girovo-website');
  if (!fs.existsSync(path.join(site, 'wrangler.toml'))) fail(`no girovo-website checkout at ${site} — set GIROVO_WEBSITE, or pass --no-site`);
  const copy = path.join(site, 'public', 'fdroid', 'repo');
  fs.rmSync(copy, { recursive: true, force: true });
  fs.cpSync(repo, copy, { recursive: true });
  console.log(`› ${copy}
  publish it there: npm run build && npx wrangler deploy`);
}
