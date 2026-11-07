// Which Girovo a build is. A release ("6.0.0") is Girovo 6. Anything with a
// pre-release part is Girovo Nightly: the nightlies
// (6.0.0-nightly.<time>.g<commit>), the one bridge named
// 6.0.0-preview.<time>, a hand-made preview, CI's development builds
// (-dev.<run>). A nightly has its own name and an amber plate, so a test build
// is never taken for the release. The same rule names the shell's windows
// (src-tauri/src/edition.rs) and picks the nightly app icon
// (scripts/dist-desktop.mjs, src-tauri/tauri.nightly.conf.json).

/** Whether `version` has a pre-release part, i.e. is a Girovo Nightly build. */
export function isNightlyVersion(version: string): boolean {
  return /^v?\d+\.\d+\.\d+-/.test(version.trim());
}

/** The major version of `version` ("6.0.0" → 6), or null. */
export function majorOf(version: string): number | null {
  const m = /^v?(\d+)\.\d+\.\d+/.exec(version.trim());
  return m ? Number(m[1]) : null;
}

const VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '';

/** This build is a Girovo Nightly. */
export const NIGHTLY = isNightlyVersion(VERSION);

/** The app's name as this build shows it: "Girovo Nightly" on a nightly, "Girovo" on a release. */
export const APP_NAME = NIGHTLY ? 'Girovo Nightly' : 'Girovo';

/** The release's major version, the wordmark's numeral ("Girovo 6"); null when unknown. */
export const MAJOR = majorOf(VERSION);

/** The nightly's plate and the G€ on it: Girovo's navy on amber, as on the nightly app icon. */
export const NIGHTLY_PLATE = '#f5a623';
export const NIGHTLY_INK = '#0a2c5e';
