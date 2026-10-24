// Builds the Android app.
//
//   1. the page, exported for the phone      GIROVO_TARGET=android next build → .next-android/
//   2. the phone runtime beside it           scripts/build-mobile.mjs → .next-android/mobile-runtime.js
//   3. both into the Android project         npx cap sync android
//   4. the app itself                        gradlew (android/)
//
// Usage:
//   node scripts/build-android.mjs                       debug APK, "github" flavour
//   node scripts/build-android.mjs --flavor play         … "play" flavour
//   node scripts/build-android.mjs --release             signed release APK (github) / AAB (play)
//   node scripts/build-android.mjs --install             … and install it on the connected device
//   node scripts/build-android.mjs --web-only            steps 1–3 only (Android Studio builds the rest)
//
// Gradle runs on Android Studio's JDK unless JAVA_HOME says otherwise. A
// release build is signed with the keystore android/keystore.properties names
// (see android/README.md); without one it stops before building.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMobile } from './build-mobile.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID = path.join(ROOT, 'android');
const OUT = path.join(ROOT, '.next-android');

const has = (flag) => process.argv.includes(flag);
const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
};
const FLAVOR = arg('--flavor', 'github');
const RELEASE = has('--release');
const WEB_ONLY = has('--web-only');
if (!['github', 'play'].includes(FLAVOR)) {
  console.error(`✗ unknown flavour "${FLAVOR}" — github or play`);
  process.exit(1);
}
// An unsigned release cannot be installed or uploaded: stop before the long build.
if (RELEASE && !WEB_ONLY && !fs.existsSync(path.join(ANDROID, 'keystore.properties'))) {
  console.error('✗ a release build is signed with android/keystore.properties — see android/README.md');
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (result.status !== 0) {
    console.error(`✗ ${cmd} ${args.join(' ')} failed`);
    process.exit(result.status ?? 1);
  }
}

console.log('› next build (Android export)');
fs.rmSync(OUT, { recursive: true, force: true });
run(process.execPath, [path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'], {
  cwd: ROOT,
  env: { ...process.env, GIROVO_TARGET: 'android', NODE_ENV: 'production' },
  shell: false,
});
// The design preview is a development page; it answers 404 in production anyway.
// The desktop's pdf.js and Tesseract files stay off the phone, which reads with ML Kit.
for (const stale of ['design-preview', 'design-preview.html', 'design-preview.txt', 'ocr', 'pdf']) {
  fs.rmSync(path.join(OUT, stale), { recursive: true, force: true });
}

console.log('› phone runtime');
await buildMobile({ out: OUT });

console.log('› cap sync android');
run('npx', ['cap', 'sync', 'android'], { cwd: ROOT });

if (WEB_ONLY) process.exit(0);

function javaHome() {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME;
  const studio = {
    win32: path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Android Studio', 'jbr'),
    darwin: '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
    linux: '/opt/android-studio/jbr',
  }[process.platform];
  return studio && fs.existsSync(studio) ? studio : undefined;
}

const variant = `${FLAVOR[0].toUpperCase()}${FLAVOR.slice(1)}${RELEASE ? 'Release' : 'Debug'}`;
// Play takes an app bundle; GitHub hands out an APK.
const task = RELEASE && FLAVOR === 'play' ? `bundle${variant}` : `assemble${variant}`;
console.log(`› gradle ${task}`);
const gradlew = path.join(ANDROID, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
// A checkout made on Windows may not carry the wrapper's executable bit.
if (process.platform !== 'win32') fs.chmodSync(gradlew, 0o755);
run(gradlew, [task, '--console=plain'], { cwd: ANDROID, env: { ...process.env, JAVA_HOME: javaHome() ?? '' } });

const outputs = path.join(ANDROID, 'app', 'build', 'outputs');
const kind = task.startsWith('bundle') ? 'bundle' : 'apk';
const dir = kind === 'bundle'
  ? path.join(outputs, 'bundle', `${FLAVOR}${RELEASE ? 'Release' : 'Debug'}`)
  : path.join(outputs, 'apk', FLAVOR, RELEASE ? 'release' : 'debug');
const built = fs.readdirSync(dir).filter((f) => /\.(apk|aab)$/.test(f)).map((f) => path.join(dir, f));
for (const file of built) console.log(`  ${path.relative(ROOT, file)}  ${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB`);

// A release goes to dist/ under the names the release page carries: the
// GitHub build's phone APK as "Girovo-<version>-android.apk" — the name the
// app's own updater looks for (electron/update-logic.cjs) — and the Play
// bundle for the Play Console.
if (RELEASE) {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const dist = path.join(ROOT, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  const pick = kind === 'bundle' ? built[0] : built.find((f) => /arm64-v8a/.test(path.basename(f)));
  if (!pick) {
    console.error('✗ no arm64-v8a APK among the outputs');
    process.exit(1);
  }
  const name = kind === 'bundle' ? `Girovo-${version}-play.aab` : `Girovo-${version}-android.apk`;
  fs.copyFileSync(pick, path.join(dist, name));
  const digest = crypto.createHash('sha256').update(fs.readFileSync(pick)).digest('hex');
  console.log(`› dist/${name}
  sha256 ${digest}`);
}

if (has('--install') && kind === 'apk') {
  const sdk = process.env.ANDROID_HOME ?? path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk');
  const adb = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
  console.log('› adb install');
  run(adb, ['install', '-r', built[0]], { shell: false });
  run(adb, ['shell', 'am', 'start', '-n', 'de.elnino0916.android.girovo/.MainActivity'], { shell: false });
}
