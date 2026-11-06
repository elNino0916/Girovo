// The updater's state as telemetry (the Electron shell's main.cjs
// reportUpdate): a newer version seen, its download done, this start being an
// update — usage events, sent only with the user's yes — and every new
// failure, sent always like any error. Only what telemetry has not heard yet:
// the state is published at every step (mod.rs TauriHost::publish), and a
// check every six hours finds the same release again.

use serde_json::{Value, json};

use super::engine::{During, Phase, UpdateState};

/// One thing for telemetry.
#[derive(Debug, PartialEq)]
pub enum Report {
  /// A usage event of telemetry.rs's EVENTS, with its fields.
  Event(&'static str, Value),
  /// A failure: its message, and the step it happened in (ERROR_PROPS `during`).
  Error { message: String, during: During },
}

/// What telemetry has heard of this run's updater.
#[derive(Default)]
pub struct Reported {
  phase: Option<Phase>,
  installed: bool,
  /// The version last reported as available, and as downloaded: once each,
  /// however often a check finds it again.
  available: Option<String>,
  downloaded: Option<String>,
  error: Option<String>,
}

impl Reported {
  /// What `state` says that telemetry has not heard yet.
  pub fn next(&mut self, state: &UpdateState) -> Vec<Report> {
    let mut out = Vec::new();
    if let Some(installed) = &state.installed
      && !self.installed
    {
      self.installed = true;
      out.push(Report::Event("update_installed", json!({ "from": installed.from, "to": installed.version })));
    }
    if let Some(release) = &state.release {
      let fresh = |seen: &Option<String>| seen.as_deref() != Some(release.version.as_str());
      // A version not reported yet, however the phases ran to it.
      if state.phase == Phase::Available && fresh(&self.available) {
        self.available = Some(release.version.clone());
        out.push(Report::Event("update_available", json!({ "version": release.version })));
      }
      // A download that ran (not a file kept from before, which is ready at once).
      if state.phase == Phase::Ready && self.phase == Some(Phase::Downloading) && fresh(&self.downloaded) {
        self.downloaded = Some(release.version.clone());
        out.push(Report::Event("update_downloaded", json!({ "version": release.version })));
      }
    }
    self.phase = Some(state.phase);
    let error = state.error.as_ref().map(|e| format!("{:?}:{}", e.during, e.message));
    if let (Some(key), Some(e)) = (&error, &state.error)
      && self.error.as_ref() != Some(key)
    {
      out.push(Report::Error { message: e.message.clone(), during: e.during });
    }
    self.error = error;
    out
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::updater::engine::{ErrorInfo, Installed, PublicRelease};
  use crate::updater::logic::{Channel, InstallKind};

  fn state(phase: Phase, version: Option<&str>) -> UpdateState {
    let mut s = UpdateState {
      current: "6.0.0-preview.1".into(),
      kind: InstallKind::Nsis,
      auto: true,
      channel: Channel::Preview,
      phase,
      checked_at: None,
      release: None,
      received: 0,
      total: 0,
      error: None,
      installed: None,
      failed_install: None,
    };
    s.release = version.map(|v| PublicRelease {
      back: false,
      version: v.into(),
      name: v.into(),
      notes: String::new(),
      url: String::new(),
      published_at: None,
      size: None,
      can_install: true,
    });
    s
  }

  fn names(reports: &[Report]) -> Vec<&str> {
    reports.iter().map(|r| match r { Report::Event(name, _) => *name, Report::Error { .. } => "error" }).collect()
  }

  #[test]
  fn a_release_seen_downloaded_and_installed_is_said_once_each() {
    let mut r = Reported::default();
    assert!(r.next(&state(Phase::Checking, None)).is_empty());
    let seen = r.next(&state(Phase::Available, Some("6.0.0")));
    assert_eq!(seen, vec![Report::Event("update_available", json!({ "version": "6.0.0" }))]);
    assert!(r.next(&state(Phase::Downloading, Some("6.0.0"))).is_empty());
    assert_eq!(names(&r.next(&state(Phase::Ready, Some("6.0.0")))), vec!["update_downloaded"]);

    let mut after = state(Phase::Idle, None);
    after.installed = Some(Installed { version: "6.0.0".into(), from: "5.16.2".into(), notes: String::new(), url: String::new() });
    let mut next_start = Reported::default();
    assert_eq!(next_start.next(&after), vec![Report::Event("update_installed", json!({ "from": "5.16.2", "to": "6.0.0" }))]);
    assert!(next_start.next(&after).is_empty(), "once a run");
  }

  #[test]
  fn the_six_hourly_check_finding_the_same_release_says_nothing_new() {
    let mut r = Reported::default();
    r.next(&state(Phase::Available, Some("6.0.0")));
    for _ in 0..3 {
      assert!(r.next(&state(Phase::Checking, Some("6.0.0"))).is_empty());
      assert!(r.next(&state(Phase::Available, Some("6.0.0"))).is_empty());
    }
    assert_eq!(names(&r.next(&state(Phase::Available, Some("6.0.1")))), vec!["update_available"], "a newer one is news");
  }

  #[test]
  fn a_kept_download_ready_at_once_is_no_download() {
    let mut r = Reported::default();
    assert_eq!(names(&r.next(&state(Phase::Ready, Some("6.0.0")))), Vec::<&str>::new());
  }

  #[test]
  fn a_failure_is_reported_once_until_it_changes() {
    let mut r = Reported::default();
    let mut failed = state(Phase::Available, Some("6.0.0"));
    failed.error = Some(ErrorInfo { during: During::Download, message: "stalled".into() });
    let first = r.next(&failed);
    assert!(first.contains(&Report::Error { message: "stalled".into(), during: During::Download }));
    assert!(!r.next(&failed).iter().any(|x| matches!(x, Report::Error { .. })), "the same failure, published again");
    let mut cleared = failed.clone();
    cleared.error = None;
    r.next(&cleared);
    assert!(r.next(&failed).iter().any(|x| matches!(x, Report::Error { .. })), "back after it had cleared");
  }
}
