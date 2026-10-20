// What the Android app's own integrity check means for its user
// (android/app/src/main/java/…/DeviceIntegrity.java gathers the facts).
//
// Two questions, both answered on the phone alone — Play Integrity's verdict
// can only be read on a server, and Girovo has none:
//
//   - Is this phone one a PIN is safe on? Its secure hardware attests the
//     boot it saw: the bootloader locked, and the maker's system (or another
//     signed by its own key, a custom system such as GrapheneOS). A phone it
//     cannot vouch for, or one with an unlocked bootloader or an unverified
//     system, is one where an app with root rights could read what is typed.
//   - Is this Girovo as elNino0916 builds it? Its signing certificate says.
//
// A modified copy of Girovo would drop this check, so it proves nothing about
// such a copy; it is for the genuine app on a phone that is no longer safe.
//
// Pure and node-test-safe.

/** The facts as DeviceIntegrity.java reports them; any may be missing where the phone could not say. */
export type IntegrityFacts = {
  attestation?: 'hardware' | 'software' | 'unavailable' | 'error';
  securityLevel?: 'strongbox' | 'tee' | 'software';
  chain?: 'google' | 'other' | 'broken';
  challengeOk?: boolean;
  deviceLocked?: boolean;
  bootState?: 'verified' | 'self-signed' | 'unverified' | 'failed';
  /** SHA-256 of each certificate the installed app is signed with. */
  signers?: string[];
  installer?: string | null;
  debug?: boolean;
  flavor?: 'play' | 'github';
};

/**
 *   trusted   the maker's system, bootloader locked — attested by the hardware
 *   custom    another system signed by its own key, bootloader locked
 *   modified  bootloader unlocked, or a system nobody vouches for
 *   unknown   the phone could not prove anything (no hardware attestation, a
 *             chain not ending at Google's roots, an emulator)
 */
export type DeviceVerdict = 'trusted' | 'custom' | 'modified' | 'unknown';

/**
 *   official     signed with Girovo's release key, or installed by Google Play
 *   foreign      signed by someone else: a rebuilt or modified copy
 *   development  a debug build
 *   unknown      the signer could not be read
 */
export type CopyVerdict = 'official' | 'foreign' | 'development' | 'unknown';

/** SHA-256 of the certificate Girovo's release builds (GitHub and the upload to Play) are signed with. */
export const RELEASE_SIGNERS: readonly string[] = [
  '7e4b7b7ea60e7a19b8649df062d639a2cb0daa85abf20de939980bad9ae6ce4c',
];

const PLAY_STORE = 'com.android.vending';

export function deviceVerdict(f: IntegrityFacts): DeviceVerdict {
  // Only hardware that signs for itself, up to Google's roots, for this very
  // request: anything less can be imitated by the system it is meant to judge.
  if (f.attestation !== 'hardware' || f.chain !== 'google' || f.challengeOk !== true) return 'unknown';
  if (f.deviceLocked == null || f.bootState == null) return 'unknown';
  if (!f.deviceLocked || f.bootState === 'unverified' || f.bootState === 'failed') return 'modified';
  return f.bootState === 'self-signed' ? 'custom' : 'trusted';
}

export function copyVerdict(f: IntegrityFacts): CopyVerdict {
  if (f.debug) return 'development';
  const signers = (f.signers ?? []).map((s) => s.toLowerCase());
  if (!signers.length) return 'unknown';
  if (signers.some((s) => RELEASE_SIGNERS.includes(s))) return 'official';
  // With Play App Signing, Play re-signs the app with a key of its own; what
  // Play installs, Play has checked.
  if (f.flavor === 'play' && f.installer === PLAY_STORE) return 'official';
  return 'foreign';
}

export type Integrity = { device: DeviceVerdict; copy: CopyVerdict; level: IntegrityFacts['securityLevel'] | null };

export function integrityOf(f: IntegrityFacts): Integrity {
  return { device: deviceVerdict(f), copy: copyVerdict(f), level: f.securityLevel ?? null };
}

/** What the login screen warns about before a PIN is typed, if anything. */
export function integrityWarning(i: Integrity | null): 'modified' | 'foreign' | null {
  if (!i) return null;
  if (i.copy === 'foreign') return 'foreign';
  if (i.device === 'modified') return 'modified';
  return null;
}

/**
 * Whether Girovo keeps nothing on this phone: one that is modified, or that
 * cannot prove it is not (its check failed, or answered "unknown"). Then no
 * device is remembered, no vault, no kept Umsätze, no documents and no login
 * name are written to it, and none written by an earlier start are read — the
 * session lives in memory and ends with the app (mobile/server/index.ts,
 * mobile/shims/fs.ts). A debug build is a developer's, on an emulator that can
 * never prove anything: it keeps its data.
 */
export function keepsNothing(i: Integrity | null): boolean {
  if (i?.copy === 'development') return false;
  return !i || i.device === 'modified' || i.device === 'unknown';
}
