// The updater's decisions, kept apart from Tauri and the network so they can
// be tested on their own: which release counts as newer, which of its files
// this copy of the app needs, and whether that file can be checked before it
// runs. Everything that comes from the network is data — nothing in here
// panics on odd input, it answers "no update".
//
// A port of the Electron shell's update-logic.cjs, function for function, so the Tauri
// shell decides exactly as the Electron one did; its tests came along (below).
// What changed: the portable build and the Android APK are gone from the
// kinds (Tauri builds neither, and the APK updates itself in the page), the
// blockmap's chunks may come from several local files (chunks.rs) — so the
// release of the running version is never looked up by its tag (tagUrl) —
// and the installer is Tauri's NSIS one (installKind, installArgs).

use std::cmp::Ordering;
use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use serde_json::Value;

// The project's repository, renamed with the app. Its old name,
// Sooskasse-FinTS, now belongs to a small repository of its own that carries
// nothing but the update to Girovo: files and release pages under the old name
// still count as ours — the "updated" marker an older install leaves links to
// that repository's release page.
pub const FEED_URL: &str = "https://api.github.com/repos/elNino0916/Girovo/releases/latest";
pub const RELEASES_PAGE: &str = "https://github.com/elNino0916/Girovo/releases";
const RELEASES_PAGES: [&str; 2] = [RELEASES_PAGE, "https://github.com/elNino0916/Sooskasse-FinTS/releases"];
pub const DOWNLOAD_PREFIXES: [&str; 2] = [
  "https://github.com/elNino0916/Girovo/releases/download/",
  "https://github.com/elNino0916/Sooskasse-FinTS/releases/download/",
];

// A release's installer is ~300 MB with the category model; a file far past that is not ours.
const MAX_ASSET_BYTES: u64 = 1024 * 1024 * 1024;
// Release notes are shown in a dialog, not archived.
pub const MAX_NOTES_CHARS: usize = 20_000;
/// How long the updater waits before asking GitHub once more after a passing failure.
pub const RETRY_DELAY: Duration = Duration::from_millis(1500);

/// Whether GitHub's answer is one of its passing failures — 502, 503 or 504:
/// its API and its file servers do that now and then for a moment (a release
/// just published, a busy minute). The updater asks once more after
/// RETRY_DELAY; any other answer is the answer.
pub fn passing_failure(status: u16) -> bool {
  matches!(status, 502..=504)
}

/// How many minutes until GitHub takes requests again, from its refusal's
/// headers: Retry-After (seconds) or, with the quota used up
/// (X-RateLimit-Remaining 0), X-RateLimit-Reset (Unix seconds). At least one;
/// None when the refusal names no time (a 403 for another reason).
pub fn rate_limit_wait(retry_after: Option<&str>, remaining: Option<&str>, reset: Option<&str>, now_secs: u64) -> Option<u64> {
  let secs = match retry_after.and_then(|s| s.trim().parse::<u64>().ok()) {
    Some(after) => after,
    None if remaining.map(str::trim) == Some("0") => reset.and_then(|s| s.trim().parse::<u64>().ok())?.saturating_sub(now_secs),
    None => return None,
  };
  Some(secs.div_ceil(60).max(1))
}

/// How this copy of the app was installed, which decides how it updates.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum InstallKind {
  /// Installed by the Setup.exe: the next Setup.exe updates it in place, silently, and starts it again.
  Nsis,
  /// Anything else — the Linux AppImage and .deb, an unpacked build: the download page.
  Manual,
  /// Not packaged at all (a debug build).
  Dev,
}

/// Which releases are offered: finished ones, or GitHub's pre-releases too (Einstellungen → Update-Kanal).
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
  Stable,
  Preview,
}

impl Channel {
  pub fn as_str(self) -> &'static str {
    match self {
      Channel::Stable => "stable",
      Channel::Preview => "preview",
    }
  }
}

/// `stable` asks for the latest release, which GitHub never lets a pre-release
/// be; `preview` reads the list of releases, pre-releases included
/// (newest_release). Anything stored that is not a channel is the stable one.
pub fn channel_of(value: Option<&str>) -> Channel {
  if value == Some("preview") { Channel::Preview } else { Channel::Stable }
}

/// Whether this start moves the copy from the Nightly channel back to Stabil:
/// a release build (6.0.0, owner 2026-11-07: everyone on Nightly to Stabil
/// for now), with the channel on Nightly, that has not moved it before
/// (`moved`, engine::PREF_MOVED_TO_STABLE) — once, so a Nightly picked again
/// afterwards stays. `moved` is also set by a channel the user picks
/// (Updater::set_channel): a choice is never undone. Never a nightly or a
/// development build.
pub fn moves_to_stable(stored: Option<&str>, current: &str, moved: Option<&str>) -> bool {
  channel_of(stored) == Channel::Preview
    && moved.is_none_or(str::is_empty)
    && parse_version(current).is_some_and(|v| v.pre.is_empty())
}

// ---- an older version from a file ---------------------------------------------
//
// "Update aus Datei installieren" takes an older release too (the way back).
// The start installs updates by itself, so without a note of it the very next
// start would install the newer release again. The note is the version
// stepped back from (engine::PREF_HELD_BACK); these two decide on it, by
// build number (trust::build_number).

/// Whether installing the file's release (`file`) over the running one
/// (`current`) is a step back.
pub fn steps_back(file: Option<u64>, current: Option<u64>) -> bool {
  matches!((file, current), (Some(f), Some(c)) if f < c)
}

/// Whether the start leaves the release on offer (`offered`) to the user:
/// the user stepped back from `held`, and this one is that release or an
/// older one. A newer release than `held` is installed as always.
pub fn held_back(held: Option<u64>, offered: Option<u64>) -> bool {
  matches!((held, offered), (Some(h), Some(o)) if o <= h)
}

// ---- versions ----------------------------------------------------------------

/// "4.1.0", "v4.1.0", "4.1.0-dev.12" → core [4, 1, 0], pre "dev.12".
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Version {
  pub core: [u64; 3],
  pub pre: String,
}

impl Version {
  /// The version as a release names it: "6.0.0" or "6.0.0-preview.2", without a "v" or build metadata.
  pub fn to_plain(&self) -> String {
    let [a, b, c] = self.core;
    if self.pre.is_empty() { format!("{a}.{b}.{c}") } else { format!("{a}.{b}.{c}-{}", self.pre) }
  }
}

fn ident_chars(s: &str) -> bool {
  !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
}

/// None unless `text` is a version: semver's three numbers of 1–9 digits, an
/// optional pre-release and build metadata of [0-9A-Za-z.-], a leading "v".
pub fn parse_version(text: &str) -> Option<Version> {
  let t = text.trim();
  let t = t.strip_prefix('v').unwrap_or(t);
  let (main, build) = match t.find('+') {
    Some(i) => (&t[..i], Some(&t[i + 1..])),
    None => (t, None),
  };
  if build.is_some_and(|b| !ident_chars(b)) {
    return None;
  }
  let (core, pre) = match main.find('-') {
    Some(i) => (&main[..i], Some(&main[i + 1..])),
    None => (main, None),
  };
  if pre.is_some_and(|p| !ident_chars(p)) {
    return None;
  }
  let mut numbers = [0u64; 3];
  let mut parts = core.split('.');
  for slot in &mut numbers {
    let part = parts.next()?;
    if part.is_empty() || part.len() > 9 || !part.bytes().all(|b| b.is_ascii_digit()) {
      return None;
    }
    *slot = part.parse().ok()?;
  }
  if parts.next().is_some() {
    return None;
  }
  Some(Version { core: numbers, pre: pre.unwrap_or("").to_string() })
}

/// Whether `text` is a version exactly as a release names it: "6.0.2" or
/// "6.0.2-nightly.…", not "v6.0.2", "06.0.2" or " 6.0.2", which parse_version
/// reads as the same version.
pub fn is_plain_version(text: &str) -> bool {
  parse_version(text).is_some_and(|v| v.to_plain() == text)
}

/// Two runs of digits by their value, however long: without leading zeros, the longer one is larger.
fn compare_digits(a: &str, b: &str) -> Ordering {
  let a = a.trim_start_matches('0');
  let b = b.trim_start_matches('0');
  a.len().cmp(&b.len()).then_with(|| a.cmp(b))
}

/// Semver's order of two pre-release tags ("preview.2" against "preview.10"):
/// field by field, numbers by value and below words, words by their ASCII
/// order; with all fields equal, the one with more fields is the later one.
fn compare_pre(a: &str, b: &str) -> Ordering {
  let x: Vec<&str> = a.split('.').collect();
  let y: Vec<&str> = b.split('.').collect();
  for i in 0..x.len().max(y.len()) {
    if i >= x.len() {
      return Ordering::Less;
    }
    if i >= y.len() {
      return Ordering::Greater;
    }
    let x_num = !x[i].is_empty() && x[i].bytes().all(|c| c.is_ascii_digit());
    let y_num = !y[i].is_empty() && y[i].bytes().all(|c| c.is_ascii_digit());
    let order = match (x_num, y_num) {
      (true, true) => compare_digits(x[i], y[i]),
      (true, false) => Ordering::Less,
      (false, true) => Ordering::Greater,
      (false, false) => x[i].cmp(y[i]),
    };
    if order != Ordering::Equal {
      return order;
    }
  }
  Ordering::Equal
}

/// A nightly's tag as it is ordered: "nightly.<yyyymmddhhmm>…", and the
/// nightlies before the name changed, "preview.<yyyymmddhhmm>…" (12 digits
/// and more, never a hand-made preview's number), both as "~nightly.<stamp>…":
/// by their time among themselves, and after a hand-made "preview.N" — "~"
/// comes after every letter — whose release came before them. Never shown.
fn ordered_pre(pre: &str) -> std::borrow::Cow<'_, str> {
  let stamp_after = |prefix: &str| {
    pre.strip_prefix(prefix).filter(|rest| {
      let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
      digits >= 12 && (rest.len() == digits || rest.as_bytes()[digits] == b'.')
    })
  };
  match stamp_after("nightly.").or_else(|| stamp_after("preview.")) {
    Some(rest) => std::borrow::Cow::Owned(format!("~nightly.{rest}")),
    None => std::borrow::Cow::Borrowed(pre),
  }
}

/// Two parsed versions in semver's order: a pre-release comes before its release.
fn compare_parsed(a: &Version, b: &Version) -> Ordering {
  a.core.cmp(&b.core).then_with(|| match (a.pre.is_empty(), b.pre.is_empty()) {
    (true, true) => Ordering::Equal,
    (false, true) => Ordering::Less,
    (true, false) => Ordering::Greater,
    (false, false) => compare_pre(&ordered_pre(&a.pre), &ordered_pre(&b.pre)),
  })
}

/// The order of `a` and `b` (semver); None when either is not a version.
pub fn compare_versions(a: &str, b: &str) -> Option<Ordering> {
  Some(compare_parsed(&parse_version(a)?, &parse_version(b)?))
}

/// The pre-release a CI build was numbered after: CI stamps development builds
/// `<package.json version>-dev.<run>` — "4.0.0-dev.57", or
/// "6.0.0-preview.2-dev.3" while package.json holds a pre-release. None for
/// any other pre-release. (update-logic.cjs's /^(?:(.*)-)?dev(?:\.…)?$/i: the
/// last "-dev" that ends the tag or is followed by a dot, else a leading one.)
fn dev_base(pre: &str) -> Option<&str> {
  let bytes = pre.as_bytes();
  for i in (0..=pre.len().saturating_sub(3)).rev() {
    if pre.len() < 3 || !bytes[i..i + 3].eq_ignore_ascii_case(b"dev") {
      continue;
    }
    if bytes.get(i + 3).is_some_and(|&c| c != b'.') {
      continue;
    }
    if i == 0 {
      return Some("");
    }
    if bytes[i - 1] == b'-' {
      return Some(&pre[..i - 1]);
    }
  }
  None
}

fn without_dev(v: &Version) -> Version {
  match dev_base(&v.pre) {
    Some(base) => Version { core: v.core, pre: base.to_string() },
    None => v.clone(),
  }
}

/// Whether `version` is a CI development build (see dev_base).
pub fn is_dev_build(version: &str) -> bool {
  parse_version(version).is_some_and(|v| dev_base(&v.pre).is_some())
}

/// Whether the release `candidate` is an update for the running `current`.
///
/// Semver, with one turn for this project's development builds: package.json
/// keeps the last release's number until the next one is cut — so
/// 4.0.0-dev.57 is built from code *after* 4.0.0, not before it, and a release
/// only counts as newer when it is higher than 4.0.0 itself. Any other
/// pre-release (4.1.0-beta.1) does come before its release, as semver has it.
///
/// A pre-release is offered only with `prerelease` (the preview channel):
/// 6.0.0-preview.2 after 6.0.0-preview.1 after 5.16.1, and 6.0.0 after every
/// 6.0.0-preview.N.
pub fn is_newer(candidate: &str, current: &str, prerelease: bool) -> bool {
  let (Some(c), Some(v)) = (parse_version(candidate), parse_version(current)) else { return false };
  if !c.pre.is_empty() && !prerelease {
    return false;
  }
  compare_parsed(&c, &without_dev(&v)) == Ordering::Greater
}

/// Whether `candidate`, a stable release, is the way back for an install of a
/// preview (`current`, a pre-release): on "Stabil" the desktop app offers the
/// latest stable release even where it is older than the preview it runs
/// (owner, 2026-11-03) — going back to the channel goes back to its version.
/// Never for a CI development build, never a pre-release, never a newer one
/// (that is is_newer's).
pub fn is_switch_back(candidate: &str, current: &str) -> bool {
  let (Some(c), Some(v)) = (parse_version(candidate), parse_version(current)) else { return false };
  if !c.pre.is_empty() || v.pre.is_empty() || is_dev_build(current) {
    return false;
  }
  compare_parsed(&c, &v) == Ordering::Less
}

// ---- releases ----------------------------------------------------------------

/// A file of a release, as far as the updater trusts it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Asset {
  pub name: String,
  pub url: String,
  pub size: u64,
  /// GitHub's own SHA-256 of the file (lower-case hex); None when it lists none.
  pub sha256: Option<String>,
}

/// GitHub's answer for one release, reduced to what the updater needs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Release {
  pub version: String,
  pub name: String,
  pub notes: String,
  pub url: String,
  pub published_at: Option<String>,
  pub assets: Vec<Asset>,
}

/// Where a release's links may point; the real repository's by default, a test server's in the tests.
#[derive(Clone, Debug)]
pub struct Origin {
  pub download_prefixes: Vec<String>,
  pub releases_page: String,
}

impl Default for Origin {
  fn default() -> Self {
    Origin {
      download_prefixes: DOWNLOAD_PREFIXES.iter().map(|p| p.to_string()).collect(),
      releases_page: RELEASES_PAGE.to_string(),
    }
  }
}

/// A file name that can safely become a path on disk: no folders, no tricks.
fn safe_file_name(name: &str) -> bool {
  let b = name.as_bytes();
  !b.is_empty()
    && b.len() <= 151
    && b[0].is_ascii_alphanumeric()
    && b.iter().all(|&c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'+' | b'-'))
    && !name.contains("..")
}

/// JavaScript's idea of truth, for the flags in GitHub's answer.
fn truthy(v: Option<&Value>) -> bool {
  match v {
    None | Some(Value::Null) => false,
    Some(Value::Bool(b)) => *b,
    Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
    Some(Value::String(s)) => !s.is_empty(),
    Some(_) => true,
  }
}

fn str_of<'a>(v: &'a Value, key: &str) -> &'a str {
  v.get(key).and_then(Value::as_str).unwrap_or("")
}

pub(super) fn parse_asset(raw: &Value, origin: &Origin) -> Option<Asset> {
  if !raw.is_object() {
    return None;
  }
  let name = str_of(raw, "name");
  let url = str_of(raw, "browser_download_url");
  if !safe_file_name(name) || !origin.download_prefixes.iter().any(|p| url.starts_with(p.as_str())) {
    return None;
  }
  let size = raw.get("size").and_then(Value::as_u64).filter(|&s| s > 0 && s <= MAX_ASSET_BYTES)?;
  // GitHub computes this itself for every uploaded file; it is what the
  // download is checked against before anything runs.
  let digest = str_of(raw, "digest");
  let sha256 = digest
    .get(..7)
    .filter(|prefix| digest.len() == 71 && prefix.eq_ignore_ascii_case("sha256:"))
    .and_then(|_| digest.get(7..))
    .filter(|hex| hex.bytes().all(|c| c.is_ascii_hexdigit()))
    .map(str::to_ascii_lowercase);
  Some(Asset { name: name.to_string(), url: url.to_string(), size, sha256 })
}

/// `url` if it is a page of one of the project's releases — under either
/// repository name when `releases_page` is the real one — else `releases_page`.
pub fn release_page_or(url: Option<&str>, releases_page: &str) -> String {
  let ours = |page: &str| url.is_some_and(|u| u.starts_with(&format!("{page}/")));
  let matched = if releases_page == RELEASES_PAGE { RELEASES_PAGES.iter().any(|p| ours(p)) } else { ours(releases_page) };
  match url {
    Some(u) if matched => u.to_string(),
    _ => releases_page.to_string(),
  }
}

pub(super) fn first_chars(text: &str, max: usize) -> String {
  text.chars().take(max).collect()
}

/// GitHub's answer for one release, or None when it is not a usable release:
/// a draft, a tag that is not a version, and without `prerelease` a
/// pre-release (one GitHub marks as such, or one whose tag is one).
pub fn parse_release(json: &Value, origin: &Origin, prerelease: bool) -> Option<Release> {
  if !json.is_object() || truthy(json.get("draft")) || (truthy(json.get("prerelease")) && !prerelease) {
    return None;
  }
  let parsed = parse_version(str_of(json, "tag_name"))?;
  if !parsed.pre.is_empty() && !prerelease {
    return None;
  }
  let version = parsed.to_plain();
  let name = str_of(json, "name").trim();
  let name = if name.is_empty() { version.clone() } else { first_chars(name, 200) };
  Some(Release {
    name,
    notes: first_chars(str_of(json, "body"), MAX_NOTES_CHARS),
    url: release_page_or(json.get("html_url").and_then(Value::as_str), &origin.releases_page),
    published_at: json.get("published_at").and_then(Value::as_str).and_then(iso_instant),
    assets: json
      .get("assets")
      .and_then(Value::as_array)
      .map(|list| list.iter().filter_map(|a| parse_asset(a, origin)).collect())
      .unwrap_or_default(),
    version,
  })
}

/// The update for `current` in GitHub's list of releases (…/releases, the
/// preview channel's feed): the release with the highest version above it,
/// pre-releases included, drafts never. None when none is newer, or when
/// `list` is not a list.
///
/// With `kind`, only a release that carries that install's file counts: a
/// release without a Setup.exe is nothing the installed app could install.
pub fn newest_release(list: &Value, current: &str, origin: &Origin, kind: Option<InstallKind>) -> Option<Release> {
  let mut best: Option<Release> = None;
  for json in list.as_array()? {
    let Some(release) = parse_release(json, origin, true) else { continue };
    if !is_newer(&release.version, current, true) {
      continue;
    }
    if kind == Some(InstallKind::Nsis) && pick_asset(&release, InstallKind::Nsis).is_none() {
      continue;
    }
    if best.as_ref().is_none_or(|b| compare_versions(&release.version, &b.version) == Some(Ordering::Greater)) {
      best = Some(release);
    }
  }
  best
}

/// The file of `release` that updates an install of `kind`: the Setup.exe for
/// the installed app (any case — Tauri's own name ends in "-setup.exe"), none for the rest.
pub fn pick_asset(release: &Release, kind: InstallKind) -> Option<&Asset> {
  if kind != InstallKind::Nsis {
    return None;
  }
  release.assets.iter().find(|a| a.name.to_ascii_lowercase().ends_with("-setup.exe"))
}

/// The version in an installer's file name, Girovo-<version>-Setup.exe — in
/// any case, and also as a browser or Explorer names a second copy of it:
/// "Girovo-6.0.3-Setup (1).exe", "Girovo-6.0.3-Setup - Kopie.exe". None when
/// the name carries no version. The name only says where to look: the file is
/// still checked against the signed manifest found there.
pub fn setup_version(name: &str) -> Option<&str> {
  // ASCII lower case keeps every byte where it was.
  let lower = name.to_ascii_lowercase();
  let rest = lower.strip_suffix(".exe")?.strip_prefix("girovo-")?;
  let at = rest.rfind("-setup")?;
  // What a copy adds comes after a space, a bracket, a dash; "-Setup2" is another name.
  if rest[at + "-setup".len()..].starts_with(|c: char| c.is_alphanumeric()) {
    return None;
  }
  let version = name.get("girovo-".len()..)?.get(..at)?;
  is_plain_version(version).then_some(version)
}

/// Whether `name` is a Girovo installer's, as released or as a copy was
/// renamed (setup_version), with or without a version in it: what a file
/// dropped on the window is taken for.
pub fn is_setup_name(name: &str) -> bool {
  let lower = name.to_ascii_lowercase();
  lower.starts_with("girovo") && lower.ends_with(".exe") && lower.contains("-setup")
}

// The list starts with the newest releases. A hundred: the nightly desktop
// previews, one a night, must not push the last hand-made preview off the one
// page read.
const LIST_PAGE_SIZE: u32 = 100;

/// The list of releases beside `feed_url` (…/releases/latest → …/releases), or None when there is none.
pub fn list_url(feed_url: &str) -> Option<String> {
  let base = feed_url.strip_suffix("/latest")?;
  Some(format!("{base}?per_page={LIST_PAGE_SIZE}"))
}

// ---- differential ------------------------------------------------------------

/// The blockmap CI writes beside `asset` (name + ".blockmap"), if the release has it.
pub fn pick_blockmap<'a>(release: &'a Release, asset: &Asset) -> Option<&'a Asset> {
  let name = format!("{}.blockmap", asset.name);
  release.assets.iter().find(|a| a.name == name)
}

/// A piece of a file by its content: where it starts, how long it is, and the
/// checksum it is recognised by. `src` says which file it is in, for chunks of
/// the installed copy (chunks.rs); a blockmap's chunks are all in file 0.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Chunk {
  pub checksum: String,
  pub size: u64,
  pub offset: u64,
  pub src: usize,
}

// A blockmap of a ~300 MB installer lists ~8,000 chunks; ten times that is not ours.
const MAX_BLOCKMAP_CHUNKS: usize = 100_000;

/// A blockmap in electron-builder's format, version 2 (already un-gzipped
/// and parsed), reduced to its chunks in file order. None unless it is one
/// file starting at 0 whose chunks add up to exactly `file_size` — the
/// installer it claims to describe.
pub fn parse_blockmap(json: &Value, file_size: u64) -> Option<Vec<Chunk>> {
  if json.get("version").and_then(Value::as_str) != Some("2") {
    return None;
  }
  let files = json.get("files").and_then(Value::as_array).filter(|f| f.len() == 1)?;
  let file = &files[0];
  if file.get("offset").and_then(Value::as_u64) != Some(0) {
    return None;
  }
  let checksums = file.get("checksums").and_then(Value::as_array)?;
  let sizes = file.get("sizes").and_then(Value::as_array)?;
  if checksums.len() != sizes.len() || checksums.is_empty() || checksums.len() > MAX_BLOCKMAP_CHUNKS {
    return None;
  }
  let mut chunks = Vec::with_capacity(sizes.len());
  let mut at = 0u64;
  for (size, checksum) in sizes.iter().zip(checksums) {
    let size = size.as_u64().filter(|&s| s > 0 && s <= MAX_ASSET_BYTES)?;
    let checksum = checksum.as_str().filter(|c| !c.is_empty() && c.len() <= 128)?;
    chunks.push(Chunk { checksum: checksum.to_string(), size, offset: at, src: 0 });
    at += size;
  }
  (at == file_size).then_some(chunks)
}

/// A byte range of the new file copied from a local file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CopyRange {
  pub src: usize,
  pub from: u64,
  pub to: u64,
  pub size: u64,
}

/// A byte range of the new file fetched from the release.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FetchRange {
  pub start: u64,
  pub size: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Plan {
  pub copies: Vec<CopyRange>,
  pub fetches: Vec<FetchRange>,
  pub fetch_bytes: u64,
}

/// How to build the new installer from what is on disk: which of its byte
/// ranges can be copied from a local file and which have to be fetched. A
/// chunk counts as present when a local one has the same checksum and size.
/// Fetched ranges closer than `merge_gap` bytes are fetched as one — a
/// request costs more than a few kilobytes.
pub fn plan_differential(old: &[Chunk], new: &[Chunk], merge_gap: u64) -> Plan {
  let mut have: HashMap<(u64, &str), (usize, u64)> = HashMap::new();
  for c in old {
    have.entry((c.size, c.checksum.as_str())).or_insert((c.src, c.offset));
  }
  struct Run {
    fetch: bool,
    src: usize,
    from: u64,
    to: u64,
    size: u64,
  }
  // In file order: runs of copied and fetched chunks, neighbours merged.
  let mut runs: Vec<Run> = Vec::new();
  for c in new {
    let found = have.get(&(c.size, c.checksum.as_str())).copied();
    let last = runs.last_mut();
    match (found, last) {
      (None, Some(last)) if last.fetch => last.size += c.size,
      (None, _) => runs.push(Run { fetch: true, src: 0, from: 0, to: c.offset, size: c.size }),
      (Some((src, from)), Some(last)) if !last.fetch && last.src == src && last.from + last.size == from => {
        last.size += c.size
      }
      (Some((src, from)), _) => runs.push(Run { fetch: false, src, from, to: c.offset, size: c.size }),
    }
  }
  let mut copies: Vec<CopyRange> = Vec::new();
  let mut fetches: Vec<FetchRange> = Vec::new();
  for (i, run) in runs.iter().enumerate() {
    let follows = fetches.last().is_some_and(|f| f.start + f.size == run.to);
    if run.fetch {
      // A short copy between two fetches was folded into the earlier one below.
      match fetches.last_mut() {
        Some(prev) if follows => prev.size += run.size,
        _ => fetches.push(FetchRange { start: run.to, size: run.size }),
      }
    } else if follows && run.size <= merge_gap && runs.get(i + 1).is_some_and(|r| r.fetch) {
      fetches.last_mut().expect("follows a fetch").size += run.size;
    } else {
      copies.push(CopyRange { src: run.src, from: run.from, to: run.to, size: run.size });
    }
  }
  let fetch_bytes = fetches.iter().map(|f| f.size).sum();
  Plan { copies, fetches, fetch_bytes }
}

// ---- installing ----------------------------------------------------------------

/// How this copy of the app was installed (InstallKind). Tauri's NSIS
/// installer puts its uninstaller beside the executable as uninstall.exe;
/// nothing else on Windows does, and nothing on Linux updates itself — the
/// AppImage and the .deb get the download page, as under Electron.
pub fn install_kind(packaged: bool, windows: bool, exe: &Path, exists: impl Fn(&Path) -> bool) -> InstallKind {
  if !packaged {
    return InstallKind::Dev;
  }
  match exe.parent() {
    Some(dir) if windows && exists(&dir.join("uninstall.exe")) => InstallKind::Nsis,
    _ => InstallKind::Manual,
  }
}

/// The arguments the downloaded Setup.exe is started with, understood by
/// both kinds of installer a release may carry — Tauri's, and on the way back
/// to 5.x electron-builder's:
///
///   /S             NSIS itself: no wizard, into the existing install.
///   /UPDATE        Tauri: an update — keep the shortcuts as they are, skip WebView2.
///   /R, /ARGS …    Tauri: start the app when done, with the rest of the line
///                  ("--updated --force-run", GetOptions reads up to the next " /").
///   --updated      electron-builder: this replaces a running app (5.x's installer
///                  script waits for it to close); the app itself takes it as "the old
///                  instance may still be closing".
///   --force-run    electron-builder: start the app when done. The Tauri app ignores it.
pub fn install_args(kind: InstallKind) -> Option<Vec<String>> {
  match kind {
    InstallKind::Nsis => Some(["/S", "/UPDATE", "/R", "/ARGS", "--updated", "--force-run"].map(String::from).to_vec()),
    InstallKind::Manual | InstallKind::Dev => None,
  }
}

// ---- dates -----------------------------------------------------------------------

/// Days since 1970-01-01 of a date in the proleptic Gregorian calendar (Howard Hinnant's days_from_civil).
pub(super) fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
  let y = if m <= 2 { y - 1 } else { y };
  let era = if y >= 0 { y } else { y - 399 } / 400;
  let yoe = y - era * 400;
  let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
  let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
  let z = z + 719_468;
  let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
  let doe = z - era * 146_097;
  let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
  let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  let mp = (5 * doy + 2) / 153;
  let d = doy - (153 * mp + 2) / 5 + 1;
  let m = if mp < 10 { mp + 3 } else { mp - 9 };
  (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// GitHub's timestamp ("2026-10-10T12:00:00Z", or with an offset or
/// fractions) as JavaScript's toISOString writes it, "2026-10-10T12:00:00.000Z":
/// the very string the Electron shell handed the page. None for anything else.
pub fn iso_instant(text: &str) -> Option<String> {
  let b = text.as_bytes();
  let num = |from: usize, len: usize| -> Option<i64> {
    let s = text.get(from..from + len)?;
    s.bytes().all(|c| c.is_ascii_digit()).then(|| s.parse().ok()).flatten()
  };
  if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || !matches!(b[10], b'T' | b't') || b[13] != b':' || b[16] != b':' {
    return None;
  }
  let (y, mo, d, h, mi, s) = (num(0, 4)?, num(5, 2)?, num(8, 2)?, num(11, 2)?, num(14, 2)?, num(17, 2)?);
  if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || s > 59 {
    return None;
  }
  let mut at = 19;
  let mut millis = 0i64;
  if b.get(at) == Some(&b'.') {
    let digits = b[at + 1..].iter().take_while(|c| c.is_ascii_digit()).count();
    if digits == 0 {
      return None;
    }
    let frac = &text[at + 1..at + 1 + digits.min(3)];
    millis = format!("{frac:0<3}").parse().ok()?;
    at += 1 + digits;
  }
  let offset_min = match b.get(at..)? {
    [b'Z' | b'z'] => 0,
    [sign @ (b'+' | b'-'), _, _, b':', _, _] => {
      let (oh, om) = (num(at + 1, 2)?, num(at + 4, 2)?);
      let total = oh * 60 + om;
      if *sign == b'+' { total } else { -total }
    }
    _ => return None,
  };
  let ms = ((days_from_civil(y, mo, d) * 86_400 + h * 3600 + mi * 60 + s - offset_min * 60) * 1000) + millis;
  let (days, rest) = (ms.div_euclid(86_400_000), ms.rem_euclid(86_400_000));
  let (y, mo, d) = civil_from_days(days);
  Some(format!(
    "{y:04}-{mo:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
    rest / 3_600_000,
    rest / 60_000 % 60,
    rest / 1000 % 60,
    rest % 1000
  ))
}

#[cfg(test)]
mod tests {
  // the Electron shell's update-logic.test.cjs, test for test. Left out: the portable
  // build and the Android APK (not kinds here), and installKind's Electron
  // layout ("Uninstall Girovo.exe", Tauri's is uninstall.exe).
  use super::*;
  use serde_json::json;

  const DIGEST: &str = "sha256:abababababababababababababababababababababababababababababababab";
  const DOWNLOAD_PREFIX: &str = DOWNLOAD_PREFIXES[0];

  fn asset(name: &str) -> Value {
    json!({ "name": name, "size": 104_919_142, "digest": DIGEST, "browser_download_url": format!("{DOWNLOAD_PREFIX}4.1.0/{name}") })
  }

  fn asset_with(name: &str, extra: Value) -> Value {
    let mut a = asset(name);
    for (k, v) in extra.as_object().unwrap() {
      a[k] = v.clone();
    }
    a
  }

  fn release(extra: Value) -> Value {
    let mut r = json!({
      "tag_name": "4.1.0",
      "name": "4.1.0",
      "draft": false,
      "prerelease": false,
      "body": "## Neu\n- Updates in der App",
      "html_url": format!("{RELEASES_PAGE}/tag/4.1.0"),
      "published_at": "2026-10-10T12:00:00Z",
      "assets": [asset("Sooskasse-FinTS-4.1.0-Setup.exe"), asset("Sooskasse-FinTS-4.1.0-portable.exe")],
    });
    for (k, v) in extra.as_object().unwrap() {
      r[k] = v.clone();
    }
    r
  }

  fn parse(json: Value) -> Option<Release> {
    parse_release(&json, &Origin::default(), false)
  }

  fn parse_pre(json: Value) -> Option<Release> {
    parse_release(&json, &Origin::default(), true)
  }

  fn newest(list: &Value, current: &str) -> Option<String> {
    newest_release(list, current, &Origin::default(), None).map(|r| r.version)
  }

  #[test]
  fn a_release_moves_a_nightly_copy_back_to_stable_once() {
    // 6.0.0 on the Nightly channel, never moved: back to Stabil.
    assert!(moves_to_stable(Some("preview"), "6.0.0", None));
    assert!(moves_to_stable(Some("preview"), "6.0.0", Some("")));
    // Moved before: a Nightly picked again stays.
    assert!(!moves_to_stable(Some("preview"), "6.0.1", Some("6.0.0")));
    // Already on Stabil, or no choice stored (Stabil).
    assert!(!moves_to_stable(Some("stable"), "6.0.0", None));
    assert!(!moves_to_stable(None, "6.0.0", None));
    // Nightlies and development builds keep their channel.
    assert!(!moves_to_stable(Some("preview"), "6.0.0-nightly.202611071435.gfe8c9a6", None));
    assert!(!moves_to_stable(Some("preview"), "6.0.0-dev.57", None));
    assert!(!moves_to_stable(Some("preview"), "not a version", None));
  }

  #[test]
  fn after_a_step_back_the_start_leaves_releases_up_to_that_one_alone() {
    // An older release from a file is a step back; the same or a newer one is not.
    assert!(steps_back(Some(600_010), Some(600_020)));
    assert!(!steps_back(Some(600_020), Some(600_020)));
    assert!(!steps_back(Some(600_030), Some(600_020)));
    assert!(!steps_back(None, Some(600_020)) && !steps_back(Some(600_010), None));
    // Stepped back from 600_020: that release and anything older waits for the user…
    assert!(held_back(Some(600_020), Some(600_020)));
    assert!(held_back(Some(600_020), Some(600_015)));
    // …a newer one is installed as always, and so is everything with no step back.
    assert!(!held_back(Some(600_020), Some(600_030)));
    assert!(!held_back(None, Some(600_030)));
    assert!(!held_back(Some(600_020), None), "a release without a build number is not this rule's to stop");
  }

  #[test]
  fn a_version_is_plain_only_as_a_release_names_it() {
    for v in ["6.0.2", "6.0.2-nightly.202611071832.gc0d6b0c", "6.0.0-preview.3", "10.12.3"] {
      assert!(is_plain_version(v), "{v}");
    }
    for v in ["v6.0.2", "06.0.2", "6.00.2", " 6.0.2", "6.0.2 ", "6.0.2+build", "6.0", "", "six"] {
      assert!(!is_plain_version(v), "{v:?}");
    }
  }

  #[test]
  fn an_installers_name_gives_its_version_also_when_a_copy_was_renamed() {
    let nightly = "6.0.2-nightly.202611071832.gc0d6b0c";
    for (name, version) in [
      ("Girovo-6.0.3-Setup.exe", "6.0.3"),
      ("girovo-6.0.3-setup.EXE", "6.0.3"),
      ("Girovo-6.0.3-Setup (1).exe", "6.0.3"),
      ("Girovo-6.0.3-Setup(2).exe", "6.0.3"),
      ("Girovo-6.0.3-Setup - Kopie.exe", "6.0.3"),
      ("Girovo-6.0.3-Setup - Copy (2).exe", "6.0.3"),
      ("Girovo-6.0.3-Setup_1.exe", "6.0.3"),
      ("Girovo-6.0.2-nightly.202611071832.gc0d6b0c-Setup (1).exe", nightly),
    ] {
      assert_eq!(setup_version(name), Some(version), "{name}");
      assert!(is_setup_name(name), "{name}");
    }
    for name in [
      "Girovo-Setup (1).exe",
      "Girovo-6.0.3-Setup2.exe",
      "Girovo-6.0.3-SetupKopie.exe",
      "Girovo-v6.0.3-Setup.exe",
      "Girovo-06.0.3-Setup.exe",
      "Girovo-6.0-Setup.exe",
      "Girovo-6.0.3-Setup.msi",
      "Other-6.0.3-Setup.exe",
      "Girovo-6.0.3 -Setup.exe",
      "Girövo-6.0.3-Setup.exe",
      "",
    ] {
      assert_eq!(setup_version(name), None, "{name:?}");
    }
    // A drop on the window: a Girovo installer by its name, version or not.
    assert!(is_setup_name("Girovo-Setup (1).exe"));
    assert!(is_setup_name("Girovo Nightly-6.0.3-setup.exe"));
    for name in ["Girovo-6.0.3.exe", "Other-6.0.3-Setup.exe", "Girovo-6.0.3-Setup.zip", ""] {
      assert!(!is_setup_name(name), "{name:?}");
    }
  }

  #[test]
  fn the_wait_github_names_in_whole_minutes() {
    let now = 1_794_061_874;
    // The quota used up: until its reset, rounded up.
    assert_eq!(rate_limit_wait(None, Some("0"), Some("1794063734"), now), Some(31));
    // Retry-After wins where GitHub sends it.
    assert_eq!(rate_limit_wait(Some("90"), Some("0"), Some("1794063734"), now), Some(2));
    // A reset already past, or seconds away: still "about a minute".
    assert_eq!(rate_limit_wait(None, Some("0"), Some("1794061800"), now), Some(1));
    assert_eq!(rate_limit_wait(Some("5"), None, None, now), Some(1));
    // A 403 with quota left, or without the headers: no time to name.
    assert_eq!(rate_limit_wait(None, Some("12"), Some("1794063734"), now), None);
    assert_eq!(rate_limit_wait(None, None, None, now), None);
    assert_eq!(rate_limit_wait(None, Some("0"), Some("soon"), now), None);
  }

  #[test]
  fn nightlies_by_their_time_after_the_hand_made_preview_and_before_the_release() {
    let old = "6.0.0-preview.202611071124.g36b2a39";
    let new = "6.0.0-nightly.202611071530.gabc1234";
    assert!(is_newer(new, old, true), "the renamed nightly follows the old one");
    assert!(!is_newer(old, new, true));
    assert!(is_newer("6.0.0-nightly.202611080217.gdef5678", new, true));
    assert!(!is_newer("6.0.0-preview.1", new, true), "a hand-made preview is older than any nightly");
    assert!(is_newer(new, "6.0.0-preview.1", true));
    assert!(is_newer("6.0.0", new, true), "the release after its nightlies");
    assert!(!is_newer(new, "6.0.0", true));
  }

  #[test]
  fn is_newer_plain_releases_compare_by_semver() {
    assert!(is_newer("4.1.0", "4.0.0", false));
    assert!(is_newer("v4.0.1", "4.0.0", false));
    assert!(is_newer("5.0.0", "4.12.3", false));
    assert!(is_newer("4.0.10", "4.0.9", false));
    assert!(!is_newer("4.0.0", "4.0.0", false));
    assert!(!is_newer("3.1.3", "4.0.0", false));
  }

  #[test]
  fn is_newer_a_dev_build_is_newer_than_the_release_it_was_numbered_after() {
    // CI builds from main after 4.0.0 are 4.0.0-dev.N: 4.0.0 is not an update for them.
    assert!(!is_newer("4.0.0", "4.0.0-dev.57", false));
    assert!(is_newer("4.0.1", "4.0.0-dev.57", false));
    // Any other pre-release comes before its release.
    assert!(is_newer("4.1.0", "4.1.0-beta.2", false));
  }

  #[test]
  fn compare_versions_orders_pre_releases_as_semver_does() {
    // Each one after the one before it.
    let order = [
      "5.16.0", "5.16.1", "6.0.0-alpha", "6.0.0-alpha.1", "6.0.0-alpha.beta", "6.0.0-preview.1", "6.0.0-preview.2",
      "6.0.0-preview.10", "6.0.0-rc.1", "6.0.0", "6.0.1",
    ];
    for pair in order.windows(2) {
      assert_eq!(compare_versions(pair[1], pair[0]), Some(Ordering::Greater), "{} after {}", pair[1], pair[0]);
      assert_eq!(compare_versions(pair[0], pair[1]), Some(Ordering::Less), "{} before {}", pair[0], pair[1]);
    }
    assert_eq!(compare_versions("v6.0.0-preview.2", "6.0.0-preview.2"), Some(Ordering::Equal));
    // Build metadata does not count.
    assert_eq!(compare_versions("6.0.0-preview.2+abc", "6.0.0-preview.2"), Some(Ordering::Equal));
    assert_eq!(compare_versions("6.0.0", "latest"), None);
  }

  #[test]
  fn nightly_names_order_by_their_time() {
    // .github/workflows/nightly.yml: <version>-preview.<yyyymmddhhmm>.g<commit>.
    let older = "6.0.0-preview.202611051912.g757f0c8";
    let newer = "6.0.0-preview.202611061124.g58e5a57";
    assert!(is_newer(newer, older, true));
    assert!(!is_newer(older, newer, true));
    // After every hand-made preview, before the release itself.
    assert!(is_newer(older, "6.0.0-preview.1", true));
    assert!(is_newer("6.0.0", newer, true));
    assert!(!is_newer(newer, "6.0.0", true));
  }

  #[test]
  fn is_newer_on_the_preview_channel_previews_in_order_then_their_release() {
    assert!(is_newer("6.0.0-preview.1", "5.16.1", true));
    assert!(is_newer("6.0.0-preview.2", "6.0.0-preview.1", true));
    assert!(is_newer("6.0.0-preview.10", "6.0.0-preview.9", true));
    assert!(is_newer("6.0.0", "6.0.0-preview.10", true));
    assert!(!is_newer("6.0.0-preview.1", "6.0.0-preview.1", true));
    assert!(!is_newer("6.0.0-preview.1", "6.0.0-preview.2", true));
    assert!(!is_newer("6.0.0-preview.3", "6.0.0", true));
    // A 5.x fix released after the first preview is older than it.
    assert!(!is_newer("5.16.2", "6.0.0-preview.1", true));
  }

  #[test]
  fn is_newer_on_the_stable_channel_from_a_preview_only_a_higher_release() {
    assert!(!is_newer("5.16.3", "6.0.0-preview.2", false));
    assert!(!is_newer("6.0.0-preview.3", "6.0.0-preview.2", false));
    assert!(is_newer("6.0.0", "6.0.0-preview.2", false));
    assert!(is_newer("6.0.1", "6.0.0-preview.2", false));
  }

  #[test]
  fn is_newer_a_dev_build_of_a_preview_comes_after_that_preview() {
    // CI stamps "<package.json version>-dev.<run>" on a pre-release too.
    assert!(!is_newer("6.0.0-preview.2", "6.0.0-preview.2-dev.7", true));
    assert!(is_newer("6.0.0-preview.3", "6.0.0-preview.2-dev.7", true));
    assert!(is_newer("6.0.0", "6.0.0-preview.2-dev.7", false));
    assert!(is_newer("6.0.0-preview.1", "5.16.1-dev.3", true));
    assert!(is_dev_build("5.16.1-dev.3"));
    assert!(is_dev_build("6.0.0-preview.2-dev.7"));
    assert!(!is_dev_build("6.0.0-preview.2"));
    assert!(!is_dev_build("6.0.0-development"));
    assert!(!is_dev_build("5.16.1"));
    assert!(is_dev_build("4.0.0-DEV.3"), "case does not matter, as with the /i of update-logic.cjs");
    assert!(is_dev_build("4.0.0-dev"));
  }

  #[test]
  fn is_newer_pre_releases_and_garbage_are_never_offered() {
    assert!(!is_newer("4.2.0-beta.1", "4.0.0", false));
    assert!(!is_newer("latest", "4.0.0", false));
    assert!(!is_newer("", "4.0.0", false));
    assert!(!is_newer("4.1", "4.0.0", false));
    assert!(!is_newer("4.1.0", "nonsense", false));
    assert!(!is_newer("4.1.0.1", "4.0.0", false));
    assert!(!is_newer("1234567890.0.0", "4.0.0", false), "ten digits are not a version number");
  }

  #[test]
  fn parse_release_keeps_what_the_updater_needs() {
    let r = parse(release(json!({}))).unwrap();
    assert_eq!(r.version, "4.1.0");
    assert_eq!(r.url, format!("{RELEASES_PAGE}/tag/4.1.0"));
    assert_eq!(r.published_at.as_deref(), Some("2026-10-10T12:00:00.000Z"));
    assert_eq!(r.assets.len(), 2);
    assert_eq!(
      r.assets[0],
      Asset {
        name: "Sooskasse-FinTS-4.1.0-Setup.exe".into(),
        url: format!("{DOWNLOAD_PREFIX}4.1.0/Sooskasse-FinTS-4.1.0-Setup.exe"),
        size: 104_919_142,
        sha256: Some("ab".repeat(32)),
      }
    );
    assert_eq!(parse(release(json!({ "tag_name": "v4.1.0" }))).unwrap().version, "4.1.0");
  }

  #[test]
  fn parse_release_refuses_drafts_pre_releases_and_non_versions() {
    assert!(parse(release(json!({ "draft": true }))).is_none());
    assert!(parse(release(json!({ "prerelease": true }))).is_none());
    assert!(parse(release(json!({ "tag_name": "4.1.0-rc.1" }))).is_none());
    assert!(parse(release(json!({ "tag_name": "nightly" }))).is_none());
    assert!(parse(Value::Null).is_none());
    assert!(parse(json!("{\"tag_name\":\"4.1.0\"}")).is_none());
  }

  #[test]
  fn parse_release_with_prerelease_a_preview_keeps_its_whole_version_a_draft_is_still_refused() {
    let r = parse_pre(release(json!({ "tag_name": "v6.0.0-preview.2", "prerelease": true }))).unwrap();
    assert_eq!(r.version, "6.0.0-preview.2");
    // GitHub's flag alone, and the tag alone, are both pre-releases.
    assert_eq!(parse_pre(release(json!({ "tag_name": "6.0.0", "prerelease": true }))).unwrap().version, "6.0.0");
    assert_eq!(parse_pre(release(json!({ "tag_name": "6.0.0-preview.1" }))).unwrap().version, "6.0.0-preview.1");
    assert!(parse_pre(release(json!({ "tag_name": "6.0.0-preview.1", "draft": true }))).is_none());
    assert!(parse_pre(release(json!({ "tag_name": "preview" }))).is_none());
  }

  #[test]
  fn is_switch_back_a_stable_release_older_than_the_installed_preview_nothing_else() {
    assert!(is_switch_back("5.16.1", "6.0.0-preview.202611031200.ge9d8b1b"));
    assert!(is_switch_back("5.16.1", "6.0.0-preview.1"));
    assert!(!is_switch_back("6.0.0", "6.0.0-preview.1"), "newer: is_newer offers it");
    assert!(!is_switch_back("5.16.0", "5.16.1"), "a stable install is not going back");
    assert!(!is_switch_back("6.0.0-preview.1", "6.0.0-preview.2"), "never a pre-release");
    assert!(!is_switch_back("5.16.1", "6.0.0-preview.1-dev.4"), "never a CI build");
    assert!(!is_switch_back("nonsense", "6.0.0-preview.1"));
  }

  #[test]
  fn newest_release_with_a_kind_a_release_without_that_installs_file_is_passed_over() {
    let exe = |v: &str| asset(&format!("Girovo-{v}-Setup.exe"));
    let apk = |v: &str| asset(&format!("Girovo-{v}-android.apk"));
    let list = json!([
      release(json!({ "tag_name": "6.0.0-preview.202611040217.g5a9a41f", "prerelease": true, "assets": [apk("6.0.0-preview.202611040217.g5a9a41f")] })),
      release(json!({ "tag_name": "6.0.0-preview.1", "prerelease": true, "assets": [exe("6.0.0-preview.1"), apk("6.0.0-preview.1")] })),
    ]);
    let o = Origin::default();
    // Only preview.1 has a Setup.exe: the installed app takes that one.
    assert_eq!(newest_release(&list, "5.16.1", &o, Some(InstallKind::Nsis)).unwrap().version, "6.0.0-preview.1");
    assert!(newest_release(&list, "6.0.0-preview.1", &o, Some(InstallKind::Nsis)).is_none());
    // A kind without files of its own (a manual install, a dev build) filters nothing.
    assert_eq!(
      newest_release(&list, "5.16.1", &o, Some(InstallKind::Manual)).unwrap().version,
      "6.0.0-preview.202611040217.g5a9a41f"
    );
  }

  #[test]
  fn newest_release_the_highest_version_above_the_installed_one_pre_releases_included() {
    let list = vec![
      release(json!({ "tag_name": "6.0.0-preview.3", "draft": true })),
      release(json!({ "tag_name": "6.0.0-preview.1", "prerelease": true })),
      release(json!({ "tag_name": "5.16.2" })),
      release(json!({ "tag_name": "6.0.0-preview.2", "prerelease": true })),
      release(json!({ "tag_name": "nightly", "prerelease": true })),
      release(json!({ "tag_name": "5.16.1" })),
    ];
    let all = Value::Array(list.clone());
    assert_eq!(newest(&all, "5.16.1").as_deref(), Some("6.0.0-preview.2"), "drafts never, garbage skipped");
    assert_eq!(newest(&all, "6.0.0-preview.1").as_deref(), Some("6.0.0-preview.2"));
    assert_eq!(newest(&all, "6.0.0-preview.2"), None);
    // The release itself wins over every preview of it.
    let mut with_release = list.clone();
    with_release.push(release(json!({ "tag_name": "6.0.0" })));
    assert_eq!(newest(&Value::Array(with_release), "6.0.0-preview.2").as_deref(), Some("6.0.0"));
    // Without any preview newer, the newest stable release.
    assert_eq!(newest(&Value::Array(list[2..3].to_vec()), "5.16.1").as_deref(), Some("5.16.2"));
    assert_eq!(newest(&json!({ "tag_name": "6.0.0" }), "5.16.1"), None);
    assert_eq!(newest(&Value::Null, "5.16.1"), None);
  }

  #[test]
  fn the_preview_channel_reads_the_list_beside_the_latest_release() {
    assert_eq!(list_url(FEED_URL).unwrap(), "https://api.github.com/repos/elNino0916/Girovo/releases?per_page=100");
    assert_eq!(list_url("http://127.0.0.1:5000/latest").unwrap(), "http://127.0.0.1:5000?per_page=100");
    assert_eq!(list_url("http://127.0.0.1:5000/feed.json"), None);
    assert_eq!(channel_of(Some("preview")), Channel::Preview);
    assert_eq!(channel_of(Some("stable")), Channel::Stable);
    assert_eq!(channel_of(None), Channel::Stable);
    assert_eq!(channel_of(Some("beta")), Channel::Stable);
  }

  #[test]
  fn parse_release_drops_files_it_could_not_check_or_place_safely() {
    let r = parse(release(json!({
      "assets": [
        asset_with("Sooskasse-FinTS-4.1.0-Setup.exe", json!({ "browser_download_url": "https://example.com/Setup.exe" })),
        asset("..\\..\\evil-Setup.exe"),
        asset("sub/dir-Setup.exe"),
        asset_with("Sooskasse-FinTS-4.1.0-Setup.exe", json!({ "size": 0 })),
        asset_with("Sooskasse-FinTS-4.1.0-Setup.exe", json!({ "size": 5u64 * 1024 * 1024 * 1024 })),
        asset_with("Sooskasse-FinTS-4.1.0-portable.exe", json!({ "digest": null })),
      ],
    })))
    .unwrap();
    assert_eq!(r.assets.len(), 1);
    // Kept, but without a digest: offered as a download page only.
    assert_eq!(r.assets[0].name, "Sooskasse-FinTS-4.1.0-portable.exe");
    assert_eq!(r.assets[0].sha256, None);
  }

  #[test]
  fn tauris_own_installer_name_would_be_found_too() {
    // Tauri names it Girovo_6.0.0_x64-setup.exe, which 5.x's SAFE_FILE_NAME and
    // /-Setup\.exe$/i accept as well; CI still renames it to
    // Girovo-<version>-Setup.exe, the name every release so far had
    // (docs/tauri-updater.md). Only one Setup.exe per release: the first one is taken.
    let r = parse(release(json!({ "assets": [asset("Girovo_6.0.0_x64-setup.exe")] }))).unwrap();
    assert_eq!(pick_asset(&r, InstallKind::Nsis).unwrap().name, "Girovo_6.0.0_x64-setup.exe");
  }

  #[test]
  fn parse_release_a_foreign_release_page_link_falls_back_to_the_releases_list() {
    assert_eq!(parse(release(json!({ "html_url": "https://evil.example/tag/4.1.0" }))).unwrap().url, RELEASES_PAGE);
  }

  #[test]
  fn the_feed_is_the_girovo_repository() {
    assert_eq!(FEED_URL, "https://api.github.com/repos/elNino0916/Girovo/releases/latest");
    assert_eq!(RELEASES_PAGE, "https://github.com/elNino0916/Girovo/releases");
  }

  #[test]
  fn parse_release_files_and_pages_of_the_old_sooskasse_fints_repository_still_count() {
    // The repository under the old name carries the update to Girovo for 4.x installs.
    let legacy = "https://github.com/elNino0916/Sooskasse-FinTS/releases";
    let r = parse(release(json!({
      "html_url": format!("{legacy}/tag/5.0.0"),
      "assets": [
        asset_with("Girovo-5.0.0-Setup.exe", json!({ "browser_download_url": format!("{legacy}/download/5.0.0/Girovo-5.0.0-Setup.exe") })),
        asset("Girovo-5.0.0-portable.exe"),
        // A look-alike repository is not the project.
        asset_with("Girovo-5.0.0-Setup.exe", json!({
          "browser_download_url": "https://github.com/elNino0916/Sooskasse-FinTS-fork/releases/download/5.0.0/Girovo-5.0.0-Setup.exe",
        })),
        asset_with("Girovo-5.0.0-Setup.exe", json!({
          "browser_download_url": "https://github.com/elNino0916/Girovo-fork/releases/download/5.0.0/Girovo-5.0.0-Setup.exe",
        })),
      ],
    })))
    .unwrap();
    assert_eq!(r.url, format!("{legacy}/tag/5.0.0"));
    assert_eq!(
      r.assets.iter().map(|a| a.url.as_str()).collect::<Vec<_>>(),
      [format!("{legacy}/download/5.0.0/Girovo-5.0.0-Setup.exe"), format!("{DOWNLOAD_PREFIX}4.1.0/Girovo-5.0.0-portable.exe")]
    );
    assert_eq!(pick_asset(&r, InstallKind::Nsis).unwrap().name, "Girovo-5.0.0-Setup.exe");
  }

  #[test]
  fn release_page_or_either_repository_name_nothing_else() {
    let tag = format!("{RELEASES_PAGE}/tag/5.0.0");
    assert_eq!(release_page_or(Some(&tag), RELEASES_PAGE), tag);
    let legacy = "https://github.com/elNino0916/Sooskasse-FinTS/releases/tag/5.0.0";
    assert_eq!(release_page_or(Some(legacy), RELEASES_PAGE), legacy);
    assert_eq!(release_page_or(Some("https://github.com/elNino0916/Girovo-fork/releases/tag/5.0.0"), RELEASES_PAGE), RELEASES_PAGE);
    assert_eq!(
      release_page_or(Some("https://github.com/elNino0916/Sooskasse-FinTS-fork/releases/tag/5.0.0"), RELEASES_PAGE),
      RELEASES_PAGE
    );
    assert_eq!(release_page_or(None, RELEASES_PAGE), RELEASES_PAGE);
    // A test feed's own page stands alone.
    assert_eq!(release_page_or(Some(legacy), "http://127.0.0.1:1/releases"), "http://127.0.0.1:1/releases");
  }

  #[test]
  fn parse_release_caps_the_release_notes() {
    let r = parse(release(json!({ "body": "x".repeat(50_000) }))).unwrap();
    assert_eq!(r.notes.chars().count(), MAX_NOTES_CHARS);
  }

  #[test]
  fn pick_asset_finds_the_file_for_each_kind_of_install() {
    let r = parse(release(json!({}))).unwrap();
    assert_eq!(pick_asset(&r, InstallKind::Nsis).unwrap().name, "Sooskasse-FinTS-4.1.0-Setup.exe");
    assert_eq!(pick_asset(&r, InstallKind::Manual), None);
    assert_eq!(pick_asset(&r, InstallKind::Dev), None);
    let android = parse(release(json!({
      "assets": [asset("Girovo-5.3.0-android.apk"), asset("Girovo-5.3.0-Setup.exe"), asset("Girovo-5.3.0-android.apk.sha256")],
    })))
    .unwrap();
    assert_eq!(pick_asset(&android, InstallKind::Nsis).unwrap().name, "Girovo-5.3.0-Setup.exe");
  }

  #[test]
  fn install_kind_tells_the_installed_build_from_the_rest() {
    let exe = Path::new(r"C:\Users\max\AppData\Local\Girovo\Girovo.exe");
    let uninstaller = exe.parent().unwrap().join("uninstall.exe");
    assert_eq!(install_kind(true, true, exe, |f| f == uninstaller), InstallKind::Nsis);
    assert_eq!(install_kind(true, true, exe, |_| false), InstallKind::Manual);
    assert_eq!(install_kind(false, true, exe, |f| f == uninstaller), InstallKind::Dev);
    // The Linux packages do not update themselves: the AppImage and the .deb's install.
    let app_image = Path::new("/tmp/.mount_GirovoX1y2Z3/girovo");
    assert_eq!(install_kind(true, false, app_image, |_| true), InstallKind::Manual);
    assert_eq!(install_kind(true, false, Path::new("/usr/bin/girovo"), |_| true), InstallKind::Manual);
  }

  #[test]
  fn install_args_silent_and_restarting_for_either_installer_nothing_for_the_rest() {
    assert_eq!(install_args(InstallKind::Nsis).unwrap(), ["/S", "/UPDATE", "/R", "/ARGS", "--updated", "--force-run"]);
    assert_eq!(install_args(InstallKind::Manual), None);
    assert_eq!(install_args(InstallKind::Dev), None);
  }

  #[test]
  fn pick_blockmap_finds_the_blockmap_beside_the_installer_and_only_that() {
    let r = parse(release(json!({
      "assets": [
        asset("Sooskasse-FinTS-4.1.0-Setup.exe"),
        asset("Sooskasse-FinTS-4.1.0-portable.exe"),
        asset_with("Sooskasse-FinTS-4.1.0-Setup.exe.blockmap", json!({ "size": 122_110 })),
      ],
    })))
    .unwrap();
    let setup = pick_asset(&r, InstallKind::Nsis).unwrap();
    assert_eq!(setup.name, "Sooskasse-FinTS-4.1.0-Setup.exe", "the blockmap is not mistaken for the installer");
    assert_eq!(pick_blockmap(&r, setup).unwrap().name, "Sooskasse-FinTS-4.1.0-Setup.exe.blockmap");
    assert_eq!(pick_blockmap(&r, &r.assets[1]), None);
  }

  fn blockmap(checksums: Value, sizes: Value) -> Value {
    json!({ "version": "2", "files": [{ "name": "file", "offset": 0, "checksums": checksums, "sizes": sizes }] })
  }

  fn chunk(checksum: &str, size: u64, offset: u64) -> Chunk {
    Chunk { checksum: checksum.into(), size, offset, src: 0 }
  }

  #[test]
  fn parse_blockmap_chunks_in_file_order_adding_up_to_the_installer() {
    assert_eq!(
      parse_blockmap(&blockmap(json!(["a", "b", "c"]), json!([10, 20, 5])), 35).unwrap(),
      [chunk("a", 10, 0), chunk("b", 20, 10), chunk("c", 5, 30)]
    );
  }

  #[test]
  fn parse_blockmap_refuses_anything_that_does_not_describe_the_file() {
    assert_eq!(parse_blockmap(&blockmap(json!(["a", "b"]), json!([10, 20])), 31), None, "wrong total");
    assert_eq!(parse_blockmap(&blockmap(json!(["a"]), json!([10, 20])), 30), None, "lists of different length");
    assert_eq!(parse_blockmap(&blockmap(json!(["a", "b"]), json!([10, -20])), 0), None);
    assert_eq!(parse_blockmap(&blockmap(json!(["a", 7]), json!([10, 20])), 30), None);
    assert_eq!(parse_blockmap(&blockmap(json!([]), json!([])), 0), None);
    let mut moved = blockmap(json!(["a"]), json!([10]));
    moved["files"][0]["offset"] = json!(4);
    assert_eq!(parse_blockmap(&moved, 14), None);
    let mut v1 = blockmap(json!(["a"]), json!([10]));
    v1["version"] = json!("1");
    assert_eq!(parse_blockmap(&v1, 10), None);
    assert_eq!(parse_blockmap(&json!({ "version": "2", "files": [] }), 10), None);
    assert_eq!(parse_blockmap(&Value::Null, 10), None);
  }

  /// Chunks as a blockmap lists them, from (checksum, size) pairs.
  fn chunks(list: &[(&str, u64)]) -> Vec<Chunk> {
    let mut offset = 0;
    list
      .iter()
      .map(|&(checksum, size)| {
        let c = chunk(checksum, size, offset);
        offset += size;
        c
      })
      .collect()
  }

  fn copy(from: u64, to: u64, size: u64) -> CopyRange {
    CopyRange { src: 0, from, to, size }
  }

  #[test]
  fn plan_differential_unchanged_chunks_are_copied_changed_ones_fetched() {
    let old = chunks(&[("a", 100), ("b", 100), ("c", 100), ("d", 100)]);
    let next = chunks(&[("a", 100), ("X", 50), ("c", 100), ("d", 100), ("Y", 30)]);
    let plan = plan_differential(&old, &next, 0);
    assert_eq!(plan.copies, [copy(0, 0, 100), copy(200, 150, 200)]);
    assert_eq!(plan.fetches, [FetchRange { start: 100, size: 50 }, FetchRange { start: 350, size: 30 }]);
    assert_eq!(plan.fetch_bytes, 80);
  }

  #[test]
  fn plan_differential_a_chunk_that_moved_is_copied_from_where_it_was() {
    let old = chunks(&[("a", 10), ("b", 20)]);
    let plan = plan_differential(&old, &chunks(&[("b", 20), ("a", 10)]), 64 * 1024);
    assert_eq!(plan.copies, [copy(10, 0, 20), copy(0, 20, 10)]);
    assert_eq!(plan.fetches, []);
  }

  #[test]
  fn plan_differential_same_checksum_but_another_size_is_not_the_same_chunk() {
    let plan = plan_differential(&chunks(&[("a", 10)]), &chunks(&[("a", 11)]), 64 * 1024);
    assert_eq!(plan.copies, []);
    assert_eq!(plan.fetches, [FetchRange { start: 0, size: 11 }]);
  }

  #[test]
  fn plan_differential_neighbours_from_different_files_stay_two_copies() {
    // Chunks of two local files that happen to sit at touching offsets are not one range.
    let old = vec![Chunk { src: 0, ..chunk("a", 10, 0) }, Chunk { src: 1, ..chunk("b", 10, 10) }];
    let plan = plan_differential(&old, &chunks(&[("a", 10), ("b", 10)]), 0);
    assert_eq!(plan.copies, [copy(0, 0, 10), CopyRange { src: 1, from: 10, to: 10, size: 10 }]);
  }

  #[test]
  fn passing_failure_only_502_503_and_504_are_asked_once_more() {
    for status in [502, 503, 504] {
      assert!(passing_failure(status), "{status}");
    }
    for status in [200, 304, 403, 404, 429, 500] {
      assert!(!passing_failure(status), "{status}");
    }
  }

  #[test]
  fn plan_differential_a_short_copy_between_two_fetches_is_fetched_along() {
    let old = chunks(&[("a", 100), ("b", 1000)]);
    let next = chunks(&[("X", 10), ("a", 100), ("Y", 10), ("b", 1000), ("Z", 10)]);
    let plan = plan_differential(&old, &next, 100);
    // 'a' (100 bytes) sits between two fetches: one request for X+a+Y.
    // 'b' (1000 bytes) is past the gap: copied.
    assert_eq!(plan.fetches, [FetchRange { start: 0, size: 120 }, FetchRange { start: 1120, size: 10 }]);
    assert_eq!(plan.copies, [copy(100, 120, 1000)]);
    assert_eq!(plan.fetch_bytes, 130);
    // Every byte of the new file is covered exactly once.
    let mut covered: Vec<(u64, u64)> =
      plan.copies.iter().map(|c| (c.to, c.size)).chain(plan.fetches.iter().map(|f| (f.start, f.size))).collect();
    covered.sort();
    let mut at = 0;
    for (start, size) in covered {
      assert_eq!(start, at);
      at += size;
    }
    assert_eq!(at, 1130);
  }

  #[test]
  fn iso_instant_writes_what_to_iso_string_wrote() {
    assert_eq!(iso_instant("2026-10-10T12:00:00Z").unwrap(), "2026-10-10T12:00:00.000Z");
    assert_eq!(iso_instant("2026-11-06T11:28:03.5Z").unwrap(), "2026-11-06T11:28:03.500Z");
    assert_eq!(iso_instant("2026-03-01T00:30:00+01:00").unwrap(), "2026-02-28T23:30:00.000Z");
    assert_eq!(iso_instant("2024-02-29T23:59:59-00:30").unwrap(), "2024-03-01T00:29:59.000Z");
    assert_eq!(iso_instant("yesterday"), None);
    assert_eq!(iso_instant("2026-13-01T00:00:00Z"), None);
  }
}
