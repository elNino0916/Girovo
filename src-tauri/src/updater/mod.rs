// Girovo's own updater in the Tauri shell (docs/tauri-updater.md): the
// GitHub releases, checked against GitHub's own SHA-256 of every file, the
// Stabil and 6.0-Vorschau channels, downloads of only what is not on disk
// yet, the silent install once the app has quit.
//
//   logic.rs   the decisions (the Electron shell's update-logic.cjs)
//   engine.rs  check, download, install (the Electron shell's updater.cjs)
//   chunks.rs  the chunks a differential download is made of
//   start.rs   the update at start, for the start window
//   texts.rs   what it says, German and English
//
// This file is the Tauri side: the plugin that makes the updater at start
// and runs the installer once the app has quit, the page's commands
// (window.electronUpdater in src/bridge.js, the `updater:*` IPC of
// the Electron shell's main.cjs), every state change pushed as the event STATE_EVENT,
// and the hooks for the start and install windows.

mod chunks;
mod engine;
mod logic;
mod report;
mod start;
mod texts;
#[cfg(test)]
mod tests;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Emitter, Manager, RunEvent};

// The way in for the start window (start.rs), the install window
// (set_install_window) and whoever must hear of an install first
// (Updater::on_before_install). lib.rs's start() and the install window's
// port call them; until they do, nothing in the crate does, hence the allows.
#[allow(unused_imports)]
pub use engine::{AtExit, InstallNotice, InstallPlan, UpdateState, Updater};
#[allow(unused_imports)]
pub use start::{START_CHECK_LIMIT, StartCheck, StartWindow};

use engine::{Config, Host, UPDATE_ARG};
use logic::{InstallKind, Origin};

/// The event every state change goes out as (the bridge's onState).
pub const STATE_EVENT: &str = "updater:state";

/// An installer that has just started, for the install window
/// (install_window::Options takes these): the window watches it and stands in
/// for the app until the new version is up.
#[derive(Clone, Debug)]
#[allow(dead_code)]
pub struct InstallStarted {
  pub installer_pid: u32,
  pub version: String,
  /// The app being replaced, whose window means the new version is up (--app-exe).
  pub app_exe: Option<PathBuf>,
  /// The release pages, for the window's way on when the install fails (--releases-url).
  pub releases_url: String,
  /// The updater's folder, with the downloaded installer.
  pub cache_dir: PathBuf,
  /// The installation being replaced.
  pub install_dir: Option<PathBuf>,
}

type InstallWindow = Box<dyn Fn(&InstallStarted) + Send + Sync>;

/// What the plugin keeps: the updater, and what runs once the app has quit.
pub struct Shared {
  pub updater: Arc<Updater>,
  exit: Arc<Exit>,
  host: Arc<TauriHost>,
}

#[derive(Default)]
struct Exit {
  action: Mutex<Option<AtExit>>,
  install_window: Mutex<Option<InstallWindow>>,
}

struct TauriHost {
  app: AppHandle,
  exit: Arc<Exit>,
  /// What telemetry has heard of this run's updater (report.rs).
  reported: Mutex<report::Reported>,
}

impl TauriHost {
  /// The state's news for telemetry — once the telemetry is up: until then
  /// nothing counts as heard, and report_state() catches up after its start.
  fn report(&self, state: &UpdateState) {
    let Some(telemetry) = self.app.try_state::<crate::telemetry::Telemetry>() else { return };
    if !telemetry.ready() {
      return;
    }
    let news = self.reported.lock().unwrap().next(state);
    let prefs = self.app.state::<crate::prefs::Prefs>();
    for item in news {
      match item {
        report::Report::Event(name, props) => telemetry.event(&prefs, name, &props),
        report::Report::Error { message, during } => telemetry.error(
          &serde_json::json!({ "name": "UpdateError", "message": message }),
          serde_json::json!({ "source": "updater", "during": during }),
        ),
      }
    }
  }
}

impl Host for TauriHost {
  fn pref(&self, key: &str) -> Option<String> {
    self.app.state::<crate::prefs::Prefs>().get(key)
  }
  fn set_pref(&self, key: &str, value: &str) {
    self.app.state::<crate::prefs::Prefs>().set(key, Some(value));
  }
  fn publish(&self, state: &UpdateState) {
    let _ = self.app.emit(STATE_EVENT, state);
    self.report(state);
  }
  fn open_external(&self, url: &str) {
    crate::shell::open_external(url);
  }
  fn lang(&self) -> crate::texts::Lang {
    crate::texts::lang(&self.app.state::<crate::prefs::Prefs>())
  }
  fn quit(&self, then: AtExit) {
    *self.exit.action.lock().unwrap() = Some(then);
    self.app.exit(0);
  }
}

/// The updater of this app (managed by the plugin).
#[allow(dead_code)]
pub fn get(app: &AppHandle) -> Arc<Updater> {
  app.state::<Shared>().updater.clone()
}

/// The install window (install_window.rs, in place of the Electron shell's C# window): called once
/// the app has quit and the installer runs, before this process ends. Only a
/// nicety — the update goes on the same without it.
#[allow(dead_code)]
/// The updater's state as it stands, for telemetry: called once telemetry has
/// started (lib.rs) — the updater starts before it, so this start being an
/// update would otherwise go unheard.
pub fn report_state(app: &AppHandle) {
  if let Some(shared) = app.try_state::<Shared>() {
    shared.host.report(&shared.updater.state());
  }
}

/// Quits and starts the app again, plainly ("Girovo zurücksetzen", reset.rs) —
/// the way restart_to_update does, after the single-instance plugin has let
/// go, and through the app's own end (leftover.rs), never Tauri's restart.
pub fn relaunch(app: &AppHandle) {
  if let Some(shared) = app.try_state::<Shared>() {
    *shared.exit.action.lock().unwrap() = Some(engine::AtExit::Relaunch(Vec::new()));
  }
  app.exit(0);
}

pub fn set_install_window(app: &AppHandle, show: impl Fn(&InstallStarted) + Send + Sync + 'static) {
  *app.state::<Shared>().exit.install_window.lock().unwrap() = Some(Box::new(show));
}

/// Registers the updater: made at setup (before the app's own setup runs, so
/// the start window finds it), the installer started at RunEvent::Exit.
/// Registered after the single-instance plugin, whose own RunEvent::Exit lets
/// go of its lock first: an app started again from here (restart_to_update,
/// an installer that did not start) is then not taken for a second instance.
pub fn plugin() -> TauriPlugin<tauri::DynRuntime> {
  tauri::plugin::Builder::new("girovo-updater")
    .setup(|app, _api| {
      let exit = Arc::new(Exit::default());
      let host = Arc::new(TauriHost { app: app.clone(), exit: exit.clone(), reported: Mutex::default() });
      let updater = Updater::new(config(app), host.clone());
      updater.start();
      app.manage(Shared { updater, exit, host });
      Ok(())
    })
    .on_event(|app, event| {
      if let RunEvent::Exit = event
        && let Some(shared) = app.try_state::<Shared>()
      {
        shared.at_exit();
      }
    })
    .build()
}

impl Shared {
  fn at_exit(&self) {
    let Some(action) = self.exit.action.lock().unwrap().take() else { return };
    let cfg = self.updater.config();
    let exe = std::env::current_exe().ok();
    engine::run_at_exit(action, exe.as_deref(), spawn_detached, |pid, plan| {
      if let Some(show) = self.exit.install_window.lock().unwrap().as_ref() {
        show(&InstallStarted {
          installer_pid: pid,
          version: plan.version.clone(),
          app_exe: exe.clone(),
          releases_url: cfg.origin.releases_page.clone(),
          cache_dir: cfg.cache_dir.clone(),
          install_dir: cfg.install_dir.clone(),
        });
      }
    });
  }
}

/// The updater's configuration for this copy of the app.
fn config(app: &AppHandle) -> Config {
  // package.json's version (tauri.conf.json takes it from there), so a
  // nightly knows its own stamp; Cargo's stays 6.0.0.
  let version = app.package_info().version.to_string();
  let exe = std::env::current_exe().ok();
  // Only a debug build can be pointed at a test feed (a local server, see
  // tests.rs) — a shipped app always asks GitHub.
  let test_feed = std::env::var("GIROVO_UPDATE_FEED").ok().filter(|f| cfg!(debug_assertions) && !f.is_empty());
  let kind = match (test_feed.as_ref(), std::env::var("GIROVO_UPDATE_KIND").ok().as_deref()) {
    (Some(_), Some("nsis")) => InstallKind::Nsis,
    (Some(_), Some("manual")) => InstallKind::Manual,
    _ => logic::install_kind(!cfg!(debug_assertions), cfg!(windows), exe.as_deref().unwrap_or(Path::new("")), Path::is_file),
  };
  let mut cfg = Config::new(version, kind, cache_dir(test_feed.is_some()));
  cfg.install_dir = exe.as_deref().and_then(Path::parent).map(Path::to_path_buf);
  cfg.update_asked = std::env::args().any(|a| a == UPDATE_ARG);
  if let Some(feed) = test_feed {
    cfg.install_dir = std::env::var_os("GIROVO_UPDATE_INSTALL_DIR").map(PathBuf::from).or(cfg.install_dir);
    cfg.auto_check = true;
    cfg.https_only = false;
    cfg.origin = Origin { download_prefixes: vec![origin_of(&feed)], ..Origin::default() };
    cfg.feed_url = feed;
  }
  cfg
}

/// "http://127.0.0.1:5000/latest" → "http://127.0.0.1:5000/".
fn origin_of(url: &str) -> String {
  let after_scheme = url.find("://").map_or(0, |i| i + 3);
  match url[after_scheme..].find('/') {
    Some(i) => url[..after_scheme + i + 1].to_string(),
    None => format!("{url}/"),
  }
}

/// The Electron shell's folder for it (sooskasse-fints-updater, beside its
/// app-update.yml): out of the roaming profile, which is no place for 300 MB
/// installers — and where an update from 5.x leaves the marker the first
/// Tauri start reads. On Linux the user's own cache folder, never the /tmp
/// every user of the machine can write to: the marker read from there is
/// shown as the app's own words.
fn cache_dir(test: bool) -> PathBuf {
  if test {
    return std::env::temp_dir().join("sooskasse-fints-updater-dev");
  }
  if cfg!(windows) {
    dirs::data_local_dir().unwrap_or_else(std::env::temp_dir).join("sooskasse-fints-updater")
  } else {
    dirs::cache_dir().unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".cache")).join("girovo-updater")
  }
}

/// Starts `file` on its own, so it outlives this process; answers its pid.
fn spawn_detached(file: &Path, args: &[String]) -> std::io::Result<u32> {
  use std::process::{Command, Stdio};
  let mut command = Command::new(file);
  command.args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
  if let Some(dir) = file.parent() {
    command.current_dir(dir);
  }
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
    // Out of a job object the app may run in (a launcher's), which would end
    // the installer with the app; a job that allows no breakaway refuses it.
    command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB);
    if let Ok(child) = command.spawn() {
      return Ok(child.id());
    }
    command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
  }
  command.spawn().map(|child| child.id())
}

type Updates<'a> = tauri::State<'a, Shared>;

#[tauri::command]
pub fn updater_get(s: Updates<'_>) -> UpdateState {
  s.updater.state()
}

#[tauri::command]
pub async fn updater_check(s: Updates<'_>) -> Result<UpdateState, String> {
  Ok(s.updater.check(true).await)
}

/// Answers at once; the download reports through the pushed state.
#[tauri::command]
pub fn updater_download(s: Updates<'_>) -> UpdateState {
  if let Some(job) = s.updater.begin_download() {
    tauri::async_runtime::spawn(job.run());
  }
  s.updater.state()
}

#[tauri::command]
pub fn updater_cancel(s: Updates<'_>) -> UpdateState {
  s.updater.cancel()
}

#[tauri::command]
pub async fn updater_install(s: Updates<'_>) -> Result<UpdateState, String> {
  Ok(s.updater.install().await)
}

#[tauri::command]
pub fn updater_restart(s: Updates<'_>) -> UpdateState {
  s.updater.restart_to_update(std::env::args().skip(1))
}

#[tauri::command]
pub fn updater_set_auto(s: Updates<'_>, on: bool) -> UpdateState {
  s.updater.set_auto(on)
}

#[tauri::command]
pub async fn updater_set_channel(s: Updates<'_>, channel: String) -> Result<UpdateState, String> {
  Ok(s.updater.set_channel(&channel).await)
}

#[tauri::command]
pub fn updater_open_release(s: Updates<'_>) -> UpdateState {
  s.updater.open_release()
}
