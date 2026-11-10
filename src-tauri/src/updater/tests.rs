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
use super::logic::{Channel, InstallKind, Origin, RELEASES_PAGE};
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
  /// A copy whose channel is `value` by its own choice: moved back to Stabil
  /// once already (logic::moves_to_stable), so a release build keeps it.
  fn on_channel(value: &str) -> Arc<FakeHost> {
    let host = FakeHost::with_pref(PREF_CHANNEL, value);
    host.set_pref(PREF_MOVED_TO_STABLE, "6.0.0");
    host
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
  // The stand-in is GitHub as it was: no girovo.de, no signed releases (tests_v2 below has those).
  cfg.manifest_base = None;
  cfg.require_signed = false;
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
  assert!(error.message.contains("9.9.9 hat nicht geklappt"));

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
  assert!(error.message.contains("Das Update war beschädigt"));
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
  assert!(s.error.unwrap().message.contains("Verbindung ist abgebrochen"));
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
  assert!(manual.error.unwrap().message.contains("Suche nach Updates geht gerade nicht"));
  let auto = make(config(&srv.base, cache.path()), &host).check(false).await;
  assert_eq!(auto.phase, Phase::Idle);
  assert_eq!(auto.error, None);
}

#[tokio::test]
async fn a_release_start_takes_a_nightly_copy_back_to_stable_once() {
  let srv = Server::start(|_req, conn, _base| conn.send(404, b"{}"));
  let cache = TempDir::new();
  let host = Arc::new(FakeHost::default());
  host.set_pref(PREF_CHANNEL, "preview");
  // A nightly keeps its channel.
  let mut nightly = config(&srv.base, cache.path());
  nightly.current_version = "6.0.0-nightly.202611071435.gfe8c9a6".into();
  assert_eq!(make(nightly, &host).state().channel, Channel::Preview);
  assert_eq!(host.pref(PREF_MOVED_TO_STABLE), None);
  // The release moves it, and says which release did.
  let release = || {
    let mut c = config(&srv.base, cache.path());
    c.current_version = "6.0.0".into();
    c
  };
  assert_eq!(make(release(), &host).state().channel, Channel::Stable);
  assert_eq!(host.pref(PREF_CHANNEL).as_deref(), Some("stable"));
  assert_eq!(host.pref(PREF_MOVED_TO_STABLE).as_deref(), Some("6.0.0"));
  // Nightly picked again afterwards: it stays.
  host.set_pref(PREF_CHANNEL, "preview");
  assert_eq!(make(release(), &host).state().channel, Channel::Preview);
}

#[tokio::test]
async fn githubs_rate_limit_names_when_it_takes_requests_again() {
  let srv = Server::start(|_req, conn, _base| {
    let body = br#"{"message":"API rate limit exceeded"}"#;
    let reset = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() + 31 * 60 - 5;
    conn.head(403, &[
      ("Content-Length", body.len().to_string()),
      ("X-RateLimit-Remaining", "0".into()),
      ("X-RateLimit-Reset", reset.to_string()),
    ]);
    conn.write(body);
  });
  let cache = TempDir::new();
  let host = Arc::new(FakeHost::default());
  let manual = make(config(&srv.base, cache.path()), &host).check(true).await;
  assert_eq!(manual.error.unwrap().message, "Die Suche nach Updates geht gerade nicht. Versuch es in etwa 31 Minuten noch einmal.");
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
  assert!(s.error.unwrap().message.contains("ging schief"));
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
  let stored = |v| make(config("http://127.0.0.1:9/", cache.path()), &FakeHost::on_channel(v)).state().channel;
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
  let preview = make(config(&srv.base, cache.path()), &FakeHost::on_channel("preview")).check(true).await;
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
  let host = FakeHost::on_channel("preview");
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
    let host = FakeHost::on_channel("preview");
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
  assert!(s.error.unwrap().message.contains("Code 503"));
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
    make(cfg, &FakeHost::on_channel("preview"))
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

/// What an install leaves for the next start, `age` old.
fn write_marker(cache: &TempDir, from: &str, to: &str, age: Duration) {
  let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap();
  let at = (now - age).as_millis() as u64;
  let marker = json!({ "from": from, "to": to, "at": at, "notes": "## Neu", "url": format!("{PAGE}/tag/{to}"), "previousFile": null });
  std::fs::write(cache.path().join("installing.json"), marker.to_string()).unwrap();
}

#[tokio::test]
async fn the_same_version_installed_once_more_is_not_greeted_as_an_update() {
  // "Update aus Datei installieren" with the running version: 4.0.0 before
  // and after, whether the installer ran or not.
  let cache = TempDir::new();
  write_marker(&cache, "4.0.0", "4.0.0", Duration::from_secs(60));
  // What is remembered of another version's failed install is not this marker's to clear.
  let host = FakeHost::with_pref(PREF_FAILED_INSTALL, "9.9.9");
  let updater = make(config("http://127.0.0.1:9/", cache.path()), &host);
  updater.start();
  updater.stop();
  let s = updater.state();
  assert_eq!(s.installed, None, "no \"aktualisiert auf 4.0.0\", nothing for telemetry");
  assert_eq!((s.failed_install, s.error), (None, None), "and no failure either: nothing can be told");
  assert_eq!(host.pref(PREF_FAILED_INSTALL).as_deref(), Some("9.9.9"));
  assert!(!cache.path().join("installing.json").exists(), "the marker is read once");
}

#[tokio::test]
async fn an_install_that_failed_days_ago_is_not_run_again_unasked_and_no_longer_said() {
  let srv = Server::start(github_like(rel("9.9.9")));
  let cache = TempDir::new();
  // The installer for 9.9.9 was started two days ago; Girovo is opened again only now, still 4.0.0.
  write_marker(&cache, "4.0.0", "9.9.9", Duration::from_secs(2 * 24 * 60 * 60));
  let host = Arc::new(FakeHost::default());
  let updater = make(config(&srv.base, cache.path()), &host);
  updater.start();
  assert_eq!(host.pref(PREF_FAILED_INSTALL).as_deref(), Some("9.9.9"), "remembered whatever its age");
  let s = updater.state();
  assert_eq!((s.failed_install, s.error), (None, None), "old news is not said");
  let window = FakeWindow::default();
  let check = updater.start_check(&window);
  assert!(!updater.update_at_start(check, &window).await, "not installed again by itself");
  assert_eq!(host.installs().len(), 0);
  updater.stop();
}

#[tokio::test]
async fn a_channel_the_user_picks_is_not_undone_by_the_next_release() {
  let srv = Server::start(|_req, conn, _base| conn.send(404, b"{}"));
  let cache = TempDir::new();
  let at = |version: &str| {
    let mut c = config(&srv.base, cache.path());
    c.current_version = version.into();
    c
  };
  // A fresh copy of a release (nothing was ever moved), where the user picks Nightly.
  let host = Arc::new(FakeHost::default());
  let updater = make(at("6.0.4"), &host);
  assert_eq!(updater.set_channel("preview").await.channel, Channel::Preview);
  assert_eq!(host.pref(PREF_MOVED_TO_STABLE).as_deref(), Some("6.0.4"), "the choice is noted");
  // Nightlies, then the next release: the channel stays Nightly.
  assert_eq!(make(at("6.1.0-nightly.202611101200.gabcdef0"), &host).state().channel, Channel::Preview);
  assert_eq!(make(at("6.1.0"), &host).state().channel, Channel::Preview);
  assert_eq!(host.pref(PREF_CHANNEL).as_deref(), Some("preview"));
  // Picking the channel it is on already counts as a choice too.
  let host = FakeHost::with_pref(PREF_CHANNEL, "preview");
  make(at("6.1.0-nightly.202611101200.gabcdef0"), &host).set_channel("preview").await;
  assert_eq!(make(at("6.1.0"), &host).state().channel, Channel::Preview);
  // And what a move noted before stays as it was.
  let host = FakeHost::on_channel("stable");
  make(at("6.0.4"), &host).set_channel("preview").await;
  assert_eq!(host.pref(PREF_MOVED_TO_STABLE).as_deref(), Some("6.0.0"));
}

#[tokio::test]
async fn a_restart_asked_for_while_quitting_for_an_install_does_not_take_its_place() {
  let srv = Server::start(github_like(rel("9.9.9")));
  let cache = TempDir::new();
  let host = Arc::new(FakeHost::default());
  let updater = make(config(&srv.base, cache.path()), &host);
  updater.check(true).await;
  updater.download().await;
  assert_eq!(updater.install().await.phase, Phase::Installing);
  // "Jetzt neu starten" while the page's last writes are waited for.
  assert_eq!(updater.restart_to_update(["--updated".to_string()]).phase, Phase::Installing);
  let quits = host.quits.lock().unwrap();
  assert_eq!(quits.len(), 1, "{quits:?}");
  assert!(matches!(quits[0], AtExit::Install(_)));
}

#[test]
fn at_exit_an_install_noted_is_not_replaced_by_a_restart() {
  let plan = InstallPlan { file: PathBuf::from("C:/cache/Girovo-9.9.9-Setup.exe"), args: vec![], version: "9.9.9".into(), sha256: None };
  let restart = || AtExit::Relaunch(vec!["--update".into()]);
  let mut queued = None;
  assert!(queue_at_exit(&mut queued, restart()));
  assert_eq!(queued, Some(restart()));
  // An install takes a restart's place…
  assert!(queue_at_exit(&mut queued, AtExit::Install(plan.clone())));
  // …a restart never an install's.
  assert!(!queue_at_exit(&mut queued, restart()));
  assert_eq!(queued, Some(AtExit::Install(plan.clone())));
  assert!(queue_at_exit(&mut queued, AtExit::Install(plan.clone())));
}

#[tokio::test]
async fn a_download_the_server_takes_and_never_answers_is_given_up() {
  // The connection opens, the request goes out, and then nothing: no headers, ever.
  let srv = Server::start(|req, conn, base| {
    if req.path == "/latest" {
      conn.json(&release_json(base, &rel("9.9.9")));
    } else {
      conn.hang();
    }
  });
  let cache = TempDir::new();
  let mut cfg = config(&srv.base, cache.path());
  cfg.stall = Duration::from_millis(300);
  let updater = make(cfg, &Arc::new(FakeHost::default()));
  assert_eq!(updater.check(true).await.phase, Phase::Available);
  let started = std::time::Instant::now();
  let s = updater.download().await;
  assert!(started.elapsed() < Duration::from_secs(20), "given up after the stall limit, not left waiting");
  assert_eq!(s.phase, Phase::Available);
  let error = s.error.unwrap();
  assert_eq!(error.during, During::Download);
  assert!(error.message.contains("Verbindung ist abgebrochen"), "{}", error.message);
  assert!(cache.names().iter().all(|n| !n.ends_with(".partial")));
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
  let plan = InstallPlan { file: PathBuf::from("C:/cache/Girovo-9.9.9-Setup.exe"), args: vec!["/S".into()], version: "9.9.9".into(), sha256: None };
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
  let plan = InstallPlan { file: PathBuf::from("C:/cache/Girovo-9.9.9-Setup.exe"), args: vec![], version: "9.9.9".into(), sha256: None };
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
  /// The user closed it.
  closed: std::sync::atomic::AtomicBool,
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
  fn is_open(&self) -> bool {
    !self.closed.load(Ordering::SeqCst)
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

#[tokio::test]
async fn at_start_a_release_whose_install_just_failed_is_not_installed_again_unasked() {
  let srv = Server::start(github_like(rel("9.9.9")));
  let cache = TempDir::new();
  let first = make(config(&srv.base, cache.path()), &Arc::new(FakeHost::default()));
  first.check(true).await;
  first.download().await;
  first.install().await;

  // The next start, still 4.0.0: the installer failed. Girovo opens instead of quitting for it again.
  let host = Arc::new(FakeHost::default());
  let again = make(config(&srv.base, cache.path()), &host);
  again.start();
  let window = FakeWindow::default();
  let check = again.start_check(&window);
  assert!(!again.update_at_start(check, &window).await);
  assert_eq!(host.installs().len(), 0);
  again.stop();

  // …nor on the start after (the marker is read once; the failed version is remembered).
  let third = make(config(&srv.base, cache.path()), &host);
  third.start();
  let check = third.start_check(&window);
  assert!(!third.update_at_start(check, &window).await);
  assert_eq!(host.installs().len(), 0);
  third.stop();

  // Asked for (--update): installed.
  let host = Arc::new(FakeHost::default());
  host.set_pref(PREF_FAILED_INSTALL, "9.9.9");
  let mut cfg = config(&srv.base, cache.path());
  cfg.update_asked = true;
  let asked = make(cfg, &host);
  asked.start();
  let check = asked.start_check(&window);
  assert!(asked.update_at_start(check, &window).await);
  assert_eq!(host.installs().len(), 1);
  asked.stop();
}

#[tokio::test]
async fn at_start_a_release_the_user_stepped_back_from_is_not_put_back_unasked() {
  let srv = Server::start(github_like(rel("9.9.9")));
  let cache = TempDir::new();
  let window = FakeWindow::default();
  // Stepped back from 9.9.9 (or from something newer still): 9.9.9 waits for the user.
  for held in ["9.9.9", "10.0.0"] {
    let host = FakeHost::with_pref(PREF_HELD_BACK, held);
    let updater = make(config(&srv.base, cache.path()), &host);
    let check = updater.start_check(&window);
    assert!(!updater.update_at_start(check, &window).await, "held at {held}");
    assert_eq!(host.installs().len(), 0);
    assert_eq!(host.pref(PREF_HELD_BACK).as_deref(), Some(held), "and stays held");
    // The app itself still knows of the release: installing it is a click.
    assert_eq!(updater.state().release.unwrap().version, "9.9.9");
  }
  // Stepped back from an older one: 9.9.9 is newer, installed as always, and the step back is over.
  let host = FakeHost::with_pref(PREF_HELD_BACK, "9.9.8");
  let updater = make(config(&srv.base, cache.path()), &host);
  let check = updater.start_check(&window);
  assert!(updater.update_at_start(check, &window).await);
  assert_eq!(host.installs().len(), 1);
  assert_eq!(host.pref(PREF_HELD_BACK).as_deref(), Some(""));
  // Asked for ("Jetzt neu starten und installieren", --update): installed.
  let host = FakeHost::with_pref(PREF_HELD_BACK, "9.9.9");
  let mut cfg = config(&srv.base, cache.path());
  cfg.update_asked = true;
  let updater = make(cfg, &host);
  let check = updater.start_check(&window);
  assert!(updater.update_at_start(check, &window).await);
  assert_eq!(host.installs().len(), 1);
  assert_eq!(host.pref(PREF_HELD_BACK).as_deref(), Some(""));
}

#[tokio::test]
async fn at_start_closing_the_window_during_the_download_opens_girovo_at_once() {
  // 9.9.9 is found, its download sends its headers and then nothing.
  let srv = Server::start(with_previews(true));
  let cache = TempDir::new();
  let host = Arc::new(FakeHost::default());
  let updater = make(config(&srv.base, cache.path()), &host);
  let window = Arc::new(FakeWindow::default());
  let check = updater.start_check(&*window);
  let user = window.clone();
  tokio::spawn(async move {
    while !user.log.lock().unwrap().iter().any(|l| l == "step downloading") {
      tokio::time::sleep(Duration::from_millis(20)).await;
    }
    user.closed.store(true, Ordering::SeqCst);
  });
  let started = std::time::Instant::now();
  assert!(!updater.update_at_start(check, &*window).await);
  assert!(started.elapsed() < Duration::from_secs(20), "not until the download ends or stalls");
  assert_eq!(host.installs().len(), 0);
  // The download goes on behind the app.
  wait_until(|| updater.state().phase == Phase::Downloading).await;
  updater.stop();
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
      let updater = Updater::new(cfg, FakeHost::on_channel(channel));
      let s = updater.check(true).await;
      let offer = s.release.as_ref().map_or("-".to_string(), |r| {
        format!("{} back={} canInstall={} size={:?} published={:?}", r.version, r.back, r.can_install, r.size, r.published_at)
      });
      eprintln!("LIVE {current:<36} {channel:<8} {:?} {offer} {:?}", s.phase, s.error.map(|e| e.message));
      assert_ne!(s.phase, Phase::Idle, "GitHub answered");
    }
  }
}

/// The real girovo.de with the real keys: the first signed nightly
/// (6.0.2-nightly.202611071916.gce3e01b) is offered to the one before it.
/// `cargo test --lib live_girovo_de -- --ignored --nocapture`
#[tokio::test]
#[ignore = "asks the real girovo.de"]
async fn live_girovo_de_offers_the_signed_nightly() {
  let cache = TempDir::new();
  let cfg = Config::new("6.0.2-nightly.202611071832.gc0d6b0c".into(), InstallKind::Nsis, cache.path().to_path_buf());
  let host = FakeHost::on_channel("preview");
  let s = make(cfg, &host).check(true).await;
  eprintln!("LIVE girovo.de {:?} {:?} {:?}", s.phase, s.release.as_ref().map(|r| &r.version), s.error);
  assert_eq!(s.phase, Phase::Available);
  assert!(s.release.unwrap().version.starts_with("6.0.2-nightly."));
}

// ---- girovo.de and signed manifests (docs/updater-v2.md) -------------------------------

mod signed {
  use super::super::bundle;
  use super::super::trust::{self, testing};
  use super::*;

  /// The test keys: stable from seed 1, nightly from seed 2; seed 9 is a stranger's.
  fn keys() -> trust::Keys {
    trust::Keys { stable: testing::pair(1).1, nightly: testing::pair(2).1 }
  }

  /// girovo-update.json for `version`, its Setup.exe the stand-in's payload.
  fn manifest(base: &str, version: &str) -> String {
    manifest_of(base, version, &payload())
  }

  /// The same with an installer of its own (`bytes`).
  fn manifest_of(base: &str, version: &str, bytes: &[u8]) -> String {
    let setup = format!("Girovo-{version}-Setup.exe");
    json!({
      "format": "girovo-update", "v": 1, "version": version, "build": trust::build_number(version),
      "channel": if version.contains('-') { "nightly" } else { "stable" },
      "page": format!("{PAGE}/tag/{version}"),
      "published": "2026-11-08T10:00:00.000Z",
      "files": [{ "kind": "setup", "name": setup, "size": bytes.len(), "sha256": sha(bytes), "url": format!("{base}dl/{setup}") }],
      "notes": "## Neu\n- signiert",
    })
    .to_string()
  }

  fn listed(base: &str, version: &str, rollout: u32, seed: u8) -> Value {
    let m = manifest(base, version);
    json!({ "version": version, "build": trust::build_number(version), "rollout": rollout, "sig": testing::sign(m.as_bytes(), &testing::pair(seed).0), "manifest": m })
  }

  type Seen = Arc<Mutex<Vec<(String, Option<String>)>>>;
  type Listing = fn(&str) -> Vec<Value>;

  /// girovo.de at /updates/ (ETag "v1": a check naming it gets a 304), GitHub
  /// at /latest, the files at /dl/. `listing` None: girovo.de answers 503.
  /// `github_signed`: GitHub's 9.9.9 carries a manifest signed with that seed.
  fn site(listing: Option<Listing>, github_signed: Option<u8>, seen: Seen) -> impl Fn(&Request, &mut Conn, &str) + Send + Sync + 'static {
    let body = payload();
    move |req, conn, base| {
      let asked = req.headers.get("if-none-match").cloned();
      seen.lock().unwrap().push((req.path.clone(), asked.clone()));
      let m = manifest(base, "9.9.9");
      let sig = testing::sign(m.as_bytes(), &testing::pair(github_signed.unwrap_or(1)).0);
      if req.path.starts_with("/updates/") {
        match listing {
          None => conn.send(503, b"down"),
          Some(_) if asked.as_deref() == Some("\"v1\"") => conn.head(304, &[("ETag", "\"v1\"".into())]),
          Some(list) => {
            let text = json!({ "format": "girovo-updates", "v": 1, "releases": list(base) }).to_string();
            conn.head(200, &[("ETag", "\"v1\"".into()), ("Content-Length", text.len().to_string())]);
            conn.write(text.as_bytes());
          }
        }
      } else if req.path == "/latest" {
        let mut release = release_json(base, &rel("9.9.9"));
        if github_signed.is_some() {
          for (name, len) in [(trust::MANIFEST_NAME, m.len()), (trust::SIG_NAME, sig.len())] {
            let entry = json!({ "name": name, "size": len, "digest": null, "browser_download_url": format!("{base}dl/{name}") });
            release["assets"].as_array_mut().unwrap().push(entry);
          }
        }
        conn.json(&release);
      } else if req.path == format!("/dl/{}", trust::MANIFEST_NAME) || (github_signed.is_some() && req.path == format!("/9.9.9/{}", trust::MANIFEST_NAME)) {
        conn.send(200, m.as_bytes());
      } else if req.path == format!("/dl/{}", trust::SIG_NAME) || (github_signed.is_some() && req.path == format!("/9.9.9/{}", trust::SIG_NAME)) {
        conn.send(200, sig.as_bytes());
      } else if req.path.starts_with("/dl/") {
        conn.send(200, &body);
      } else {
        conn.send(404, b"");
      }
    }
  }

  fn signed_config(base: &str, cache: &Path) -> Config {
    let mut cfg = config(base, cache);
    cfg.manifest_base = Some(format!("{base}updates/"));
    cfg.keys = keys();
    cfg.require_signed = true;
    cfg.current_version = "9.0.0".into();
    cfg
  }

  fn host() -> Arc<FakeHost> {
    FakeHost::with_pref(PREF_INSTALL_ID, "install-a")
  }

  fn by_stable(b: &str) -> Vec<Value> {
    vec![listed(b, "9.9.9", 100, 1)]
  }
  fn by_nightly(b: &str) -> Vec<Value> {
    vec![listed(b, "9.9.9", 100, 2)]
  }
  fn by_stranger(b: &str) -> Vec<Value> {
    vec![listed(b, "9.9.9", 100, 9)]
  }

  #[tokio::test]
  async fn girovo_de_offers_the_signed_release_and_the_download_is_checked_against_its_hash() {
    let seen: Seen = Arc::default();
    let srv = Server::start(site(Some(by_stable), None, seen.clone()));
    let cache = TempDir::new();
    let updater = make(signed_config(&srv.base, cache.path()), &host());
    let s = updater.check(true).await;
    assert_eq!(s.phase, Phase::Available, "{:?}", s.error);
    let release = s.release.unwrap();
    assert_eq!(release.version, "9.9.9");
    assert!(release.can_install);
    assert!(release.notes.contains("signiert"));
    assert_eq!(updater.download().await.phase, Phase::Ready);
    let paths: Vec<String> = seen.lock().unwrap().iter().map(|(p, _)| p.clone()).collect();
    assert!(paths.contains(&"/updates/stable.json".to_string()));
    assert!(!paths.contains(&"/latest".to_string()), "GitHub's API is not asked: {paths:?}");
  }

  #[tokio::test]
  async fn a_strangers_signature_or_the_nightly_key_on_stable_offers_nothing() {
    for listing in [by_stranger as Listing, by_nightly] {
      let srv = Server::start(site(Some(listing), None, Arc::default()));
      let cache = TempDir::new();
      let s = make(signed_config(&srv.base, cache.path()), &host()).check(true).await;
      assert_eq!(s.phase, Phase::Current);
    }
    // On the Nightly channel the nightly key counts.
    let srv = Server::start(site(Some(by_nightly), None, Arc::default()));
    let cache = TempDir::new();
    let host = FakeHost::on_channel("preview");
    host.set_pref(PREF_INSTALL_ID, "install-a");
    let s = make(signed_config(&srv.base, cache.path()), &host).check(true).await;
    assert_eq!(s.phase, Phase::Available, "{:?}", s.error);
  }

  #[tokio::test]
  async fn when_girovo_de_cant_be_asked_github_counts_only_with_a_signed_manifest() {
    let srv = Server::start(site(None, Some(1), Arc::default()));
    let cache = TempDir::new();
    let s = make(signed_config(&srv.base, cache.path()), &host()).check(true).await;
    assert_eq!(s.phase, Phase::Available, "{:?}", s.error);
    assert_eq!(s.release.unwrap().version, "9.9.9");

    for github_signed in [None, Some(9)] {
      let srv = Server::start(site(None, github_signed, Arc::default()));
      let cache = TempDir::new();
      let s = make(signed_config(&srv.base, cache.path()), &host()).check(true).await;
      assert_eq!(s.phase, Phase::Current, "GitHub's release signed by {github_signed:?}");
    }
  }

  #[tokio::test]
  async fn an_unchanged_listing_costs_a_304() {
    let seen: Seen = Arc::default();
    let srv = Server::start(site(Some(by_stable), None, seen.clone()));
    let cache = TempDir::new();
    let updater = make(signed_config(&srv.base, cache.path()), &host());
    assert_eq!(updater.check(true).await.phase, Phase::Available);
    assert_eq!(updater.check(true).await.phase, Phase::Available);
    let asks: Vec<Option<String>> = seen.lock().unwrap().iter().filter(|(p, _)| p.starts_with("/updates/")).map(|(_, e)| e.clone()).collect();
    assert_eq!(asks, [None, Some("\"v1\"".to_string())]);
  }

  /// 9.9.9 to just below this copy's bucket, then 9.9.8 for everybody.
  fn staged(b: &str) -> Vec<Value> {
    let bucket = u32::from(trust::bucket("install-a", "9.9.9"));
    vec![listed(b, "9.9.9", bucket, 1), listed(b, "9.9.8", 100, 1)]
  }

  #[tokio::test]
  async fn a_staged_release_reaches_this_copy_by_its_bucket_or_at_once_when_early() {
    let srv = Server::start(site(Some(staged), None, Arc::default()));
    let cache = TempDir::new();
    let host = host();
    let updater = make(signed_config(&srv.base, cache.path()), &host);
    assert_eq!(updater.check(true).await.release.unwrap().version, "9.9.8");
    let s = updater.set_early(true);
    assert!(s.early);
    assert_eq!(host.pref(PREF_EARLY).as_deref(), Some("on"));
    assert_eq!(updater.check(true).await.release.unwrap().version, "9.9.9");
  }

  #[tokio::test]
  async fn a_copy_without_an_id_makes_one_and_keeps_it() {
    let srv = Server::start(site(Some(by_stable), None, Arc::default()));
    let cache = TempDir::new();
    let host = Arc::new(FakeHost::default());
    let updater = make(signed_config(&srv.base, cache.path()), &host);
    updater.check(true).await;
    let id = host.pref(PREF_INSTALL_ID).expect("an id");
    assert_eq!(id.len(), 32);
    updater.check(true).await;
    assert_eq!(host.pref(PREF_INSTALL_ID), Some(id));
  }

  #[tokio::test]
  async fn signed_offers_are_ordered_by_build_number() {
    let srv = Server::start(site(Some(by_stable), None, Arc::default()));
    let cache = TempDir::new();
    let mut cfg = signed_config(&srv.base, cache.path());
    // A nightly of 9.9.9 is older than 9.9.9.
    cfg.current_version = "9.9.9-nightly.202611071832.gc0d6b0c".into();
    assert_eq!(make(cfg, &host()).check(true).await.phase, Phase::Available);
    let mut cfg = signed_config(&srv.base, cache.path());
    cfg.current_version = "9.9.9-dev.4".into();
    assert_eq!(make(cfg, &host()).check(true).await.phase, Phase::Current, "a dev build counts as its version");
  }

  // ---- an update from a file (step 5) ----

  /// The picked file: the stand-in's payload as a Setup.exe of `version`, in a folder of its own.
  fn picked(dir: &TempDir, version: &str, bytes: &[u8]) -> PathBuf {
    let path = dir.path().join(format!("Girovo-{version}-Setup.exe"));
    std::fs::write(&path, bytes).unwrap();
    path
  }

  /// 9.9.8's installer: other bytes than 9.9.9's.
  fn older_payload() -> Vec<u8> {
    random(300_000, 2)
  }

  fn by_stable_both(b: &str) -> Vec<Value> {
    let m = manifest_of(b, "9.9.8", &older_payload());
    let older = json!({ "version": "9.9.8", "build": trust::build_number("9.9.8"), "rollout": 100, "sig": testing::sign(m.as_bytes(), &testing::pair(1).0), "manifest": m });
    vec![listed(b, "9.9.9", 100, 1), older]
  }

  #[tokio::test]
  async fn a_picked_file_that_is_a_signed_installer_is_ready_and_installs_as_an_update() {
    let srv = Server::start(site(Some(by_stable), None, Arc::default()));
    let (cache, downloads) = (TempDir::new(), TempDir::new());
    let host = host();
    let updater = make(signed_config(&srv.base, cache.path()), &host);
    let file = picked(&downloads, "9.9.9", &payload());
    let s = updater.check_file(file.clone()).await;
    let offer = s.file.clone().unwrap();
    assert_eq!(offer.phase, FilePhase::Ready, "{offer:?}");
    assert_eq!(offer.version.as_deref(), Some("9.9.9"));
    assert!(!offer.older && !offer.same);
    assert_eq!(offer.name, "Girovo-9.9.9-Setup.exe");

    let s = updater.install_file().await;
    assert_eq!(s.phase, Phase::Installing, "{:?}", s.error);
    assert!(s.file.is_none());
    let installs = host.installs();
    assert_eq!(installs.len(), 1);
    assert_eq!(installs[0].file, file, "the picked file itself, not a copy");
    assert_eq!(installs[0].sha256.as_deref(), Some(sha(&payload()).as_str()), "its signed hash goes to girovo-update.exe");
  }

  #[tokio::test]
  async fn an_older_signed_release_is_ready_and_said_to_be_older() {
    let srv = Server::start(site(Some(by_stable_both), None, Arc::default()));
    let (cache, downloads) = (TempDir::new(), TempDir::new());
    let mut cfg = signed_config(&srv.base, cache.path());
    cfg.current_version = "9.9.9".into();
    let updater = make(cfg, &host());
    let s = updater.check_file(picked(&downloads, "9.9.8", &older_payload())).await;
    let offer = s.file.unwrap();
    assert_eq!((offer.phase, offer.version.as_deref(), offer.older, offer.same), (FilePhase::Ready, Some("9.9.8"), true, false));
    let s = updater.check_file(picked(&downloads, "9.9.9", &payload())).await;
    assert!(s.file.unwrap().same, "the installed version, installed once more");
  }

  #[tokio::test]
  async fn a_file_no_signed_release_names_is_refused_and_never_installed() {
    let srv = Server::start(site(Some(by_stable), None, Arc::default()));
    let (cache, downloads) = (TempDir::new(), TempDir::new());
    let host = host();
    let updater = make(signed_config(&srv.base, cache.path()), &host);
    let s = updater.check_file(picked(&downloads, "9.9.9", b"something else entirely")).await;
    let offer = s.file.unwrap();
    assert_eq!(offer.phase, FilePhase::Refused);
    assert!(offer.message.unwrap().contains("verändert"), "9.9.9 is signed, this file is not its installer");
    assert_eq!(updater.install_file().await.phase, Phase::Idle, "nothing to install");
    assert!(host.installs().is_empty());
    assert_eq!(updater.check_file(downloads.path().join("missing.exe")).await.file.unwrap().phase, FilePhase::Refused);
  }

  #[tokio::test]
  async fn without_girovo_de_the_files_name_leads_to_its_signed_manifest_on_github() {
    let srv = Server::start(site(None, Some(1), Arc::default()));
    let (cache, downloads) = (TempDir::new(), TempDir::new());
    let updater = make(signed_config(&srv.base, cache.path()), &host());
    let s = updater.check_file(picked(&downloads, "9.9.9", &payload())).await;
    assert_eq!(s.file.unwrap().phase, FilePhase::Ready);
    // A stranger's signature there counts for nothing, and says so.
    let srv = Server::start(site(None, Some(9), Arc::default()));
    let cache = TempDir::new();
    let updater = make(signed_config(&srv.base, cache.path()), &host());
    let offer = updater.check_file(picked(&downloads, "9.9.9", &payload())).await.file.unwrap();
    assert_eq!(offer.phase, FilePhase::Refused);
    assert!(offer.message.unwrap().contains("Signatur dieser Datei ist ungültig"));
    // No manifest for it at all: no signature.
    let offer = updater.check_file(picked(&downloads, "9.9.7", b"an old installer")).await.file.unwrap();
    assert!(offer.message.unwrap().contains("keine Signatur"));
  }

  #[tokio::test]
  async fn only_the_installed_windows_app_installs_from_a_file_and_the_dialog_can_close() {
    let srv = Server::start(site(Some(by_stable), None, Arc::default()));
    let (cache, downloads) = (TempDir::new(), TempDir::new());
    let mut cfg = signed_config(&srv.base, cache.path());
    cfg.kind = InstallKind::Manual;
    let updater = make(cfg, &host());
    let offer = updater.check_file(picked(&downloads, "9.9.9", &payload())).await.file.unwrap();
    assert_eq!(offer.phase, FilePhase::Refused);
    assert!(updater.dismiss_file().file.is_none());
  }

  // ---- the nightly key signs nightlies only ----

  const NIGHTLY: &str = "9.9.9-nightly.202611071832.gc0d6b0c";

  /// A nightly, signed with the nightly key.
  fn nightly_by_nightly(b: &str) -> Vec<Value> {
    vec![listed(b, NIGHTLY, 100, 2)]
  }

  #[tokio::test]
  async fn a_picked_release_signed_with_the_nightly_key_is_refused_a_nightly_is_taken() {
    // girovo.de lists "9.9.9" signed with the nightly key; nothing else knows the file.
    let srv = Server::start(site(Some(by_nightly), None, Arc::default()));
    let (cache, downloads) = (TempDir::new(), TempDir::new());
    let host = host();
    let updater = make(signed_config(&srv.base, cache.path()), &host);
    let offer = updater.check_file(picked(&downloads, "9.9.9", &payload())).await.file.unwrap();
    assert_eq!((offer.phase, offer.version.as_deref()), (FilePhase::Refused, None), "{offer:?}");
    assert_eq!(updater.install_file().await.phase, Phase::Idle, "nothing to install");
    assert!(host.installs().is_empty());

    // The manifest its name points to on GitHub, signed with the nightly key: not Girovo's signature for a release.
    let srv = Server::start(site(None, Some(2), Arc::default()));
    let cache = TempDir::new();
    let updater = make(signed_config(&srv.base, cache.path()), &host);
    let offer = updater.check_file(picked(&downloads, "9.9.9", &payload())).await.file.unwrap();
    assert_eq!(offer.phase, FilePhase::Refused, "{offer:?}");
    assert!(offer.message.unwrap().contains("Signatur dieser Datei ist ungültig"));

    // A nightly signed with the nightly key is what that key is for.
    let srv = Server::start(site(Some(nightly_by_nightly), None, Arc::default()));
    let cache = TempDir::new();
    let updater = make(signed_config(&srv.base, cache.path()), &host);
    let offer = updater.check_file(picked(&downloads, NIGHTLY, &payload())).await.file.unwrap();
    assert_eq!((offer.phase, offer.version.as_deref()), (FilePhase::Ready, Some(NIGHTLY)), "{offer:?}");
  }

  #[tokio::test]
  async fn a_bundle_of_a_release_signed_with_the_nightly_key_is_refused_a_nightly_is_taken() {
    let (cache, downloads) = (TempDir::new(), TempDir::new());
    let host = host();
    let updater = make(signed_config(OFFLINE, cache.path()), &host);
    let by_nightly_key = |m: &str| testing::sign(m.as_bytes(), &testing::pair(2).0);

    let release = manifest_of(OFFLINE, "9.9.9", &payload());
    let path = pack(&downloads, release.as_bytes(), by_nightly_key(&release).as_bytes(), SETUP, &payload());
    let offer = updater.check_file(path).await.file.unwrap();
    assert_eq!((offer.phase, offer.version.as_deref()), (FilePhase::Refused, None), "{offer:?}");
    assert!(offer.message.unwrap().contains("Signatur dieser Datei ist ungültig"));
    assert!(unpacked(&cache).is_empty(), "nothing unpacked");
    assert_eq!(updater.install_file().await.phase, Phase::Idle, "nothing to install");
    assert!(host.installs().is_empty());

    let nightly = manifest_of(OFFLINE, NIGHTLY, &payload());
    let setup = format!("Girovo-{NIGHTLY}-Setup.exe");
    let path = pack(&downloads, nightly.as_bytes(), by_nightly_key(&nightly).as_bytes(), &setup, &payload());
    let offer = updater.check_file(path).await.file.unwrap();
    assert_eq!((offer.phase, offer.version.as_deref()), (FilePhase::Ready, Some(NIGHTLY)), "{offer:?}");
  }

  #[tokio::test]
  async fn a_release_whose_manifest_the_nightly_key_signed_is_not_put_in_a_bundle() {
    // The offer comes from girovo.de, signed; the release's own manifest is the nightly key's.
    let srv = Server::start(site(Some(by_stable), Some(2), Arc::default()));
    let (cache, downloads) = (TempDir::new(), TempDir::new());
    let updater = make(signed_config(&srv.base, cache.path()), &host());
    updater.check(true).await;
    let dest = downloads.path().join("x.girovoupdate");
    assert_eq!(updater.save_bundle(dest.clone()).await.saving.unwrap().phase, SavePhase::Failed);
    assert!(!dest.exists());
  }

  // ---- a copy the browser renamed ----

  #[tokio::test]
  async fn a_renamed_copy_of_a_signed_installer_is_still_found_by_its_version() {
    // girovo.de can't be asked: only the name leads to the manifest.
    let srv = Server::start(site(None, Some(1), Arc::default()));
    let (cache, downloads) = (TempDir::new(), TempDir::new());
    let updater = make(signed_config(&srv.base, cache.path()), &host());
    for name in ["Girovo-9.9.9-Setup (1).exe", "girovo-9.9.9-setup - Kopie.exe"] {
      let renamed = downloads.path().join(name);
      std::fs::write(&renamed, payload()).unwrap();
      let offer = updater.check_file(renamed).await.file.unwrap();
      assert_eq!((offer.phase, offer.version.as_deref()), (FilePhase::Ready, Some("9.9.9")), "{offer:?}");
      assert_eq!(offer.name, name, "shown under the name the user knows");
    }
    // The name only says where to look: other bytes under it are not that release's installer.
    let other = downloads.path().join("Girovo-9.9.9-Setup (2).exe");
    std::fs::write(&other, b"something else entirely").unwrap();
    assert!(message_of(updater.check_file(other).await).contains("verändert"));
  }

  // ---- an older version on purpose ----

  #[tokio::test]
  async fn an_older_version_from_a_file_is_not_updated_away_at_the_next_start() {
    let srv = Server::start(site(Some(by_stable_both), None, Arc::default()));
    let (cache, downloads) = (TempDir::new(), TempDir::new());
    let host = host();
    let at = |version: &str| {
      let mut cfg = signed_config(&srv.base, cache.path());
      cfg.current_version = version.into();
      cfg
    };
    // 9.9.9 runs; the user installs 9.9.8 from a file.
    let updater = make(at("9.9.9"), &host);
    assert!(updater.check_file(picked(&downloads, "9.9.8", &older_payload())).await.file.unwrap().older);
    assert_eq!(updater.install_file().await.phase, Phase::Installing);
    assert_eq!(host.installs().len(), 1);
    assert_eq!(host.pref(PREF_HELD_BACK).as_deref(), Some("9.9.9"), "the version stepped back from");

    // The next start is 9.9.8, and girovo.de offers 9.9.9: Girovo opens, 9.9.9 stays an offer.
    let older = make(at("9.9.8"), &host);
    older.start();
    let window = FakeWindow::default();
    let check = older.start_check(&window);
    assert!(!older.update_at_start(check, &window).await);
    assert_eq!(host.installs().len(), 1, "nothing installed by itself");
    assert_eq!(older.state().release.unwrap().version, "9.9.9");
    // "Jetzt neu starten und installieren" is the user asking for it: the step back is over.
    older.restart_to_update([]);
    assert_eq!(host.pref(PREF_HELD_BACK).as_deref(), Some(""));
    older.stop();
  }

  #[tokio::test]
  async fn a_newer_or_the_same_version_from_a_file_holds_nothing_back_and_a_second_step_keeps_the_first() {
    let srv = Server::start(site(Some(by_stable_both), None, Arc::default()));
    let (cache, downloads) = (TempDir::new(), TempDir::new());
    let at = |version: &str| {
      let mut cfg = signed_config(&srv.base, cache.path());
      cfg.current_version = version.into();
      cfg
    };
    for (running, file, bytes) in [("9.0.0", "9.9.9", payload()), ("9.9.9", "9.9.9", payload())] {
      let host = host();
      let updater = make(at(running), &host);
      updater.check_file(picked(&downloads, file, &bytes)).await;
      assert_eq!(updater.install_file().await.phase, Phase::Installing);
      assert_eq!(host.pref(PREF_HELD_BACK), None, "{file} over {running}");
    }
    // Stepped back from 10.0.0 before, now from 9.9.9 to 9.9.8: 10.0.0 and everything below stays held.
    let host = host();
    host.set_pref(PREF_HELD_BACK, "10.0.0");
    let updater = make(at("9.9.9"), &host);
    updater.check_file(picked(&downloads, "9.9.8", &older_payload())).await;
    assert_eq!(updater.install_file().await.phase, Phase::Installing);
    assert_eq!(host.pref(PREF_HELD_BACK).as_deref(), Some("10.0.0"));
  }

  // ---- could not be asked is not unsigned ----

  const CANNOT_CHECK: &str = "lässt sich gerade nicht prüfen";

  fn message_of(s: UpdateState) -> String {
    let offer = s.file.unwrap();
    assert_eq!(offer.phase, FilePhase::Refused, "{offer:?}");
    offer.message.unwrap()
  }

  /// girovo.de reachable and listing nothing; at GitHub 9.9.9's manifest is
  /// `manifest_status`'s answer, its signature `sig_status`'s.
  fn github_answering(manifest_status: u16, sig_status: u16) -> impl Fn(&Request, &mut Conn, &str) + Send + Sync + 'static {
    move |req, conn, base| {
      if req.path.starts_with("/updates/") {
        conn.send(200, json!({ "format": "girovo-updates", "v": 1, "releases": [] }).to_string().as_bytes());
      } else if req.path == format!("/9.9.9/{}", trust::MANIFEST_NAME) {
        conn.send(manifest_status, manifest(base, "9.9.9").as_bytes());
      } else if req.path == format!("/9.9.9/{}", trust::SIG_NAME) {
        conn.send(sig_status, b"");
      } else {
        conn.send(404, b"");
      }
    }
  }

  #[tokio::test]
  async fn with_nothing_reachable_a_signed_file_is_not_called_unsigned() {
    let (cache, downloads) = (TempDir::new(), TempDir::new());
    let updater = make(signed_config(OFFLINE, cache.path()), &host());
    let said = message_of(updater.check_file(picked(&downloads, "9.9.9", &payload())).await);
    assert!(said.contains(CANNOT_CHECK), "{said}");
    assert!(!said.contains("keine Signatur"), "{said}");
    // Servers that answer, but only with errors: the same. And a name that
    // points nowhere, with only the listing to go by.
    let srv = Server::start(|_req, conn, _base| conn.send(503, b""));
    let updater = make(signed_config(&srv.base, cache.path()), &host());
    assert!(message_of(updater.check_file(picked(&downloads, "9.9.9", &payload())).await).contains(CANNOT_CHECK));
    let renamed = downloads.path().join("Girovo-Setup (1).exe");
    std::fs::write(&renamed, payload()).unwrap();
    assert!(message_of(updater.check_file(renamed).await).contains(CANNOT_CHECK));
  }

  #[tokio::test]
  async fn a_release_that_answers_it_has_no_manifest_is_unsigned() {
    let srv = Server::start(site(Some(by_stable), None, Arc::default()));
    let (cache, downloads) = (TempDir::new(), TempDir::new());
    let updater = make(signed_config(&srv.base, cache.path()), &host());
    let said = message_of(updater.check_file(picked(&downloads, "9.9.7", b"an old installer")).await);
    assert!(said.contains("keine Signatur"), "{said}");
  }

  #[tokio::test]
  async fn a_listing_that_answers_with_no_name_to_follow_is_unsigned() {
    let srv = Server::start(github_answering(404, 404));
    let (cache, downloads) = (TempDir::new(), TempDir::new());
    let updater = make(signed_config(&srv.base, cache.path()), &host());
    let renamed = downloads.path().join("Girovo-Setup (1).exe");
    std::fs::write(&renamed, payload()).unwrap();
    assert!(message_of(updater.check_file(renamed).await).contains("keine Signatur"));
  }

  #[tokio::test]
  async fn a_signature_that_could_not_be_loaded_is_not_a_bad_one() {
    let srv = Server::start(github_answering(200, 503));
    let (cache, downloads) = (TempDir::new(), TempDir::new());
    let updater = make(signed_config(&srv.base, cache.path()), &host());
    let said = message_of(updater.check_file(picked(&downloads, "9.9.9", &payload())).await);
    assert!(said.contains(CANNOT_CHECK), "{said}");
    // One that is really not there still is one.
    let srv = Server::start(github_answering(200, 404));
    let updater = make(signed_config(&srv.base, cache.path()), &host());
    let said = message_of(updater.check_file(picked(&downloads, "9.9.9", &payload())).await);
    assert!(said.contains("Signatur dieser Datei ist ungültig"), "{said}");
  }

  #[tokio::test]
  async fn a_server_error_for_the_manifest_is_not_a_missing_manifest() {
    let srv = Server::start(github_answering(500, 500));
    let (cache, downloads) = (TempDir::new(), TempDir::new());
    let updater = make(signed_config(&srv.base, cache.path()), &host());
    let said = message_of(updater.check_file(picked(&downloads, "9.9.9", &payload())).await);
    assert!(said.contains(CANNOT_CHECK), "{said}");
  }

  // ---- a .girovoupdate ----

  /// Nobody listens here: what works against it works with no connection.
  const OFFLINE: &str = "http://127.0.0.1:9/";

  /// A bundle in `dir` of exactly these parts.
  fn pack(dir: &TempDir, manifest: &[u8], sig: &[u8], installer_name: &str, installer: &[u8]) -> PathBuf {
    let exe = dir.path().join("installer.bin");
    std::fs::write(&exe, installer).unwrap();
    let path = dir.path().join("Girovo-9.9.9.girovoupdate");
    bundle::write(&path, manifest, sig, &exe, installer_name).unwrap();
    path
  }

  /// A good bundle of 9.9.9, its links under `base`.
  fn bundled(dir: &TempDir, base: &str) -> PathBuf {
    let m = manifest_of(base, "9.9.9", &payload());
    let sig = testing::sign(m.as_bytes(), &testing::pair(1).0);
    pack(dir, m.as_bytes(), sig.as_bytes(), SETUP, &payload())
  }

  /// The files unpacked from bundles and still lying there.
  fn unpacked(cache: &TempDir) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut folders = vec![cache.path().join("from-bundle")];
    while let Some(dir) = folders.pop() {
      for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
        if entry.path().is_dir() {
          folders.push(entry.path());
        } else {
          found.push(entry.path());
        }
      }
    }
    found
  }

  #[tokio::test]
  async fn a_bundle_opens_with_no_connection_and_installs_what_it_carries() {
    let (cache, downloads) = (TempDir::new(), TempDir::new());
    let host = host();
    let updater = make(signed_config(OFFLINE, cache.path()), &host);
    let s = updater.check_file(bundled(&downloads, OFFLINE)).await;
    let offer = s.file.clone().unwrap();
    assert_eq!(offer.phase, FilePhase::Ready, "{offer:?}");
    assert_eq!((offer.version.as_deref(), offer.older, offer.same), (Some("9.9.9"), false, false));
    assert_eq!(offer.name, "Girovo-9.9.9.girovoupdate");

    let s = updater.install_file().await;
    assert_eq!(s.phase, Phase::Installing, "{:?}", s.error);
    assert!(s.file.is_none());
    let installs = host.installs();
    assert_eq!(installs.len(), 1);
    assert!(installs[0].file.starts_with(cache.path().join("from-bundle")), "{:?}", installs[0].file);
    assert_eq!(installs[0].file.file_name().unwrap().to_str(), Some(SETUP), "under the signed name");
    assert_eq!(std::fs::read(&installs[0].file).unwrap(), payload());
    assert_eq!(installs[0].sha256.as_deref(), Some(sha(&payload()).as_str()), "its signed hash goes to girovo-update.exe");
    assert_eq!(unpacked(&cache).len(), 1, "stays for the installer");
  }

  #[tokio::test]
  async fn a_check_meanwhile_does_not_sweep_the_unpacked_installer() {
    let srv = Server::start(site(Some(by_stable), None, Arc::default()));
    let (cache, downloads) = (TempDir::new(), TempDir::new());
    let host = host();
    let updater = make(signed_config(&srv.base, cache.path()), &host);
    assert_eq!(updater.check_file(bundled(&downloads, &srv.base)).await.file.unwrap().phase, FilePhase::Ready);
    updater.check(true).await;
    assert_eq!(unpacked(&cache).len(), 1, "clear_cache left it alone");
    assert_eq!(updater.install_file().await.phase, Phase::Installing);
    assert_eq!(host.installs().len(), 1);
  }

  #[tokio::test]
  async fn an_older_release_in_a_bundle_is_said_to_be_older() {
    let (cache, downloads) = (TempDir::new(), TempDir::new());
    let mut cfg = signed_config(OFFLINE, cache.path());
    cfg.current_version = "9.9.9".into();
    let updater = make(cfg, &host());
    let m = manifest_of(OFFLINE, "9.9.8", &older_payload());
    let sig = testing::sign(m.as_bytes(), &testing::pair(1).0);
    let path = pack(&downloads, m.as_bytes(), sig.as_bytes(), "Girovo-9.9.8-Setup.exe", &older_payload());
    let offer = updater.check_file(path).await.file.unwrap();
    assert_eq!((offer.phase, offer.version.as_deref(), offer.older, offer.same), (FilePhase::Ready, Some("9.9.8"), true, false));
  }

  #[tokio::test]
  async fn a_damaged_or_changed_bundle_is_refused_and_says_why() {
    let (cache, downloads) = (TempDir::new(), TempDir::new());
    let good = manifest_of(OFFLINE, "9.9.9", &payload());
    let by = |seed: u8, bytes: &str| testing::sign(bytes.as_bytes(), &testing::pair(seed).0);
    let sig = by(1, &good);
    let unreadable = "ließ sich nicht lesen";
    let unsigned = "keine Signatur";
    let bad_signature = "Signatur dieser Datei ist ungültig";
    let changed = "verändert";

    // A file, and the reason it is refused for.
    let mut cases: Vec<(&str, Vec<u8>, &str)> = Vec::new();
    let read = |p: PathBuf| std::fs::read(p).unwrap();
    let whole = read(pack(&downloads, good.as_bytes(), sig.as_bytes(), SETUP, &payload()));
    cases.push(("not a bundle", b"this is no zip".to_vec(), unreadable));
    cases.push(("cut off", whole[..whole.len() / 2].to_vec(), unreadable));
    let renamed = |from: &[u8], to: &[u8]| {
      let mut bytes = whole.clone();
      let mut at = 0;
      while let Some(i) = bytes[at..].windows(from.len()).position(|w| w == from) {
        bytes[at + i..at + i + to.len()].copy_from_slice(to);
        at += i + 1;
      }
      bytes
    };
    cases.push(("no manifest", renamed(b"girovo-update.json", b"other-updat.json.x"), unsigned));
    cases.push(("no signature", renamed(b"girovo-update.json.sig", b"girovo-update.json.xyz"), unsigned));
    cases.push(("a stranger's signature", read(pack(&downloads, good.as_bytes(), by(9, &good).as_bytes(), SETUP, &payload())), bad_signature));
    let forged = manifest_of(OFFLINE, "9.9.9", b"the attacker's installer");
    cases.push(("a manifest changed after signing", read(pack(&downloads, forged.as_bytes(), sig.as_bytes(), SETUP, b"the attacker's installer")), bad_signature));
    cases.push(("garbage for a signature", read(pack(&downloads, good.as_bytes(), b"not json", SETUP, &payload())), bad_signature));
    let mut other = payload();
    other[0] ^= 1;
    cases.push(("another installer of the same size", read(pack(&downloads, good.as_bytes(), sig.as_bytes(), SETUP, &other)), changed));
    cases.push(("another installer of another size", read(pack(&downloads, good.as_bytes(), sig.as_bytes(), SETUP, b"short")), changed));
    cases.push(("no installer", read(pack(&downloads, good.as_bytes(), sig.as_bytes(), "Other-Setup.exe", &payload())), changed));

    let host = host();
    let updater = make(signed_config(OFFLINE, cache.path()), &host);
    let file = downloads.path().join("case.girovoupdate");
    for (what, bytes, why) in cases {
      std::fs::write(&file, bytes).unwrap();
      let offer = updater.check_file(file.clone()).await.file.unwrap();
      assert_eq!(offer.phase, FilePhase::Refused, "{what}");
      assert!(offer.message.as_deref().unwrap_or("").contains(why), "{what}: {:?}", offer.message);
      assert_eq!(offer.version, None, "{what}");
      assert!(unpacked(&cache).is_empty(), "{what}: nothing left behind");
      assert_eq!(updater.install_file().await.phase, Phase::Idle, "{what}: nothing to install");
    }
    assert!(host.installs().is_empty());
    assert_eq!(updater.check_file(downloads.path().join("missing.girovoupdate")).await.file.unwrap().phase, FilePhase::Refused);
  }

  #[tokio::test]
  async fn the_unpacked_copy_goes_with_the_dialog_with_the_next_file_and_at_the_next_start() {
    let (cache, downloads) = (TempDir::new(), TempDir::new());
    let updater = make(signed_config(OFFLINE, cache.path()), &host());
    let path = bundled(&downloads, OFFLINE);
    updater.check_file(path.clone()).await;
    assert_eq!(unpacked(&cache).len(), 1);
    assert!(updater.dismiss_file().file.is_none());
    assert!(unpacked(&cache).is_empty(), "closed: gone");
    assert_eq!(updater.install_file().await.phase, Phase::Idle, "and nothing to install");

    updater.check_file(path.clone()).await;
    updater.check_file(path.clone()).await;
    assert_eq!(unpacked(&cache).len(), 1, "the next file takes its place");

    // What a quit left behind.
    let again = make(signed_config(OFFLINE, cache.path()), &host());
    again.start();
    again.stop();
    assert!(unpacked(&cache).is_empty(), "gone at the next start");
  }

  #[tokio::test]
  async fn a_bundle_outside_the_installed_windows_app_is_not_opened() {
    let (cache, downloads) = (TempDir::new(), TempDir::new());
    let mut cfg = signed_config(OFFLINE, cache.path());
    cfg.kind = InstallKind::Manual;
    let updater = make(cfg, &host());
    let offer = updater.check_file(bundled(&downloads, OFFLINE)).await.file.unwrap();
    assert_eq!(offer.phase, FilePhase::Refused);
    assert!(unpacked(&cache).is_empty());
  }

  #[tokio::test]
  async fn a_restart_forgets_the_bundle_this_start_was_opened_with() {
    let cache = TempDir::new();
    let host = host();
    let updater = make(signed_config(OFFLINE, cache.path()), &host);
    updater.restart_to_update(["C:/Downloads/Girovo-9.9.9.girovoupdate".to_string(), "--updated".into()]);
    assert_eq!(*host.quits.lock().unwrap(), [AtExit::Relaunch(vec!["--updated".into(), "--update".into()])]);
  }

  #[tokio::test]
  async fn a_saved_bundle_opens_and_installs_on_its_own() {
    let seen: Seen = Arc::default();
    let srv = Server::start(site(Some(by_stable), Some(1), seen.clone()));
    let (cache, downloads) = (TempDir::new(), TempDir::new());
    let updater = make(signed_config(&srv.base, cache.path()), &host());
    assert_eq!(updater.check(true).await.phase, Phase::Available);
    let dest = downloads.path().join("Mein Update.girovoupdate");
    let s = updater.save_bundle(dest.clone()).await;
    let saving = s.saving.clone().unwrap();
    assert_eq!((saving.phase, saving.name.as_str()), (SavePhase::Done, "Mein Update.girovoupdate"), "{saving:?}");
    assert_eq!(s.phase, Phase::Ready, "the download stays for the next start");
    assert!(updater.dismiss_saved().saving.is_none());
    assert!(!downloads.path().join("Mein Update.girovoupdate.part").exists());

    // On another PC: another cache, and not one request.
    let other_cache = TempDir::new();
    let host = host();
    let elsewhere = make(signed_config(&srv.base, other_cache.path()), &host);
    let asked = seen.lock().unwrap().len();
    let offer = elsewhere.check_file(dest).await.file.unwrap();
    assert_eq!(offer.phase, FilePhase::Ready, "{offer:?}");
    assert_eq!(offer.version.as_deref(), Some("9.9.9"));
    assert_eq!(elsewhere.install_file().await.phase, Phase::Installing);
    assert_eq!(seen.lock().unwrap().len(), asked, "the network was not asked");
    assert_eq!(std::fs::read(&host.installs()[0].file).unwrap(), payload());
  }

  #[tokio::test]
  async fn saving_a_downloaded_update_uses_that_download() {
    let seen: Seen = Arc::default();
    let srv = Server::start(site(Some(by_stable), Some(1), seen.clone()));
    let (cache, downloads) = (TempDir::new(), TempDir::new());
    let updater = make(signed_config(&srv.base, cache.path()), &host());
    updater.check(true).await;
    assert_eq!(updater.download().await.phase, Phase::Ready);
    seen.lock().unwrap().clear();
    let s = updater.save_bundle(downloads.path().join("x.girovoupdate")).await;
    assert_eq!(s.saving.unwrap().phase, SavePhase::Done);
    let asked: Vec<String> = seen.lock().unwrap().iter().map(|(path, _)| path.clone()).collect();
    assert_eq!(asked, ["/9.9.9/girovo-update.json", "/9.9.9/girovo-update.json.sig"]);
  }

  #[tokio::test]
  async fn a_file_name_without_the_ending_gets_it() {
    let srv = Server::start(site(Some(by_stable), Some(1), Arc::default()));
    let (cache, downloads) = (TempDir::new(), TempDir::new());
    let updater = make(signed_config(&srv.base, cache.path()), &host());
    updater.check(true).await;
    let s = updater.save_bundle(downloads.path().join("Update")).await;
    assert_eq!(s.saving.unwrap().name, "Update.girovoupdate");
    assert!(downloads.path().join("Update.girovoupdate").is_file());
  }

  #[tokio::test]
  async fn a_release_without_its_signed_manifest_is_not_saved_and_says_so() {
    // girovo.de offers it, GitHub has no manifest to go with it.
    let srv = Server::start(site(Some(by_stable), None, Arc::default()));
    let (cache, downloads) = (TempDir::new(), TempDir::new());
    let updater = make(signed_config(&srv.base, cache.path()), &host());
    updater.check(true).await;
    let dest = downloads.path().join("x.girovoupdate");
    let s = updater.save_bundle(dest.clone()).await;
    let saving = s.saving.unwrap();
    assert_eq!(saving.phase, SavePhase::Failed);
    assert!(saving.message.unwrap().contains("nicht als Datei speichern"));
    assert!(!dest.exists());
    assert!(downloads.names().is_empty(), "nothing half written");
  }

  #[tokio::test]
  async fn a_manifest_signed_by_a_stranger_is_not_put_in_a_bundle() {
    // The offer comes from girovo.de, signed; the release's own manifest is a stranger's.
    let srv = Server::start(site(Some(by_stable), Some(9), Arc::default()));
    let (cache, downloads) = (TempDir::new(), TempDir::new());
    let updater = make(signed_config(&srv.base, cache.path()), &host());
    updater.check(true).await;
    let dest = downloads.path().join("x.girovoupdate");
    assert_eq!(updater.save_bundle(dest.clone()).await.saving.unwrap().phase, SavePhase::Failed);
    assert!(!dest.exists());
  }

  #[tokio::test]
  async fn nothing_on_offer_nothing_to_save() {
    let (cache, downloads) = (TempDir::new(), TempDir::new());
    let updater = make(signed_config(OFFLINE, cache.path()), &host());
    let dest = downloads.path().join("x.girovoupdate");
    assert!(updater.save_bundle(dest.clone()).await.saving.is_none());
    assert!(!dest.exists());
  }
}
