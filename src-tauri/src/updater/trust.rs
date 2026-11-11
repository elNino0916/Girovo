// What makes an update trustworthy and in which order updates come:
// mobile/updates/update-trust.ts in Rust, tested against the same numbers
// (docs/updater-v2.md, docs/update-channels.md).
//
// girovo.de lists each channel's newest release as the release itself
// published it: girovo-update.json and its Ed25519 signature, by one of the
// keys built into the app (the stable key on the owner's PC, the nightly key
// an Actions secret, next and the two reserves for channels girovo.de adds).
// Nothing in between has to be trusted: a channel takes a manifest only when
// the key and the manifest's own `channel` field fit it (fits), and
// girovo.de's channel list, signed with the stable key, can only point at
// keys built in here. The files' SHA-256 come from the signed manifest; the
// download is checked against them.
//
// Build numbers: a release X.Y.Z is Android's version code (MMmmpp × 10)
// times 10⁹; its pre-releases sit just below, (code − 1) × 10⁹ + n, with
// n = N for a hand-made preview.N and a stamped build's (nightly, next, …)
// minutes since 2026-01-01 UTC. Development builds count as the version they
// are numbered after.

use std::collections::HashSet;
use std::sync::LazyLock;

use aws_lc_rs::signature::{self, UnparsedPublicKey};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use regex::Regex;
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::logic::{self, Channel, Origin, Release};

/// Where girovo.de answers: "<base>stable.json", "<base>nightly.json", "<base><id>.json" and "<base>channels.json".
pub const MANIFEST_BASE: &str = "https://girovo.de/updates/v1/";
/// girovo.de's signed channel list, beside the listings.
pub const CHANNELS_NAME: &str = "channels.json";
/// The release asset GitHub carries beside the files, and its signature.
pub const MANIFEST_NAME: &str = "girovo-update.json";
pub const SIG_NAME: &str = "girovo-update.json.sig";
/// Signed before the manifest's bytes, so a signature can't be reused for anything else.
const SIGNED_PREFIX: &[u8] = b"girovo-update/1\n";
/// Signed before the channel list's text: a release's signature never passes
/// as the list's, nor the other way round.
const CHANNELS_PREFIX: &[u8] = b"girovo-channels/1\n";
/// A manifest, a signature or the channel list is a few kilobytes; anything far past that is not one.
pub const MAX_MANIFEST_BYTES: usize = 256 * 1024;

/// The public keys (mobile/updates/update-keys.ts has the same). An empty one trusts nothing.
const STABLE_KEY: &str = "hIxe7Pv8XxowIliZVYOGpjwtWsHKCWgi2LEIwbIZmrw=";
const NIGHTLY_KEY: &str = "HdD/wUqH5Grzgw94akcTP+nFREWm9XoD1k2C2s1AHTU=";
const NEXT_KEY: &str = "zQJdGVv0+4TldBFYP01ytg3EQLTx2UFl8Gx3fGUKUys=";
// The reserves' secret halves are in the owner's keys folder, password-protected, for a channel added later.
const RESERVE1_KEY: &str = "YgrdSul6VVLATln2k+5j10m5g2Mub/TvluNFQN2b7qI=";
const RESERVE2_KEY: &str = "6dIg96Dt62Zlcatu/sMZ/scsYqaewIksz04rTnhtFhs=";

const BUILD_SCALE: u64 = 1_000_000_000;
/// JavaScript's Number.MAX_SAFE_INTEGER: past it the app's two halves would disagree.
const MAX_BUILD: u64 = 9_007_199_254_740_991;

/// What a key may sign, by the name girovo.de's channel list gives it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
  Stable,
  Nightly,
  Next,
  Reserve1,
  Reserve2,
}

impl Role {
  pub const ALL: [Role; 5] = [Role::Stable, Role::Nightly, Role::Next, Role::Reserve1, Role::Reserve2];

  pub fn name(self) -> &'static str {
    match self {
      Role::Stable => "stable",
      Role::Nightly => "nightly",
      Role::Next => "next",
      Role::Reserve1 => "reserve1",
      Role::Reserve2 => "reserve2",
    }
  }

  pub fn from_name(name: &str) -> Option<Role> {
    Role::ALL.into_iter().find(|r| r.name() == name)
  }
}

#[derive(Clone, Debug, Default)]
pub struct Keys {
  pub stable: Vec<u8>,
  pub nightly: Vec<u8>,
  pub next: Vec<u8>,
  pub reserve1: Vec<u8>,
  pub reserve2: Vec<u8>,
}

impl Keys {
  pub fn builtin() -> Keys {
    let key = |text: &str| BASE64.decode(text).unwrap_or_default();
    Keys {
      stable: key(STABLE_KEY),
      nightly: key(NIGHTLY_KEY),
      next: key(NEXT_KEY),
      reserve1: key(RESERVE1_KEY),
      reserve2: key(RESERVE2_KEY),
    }
  }

  pub fn of(&self, role: Role) -> &[u8] {
    match role {
      Role::Stable => &self.stable,
      Role::Nightly => &self.nightly,
      Role::Next => &self.next,
      Role::Reserve1 => &self.reserve1,
      Role::Reserve2 => &self.reserve2,
    }
  }
}

// ---- build numbers ---------------------------------------------------------------

static VERSION: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^v?(\d{1,3})\.(\d{1,2})\.(\d{1,2})(?:-([0-9A-Za-z.-]+))?$").unwrap());
static DEV: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?:^|-)dev(?:\.[0-9A-Za-z.-]*)?$").unwrap());
static PREVIEW: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^preview\.([1-9]\d?)$").unwrap());
/// A stamped pre-release: nightly.<stamp>, the old preview.<stamp>, next.<stamp>, any channel's word alike.
static STAMPED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-z][a-z0-9]{1,15}\.(\d{12})(?:\.g[0-9a-f]{7,40})?$").unwrap());

/// Minutes since 2026-01-01 UTC of a stamp yyyymmddhhmm, or None.
fn stamp_minutes(stamp: &str) -> Option<u64> {
  let n = |from: usize, len: usize| stamp.get(from..from + len)?.parse::<i64>().ok();
  let (y, mo, d, h, mi) = (n(0, 4)?, n(4, 2)?, n(6, 2)?, n(8, 2)?, n(10, 2)?);
  if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 {
    return None;
  }
  let minutes = (logic::days_from_civil(y, mo, d) - logic::days_from_civil(2026, 1, 1)) * 1440 + h * 60 + mi;
  // A stamp before 2026 still sorts after every hand-made preview.
  Some(minutes.clamp(100, BUILD_SCALE as i64 - 1) as u64)
}

/// The build number of a version ("6.0.2", "6.0.2-nightly.202611071832.gc0d6b0c",
/// "6.2.0-next.202611111200", "6.0.0-preview.3", "6.0.2-dev.41"), or None when it has none.
pub fn build_number(version: &str) -> Option<u64> {
  let caps = VERSION.captures(version.trim())?;
  let part = |i: usize| caps.get(i).and_then(|m| m.as_str().parse::<u64>().ok());
  let code = (part(1)? * 10000 + part(2)? * 100 + part(3)?) * 10;
  if code * BUILD_SCALE > MAX_BUILD {
    return None;
  }
  let pre = caps.get(4).map_or("", |m| m.as_str());
  let pre = DEV.replace(pre, "");
  if pre.is_empty() {
    return Some(code * BUILD_SCALE);
  }
  // The slot below the release. 0.0.0 has none: its pre-releases have no build number.
  let below = code.checked_sub(1)? * BUILD_SCALE;
  if let Some(p) = PREVIEW.captures(&pre) {
    return Some(below + p[1].parse::<u64>().ok()?);
  }
  let n = stamp_minutes(&STAMPED.captures(&pre)?[1])?;
  Some(below + n)
}

/// Whether `version` is a pre-release by its build number: a stamped build or
/// a preview, in the slot below its release. Not a release, and not a
/// development build, which counts as the version it is numbered after.
pub fn is_prerelease(version: &str) -> bool {
  build_number(version).is_some_and(|build| build % BUILD_SCALE != 0)
}

// ---- signatures ---------------------------------------------------------------

/// A public key's short name: the first 8 bytes of its SHA-256, in hex.
pub fn key_id(public_key: &[u8]) -> String {
  Sha256::digest(public_key)[..8].iter().map(|b| format!("{b:02x}")).collect()
}

fn signed_message(bytes: &[u8]) -> Vec<u8> {
  [SIGNED_PREFIX, bytes].concat()
}

/// Which of `roles` signed `message` (the prefix included), or None when the
/// signature is missing, malformed or by none of them. An empty or malformed
/// key never matches. Never panics on odd input.
fn verify_with(message: &[u8], sig_text: &str, keys: &Keys, roles: &[Role]) -> Option<Role> {
  let sig: Value = serde_json::from_str(sig_text).ok()?;
  if sig.get("format")?.as_str()? != "girovo-update-sig" || sig.get("v")?.as_u64()? != 1 {
    return None;
  }
  let signature = BASE64.decode(sig.get("sig")?.as_str()?).ok().filter(|s| s.len() == 64)?;
  let named = sig.get("key")?.as_str()?;
  roles.iter().copied().find(|&role| {
    let key = keys.of(role);
    key.len() == 32 && named == key_id(key) && UnparsedPublicKey::new(&signature::ED25519, key).verify(message, &signature).is_ok()
  })
}

/// Which key signed the manifest `bytes`, or None when the signature is
/// missing, malformed or by none of the built-in keys.
pub fn verify(bytes: &[u8], sig_text: &str, keys: &Keys) -> Option<Role> {
  verify_with(&signed_message(bytes), sig_text, keys, &Role::ALL)
}

/// The manifest's own `channel` field, when it is a string.
pub fn manifest_channel(bytes: &[u8]) -> Option<String> {
  serde_json::from_slice::<Value>(bytes).ok()?.get("channel")?.as_str().map(str::to_string)
}

/// Whether a manifest signed by `signer`, naming `named` in its `channel`
/// field, may be offered on `channel` (docs/update-channels.md): the key is
/// one of the channel's, the manifest names "stable" or the channel's
/// manifest name, and only the stable key signs one named "stable". A
/// manifest naming no channel counts as "stable" by the stable key, as
/// "nightly" by the nightly key, and is refused by any other.
pub fn fits(signer: Option<Role>, named: Option<&str>, channel: &Channel) -> bool {
  let Some(role) = signer else { return false };
  let named = match (named, role) {
    (Some(named), _) => named,
    (None, Role::Stable) => "stable",
    (None, Role::Nightly) => "nightly",
    (None, _) => return false,
  };
  channel.keys.contains(&role) && (named == "stable" || named == channel.manifest) && (named != "stable" || role == Role::Stable)
}

/// The same for a manifest and its signature as they came.
pub fn fits_manifest(bytes: &[u8], sig_text: &str, keys: &Keys, channel: &Channel) -> bool {
  fits(verify(bytes, sig_text, keys), manifest_channel(bytes).as_deref(), channel)
}

/// The rule where there is no channel to go by, a file the user picked
/// (engine::check_file): the stable key signs any version, every other key
/// only a pre-release. A release signed with another key is not Girovo's
/// release.
pub fn signer_fits_version(signer: Option<Role>, version: &str) -> bool {
  match signer {
    Some(Role::Stable) => true,
    Some(_) => is_prerelease(version),
    None => false,
  }
}

// ---- staged rollout --------------------------------------------------------------

/// This installation's bucket 0–99 for `version`: the same for every check of
/// that version, different from version to version, so the same copies are
/// not always the first.
pub fn bucket(install_id: &str, version: &str) -> u8 {
  let d = Sha256::digest(format!("{install_id}|{version}").as_bytes());
  (u16::from_be_bytes([d[0], d[1]]) % 100) as u8
}

/// Whether a release offered to `rollout` percent reaches this installation.
/// `early`: "Neueste Updates erhalten, sobald sie verfügbar sind".
pub fn reaches(rollout: f64, bucket: u8, early: bool) -> bool {
  early || rollout >= 100.0 || f64::from(bucket) < rollout
}

// ---- the manifest ----------------------------------------------------------------

/// girovo-update.json as a Release, its files' hashes from the manifest, or
/// None when it is not a manifest of a release Girovo could take: another
/// format, a version not written as a release names it ("v6.0.2", "06.0.2":
/// update-trust.ts refuses those too), a build number that is not its
/// version's, files outside the project's downloads.
pub fn release_of(bytes: &[u8], origin: &Origin) -> Option<Release> {
  let m: Value = serde_json::from_slice(bytes).ok()?;
  if m.get("format")?.as_str()? != "girovo-update" || m.get("v")?.as_u64()? != 1 {
    return None;
  }
  let version = m.get("version")?.as_str()?.to_string();
  if !logic::is_plain_version(&version) || Some(m.get("build")?.as_u64()?) != build_number(&version) {
    return None;
  }
  // Each file through the same checks as GitHub's own listing (logic::parse_asset).
  let as_asset = |f: &Value| {
    let digest = f.get("sha256").and_then(Value::as_str).map(|h| format!("sha256:{h}"));
    logic::parse_asset(&json!({ "name": f.get("name"), "size": f.get("size"), "digest": digest, "browser_download_url": f.get("url") }), origin)
      .filter(|a| a.sha256.is_some())
  };
  let mut assets = Vec::new();
  for f in m.get("files")?.as_array()? {
    assets.push(as_asset(f)?);
    if let Some(map) = f.get("blockmap").filter(|b| !b.is_null()) {
      assets.push(as_asset(map)?);
    }
  }
  let str_of = |key: &str| m.get(key).and_then(Value::as_str);
  Some(Release {
    name: format!("Girovo {version}"),
    notes: logic::first_chars(str_of("notes").unwrap_or(""), logic::MAX_NOTES_CHARS),
    url: logic::release_page_or(str_of("page"), &origin.releases_page),
    published_at: str_of("published").and_then(logic::iso_instant),
    assets,
    version,
  })
}

/// One release as girovo.de lists it.
#[derive(Clone, Debug)]
pub struct Listed {
  pub version: String,
  /// Percent of installations offered it (100: everybody).
  pub rollout: f64,
  pub manifest: String,
  pub sig: String,
}

/// girovo.de's answer, newest first; None when it is not one.
pub fn parse_listing(bytes: &[u8]) -> Option<Vec<Listed>> {
  let v: Value = serde_json::from_slice(bytes).ok()?;
  if v.get("format")?.as_str()? != "girovo-updates" || v.get("v")?.as_u64()? != 1 {
    return None;
  }
  let list = v.get("releases")?.as_array()?;
  Some(
    list
      .iter()
      .filter_map(|r| {
        Some(Listed {
          version: r.get("version")?.as_str()?.to_string(),
          rollout: r.get("rollout").and_then(Value::as_f64).unwrap_or(100.0).clamp(0.0, 100.0),
          manifest: r.get("manifest")?.as_str()?.to_string(),
          sig: r.get("sig")?.as_str()?.to_string(),
        })
      })
      .collect(),
  )
}

/// The release to offer from girovo.de's listing: the first one whose
/// signature and manifest fit the channel, readable, and reaching this installation.
pub fn pick_listed(listing: &[Listed], channel: &Channel, keys: &Keys, origin: &Origin, install_id: &str, early: bool) -> Option<Release> {
  listing.iter().find_map(|l| {
    if !fits_manifest(l.manifest.as_bytes(), &l.sig, keys, channel) {
      return None;
    }
    let release = release_of(l.manifest.as_bytes(), origin).filter(|r| r.version == l.version)?;
    reaches(l.rollout, bucket(install_id, &release.version), early).then_some(release)
  })
}

// ---- girovo.de's channel list ------------------------------------------------------
//
// girovo.de decides what is offered, the app decides what is trusted: the
// list names channels and which built-in keys each takes, and is believed
// only with the stable key's signature (docs/update-channels.md).

/// Which half of the app reads the list: an entry for another one counts as absent.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Platform {
  Desktop,
  Apk,
}

/// A text of the list in both of the app's languages.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Localized {
  pub de: String,
  pub en: String,
}

/// One channel of the list.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ListedChannel {
  /// The stored channel value, the listing (`<id>.json`) and the manifest name.
  pub id: String,
  pub keys: Vec<Role>,
  /// Choosing it requires usage data.
  pub usage: bool,
  /// Not offered unless it is the current channel.
  pub hidden: bool,
  /// A copy on it moves to `then`.
  pub ended: bool,
  pub then: String,
  pub name: Localized,
  pub hint: Localized,
}

/// The list as one platform reads it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChannelList {
  pub serial: u64,
  pub channels: Vec<ListedChannel>,
}

impl ChannelList {
  pub fn get(&self, id: &str) -> Option<&ListedChannel> {
    self.channels.iter().find(|c| c.id == id)
  }
}

/// Only the first entries of a list count.
const MAX_LISTED_CHANNELS: usize = 8;
const MAX_NAME_CHARS: usize = 24;
const MAX_HINT_CHARS: usize = 120;
static LIST_ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-z][a-z0-9]{1,15}$").unwrap());

/// Whether `id` may name a channel of the list: never a built-in one, nor the
/// Nightly channel's listing.
pub fn is_list_id(id: &str) -> bool {
  LIST_ID.is_match(id) && !matches!(id, "stable" | "preview" | "nightly")
}

/// girovo.de's channel list (channels.json's text) as it applies to
/// `platform`, or None when it is not a list signed with the stable key. An
/// entry that does not fit is dropped, not the list: a bad id, keys that are
/// missing, empty or not built in, a field of the wrong kind, a name or hint
/// of the wrong length, a `then` that is not "stable", "preview" or another
/// channel the list kept, an id an earlier entry had. Unknown fields are
/// ignored; only the first entries count. update-trust.ts readChannelList
/// reads it the same way.
pub fn read_channels(envelope: &str, keys: &Keys, platform: Platform) -> Option<ChannelList> {
  let e: Value = serde_json::from_str(envelope).ok()?;
  if e.get("format")?.as_str()? != "girovo-channels" || e.get("v")?.as_u64()? != 1 {
    return None;
  }
  let text = e.get("list")?.as_str()?;
  verify_with(&[CHANNELS_PREFIX, text.as_bytes()].concat(), e.get("sig")?.as_str()?, keys, &[Role::Stable])?;
  let list: Value = serde_json::from_str(text).ok()?;
  if list.get("format")?.as_str()? != "girovo-channel-list" || list.get("v")?.as_u64()? != 1 {
    return None;
  }
  let serial = logic::safe_uint(list.get("serial")?).filter(|&n| n >= 1)?;
  // An id an earlier entry had, fitting or not, drops the later one.
  let mut seen = HashSet::new();
  let mut kept = Vec::new();
  for entry in list.get("channels")?.as_array()?.iter().take(MAX_LISTED_CHANNELS) {
    if let Some(id) = entry.get("id").and_then(Value::as_str)
      && !seen.insert(id.to_string())
    {
      continue;
    }
    if let Some(read) = listed_channel(entry) {
      kept.push(read);
    }
  }
  // `then` may name any channel the list kept, on whichever platform: one
  // absent here sends a copy on to stable when it is followed (logic::resolve_channel).
  let ids: HashSet<String> = kept.iter().map(|(c, _)| c.id.clone()).collect();
  let channels = kept
    .into_iter()
    .filter(|(c, platforms)| {
      let then_known = matches!(c.then.as_str(), "stable" | "preview") || ids.contains(&c.then);
      // An ended channel counts everywhere: all it still does is send copies
      // on it to its `then`, which is safe on every platform.
      then_known && (c.ended || platforms.contains(&platform))
    })
    .map(|(c, _)| c)
    .collect();
  Some(ChannelList { serial, channels })
}

/// One entry of the list and its platforms, or None when it does not fit.
fn listed_channel(e: &Value) -> Option<(ListedChannel, Vec<Platform>)> {
  let id = e.get("id")?.as_str()?;
  if !is_list_id(id) {
    return None;
  }
  let keys: Vec<Role> = e.get("keys")?.as_array()?.iter().map(|k| Role::from_name(k.as_str()?)).collect::<Option<_>>()?;
  if keys.is_empty() {
    return None;
  }
  // A field may be missing (then its default); there, it must be of its kind.
  let flag = |key: &str, default: bool| match e.get(key) {
    None => Some(default),
    Some(v) => v.as_bool(),
  };
  let platforms: Vec<Platform> = match e.get("platforms") {
    None => vec![Platform::Desktop],
    Some(v) => v
      .as_array()?
      .iter()
      .map(|p| match p.as_str()? {
        "desktop" => Some(Platform::Desktop),
        "apk" => Some(Platform::Apk),
        _ => None,
      })
      .collect::<Option<_>>()?,
  };
  if platforms.is_empty() {
    return None;
  }
  let then = match e.get("then") {
    None => "stable".to_string(),
    Some(v) => v.as_str()?.to_string(),
  };
  if then == id {
    return None;
  }
  let name = localized(e.get("name")?, 1, MAX_NAME_CHARS)?;
  // No hint at all is an empty one.
  let hint = match e.get("hint") {
    None => Localized::default(),
    Some(v) => localized(v, 0, MAX_HINT_CHARS)?,
  };
  let channel = ListedChannel {
    id: id.to_string(),
    keys,
    usage: flag("usage", true)?,
    hidden: flag("hidden", false)?,
    ended: flag("ended", false)?,
    then,
    name,
    hint,
  };
  Some((channel, platforms))
}

/// `de` and `en`, each `min` to `max` characters (code points) long.
fn localized(v: &Value, min: usize, max: usize) -> Option<Localized> {
  let one = |key: &str| {
    let text = v.get(key)?.as_str()?;
    (min..=max).contains(&text.chars().count()).then(|| text.to_string())
  };
  if !v.is_object() {
    return None;
  }
  Some(Localized { de: one("de")?, en: one("en")? })
}

#[cfg(test)]
pub mod testing {
  //! A key pair for the tests, and signing with it as scripts/sign-update.mjs does.
  use super::*;
  use aws_lc_rs::signature::{Ed25519KeyPair, KeyPair};

  pub fn pair(seed: u8) -> (Ed25519KeyPair, Vec<u8>) {
    let pair = Ed25519KeyPair::from_seed_unchecked(&[seed; 32]).unwrap();
    let public = pair.public_key().as_ref().to_vec();
    (pair, public)
  }

  fn sig_file(message: &[u8], pair: &Ed25519KeyPair) -> String {
    let sig = pair.sign(message);
    json!({ "format": "girovo-update-sig", "v": 1, "key": key_id(pair.public_key().as_ref()), "sig": BASE64.encode(sig.as_ref()) }).to_string()
  }

  pub fn sign(bytes: &[u8], pair: &Ed25519KeyPair) -> String {
    sig_file(&signed_message(bytes), pair)
  }

  /// channels.json for the list `text`, signed with `pair` (sign-update.mjs sign-channels).
  pub fn sign_channels(text: &str, pair: &Ed25519KeyPair) -> String {
    let sig = sig_file(&[CHANNELS_PREFIX, text.as_bytes()].concat(), pair);
    json!({ "format": "girovo-channels", "v": 1, "list": text, "sig": sig }).to_string()
  }
}

#[cfg(test)]
mod tests {
  use super::testing::{pair, sign, sign_channels};
  use super::*;

  #[test]
  fn build_numbers_order_releases_previews_and_nightlies() {
    // The same list as mobile/updates/update-trust.test.ts.
    let ordered = [
      "5.16.2",
      "6.0.0-preview.1",
      "6.0.0-preview.12",
      "6.0.0-preview.202611031200.ge9d8b1b",
      "6.0.0-nightly.202611071159.g80ace0e",
      "6.0.0-preview.202611071208.gef82cf6",
      "6.0.0",
      "6.0.1-nightly.202611071700.gabcdef0",
      "6.0.1",
      "6.0.2-nightly.202611071832.gc0d6b0c",
      "6.0.2-nightly.202611081217.g1234567",
      "6.0.2",
      "6.1.0",
      "7.0.0",
    ];
    let builds: Vec<u64> = ordered.iter().map(|v| build_number(v).unwrap_or_else(|| panic!("{v}"))).collect();
    for i in 1..builds.len() {
      assert!(builds[i] > builds[i - 1], "{} after {}", ordered[i], ordered[i - 1]);
    }
  }

  #[test]
  fn build_numbers_are_the_same_as_the_apps_javascript() {
    assert_eq!(build_number("6.0.2"), Some(600_020_000_000_000));
    assert_eq!(build_number("6.0.2-nightly.202611071832.gc0d6b0c"), Some(600_019_000_447_512));
    assert_eq!(build_number("6.0.0-preview.3"), Some(599_999_000_000_003));
    assert_eq!(build_number("6.0.2-dev.41"), build_number("6.0.2"));
    assert_eq!(build_number("6.0.0-preview.3-dev.7"), build_number("6.0.0-preview.3"));
    assert!(build_number("89.99.99").is_some());
    assert_eq!(build_number("99.99.99"), None);
    for v in ["6.0.0-rc.1", "6.0.0-beta", "6.0.0-preview.100", "6.0.0-nightly.2026110718", "6.0.0-nightly.202613071832", "six", "", "6.0"] {
      assert_eq!(build_number(v), None, "{v}");
    }
  }

  #[test]
  fn any_channels_word_with_a_stamp_is_numbered_like_a_nightly() {
    let nightly = build_number("6.2.0-nightly.202611111200.gabcdef0");
    assert_eq!(nightly, Some(601_999_000_452_880));
    // The same stamp under any word of [a-z][a-z0-9]{1,15}, with or without the commit.
    for v in ["6.2.0-next.202611111200", "6.2.0-next.202611111200.gabcdef0", "6.2.0-preview.202611111200", "6.2.0-api2.202611111200", "6.2.0-abcdefghijklmnop.202611111200"] {
      assert_eq!(build_number(v), nightly, "{v}");
      assert!(is_prerelease(v), "{v}");
    }
    // Later stamps are later builds, whatever the word.
    assert!(build_number("6.2.0-next.202611111201") > build_number("6.2.0-nightly.202611111200.gabcdef0"));
    assert!(build_number("6.2.0-nightly.202611111202") > build_number("6.2.0-next.202611111201"));
    // Not a word: one letter, seventeen, a capital, a leading digit, a dash, an underscore.
    for v in [
      "6.2.0-n.202611111200",
      "6.2.0-abcdefghijklmnopq.202611111200",
      "6.2.0-Next.202611111200",
      "6.2.0-1next.202611111200",
      "6.2.0-ne-xt.202611111200",
      "6.2.0-ne_xt.202611111200",
      "6.2.0-next.20261111120",
      "6.2.0-next.202611111200.gXYZ",
    ] {
      assert_eq!(build_number(v), None, "{v}");
    }
    // preview.N and -dev stay as they were.
    assert_eq!(build_number("6.2.0-preview.7"), Some(601_999_000_000_007));
    assert_eq!(build_number("6.2.0-next.202611111200-dev.3"), nightly);
    assert_eq!(build_number("6.2.0-dev.3"), build_number("6.2.0"));
    assert!(!is_prerelease("6.2.0-dev.3"));
  }

  #[test]
  fn a_pre_release_of_0_0_0_has_no_build_number_and_nothing_overflows() {
    // There is no slot below 0.0.0: refused, never (0 - 1) x 10^9.
    assert_eq!(build_number("0.0.0"), Some(0));
    assert_eq!(build_number("0.0.0-preview.1"), None);
    assert_eq!(build_number("0.0.0-nightly.202611071832.gc0d6b0c"), None);
    assert_eq!(build_number("0.0.0-dev.4"), Some(0), "a development build counts as its version");
    assert_eq!(build_number("0.0.1-preview.1"), Some(9_000_000_001));
    // A manifest of such a version, whatever build it claims (here what wrapping would give).
    let wrapped = 0u64.wrapping_sub(1).wrapping_mul(BUILD_SCALE).wrapping_add(1);
    let mut m: Value = serde_json::from_str(&manifest("0.0.0-preview.1")).unwrap();
    m["build"] = json!(wrapped);
    assert!(release_of(m.to_string().as_bytes(), &origin()).is_none());
  }

  #[test]
  fn nightlies_and_previews_are_pre_releases_releases_and_dev_builds_are_not() {
    for v in ["6.0.2-nightly.202611071832.gc0d6b0c", "6.0.0-preview.3", "6.0.0-preview.202611071208.gef82cf6", "6.0.0-preview.3-dev.7"] {
      assert!(is_prerelease(v), "{v}");
    }
    for v in ["6.0.2", "6.0.2-dev.41", "6.0.0-rc.1", "0.0.0-preview.1", "nonsense", ""] {
      assert!(!is_prerelease(v), "{v:?}");
    }
  }

  type Pair = aws_lc_rs::signature::Ed25519KeyPair;

  /// Test keys: stable seed 1, nightly 2, next 4, reserve1 5, reserve2 6 (3 and 9 are strangers').
  fn keys() -> (Keys, Pair, Pair) {
    let (stable, s) = pair(1);
    let (nightly, n) = pair(2);
    (Keys { stable: s, nightly: n, next: pair(4).1, reserve1: pair(5).1, reserve2: pair(6).1 }, stable, nightly)
  }

  #[test]
  fn a_signature_names_its_key_and_verifies_only_with_it() {
    let (keys, stable, nightly) = keys();
    let bytes = b"{\"version\":\"6.0.2\"}\n";
    assert_eq!(verify(bytes, &sign(bytes, &stable), &keys), Some(Role::Stable));
    assert_eq!(verify(bytes, &sign(bytes, &nightly), &keys), Some(Role::Nightly));
    assert_eq!(verify(bytes, &sign(bytes, &pair(4).0), &keys), Some(Role::Next));
    assert_eq!(verify(bytes, &sign(bytes, &pair(5).0), &keys), Some(Role::Reserve1));
    assert_eq!(verify(bytes, &sign(bytes, &pair(6).0), &keys), Some(Role::Reserve2));
    assert_eq!(verify(bytes, &sign(bytes, &pair(3).0), &keys), None, "a stranger's key");
    assert_eq!(verify(b"{\"version\":\"6.0.3\"}\n", &sign(bytes, &stable), &keys), None, "another manifest");
    for bad in ["", "not json", "{\"format\":\"girovo-update-sig\",\"v\":1,\"key\":\"x\",\"sig\":\"AAAA\"}"] {
      assert_eq!(verify(bytes, bad, &keys), None, "{bad}");
    }
  }

  #[test]
  fn an_empty_key_trusts_nothing() {
    let (mut keys, _, _) = keys();
    keys.next = Vec::new();
    let bytes = b"{}\n";
    assert_eq!(verify(bytes, &sign(bytes, &pair(4).0), &keys), None);
    // Not even a signature that names the empty key's id.
    let forged = json!({ "format": "girovo-update-sig", "v": 1, "key": key_id(&[]), "sig": BASE64.encode([0u8; 64]) }).to_string();
    assert_eq!(verify(bytes, &forged, &keys), None);
  }

  #[test]
  fn a_signature_made_by_the_javascript_tool_verifies_here() {
    // Made by mobile/updates/update-trust.ts signManifest in Node, secret key [1; 32], over "{}\n".
    let from_js = r#"{"format":"girovo-update-sig","v":1,"key":"34750f98bd59fcfc","sig":"DCxhhKZMLOEkMVW/IBS6eYFsWPV2JQg3rcKXEdDEI0uqPB3DQmyfEwbtrZj5A1ZEvfjw+ZFnNhdgjeDZJaGGBA=="}"#;
    let (keys, stable, _) = keys();
    assert_eq!(key_id(&keys.stable), "34750f98bd59fcfc");
    assert_eq!(verify(b"{}\n", from_js, &keys), Some(Role::Stable));
    let sig_of = |text: &str| serde_json::from_str::<Value>(text).unwrap()["sig"].clone();
    assert_eq!(sig_of(&sign(b"{}\n", &stable)), sig_of(from_js), "Rust signs it the same (Ed25519 is deterministic)");
  }

  #[test]
  fn the_builtin_keys_are_the_owners() {
    let k = Keys::builtin();
    assert_eq!(key_id(&k.stable), "db00cdc657dd9421");
    assert_eq!(key_id(&k.nightly), "bc7687ce7912473c");
    assert_eq!(key_id(&k.next), "4783eb4473d8281e");
    assert_eq!(key_id(&k.reserve1), "148e76a8a204a6e8");
    assert_eq!(key_id(&k.reserve2), "02c48bf0ff17f160");
    for role in Role::ALL {
      assert_eq!(k.of(role).len(), 32, "{role:?}");
      assert_eq!(Role::from_name(role.name()), Some(role));
    }
    assert_eq!(Role::from_name("Stable"), None);
  }

  /// A channel of the list taking `keys`, with its own manifest name.
  fn list_channel(id: &str, keys: &[Role]) -> Channel {
    Channel { id: id.into(), listing: id.into(), manifest: id.into(), keys: keys.to_vec(), prerelease: true, usage: true, builtin: false }
  }

  #[test]
  fn which_key_and_manifest_a_channel_takes() {
    let (stable, preview) = (Channel::stable(), Channel::preview());
    let next = list_channel("next", &[Role::Stable, Role::Next]);
    let fit = |role: Role, named: Option<&str>, channel: &Channel| fits(Some(role), named, channel);

    // As before: the stable key's "stable" everywhere, the nightly key's "nightly" on Nightly only.
    assert!(fit(Role::Stable, Some("stable"), &stable));
    assert!(fit(Role::Stable, Some("stable"), &preview));
    assert!(fit(Role::Stable, Some("stable"), &next));
    assert!(fit(Role::Nightly, Some("nightly"), &preview));
    assert!(!fit(Role::Nightly, Some("nightly"), &stable));
    assert!(!fits(None, Some("stable"), &stable));

    // Rule 1: the key must be one of the channel's.
    assert!(!fit(Role::Next, Some("next"), &stable), "a Next build on Stabil");
    assert!(!fit(Role::Next, Some("next"), &preview), "a Next build on Nightly");
    assert!(!fit(Role::Next, Some("nightly"), &preview), "the next key naming nightly is still not Nightly's key");
    assert!(fit(Role::Next, Some("next"), &next));
    assert!(!fit(Role::Nightly, Some("nightly"), &next), "Next does not take the nightly key");
    assert!(!fit(Role::Reserve1, Some("next"), &next));

    // Rule 2: the manifest names "stable" or the channel's own manifest name.
    assert!(!fit(Role::Stable, Some("nightly"), &stable), "a stable-signed nightly is not for Stabil");
    assert!(fit(Role::Stable, Some("nightly"), &preview));
    assert!(fit(Role::Stable, Some("next"), &next));
    assert!(!fit(Role::Stable, Some("next"), &preview), "a Next build signed with the stable key stays on Next");
    assert!(!fit(Role::Next, Some("api"), &next));
    assert!(!fit(Role::Stable, Some(""), &stable));

    // Rule 3: only the stable key may name "stable".
    assert!(!fit(Role::Nightly, Some("stable"), &preview), "a nightly-signed manifest claiming stable");
    assert!(!fit(Role::Nightly, Some("stable"), &stable));
    assert!(!fit(Role::Next, Some("stable"), &next));

    // No channel field: stable by the stable key, nightly by the nightly key, nothing by any other.
    assert!(fit(Role::Stable, None, &stable));
    assert!(fit(Role::Stable, None, &next));
    assert!(fit(Role::Nightly, None, &preview));
    assert!(!fit(Role::Nightly, None, &stable));
    assert!(!fit(Role::Next, None, &next));
    assert!(!fit(Role::Reserve1, None, &list_channel("api", &[Role::Reserve1])));
  }

  #[test]
  fn the_channel_field_is_read_from_the_signed_manifest_itself() {
    let (keys, stable, nightly) = keys();
    let with = |channel: Value| {
      let mut m: Value = serde_json::from_str(&manifest("6.2.0-nightly.202611111200.gabcdef0")).unwrap();
      m["channel"] = channel;
      m.to_string()
    };
    let n = with(json!("nightly"));
    assert!(fits_manifest(n.as_bytes(), &sign(n.as_bytes(), &nightly), &keys, &Channel::preview()));
    let claims_stable = with(json!("stable"));
    assert!(!fits_manifest(claims_stable.as_bytes(), &sign(claims_stable.as_bytes(), &nightly), &keys, &Channel::preview()));
    assert!(!fits_manifest(claims_stable.as_bytes(), &sign(claims_stable.as_bytes(), &nightly), &keys, &Channel::stable()));
    // Not a string: as if missing.
    for odd in [json!(null), json!(5), json!(["stable"])] {
      let m = with(odd.clone());
      assert_eq!(manifest_channel(m.as_bytes()), None);
      assert!(fits_manifest(m.as_bytes(), &sign(m.as_bytes(), &nightly), &keys, &Channel::preview()), "{odd}");
      assert!(!fits_manifest(m.as_bytes(), &sign(m.as_bytes(), &pair(4).0), &keys, &list_channel("next", &[Role::Next])), "{odd}");
    }
    let mut missing: Value = serde_json::from_str(&manifest("6.2.0")).unwrap();
    missing.as_object_mut().unwrap().remove("channel");
    let m = missing.to_string();
    assert!(fits_manifest(m.as_bytes(), &sign(m.as_bytes(), &stable), &keys, &Channel::stable()));
  }

  #[test]
  fn which_signer_a_version_takes() {
    let nightly = "6.0.2-nightly.202611071832.gc0d6b0c";
    assert!(signer_fits_version(Some(Role::Stable), "6.2.0"));
    assert!(signer_fits_version(Some(Role::Stable), nightly));
    assert!(signer_fits_version(Some(Role::Nightly), nightly));
    assert!(signer_fits_version(Some(Role::Nightly), "6.0.0-preview.3"));
    assert!(!signer_fits_version(Some(Role::Nightly), "6.2.0"), "the nightly key can't sign a release");
    assert!(!signer_fits_version(Some(Role::Nightly), "6.2.0-dev.4"), "nor a build that counts as one");
    assert!(!signer_fits_version(Some(Role::Nightly), "nonsense"));
    assert!(!signer_fits_version(None, nightly));
    // Every key but the stable one alike.
    for role in [Role::Next, Role::Reserve1, Role::Reserve2] {
      assert!(signer_fits_version(Some(role), "6.2.0-next.202611111200"), "{role:?}");
      assert!(signer_fits_version(Some(role), nightly), "{role:?}");
      assert!(!signer_fits_version(Some(role), "6.2.0"), "{role:?}");
      assert!(!signer_fits_version(Some(role), "6.2.0-dev.4"), "{role:?}");
    }
  }

  #[test]
  fn buckets_are_stable_per_version_and_spread() {
    assert_eq!(bucket("install-a", "6.0.3"), bucket("install-a", "6.0.3"));
    // The same buckets as the GitHub APK's (mobile/updates/update-trust.test.ts).
    assert_eq!((bucket("install-a", "9.9.9"), bucket("install-a", "6.0.3"), bucket("x", "6.0.2")), (88, 91, 53));
    let spread: std::collections::HashSet<u8> = (0..400).map(|i| bucket(&format!("install-{i}"), "6.0.3")).collect();
    assert!(spread.len() > 90, "{} buckets", spread.len());
    assert!(spread.iter().all(|&b| b < 100));
    assert!(reaches(20.0, 19, false) && !reaches(20.0, 20, false));
    assert!(reaches(0.0, 0, true), "early takes everything");
    assert!(reaches(100.0, 99, false));
  }

  fn origin() -> Origin {
    Origin::default()
  }

  fn manifest(version: &str) -> String {
    let channel = if version.contains("-next.") {
      "next"
    } else if version.contains('-') {
      "nightly"
    } else {
      "stable"
    };
    manifest_named(version, channel)
  }

  fn manifest_named(version: &str, channel: &str) -> String {
    let url = |name: &str| format!("https://github.com/elNino0916/Girovo/releases/download/{version}/{name}");
    let setup = format!("Girovo-{version}-Setup.exe");
    json!({
      "format": "girovo-update", "v": 1, "version": version, "build": build_number(version),
      "channel": channel,
      "page": format!("https://github.com/elNino0916/Girovo/releases/tag/{version}"),
      "published": "2026-11-08T10:00:00.000Z",
      "files": [{
        "kind": "setup", "name": setup, "size": 1234, "sha256": "ab".repeat(32), "url": url(&setup),
        "blockmap": { "name": format!("{setup}.blockmap"), "size": 99, "sha256": "cd".repeat(32), "url": url(&format!("{setup}.blockmap")) },
      }],
      "notes": "# Girovo",
    })
    .to_string()
  }

  #[test]
  fn a_manifest_becomes_a_release_with_its_hashes() {
    let r = release_of(manifest("6.0.2").as_bytes(), &origin()).unwrap();
    assert_eq!(r.version, "6.0.2");
    assert_eq!(r.name, "Girovo 6.0.2");
    assert_eq!(r.url, "https://github.com/elNino0916/Girovo/releases/tag/6.0.2");
    assert_eq!(r.published_at.as_deref(), Some("2026-11-08T10:00:00.000Z"));
    assert_eq!(r.assets.len(), 2);
    assert_eq!(r.assets[0].sha256.as_deref(), Some("ab".repeat(32).as_str()));
    assert_eq!(r.assets[1].name, "Girovo-6.0.2-Setup.exe.blockmap");
  }

  #[test]
  fn a_manifest_that_does_not_add_up_is_refused() {
    let wrong_build = manifest("6.0.2").replace("600020000000000", "600030000000000");
    assert!(release_of(wrong_build.as_bytes(), &origin()).is_none());
    let foreign = manifest("6.0.2").replace("github.com/elNino0916/Girovo/releases/download", "example.com/x");
    assert!(release_of(foreign.as_bytes(), &origin()).is_none(), "a file outside the project's downloads");
    let unhashed = manifest("6.0.2").replace(&"ab".repeat(32), "nope");
    assert!(release_of(unhashed.as_bytes(), &origin()).is_none());
    assert!(release_of(b"{}", &origin()).is_none());
  }

  #[test]
  fn a_manifest_whose_version_is_not_written_as_a_release_names_it_is_refused() {
    // build_number reads all of these as 6.0.2, so the build adds up; the
    // app's JavaScript (update-trust.ts releaseOf) refuses them, and so does this.
    assert!(release_of(manifest("6.0.2").as_bytes(), &origin()).is_some());
    for odd in ["v6.0.2", "06.0.2", " 6.0.2", "6.0.2 ", "6.00.2"] {
      assert_eq!(build_number(odd), build_number("6.0.2"), "{odd:?}");
      let mut m: Value = serde_json::from_str(&manifest("6.0.2")).unwrap();
      m["version"] = json!(odd);
      assert!(release_of(m.to_string().as_bytes(), &origin()).is_none(), "{odd:?}");
    }
  }

  fn listed(version: &str, rollout: f64, signer: &Pair) -> Listed {
    let manifest = manifest(version);
    Listed { version: version.into(), rollout, sig: sign(manifest.as_bytes(), signer), manifest }
  }

  #[test]
  fn the_first_listed_release_that_is_signed_fitting_and_reaching_is_offered() {
    let (keys, stable, nightly) = keys();
    let o = origin();
    let pick = |list: &[Listed], channel: &Channel, early| pick_listed(list, channel, &keys, &o, "install-a", early).map(|r| r.version);
    let (on_stable, on_preview) = (Channel::stable(), Channel::preview());

    assert_eq!(pick(&[listed("6.0.2", 100.0, &stable)], &on_stable, false).as_deref(), Some("6.0.2"));
    assert_eq!(pick(&[listed("6.0.2", 100.0, &nightly)], &on_stable, false), None, "the nightly key can't sign a stable release");
    let n = "6.0.2-nightly.202611071832.gc0d6b0c";
    assert_eq!(pick(&[listed(n, 100.0, &nightly)], &on_preview, false).as_deref(), Some(n));
    let (stranger, _) = pair(9);
    assert_eq!(pick(&[listed("6.0.2", 100.0, &stranger)], &on_stable, false), None);

    // Staged: outside the percentage the next one, with "early" the staged one.
    let b = bucket("install-a", "6.0.3");
    let staged = [listed("6.0.3", f64::from(b), &stable), listed("6.0.2", 100.0, &stable)];
    assert_eq!(pick(&staged, &on_stable, false).as_deref(), Some("6.0.2"));
    assert_eq!(pick(&staged, &on_stable, true).as_deref(), Some("6.0.3"));
    let open = [listed("6.0.3", f64::from(b) + 1.0, &stable), listed("6.0.2", 100.0, &stable)];
    assert_eq!(pick(&open, &on_stable, false).as_deref(), Some("6.0.3"));

    // A listing whose version is not its manifest's is passed over.
    let mut lying = listed("6.0.3", 100.0, &stable);
    lying.version = "6.0.4".into();
    assert_eq!(pick(&[lying, listed("6.0.2", 100.0, &stable)], &on_stable, false).as_deref(), Some("6.0.2"));

    // A Next build is passed over on Nightly and Stabil, and taken on Next.
    let next = "6.2.0-next.202611111200.gabcdef0";
    let next_key = pair(4).0;
    let with_next = [listed(next, 100.0, &next_key), listed(n, 100.0, &nightly)];
    assert_eq!(pick(&with_next, &on_preview, false).as_deref(), Some(n));
    assert_eq!(pick(&with_next, &on_stable, false), None);
    let on_next = list_channel("next", &[Role::Stable, Role::Next]);
    assert_eq!(pick(&with_next, &on_next, false).as_deref(), Some(next));
    assert_eq!(pick(&[listed(n, 100.0, &nightly), listed("6.0.2", 100.0, &stable)], &on_next, false).as_deref(), Some("6.0.2"));
  }

  #[test]
  fn girovo_de_s_answer_is_read_and_anything_else_refused() {
    let body = json!({ "format": "girovo-updates", "v": 1, "channel": "stable", "releases": [
      { "version": "6.0.3", "build": 1, "rollout": 20, "manifest": "m", "sig": "s" },
      { "version": "6.0.2", "manifest": "m2", "sig": "s2" },
      { "version": "broken" },
    ]});
    let list = parse_listing(body.to_string().as_bytes()).unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].rollout, 20.0);
    assert_eq!(list[1].rollout, 100.0);
    assert!(parse_listing(b"<html>").is_none());
    assert!(parse_listing(br#"{"format":"other","v":1,"releases":[]}"#).is_none());
  }

  // ---- the channel list ----

  /// The test file both halves read: signed with the test stable key [1; 32].
  const FIXTURE: &str = include_str!("../../../mobile/updates/__fixtures__/channels-test.json");

  fn list_text(serial: u64, channels: Value) -> String {
    json!({ "format": "girovo-channel-list", "v": 1, "serial": serial, "channels": channels }).to_string()
  }

  fn one(fields: Value) -> Value {
    let mut entry = json!({ "id": "beta", "keys": ["stable"], "name": { "de": "Beta", "en": "Beta" } });
    for (k, v) in fields.as_object().unwrap() {
      if v.is_null() {
        entry.as_object_mut().unwrap().remove(k);
      } else {
        entry[k] = v.clone();
      }
    }
    entry
  }

  /// The ids the desktop reads from a list with these entries, signed with the test stable key.
  fn ids(channels: Value) -> Vec<String> {
    let (keys, stable, _) = keys();
    let list = read_channels(&sign_channels(&list_text(1, channels), &stable), &keys, Platform::Desktop).expect("a list");
    list.channels.into_iter().map(|c| c.id).collect()
  }

  #[test]
  fn the_test_file_reads_as_the_spec_says_on_the_desktop() {
    let keys = Keys { stable: pair(1).1, ..Keys::default() };
    assert_eq!(BASE64.encode(&keys.stable), "iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w=");
    let list = read_channels(FIXTURE, &keys, Platform::Desktop).expect("the test file verifies");
    assert_eq!(list.serial, 3);
    let ids: Vec<&str> = list.channels.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(ids, ["next", "api", "old"], "Bad, nokeys, apkonly and the second api are absent");

    let next = list.get("next").unwrap();
    assert_eq!(next.keys, [Role::Stable, Role::Next]);
    assert!(next.hidden && next.usage && !next.ended);
    assert_eq!(next.then, "stable");
    assert_eq!(next.name, Localized { de: "Next".into(), en: "Next".into() });
    assert_eq!(next.hint.de, "Vorschau auf die nächste große Version.");
    assert_eq!(next.hint.en, "A preview of the next major version.");

    let api = list.get("api").unwrap();
    assert_eq!(api.keys, [Role::Reserve1], "the first api, not the duplicate");
    assert!(!api.usage && !api.hidden && !api.ended);
    assert_eq!(api.name.de, "API-Test");
    assert_eq!(api.hint, Localized::default(), "no hint: empty");

    let old = list.get("old").unwrap();
    assert_eq!(old.keys, [Role::Reserve2]);
    assert!(old.ended && old.usage);
    assert_eq!(old.then, "preview");

    // The APK reads its own entries from the same file (an ended one counts everywhere).
    let apk = read_channels(FIXTURE, &keys, Platform::Apk).unwrap();
    let apk_ids: Vec<&str> = apk.channels.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(apk_ids, ["api", "old", "apkonly"]);

    // The owner's real stable key did not sign it.
    assert_eq!(read_channels(FIXTURE, &Keys::builtin(), Platform::Desktop), None);
  }

  #[test]
  fn a_list_is_believed_only_with_the_stable_keys_signature_over_its_own_prefix() {
    let (keys, stable, _) = keys();
    let text = list_text(1, json!([one(json!({}))]));
    assert!(read_channels(&sign_channels(&text, &stable), &keys, Platform::Desktop).is_some());
    // Any other built-in key, or a stranger's.
    for seed in [2, 4, 5, 6, 9] {
      assert_eq!(read_channels(&sign_channels(&text, &pair(seed).0), &keys, Platform::Desktop), None, "seed {seed}");
    }
    // A release signature over the same text (prefix girovo-update/1) is not a list signature.
    let release_sig = sign(text.as_bytes(), &stable);
    let wrong_prefix = json!({ "format": "girovo-channels", "v": 1, "list": text, "sig": release_sig }).to_string();
    assert_eq!(read_channels(&wrong_prefix, &keys, Platform::Desktop), None);
    // A list signature does not pass as a release signature either.
    let envelope: Value = serde_json::from_str(&sign_channels(&text, &stable)).unwrap();
    assert_eq!(verify(text.as_bytes(), envelope["sig"].as_str().unwrap(), &keys), None);
    // A list changed after signing.
    let mut tampered = envelope.clone();
    tampered["list"] = json!(text.replace("\"stable\"]", "\"nightly\"]"));
    assert_ne!(tampered["list"], envelope["list"]);
    assert_eq!(read_channels(&tampered.to_string(), &keys, Platform::Desktop), None);
    let mut tampered = envelope.clone();
    tampered["list"] = json!(format!("{text} "));
    assert_eq!(read_channels(&tampered.to_string(), &keys, Platform::Desktop), None);
    // The envelope itself.
    for (key, value) in [("format", json!("girovo-updates")), ("v", json!(2)), ("list", json!({})), ("sig", json!(null))] {
      let mut odd = envelope.clone();
      odd[key] = value;
      assert_eq!(read_channels(&odd.to_string(), &keys, Platform::Desktop), None, "{key}");
    }
    for odd in ["", "not json", "[]", "{}"] {
      assert_eq!(read_channels(odd, &keys, Platform::Desktop), None, "{odd:?}");
    }
  }

  #[test]
  fn a_list_that_is_not_one_is_refused_as_a_whole() {
    let (keys, stable, _) = keys();
    let read = |list: Value| read_channels(&sign_channels(&list.to_string(), &stable), &keys, Platform::Desktop);
    let good = json!({ "format": "girovo-channel-list", "v": 1, "serial": 1, "channels": [] });
    assert_eq!(read(good.clone()), Some(ChannelList { serial: 1, channels: vec![] }));
    let mut big = good.clone();
    big["serial"] = json!(9_007_199_254_740_991u64);
    assert!(read(big).is_some(), "the largest safe integer");
    let mut written_as_float = good.clone();
    written_as_float["serial"] = json!(3.0);
    assert_eq!(read(written_as_float).map(|l| l.serial), Some(3));
    for (key, value) in [
      ("format", json!("girovo-channels")),
      ("v", json!(2)),
      ("serial", json!(0)),
      ("serial", json!(-1)),
      ("serial", json!(1.5)),
      ("serial", json!("1")),
      ("serial", json!(9_007_199_254_740_992u64)),
      ("serial", json!(null)),
      ("channels", json!({})),
      ("channels", json!(null)),
    ] {
      let mut odd = good.clone();
      odd[key] = value.clone();
      assert_eq!(read(odd), None, "{key}: {value}");
    }
    assert_eq!(read_channels(&sign_channels("not json", &stable), &keys, Platform::Desktop), None);
  }

  #[test]
  fn an_entry_that_does_not_fit_is_dropped_not_the_list() {
    assert_eq!(ids(json!([one(json!({}))])), ["beta"]);
    let dropped = [
      json!({ "id": "Beta" }),
      json!({ "id": "b" }),
      json!({ "id": "abcdefghijklmnopq" }),
      json!({ "id": "be-ta" }),
      json!({ "id": "1beta" }),
      json!({ "id": "stable" }),
      json!({ "id": "preview" }),
      json!({ "id": "nightly" }),
      json!({ "id": 5 }),
      json!({ "id": null }),
      json!({ "keys": [] }),
      json!({ "keys": null }),
      json!({ "keys": "stable" }),
      json!({ "keys": ["stable", "reserve3"] }),
      json!({ "keys": ["Stable"] }),
      json!({ "keys": [1] }),
      json!({ "usage": "yes" }),
      json!({ "hidden": 1 }),
      json!({ "ended": "true" }),
      json!({ "platforms": "desktop" }),
      json!({ "platforms": ["desktop", "linux"] }),
      json!({ "then": "nightly" }),
      json!({ "then": "beta" }),
      json!({ "then": "elsewhere" }),
      json!({ "then": 1 }),
      json!({ "name": null }),
      json!({ "name": "Beta" }),
      json!({ "name": { "de": "Beta" } }),
      json!({ "name": { "de": "", "en": "Beta" } }),
      json!({ "name": { "de": "Beta", "en": "x".repeat(25) } }),
      json!({ "name": { "de": "Beta", "en": 5 } }),
      json!({ "hint": "Probier es aus" }),
      json!({ "hint": { "de": "x".repeat(121), "en": "" } }),
      json!({ "hint": { "de": 1, "en": "" } }),
      json!({ "hint": { "de": "Nur deutsch" } }),
      json!({ "platforms": [] }),
    ];
    for fields in dropped {
      let entries = json!([one(fields.clone()), one(json!({ "id": "ok" }))]);
      assert_eq!(ids(entries), ["ok"], "{fields}");
    }
    // The edges that fit.
    for fields in [
      json!({ "id": "ab" }),
      json!({ "id": "a234567890123456" }),
      json!({ "keys": ["stable", "nightly", "next", "reserve1", "reserve2"] }),
      json!({ "name": { "de": "x".repeat(24), "en": "y" } }),
      json!({ "name": { "de": "ä".repeat(24), "en": "y" } }),
      json!({ "name": { "de": "😀".repeat(24), "en": "y" } }),
      json!({ "hint": { "de": "x".repeat(120), "en": "" } }),
      json!({ "platforms": ["apk", "desktop"] }),
      json!({ "then": "preview" }),
      json!({ "then": "ok" }),
      json!({ "unknown": [1, 2, 3] }),
    ] {
      let entries = json!([one(fields.clone()), one(json!({ "id": "ok" }))]);
      let read = ids(entries);
      assert_eq!(read.len(), 2, "{fields}: {read:?}");
    }
  }

  #[test]
  fn defaults_duplicates_platforms_and_the_first_eight() {
    let (keys, stable, _) = keys();
    let read = |channels: Value, platform| read_channels(&sign_channels(&list_text(1, channels), &stable), &keys, platform).unwrap();
    let c = read(json!([one(json!({}))]), Platform::Desktop).channels.remove(0);
    assert!(c.usage && !c.hidden && !c.ended);
    assert_eq!(c.then, "stable");
    assert_eq!(c.hint, Localized::default());

    // A later entry with an id seen before is dropped, the first one counts,
    // and so does a first one that did not fit.
    let dup = read(json!([one(json!({ "keys": ["next"] })), one(json!({ "keys": ["reserve1"] }))]), Platform::Desktop);
    assert_eq!(dup.channels.len(), 1);
    assert_eq!(dup.channels[0].keys, [Role::Next]);
    let after_bad = read(json!([one(json!({ "keys": [] })), one(json!({ "keys": ["reserve1"] }))]), Platform::Desktop);
    assert!(after_bad.channels.is_empty());

    // On another platform an entry counts as absent, unless it has ended; no platforms: the desktop only.
    let mixed = json!([
      one(json!({ "id": "desk" })),
      one(json!({ "id": "phone", "platforms": ["apk"] })),
      one(json!({ "id": "both", "platforms": ["desktop", "apk"] })),
      one(json!({ "id": "gonephone", "platforms": ["apk"], "ended": true })),
    ]);
    let on = |platform| read(mixed.clone(), platform).channels.into_iter().map(|c| c.id).collect::<Vec<_>>();
    assert_eq!(on(Platform::Desktop), ["desk", "both", "gonephone"]);
    assert_eq!(on(Platform::Apk), ["phone", "both", "gonephone"]);

    // Only the first eight entries count, dropped ones included.
    let many: Vec<Value> = (0..10).map(|i| one(json!({ "id": format!("c{i}") }))).collect();
    assert_eq!(read(json!(many), Platform::Desktop).channels.len(), 8);
    let mut with_bad = vec![one(json!({ "id": "Bad" }))];
    with_bad.extend((0..8).map(|i| one(json!({ "id": format!("c{i}") }))));
    let ids: Vec<String> = read(json!(with_bad), Platform::Desktop).channels.into_iter().map(|c| c.id).collect();
    assert_eq!(ids.len(), 7);
    assert!(!ids.contains(&"c7".to_string()));

    // `then` may name a channel of another platform.
    let elsewhere = json!([one(json!({ "id": "gone", "ended": true, "then": "phone" })), one(json!({ "id": "phone", "platforms": ["apk"] }))]);
    assert_eq!(read(elsewhere, Platform::Desktop).channels[0].then, "phone");
  }
}
