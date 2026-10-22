// What the Android app's own integrity check means for its user
// (android/app/src/main/java/…/DeviceIntegrity.java gathers the facts).
//
// Two questions, both answered on the phone alone — Play Integrity's verdict
// can only be read on a server, and Girovo has none:
//
//   - Is this phone one a PIN is safe on? Its secure hardware attests the
//     boot it saw: the bootloader locked, and the maker's system (or another
//     signed by its own key, a custom system such as GrapheneOS). A phone it
//     cannot vouch for, one with an unlocked bootloader or an unverified
//     system, or one exposing runtime modification indicators is treated as
//     unsafe. A verified boot alone cannot exclude root acquired after boot.
//   - Is this Girovo as elNino0916 builds it? Its signing certificate says.
//
// A modified copy of Girovo would drop this check, so it proves nothing about
// such a copy; it is for the genuine app on a phone that is no longer safe.
//
// Pure and node-test-safe.

/** A negative observation is scoped to this read/query, never proof of a clean system. */
export type RuntimeCheck = {
  id: string;
  status: 'found' | 'nothing seen' | 'unavailable';
  detail: string;
  evidence?: string[];
};

/** The facts as DeviceIntegrity.java reports them; any may be missing where the phone could not say. */
export type IntegrityFacts = {
  runtime?: RuntimeCheck[];
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
 *   modified  positive runtime evidence, bootloader unlocked, or unverified boot
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
  // Positive runtime evidence overrides even a hardware-verified, locked boot,
  // and survives missing/failed attestation. Unavailable checks remain unknown
  // observations; they are neither positive findings nor proof of absence.
  // An installed root manager app is no evidence on its own — it is an app,
  // and runs without root (the owner's S26: KernelSU's manager, locked
  // verified boot, no module mounts): it is kept as a finding to show, and
  // the mounts, hosts and su paths decide.
  if (f.runtime?.some((check) => check.status === 'found' && !check.id.startsWith('package:'))) return 'modified';
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

export type Integrity = {
  device: DeviceVerdict;
  copy: CopyVerdict;
  level: IntegrityFacts['securityLevel'] | null;
  runtime?: RuntimeCheck[];
  /**
   * The user has let Girovo keep its data on this phone anyway, past the big
   * warning (held "Schließen" in Gerätesicherheit for 10 s) — for this very
   * verdict: a phone that turns out worse later is asked again.
   */
  savingAllowed?: boolean;
};

export function integrityOf(f: IntegrityFacts, allowedFor: DeviceVerdict | null = null): Integrity {
  const device = deviceVerdict(f);
  const copy = copyVerdict(f);
  return {
    device, copy, level: f.securityLevel ?? null, runtime: f.runtime ?? [],
    savingAllowed: allowedFor != null && allowedFor === device && mayAllowSaving({ device, copy, level: null }),
  };
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
 * mobile/shims/fs.ts). A debug build without a positive modification can keep
 * its data on an emulator that cannot attest its boot.
 */
export function keepsNothing(i: Integrity | null): boolean {
  // The user's own choice, past the warning — never for a foreign copy.
  if (i?.savingAllowed && mayAllowSaving(i)) return false;
  return unsafePhone(i);
}

/**
 * A phone that is modified, or cannot prove it is not — whatever the user
 * chose to keep on it: no PIN is ever sealed behind a fingerprint there.
 */
export function unsafePhone(i: Integrity | null): boolean {
  // A positive modification must also lock storage in a development build.
  if (i?.device === 'modified') return true;
  if (i?.copy === 'development') return false;
  return !i || i.device === 'unknown';
}

/**
 * Whether the user may let Girovo keep its data here anyway: on an unsafe
 * phone (rooted, unlocked, unprovable) running the genuine app. A foreign copy
 * never — whoever signed it decides what it does with the data.
 */
export function mayAllowSaving(i: Integrity | null): i is Integrity {
  return !!i && unsafePhone(i) && i.copy !== 'foreign';
}
