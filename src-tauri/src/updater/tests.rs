// The whole update flow — check, download, verify, install, the restart —
// against a local server standing in for GitHub: the Electron shell's updater.test.cjs,
// test for test. Tauri is not needed: everything it provides comes in through
// the Host trait.
//
// Left out, with the reason: the portable build (Tauri builds none), and "a
// failed start keeps the update ready" — the installer starts once the app
// has quit now, so its failure is the at-exit tests' (the app comes back, and
// its marker says the update did not happen). The differential tests are
// rebuilt for chunks taken from the installed files instead of a kept
// installer (chunks.rs).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::chunks;
use super::engine::*;
use super::logic::{InstallKind, Origin, RELEASES_PAGE};
use super::start::StartWindow;
use crate::texts::Lang;

// ---- a stand-in for GitHub ---------------------------------------------------------

struct Request {
  path: String,
  headers: HashMap<String, String>,
}

/// One connection's answer. Dropped without hang(), the connection closes.
struct Conn {
  stream: Option<TcpStream>,
  held: Arc<Mutex<Vec<TcpStream>>>,
}

impl Conn {
  fn head(&mut self, status: u16, headers: &[(&str, String)]) {
    let mut text = format!("HTTP/1.1 {status} X\r\nConnection: close\r\n");
    for (k, v) in headers {
      text.push_str(&format!("{k}: {v}\r\n"));
    }
    text.push_str("\r\n");
    self.write(text.as_bytes());
  }
  fn write(&mut self, bytes: &[u8]) {
    if let Some(s) = self.stream.as_mut() {
      let _ = s.write_all(bytes);
      let _ = s.flush();
    }
  }
  fn send(&mut self, status: u16, body: &[u8]) {
    self.head(status, &[("Content-Length", body.len().to_string())]);
    self.write(body);
  }
  fn json(&mut self, body: &Value) {
    let text = body.to_string();
    self.head(200, &[("Content-Type", "application/json".into()), ("Content-Length", text.len().to_string())]);
    self.write(text.as_bytes());
  }
  /// Keeps the connection open, saying nothing more, until the test ends.
  fn hang(&mut self) {
    if let Some(s) = self.stream.take() {
      self.held.lock().unwrap().push(s);
    }
  }
}

impl Drop for Conn {
  fn drop(&mut self) {
    if let Some(s) = self.stream.take() {
      let _ = s.shutdown(std::net::Shutdown::Both);
    }
  }
}

type Route = dyn Fn(&Request, &mut Conn, &str) + Send + Sync;

struct Server {
  base: String,
  held: Arc<Mutex<Vec<TcpStream>>>,
}

impl Server {
  fn start(route: impl Fn(&Request, &mut Conn, &str) + Send + Sync + 'static) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://127.0.0.1:{}/", listener.local_addr().unwrap().port());
    let held = Arc::new(Mutex::new(Vec::new()));
    let route: Arc<Route> = Arc::new(route);
    let (b, h) = (base.clone(), held.clone());
    std::thread::spawn(move || {
      for stream in listener.incoming().flatten() {
        let (route, base, held) = (route.clone(), b.clone(), h.clone());
        std::thread::spawn(move || serve(stream, &*route, &base, held));
      }
    });
    Server { base, held }
  }
}

impl Drop for Server {
  fn drop(&mut self) {
    for s in self.held.lock().unwrap().drain(..) {
      let _ = s.shutdown(std::net::Shutdown::Both);
    }
  }
}

fn serve(mut stream: TcpStream, route: &Route, base: &str, held: Arc<Mutex<Vec<TcpStream>>>) {
  let mut buf = Vec::new();
  let mut byte = [0u8; 1];
  while !buf.ends_with(b"\r\n\r\n") {
    match stream.read(&mut byte) {
      Ok(1) => buf.push(byte[0]),
      _ => return,
    }
  }
  let text = String::from_utf8_lossy(&buf);
  let mut lines = text.split("\r\n");
  let path = lines.next().unwrap_or("").split(' ').nth(1).unwrap_or("").to_string();
  let headers = lines
    .filter_map(|l| l.split_once(':'))
    .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string()))
    .collect();
  let mut conn = Conn { stream: Some(stream), held };
  route(&Request { path, headers }, &mut conn, base);
}

// ---- fakes for what the app provides --------------------------------------------------

#[derive(Default)]
struct FakeHost {
  prefs: Mutex<HashMap<String, String>>,
  states: Mutex<Vec<UpdateState>>,
  opened: Mutex<Vec<String>>,
  quits: Mutex<Vec<AtExit>>,
}

impl Host for FakeHost {
  fn pref(&self, key: &str) -> Option<String> {
    self.prefs.lock().unwrap().get(key).cloned()
  }
  fn set_pref(&self, key: &str, value: &str) {
    self.prefs.lock().unwrap().insert(key.into(), value.into());
  }
  fn publish(&self, state: &UpdateState) {
    self.states.lock().unwrap().push(state.clone());
  }
  fn open_external(&self, url: &str) {
    self.opened.lock().unwrap().push(url.into());
  }
  fn lang(&self) -> Lang {
    Lang::De
  }
  fn quit(&self, then: AtExit) {
    self.quits.lock().unwrap().push(then);
  }
}

impl FakeHost {
  fn with_pref(key: &str, value: &str) -> Arc<FakeHost> {
    let host = FakeHost::default();
    host.set_pref(key, value);
    Arc::new(host)
  }
  fn saw(&self, phase: Phase) -> bool {
    self.states.lock().unwrap().iter().any(|s| s.phase == phase)
  }
  fn installs(&self) -> Vec<InstallPlan> {
    self
      .quits
      .lock()
      .unwrap()
      .iter()
      .filter_map(|q| match q {
        AtExit::Install(plan) => Some(plan.clone()),
        AtExit::Relaunch(_) => None,
      })
      .collect()
  }
}

/// A folder of its own for each test, gone afterwards.
struct TempDir(PathBuf);

impl TempDir {
  fn new() -> TempDir {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let dir = std::env::temp_dir().join(format!(
      "girovo-updater-test-{}-{}",
      std::process::id(),
      NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    TempDir(dir)
  }
  fn path(&self) -> &Path {
    &self.0
  }
  fn names(&self) -> Vec<String> {
    let mut names: Vec<String> =
      std::fs::read_dir(&self.0).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    names.sort();
    names
  }
}

impl Drop for TempDir {
  fn drop(&mut self) {
    let _ = std::fs::remove_dir_all(&self.0);
  }
}

fn config(base: &str, cache: &Path) -> Config {
  let mut cfg = Config::new("4.0.0".into(), InstallKind::Nsis, cache.to_path_buf());
  cfg.feed_url = format!("{base}latest");
  cfg.origin = Origin { download_prefixes: vec![base.to_string()], ..Origin::default() };
  cfg.https_only = false;
  cfg.retry_delay = Duration::ZERO;
  cfg
}

fn make(cfg: Config, host: &Arc<FakeHost>) -> Arc<Updater> {
  Updater::new(cfg, host.clone())
}

// ---- releases -----------------------------------------------------------------------

const SETUP: &str = "Girovo-9.9.9-Setup.exe";
const PAGE: &str = RELEASES_PAGE;

fn random(n: usize, seed: u64) -> Vec<u8> {
  let mut x = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
  (0..n)
    .map(|_| {
      x ^= x << 13;
      x ^= x >> 7;
      x ^= x << 17;
      (x >> 24) as u8
    })
    .collect()
}

fn sha(bytes: &[u8]) -> String {
  Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

fn payload() -> Vec<u8> {
  random(300_000, 1)
}

struct Rel {
  tag: &'static str,
  digest: Option<String>,
  prerelease: bool,
  draft: bool,
}

fn rel(tag: &'static str) -> Rel {
  Rel { tag, digest: Some(format!("sha256:{}", sha(&payload()))), prerelease: false, draft: false }
}

fn release_json(base: &str, r: &Rel) -> Value {
  let size = payload().len();
  let asset = |name: &str| json!({ "name": name, "size": size, "digest": r.digest, "browser_download_url": format!("{base}dl/{name}") });
  json!({
    "tag_name": r.tag,
    "name": format!("Girovo {}", r.tag),
    "draft": r.draft,
    "prerelease": r.prerelease,
    "body": "## Neu\n- **Updates** direkt in der App",
    "html_url": format!("{PAGE}/tag/{}", r.tag),
    "published_at": "2026-10-10T12:00:00Z",
    "assets": [asset(SETUP)],
  })
}

/// The ordinary release: the feed, and the file exactly as announced.
fn github_like(r: Rel) -> impl Fn(&Request, &mut Conn, &str) + Send + Sync + 'static {
  let body = payload();
  move |req, conn, base| {
    if req.path == "/latest" {
      conn.json(&release_json(base, &r));
    } else if req.path.starts_with("/dl/") {
      conn.send(200, &body);
    } else {
      conn.send(404, b"");
    }
  }
}

/// GitHub with previews: 9.9.9 is the latest release; the list also has
/// 10.0.0-preview.1 and .2 (pre-releases, not in order) and a draft .3.
/// `hang`: downloads send their headers and then nothing.
fn with_previews(hang: bool) -> impl Fn(&Request, &mut Conn, &str) + Send + Sync + 'static {
  let body = payload();
  move |req, conn, base| {
    let pre = |tag| Rel { prerelease: true, ..rel(tag) };
    if req.path == "/latest" {
      conn.json(&release_json(base, &rel("9.9.9")));
    } else if req.path == "/?per_page=100" {
      conn.json(&json!([
        release_json(base, &Rel { draft: true, ..rel("10.0.0-preview.3") }),
        release_json(base, &pre("10.0.0-preview.1")),
        release_json(base, &pre("10.0.0-preview.2")),
        release_json(base, &rel("9.9.9")),
      ]));
    } else if req.path.starts_with("/dl/") {
      if hang {
        conn.head(200, &[("Content-Length", body.len().to_string())]);
        conn.hang();
      } else {
        conn.send(200, &body);
      }
    } else {
      conn.send(404, b"");
    }
  }
}

async fn wait_until(what: impl Fn() -> bool) {
  for _ in 0..200 {
    if what() {
      return;
    }
    tokio::time::sleep(Duration::from_millis(20)).await;
  }
  panic!("waited in vain");
}

// ---- the flow ---------------------------------------------------------------------------

#[tokio::test]
async fn check_download_install_then_the_new_version_greets() {
  let srv = Server::start(github_like(rel("9.9.9")));
  let cache = TempDir::new();
  let host = Arc::new(FakeHost::default());
  let updater = make(config(&srv.base, cache.path()), &host);

  let s = updater.check(true).await;
  assert_eq!(s.phase, Phase::Available);
  let release = s.release.clone().unwrap();
  assert_eq!(release.version, "9.9.9");
  assert!(release.can_install);
  assert_eq!(release.size, Some(payload().len() as u64));
  assert_eq!(release.url, format!("{PAGE}/tag/9.9.9"));
  assert!(release.notes.contains("Updates"));

  let s = updater.download().await;
  assert_eq!(s.phase, Phase::Ready);
  assert!(host.saw(Phase::Downloading), "reports the download");

  let s = updater.install().await;
  assert_eq!(s.phase, Phase::Installing);
  let installs = host.installs();
  assert_eq!(installs.len(), 1, "quits once, for the installer");
  assert_eq!(installs[0].file, cache.path().join(SETUP));
  assert_eq!(installs[0].args, ["/S", "/UPDATE", "/R", "/ARGS", "--updated", "--force-run"]);
  assert_eq!(installs[0].version, "9.9.9");
  assert_eq!(std::fs::read(&installs[0].file).unwrap(), payload());

  // The restart: the same folder, now running 9.9.9.
  let mut cfg = config(&srv.base, cache.path());
  cfg.current_version = "9.9.9".into();
  let next = make(cfg, &Arc::new(FakeHost::default()));
  next.start();
  next.stop();
  let installed = next.state().installed.unwrap();
  assert_eq!(installed.version, "9.9.9");
  assert_eq!(installed.from, "4.0.0");
  assert!(installed.notes.contains("Updates"));
  assert!(!cache.path().join("installing.json").exists(), "the marker is read once");
}

#[tokio::test]
async fn the_page_gets_the_state_in_electrons_shape() {
  let srv = Server::start(github_like(rel("9.9.9")));
  let cache = TempDir::new();
  let updater = make(config(&srv.base, cache.path()), &Arc::new(FakeHost::default()));
  let s = serde_json::to_value(updater.check(true).await).unwrap();
  let keys: Vec<&str> = s.as_object().unwrap().keys().map(String::as_str).collect();
  for key in
    ["current", "kind", "auto", "channel", "phase", "checkedAt", "release", "received", "total", "error", "installed", "failedInstall"]
  {
    assert!(keys.contains(&key), "{key}");
  }
  assert_eq!(s["kind"], "nsis");
  assert_eq!(s["channel"], "stable");
  assert_eq!(s["phase"], "available");
  assert!(s["checkedAt"].is_u64());
  assert_eq!(s["release"]["canInstall"], true);
  assert_eq!(s["release"]["publishedAt"], "2026-10-10T12:00:00.000Z");
  assert_eq!(s["release"]["back"], false);
}

#[tokio::test]
async fn an_install_that_did_not_happen_is_reported_at_the_next_start() {
  let srv = Server::start(github_like(rel("9.9.9")));
  let cache = TempDir::new();
  let updater = make(config(&srv.base, cache.path()), &Arc::new(FakeHost::default()));
  updater.check(true).await;
  updater.download().await;
  updater.install().await;

  // Still 4.0.0 after the "restart": the installer never ran through.
  let again = make(config(&srv.base, cache.path()), &Arc::new(FakeHost::default()));
  again.start();
  again.stop();
  let s = again.state();
  assert_eq!(s.installed, None);
  assert_eq!(s.failed_install.as_deref(), Some("9.9.9"));
  let error = s.error.unwrap();
  assert_eq!(error.during, During::Install);
  assert!(error.message.contains("9.9.9 wurde nicht abgeschlossen"));

  // …and the downloaded file is still good: the next check offers it at once.
  assert_eq!(again.check(false).await.phase, Phase::Ready);
}

#[tokio::test]
async fn up_to_date_same_version_and_a_dev_build_of_the_same_version() {
  let srv = Server::start(github_like(rel("4.0.0")));
  let cache = TempDir::new();
  let host = Arc::new(FakeHost::default());
  assert_eq!(make(config(&srv.base, cache.path()), &host).check(true).await.phase, Phase::Current);
  let mut cfg = config(&srv.base, cache.path());
  cfg.current_version = "4.0.0-dev.57".into();
  assert_eq!(make(cfg, &host).check(true).await.phase, Phase::Current);
}

#[tokio::test]
async fn a_file_that_does_not_match_githubs_digest_is_thrown_away() {
  let srv = Server::start(github_like(Rel { digest: Some(format!("sha256:{}", "0".repeat(64))), ..rel("9.9.9") }));
  let cache = TempDir::new();
  let updater = make(config(&srv.base, cache.path()), &Arc::new(FakeHost::default()));
  updater.check(true).await;
  let s = updater.download().await;
  assert_eq!(s.phase, Phase::Available);
  let error = s.error.unwrap();
  assert_eq!(error.during, During::Download);
  assert!(error.message.contains("Prüfsumme"));
  assert!(cache.names().is_empty());
}

#[tokio::test]
async fn a_truncated_download_fails_and_leaves_nothing_behind() {
  let body = payload();
  let srv = Server::start(move |req, conn, base| {
    if req.path == "/latest" {
      conn.json(&release_json(base, &rel("9.9.9")));
    } else {
      // Announces the whole file, sends a third, hangs up.
      conn.head(200, &[("Content-Length", body.len().to_string())]);
      conn.write(&body[..100_000]);
    }
  });
  let cache = TempDir::new();
  let updater = make(config(&srv.base, cache.path()), &Arc::new(FakeHost::default()));
  updater.check(true).await;
  let s = updater.download().await;
  assert_eq!(s.phase, Phase::Available);
  assert!(s.error.unwrap().message.contains("Verbindung zu GitHub ist abgebrochen"));
  assert!(cache.names().is_empty());
}

#[tokio::test]
async fn a_download_can_be_cancelled_quietly() {
  let started = Arc::new(AtomicUsize::new(0));
  let seen = started.clone();
  let body = payload();
  let srv = Server::start(move |req, conn, base| {
    if req.path == "/latest" {
      conn.json(&release_json(base, &rel("9.9.9")));
    } else {
      // A slow file: a first chunk, then nothing until the client gives up.
      conn.head(200, &[("Content-Length", body.len().to_string())]);
      conn.write(&body[..1000]);
      conn.hang();
      seen.fetch_add(1, Ordering::SeqCst);
    }
  });
  let cache = TempDir::new();
  let host = Arc::new(FakeHost::default());
  let updater = make(config(&srv.base, cache.path()), &host);
  updater.check(true).await;
  let job = updater.begin_download().unwrap();
  let running = tokio::spawn(job.run());
  wait_until(|| started.load(Ordering::SeqCst) > 0).await;
  assert!(host.saw(Phase::Downloading));
  updater.cancel();
  let s = running.await.unwrap();
  assert_eq!(s.phase, Phase::Available);
  assert_eq!(s.error, None);
  assert!(cache.names().is_empty());
}

#[tokio::test]
async fn githubs_rate_limit_a_manual_check_says_so_an_automatic_one_stays_quiet() {
  let srv = Server::start(|_req, conn, _base| conn.send(403, br#"{"message":"API rate limit exceeded"}"#));
  let cache = TempDir::new();
  let host = Arc::new(FakeHost::default());
  let manual = make(config(&srv.base, cache.path()), &host).check(true).await;
  assert_eq!(manual.phase, Phase::Idle);
  assert!(manual.error.unwrap().message.contains("keine weiteren Anfragen"));
  let auto = make(config(&srv.base, cache.path()), &host).check(false).await;
  assert_eq!(auto.phase, Phase::Idle);
  assert_eq!(auto.error, None);
}

#[tokio::test]
async fn nothing_published_yet_counts_as_up_to_date_nonsense_does_not() {
  let nonsense = Arc::new(AtomicUsize::new(0));
  let flag = nonsense.clone();
  let srv = Server::start(move |_req, conn, _base| {
    if flag.load(Ordering::SeqCst) == 0 {
      conn.send(404, b"");
    } else {
      conn.head(200, &[("Content-Type", "application/json".into()), ("Content-Length", "6".into())]);
      conn.write(b"<html>");
    }
  });
  let cache = TempDir::new();
  let host = Arc::new(FakeHost::default());
  assert_eq!(make(config(&srv.base, cache.path()), &host).check(true).await.phase, Phase::Current);
  nonsense.store(1, Ordering::SeqCst);
  let s = make(config(&srv.base, cache.path()), &host).check(true).await;
  assert_eq!(s.phase, Phase::Idle);
  assert!(s.error.unwrap().message.contains("unverständlich"));
}

#[tokio::test]
async fn without_a_digest_the_release_is_only_offered_as_a_download_page() {
  let srv = Server::start(github_like(Rel { digest: None, ..rel("9.9.9") }));
  let cache = TempDir::new();
  let host = Arc::new(FakeHost::default());
  let updater = make(config(&srv.base, cache.path()), &host);
  let s = updater.check(true).await;
  assert_eq!(s.phase, Phase::Available);
  assert!(!s.release.unwrap().can_install);
  assert!(updater.begin_download().is_none(), "refuses to download");
  assert_eq!(updater.download().await.phase, Phase::Available);
  updater.open_release();
  assert_eq!(*host.opened.lock().unwrap(), [format!("{PAGE}/tag/9.9.9")]);
}

#[tokio::test]
async fn an_unpacked_build_or_a_linux_package_gets_the_page_never_a_download() {
  let srv = Server::start(github_like(rel("9.9.9")));
  let cache = TempDir::new();
  let mut cfg = config(&srv.base, cache.path());
  cfg.kind = InstallKind::Manual;
  let updater = make(cfg, &Arc::new(FakeHost::default()));
  let s = updater.check(true).await;
  let release = s.release.unwrap();
  assert!(!release.can_install);
  assert_eq!(release.size, None);
  assert_eq!(updater.download().await.phase, Phase::Available);
  assert_eq!(updater.install().await.phase, Phase::Available);
}

#[tokio::test]
async fn a_file_changed_after_the_download_is_not_run() {
  let srv = Server::start(github_like(rel("9.9.9")));
  let cache = TempDir::new();
  let host = Arc::new(FakeHost::default());
  let updater = make(config(&srv.base, cache.path()), &host);
  updater.check(true).await;
  assert_eq!(updater.download().await.phase, Phase::Ready);
  // One byte changed, same size: only the digest can tell.
  let file = cache.path().join(SETUP);
  let mut tampered = payload();
  tampered[10] ^= 0xff;
  std::fs::write(&file, tampered).unwrap();
  let s = updater.install().await;
  assert!(host.quits.lock().unwrap().is_empty(), "does not quit");
  assert_eq!(s.phase, Phase::Available);
  assert_eq!(s.error.unwrap().during, During::Install);
  assert!(!file.exists(), "the bad file is removed");
  assert!(!cache.path().join("installing.json").exists(), "no marker for an install that does not start");
}

#[tokio::test]
async fn the_automatic_check_is_a_stored_preference_on_by_default() {
  let cache = TempDir::new();
  let host = Arc::new(FakeHost::default());
  let updater = make(config("http://127.0.0.1:9/", cache.path()), &host);
  assert!(updater.state().auto);
  updater.set_auto(false);
  assert_eq!(host.pref(PREF_AUTO).as_deref(), Some("off"));
  assert!(!updater.state().auto);
  updater.set_auto(true);
  updater.stop();
  assert_eq!(host.pref(PREF_AUTO).as_deref(), Some("on"));
  assert!(!make(config("http://127.0.0.1:9/", cache.path()), &FakeHost::with_pref(PREF_AUTO, "off")).state().auto);
}

// ---- channels ------------------------------------------------------------------------

#[tokio::test]
async fn the_channel_is_a_stored_preference_stable_unless_it_says_preview() {
  let cache = TempDir::new();
  let stored = |v| make(config("http://127.0.0.1:9/", cache.path()), &FakeHost::with_pref(PREF_CHANNEL, v)).state().channel;
  assert_eq!(make(config("http://127.0.0.1:9/", cache.path()), &Arc::new(FakeHost::default())).state().channel, super::logic::Channel::Stable);
  assert_eq!(stored("preview"), super::logic::Channel::Preview);
  assert_eq!(stored("nightly"), super::logic::Channel::Stable);
}

#[tokio::test]
async fn stable_reads_the_latest_release_preview_the_newest_pre_release_in_the_list() {
  let srv = Server::start(with_previews(false));
  let cache = TempDir::new();
  let stable = make(config(&srv.base, cache.path()), &Arc::new(FakeHost::default())).check(true).await;
  assert_eq!(stable.release.unwrap().version, "9.9.9");
  let preview = make(config(&srv.base, cache.path()), &FakeHost::with_pref(PREF_CHANNEL, "preview")).check(true).await;
  assert_eq!(preview.phase, Phase::Available);
  let release = preview.release.unwrap();
  assert_eq!(release.version, "10.0.0-preview.2", "the highest, never the draft");
  assert!(release.can_install);
}

#[tokio::test]
async fn switching_the_channel_asks_again_a_preview_is_offered_and_dropped_on_the_way_back() {
  let srv = Server::start(with_previews(false));
  let cache = TempDir::new();
  let host = Arc::new(FakeHost::default());
  let mut cfg = config(&srv.base, cache.path());
  cfg.current_version = "9.9.9".into();
  let updater = make(cfg, &host);
  assert_eq!(updater.check(true).await.phase, Phase::Current);

  let s = updater.set_channel("preview").await;
  assert_eq!(host.pref(PREF_CHANNEL).as_deref(), Some("preview"));
  assert_eq!(s.channel, super::logic::Channel::Preview);
  assert_eq!(s.phase, Phase::Available);
  assert_eq!(s.release.unwrap().version, "10.0.0-preview.2");
  assert_eq!(updater.download().await.phase, Phase::Ready);

  let s = updater.set_channel("stable").await;
  assert_eq!(host.pref(PREF_CHANNEL).as_deref(), Some("stable"));
  assert_eq!(s.channel, super::logic::Channel::Stable);
  assert_eq!(s.phase, Phase::Current);
  assert_eq!(s.release, None);
  assert!(!cache.path().join(SETUP).exists(), "the preview's installer is gone");
}

#[tokio::test]
async fn back_on_stable_from_a_preview_the_latest_stable_release_is_offered_as_the_way_back() {
  let srv = Server::start(with_previews(false));
  let cache = TempDir::new();
  let host = FakeHost::with_pref(PREF_CHANNEL, "preview");
  let mut cfg = config(&srv.base, cache.path());
  cfg.current_version = "10.0.0-preview.1".into();
  let updater = make(cfg, &host);
  let s = updater.check(true).await;
  let release = s.release.unwrap();
  assert_eq!(release.version, "10.0.0-preview.2");
  assert!(!release.back);
  // Back to stable: checked again at once, 9.9.9 offered though it is older.
  let s = updater.set_channel("stable").await;
  assert_eq!(s.phase, Phase::Available);
  let release = s.release.unwrap();
  assert_eq!(release.version, "9.9.9");
  assert!(release.back);
  assert_eq!(updater.download().await.phase, Phase::Ready);
  updater.install().await;
  assert_eq!(host.installs().len(), 1, "its installer runs like an update's");
}

#[tokio::test]
async fn the_shell_hears_of_an_install_before_it_quits_and_whether_it_goes_back() {
  let srv = Server::start(with_previews(false));
  let cache = TempDir::new();
  let heard: Arc<Mutex<Vec<(InstallNotice, usize)>>> = Arc::default();
  for go_back in [false, true] {
    let host = FakeHost::with_pref(PREF_CHANNEL, "preview");
    let mut cfg = config(&srv.base, cache.path());
    cfg.current_version = "10.0.0-preview.1".into();
    let updater = make(cfg, &host);
    let (list, seen) = (heard.clone(), host.clone());
    updater.on_before_install(move |n| list.lock().unwrap().push((n.clone(), seen.quits.lock().unwrap().len())));
    if go_back {
      updater.set_channel("stable").await;
    } else {
      updater.check(true).await;
    }
    updater.download().await;
    updater.install().await;
  }
  let heard = heard.lock().unwrap();
  assert_eq!(heard[0], (InstallNotice { version: "10.0.0-preview.2".into(), back: false }, 0));
  // The way back to stable (another start): told so, before the app quits.
  assert_eq!(heard[1], (InstallNotice { version: "9.9.9".into(), back: true }, 0));
}

#[tokio::test]
async fn a_stable_install_on_stable_is_never_offered_an_older_release() {
  let srv = Server::start(github_like(rel("9.9.9")));
  let cache = TempDir::new();
  let mut cfg = config(&srv.base, cache.path());
  cfg.current_version = "10.0.0".into();
  assert_eq!(make(cfg, &Arc::new(FakeHost::default())).check(true).await.phase, Phase::Current);
}

#[tokio::test]
async fn githubs_passing_502_503_or_504_is_asked_once_more_a_second_one_is_the_answer() {
  let failures = Arc::new(AtomicUsize::new(2));
  let left = failures.clone();
  let ordinary = github_like(rel("9.9.9"));
  let srv = Server::start(move |req, conn, base| {
    let n = left.load(Ordering::SeqCst);
    if req.path == "/latest" && n > 0 {
      left.store(n - 1, Ordering::SeqCst);
      conn.send(if n == 2 { 502 } else { 503 }, b"");
      return;
    }
    ordinary(req, conn, base);
  });
  let cache = TempDir::new();
  let updater = make(config(&srv.base, cache.path()), &Arc::new(FakeHost::default()));
  let s = updater.check(true).await;
  assert_eq!(s.phase, Phase::Idle, "two in a row: the check fails");
  assert!(s.error.unwrap().message.contains("HTTP 503"));
  failures.store(1, Ordering::SeqCst);
  let s = updater.check(true).await;
  assert_eq!(s.phase, Phase::Available, "one: the second ask brings the release");
  assert_eq!(s.release.unwrap().version, "9.9.9");
}

#[tokio::test]
async fn switching_the_channel_stops_a_download_of_the_other_ones_release() {
  let srv = Server::start(with_previews(true));
  let cache = TempDir::new();
  let host = Arc::new(FakeHost::default());
  let mut cfg = config(&srv.base, cache.path());
  cfg.current_version = "9.0.0".into();
  let updater = make(cfg, &host);
  updater.check(true).await;
  let running = tokio::spawn(updater.begin_download().unwrap().run());
  assert_eq!(updater.state().phase, Phase::Downloading);
  // Give the request time to reach the server and hang there.
  tokio::time::sleep(Duration::from_millis(200)).await;
  let s = updater.set_channel("preview").await;
  assert_eq!(running.await.unwrap().channel, super::logic::Channel::Preview);
  assert_eq!(s.phase, Phase::Available);
  assert_eq!(s.release.unwrap().version, "10.0.0-preview.2");
  assert_eq!(s.error, None);
  assert!(cache.names().iter().all(|n| !n.ends_with(".partial")));
}

#[tokio::test]
async fn an_install_of_a_preview_that_did_not_happen_is_reported_at_the_next_start() {
  let srv = Server::start(with_previews(false));
  let cache = TempDir::new();
  let preview = |version: &str| {
    let mut cfg = config(&srv.base, cache.path());
    cfg.current_version = version.into();
    make(cfg, &FakeHost::with_pref(PREF_CHANNEL, "preview"))
  };
  let updater = preview("9.9.9");
  updater.check(true).await;
  updater.download().await;
  updater.install().await;

  let again = preview("9.9.9");
  again.start();
  again.stop();
  assert_eq!(again.state().failed_install.as_deref(), Some("10.0.0-preview.2"));

  // And the start that is the preview greets it.
  let second = preview("9.9.9");
  second.check(true).await;
  second.download().await;
  second.install().await;
  let next = preview("10.0.0-preview.2");
  next.start();
  next.stop();
  assert_eq!(next.state().installed.unwrap().version, "10.0.0-preview.2");
}

#[tokio::test]
async fn the_marker_of_an_electron_install_is_read_too() {
  // What the Electron shell's updater.cjs writes before it runs the first Tauri Setup.exe.
  let cache = TempDir::new();
  let marker = json!({
    "from": "5.16.2", "to": "6.0.0", "at": 1, "notes": "## Neu", "url": format!("{PAGE}/tag/6.0.0"), "previousFile": null,
  });
  std::fs::write(cache.path().join("installing.json"), marker.to_string()).unwrap();
  let mut cfg = config("http://127.0.0.1:9/", cache.path());
  cfg.current_version = "6.0.0".into();
  let updater = make(cfg, &Arc::new(FakeHost::default()));
  updater.start();
  updater.stop();
  let installed = updater.state().installed.unwrap();
  assert_eq!((installed.from.as_str(), installed.url.as_str()), ("5.16.2", format!("{PAGE}/tag/6.0.0").as_str()));
}

#[tokio::test]
async fn restart_to_update_starts_again_with_update_only_the_installed_app() {
  let cache = TempDir::new();
  let host = Arc::new(FakeHost::default());
  let updater = make(config("http://127.0.0.1:9/", cache.path()), &host);
  updater.restart_to_update(["--background".to_string(), "--update".into(), "--updated".into()]);
  assert_eq!(*host.quits.lock().unwrap(), [AtExit::Relaunch(vec!["--updated".into(), "--update".into()])]);
  let mut cfg = config("http://127.0.0.1:9/", cache.path());
  cfg.kind = InstallKind::Manual;
  let manual = Arc::new(FakeHost::default());
  make(cfg, &manual).restart_to_update([]);
  assert!(manual.quits.lock().unwrap().is_empty());
}

// ---- once the app has quit --------------------------------------------------------------

#[test]
fn at_exit_the_installer_starts_and_the_install_window_hears_of_it() {
  let plan = InstallPlan { file: PathBuf::from("C:/cache/Girovo-9.9.9-Setup.exe"), args: vec!["/S".into()], version: "9.9.9".into() };
  let spawned = Mutex::new(Vec::new());
  let mut told = None;
  run_at_exit(
    AtExit::Install(plan.clone()),
    Some(Path::new("C:/Girovo/Girovo.exe")),
    |file, args| {
      spawned.lock().unwrap().push((file.to_path_buf(), args.to_vec()));
      Ok(4242)
    },
    |pid, p| told = Some((pid, p.version.clone())),
  );
  assert_eq!(*spawned.lock().unwrap(), [(plan.file.clone(), plan.args.clone())]);
  assert_eq!(told, Some((4242, "9.9.9".into())));
}

#[test]
fn at_exit_an_installer_that_does_not_start_brings_the_app_back() {
  let plan = InstallPlan { file: PathBuf::from("C:/cache/Girovo-9.9.9-Setup.exe"), args: vec![], version: "9.9.9".into() };
  let spawned = Mutex::new(Vec::new());
  let mut told = false;
  run_at_exit(
    AtExit::Install(plan),
    Some(Path::new("C:/Girovo/Girovo.exe")),
    |file, _args| {
      spawned.lock().unwrap().push(file.to_path_buf());
      if file.ends_with("Girovo-9.9.9-Setup.exe") { Err(std::io::Error::from_raw_os_error(32)) } else { Ok(1) }
    },
    |_, _| told = true,
  );
  assert_eq!(spawned.lock().unwrap()[1], PathBuf::from("C:/Girovo/Girovo.exe"), "the app comes back");
  assert!(!told);
}

#[test]
fn at_exit_a_restart_starts_the_app_with_its_arguments() {
  let spawned = Mutex::new(Vec::new());
  run_at_exit(
    AtExit::Relaunch(vec!["--update".into()]),
    Some(Path::new("C:/Girovo/Girovo.exe")),
    |file, args| {
      spawned.lock().unwrap().push((file.to_path_buf(), args.to_vec()));
      Ok(1)
    },
    |_, _| {},
  );
  assert_eq!(*spawned.lock().unwrap(), [(PathBuf::from("C:/Girovo/Girovo.exe"), vec!["--update".to_string()])]);
}

// ---- the update at start -------------------------------------------------------------------

#[derive(Default)]
struct FakeWindow {
  log: Mutex<Vec<String>>,
  progress: Mutex<Vec<f64>>,
}

impl StartWindow for FakeWindow {
  fn step(&self, key: &'static str) {
    self.log.lock().unwrap().push(format!("step {key}"));
  }
  fn set_checks(&self, on: bool) {
    self.log.lock().unwrap().push(format!("checks {on}"));
  }
  fn set_update(&self, version: Option<String>) {
    self.log.lock().unwrap().push(format!("update {}", version.unwrap_or_default()));
  }
  fn progress(&self, percent: f64) {
    self.progress.lock().unwrap().push(percent);
  }
}

#[tokio::test]
async fn at_start_a_newer_release_is_checked_downloaded_and_installed_with_the_window_saying_so() {
  let srv = Server::start(github_like(rel("9.9.9")));
  let cache = TempDir::new();
  let host = Arc::new(FakeHost::default());
  let updater = make(config(&srv.base, cache.path()), &host);
  let window = FakeWindow::default();
  let check = updater.start_check(&window);
  assert!(check.is_some());
  assert!(updater.update_at_start(check, &window).await);
  assert_eq!(
    *window.log.lock().unwrap(),
    ["checks true", "step checking", "update 9.9.9", "step downloading", "step installing"]
  );
  assert!(window.progress.lock().unwrap().iter().all(|p| (0.0..=100.0).contains(p)));
  assert_eq!(host.installs().len(), 1);
}

#[tokio::test]
async fn at_start_nothing_new_a_switch_turned_off_or_a_linux_package_opens_girovo_as_always() {
  let srv = Server::start(github_like(rel("4.0.0")));
  let cache = TempDir::new();
  let window = FakeWindow::default();
  let current = make(config(&srv.base, cache.path()), &Arc::new(FakeHost::default()));
  let check = current.start_check(&window);
  assert!(!current.update_at_start(check, &window).await);

  let off = make(config(&srv.base, cache.path()), &FakeHost::with_pref(PREF_AUTO, "off"));
  assert!(off.start_check(&window).is_none());
  let mut cfg = config(&srv.base, cache.path());
  cfg.kind = InstallKind::Manual;
  assert!(make(cfg, &Arc::new(FakeHost::default())).start_check(&window).is_none());
  // Asked for (--update), even with the switch off.
  let mut cfg = config(&srv.base, cache.path());
  cfg.update_asked = true;
  assert!(make(cfg, &FakeHost::with_pref(PREF_AUTO, "off")).start_check(&window).is_some());
}

#[tokio::test]
async fn at_start_the_way_back_only_when_it_was_asked_for() {
  let srv = Server::start(with_previews(false));
  let cache = TempDir::new();
  for asked in [false, true] {
    let host = Arc::new(FakeHost::default());
    let mut cfg = config(&srv.base, cache.path());
    cfg.current_version = "10.0.0-preview.1".into();
    cfg.update_asked = asked;
    let updater = make(cfg, &host);
    let window = FakeWindow::default();
    let check = updater.start_check(&window);
    assert_eq!(updater.update_at_start(check, &window).await, asked);
    assert_eq!(host.installs().len(), usize::from(asked));
  }
}

// ---- differential downloads -------------------------------------------------------------------

/// What is installed: Girovo.exe and the model (small stand-ins, a few chunks each).
fn old_exe() -> Vec<u8> {
  random(500_000, 2)
}
fn model() -> Vec<u8> {
  random(1_200_000, 3)
}

/// The next release's Girovo.exe: one piece rewritten, one inserted.
fn new_exe() -> Vec<u8> {
  let old = old_exe();
  let mut exe = old[..150_000].to_vec();
  exe.extend(random(6_000, 4));
  exe.extend_from_slice(&old[156_000..380_000]);
  exe.extend(random(3_000, 5));
  exe.extend_from_slice(&old[380_000..]);
  exe
}

/// The next uncompressed Setup.exe: NSIS's own part, the files as they are, its tail.
fn new_setup() -> Vec<u8> {
  let mut setup = random(30_000, 6);
  setup.extend(new_exe());
  setup.extend(model());
  setup.extend(random(1_000, 7));
  setup
}

fn gzip(json: &Value) -> Vec<u8> {
  let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
  gz.write_all(json.to_string().as_bytes()).unwrap();
  gz.finish().unwrap()
}

fn install_dir(exe: &[u8], model_bytes: &[u8]) -> TempDir {
  let dir = TempDir::new();
  std::fs::write(dir.path().join("Girovo.exe"), exe).unwrap();
  std::fs::create_dir_all(dir.path().join("models")).unwrap();
  std::fs::write(dir.path().join("models").join("model.onnx"), model_bytes).unwrap();
  dir
}

#[derive(Default)]
struct Served {
  bytes: AtomicU64,
  requests: AtomicU64,
  ranged: AtomicU64,
}

struct Diff {
  next: Vec<u8>,
  map: Option<Value>,
  ranges: bool,
  hang_ranges: bool,
}

fn diff() -> Diff {
  let next = new_setup();
  Diff { map: Some(chunks::blockmap_json(&next)), next, ranges: true, hang_ranges: false }
}

/// GitHub with a blockmap beside the 9.9.9 Setup.exe. Downloads honour single
/// byte ranges unless `ranges` is false; `served` counts what went out of the installer.
fn diff_server(d: Diff) -> (Server, Arc<Served>) {
  let served = Arc::new(Served::default());
  let count = served.clone();
  let map = d.map.as_ref().map(gzip);
  let next = d.next;
  let srv = Server::start(move |req, conn, base| {
    let mut files: Vec<(String, &[u8])> = vec![(SETUP.into(), &next)];
    if let Some(m) = &map {
      files.push((format!("{SETUP}.blockmap"), m));
    }
    if req.path == "/latest" {
      let assets: Vec<Value> = files
        .iter()
        .map(|(name, body)| json!({ "name": name, "size": body.len(), "digest": format!("sha256:{}", sha(body)), "browser_download_url": format!("{base}dl/{name}") }))
        .collect();
      let mut r = release_json(base, &rel("9.9.9"));
      r["assets"] = Value::Array(assets);
      conn.json(&r);
      return;
    }
    let Some((name, body)) = files.iter().find(|(n, _)| req.path == format!("/dl/{n}")) else {
      conn.send(404, b"");
      return;
    };
    let setup = name == SETUP;
    if setup {
      count.requests.fetch_add(1, Ordering::SeqCst);
    }
    let range = req.headers.get("range").and_then(|r| r.strip_prefix("bytes=")).and_then(|r| r.split_once('-'));
    match range {
      Some((a, b)) if d.ranges => {
        let (start, end): (usize, usize) = (a.parse().unwrap(), b.parse().unwrap());
        if setup {
          count.ranged.fetch_add(1, Ordering::SeqCst);
          count.bytes.fetch_add((end - start + 1) as u64, Ordering::SeqCst);
        }
        conn.head(206, &[
          ("Content-Range", format!("bytes {start}-{end}/{}", body.len())),
          ("Content-Length", (end - start + 1).to_string()),
        ]);
        if d.hang_ranges {
          conn.hang();
        } else {
          conn.write(&body[start..=end]);
        }
      }
      _ => {
        if setup {
          count.bytes.fetch_add(body.len() as u64, Ordering::SeqCst);
        }
        conn.send(200, body);
      }
    }
  });
  (srv, served)
}

fn diff_config(base: &str, cache: &Path, install: &Path) -> Config {
  let mut cfg = config(base, cache);
  cfg.install_dir = Some(install.to_path_buf());
  cfg
}

#[tokio::test]
async fn differential_only_what_is_not_installed_is_downloaded() {
  let (srv, served) = diff_server(diff());
  let (cache, install) = (TempDir::new(), install_dir(&old_exe(), &model()));
  let host = Arc::new(FakeHost::default());
  let updater = make(diff_config(&srv.base, cache.path(), install.path()), &host);
  let s = updater.check(true).await;
  assert_eq!(s.phase, Phase::Available);
  let offered = s.release.unwrap().size.unwrap();
  let whole = new_setup().len() as u64;
  assert!(offered < whole / 3, "offers the smaller download: {offered} of {whole}");

  let s = updater.download().await;
  assert_eq!(s.phase, Phase::Ready);
  assert_eq!(std::fs::read(cache.path().join(SETUP)).unwrap(), new_setup());
  assert_eq!(served.bytes.load(Ordering::SeqCst), offered, "fetched what it offered");
  assert_eq!(served.ranged.load(Ordering::SeqCst), served.requests.load(Ordering::SeqCst), "nothing but range requests");
  let first = host.states.lock().unwrap().iter().find(|s| s.phase == Phase::Downloading).unwrap().total;
  assert_eq!(first, offered);

  // Installs like any download.
  updater.install().await;
  assert_eq!(host.installs()[0].file, cache.path().join(SETUP));
}

#[tokio::test]
async fn differential_a_server_that_ignores_ranges_means_the_whole_file() {
  let (srv, _served) = diff_server(Diff { ranges: false, ..diff() });
  let (cache, install) = (TempDir::new(), install_dir(&old_exe(), &model()));
  let updater = make(diff_config(&srv.base, cache.path(), install.path()), &Arc::new(FakeHost::default()));
  updater.check(true).await;
  let s = updater.download().await;
  assert_eq!(s.phase, Phase::Ready);
  assert_eq!(s.error, None);
  assert_eq!(s.release.unwrap().size, Some(new_setup().len() as u64), "now says what it really took");
  assert_eq!(std::fs::read(cache.path().join(SETUP)).unwrap(), new_setup());
}

#[tokio::test]
async fn differential_a_lying_blockmap_is_caught_by_the_digest_then_the_whole_file() {
  // Claims the installer starts with the model's first bytes: the assembled file cannot match.
  let mut fake = model()[..30_000].to_vec();
  fake.extend_from_slice(&new_setup()[30_000..]);
  let (srv, served) = diff_server(Diff { map: Some(chunks::blockmap_json(&fake)), ..diff() });
  let (cache, install) = (TempDir::new(), install_dir(&old_exe(), &model()));
  let updater = make(diff_config(&srv.base, cache.path(), install.path()), &Arc::new(FakeHost::default()));
  let offered = updater.check(true).await.release.unwrap().size.unwrap();
  let s = updater.download().await;
  assert_eq!(s.phase, Phase::Ready);
  assert_eq!(std::fs::read(cache.path().join(SETUP)).unwrap(), new_setup());
  assert_eq!(served.bytes.load(Ordering::SeqCst), offered + new_setup().len() as u64, "the ranges, then the whole file");
  assert_eq!(cache.names(), [SETUP], "no half-built file left over");
}

#[tokio::test]
async fn differential_an_installed_file_changed_after_the_plan_is_caught_by_the_digest() {
  let (srv, _served) = diff_server(diff());
  let (cache, install) = (TempDir::new(), install_dir(&old_exe(), &model()));
  let updater = make(diff_config(&srv.base, cache.path(), install.path()), &Arc::new(FakeHost::default()));
  updater.check(true).await;
  let mut changed = model();
  changed[200_000] ^= 0xff;
  std::fs::write(install.path().join("models").join("model.onnx"), changed).unwrap();
  assert_eq!(updater.download().await.phase, Phase::Ready);
  assert_eq!(std::fs::read(cache.path().join(SETUP)).unwrap(), new_setup());
}

#[tokio::test]
async fn differential_without_a_blockmap_an_install_folder_or_with_one_cut_otherwise_the_whole_file() {
  let whole = new_setup().len() as u64;
  let install = install_dir(&old_exe(), &model());
  let cache = TempDir::new();
  let size_for = |srv: &Server, dir: Option<&Path>| {
    let mut cfg = config(&srv.base, cache.path());
    cfg.install_dir = dir.map(Path::to_path_buf);
    make(cfg, &Arc::new(FakeHost::default()))
  };
  let (no_map, _) = diff_server(Diff { map: None, ..diff() });
  assert_eq!(size_for(&no_map, Some(install.path())).check(true).await.release.unwrap().size, Some(whole), "no blockmap");
  let (srv, _) = diff_server(diff());
  assert_eq!(size_for(&srv, None).check(true).await.release.unwrap().size, Some(whole), "no install folder");
  // electron-builder's blockmap (a 5.x release, the way back): its chunks are cut otherwise.
  let mut electron = chunks::blockmap_json(&new_setup());
  electron.as_object_mut().unwrap().remove("chunker");
  let (eb, served) = diff_server(Diff { map: Some(electron), ..diff() });
  let updater = size_for(&eb, Some(install.path()));
  assert_eq!(updater.check(true).await.release.unwrap().size, Some(whole), "electron-builder's blockmap");
  assert_eq!(updater.download().await.phase, Phase::Ready);
  assert_eq!(served.ranged.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn differential_a_release_that_changes_girovo_exe_throughout_still_reuses_the_model() {
  let mut next = random(30_000, 6);
  next.extend(random(500_000, 99));
  next.extend(model());
  let (srv, served) = diff_server(Diff { map: Some(chunks::blockmap_json(&next)), next: next.clone(), ranges: true, hang_ranges: false });
  let (cache, install) = (TempDir::new(), install_dir(&old_exe(), &model()));
  let updater = make(diff_config(&srv.base, cache.path(), install.path()), &Arc::new(FakeHost::default()));
  let offered = updater.check(true).await.release.unwrap().size.unwrap();
  assert!(offered < (530_000 + model().len() / 10) as u64, "{offered}: the model is not fetched");
  assert_eq!(updater.download().await.phase, Phase::Ready);
  assert_eq!(std::fs::read(cache.path().join(SETUP)).unwrap(), next);
  assert_eq!(served.ranged.load(Ordering::SeqCst), served.requests.load(Ordering::SeqCst));
}

#[tokio::test]
async fn differential_with_nothing_in_common_the_plain_whole_download() {
  let (srv, served) = diff_server(diff());
  let (cache, install) = (TempDir::new(), install_dir(&random(500_000, 50), &random(1_200_000, 51)));
  let updater = make(diff_config(&srv.base, cache.path(), install.path()), &Arc::new(FakeHost::default()));
  assert_eq!(updater.check(true).await.release.unwrap().size, Some(new_setup().len() as u64));
  assert_eq!(updater.download().await.phase, Phase::Ready);
  assert_eq!(served.ranged.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn differential_cancelling_stops_it_no_whole_download_behind_it() {
  let (srv, served) = diff_server(Diff { hang_ranges: true, ..diff() });
  let (cache, install) = (TempDir::new(), install_dir(&old_exe(), &model()));
  let updater = make(diff_config(&srv.base, cache.path(), install.path()), &Arc::new(FakeHost::default()));
  updater.check(true).await;
  let running = tokio::spawn(updater.begin_download().unwrap().run());
  let s = served.clone();
  wait_until(move || s.ranged.load(Ordering::SeqCst) > 0).await;
  updater.cancel();
  let state = running.await.unwrap();
  assert_eq!(state.phase, Phase::Available);
  assert_eq!(state.error, None);
  assert_eq!(served.ranged.load(Ordering::SeqCst), served.requests.load(Ordering::SeqCst), "no whole download was started");
  assert!(cache.names().is_empty());
}

// ---- against the real GitHub ---------------------------------------------------------------

/// What each channel offers a few installed versions today — read-only, no
/// installer downloaded (cargo test --lib live_github -- --ignored
/// --nocapture). Eight API requests of the sixty an hour GitHub allows
/// without an account, and one blockmap: the case with an install folder
/// fetches 5.16.2's (electron-builder's) and turns it down.
#[tokio::test]
#[ignore = "asks the real GitHub"]
async fn live_github_dry_run() {
  let install = install_dir(&old_exe(), &model());
  for current in ["5.16.2", "5.16.1", "6.0.0-preview.1", "6.0.0-preview.202611061124.g58e5a57"] {
    for channel in ["stable", "preview"] {
      let cache = TempDir::new();
      let mut cfg = Config::new(current.into(), InstallKind::Nsis, cache.path().to_path_buf());
      if current == "5.16.1" && channel == "stable" {
        cfg.install_dir = Some(install.path().to_path_buf());
      }
      let updater = Updater::new(cfg, FakeHost::with_pref(PREF_CHANNEL, channel));
      let s = updater.check(true).await;
      let offer = s.release.as_ref().map_or("-".to_string(), |r| {
        format!("{} back={} canInstall={} size={:?} published={:?}", r.version, r.back, r.can_install, r.size, r.published_at)
      });
      eprintln!("LIVE {current:<36} {channel:<8} {:?} {offer} {:?}", s.phase, s.error.map(|e| e.message));
      assert_ne!(s.phase, Phase::Idle, "GitHub answered");
    }
  }
}
