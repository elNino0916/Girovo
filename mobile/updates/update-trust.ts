// What makes an update trustworthy and in which order updates come, shared by
// the release scripts (scripts/update-manifest.mjs, scripts/sign-update.mjs)
// and the GitHub APK's updater. The desktop updater has the same rules in
// Rust (src-tauri/src/updater/trust.rs); both are tested against the same
// numbers. docs/updater-v2.md says how it fits together.
//
// Build numbers. Clients compare one number, never version names, so renaming
// a pre-release can't strand old copies again. A release X.Y.Z is Android's
// version code (MMmmpp × 10, 6.0.2 → 600020) times 10⁹. Its pre-releases sit
// in the slot just below, (code − 1) × 10⁹ + n: a hand-made preview.N has
// n = N (1–99), a nightly n = its stamp's minutes since 2026-01-01 UTC, so
// previews < nightlies < the release, and every 6.0.2 pre-release > 6.0.1.
// CI's development builds ("-dev.<run>", also after a pre-release) count as
// the version they are numbered after. Anything else has no build number and
// is never offered.
//
// Signatures. A release carries girovo-update.json and girovo-update.json.sig:
// an Ed25519 signature over SIGNED_PREFIX + the file's bytes, by the stable key
// (on the owner's PC, password-protected) or the nightly key (an Actions
// secret). A stable manifest must carry the stable key's signature; the
// Nightly channel takes either.

import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import logic from './update-logic.cjs';

/** Signed before the manifest's bytes, so a signature can't be reused for anything else. */
export const SIGNED_PREFIX = 'girovo-update/1\n';
export const SIG_FORMAT = 'girovo-update-sig';
export const MANIFEST_FORMAT = 'girovo-update';

const BUILD_SCALE = 1_000_000_000;
const NIGHTLY_EPOCH = Date.UTC(2026, 0, 1);

/** Android's version code of X.Y.Z (android/app/build.gradle): MMmmpp × 10. */
function versionCode(major: number, minor: number, patch: number): number {
  return (major * 10000 + minor * 100 + patch) * 10;
}

/** Minutes since 2026-01-01 UTC of a nightly stamp yyyymmddhhmm, or null. */
function stampMinutes(stamp: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(stamp);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const at = Date.UTC(y, mo - 1, d, h, mi);
  const minutes = Math.floor((at - NIGHTLY_EPOCH) / 60_000);
  // A stamp before 2026 still sorts after every hand-made preview.
  return Math.min(Math.max(minutes, 100), BUILD_SCALE - 1);
}

/**
 * The build number of a version ("6.0.2", "6.0.2-nightly.202611071832.gc0d6b0c",
 * "6.0.0-preview.3", "6.0.2-dev.41"), or null when it has none.
 */
export function buildNumber(version: string): number | null {
  const m = /^v?(\d{1,3})\.(\d{1,2})\.(\d{1,2})(?:-([0-9A-Za-z.-]+))?$/.exec(String(version ?? '').trim());
  if (!m) return null;
  const code = versionCode(Number(m[1]), Number(m[2]), Number(m[3]));
  // Exact in a double (and the same in Rust's u64) up to 89.99.99.
  if (!Number.isSafeInteger(code * BUILD_SCALE)) return null;
  const pre = (m[4] ?? '').replace(/(?:^|-)dev(?:\.[0-9A-Za-z.-]*)?$/, '');
  if (!pre) return code * BUILD_SCALE;
  const preview = /^preview\.([1-9]\d?)$/.exec(pre);
  if (preview) return (code - 1) * BUILD_SCALE + Number(preview[1]);
  const nightly = /^(?:nightly|preview)\.(\d{12})(?:\.g[0-9a-f]{7,40})?$/.exec(pre);
  if (nightly) {
    const n = stampMinutes(nightly[1]);
    return n == null ? null : (code - 1) * BUILD_SCALE + n;
  }
  return null;
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
export const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** A public key's short name: the first 8 bytes of its SHA-256, in hex. */
export function keyId(publicKey: Uint8Array): string {
  return toHex(sha256(publicKey).subarray(0, 8));
}

/** What a signature signs: the prefix, then the file's bytes. */
export function signedMessage(bytes: Uint8Array): Uint8Array {
  const prefix = new TextEncoder().encode(SIGNED_PREFIX);
  const out = new Uint8Array(prefix.length + bytes.length);
  out.set(prefix);
  out.set(bytes, prefix.length);
  return out;
}

/** The .sig file for `bytes` signed with a 32-byte Ed25519 secret key. */
export function signManifest(bytes: Uint8Array, secretKey: Uint8Array): string {
  const publicKey = ed25519.getPublicKey(secretKey);
  const sig = ed25519.sign(signedMessage(bytes), secretKey);
  return `${JSON.stringify({ format: SIG_FORMAT, v: 1, key: keyId(publicKey), sig: toBase64(sig) }, null, 2)}\n`;
}

export interface TrustedKeys {
  /** Base64 Ed25519 public keys. */
  stable: string;
  nightly: string;
}

/**
 * Which key signed `bytes`: 'stable', 'nightly', or null when the signature
 * is missing, malformed or by neither. Never throws on odd input.
 */
export function verifyManifest(bytes: Uint8Array, sigText: string, keys: TrustedKeys): 'stable' | 'nightly' | null {
  try {
    const sig = JSON.parse(sigText);
    if (sig?.format !== SIG_FORMAT || sig.v !== 1 || typeof sig.sig !== 'string') return null;
    const signature = fromBase64(sig.sig);
    if (signature.length !== 64) return null;
    const message = signedMessage(bytes);
    for (const role of ['stable', 'nightly'] as const) {
      if (!keys[role]) continue;
      const publicKey = fromBase64(keys[role]);
      if (publicKey.length !== 32 || sig.key !== keyId(publicKey)) continue;
      if (ed25519.verify(signature, message, publicKey)) return role;
    }
    return null;
  } catch {
    return null;
  }
}

/** Whether a manifest signed by `signer` may be offered on `channel`. */
export function signerFits(signer: 'stable' | 'nightly' | null, channel: 'stable' | 'nightly'): boolean {
  return signer === 'stable' || (signer === 'nightly' && channel === 'nightly');
}

// ---- girovo.de's listing and the release it offers ----------------------------

/** Where girovo.de answers: `${MANIFEST_BASE}stable.json`, `…/nightly.json` (?kind=apk for the APK). */
export const MANIFEST_BASE = 'https://girovo.de/updates/v1/';
/** The release asset GitHub carries beside the files, and its signature. */
export const MANIFEST_NAME = 'girovo-update.json';
export const SIG_NAME = 'girovo-update.json.sig';

export interface UpdateRelease {
  version: string;
  name: string;
  notes: string;
  url: string;
  publishedAt: string | null;
  assets: { name: string; url: string; size: number; sha256: string | null }[];
}

type Where = { downloadPrefix?: string[]; releasesPage?: string };

/**
 * girovo-update.json as the release the updater works with, its files'
 * hashes from the manifest — or null when it is not a manifest of a release
 * Girovo could take: another format, a build number that is not its
 * version's, a file outside the project's downloads or without a hash. The
 * files go through update-logic's own checks (parseRelease).
 */
export function releaseOf(text: string, opts: Where = {}): UpdateRelease | null {
  try {
    const m = JSON.parse(text);
    if (m?.format !== MANIFEST_FORMAT || m.v !== 1 || typeof m.version !== 'string') return null;
    if (m.build !== buildNumber(m.version) || !Array.isArray(m.files)) return null;
    const files: Record<string, unknown>[] = m.files.flatMap((f: Record<string, unknown>) => (f?.blockmap ? [f, f.blockmap as Record<string, unknown>] : [f]));
    const assets = files.map((f) => ({
      name: f?.name,
      size: f?.size,
      digest: typeof f?.sha256 === 'string' ? `sha256:${f.sha256}` : null,
      browser_download_url: f?.url,
    }));
    const release = logic.parseRelease(
      { tag_name: m.version, name: `Girovo ${m.version}`, body: m.notes, html_url: m.page, published_at: m.published, assets },
      { prerelease: true, ...opts },
    ) as UpdateRelease | null;
    if (!release || release.version !== m.version) return null;
    // Every file the manifest names must have come through, with its hash.
    if (release.assets.length !== files.length || release.assets.some((a) => !a.sha256)) return null;
    return release;
  } catch {
    return null;
  }
}

/** One release as girovo.de lists it. */
export interface Listed {
  version: string;
  /** Percent of installations offered it (100: everybody). */
  rollout: number;
  manifest: string;
  sig: string;
}

/** girovo.de's answer, newest first; null when it is not one. */
export function parseListing(json: unknown): Listed[] | null {
  const v = json as { format?: unknown; v?: unknown; releases?: unknown } | null;
  if (v?.format !== 'girovo-updates' || v.v !== 1 || !Array.isArray(v.releases)) return null;
  return v.releases.flatMap((r: Record<string, unknown>) => {
    if (typeof r?.version !== 'string' || typeof r.manifest !== 'string' || typeof r.sig !== 'string') return [];
    const rollout = typeof r.rollout === 'number' && Number.isFinite(r.rollout) ? Math.min(100, Math.max(0, r.rollout)) : 100;
    return [{ version: r.version, rollout, manifest: r.manifest, sig: r.sig }];
  });
}

/**
 * This installation's bucket 0–99 for `version` (the desktop's
 * trust::bucket): the same for every check of a version, different from
 * version to version, so the same copies are not always the first.
 */
export function bucket(installId: string, version: string): number {
  const d = sha256(new TextEncoder().encode(`${installId}|${version}`));
  return ((d[0] << 8) | d[1]) % 100;
}

/** Whether a release offered to `rollout` percent reaches this installation; `early`: "Neueste Updates sofort erhalten". */
export function reaches(rollout: number, slot: number, early: boolean): boolean {
  return early || rollout >= 100 || slot < rollout;
}

/**
 * The release to offer from girovo.de's listing: the first one signed with a
 * key that fits the channel, readable, and reaching this installation.
 */
export function pickListed(
  listing: Listed[],
  channel: 'stable' | 'nightly',
  keys: TrustedKeys,
  installId: string,
  early: boolean,
  opts: Where = {},
): UpdateRelease | null {
  for (const l of listing) {
    if (!signerFits(verifyManifest(new TextEncoder().encode(l.manifest), l.sig, keys), channel)) continue;
    const release = releaseOf(l.manifest, opts);
    if (!release || release.version !== l.version) continue;
    if (reaches(l.rollout, bucket(installId, release.version), early)) return release;
  }
  return null;
}
