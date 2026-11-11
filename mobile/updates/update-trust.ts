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
// Pre-releases named <word>.<yyyymmddhhmm>[.g<sha>] (nightly, the old
// preview.<stamp>, next, and any channel's word) are numbered like a nightly.
//
// Signatures. A release carries girovo-update.json and girovo-update.json.sig:
// an Ed25519 signature over SIGNED_PREFIX + the file's bytes, by one of the
// keys built into the app (update-keys.ts), each with a role. Which roles a
// channel takes, and which manifest `channel` it takes from each, is the
// channel-fit rule (fitsChannel, docs/update-channels.md).
//
// Channels. Stabil and Nightly are built in. girovo.de can add more with a
// channel list signed by the stable key over CHANNELS_PREFIX + the list's
// bytes; the list can only name the built-in key roles, never add a key.

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
  const nightly = /^[a-z][a-z0-9]{1,15}\.(\d{12})(?:\.g[0-9a-f]{7,40})?$/.exec(pre);
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

/** `prefix`'s UTF-8 bytes, then `bytes`. */
function prefixed(prefix: string, bytes: Uint8Array): Uint8Array {
  const head = new TextEncoder().encode(prefix);
  const out = new Uint8Array(head.length + bytes.length);
  out.set(head);
  out.set(bytes, head.length);
  return out;
}

/** What a signature signs: the prefix, then the file's bytes. */
export function signedMessage(bytes: Uint8Array): Uint8Array {
  return prefixed(SIGNED_PREFIX, bytes);
}

/** A .sig file's text for `message` signed with a 32-byte Ed25519 secret key. */
function signText(message: Uint8Array, secretKey: Uint8Array): string {
  const publicKey = ed25519.getPublicKey(secretKey);
  const sig = ed25519.sign(message, secretKey);
  return `${JSON.stringify({ format: SIG_FORMAT, v: 1, key: keyId(publicKey), sig: toBase64(sig) }, null, 2)}\n`;
}

/** The .sig file for `bytes` signed with a 32-byte Ed25519 secret key. */
export function signManifest(bytes: Uint8Array, secretKey: Uint8Array): string {
  return signText(signedMessage(bytes), secretKey);
}

/** The roles of the keys built into the app (docs/update-channels.md), in the order a signature is tried. */
export const KEY_ROLES = ['stable', 'nightly', 'next', 'reserve1', 'reserve2'] as const;
export type KeyRole = (typeof KEY_ROLES)[number];

/** Base64 Ed25519 public keys by role. A missing or empty key trusts nothing. */
export interface TrustedKeys {
  stable: string;
  nightly: string;
  next?: string;
  reserve1?: string;
  reserve2?: string;
}

/** Which of `roles`' keys made the signature `sigText` over `message`, or null. Never throws on odd input. */
function verifySigned(message: Uint8Array, sigText: string, keys: TrustedKeys, roles: readonly KeyRole[]): KeyRole | null {
  try {
    const sig = JSON.parse(sigText);
    if (sig?.format !== SIG_FORMAT || sig.v !== 1 || typeof sig.sig !== 'string' || typeof sig.key !== 'string') return null;
    const signature = fromBase64(sig.sig);
    if (signature.length !== 64) return null;
    for (const role of roles) {
      const key = keys[role];
      if (typeof key !== 'string' || !key) continue;
      const publicKey = fromBase64(key);
      if (publicKey.length !== 32 || sig.key !== keyId(publicKey)) continue;
      if (ed25519.verify(signature, message, publicKey)) return role;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Which key signed `bytes`: its role, or null when the signature is missing,
 * malformed or by none of the app's keys. Never throws on odd input.
 */
export function verifyManifest(bytes: Uint8Array, sigText: string, keys: TrustedKeys): KeyRole | null {
  return verifySigned(signedMessage(bytes), sigText, keys, KEY_ROLES);
}

/** A channel as the fit rule sees it: the key roles it takes and the manifest `channel` it is named by. */
export interface ChannelRule {
  id: string;
  keys: readonly KeyRole[];
  manifest: string;
}

export const STABLE_CHANNEL: ChannelRule = Object.freeze({ id: 'stable', keys: Object.freeze(['stable'] as const), manifest: 'stable' });
/** Nightly, stored as 'preview' since before it was renamed. */
export const PREVIEW_CHANNEL: ChannelRule = Object.freeze({ id: 'preview', keys: Object.freeze(['stable', 'nightly'] as const), manifest: 'nightly' });

/**
 * Whether a manifest (its text) signed by `role` may be offered on `channel`:
 * the role is one the channel takes, the manifest's `channel` is "stable" or
 * the channel's own, and only the stable key may sign one that says "stable".
 * A manifest without a `channel` text says "stable" when the stable key
 * signed it, "nightly" when the nightly key did, and fits nowhere otherwise.
 */
export function fitsChannel(role: KeyRole | null, manifestText: string, channel: ChannelRule): boolean {
  if (!role || !channel.keys.includes(role)) return false;
  let named: unknown;
  try {
    const m = JSON.parse(manifestText);
    if (!m || typeof m !== 'object') return false;
    named = m.channel;
  } catch {
    return false;
  }
  const said = typeof named === 'string' ? named : role === 'stable' ? 'stable' : role === 'nightly' ? 'nightly' : null;
  if (said == null) return false;
  if (said === 'stable') return role === 'stable';
  return said === channel.manifest;
}

// ---- girovo.de's listing and the release it offers ----------------------------

/** Where girovo.de answers: `${MANIFEST_BASE}stable.json`, `…/nightly.json`, `…/<id>.json` (?kind=apk for the APK), and `…/channels.json`. */
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
    // A number, as the desktop reads it (trust.rs): "build": null beside a version without a build number is no match.
    if (typeof m.build !== 'number' || !Number.isSafeInteger(m.build) || m.build !== buildNumber(m.version)) return null;
    if (!Array.isArray(m.files)) return null;
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

/** The name of a channel's listing on girovo.de, `${MANIFEST_BASE}<name>.json`: its manifest name (nightly.json for Nightly). */
export const listingName = (channel: ChannelRule) => channel.manifest;

/**
 * The release to offer from girovo.de's listing: the first one whose signed
 * manifest fits the channel, readable, and reaching this installation.
 */
export function pickListed(
  listing: Listed[],
  channel: ChannelRule,
  keys: TrustedKeys,
  installId: string,
  early: boolean,
  opts: Where = {},
): UpdateRelease | null {
  for (const l of listing) {
    if (!fitsChannel(verifyManifest(new TextEncoder().encode(l.manifest), l.sig, keys), l.manifest, channel)) continue;
    const release = releaseOf(l.manifest, opts);
    if (!release || release.version !== l.version) continue;
    if (reaches(l.rollout, bucket(installId, release.version), early)) return release;
  }
  return null;
}

// ---- the channel list girovo.de serves -----------------------------------------
//
// girovo.de decides what is offered, the app decides what is trusted: a list
// channel can only name key roles built into the app, and the list itself
// counts only when the stable key signed it (docs/update-channels.md).

/** Signed before the list's bytes, so a release signature can never pass as a list signature, nor the other way round. */
export const CHANNELS_PREFIX = 'girovo-channels/1\n';
export const CHANNELS_FORMAT = 'girovo-channels';
export const CHANNEL_LIST_FORMAT = 'girovo-channel-list';
/** Only the first entries of a list count. */
export const MAX_LIST_CHANNELS = 8;

export const PLATFORMS = ['desktop', 'apk'] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface Texts {
  de: string;
  en: string;
}

/** One channel of the list, every default filled in. */
export interface ListChannel {
  id: string;
  keys: KeyRole[];
  usage: boolean;
  hidden: boolean;
  ended: boolean;
  /** Where a copy on this channel goes once it has ended: 'stable', 'preview' or another id of the list. */
  then: string;
  platforms: Platform[];
  name: Texts;
  hint: Texts;
}

/** A list as read for every platform, with the entries it dropped and why (for sign-update.mjs). */
export interface ChannelListRead {
  serial: number;
  channels: ListChannel[];
  dropped: { index: number; id: unknown; reason: string }[];
}

/** A list as one platform holds it. */
export interface ChannelList {
  serial: number;
  channels: ListChannel[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const length = (text: string) => [...text].length;

/** `{ de, en }` with each text's length in [min, max], or null. */
function textsOf(v: unknown, min: number, max: number): Texts | null {
  if (!isRecord(v) || typeof v.de !== 'string' || typeof v.en !== 'string') return null;
  const ok = (t: string) => length(t) >= min && length(t) <= max;
  return ok(v.de) && ok(v.en) ? { de: v.de, en: v.en } : null;
}

/** One entry with its defaults, or the reason it doesn't fit. Whether `then` names a channel of the list is checked afterwards. */
function entryOf(raw: unknown): ListChannel | string {
  if (!isRecord(raw)) return 'not an object';
  const { id } = raw;
  if (!logic.isChannelId(id)) return 'id';
  if (!Array.isArray(raw.keys) || !raw.keys.length || !raw.keys.every((k) => (KEY_ROLES as readonly unknown[]).includes(k))) return 'keys';
  const flag = (name: string, fallback: boolean) => (raw[name] === undefined ? fallback : typeof raw[name] === 'boolean' ? (raw[name] as boolean) : null);
  const usage = flag('usage', true);
  const hidden = flag('hidden', false);
  const ended = flag('ended', false);
  if (usage == null) return 'usage';
  if (hidden == null) return 'hidden';
  if (ended == null) return 'ended';
  const platforms = raw.platforms === undefined ? ['desktop'] : raw.platforms;
  if (!Array.isArray(platforms) || !platforms.length || !platforms.every((p) => (PLATFORMS as readonly unknown[]).includes(p))) return 'platforms';
  const then = raw.then === undefined ? 'stable' : raw.then;
  if (typeof then !== 'string' || then === id) return 'then';
  const name = textsOf(raw.name, 1, 24);
  if (!name) return 'name';
  const hint = raw.hint === undefined ? { de: '', en: '' } : textsOf(raw.hint, 0, 120);
  if (!hint) return 'hint';
  return {
    id: id as string,
    keys: [...new Set(raw.keys as KeyRole[])],
    usage,
    hidden,
    ended,
    then,
    platforms: [...new Set(platforms as Platform[])],
    name,
    hint,
  };
}

/**
 * The list's text read for every platform: null when it is no list at all
 * (another format, no serial ≥ 1), else its channels and what it dropped.
 * An entry that doesn't fit drops that entry, not the list; unknown fields
 * are ignored; only the first MAX_LIST_CHANNELS entries count; an entry whose
 * id an earlier entry had is dropped.
 */
export function readChannelList(text: string): ChannelListRead | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(v) || v.format !== CHANNEL_LIST_FORMAT || v.v !== 1) return null;
  if (typeof v.serial !== 'number' || !Number.isSafeInteger(v.serial) || v.serial < 1) return null;
  if (!Array.isArray(v.channels)) return null;
  const dropped: ChannelListRead['dropped'] = [];
  const seen = new Set<unknown>();
  const kept: { index: number; entry: ListChannel }[] = [];
  v.channels.forEach((raw: unknown, index: number) => {
    const id = isRecord(raw) ? raw.id : undefined;
    if (index >= MAX_LIST_CHANNELS) {
      dropped.push({ index, id, reason: `past the first ${MAX_LIST_CHANNELS}` });
      return;
    }
    const duplicate = typeof id === 'string' && seen.has(id);
    if (typeof id === 'string') seen.add(id);
    if (duplicate) {
      dropped.push({ index, id, reason: 'duplicate id' });
      return;
    }
    const entry = entryOf(raw);
    if (typeof entry === 'string') dropped.push({ index, id, reason: entry });
    else kept.push({ index, entry });
  });
  // `then` names Stabil, Nightly or another channel the list kept.
  const ids = new Set(kept.map((k) => k.entry.id));
  const channels: ListChannel[] = [];
  for (const { index, entry } of kept) {
    if (entry.then === 'stable' || entry.then === 'preview' || ids.has(entry.then)) channels.push(entry);
    else dropped.push({ index, id: entry.id, reason: 'then' });
  }
  dropped.sort((a, b) => a.index - b.index);
  return { serial: v.serial, channels, dropped };
}

/**
 * The channels of a list read that count on `platform`. An entry for other
 * platforms counts as absent, except an ended one: all it can still do is
 * send copies on it to its `then`, which is safe on every platform (and what
 * the shared test list expects of `old` on the APK).
 */
export function channelsFor(list: { channels: ListChannel[] }, platform: Platform): ListChannel[] {
  return list.channels.filter((c) => c.ended || c.platforms.includes(platform));
}

/** The list's text as `platform` holds it, or null when it is no list. */
export function parseChannelList(text: string, platform: Platform): ChannelList | null {
  const read = readChannelList(text);
  return read && { serial: read.serial, channels: channelsFor(read, platform) };
}

/** What a list signature signs: the list prefix, then the list's UTF-8 bytes. */
export function channelsMessage(listText: string): Uint8Array {
  return prefixed(CHANNELS_PREFIX, new TextEncoder().encode(listText));
}

/** The envelope girovo.de serves for `listText`, signed with a 32-byte Ed25519 secret key. */
export function signChannelList(listText: string, secretKey: Uint8Array): string {
  const sig = signText(channelsMessage(listText), secretKey);
  return `${JSON.stringify({ format: CHANNELS_FORMAT, v: 1, list: listText, sig }, null, 2)}\n`;
}

/** The list's text in an envelope signed by the stable key, else null. Never throws on odd input. */
export function verifiedListText(envelopeText: string | null | undefined, keys: TrustedKeys): string | null {
  try {
    const e = JSON.parse(envelopeText ?? 'null');
    if (!isRecord(e) || e.format !== CHANNELS_FORMAT || e.v !== 1 || typeof e.list !== 'string' || typeof e.sig !== 'string') return null;
    return verifySigned(channelsMessage(e.list), e.sig, keys, ['stable']) === 'stable' ? e.list : null;
  } catch {
    return null;
  }
}

/** An envelope's list as `platform` holds it, when the stable key signed it; else null. */
export function verifyChannels(envelopeText: string | null | undefined, keys: TrustedKeys, platform: Platform): ChannelList | null {
  const text = verifiedListText(envelopeText, keys);
  return text == null ? null : parseChannelList(text, platform);
}

/**
 * A fetched envelope's list, when it may replace the one held: signed by the
 * stable key, and its serial at least the held list's, so an old signed list
 * can't be served again to bring back a channel. Null: keep what is held.
 */
export function acceptChannels(envelopeText: string, held: ChannelList | null, keys: TrustedKeys, platform: Platform): ChannelList | null {
  const list = verifyChannels(envelopeText, keys, platform);
  if (!list || (held && list.serial < held.serial)) return null;
  return list;
}

/** A list channel as the fit rule sees it: its keys, and its id as the manifest name. */
export const ruleOf = (channel: ListChannel): ChannelRule => ({ id: channel.id, keys: channel.keys, manifest: channel.id });

/**
 * The channel a stored value stands for, given the list held (null: none).
 * `id` is the channel the copy is on and `rule` what it takes; `moveTo` is
 * the value to store instead, as if the user had picked it, or null to keep
 * the stored one. Stabil and Nightly are themselves. A list id the list
 * doesn't have (or not for this platform) moves to Stabil; an ended one to
 * its `then`, followed as far as it goes (a loop ends on Stabil). With no
 * list held a list id is checked as Stabil, and the stored value stays until
 * a list arrives.
 */
export function resolveChannel(stored: unknown, list: ChannelList | null): { id: string; rule: ChannelRule; moveTo: string | null } {
  const wanted: string = logic.channelOf(stored);
  const done = (id: string, rule: ChannelRule) => ({ id, rule, moveTo: id === wanted ? null : id });
  if (wanted === 'stable') return done('stable', STABLE_CHANNEL);
  if (wanted === 'preview') return done('preview', PREVIEW_CHANNEL);
  if (!list) return { id: 'stable', rule: STABLE_CHANNEL, moveTo: null };
  const visited = new Set<string>();
  let at = wanted;
  for (;;) {
    if (at === 'stable') return done('stable', STABLE_CHANNEL);
    if (at === 'preview') return done('preview', PREVIEW_CHANNEL);
    const entry = list.channels.find((c) => c.id === at);
    if (!entry || visited.has(at)) return done('stable', STABLE_CHANNEL);
    if (!entry.ended) return done(entry.id, ruleOf(entry));
    visited.add(at);
    at = entry.then;
  }
}

/** A channel the page may offer (ElectronUpdateState.channels). Built-ins are named by the app's own texts. */
export interface OfferedChannel {
  id: string;
  builtin: boolean;
  usage: boolean;
  name?: Texts;
  hint?: Texts;
}

/**
 * The channels to offer on the page: Stabil, Nightly, then the list's
 * channels (for this platform) that are neither hidden nor ended, the
 * current one also when hidden.
 */
export function offeredChannels(list: ChannelList | null, current: string): OfferedChannel[] {
  const listed = (list?.channels ?? [])
    .filter((c) => !c.ended && (!c.hidden || c.id === current))
    .map((c) => ({ id: c.id, builtin: false, usage: c.usage, name: { ...c.name }, hint: { ...c.hint } }));
  return [{ id: 'stable', builtin: true, usage: false }, { id: 'preview', builtin: true, usage: true }, ...listed];
}
