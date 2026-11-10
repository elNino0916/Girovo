// In-app updates for the installed Windows app, from this project's GitHub
// releases — the Electron shell's updater.cjs, ported. The page drives it through
// window.electronUpdater (src/bridge.js → mod.rs), the start window through
// update_at_start (start.rs).
//
// Deliberately not Tauri's updater plugin: that wants a latest.json and a
// minisign key beside every release, while the releases already carry
// everything required — the Setup.exe — and GitHub computes a SHA-256 digest
// for every uploaded file and lists it in the release's API answer. A
// download is checked against that digest before it is kept, and once more
// right before it runs.
//
// What it does, in order, and only ever that:
//   check     one GET to api.github.com for the latest release — no account,
//             no identifier; the request says nothing but the app's version
//             (the User-Agent). Automatically 15 s after start and every 6
//             hours, unless the user switched that off. On the preview
//             channel (Einstellungen → Update-Kanal) the list of releases
//             instead, pre-releases included.
//   download  only when the user asks for it (a banking app is not replaced
//             behind anyone's back), with progress, cancellable. Usually only
//             the part of the Setup.exe that is not on disk already: see
//             "differential" below. The whole file otherwise.
//   install   only when the user asks for it: the app quits, and once it has,
//             the Setup.exe runs silently over the existing install and starts
//             the app again (mod.rs, at_exit).
//
// Everything that belongs to Tauri (the preferences, the window, quitting)
// comes in through the Host trait, so the tests (tests.rs) drive the whole
// flow against a local server.

use std::collections::VecDeque;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::async_runtime::{self, JoinHandle};
use tokio::sync::{OwnedMutexGuard, watch};

use super::bundle::{self, Bundle, Damaged};
use super::chunks;
use super::logic::{self, Asset, Channel, InstallKind, Origin, Plan, Release};
use super::texts::{Texts, texts};
use super::trust;
use crate::texts::Lang;

pub const PREF_AUTO: &str = "fints.updates.auto";
// 'stable' (unset) or 'preview': whether pre-releases are offered too.
pub const PREF_CHANNEL: &str = "fints.updates.channel";
/// The release that took this copy from the Nightly channel back to Stabil
/// (logic::moves_to_stable), or the version the user picked a channel in
/// (set_channel): set, the move does not happen (again).
pub const PREF_MOVED_TO_STABLE: &str = "fints.updates.movedToStable";
/// The one version the start never installs by itself (start.rs), until an
/// install has arrived (read_marker): the one whose install did not complete,
/// or the one that would come straight back after the user installed an older
/// release from a file (install_file, logic::comes_back). Every 6.x reads it
/// this way, so an older version stepped back to honours it too.
pub const PREF_FAILED_INSTALL: &str = "fints.updates.failedInstall";
/// "on": "Neueste Updates erhalten, sobald sie verfügbar sind" — a staged
/// release reaches this copy at once (trust::reaches).
pub const PREF_EARLY: &str = "fints.updates.early";
/// A random id of this installation, only for its rollout bucket (trust::bucket); not telemetry's.
pub const PREF_INSTALL_ID: &str = "fints.updates.installId";
/// A start asked for by "Jetzt neu starten und installieren" (restart_to_update).
pub const UPDATE_ARG: &str = "--update";

const FIRST_CHECK_DELAY: Duration = Duration::from_secs(15);
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
// Turning the automatic check on runs one soon, so the switch visibly does something.
const AUTO_ON_DELAY: Duration = Duration::from_millis(1500);
const CHECK_TIMEOUT: Duration = Duration::from_secs(20);
/// girovo.de's listing holds at most two manifests with their notes.
const MAX_LISTING_BYTES: usize = 1024 * 1024;
const PROGRESS_EVERY: Duration = Duration::from_millis(200);
// A connection can go quiet without ever failing; a download that has not
// moved for a minute is given up rather than left spinning.
const STALL: Duration = Duration::from_secs(60);
const MAX_FEED_BYTES: usize = 2 * 1024 * 1024;
// A blockmap of a ~300 MB installer is ~200 KB gzipped (its checksums do not shrink).
const MAX_BLOCKMAP_BYTES: usize = 4 * 1024 * 1024;
const MAX_BLOCKMAP_JSON_BYTES: u64 = 32 * 1024 * 1024;
// Any reuse is worth it — even a release that changes Girovo.exe throughout
// leaves the model as it was. Only a blockmap scattered into hundreds of
// ranges is not: one plain download is quicker than that many requests.
const DIFF_MAX_REQUESTS: usize = 400;
const MERGE_GAP: u64 = 64 * 1024;
const COPY_CHUNK_BYTES: usize = 1024 * 1024;
// Written right before an install starts, read by the version that comes up
// next: either it is the new one ("Aktualisiert auf …") or the update did not
// happen, which is worth saying. The Electron shell writes the same file in
// the same folder, so the first Tauri start after an update from 5.x greets too.
const MARKER: &str = "installing.json";
const MARKER_MAX_AGE_MS: f64 = 24.0 * 60.0 * 60.0 * 1000.0;

// ---- the state the page sees ----------------------------------------------------

/// idle · checking · current · available · downloading · ready · installing
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
  Idle,
  Checking,
  Current,
  Available,
  Downloading,
  Ready,
  Installing,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum During {
  Check,
  Download,
  Install,
}

/// The last thing that went wrong, for the user.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ErrorInfo {
  pub during: During,
  pub message: String,
}

/// The newer release, as the page shows it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicRelease {
  /// An older stable release, offered as the way back from a preview (logic::is_switch_back).
  pub back: bool,
  pub version: String,
  pub name: String,
  pub notes: String,
  pub url: String,
  pub published_at: Option<String>,
  /// What the download costs: only the part not on disk when there is a plan; None when no file fits.
  pub size: Option<u64>,
  pub can_install: bool,
  /// The start will not install this one by itself (PREF_FAILED_INSTALL): its
  /// install failed before, or the user went back to an older version from
  /// it. It stays a click, so the page must not promise "at the next start".
  pub waits_for_user: bool,
}

/// Why a picked file is not installed (find_signed).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Refusal {
  /// No signed release names it: an unsigned file, or a release from before signatures.
  NoSignature,
  /// Its release's manifest is there, but not signed with Girovo's key.
  BadSignature,
  /// Its release is signed, but this file is not that release's installer: it was changed.
  Changed,
  /// Where its signature would be could not be asked: nothing is known about the file.
  CannotCheck,
}

/// What asking for a small file of a release came to.
enum Lookup {
  Found(Vec<u8>),
  /// The server answered: there is no such file.
  Absent,
  /// No answer to go by: the network, a server error, a file far too long.
  Failed,
}

/// Where a file the user picked to install stands ("Update aus Datei installieren").
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FilePhase {
  Checking,
  Ready,
  Refused,
}

/// A file the user picked to install, as the page shows it (step 5, docs/updater-v2.md).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileOffer {
  pub phase: FilePhase,
  /// The file's name, as the user knows it.
  pub name: String,
  /// The signed release it is the installer of.
  pub version: Option<String>,
  /// Older than the installed version: what a newer one saved may not open in it.
  pub older: bool,
  /// The installed version itself: installed once more.
  pub same: bool,
  /// Why it is refused.
  pub message: Option<String>,
}

/// Where saving an update as a .girovoupdate stands (save_bundle).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SavePhase {
  Working,
  Done,
  Failed,
}

/// An update being saved as a file ("Als Datei speichern"), as the page shows it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleSave {
  pub phase: SavePhase,
  /// The file's name.
  pub name: String,
  /// Why it failed.
  pub message: Option<String>,
}

/// Set when this start is the result of an update.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
  pub version: String,
  pub from: String,
  pub notes: String,
  pub url: String,
}

/// The state the page reads (types/electron-window.d.ts ElectronUpdateState), the Electron updater's shape.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
  pub current: String,
  pub kind: InstallKind,
  pub auto: bool,
  /// Staged releases at once (PREF_EARLY).
  pub early: bool,
  pub channel: Channel,
  pub phase: Phase,
  /// When GitHub last answered, ms since the epoch.
  pub checked_at: Option<u64>,
  pub release: Option<PublicRelease>,
  pub received: u64,
  pub total: u64,
  pub error: Option<ErrorInfo>,
  pub installed: Option<Installed>,
  /// The version an install was started for that did not come up — said once, at the next start.
  pub failed_install: Option<String>,
  /// A file the user picked to install (check_file).
  pub file: Option<FileOffer>,
  /// The update being saved as a file (save_bundle).
  pub saving: Option<BundleSave>,
}

// ---- what the app provides ---------------------------------------------------------

/// What runs once the app has quit (mod.rs, at RunEvent::Exit).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AtExit {
  /// Start this installer, then the install window.
  Install(InstallPlan),
  /// Start this app again with these arguments.
  Relaunch(Vec<String>),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InstallPlan {
  pub file: PathBuf,
  pub args: Vec<String>,
  pub version: String,
  /// The installer's SHA-256 as the signed manifest (or GitHub) gave it: what
  /// girovo-update.exe checks it against once more (helper.rs).
  pub sha256: Option<String>,
}

/// The install about to start, for whoever must hear of it first.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InstallNotice {
  pub version: String,
  /// The way back to an older release (a preview to 5.x).
  pub back: bool,
}

pub trait Host: Send + Sync + 'static {
  fn pref(&self, key: &str) -> Option<String>;
  fn set_pref(&self, key: &str, value: &str);
  /// Pushes every state change to the page (the bridge's onState).
  fn publish(&self, state: &UpdateState);
  fn open_external(&self, url: &str);
  /// The shell's language (crate::texts::lang), for the messages.
  fn lang(&self) -> Lang;
  /// Quits the app, ending the bank session like any other quit; `then` runs once it has.
  fn quit(&self, then: AtExit);
}

pub struct Config {
  /// The running version: package.json's, as Tauri's config takes it (the nightly's stamp included).
  pub current_version: String,
  pub kind: InstallKind,
  /// Where the Setup.exe is downloaded to, and the marker kept.
  pub cache_dir: PathBuf,
  /// The installed files a differential download takes unchanged chunks from: the app's folder.
  pub install_dir: Option<PathBuf>,
  /// Whether automatic checks may run at all in this build.
  pub auto_check: bool,
  pub feed_url: String,
  /// girovo.de's signed listings, asked before GitHub (trust::MANIFEST_BASE); None: GitHub only.
  pub manifest_base: Option<String>,
  /// The keys a manifest must be signed with.
  pub keys: trust::Keys,
  /// Only a release with a signed manifest is offered — from girovo.de or, when it
  /// can't be asked, from the release on GitHub. Always in a shipped app; the
  /// tests' stand-in for GitHub has no signed releases.
  pub require_signed: bool,
  pub origin: Origin,
  /// GitHub is https only; a test server is not.
  pub https_only: bool,
  pub retry_delay: Duration,
  /// How long a download may say nothing — before its answer begins, and
  /// between two pieces of it — until it is given up (STALL; the tests' is short).
  pub stall: Duration,
  /// "Jetzt neu starten und installieren" started this one (UPDATE_ARG).
  pub update_asked: bool,
}

impl Config {
  pub fn new(current_version: String, kind: InstallKind, cache_dir: PathBuf) -> Self {
    Config {
      current_version,
      kind,
      cache_dir,
      install_dir: None,
      auto_check: kind != InstallKind::Dev,
      feed_url: logic::FEED_URL.to_string(),
      manifest_base: Some(trust::MANIFEST_BASE.to_string()),
      keys: trust::Keys::builtin(),
      require_signed: true,
      origin: Origin::default(),
      https_only: true,
      retry_delay: logic::RETRY_DELAY,
      stall: STALL,
      update_asked: false,
    }
  }
}

// ---- failures ---------------------------------------------------------------------

/// Why something did not work, until describe() says it to the user.
#[derive(Debug)]
enum Failure {
  /// Already fit for the user, in the language speaking when it happened.
  Said(String),
  Io(io::Error),
  Http(reqwest::Error),
  /// Nothing arrived for STALL.
  Stalled,
  /// Cancelled — by the user, or by a switch of the channel.
  Aborted,
  /// Only for the log; the user hears the general message.
  Other(String),
}

impl std::fmt::Display for Failure {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      Failure::Said(m) | Failure::Other(m) => f.write_str(m),
      Failure::Io(e) => write!(f, "{e}"),
      Failure::Http(e) => write!(f, "{e}"),
      Failure::Stalled => f.write_str("stalled"),
      Failure::Aborted => f.write_str("aborted"),
    }
  }
}

impl From<io::Error> for Failure {
  fn from(e: io::Error) -> Self {
    Failure::Io(e)
  }
}

fn warn(what: &str, err: &dyn std::fmt::Display) {
  eprintln!("[updater] {what}: {err}");
}

/// A cancel switch that can be awaited.
#[derive(Clone)]
struct Cancel(Arc<watch::Sender<bool>>);

impl Cancel {
  fn new() -> Self {
    Cancel(Arc::new(watch::channel(false).0))
  }
  fn cancel(&self) {
    self.0.send_replace(true);
  }
  fn is_cancelled(&self) -> bool {
    *self.0.borrow()
  }
  async fn cancelled(&self) {
    let mut rx = self.0.subscribe();
    let _ = rx.wait_for(|on| *on).await;
  }
  fn same(&self, other: &Cancel) -> bool {
    Arc::ptr_eq(&self.0, &other.0)
  }
}

/// `fut`, unless `cancel` comes first.
async fn abortable<T>(cancel: &Cancel, fut: impl Future<Output = Result<T, Failure>>) -> Result<T, Failure> {
  tokio::select! {
    r = fut => r,
    _ = cancel.cancelled() => Err(Failure::Aborted),
  }
}

fn now_ms() -> u64 {
  SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn hex(bytes: &[u8]) -> String {
  bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// ---- files ------------------------------------------------------------------------

/// SHA-256 of a file as hex, or None when it cannot be read.
fn sha256_file(file: &Path) -> Option<String> {
  let mut f = File::open(file).ok()?;
  let mut hash = Sha256::new();
  let mut buf = vec![0u8; 1024 * 1024];
  loop {
    match f.read(&mut buf) {
      Ok(0) => break,
      Ok(n) => hash.update(&buf[..n]),
      Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
      Err(_) => return None,
    }
  }
  Some(hex(&hash.finalize()))
}

/// Whether `file` is exactly the release file `asset`: its size, then its digest.
async fn file_matches(file: &Path, asset: &Asset) -> bool {
  let Some(expected) = asset.sha256.clone() else { return false };
  match fs::metadata(file) {
    Ok(m) if m.is_file() && m.len() == asset.size => {}
    _ => return false,
  }
  let file = file.to_path_buf();
  async_runtime::spawn_blocking(move || sha256_file(&file)).await.ok().flatten() == Some(expected)
}

/// A file only this user may read, where the system has such a thing.
fn create_private(path: &Path) -> io::Result<File> {
  let mut options = OpenOptions::new();
  options.write(true).create(true).truncate(true);
  #[cfg(unix)]
  std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
  options.open(path)
}

fn busy(e: &io::Error) -> bool {
  // ERROR_SHARING_VIOLATION, ERROR_LOCK_VIOLATION: a virus scanner looks at every new .exe.
  matches!(e.kind(), io::ErrorKind::PermissionDenied | io::ErrorKind::ResourceBusy) || matches!(e.raw_os_error(), Some(32 | 33))
}

/// Renames, retrying while Windows reports the file busy.
async fn rename_with_retry(from: &Path, to: &Path) -> io::Result<()> {
  let mut attempt = 0u64;
  loop {
    match fs::rename(from, to) {
      Ok(()) => return Ok(()),
      Err(e) if attempt < 8 && busy(&e) => {
        attempt += 1;
        tokio::time::sleep(Duration::from_millis(150 * attempt)).await;
      }
      Err(e) => return Err(e),
    }
  }
}

/// Writes `bytes` into `out` at `position`.
fn write_at(out: &Mutex<File>, position: u64, bytes: &[u8]) -> io::Result<()> {
  let mut f = out.lock().unwrap();
  f.seek(SeekFrom::Start(position))?;
  f.write_all(bytes)
}

/// The response body, refusing anything larger than `max` bytes.
async fn read_bytes(mut res: reqwest::Response, max: usize, unreadable: &str) -> Result<Vec<u8>, Failure> {
  let mut out = Vec::new();
  while let Some(chunk) = res.chunk().await.map_err(Failure::Http)? {
    if out.len() + chunk.len() > max {
      return Err(Failure::Said(unreadable.to_string()));
    }
    out.extend_from_slice(&chunk);
  }
  Ok(out)
}

// ---- the updater ------------------------------------------------------------------

/// The release found newer than this version, its file for this install (None:
/// not installable here), and the plan for building that file from what is on
/// disk (None: download it whole).
struct Pending {
  release: Release,
  asset: Option<Asset>,
  plan: Option<Arc<DiffPlan>>,
}

struct DiffPlan {
  plan: Plan,
  /// The local files the plan's copies come from (CopyRange::src).
  sources: Vec<PathBuf>,
}

struct Inner {
  state: UpdateState,
  pending: Option<Pending>,
  /// The verified download, once there is one.
  ready_file: Option<PathBuf>,
  abort: Option<Cancel>,
  timer: Option<JoinHandle<()>>,
  /// girovo.de's last answer, with its address and ETag: a check that changes
  /// nothing costs a 304.
  listing: Option<(String, String, Vec<u8>)>,
  /// The picked file once it checked out: the file, its signed release and the installer in it.
  chosen: Option<(PathBuf, Release, Asset)>,
  /// Counts the files picked and the dialogs closed: a check still running
  /// for an earlier round ends unheard.
  file_round: u64,
}

type BeforeInstall = Box<dyn Fn(&InstallNotice) + Send + Sync>;

pub struct Updater {
  cfg: Config,
  host: Arc<dyn Host>,
  client: reqwest::Client,
  inner: Mutex<Inner>,
  states: watch::Sender<UpdateState>,
  check_lock: tokio::sync::Mutex<()>,
  download_lock: Arc<tokio::sync::Mutex<()>>,
  before_install: Mutex<Option<BeforeInstall>>,
  me: Weak<Updater>,
}

/// A download that has begun: the state says so already; run() does the rest.
pub struct DownloadJob {
  updater: Arc<Updater>,
  asset: Asset,
  plan: Option<Arc<DiffPlan>>,
  cancel: Cancel,
  _running: OwnedMutexGuard<()>,
}

/// Reports download progress, at most every PROGRESS_EVERY.
struct Progress<'a> {
  updater: &'a Updater,
  last: Mutex<Option<Instant>>,
}

impl Progress<'_> {
  fn report(&self, received: u64) {
    let mut last = self.last.lock().unwrap();
    if last.is_none_or(|t| t.elapsed() >= PROGRESS_EVERY) {
      *last = Some(Instant::now());
      drop(last);
      self.updater.set(|s| s.received = received);
    }
  }
  fn reset(&self) {
    *self.last.lock().unwrap() = None;
  }
}

impl Updater {
  pub fn new(cfg: Config, host: Arc<dyn Host>) -> Arc<Self> {
    // A release build takes a copy on the Nightly channel back to Stabil,
    // once (logic::moves_to_stable) — before the first check asks GitHub.
    let stored = host.pref(PREF_CHANNEL);
    let moved = host.pref(PREF_MOVED_TO_STABLE);
    if logic::moves_to_stable(stored.as_deref(), &cfg.current_version, moved.as_deref()) {
      host.set_pref(PREF_CHANNEL, Channel::Stable.as_str());
      host.set_pref(PREF_MOVED_TO_STABLE, &cfg.current_version);
    } else if logic::keeps_nightly(stored.as_deref(), moved.as_deref(), trust::is_prerelease(&cfg.current_version)) {
      // A nightly on the Nightly channel: picked before set_channel noted
      // choices, noted now, so the release this copy reaches does not move it.
      host.set_pref(PREF_MOVED_TO_STABLE, &cfg.current_version);
    }
    let state = UpdateState {
      current: cfg.current_version.clone(),
      kind: cfg.kind,
      auto: host.pref(PREF_AUTO).as_deref() != Some("off"),
      early: host.pref(PREF_EARLY).as_deref() == Some("on"),
      channel: logic::channel_of(host.pref(PREF_CHANNEL).as_deref()),
      phase: Phase::Idle,
      checked_at: None,
      release: None,
      received: 0,
      total: 0,
      error: None,
      installed: None,
      failed_install: None,
      file: None,
      saving: None,
    };
    let client = reqwest::Client::builder()
      .https_only(cfg.https_only)
      .connect_timeout(Duration::from_secs(30))
      // The User-Agent names the app and its version and nothing else about this machine.
      .user_agent(format!("Girovo/{}", cfg.current_version))
      .build()
      .expect("a client without custom TLS cannot fail to build");
    Arc::new_cyclic(|me| Updater {
      states: watch::channel(state.clone()).0,
      inner: Mutex::new(Inner { state, pending: None, ready_file: None, abort: None, timer: None, listing: None, chosen: None, file_round: 0 }),
      cfg,
      host,
      client,
      check_lock: tokio::sync::Mutex::new(()),
      download_lock: Arc::new(tokio::sync::Mutex::new(())),
      before_install: Mutex::new(None),
      me: me.clone(),
    })
  }

  fn arc(&self) -> Arc<Updater> {
    self.me.upgrade().expect("the updater is alive while it runs")
  }

  pub fn state(&self) -> UpdateState {
    self.inner.lock().unwrap().state.clone()
  }

  /// Every state change, download progress included: for the start window and telemetry.
  #[allow(dead_code)] // start.rs's, until lib.rs calls it
  pub fn watch(&self) -> watch::Receiver<UpdateState> {
    self.states.subscribe()
  }

  pub fn config(&self) -> &Config {
    &self.cfg
  }

  /// Runs right before the app quits for an install: the way back to an older
  /// release takes the start with Windows away, which the older one knows nothing of.
  #[allow(dead_code)] // for the start with Windows, once it is ported
  pub fn on_before_install(&self, hook: impl Fn(&InstallNotice) + Send + Sync + 'static) {
    *self.before_install.lock().unwrap() = Some(Box::new(hook));
  }

  fn texts(&self) -> &'static Texts {
    texts(self.host.lang())
  }

  fn installable(&self) -> bool {
    self.cfg.kind == InstallKind::Nsis
  }

  fn set(&self, patch: impl FnOnce(&mut UpdateState)) -> UpdateState {
    let mut inner = self.inner.lock().unwrap();
    patch(&mut inner.state);
    let state = inner.state.clone();
    // Under the lock, so the page hears the changes in the order they happened.
    self.host.publish(&state);
    self.states.send_replace(state.clone());
    state
  }

  fn public_release(&self, release: &Release, asset: Option<&Asset>, plan: Option<&DiffPlan>, back: bool) -> PublicRelease {
    PublicRelease {
      back,
      version: release.version.clone(),
      name: release.name.clone(),
      notes: release.notes.clone(),
      url: release.url.clone(),
      published_at: release.published_at.clone(),
      size: asset.map(|a| plan.map_or(a.size, |p| p.plan.fetch_bytes)),
      can_install: self.installable() && asset.is_some(),
      waits_for_user: self.host.pref(PREF_FAILED_INSTALL).is_some_and(|v| !v.is_empty() && v == release.version),
    }
  }

  fn describe(&self, err: &Failure, during: During) -> String {
    let say = self.texts();
    let general = match during {
      During::Check => say.check_failed,
      During::Download => say.download_failed,
      During::Install => say.install_failed,
    };
    let text = match err {
      Failure::Said(message) => return message.clone(),
      Failure::Io(e) if e.kind() == io::ErrorKind::StorageFull || matches!(e.raw_os_error(), Some(39 | 112)) => say.no_space,
      Failure::Io(e) if busy(e) => {
        if during == During::Install {
          say.install_locked
        } else {
          say.folder_locked
        }
      }
      Failure::Io(e) if e.kind() == io::ErrorKind::NotFound && during == During::Install => say.file_gone,
      Failure::Http(e) if e.is_timeout() => say.timeout,
      Failure::Http(e) if e.is_connect() || e.is_request() || e.is_body() || e.is_decode() => {
        if during == During::Download {
          say.connection_lost
        } else {
          say.offline
        }
      }
      Failure::Stalled => say.connection_lost,
      _ => general,
    };
    text.to_string()
  }

  // ---- the network --------------------------------------------------------------

  /// A GET, asked once more after a breath when GitHub's answer is a passing failure (logic::passing_failure).
  async fn get_retrying(
    &self,
    url: &str,
    build: impl Fn(reqwest::RequestBuilder) -> reqwest::RequestBuilder,
    cancel: Option<&Cancel>,
  ) -> Result<reqwest::Response, Failure> {
    let res = self.send(build(self.client.get(url))).await?;
    if !logic::passing_failure(res.status().as_u16()) {
      return Ok(res);
    }
    drop(res);
    match cancel {
      Some(c) => abortable(c, async { Ok(tokio::time::sleep(self.cfg.retry_delay).await) }).await?,
      None => tokio::time::sleep(self.cfg.retry_delay).await,
    }
    self.send(build(self.client.get(url))).await
  }

  /// Sends `request` and answers once the response has begun. A server that
  /// takes the connection and then says nothing is given up after the stall
  /// limit, like a body that stops coming (save, fetch_range): a download's
  /// request has no timeout of its own, which would count the whole body.
  async fn send(&self, request: reqwest::RequestBuilder) -> Result<reqwest::Response, Failure> {
    tokio::time::timeout(self.cfg.stall, request.send()).await.map_err(|_| Failure::Stalled)?.map_err(Failure::Http)
  }

  /// GitHub's API answer at `url`, parsed, or None when there is none (HTTP 404).
  async fn fetch_json(&self, url: &str) -> Result<Option<Value>, Failure> {
    let res = self
      .get_retrying(
        url,
        |r| r.header("Accept", "application/vnd.github+json").header("X-GitHub-Api-Version", "2022-11-28").timeout(CHECK_TIMEOUT),
        None,
      )
      .await?;
    let say = self.texts();
    match res.status().as_u16() {
      // No release published at all yet, or none under that tag.
      404 => return Ok(None),
      403 | 429 => {
        // The quota is per connection, shared with every device and program there:
        // say when it comes back, where GitHub said.
        let header = |name: &str| res.headers().get(name).and_then(|v| v.to_str().ok());
        let wait = logic::rate_limit_wait(header("retry-after"), header("x-ratelimit-remaining"), header("x-ratelimit-reset"), now_ms() / 1000);
        return Err(Failure::Said(say.rate_limited_for(wait)));
      }
      s if !res.status().is_success() => return Err(Failure::Said(say.http_error(s))),
      _ => {}
    }
    let bytes = read_bytes(res, MAX_FEED_BYTES, say.unreadable).await?;
    serde_json::from_slice(&bytes).map(Some).map_err(|_| Failure::Said(say.unreadable.to_string()))
  }

  /// The release at `url`, or None when there is none. `prerelease`: one may be (see logic::parse_release).
  async fn fetch_release(&self, url: &str, prerelease: bool) -> Result<Option<Release>, Failure> {
    let Some(json) = self.fetch_json(url).await? else { return Ok(None) };
    match logic::parse_release(&json, &self.cfg.origin, prerelease) {
      Some(release) => Ok(Some(release)),
      None => Err(Failure::Said(self.texts().unreadable.to_string())),
    }
  }

  /// The release this channel offers (docs/updater-v2.md): the first one in
  /// girovo.de's listing that is signed with a key fitting the channel and
  /// reaches this copy (staged rollout). When girovo.de can't be asked, GitHub's
  /// API as before — and there too only a release whose signed manifest checks
  /// out. None when there is none to offer.
  async fn fetch_offer(&self, channel: Channel) -> Result<Option<Release>, Failure> {
    if let Some(base) = self.cfg.manifest_base.clone() {
      if let Some(listing) = self.fetch_listing(&base, channel).await {
        let early = self.state().early;
        return Ok(trust::pick_listed(&listing, channel, &self.cfg.keys, &self.cfg.origin, &self.install_id(), early));
      }
    }
    match self.fetch_github_offer(channel).await? {
      Some(release) if self.cfg.require_signed => Ok(self.signed_copy(release, channel).await),
      other => Ok(other),
    }
  }

  /// girovo.de's listing for the channel, or None when it can't be had — no
  /// connection, an error page, anything that is not a listing.
  async fn fetch_listing(&self, base: &str, channel: Channel) -> Option<Vec<trust::Listed>> {
    let url = format!("{base}{}.json", if channel == Channel::Preview { "nightly" } else { "stable" });
    let cached = self.inner.lock().unwrap().listing.clone().filter(|(u, _, _)| *u == url);
    let mut request = self.client.get(&url).timeout(CHECK_TIMEOUT);
    if let Some((_, etag, _)) = cached.as_ref() {
      request = request.header("If-None-Match", etag.as_str());
    }
    let res = match request.send().await {
      Ok(res) => res,
      Err(err) => {
        warn("girovo.de could not be asked", &err);
        return None;
      }
    };
    let body = match res.status().as_u16() {
      304 => cached.map(|(_, _, body)| body)?,
      200 => {
        let etag = res.headers().get("etag").and_then(|v| v.to_str().ok()).map(str::to_string);
        let body = read_bytes(res, MAX_LISTING_BYTES, "").await.ok()?;
        if let Some(etag) = etag {
          self.inner.lock().unwrap().listing = Some((url, etag, body.clone()));
        }
        body
      }
      status => {
        warn("girovo.de answered", &format!("HTTP {status}"));
        return None;
      }
    };
    let listing = trust::parse_listing(&body);
    if listing.is_none() {
      warn("girovo.de answered", &"something that is not a listing");
    }
    listing
  }

  /// This installation's id for the rollout bucket, made once.
  fn install_id(&self) -> String {
    if let Some(id) = self.host.pref(PREF_INSTALL_ID).filter(|id| !id.is_empty()) {
      return id;
    }
    let id = uuid::Uuid::new_v4().simple().to_string();
    self.host.set_pref(PREF_INSTALL_ID, &id);
    id
  }

  /// A small file of a release (its manifest, its signature), or None.
  async fn small_file(&self, asset: &Asset) -> Option<Vec<u8>> {
    match self.look_up(asset).await {
      Lookup::Found(bytes) => Some(bytes),
      Lookup::Absent | Lookup::Failed => None,
    }
  }

  /// The same, telling "there is none" from "could not be asked".
  async fn look_up(&self, asset: &Asset) -> Lookup {
    let Ok(res) = self.get_retrying(&asset.url, |r| r.timeout(CHECK_TIMEOUT), None).await else { return Lookup::Failed };
    if res.status() == reqwest::StatusCode::NOT_FOUND {
      return Lookup::Absent;
    }
    if !res.status().is_success() {
      return Lookup::Failed;
    }
    read_bytes(res, trust::MAX_MANIFEST_BYTES, "").await.map_or(Lookup::Failed, Lookup::Found)
  }

  /// `release` from GitHub as its signed manifest describes it, or None when
  /// it carries none, or one that does not check out.
  async fn signed_copy(&self, release: Release, channel: Channel) -> Option<Release> {
    let file = |name: &str| release.assets.iter().find(|a| a.name == name).cloned();
    let (Some(manifest), Some(sig)) = (file(trust::MANIFEST_NAME), file(trust::SIG_NAME)) else {
      warn("not offered", &format!("{} carries no signed manifest", release.version));
      return None;
    };
    let bytes = self.small_file(&manifest).await?;
    let sig = self.small_file(&sig).await?;
    let signed = trust::signer_fits(trust::verify(&bytes, &String::from_utf8_lossy(&sig), &self.cfg.keys), channel);
    let copy = trust::release_of(&bytes, &self.cfg.origin).filter(|r| signed && r.version == release.version);
    if copy.is_none() {
      warn("not offered", &format!("{}: its manifest's signature does not check out", release.version));
    }
    copy
  }

  /// GitHub's offer: the latest release, or on the preview channel the highest
  /// version above this one in the list, pre-releases included.
  async fn fetch_github_offer(&self, channel: Channel) -> Result<Option<Release>, Failure> {
    let list = if channel == Channel::Preview { logic::list_url(&self.cfg.feed_url) } else { None };
    let Some(list) = list else { return self.fetch_release(&self.cfg.feed_url, false).await };
    let Some(json) = self.fetch_json(&list).await? else { return Ok(None) };
    if !json.is_array() {
      return Err(Failure::Said(self.texts().unreadable.to_string()));
    }
    // Only a release with this install's file.
    Ok(logic::newest_release(&json, &self.cfg.current_version, &self.cfg.origin, Some(self.cfg.kind)))
  }

  // ---- files ----------------------------------------------------------------------

  /// A verified copy of `asset` that is already on disk — from an earlier session, or a manual download.
  async fn find_downloaded(&self, asset: Option<&Asset>) -> Option<PathBuf> {
    let file = self.cfg.cache_dir.join(&asset?.name);
    file_matches(&file, asset?).await.then_some(file)
  }

  /// Empties the download folder of earlier rounds — installers that are
  /// installed or outdated, and halves of interrupted downloads.
  fn clear_cache(&self, keep: Option<&str>) {
    let Ok(entries) = fs::read_dir(&self.cfg.cache_dir) else { return };
    for entry in entries.flatten() {
      let name = entry.file_name().to_string_lossy().into_owned();
      let lower = name.to_ascii_lowercase();
      if name != MARKER && Some(name.as_str()) != keep && (lower.ends_with(".exe") || lower.ends_with(".partial")) {
        let _ = fs::remove_file(entry.path());
      }
    }
  }

  fn writable(dir: &Path) -> bool {
    let probe = dir.join(format!(".girovo-update-{}.tmp", std::process::id()));
    let ok = fs::create_dir_all(dir).is_ok() && OpenOptions::new().write(true).create_new(true).open(&probe).is_ok();
    let _ = fs::remove_file(&probe);
    ok
  }

  // ---- the marker across the restart -------------------------------------------------

  fn marker_file(&self) -> PathBuf {
    self.cfg.cache_dir.join(MARKER)
  }

  fn write_marker(&self, release: &Release) -> io::Result<()> {
    fs::create_dir_all(&self.cfg.cache_dir)?;
    let marker = serde_json::json!({
      "from": self.cfg.current_version,
      "to": release.version,
      "at": now_ms(),
      "notes": release.notes,
      "url": release.url,
      "previousFile": null,
    });
    create_private(&self.marker_file())?.write_all(marker.to_string().as_bytes())
  }

  fn read_marker(&self) {
    let Ok(text) = fs::read_to_string(self.marker_file()) else { return };
    // Read once is enough.
    let _ = fs::remove_file(self.marker_file());
    let Ok(Value::Object(marker)) = serde_json::from_str::<Value>(&text) else { return };
    let field = |k: &str| marker.get(k).and_then(Value::as_str);
    let to = field("to").unwrap_or("");
    let from = field("from").unwrap_or("");
    let current = &self.cfg.current_version;
    if to == current && from == to {
      // The running version installed once more (from a file): the version
      // was this one before and is this one now, so nothing tells whether the
      // installer ran. No greeting, nothing for telemetry, and what is
      // remembered of another version's failed install stays.
      self.clear_cache(None);
    } else if to == current {
      self.host.set_pref(PREF_FAILED_INSTALL, "");
      let installed = Installed {
        version: current.clone(),
        from: from.chars().take(40).collect(),
        notes: field("notes").unwrap_or("").chars().take(logic::MAX_NOTES_CHARS).collect(),
        url: logic::release_page_or(field("url"), &self.cfg.origin.releases_page),
      };
      self.set(|s| s.installed = Some(installed));
      self.clear_cache(None);
    } else if logic::parse_version(to).is_some() {
      // Another version than the one the installer was started for: it did not
      // run — an update, or the way back from a preview to an older release.
      // Remembered however old the marker is, so the start does not install
      // it again unasked when Girovo is next opened days later; said only
      // while it is news.
      self.host.set_pref(PREF_FAILED_INSTALL, to);
      let recent = marker.get("at").and_then(Value::as_f64).is_some_and(|at| (now_ms() as f64) - at < MARKER_MAX_AGE_MS);
      if recent {
        let message = self.texts().not_completed(to);
        self.set(|s| {
          s.failed_install = Some(to.to_string());
          s.error = Some(ErrorInfo { during: During::Install, message });
        });
      }
    }
  }

  // ---- differential -------------------------------------------------------------------
  //
  // CI writes a blockmap beside every Setup.exe (scripts/blockmap.mjs): the
  // checksums of its content-defined chunks. The installer is stored
  // uncompressed, so most of those chunks are the very chunks of the files
  // this copy has installed — the model, most of Girovo.exe (chunks.rs).
  // Those are copied from the install folder, the rest is fetched from the
  // release with HTTP range requests.
  //
  // None of this is trusted: the file put together this way is checked
  // against GitHub's digest exactly like a whole download, and anything that
  // does not work out — no blockmap, a server that ignores ranges, a local
  // file that changed, a digest that does not match — means the whole file
  // after all.

  /// A small release file (a blockmap), checked against its digest when GitHub lists one.
  async fn fetch_small(&self, asset: &Asset, max: usize) -> Result<Vec<u8>, Failure> {
    let res = self.get_retrying(&asset.url, |r| r.timeout(CHECK_TIMEOUT), None).await?;
    if !res.status().is_success() {
      return Err(Failure::Other(format!("HTTP {} for {}", res.status().as_u16(), asset.name)));
    }
    let buf = read_bytes(res, max, "too large").await?;
    if buf.len() as u64 != asset.size {
      return Err(Failure::Other(format!("{} is not the announced size", asset.name)));
    }
    if asset.sha256.as_ref().is_some_and(|sha| *sha != hex(&Sha256::digest(&buf))) {
      return Err(Failure::Other(format!("{} does not match its digest", asset.name)));
    }
    Ok(buf)
  }

  async fn fetch_blockmap(&self, map: &Asset, file_size: u64) -> Result<Vec<logic::Chunk>, Failure> {
    let gz = self.fetch_small(map, MAX_BLOCKMAP_BYTES).await?;
    let mut text = Vec::new();
    flate2::read::GzDecoder::new(gz.as_slice()).take(MAX_BLOCKMAP_JSON_BYTES).read_to_end(&mut text)?;
    let json: Value = serde_json::from_slice(&text).map_err(|e| Failure::Other(format!("{}: {e}", map.name)))?;
    // A blockmap electron-builder wrote (a 5.x release) cuts otherwise: none of its chunks could match.
    if json.get("chunker").and_then(Value::as_str) != Some(chunks::CHUNKER) {
      return Err(Failure::Other(format!("{} is not cut by {}", map.name, chunks::CHUNKER)));
    }
    logic::parse_blockmap(&json, file_size).ok_or_else(|| Failure::Other(format!("{} is not a blockmap of its installer", map.name)))
  }

  /// How to put `asset` (the new Setup.exe) together from the installed
  /// files, or None when it cannot be or is not worth it. Never fails.
  async fn plan_differential(&self, release: &Release, asset: Option<&Asset>) -> Option<Arc<DiffPlan>> {
    let (Some(asset), Some(dir)) = (asset, self.cfg.install_dir.clone()) else { return None };
    if !self.installable() {
      return None;
    }
    let map = logic::pick_blockmap(release, asset)?;
    let planned = async {
      let wanted = self.fetch_blockmap(map, asset.size).await?;
      let local = async_runtime::spawn_blocking(move || chunks::index_local(&dir))
        .await
        .map_err(|e| Failure::Other(e.to_string()))?;
      let plan = logic::plan_differential(&local.chunks, &wanted, MERGE_GAP);
      // Nothing to reuse: that is just the whole file, in ranges.
      if plan.copies.is_empty() || plan.fetches.len() > DIFF_MAX_REQUESTS {
        return Ok::<_, Failure>(None);
      }
      Ok(Some(Arc::new(DiffPlan { plan, sources: local.files })))
    };
    match planned.await {
      Ok(plan) => plan,
      Err(err) => {
        warn("no differential download", &err);
        None
      }
    }
  }

  /// One planned byte range of `asset`, written into `out` where it belongs.
  async fn fetch_range(
    &self,
    asset: &Asset,
    range: &logic::FetchRange,
    out: &Mutex<File>,
    stop: &Cancel,
    received: &AtomicU64,
    progress: &Progress<'_>,
  ) -> Result<(), Failure> {
    let end = range.start + range.size - 1;
    let request = self.client.get(&asset.url).header("Range", format!("bytes={}-{end}", range.start));
    let mut res = abortable(stop, self.send(request)).await?;
    let got = res.headers().get("content-range").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    // A server that ignores the range answers 200 with the whole file.
    let expected = format!("bytes {}-{end}/", range.start);
    if res.status().as_u16() != 206 || !got.starts_with(&expected) {
      return Err(Failure::Other(format!("HTTP {} for bytes {}-{end}", res.status().as_u16(), range.start)));
    }
    let mut at = range.start;
    loop {
      let next = abortable(stop, async {
        tokio::time::timeout(self.cfg.stall, res.chunk()).await.map_err(|_| Failure::Stalled)?.map_err(Failure::Http)
      })
      .await?;
      let Some(chunk) = next else { break };
      if at + chunk.len() as u64 > range.start + range.size {
        return Err(Failure::Other("a range longer than asked for".into()));
      }
      write_at(out, at, &chunk)?;
      at += chunk.len() as u64;
      progress.report(received.fetch_add(chunk.len() as u64, Ordering::Relaxed) + chunk.len() as u64);
    }
    if at != range.start + range.size {
      return Err(Failure::Other("a range shorter than asked for".into()));
    }
    Ok(())
  }

  /// Builds `asset` into `partial` by `plan` and checks it against GitHub's
  /// digest. True when that worked; false when the whole file should be
  /// downloaded instead. Fails only when `cancel` was.
  async fn build_differential(
    &self,
    plan: &DiffPlan,
    asset: &Asset,
    partial: &Path,
    cancel: &Cancel,
    progress: &Progress<'_>,
  ) -> Result<bool, Failure> {
    // One failed range stops the others; so does the user.
    let stop = Cancel::new();
    let built = async {
      fs::create_dir_all(partial.parent().unwrap_or(Path::new(".")))?;
      let file = create_private(partial)?;
      file.set_len(asset.size)?;
      let out = Arc::new(Mutex::new(file));

      // The unchanged chunks, from the installed files.
      let copies = plan.plan.copies.clone();
      let sources = plan.sources.clone();
      let target = out.clone();
      let stopped = cancel.clone();
      async_runtime::spawn_blocking(move || copy_ranges(&copies, &sources, &target, &stopped))
        .await
        .map_err(|e| Failure::Other(e.to_string()))??;
      if cancel.is_cancelled() {
        return Err(Failure::Aborted);
      }

      // The rest. GitHub answers one byte range per request (several in one:
      // HTTP 501), and each one goes through a redirect first, so four run
      // side by side.
      let queue = Mutex::new(plan.plan.fetches.iter().cloned().collect::<VecDeque<_>>());
      let received = AtomicU64::new(0);
      let failure: Mutex<Option<Failure>> = Mutex::new(None);
      let (queue, received, failure, out_ref, stop_ref) = (&queue, &received, &failure, &out, &stop);
      let worker = move || async move {
        let (out, stop) = (out_ref, stop_ref);
        loop {
          let Some(range) = queue.lock().unwrap().pop_front() else { break };
          if stop.is_cancelled() {
            break;
          }
          if let Err(err) = self.fetch_range(asset, &range, &out, &stop, &received, progress).await {
            failure.lock().unwrap().get_or_insert(err);
            stop.cancel();
            break;
          }
        }
      };
      let watch_user = async {
        tokio::select! {
          _ = cancel.cancelled() => stop.cancel(),
          _ = stop.cancelled() => {}
        }
      };
      let workers = async {
        // All of them settled before the file is closed — none still writing.
        tokio::join!(worker(), worker(), worker(), worker());
        stop.cancel();
      };
      tokio::join!(workers, watch_user);
      if cancel.is_cancelled() {
        return Err(Failure::Aborted);
      }
      if let Some(err) = failure.lock().unwrap().take() {
        return Err(err);
      }
      drop(out);
      if !file_matches(partial, asset).await {
        return Err(Failure::Other("the assembled file does not match the digest".into()));
      }
      Ok(())
    };
    match built.await {
      Ok(()) => Ok(true),
      Err(_) if cancel.is_cancelled() => Err(Failure::Aborted),
      Err(err) => {
        warn("differential download failed, downloading the whole file", &err);
        Ok(false)
      }
    }
  }

  /// Streams the response into `file`, hashing on the way, and answers the
  /// hex digest. Fails — leaving the cleanup to the caller — when the body is
  /// longer or shorter than the release said, or the disk refuses it.
  async fn save(
    &self,
    mut res: reqwest::Response,
    file: &Path,
    expected: u64,
    cancel: &Cancel,
    progress: &Progress<'_>,
  ) -> Result<String, Failure> {
    fs::create_dir_all(file.parent().unwrap_or(Path::new(".")))?;
    let mut out = io::BufWriter::with_capacity(1024 * 1024, create_private(file)?);
    let mut hash = Sha256::new();
    let mut received = 0u64;
    loop {
      let next = abortable(cancel, async {
        tokio::time::timeout(self.cfg.stall, res.chunk()).await.map_err(|_| Failure::Stalled)?.map_err(Failure::Http)
      })
      .await?;
      let Some(chunk) = next else { break };
      received += chunk.len() as u64;
      if received > expected {
        return Err(Failure::Said(self.texts().too_large.to_string()));
      }
      hash.update(&chunk);
      out.write_all(&chunk)?;
      progress.report(received);
    }
    if received != expected {
      return Err(Failure::Said(self.texts().interrupted.to_string()));
    }
    out.into_inner().map_err(|e| e.into_error())?.sync_all()?;
    Ok(hex(&hash.finalize()))
  }

  // ---- check ------------------------------------------------------------------------

  async fn run_check(&self, manual: bool) -> UpdateState {
    let before = self.state().phase;
    let channel = self
      .set(|s| {
        s.phase = Phase::Checking;
        if manual {
          s.error = None;
        }
      })
      .channel;
    match self.fetch_offer(channel).await {
      Ok(release) => self.take_offer(release, channel).await,
      Err(err) => {
        warn("check failed", &err);
        // Back to where it was. An automatic check fails quietly — being
        // offline at start is not worth a message.
        let message = manual.then(|| self.describe(&err, During::Check));
        self.set(|s| {
          s.phase = if before == Phase::Checking { Phase::Idle } else { before };
          if let Some(message) = message {
            s.error = Some(ErrorInfo { during: During::Check, message });
          }
        })
      }
    }
  }

  async fn take_offer(&self, release: Option<Release>, channel: Channel) -> UpdateState {
    let checked_at = Some(now_ms());
    let current = &self.cfg.current_version;
    // A signed offer is ordered by build number (trust::build_number), which
    // knows every name a release ever had; the tests' unsigned ones by name.
    let newer = release.as_ref().is_some_and(|r| {
      if self.cfg.require_signed {
        matches!((trust::build_number(&r.version), trust::build_number(current)), (Some(a), Some(b)) if a > b)
      } else {
        logic::is_newer(&r.version, current, channel == Channel::Preview)
      }
    });
    // Back on "Stabil" from a preview: the latest stable release, older as it may be.
    let back = !newer && channel == Channel::Stable && release.as_ref().is_some_and(|r| logic::is_switch_back(&r.version, current));
    let Some(release) = release.filter(|_| newer || back) else {
      {
        let mut inner = self.inner.lock().unwrap();
        inner.pending = None;
        inner.ready_file = None;
      }
      self.clear_cache(None);
      return self.set(|s| {
        s.phase = Phase::Current;
        s.checked_at = checked_at;
        s.release = None;
        s.received = 0;
        s.total = 0;
        s.error = None;
      });
    };
    // Without GitHub's digest there is nothing to check the file against —
    // offered as a download page then, never run from here.
    let usable = if self.installable() { logic::pick_asset(&release, self.cfg.kind).filter(|a| a.sha256.is_some()).cloned() } else { None };
    let (ready, mut plan) = {
      let mut inner = self.inner.lock().unwrap();
      let same_file = matches!(
        (inner.pending.as_ref().and_then(|p| p.asset.as_ref()), usable.as_ref()),
        (Some(a), Some(b)) if a.sha256 == b.sha256
      );
      let plan = if same_file { inner.pending.as_ref().and_then(|p| p.plan.clone()) } else { None };
      if !same_file {
        inner.ready_file = None;
      }
      inner.pending = Some(Pending { release: release.clone(), asset: usable.clone(), plan: plan.clone() });
      (inner.ready_file.clone(), plan)
    };
    let file = match ready {
      Some(file) => Some(file),
      None => self.find_downloaded(usable.as_ref()).await,
    };
    self.inner.lock().unwrap().ready_file = file.clone();
    if file.is_none() && plan.is_none() {
      plan = self.plan_differential(&release, usable.as_ref()).await;
      if let Some(p) = self.inner.lock().unwrap().pending.as_mut() {
        p.plan = plan.clone();
      }
    }
    // Installers of other versions are of no use any more.
    let keep = file.as_deref().filter(|f| f.parent() == Some(self.cfg.cache_dir.as_path())).and_then(Path::file_name);
    self.clear_cache(keep.map(|k| k.to_string_lossy()).as_deref());
    let public = self.public_release(&release, usable.as_ref(), if file.is_some() { None } else { plan.as_deref() }, back);
    self.set(|s| {
      s.phase = if file.is_some() { Phase::Ready } else { Phase::Available };
      s.checked_at = checked_at;
      s.release = Some(public);
      s.received = 0;
      s.total = 0;
      s.error = None;
    })
  }

  /// Asks GitHub; a check already running is answered by its own result.
  /// `manual`: the user asked, so a failure is said.
  pub async fn check(&self, manual: bool) -> UpdateState {
    let Ok(_running) = self.check_lock.try_lock() else {
      let _wait = self.check_lock.lock().await;
      return self.state();
    };
    if matches!(self.state().phase, Phase::Downloading | Phase::Installing) {
      return self.state();
    }
    self.run_check(manual).await
  }

  // ---- download -----------------------------------------------------------------------

  /// Begins the download of the release found, the state saying so before this
  /// answers; None when there is nothing to download, or one is running.
  pub fn begin_download(&self) -> Option<DownloadJob> {
    let job = {
      let mut inner = self.inner.lock().unwrap();
      if inner.state.phase != Phase::Available || inner.abort.is_some() {
        return None;
      }
      let pending = inner.pending.as_ref()?;
      let asset = pending.asset.clone()?;
      let plan = pending.plan.clone();
      let running = self.download_lock.clone().try_lock_owned().ok()?;
      let cancel = Cancel::new();
      inner.abort = Some(cancel.clone());
      DownloadJob { updater: self.arc(), asset, plan, cancel, _running: running }
    };
    let total = job.plan.as_ref().map_or(job.asset.size, |p| p.plan.fetch_bytes);
    self.set(|s| {
      s.phase = Phase::Downloading;
      s.received = 0;
      s.total = total;
      s.error = None;
    });
    Some(job)
  }

  /// Downloads the release found, to the end; answers the state then.
  #[allow(dead_code)] // start.rs's, until lib.rs calls it
  pub async fn download(&self) -> UpdateState {
    match self.begin_download() {
      Some(job) => job.run().await,
      None => self.state(),
    }
  }

  async fn run_download(&self, asset: &Asset, plan: Option<&DiffPlan>, cancel: &Cancel) -> Result<PathBuf, Failure> {
    let progress = Progress { updater: self, last: Mutex::new(None) };
    let dir = &self.cfg.cache_dir;
    if !Self::writable(dir) {
      return Err(Failure::Said(self.texts().no_folder.to_string()));
    }
    let file = dir.join(&asset.name);
    let partial = dir.join(format!("{}.partial", asset.name));
    let result = async {
      let built = match plan {
        Some(plan) => self.build_differential(plan, asset, &partial, cancel, &progress).await?,
        None => false,
      };
      if !built {
        if plan.is_some() {
          // The whole file now, and on a retry; the next check plans afresh.
          if let Some(p) = self.inner.lock().unwrap().pending.as_mut().filter(|p| p.asset.as_ref() == Some(asset)) {
            p.plan = None;
          }
          progress.reset();
          self.set(|s| {
            s.received = 0;
            s.total = asset.size;
            if let Some(r) = s.release.as_mut() {
              r.size = Some(asset.size);
            }
          });
        }
        // No timeout on the request, which would count the body too: send() has the limit.
        let res = abortable(cancel, self.get_retrying(&asset.url, |r| r, Some(cancel))).await?;
        if !res.status().is_success() {
          return Err(Failure::Said(self.texts().download_http(res.status().as_u16())));
        }
        let digest = self.save(res, &partial, asset.size, cancel, &progress).await?;
        if asset.sha256.as_deref() != Some(digest.as_str()) {
          return Err(Failure::Said(self.texts().digest_mismatch.to_string()));
        }
      }
      rename_with_retry(&partial, &file).await?;
      Ok(file)
    }
    .await;
    if result.is_err() {
      let _ = fs::remove_file(&partial);
    }
    result
  }

  pub fn cancel(&self) -> UpdateState {
    let inner = self.inner.lock().unwrap();
    if let Some(abort) = &inner.abort {
      abort.cancel();
    }
    inner.state.clone()
  }

  // ---- install --------------------------------------------------------------------------

  /// Checks the download once more, notes what is being installed, and quits;
  /// the installer starts once the app has (AtExit::Install).
  pub async fn install(&self) -> UpdateState {
    self.install_noting(None).await
  }

  /// install(). `comes_back`: this is the user's step back to an older release
  /// from a file, and that is the version the next start would put back.
  /// Instead of the marker, that version is noted as not to be installed
  /// unasked (PREF_FAILED_INSTALL). No marker, for two reasons: the older
  /// version's read_marker would take one naming it as an update that arrived
  /// and clear the note (every 6.0.x does), and a step back is no "aktualisiert
  /// auf". Without one the next start says nothing either way; had the
  /// installer failed, its own window said so.
  async fn install_noting(&self, comes_back: Option<String>) -> UpdateState {
    let Some(args) = logic::install_args(self.cfg.kind) else { return self.state() };
    let (file, release, asset) = {
      let inner = self.inner.lock().unwrap();
      match (inner.state.phase, &inner.ready_file, &inner.pending) {
        (Phase::Ready, Some(file), Some(Pending { release, asset: Some(asset), .. })) => (file.clone(), release.clone(), asset.clone()),
        _ => return inner.state.clone(),
      }
    };
    self.set(|s| {
      s.phase = Phase::Installing;
      s.error = None;
    });
    let prepared = async {
      // It has been lying on disk since it was checked: check it again, right before it runs.
      if !file_matches(&file, &asset).await {
        self.inner.lock().unwrap().ready_file = None;
        if file.parent() == Some(self.cfg.cache_dir.as_path()) {
          let _ = fs::remove_file(&file);
        }
        self.remove_unpacked(&file);
        return Err(Failure::Said(self.texts().changed.to_string()));
      }
      match &comes_back {
        Some(version) => {
          let _ = fs::remove_file(self.marker_file());
          self.host.set_pref(PREF_FAILED_INSTALL, version);
        }
        None => self.write_marker(&release)?,
      }
      Ok(())
    };
    if let Err(err) = prepared.await {
      let _ = fs::remove_file(self.marker_file());
      warn("install failed", &err);
      let message = self.describe(&err, During::Install);
      let ready = self.inner.lock().unwrap().ready_file.is_some();
      return self.set(|s| {
        s.phase = if ready { Phase::Ready } else { Phase::Available };
        s.error = Some(ErrorInfo { during: During::Install, message });
      });
    }
    let notice = InstallNotice {
      version: release.version.clone(),
      back: logic::is_switch_back(&release.version, &self.cfg.current_version),
    };
    if let Some(hook) = self.before_install.lock().unwrap().as_ref() {
      hook(&notice);
    }
    self.host.quit(AtExit::Install(InstallPlan { file, args, version: release.version, sha256: asset.sha256.clone() }));
    self.state()
  }

  /// The installed Windows app updates only through the start window: quit,
  /// and start again with UPDATE_ARG, the start window installing the update.
  /// `args`: this start's own, which the next one keeps.
  pub fn restart_to_update(&self, args: impl IntoIterator<Item = String>) -> UpdateState {
    // Quitting for an install already (install_file, while the page's last
    // writes are waited for): a restart now would start Girovo again without it.
    if self.cfg.kind != InstallKind::Nsis || self.state().phase == Phase::Installing {
      return self.state();
    }
    // A bundle this start was opened with has had its turn.
    let mut next: Vec<String> = args.into_iter().filter(|a| a != "--background" && a != UPDATE_ARG && !bundle::is_bundle(Path::new(a))).collect();
    next.push(UPDATE_ARG.to_string());
    self.host.quit(AtExit::Relaunch(next));
    self.state()
  }

  // ---- settings and schedule ----------------------------------------------------------------

  fn schedule(&self, delay: Option<Duration>) {
    let mut inner = self.inner.lock().unwrap();
    if let Some(timer) = inner.timer.take() {
      timer.abort();
    }
    let Some(delay) = delay else { return };
    if !inner.state.auto || !self.cfg.auto_check {
      return;
    }
    let me = self.me.clone();
    inner.timer = Some(async_runtime::spawn(async move {
      let mut delay = delay;
      loop {
        tokio::time::sleep(delay).await;
        let Some(updater) = me.upgrade() else { break };
        updater.check(false).await;
        delay = CHECK_INTERVAL;
      }
    }));
  }

  // ---- an update from a file (step 5) ------------------------------------------------

  /// "Update aus Datei installieren": a Setup.exe is checked against the signed
  /// manifests girovo.de lists and the one its name points to on GitHub; a
  /// .girovoupdate carries its own (check_bundle). Ready to install when its
  /// size and SHA-256 are a signed release's installer for this kind of
  /// install — an older release too (the page warns); refused otherwise.
  pub async fn check_file(&self, path: PathBuf) -> UpdateState {
    // Quitting for an install: what it runs must stay where it is.
    if self.state().phase == Phase::Installing {
      return self.state();
    }
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let say = self.texts();
    let offer = |phase, message: Option<&str>| FileOffer { phase, name: name.clone(), version: None, older: false, same: false, message: message.map(str::to_string) };
    let round = self.next_file_round();
    if !self.installable() || logic::install_args(self.cfg.kind).is_none() {
      return self.set(|s| s.file = Some(offer(FilePhase::Refused, Some(say.file_not_here))));
    }
    self.set(|s| s.file = Some(offer(FilePhase::Checking, None)));
    if bundle::is_bundle(&path) {
      return self.check_bundle(path, name.clone(), round).await;
    }
    let measured = {
      let p = path.clone();
      async_runtime::spawn_blocking(move || {
        let size = fs::metadata(&p).ok().filter(|m| m.is_file())?.len();
        Some((size, sha256_file(&p)?))
      })
      .await
      .ok()
      .flatten()
    };
    let Some((size, sha)) = measured else {
      return self.file_outcome(round, offer(FilePhase::Refused, Some(say.file_unreadable)));
    };
    let (release, asset) = match self.find_signed(&name, size, &sha).await {
      Ok(found) => found,
      Err(refusal) => {
        let message = match refusal {
          Refusal::NoSignature => say.file_unsigned,
          Refusal::BadSignature => say.file_bad_signature,
          Refusal::Changed => say.file_changed,
          Refusal::CannotCheck => say.file_cannot_check,
        };
        return self.file_outcome(round, offer(FilePhase::Refused, Some(message)));
      }
    };
    let file = self.ready_offer(name.clone(), &release);
    if self.choose(round, (path, release, asset)) { self.set(|s| s.file = Some(file)) } else { self.state() }
  }

  /// A .girovoupdate, with no connection needed: its manifest's signature
  /// against the keys built into the app, then its installer against the
  /// manifest while it is unpacked. The bundle says nothing else that is
  /// believed: the name, the size and the hash are the signed manifest's.
  async fn check_bundle(&self, path: PathBuf, name: String, round: u64) -> UpdateState {
    let say = self.texts();
    let refused = |message: &str| FileOffer {
      phase: FilePhase::Refused,
      name: name.clone(),
      version: None,
      older: false,
      same: false,
      message: Some(message.to_string()),
    };
    let parts = {
      let p = path.clone();
      async_runtime::spawn_blocking(move || -> Result<_, Damaged> {
        let mut opened = Bundle::open(&p)?;
        Ok((opened.small(trust::MANIFEST_NAME, trust::MAX_MANIFEST_BYTES)?, opened.small(trust::SIG_NAME, trust::MAX_MANIFEST_BYTES)?))
      })
      .await
    };
    let (manifest, sig) = match parts {
      Ok(Ok((Some(manifest), Some(sig)))) => (manifest, sig),
      Ok(Ok(_)) => return self.file_outcome(round, refused(say.file_unsigned)),
      _ => return self.file_outcome(round, refused(say.file_unreadable)),
    };
    let signer = trust::verify(&manifest, &String::from_utf8_lossy(&sig), &self.cfg.keys);
    if signer.is_none() {
      return self.file_outcome(round, refused(say.file_bad_signature));
    }
    let Some(release) = trust::release_of(&manifest, &self.cfg.origin) else {
      return self.file_outcome(round, refused(say.file_unreadable));
    };
    // The nightly key signs nightlies, never a release (as on the channels).
    if !trust::signer_fits_version(signer, &release.version) {
      return self.file_outcome(round, refused(say.file_bad_signature));
    }
    // Its name is a plain file name and it has a hash: release_of takes no other.
    let Some(asset) = logic::pick_asset(&release, self.cfg.kind).cloned() else {
      return self.file_outcome(round, refused(say.file_changed));
    };
    // A folder per round, outside what clear_cache sweeps.
    let dir = self.bundle_dir().join(round.to_string());
    let (installer, part) = (dir.join(&asset.name), dir.join(format!("{}.part", asset.name)));
    let unpacked = {
      let (p, d, to, entry, size) = (path.clone(), dir.clone(), part.clone(), asset.name.clone(), asset.size);
      async_runtime::spawn_blocking(move || -> Result<_, Damaged> {
        fs::create_dir_all(&d)?;
        Bundle::open(&p)?.extract(&entry, size, &to)
      })
      .await
    };
    let outcome = match unpacked {
      Ok(Ok(Some(digest))) if asset.sha256.as_deref() == Some(digest.as_str()) => rename_with_retry(&part, &installer).await.map_err(|_| say.file_unreadable),
      Ok(Ok(_)) => Err(say.file_changed),
      _ => Err(say.file_unreadable),
    };
    if let Err(message) = outcome {
      let _ = fs::remove_dir_all(&dir);
      return self.file_outcome(round, refused(message));
    }
    let file = self.ready_offer(name.clone(), &release);
    if self.choose(round, (installer, release, asset)) {
      self.set(|s| s.file = Some(file))
    } else {
      let _ = fs::remove_dir_all(&dir);
      self.state()
    }
  }

  /// Where installers are unpacked from bundles.
  fn bundle_dir(&self) -> PathBuf {
    self.cfg.cache_dir.join("from-bundle")
  }

  /// `file`'s folder, when `file` was unpacked from a bundle.
  fn remove_unpacked(&self, file: &Path) {
    if file.starts_with(self.bundle_dir())
      && let Some(dir) = file.parent()
    {
      let _ = fs::remove_dir_all(dir);
    }
  }

  /// Begins a new round: the file picked before is forgotten, a check still running ends unheard.
  fn next_file_round(&self) -> u64 {
    let (round, chosen) = {
      let mut inner = self.inner.lock().unwrap();
      inner.file_round += 1;
      (inner.file_round, inner.chosen.take())
    };
    if let Some((file, ..)) = chosen {
      self.remove_unpacked(&file);
    }
    round
  }

  /// Keeps what checked out, unless the round is over: whether it was kept.
  fn choose(&self, round: u64, chosen: (PathBuf, Release, Asset)) -> bool {
    let mut inner = self.inner.lock().unwrap();
    let current = inner.file_round == round;
    if current {
      inner.chosen = Some(chosen);
    }
    current
  }

  /// Says how the round's check came out, unless the round is over.
  fn file_outcome(&self, round: u64, file: FileOffer) -> UpdateState {
    if self.inner.lock().unwrap().file_round != round {
      return self.state();
    }
    self.set(|s| s.file = Some(file))
  }

  /// A file that checked out, as the page shows it.
  fn ready_offer(&self, name: String, release: &Release) -> FileOffer {
    let (build, current) = (trust::build_number(&release.version), trust::build_number(&self.cfg.current_version));
    FileOffer {
      phase: FilePhase::Ready,
      name,
      version: Some(release.version.clone()),
      older: matches!((build, current), (Some(a), Some(b)) if a < b),
      same: build.is_some() && build == current,
      message: None,
    }
  }

  /// The signed release whose installer (for this kind of install) is `size`
  /// bytes with `sha`: from girovo.de's listings, else the manifest of the
  /// release the file's name points to (Girovo-<version>-Setup.exe, also as a
  /// copy was renamed: logic::setup_version). Refused, it says why: no
  /// signature for it anywhere, a signature that is not Girovo's (or the
  /// nightly key's on a release), a signed release of that name whose
  /// installer is not this file, or that the places to ask did not answer,
  /// which says nothing about the file.
  async fn find_signed(&self, name: &str, size: u64, sha: &str) -> Result<(Release, Asset), Refusal> {
    // (manifest, signature, whether it is the one the file's name points to)
    let mut candidates: Vec<(String, String, bool)> = Vec::new();
    // Somewhere that could not be asked: "no signature" would be a guess.
    let mut unasked = false;
    if let Some(base) = self.cfg.manifest_base.clone() {
      for channel in [Channel::Stable, Channel::Preview] {
        match self.fetch_listing(&base, channel).await {
          Some(listing) => candidates.extend(listing.into_iter().map(|l| (l.manifest, l.sig, false))),
          None => unasked = true,
        }
      }
    }
    // The release of this name answered that it has no manifest. girovo.de
    // only passes on what a release carries, so that settles it.
    let mut none_by_name = false;
    let version = logic::setup_version(name);
    if let (Some(version), Some(prefix)) = (version.filter(|v| trust::build_number(v).is_some()), self.cfg.origin.download_prefixes.first()) {
      let at = |file: &str| Asset { name: file.to_string(), url: format!("{prefix}{version}/{file}"), size: 0, sha256: None };
      match self.look_up(&at(trust::MANIFEST_NAME)).await {
        Lookup::Found(m) => {
          let m = String::from_utf8_lossy(&m).into_owned();
          match self.look_up(&at(trust::SIG_NAME)).await {
            Lookup::Found(s) => candidates.push((m, String::from_utf8_lossy(&s).into_owned(), true)),
            // A manifest without its signature counts as one with a bad signature.
            Lookup::Absent => candidates.push((m, String::new(), true)),
            Lookup::Failed => unasked = true,
          }
        }
        Lookup::Absent => none_by_name = true,
        Lookup::Failed => unasked = true,
      }
    }
    let named = version.map(str::to_string);
    let (mut bad, mut changed) = (false, false);
    for (manifest, sig, by_name) in candidates {
      let signer = trust::verify(manifest.as_bytes(), &sig, &self.cfg.keys);
      if signer.is_none() {
        bad |= by_name;
        continue;
      }
      let Some(release) = trust::release_of(manifest.as_bytes(), &self.cfg.origin) else { continue };
      // The nightly key signs nightlies, never a release (as on the channels).
      if !trust::signer_fits_version(signer, &release.version) {
        bad |= by_name;
        continue;
      }
      match logic::pick_asset(&release, self.cfg.kind) {
        Some(a) if a.size == size && a.sha256.as_deref() == Some(sha) => {
          let a = a.clone();
          return Ok((release, a));
        }
        _ => changed |= named.as_deref() == Some(release.version.as_str()),
      }
    }
    Err(if changed {
      Refusal::Changed
    } else if bad {
      Refusal::BadSignature
    } else if unasked && !none_by_name {
      Refusal::CannotCheck
    } else {
      Refusal::NoSignature
    })
  }

  /// Installs the picked file that checked out, as an update is installed:
  /// checked once more, the app quits, girovo-update.exe runs it.
  pub async fn install_file(&self) -> UpdateState {
    let chosen = self.inner.lock().unwrap().chosen.take();
    let Some((file, release, asset)) = chosen else { return self.state() };
    if matches!(self.state().phase, Phase::Downloading) {
      self.cancel();
    }
    // An older release, on purpose: the next start must not put the newer one
    // back by itself (start.rs). Which one that would be is read here, while
    // the state still holds the release on offer.
    let current = &self.cfg.current_version;
    let comes_back = logic::steps_back(trust::build_number(&release.version), trust::build_number(current)).then(|| {
      let offered = self.state().release.map(|r| r.version);
      let noted = self.host.pref(PREF_FAILED_INSTALL);
      logic::comes_back(current, offered.as_deref(), noted.as_deref(), trust::build_number).to_string()
    });
    {
      let mut inner = self.inner.lock().unwrap();
      inner.pending = Some(Pending { release: release.clone(), asset: Some(asset.clone()), plan: None });
      inner.ready_file = Some(file);
    }
    let public = self.public_release(&release, Some(&asset), None, false);
    self.set(|s| {
      s.phase = Phase::Ready;
      s.release = Some(public);
      s.file = None;
      s.error = None;
    });
    self.install_noting(comes_back).await
  }

  /// The picked file's dialog closed without installing.
  pub fn dismiss_file(&self) -> UpdateState {
    self.next_file_round();
    self.set(|s| s.file = None)
  }

  /// "Als Datei speichern": the update on offer as a .girovoupdate at `dest`,
  /// to install with no connection or on another PC. Downloads it first when
  /// that has not happened yet (the installed Windows app otherwise leaves
  /// that to the start window); state.saving says how far it is.
  pub async fn save_bundle(&self, dest: PathBuf) -> UpdateState {
    let dest = if bundle::is_bundle(&dest) { dest } else { dest.with_extension(bundle::EXTENSION) };
    let name = dest.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let saving = |phase, message: Option<String>| BundleSave { phase, name: name.clone(), message };
    let offered = self.inner.lock().unwrap().pending.as_ref().is_some_and(|p| p.asset.is_some());
    if !self.installable() || !offered || self.state().saving.is_some_and(|s| s.phase == SavePhase::Working) {
      return self.state();
    }
    self.set(|s| {
      s.saving = Some(saving(SavePhase::Working, None));
      s.error = None;
    });
    // A check or a download under way ends first.
    drop(self.check_lock.lock().await);
    drop(self.download_lock.lock().await);
    if self.state().phase == Phase::Available {
      self.download().await;
    }
    let ready = {
      let inner = self.inner.lock().unwrap();
      match (&inner.ready_file, &inner.pending) {
        (Some(file), Some(Pending { release, asset: Some(asset), .. })) => Some((file.clone(), release.clone(), asset.clone())),
        _ => None,
      }
    };
    let Some((file, release, asset)) = ready else {
      // Called off: nothing to say. A download that failed says why, here.
      let failed = self.state().error.map(|e| e.message);
      return self.set(|s| {
        s.error = None;
        s.saving = failed.map(|message| saving(SavePhase::Failed, Some(message)));
      });
    };
    let done = self.write_bundle(&dest, &file, &release, &asset).await;
    let say = self.texts();
    self.set(|s| {
      s.saving = Some(match done {
        Some(()) => saving(SavePhase::Done, None),
        None => saving(SavePhase::Failed, Some(say.bundle_failed.to_string())),
      });
    })
  }

  /// Writes the bundle: the release's own signed manifest, checked here so a
  /// bundle that could never open is not made, and the installer it names.
  async fn write_bundle(&self, dest: &Path, file: &Path, release: &Release, asset: &Asset) -> Option<()> {
    let prefix = self.cfg.origin.download_prefixes.first()?;
    let at = |name: &str| Asset { name: name.to_string(), url: format!("{prefix}{}/{name}", release.version), size: 0, sha256: None };
    let manifest = self.small_file(&at(trust::MANIFEST_NAME)).await?;
    let sig = self.small_file(&at(trust::SIG_NAME)).await?;
    let signer = trust::verify(&manifest, &String::from_utf8_lossy(&sig), &self.cfg.keys);
    let signed = trust::release_of(&manifest, &self.cfg.origin).filter(|r| r.version == release.version)?;
    if !trust::signer_fits_version(signer, &signed.version) {
      return None;
    }
    let installer = logic::pick_asset(&signed, self.cfg.kind)?.clone();
    if installer.name != asset.name || !file_matches(file, &installer).await {
      return None;
    }
    let (dest, file) = (dest.to_path_buf(), file.to_path_buf());
    let written = async_runtime::spawn_blocking(move || bundle::write(&dest, &manifest, &sig, &file, &installer.name)).await;
    match written {
      Ok(Ok(())) => Some(()),
      Ok(Err(err)) => {
        warn("bundle not saved", &err);
        None
      }
      Err(_) => None,
    }
  }

  /// The page has said how the save went.
  pub fn dismiss_saved(&self) -> UpdateState {
    self.set(|s| {
      if s.saving.as_ref().is_some_and(|b| b.phase != SavePhase::Working) {
        s.saving = None;
      }
    })
  }

  pub fn set_auto(&self, on: bool) -> UpdateState {
    self.host.set_pref(PREF_AUTO, if on { "on" } else { "off" });
    let state = self.set(|s| s.auto = on);
    self.schedule(on.then_some(AUTO_ON_DELAY));
    state
  }

  /// "Neueste Updates erhalten, sobald sie verfügbar sind": a staged release
  /// reaches this copy at once. The next check takes it into account.
  pub fn set_early(&self, on: bool) -> UpdateState {
    self.host.set_pref(PREF_EARLY, if on { "on" } else { "off" });
    self.set(|s| s.early = on)
  }

  /// Switches between the stable and the preview channel, and asks again at
  /// once: what the other channel offered — found, downloading or downloaded —
  /// is dropped unless this one offers it too. Going back to stable from a
  /// preview offers the latest stable release, older as it may be
  /// (logic::is_switch_back): the channel's own version, a click away.
  pub async fn set_channel(&self, value: &str) -> UpdateState {
    let channel = logic::channel_of(Some(value));
    self.host.set_pref(PREF_CHANNEL, channel.as_str());
    // The user's own choice: the one-time move back to Stabil
    // (logic::moves_to_stable) never undoes it, on whichever build it comes.
    if self.host.pref(PREF_MOVED_TO_STABLE).is_none_or(|v| v.is_empty()) {
      self.host.set_pref(PREF_MOVED_TO_STABLE, &self.cfg.current_version);
    }
    if channel == self.state().channel {
      return self.state();
    }
    self.set(|s| s.channel = channel);
    self.cancel();
    // A check or download still running is of the old channel: let it end first.
    drop(self.download_lock.lock().await);
    drop(self.check_lock.lock().await);
    self.check(true).await
  }

  pub fn open_release(&self) -> UpdateState {
    let state = self.state();
    let page = &self.cfg.origin.releases_page;
    let url = state.release.as_ref().map(|r| r.url.clone()).or_else(|| state.installed.as_ref().map(|i| i.url.clone()));
    let url = url.unwrap_or_else(|| page.clone());
    if url.starts_with(page.as_str()) {
      self.host.open_external(&url);
    }
    state
  }

  /// Reads what the last start left (the marker), clears half downloads, and plans the first check.
  pub fn start(&self) {
    self.read_marker();
    // Halves of downloads a crash or a quit cut off.
    if let Ok(entries) = fs::read_dir(&self.cfg.cache_dir) {
      for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().ends_with(".partial") {
          let _ = fs::remove_file(entry.path());
        }
      }
    }
    // Installers unpacked from bundles: installed by now, or never going to be.
    let _ = fs::remove_dir_all(self.bundle_dir());
    self.schedule(Some(FIRST_CHECK_DELAY));
  }

  #[cfg(test)]
  pub fn stop(&self) {
    self.schedule(None);
    self.cancel();
  }
}

impl DownloadJob {
  pub async fn run(self) -> UpdateState {
    let DownloadJob { updater, asset, plan, cancel, _running } = self;
    let outcome = updater.run_download(&asset, plan.as_deref(), &cancel).await;
    let state = match outcome {
      Ok(file) => {
        updater.inner.lock().unwrap().ready_file = Some(file);
        updater.set(|s| {
          s.phase = Phase::Ready;
          s.received = asset.size;
        })
      }
      Err(Failure::Aborted) => updater.set(|s| {
        s.phase = Phase::Available;
        s.received = 0;
        s.total = 0;
      }),
      Err(err) => {
        warn("download failed", &err);
        let message = updater.describe(&err, During::Download);
        updater.set(|s| {
          s.phase = Phase::Available;
          s.received = 0;
          s.total = 0;
          s.error = Some(ErrorInfo { during: During::Download, message });
        })
      }
    };
    // The lock goes first: whoever waits for this download (set_channel) may go on.
    drop(_running);
    let mut inner = updater.inner.lock().unwrap();
    if inner.abort.as_ref().is_some_and(|a| a.same(&cancel)) {
      inner.abort = None;
    }
    state
  }
}

/// The plan's copies, from the installed files into `out` (blocking).
fn copy_ranges(copies: &[logic::CopyRange], sources: &[PathBuf], out: &Mutex<File>, cancel: &Cancel) -> Result<(), Failure> {
  let mut open: Vec<Option<File>> = (0..sources.len()).map(|_| None).collect();
  let mut buf = vec![0u8; COPY_CHUNK_BYTES];
  for copy in copies {
    let source = match &mut open[copy.src] {
      Some(f) => f,
      slot => slot.insert(File::open(&sources[copy.src])?),
    };
    let mut done = 0u64;
    while done < copy.size {
      if cancel.is_cancelled() {
        return Err(Failure::Aborted);
      }
      let length = (copy.size - done).min(COPY_CHUNK_BYTES as u64) as usize;
      source.seek(SeekFrom::Start(copy.from + done))?;
      source.read_exact(&mut buf[..length]).map_err(|_| Failure::Other("a local file is shorter than when it was read".into()))?;
      write_at(out, copy.to + done, &buf[..length])?;
      done += length as u64;
    }
  }
  Ok(())
}

/// Notes `then` as what runs once the app has quit (mod.rs). An install
/// already noted stays: the app is quitting for it, and a restart asked for
/// meanwhile would start Girovo again with nothing installed — the installer
/// starts it anyway. Answers whether `then` was noted.
pub fn queue_at_exit(queued: &mut Option<AtExit>, then: AtExit) -> bool {
  if matches!((&*queued, &then), (Some(AtExit::Install(_)), AtExit::Relaunch(_))) {
    return false;
  }
  *queued = Some(then);
  true
}

/// What happens once the app has quit (mod.rs): the installer, else the app
/// itself again. `spawn` starts a program detached and answers its pid;
/// `started` hears of a running installer (the install window).
pub fn run_at_exit(
  action: AtExit,
  current_exe: Option<&Path>,
  spawn: impl Fn(&Path, &[String]) -> io::Result<u32>,
  started: impl FnOnce(u32, &InstallPlan),
) {
  match action {
    AtExit::Install(plan) => match spawn(&plan.file, &plan.args) {
      Ok(pid) => started(pid, &plan),
      Err(err) => {
        warn("the installer did not start", &err);
        // The app comes back rather than leave the screen empty; the marker
        // it finds tells the user the update did not happen.
        if let Some(exe) = current_exe {
          let _ = spawn(exe, &[]);
        }
      }
    },
    AtExit::Relaunch(args) => {
      if let Some(exe) = current_exe {
        if let Err(err) = spawn(exe, &args) {
          warn("could not start again", &err);
        }
      }
    }
  }
}
