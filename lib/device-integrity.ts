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
// Root tools forge the attestation too, with leaked keys. Three things are
// held against that: Google's list of revoked keys (the copy the app ships),
// the system's own account of its boot where it contradicts the attested
// one, and signs that prove nothing alone but do in pairs (modifiedByPair).
// A phone that hides its root from this app's view, forges with a key nobody
// has reported and sets its properties to match still passes: everything
// here is read on the phone that is being judged.
//
// So the check gives three answers and keeps them apart (integrityClass):
// integrity verified, a modification shown, or neither. A passing
// attestation with one sign of a root tool beside it is the third, as a
// verdict of its own (inconclusive). docs/integrity-verdicts.md says what
// Girovo does with each and what else it could do.
//
// Pure and node-test-safe.

/** A negative observation is scoped to this read/query, never proof of a clean system. */
export type RuntimeCheck = {
  id: string;
  status: 'found' | 'nothing seen' | 'unavailable';
  detail: string;
  evidence?: string[];
};

/**
 * What the system says of itself (DeviceIntegrity.java system()); a value is
 * missing where the phone keeps it from apps. A root tool can rewrite every
 * one, so only what gives a phone away counts: a match proves nothing.
 */
export type SystemFacts = {
  /** Build.TYPE: "user" on every phone sold; "userdebug" and "eng" hand out root over USB. */
  type?: string;
  /** Build.TAGS: "release-keys" on a maker's system. Logged; decides nothing. */
  tags?: string;
  /** ro.debuggable ("0") and ro.secure ("1") on a phone as sold. */
  debuggable?: string;
  secure?: string;
  /** ro.boot.verifiedbootstate: green, yellow (another system under its own key), orange (unlocked), red. */
  bootState?: string;
  /** ro.boot.vbmeta.device_state: locked or unlocked. */
  deviceState?: string;
  /** Samsung's Knox bit: "1" once the phone has started a system that was not Samsung's. */
  warranty?: string;
  /** ro.product.first_api_level, the Android release the phone was sold with. Logged; decides nothing. */
  firstApi?: string;
};

/** The facts as DeviceIntegrity.java reports them; any may be missing where the phone could not say. */
export type IntegrityFacts = {
  runtime?: RuntimeCheck[];
  system?: SystemFacts;
  attestation?: 'hardware' | 'software' | 'unavailable' | 'error';
  securityLevel?: 'strongbox' | 'tee' | 'software';
  chain?: 'google' | 'other' | 'broken';
  /**
   * Which of Google's roots the chain ends at, and how many certificates it
   * has. Logged; decides nothing. A key fetched from Google ends at the P-384
   * root in five certificates, a factory key (and every leaked one) at the
   * RSA root in four. Whether a new phone ever shows a factory chain on its
   * own is not known yet.
   */
  chainRoot?: 'rsa' | 'p384' | 'other';
  chainLength?: number;
  /** A key of the chain is on Google's list of revoked keys; missing where the app's copy could not be read. */
  revoked?: boolean;
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
 *   trusted       the maker's system, bootloader locked — attested by the hardware
 *   custom        another system signed by its own key, bootloader locked
 *   modified      positive runtime evidence, two weak signs, a system that
 *                 contradicts its attestation, bootloader unlocked, or unverified boot
 *   inconclusive  the hardware attests a locked, verified boot, and one sign of
 *                 a root tool stands against it that proves nothing alone (a
 *                 root manager app, doubtSigns): the boot is proven, what runs
 *                 on it now is not
 *   unknown       the phone could not prove anything (no hardware attestation, a
 *                 chain not ending at Google's roots or through a revoked key, an emulator)
 */
export type DeviceVerdict = 'trusted' | 'custom' | 'modified' | 'inconclusive' | 'unknown';

/**
 * The three answers the verdicts come to, and that must never be mixed up
 * (docs/integrity-verdicts.md):
 *
 *   verified      the phone has shown it is unmodified (trusted, custom)
 *   modified      a modification is shown (modified)
 *   insufficient  neither is shown (inconclusive, unknown). No finding is
 *                 not a clean phone, and a doubt is not a finding.
 */
export type IntegrityClass = 'verified' | 'modified' | 'insufficient';

export function integrityClass(device: DeviceVerdict): IntegrityClass {
  if (device === 'trusted' || device === 'custom') return 'verified';
  return device === 'modified' ? 'modified' : 'insufficient';
}

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

/** The runtime checks that decide nothing alone (weakSigns): a manager app, a covered app folder. */
const weakCheck = (id: string): boolean => id.startsWith('package:') || id === 'covers';

/**
 * What proves a modified phone by itself, named for the log: a runtime
 * finding (module mounts, a changed hosts file, su or a root tool's program,
 * a root framework's code in Girovo's own process, a kernel that enforces no
 * access rules), or a system that is no phone maker's release.
 */
export function strongSigns(f: IntegrityFacts): string[] {
  const signs = (f.runtime ?? []).filter((check) => check.status === 'found' && !weakCheck(check.id)).map((check) => check.id);
  // A debug build of Girovo runs on the emulator, whose own system may be
  // debuggable. A release is never a debug build, so this opens no way past
  // the check.
  if (f.system && !f.debug) {
    if (f.system.type && f.system.type !== 'user') signs.push('build:type');
    if (f.system.debuggable === '1') signs.push('build:debuggable');
    if (f.system.secure === '0') signs.push('build:insecure');
  }
  return signs;
}

/**
 * Signs that prove nothing alone, by kind. Each has an innocent reading:
 *
 *   manager   a root manager app is installed. It is an app, and runs
 *             without root.
 *   covers    memory is mounted over a preinstalled app's folder, as a
 *             module does to hide or replace the app. No stock phone is
 *             known to do it, and none is known not to.
 *   warranty  Samsung's Knox bit: the phone once started another system,
 *             and may be back on Samsung's.
 *   revoked   the attestation runs through a key Google has revoked. Factory
 *             keys are shared by a batch of phones, honest ones among them.
 *
 * The first two point at a root tool on the phone now. The last two say
 * what the phone once was, or that its attestation proves nothing.
 *
 * One alone proves nothing, and deviceVerdict never calls it a
 * modification. A pair does where it holds a sign of a root tool
 * (modifiedByPair). What a manager app alone does to a phone whose
 * attestation passes is doubtSigns'.
 *
 * Build.TAGS ("test-keys", "dev-keys") is no sign at all, only logged:
 * Android's compatibility tests do not constrain it, and the emulator's
 * Play image is a "user" build with "dev-keys".
 */
export function weakSigns(f: IntegrityFacts): string[] {
  const kinds = new Set<string>();
  for (const check of f.runtime ?? []) {
    if (check.status !== 'found' || !weakCheck(check.id)) continue;
    kinds.add(check.id === 'covers' ? 'covers' : 'manager');
  }
  if (f.system?.warranty === '1') kinds.add('warranty');
  if (f.revoked === true) kinds.add('revoked');
  return [...kinds];
}

const rootTool = (kind: string): boolean => kind === 'manager' || kind === 'covers';

/**
 * Two weak signs of different kinds, one of them a root tool's: a phone
 * with a root manager and a hidden preinstalled app is rooted, whatever its
 * attestation says (the owner's S26 in October 2026: KernelSU's manager,
 * three covers over /product/app/YouTube, and an attested boot that read
 * locked and verified). So is one with a manager app and a tripped Knox bit
 * or a revoked key.
 *
 * A tripped Knox bit beside a revoked key is no such pair. A second-hand
 * Galaxy back on Samsung's system, from a batch whose key leaked, has both
 * and no root.
 */
export function modifiedByPair(f: IntegrityFacts): boolean {
  const weak = weakSigns(f);
  return weak.length >= 2 && weak.some(rootTool);
}

/**
 * What casts a doubt on a phone whose attestation passes, alone: a root
 * manager app. A root that hides from apps (KernelSU loaded through a kernel
 * exploit, on a locked phone whose attestation is true) leaves nothing else
 * to see, and a manager app with no root behind it looks exactly the same.
 * Such a phone is `inconclusive`: not shown to be modified, and not verified.
 *
 * A covered app folder alone casts none, yet. No stock phone is known to
 * mount memory over one, and none is proven not to; a wrong guess would mark
 * a whole model line, as the overlay rule once marked every HyperOS phone.
 * It is logged, and counts beside a second sign. Once logs from stock
 * Samsung, Xiaomi, OPPO and Pixel phones show it never appears there, it
 * belongs here (docs/integrity-verdicts.md).
 *
 * The Knox bit casts none either: it stays set for good on a phone back on
 * its maker's system. A revoked key has its own answer (`unknown`).
 */
export function doubtSigns(f: IntegrityFacts): string[] {
  return weakSigns(f).filter((kind) => kind === 'manager');
}

/**
 * The attested boot reads locked or verified, and the system's own
 * properties say otherwise. Both come from the bootloader, so on an honest
 * phone they agree; a forged attestation over a system nobody tidied up
 * does not. Only the unsafe direction counts, and only values the boot
 * standard defines: a phone that leaves a property out says nothing.
 */
export function bootContradicted(f: IntegrityFacts): boolean {
  const said = f.system;
  if (!said) return false;
  if (f.deviceLocked && (said.deviceState === 'unlocked' || said.bootState === 'orange')) return true;
  return f.bootState === 'verified' && (said.bootState === 'yellow' || said.bootState === 'orange' || said.bootState === 'red');
}

export function deviceVerdict(f: IntegrityFacts): DeviceVerdict {
  // Positive runtime evidence overrides even a hardware-verified, locked boot,
  // and survives missing/failed attestation. Unavailable checks remain unknown
  // observations; they are neither positive findings nor proof of absence.
  if (strongSigns(f).length) return 'modified';
  // A weak sign is kept as a finding to show and is never a modification;
  // two of different kinds are, where one is a root tool's.
  if (modifiedByPair(f)) return 'modified';
  // Only hardware that signs for itself, up to Google's roots, for this very
  // request: anything less can be imitated by the system it is meant to judge.
  if (f.attestation !== 'hardware' || f.chain !== 'google' || f.challengeOk !== true) return 'unknown';
  if (f.deviceLocked == null || f.bootState == null) return 'unknown';
  // An unlocked or unverified boot is an admission: nobody forges that one.
  if (!f.deviceLocked || f.bootState === 'unverified' || f.bootState === 'failed') return 'modified';
  if (bootContradicted(f)) return 'modified';
  // A revoked key signs what its holder likes: "locked, verified" from it proves nothing.
  if (f.revoked === true) return 'unknown';
  // The boot is proven. One sign of a root tool is no proof of root, and no
  // phone to call verified either.
  if (doubtSigns(f).length) return 'inconclusive';
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
  /** On an inconclusive phone, what stands against its attestation (doubtSigns): "manager". */
  doubt?: string[];
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
    doubt: device === 'inconclusive' ? doubtSigns(f) : [],
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
 * cannot prove it is not (its check failed, or answered "unknown" or
 * "inconclusive"). Then no
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
 *
 * Both kinds of insufficient evidence are handled alike: the phone that
 * cannot attest its boot, and the one whose attested boot has a sign of a
 * root tool beside it. That is one policy of several for an inconclusive
 * phone; docs/integrity-verdicts.md has them, with what each costs and the
 * line to change here.
 */
export function unsafePhone(i: Integrity | null): boolean {
  // A positive modification must also lock storage in a development build.
  if (i?.device === 'modified') return true;
  if (i?.copy === 'development') return false;
  return !i || integrityClass(i.device) === 'insufficient';
}

/**
 * Whether the user may let Girovo keep its data here anyway: on an unsafe
 * phone (rooted, unlocked, unprovable) running the genuine app. A foreign copy
 * never — whoever signed it decides what it does with the data.
 */
export function mayAllowSaving(i: Integrity | null): i is Integrity {
  return !!i && unsafePhone(i) && i.copy !== 'foreign';
}
