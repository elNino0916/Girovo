// Which Girovo a build is. A release ("6.1.0") is Girovo 6.1. A build of the
// Next channel (7.0.0-next.<time>.g<commit>, docs/update-channels.md) is
// Girovo Next. Anything else with a pre-release part is Girovo Nightly: the
// nightlies (6.0.0-nightly.<time>.g<commit>), the one bridge named
// 6.0.0-preview.<time>, a hand-made preview, CI's development builds
// (-dev.<run>). Each pre-release edition has its own name and plate (amber for
// Nightly, violet for Next), so a test build is never taken for the release
// or for the other one. The same rule names the shell's windows
// (src-tauri/src/edition.rs) and picks the app icon (scripts/dist-desktop.mjs
// swaps in src-tauri/icons-nightly or src-tauri/icons-next).
//
// Only the looks and the name tell Next from Nightly. Whatever a build does
// because it is a test build goes by isPreReleaseVersion, which both are.

/** The three editions: Girovo, Girovo Nightly, Girovo Next. */
export type Edition = 'release' | 'nightly' | 'next';

/** The edition of `version`: a pre-release part starting with "next." is Next, any other one Nightly. */
export function editionOf(version: string): Edition {
  const m = /^v?\d+\.\d+\.\d+-([^+]*)/.exec(version.trim());
  if (!m) return 'release';
  return m[1].startsWith('next.') ? 'next' : 'nightly';
}

/** Whether `version` has a pre-release part, i.e. is a Girovo Nightly or a Girovo Next build. */
export function isPreReleaseVersion(version: string): boolean {
  return editionOf(version) !== 'release';
}

/** The app's name in `edition`: "Girovo Nightly", "Girovo Next" or "Girovo". */
export function nameOf(edition: Edition): string {
  return edition === 'nightly' ? 'Girovo Nightly' : edition === 'next' ? 'Girovo Next' : 'Girovo';
}

/**
 * The wordmark's numeral: major and minor ("6.1.0" → "6.1"), the minor left
 * out when it is 0 ("7.0.0" → "7"). A patch release keeps the name. Null when unknown.
 */
export function numeralOf(version: string): string | null {
  const m = /^v?(\d+)\.(\d+)\.\d+/.exec(version.trim());
  if (!m) return null;
  return Number(m[2]) ? `${Number(m[1])}.${Number(m[2])}` : String(Number(m[1]));
}

const VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '';

/** This build's edition. */
export const EDITION = editionOf(VERSION);

/** The app's name as this build shows it: "Girovo Nightly" on a nightly, "Girovo Next" on Next, "Girovo" on a release. */
export const APP_NAME = nameOf(EDITION);

/** The release's numeral in the wordmark ("Girovo 6.1"); null when unknown. */
export const NUMERAL = numeralOf(VERSION);

/** The nightly's plate and the G€ on it: Girovo's navy on amber, as on the nightly app icon. */
export const NIGHTLY_PLATE = '#f5a623';
export const NIGHTLY_INK = '#0a2c5e';

/** Next's: the G€ in white on violet, as on the Next app icon. Navy on violet reads too weakly; white has about 5.8:1. */
export const NEXT_PLATE = '#7b4fe0';
export const NEXT_INK = '#ffffff';

/** The plate and its G€ in `edition`; null on a release, whose plate is Girovo's navy with a white G€. */
export function plateOf(edition: Edition): { plate: string; ink: string } | null {
  if (edition === 'nightly') return { plate: NIGHTLY_PLATE, ink: NIGHTLY_INK };
  if (edition === 'next') return { plate: NEXT_PLATE, ink: NEXT_INK };
  return null;
}
