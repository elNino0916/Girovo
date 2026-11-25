// Google's list of revoked attestation keys, as the copy the Android app
// ships: android/app/src/main/res/raw/attestation_revoked.txt.
//
// The app checks a phone's key attestation on the phone alone
// (android/…/DeviceIntegrity.java). Root tools forge that attestation with
// leaked keys, and Google revokes the keys it learns of. Asking Google's list
// from the phone would be a request to Google on every start, so the list
// travels inside the app, as old as the release. Run this before an Android
// release and commit the file:
//
//   node scripts/attestation-revoked.mjs           fetch the list and rewrite the copy
//   node scripts/attestation-revoked.mjs --check   say how old the copy is; fails past 45 days
//
// The copy is one serial number a line under a "# fetched <date>" header, as
// Google writes them: lowercase hex without leading zeros. Close to half are
// digits only and look decimal; they are hex too (RevokedKeys.java).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE = 'https://android.googleapis.com/attestation/status';
export const SNAPSHOT = path.join(ROOT, 'android', 'app', 'src', 'main', 'res', 'raw', 'attestation_revoked.txt');
/** A release with an older copy is warned about (build-android.mjs). */
export const STALE_DAYS = 45;

/** Fewer hex digits than this is no attestation key's serial number (RevokedKeys.SHORTEST). */
export const SHORTEST = 16;

/**
 * The serials of every entry Google no longer vouches for (revoked or
 * suspended), sorted. Anything that is not such a list is refused whole: a
 * short number among them ("1") would match the same certificate on every
 * phone, and the app would call them all unprovable.
 */
export function serialsOf(status) {
  const entries = status && typeof status === 'object' ? status.entries : null;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('no "entries" in the list');
  const serials = [];
  for (const [serial, entry] of Object.entries(entries)) {
    const key = serial.trim().toLowerCase().replace(/^0+(?=.)/, '');
    if (!new RegExp(`^[0-9a-f]{${SHORTEST},64}$`).test(key)) throw new Error(`not a serial number: ${serial.slice(0, 80)}`);
    if (!entry || typeof entry !== 'object' || typeof entry.status !== 'string') continue;
    // An entry with an end date is a suspension that runs out. The copy
    // cannot follow that, and a key listed past its date would mark honest
    // phones until the next release: left out.
    if (entry.expires) continue;
    // Google documents REVOKED and SUSPENDED; neither is a key to trust.
    serials.push(key);
  }
  return [...new Set(serials)].sort();
}

export function snapshotText(serials, date) {
  return [
    `# fetched ${date}`,
    `# ${serials.length} certificate serial numbers from ${SOURCE}`,
    '# Written by scripts/attestation-revoked.mjs; do not edit by hand.',
    ...serials,
    '',
  ].join('\n');
}

/** What a copy says of itself: its date and how many serials it holds; null for a file that is no copy. */
export function readSnapshot(text) {
  const date = /^# fetched (\d{4}-\d{2}-\d{2})\s*$/m.exec(text)?.[1];
  if (!date) return null;
  const count = text.split(/\r?\n/).filter((line) => /^[0-9a-f]+$/.test(line.trim())).length;
  return { date, count };
}

/** Whole days between a copy's date and `now`. */
export function ageInDays(date, now = new Date()) {
  return Math.floor((now.getTime() - new Date(`${date}T00:00:00Z`).getTime()) / 86_400_000);
}

/**
 * The line a release build prints about the copy, or null while it is fresh.
 * Never an error: an old list still catches every key it names.
 */
export function staleWarning(file = SNAPSHOT, now = new Date()) {
  const current = fs.existsSync(file) ? readSnapshot(fs.readFileSync(file, 'utf8')) : null;
  if (!current) return 'the list of revoked attestation keys is missing: npm run android:revoked';
  const age = ageInDays(current.date, now);
  return age > STALE_DAYS ? `the list of revoked attestation keys is ${age} days old: npm run android:revoked` : null;
}

async function main() {
  const current = fs.existsSync(SNAPSHOT) ? readSnapshot(fs.readFileSync(SNAPSHOT, 'utf8')) : null;
  if (process.argv.includes('--check')) {
    const warning = staleWarning();
    console.log(warning ? `✗ ${warning}` : `✓ ${current.count} revoked keys, fetched ${current.date}`);
    process.exit(warning ? 1 : 0);
  }
  const response = await fetch(SOURCE, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${SOURCE} answered ${response.status}`);
  const serials = serialsOf(await response.json());
  // The list only grows. A much shorter answer is a broken one, and writing
  // it would let revoked keys pass again.
  if (!serials.length || (current && serials.length < current.count * 0.9)) {
    throw new Error(`the list has ${serials.length} entries, the copy ${current?.count ?? 0}: not written`);
  }
  fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
  fs.writeFileSync(SNAPSHOT, snapshotText(serials, new Date().toISOString().slice(0, 10)));
  console.log(`✓ ${serials.length} revoked keys (${current ? `${current.count} before, from ${current.date}` : 'new file'})`);
  console.log(`  ${path.relative(ROOT, SNAPSHOT)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  });
}
