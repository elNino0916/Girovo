// Updates installed at start ("Updates automatisch installieren", on unless
// switched off; the installed copy only, never a start with Windows, which
// shows nothing) — the Electron shell's main.cjs updateAtStart, for the start window
// (splash.rs). The check starts beside whatever else the start does
// (start_check); update_at_start then waits for it at most START_CHECK_LIMIT,
// and a newer release this copy can install is downloaded and installed with
// the start window showing how far it is. GitHub out of reach, a failed
// download or nothing new: Girovo opens as always, the app's own update
// notices saying the rest. The way back to an older release only when it was
// asked for ("Neu starten und zurück", --update); otherwise that stays a click.
// So does a release the user stepped back from with an older version from a
// file (PREF_HELD_BACK), and one whose install failed (PREF_FAILED_INSTALL).
// A start window the user closes during the download opens Girovo at once;
// the download goes on behind it.
//
// lib.rs's start() runs on a thread of its own, so the blocking form is what it calls:
//
//   let updater = updater::get(&app);
//   let check = updater.start_check(&*splash);   // before the slow parts of the start
//   …
//   if updater.update_at_start_blocking(check, &*splash) {
//     return; // the app is quitting, and the installer starts once it has
//   }
//
// Until it does, nothing in the crate calls this file (the allow below).
#![allow(dead_code)]

use std::sync::Arc;
use std::time::Duration;

use tauri::async_runtime::{self, JoinHandle};

use super::engine::{PREF_FAILED_INSTALL, Phase, UpdateState, Updater};
use super::logic::{self, InstallKind};
use super::trust;

/// How long a start waits for GitHub's answer before it opens Girovo anyway.
pub const START_CHECK_LIMIT: Duration = Duration::from_secs(6);
/// How often the start's download looks whether the start window is still open.
const WINDOW_LOOK: Duration = Duration::from_millis(150);

/// What update_at_start shows: the start window's own calls (splash.rs).
pub trait StartWindow: Send + Sync {
  /// "checking", "downloading" or "installing".
  fn step(&self, key: &'static str);
  /// "Nach Updates suchen" is one of this start's steps.
  fn set_checks(&self, on: bool);
  /// The version found to install, or None again.
  fn set_update(&self, version: Option<String>);
  /// How far the download is, 0–100.
  fn progress(&self, percent: f64);
  /// False once the user closed the start window: the start gives up on the update quietly.
  fn is_open(&self) -> bool {
    true
  }
}

impl StartWindow for crate::splash::Splash {
  fn step(&self, key: &'static str) {
    crate::splash::Splash::step(self, key);
  }
  fn set_checks(&self, on: bool) {
    crate::splash::Splash::set_checks(self, on);
  }
  fn set_update(&self, version: Option<String>) {
    crate::splash::Splash::set_update(self, version);
  }
  fn progress(&self, percent: f64) {
    crate::splash::Splash::progress(self, percent);
  }
  fn is_open(&self) -> bool {
    crate::splash::Splash::is_open(self)
  }
}

/// The check a start runs for the update at start, already under way.
pub struct StartCheck(JoinHandle<UpdateState>);

impl Updater {
  /// The version whose install did not complete — on this start's marker, or
  /// remembered from an earlier one (the marker is read only once).
  fn failed_install(&self) -> Option<String> {
    self.state().failed_install.or_else(|| self.host_pref(PREF_FAILED_INSTALL)).filter(|v| !v.is_empty())
  }

  fn updates_at_start(&self) -> bool {
    let state = self.state();
    state.kind == InstallKind::Nsis && (state.auto || self.config().update_asked)
  }

  /// Starts the check for the update at start and says so in the window — or
  /// None when this start does not update (not the installed app, or the
  /// switch is off and nobody asked).
  pub fn start_check(self: &Arc<Self>, window: &dyn StartWindow) -> Option<StartCheck> {
    if !self.updates_at_start() {
      return None;
    }
    window.set_checks(true);
    let updater = self.clone();
    // An asked-for start says why it fails; a routine one stays quiet.
    let manual = self.config().update_asked;
    Some(StartCheck(async_runtime::spawn(async move { updater.check(manual).await })))
  }

  /// Installs what `check` found, with the window showing it. True when the
  /// installer is about to run and the app is quitting for it.
  pub async fn update_at_start(self: &Arc<Self>, check: Option<StartCheck>, window: &dyn StartWindow) -> bool {
    let Some(StartCheck(check)) = check else { return false };
    if !window.is_open() || !self.updates_at_start() {
      return false;
    }
    let asked = self.config().update_asked;
    window.step("checking");
    // Too slow: the check goes on behind the app, whose notices say the rest.
    let Ok(Ok(found)) = tokio::time::timeout(START_CHECK_LIMIT, check).await else { return false };
    let Some(release) = found.release.clone() else { return false };
    if !window.is_open()
      // Its install failed on the last start: not again by itself, or a
      // failing installer would quit Girovo at every start. The app opens and
      // says so; installing it again is the user's click.
      || (self.failed_install().as_deref() == Some(release.version.as_str()) && !asked)
      || (release.back && !asked)
      || !release.can_install
      || !matches!(found.phase, Phase::Available | Phase::Ready)
    {
      return false;
    }
    // The user went back to an older version from a file: this release, the
    // one stepped back from or an older one, is not put back unasked. A newer
    // one ends the step back.
    if !asked && logic::held_back(self.held_back(), trust::build_number(&release.version)) {
      return false;
    }
    self.clear_held_back();
    window.set_update(Some(release.version.clone()));
    if found.phase == Phase::Available {
      window.step("downloading");
      let mut states = self.watch();
      // Its own task: a start window closed meanwhile does not cut the download off.
      let updater = self.clone();
      let mut download = async_runtime::spawn(async move { updater.download().await });
      // The window says nothing when it closes, so it is asked now and then.
      let mut look = tokio::time::interval(WINDOW_LOOK);
      let done = loop {
        tokio::select! {
          done = &mut download => break done.ok(),
          changed = states.changed() => {
            if changed.is_err() {
              break (&mut download).await.ok();
            }
            let s = states.borrow_and_update().clone();
            if s.phase == Phase::Downloading && s.total > 0 {
              window.progress(s.received as f64 / s.total as f64 * 100.0);
            }
          }
          _ = look.tick() => {
            // Closed by the user: Girovo opens now, not when the download
            // ends. The download goes on behind it, and the app's own notice
            // offers the restart once it is there.
            if !window.is_open() {
              return false;
            }
          }
        }
      };
      if !window.is_open() {
        return false;
      }
      if done.is_none_or(|s| s.phase != Phase::Ready) {
        window.set_update(None);
        return false;
      }
    }
    window.step("installing");
    if self.install().await.phase == Phase::Installing {
      return true;
    }
    window.set_update(None);
    false
  }

  /// update_at_start for a thread outside the async runtime (lib.rs start()).
  pub fn update_at_start_blocking(self: &Arc<Self>, check: Option<StartCheck>, window: &dyn StartWindow) -> bool {
    async_runtime::block_on(self.update_at_start(check, window))
  }
}
