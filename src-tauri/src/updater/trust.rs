// What makes an update trustworthy and in which order updates come:
// mobile/updates/update-trust.ts in Rust, tested against the same numbers
// (docs/updater-v2.md).
//
// girovo.de lists each channel's newest release as the release itself
// published it: girovo-update.json and its Ed25519 signature, by the stable
// key (on the owner's PC) or the nightly key (an Actions secret). Nothing in
// between has to be trusted — a stable manifest must carry the stable key's
// signature, and the Nightly channel takes either. The files' SHA-256 come
// from the signed manifest; the download is checked against them.
//
// Build numbers: a release X.Y.Z is Android's version code (MMmmpp × 10)
// times 10⁹; its pre-releases sit just below, (code − 1) × 10⁹ + n, with
// n = N for a hand-made preview.N and a nightly's minutes since 2026-01-01
// UTC. Development builds count as the version they are numbered after.

use std::sync::LazyLock;

use aws_lc_rs::signature::{self, UnparsedPublicKey};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use regex::Regex;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::logic::{self, Channel, Origin, Release};

/// Where girovo.de answers: "<base>stable.json", "<base>nightly.json".
pub const MANIFEST_BASE: &str = "https://girovo.de/updates/v1/";
/// The release asset GitHub carries beside the files, and its signature.
pub const MANIFEST_NAME: &str = "girovo-update.json";
pub const SIG_NAME: &str = "girovo-update.json.sig";
/// Signed before the manifest's bytes, so a signature can't be reused for anything else.
const SIGNED_PREFIX: &[u8] = b"girovo-update/1\n";
/// A manifest or a signature is a few kilobytes; anything far past that is not one.
pub const MAX_MANIFEST_BYTES: usize = 256 * 1024;

/// The public keys (mobile/updates/update-keys.ts has the same two).
const STABLE_KEY: &str = "hIxe7Pv8XxowIliZVYOGpjwtWsHKCWgi2LEIwbIZmrw=";
const NIGHTLY_KEY: &str = "HdD/wUqH5Grzgw94akcTP+nFREWm9XoD1k2C2s1AHTU=";

const BUILD_SCALE: u64 = 1_000_000_000;
/// JavaScript's Number.MAX_SAFE_INTEGER: past it the app's two halves would disagree.
const MAX_BUILD: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug)]
pub struct Keys {
  pub stable: Vec<u8>,
  pub nightly: Vec<u8>,
}

impl Keys {
  pub fn builtin() -> Keys {
    Keys { stable: BASE64.decode(STABLE_KEY).unwrap_or_default(), nightly: BASE64.decode(NIGHTLY_KEY).unwrap_or_default() }
  }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Signer {
  Stable,
  Nightly,
}

// ---- build numbers ---------------------------------------------------------------

static VERSION: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^v?(\d{1,3})\.(\d{1,2})\.(\d{1,2})(?:-([0-9A-Za-z.-]+))?$").unwrap());
static DEV: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?:^|-)dev(?:\.[0-9A-Za-z.-]*)?$").unwrap());
static PREVIEW: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^preview\.([1-9]\d?)$").unwrap());
static NIGHTLY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(?:nightly|preview)\.(\d{12})(?:\.g[0-9a-f]{7,40})?$").unwrap());

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
/// "6.0.0-preview.3", "6.0.2-dev.41"), or None when it has none.
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
  if let Some(p) = PREVIEW.captures(&pre) {
    return Some((code - 1) * BUILD_SCALE + p[1].parse::<u64>().ok()?);
  }
  let n = stamp_minutes(&NIGHTLY.captures(&pre)?[1])?;
  Some((code - 1) * BUILD_SCALE + n)
}

// ---- signatures ---------------------------------------------------------------

/// A public key's short name: the first 8 bytes of its SHA-256, in hex.
pub fn key_id(public_key: &[u8]) -> String {
  Sha256::digest(public_key)[..8].iter().map(|b| format!("{b:02x}")).collect()
}

fn signed_message(bytes: &[u8]) -> Vec<u8> {
  [SIGNED_PREFIX, bytes].concat()
}

/// Which key signed `bytes`, or None when the signature is missing,
/// malformed or by neither. Never panics on odd input.
pub fn verify(bytes: &[u8], sig_text: &str, keys: &Keys) -> Option<Signer> {
  let sig: Value = serde_json::from_str(sig_text).ok()?;
  if sig.get("format")?.as_str()? != "girovo-update-sig" || sig.get("v")?.as_u64()? != 1 {
    return None;
  }
  let signature = BASE64.decode(sig.get("sig")?.as_str()?).ok().filter(|s| s.len() == 64)?;
  let named = sig.get("key")?.as_str()?;
  let message = signed_message(bytes);
  [(Signer::Stable, &keys.stable), (Signer::Nightly, &keys.nightly)].into_iter().find_map(|(who, key)| {
    (key.len() == 32 && named == key_id(key) && UnparsedPublicKey::new(&signature::ED25519, key).verify(&message, &signature).is_ok())
      .then_some(who)
  })
}

/// Whether a manifest signed by `signer` may be offered on `channel`.
pub fn signer_fits(signer: Option<Signer>, channel: Channel) -> bool {
  matches!((signer, channel), (Some(Signer::Stable), _) | (Some(Signer::Nightly), Channel::Preview))
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
/// format, a build number that is not its version's, files outside the
/// project's downloads.
pub fn release_of(bytes: &[u8], origin: &Origin) -> Option<Release> {
  let m: Value = serde_json::from_slice(bytes).ok()?;
  if m.get("format")?.as_str()? != "girovo-update" || m.get("v")?.as_u64()? != 1 {
    return None;
  }
  let version = m.get("version")?.as_str()?.to_string();
  if Some(m.get("build")?.as_u64()?) != build_number(&version) {
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

/// The release to offer from girovo.de's listing: the first one signed with a
/// key that fits the channel, readable, and reaching this installation.
pub fn pick_listed(listing: &[Listed], channel: Channel, keys: &Keys, origin: &Origin, install_id: &str, early: bool) -> Option<Release> {
  listing.iter().find_map(|l| {
    if !signer_fits(verify(l.manifest.as_bytes(), &l.sig, keys), channel) {
      return None;
    }
    let release = release_of(l.manifest.as_bytes(), origin).filter(|r| r.version == l.version)?;
    reaches(l.rollout, bucket(install_id, &release.version), early).then_some(release)
  })
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

  pub fn sign(bytes: &[u8], pair: &Ed25519KeyPair) -> String {
    let sig = pair.sign(&signed_message(bytes));
    json!({ "format": "girovo-update-sig", "v": 1, "key": key_id(pair.public_key().as_ref()), "sig": BASE64.encode(sig.as_ref()) }).to_string()
  }
}

#[cfg(test)]
mod tests {
  use super::testing::{pair, sign};
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

  fn keys() -> (Keys, aws_lc_rs::signature::Ed25519KeyPair, aws_lc_rs::signature::Ed25519KeyPair) {
    let (stable, s) = pair(1);
    let (nightly, n) = pair(2);
    (Keys { stable: s, nightly: n }, stable, nightly)
  }

  #[test]
  fn a_signature_names_its_key_and_verifies_only_with_it() {
    let (keys, stable, nightly) = keys();
    let bytes = b"{\"version\":\"6.0.2\"}\n";
    assert_eq!(verify(bytes, &sign(bytes, &stable), &keys), Some(Signer::Stable));
    assert_eq!(verify(bytes, &sign(bytes, &nightly), &keys), Some(Signer::Nightly));
    assert_eq!(verify(bytes, &sign(bytes, &pair(3).0), &keys), None, "a stranger's key");
    assert_eq!(verify(b"{\"version\":\"6.0.3\"}\n", &sign(bytes, &stable), &keys), None, "another manifest");
    for bad in ["", "not json", "{\"format\":\"girovo-update-sig\",\"v\":1,\"key\":\"x\",\"sig\":\"AAAA\"}"] {
      assert_eq!(verify(bytes, bad, &keys), None, "{bad}");
    }
  }

  #[test]
  fn a_signature_made_by_the_javascript_tool_verifies_here() {
    // Made by mobile/updates/update-trust.ts signManifest in Node, secret key [1; 32], over "{}\n".
    let from_js = r#"{"format":"girovo-update-sig","v":1,"key":"34750f98bd59fcfc","sig":"DCxhhKZMLOEkMVW/IBS6eYFsWPV2JQg3rcKXEdDEI0uqPB3DQmyfEwbtrZj5A1ZEvfjw+ZFnNhdgjeDZJaGGBA=="}"#;
    let (keys, stable, _) = keys();
    assert_eq!(key_id(&keys.stable), "34750f98bd59fcfc");
    assert_eq!(verify(b"{}\n", from_js, &keys), Some(Signer::Stable));
    let sig_of = |text: &str| serde_json::from_str::<Value>(text).unwrap()["sig"].clone();
    assert_eq!(sig_of(&sign(b"{}\n", &stable)), sig_of(from_js), "Rust signs it the same (Ed25519 is deterministic)");
  }

  #[test]
  fn the_builtin_keys_are_the_owners() {
    let k = Keys::builtin();
    assert_eq!(key_id(&k.stable), "db00cdc657dd9421");
    assert_eq!(key_id(&k.nightly), "bc7687ce7912473c");
  }

  #[test]
  fn which_signer_a_channel_takes() {
    assert!(signer_fits(Some(Signer::Stable), Channel::Stable));
    assert!(signer_fits(Some(Signer::Stable), Channel::Preview));
    assert!(signer_fits(Some(Signer::Nightly), Channel::Preview));
    assert!(!signer_fits(Some(Signer::Nightly), Channel::Stable));
    assert!(!signer_fits(None, Channel::Preview));
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
    let url = |name: &str| format!("https://github.com/elNino0916/Girovo/releases/download/{version}/{name}");
    let setup = format!("Girovo-{version}-Setup.exe");
    json!({
      "format": "girovo-update", "v": 1, "version": version, "build": build_number(version),
      "channel": if version.contains('-') { "nightly" } else { "stable" },
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

  fn listed(version: &str, rollout: f64, signer: &aws_lc_rs::signature::Ed25519KeyPair) -> Listed {
    let manifest = manifest(version);
    Listed { version: version.into(), rollout, sig: sign(manifest.as_bytes(), signer), manifest }
  }

  #[test]
  fn the_first_listed_release_that_is_signed_fitting_and_reaching_is_offered() {
    let (keys, stable, nightly) = keys();
    let o = origin();
    let pick = |list: &[Listed], channel, early| pick_listed(list, channel, &keys, &o, "install-a", early).map(|r| r.version);

    assert_eq!(pick(&[listed("6.0.2", 100.0, &stable)], Channel::Stable, false).as_deref(), Some("6.0.2"));
    assert_eq!(pick(&[listed("6.0.2", 100.0, &nightly)], Channel::Stable, false), None, "the nightly key can't sign a stable release");
    let n = "6.0.2-nightly.202611071832.gc0d6b0c";
    assert_eq!(pick(&[listed(n, 100.0, &nightly)], Channel::Preview, false).as_deref(), Some(n));
    let (stranger, _) = pair(9);
    assert_eq!(pick(&[listed("6.0.2", 100.0, &stranger)], Channel::Stable, false), None);

    // Staged: outside the percentage the next one, with "early" the staged one.
    let b = bucket("install-a", "6.0.3");
    let staged = [listed("6.0.3", f64::from(b), &stable), listed("6.0.2", 100.0, &stable)];
    assert_eq!(pick(&staged, Channel::Stable, false).as_deref(), Some("6.0.2"));
    assert_eq!(pick(&staged, Channel::Stable, true).as_deref(), Some("6.0.3"));
    let open = [listed("6.0.3", f64::from(b) + 1.0, &stable), listed("6.0.2", 100.0, &stable)];
    assert_eq!(pick(&open, Channel::Stable, false).as_deref(), Some("6.0.3"));

    // A listing whose version is not its manifest's is passed over.
    let mut lying = listed("6.0.3", 100.0, &stable);
    lying.version = "6.0.4".into();
    assert_eq!(pick(&[lying, listed("6.0.2", 100.0, &stable)], Channel::Stable, false).as_deref(), Some("6.0.2"));
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
}
