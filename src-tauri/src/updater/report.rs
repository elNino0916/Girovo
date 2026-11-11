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

impl Report {
  /// Hands this to telemetry (telemetry.rs's hub, which holds it to its
  /// rules) as the Electron shell's reportUpdate did: an event as it is, sent
  /// only with the user's yes; a failure as an "UpdateError" of the updater,
  /// with the step it happened in, sent always, its message scrubbed.
  pub fn send(self, event: impl FnOnce(&'static str, &Value), error: impl FnOnce(&Value, Value)) {
    match self {
      Report::Event(name, props) => event(name, &props),
      Report::Error { message, during } => {
        error(&json!({ "name": "UpdateError", "message": message }), json!({ "source": "updater", "during": during }))
      }
    }
  }
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
  use crate::updater::logic::InstallKind;

  fn state(phase: Phase, version: Option<&str>) -> UpdateState {
    let mut s = UpdateState {
      current: "6.0.0-preview.1".into(),
      kind: InstallKind::Nsis,
      auto: true,
      early: false,
      file: None,
      saving: None,
      channel: "preview".into(),
      channels: Vec::new(),
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
      waits_for_user: false,
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

  // ---- through telemetry.rs's hub, as mod.rs hands the reports over ----------

  use std::cell::RefCell;
  use std::collections::HashMap;
  use std::sync::{Arc, Mutex};

  use serde_json::Map;

  use crate::telemetry::{BoxFuture, CONSENT_PREF, Hub, Sdk, Store};
  use crate::telemetry_scrub::Scrubbed;
  use crate::texts::Lang;
  use crate::updater::texts::texts;

  /// The client, recording what would go out.
  #[derive(Default)]
  struct Sent(Mutex<Vec<Value>>);

  impl Sdk for Sent {
    fn identify(&self, _id: Option<String>) {}
    fn capture_error(&self, e: &Scrubbed, props: Map<String, Value>) {
      self.0.lock().unwrap().push(json!(["error", e.name, e.message, props]));
    }
    fn track(&self, name: &str, props: Map<String, Value>) {
      self.0.lock().unwrap().push(json!(["event", name, props]));
    }
    fn metric(&self, name: &str, value: Value, props: Map<String, Value>) {
      self.0.lock().unwrap().push(json!(["metric", name, value, props]));
    }
    fn shutdown(&self) -> BoxFuture<'_> {
      Box::pin(async {})
    }
  }

  #[derive(Default)]
  struct Prefs(RefCell<HashMap<String, String>>);

  impl Store for Prefs {
    fn get(&self, key: &str) -> Option<String> {
      self.0.borrow().get(key).cloned()
    }
    fn set(&self, key: &str, value: &str) {
      self.0.borrow_mut().insert(key.into(), value.into());
    }
    fn del(&self, key: &str) {
      self.0.borrow_mut().remove(key);
    }
  }

  /// An updater's run — a release found, downloaded, a download that failed
  /// its digest, an install that failed, a manual check that failed — and the
  /// next start, an update; what telemetry sends of it with the consent given.
  fn run_through_telemetry(consent: Option<&str>) -> Vec<Value> {
    let prefs = Prefs::default();
    if let Some(consent) = consent {
      prefs.set(CONSENT_PREF, consent);
    }
    let sent = Arc::new(Sent::default());
    let hub = Hub::new(Some(sent.clone() as Arc<dyn Sdk>), &prefs, || "install-id".into());
    let say = texts(Lang::De);
    let failed = |phase, during, message: &str| {
      let mut s = state(phase, Some("6.0.1"));
      s.error = Some(ErrorInfo { during, message: message.into() });
      s
    };
    let mut after = state(Phase::Idle, None);
    after.installed = Some(Installed { version: "6.0.1".into(), from: "6.0.0-nightly.202611070217.gabc1234".into(), notes: String::new(), url: String::new() });
    let states = [
      state(Phase::Checking, None),
      state(Phase::Available, Some("6.0.1")),
      state(Phase::Downloading, Some("6.0.1")),
      failed(Phase::Available, During::Download, say.digest_mismatch),
      state(Phase::Downloading, Some("6.0.1")),
      state(Phase::Ready, Some("6.0.1")),
      failed(Phase::Ready, During::Install, r"C:\Users\erika\AppData\Local\sooskasse-fints-updater: Zugriff verweigert"),
      failed(Phase::Ready, During::Check, say.check_failed),
    ];
    let mut reported = Reported::default();
    for s in &states {
      for item in reported.next(s) {
        item.send(|name, props| hub.event(&prefs, name, props), |raw, place| hub.error(raw, &place));
      }
    }
    for item in Reported::default().next(&after) {
      item.send(|name, props| hub.event(&prefs, name, props), |raw, place| hub.error(raw, &place));
    }
    sent.0.lock().unwrap().clone()
  }

  #[test]
  fn update_failures_go_out_without_the_yes_scrubbed_with_their_step() {
    let errors = vec![
      json!(["error", "UpdateError", texts(Lang::De).digest_mismatch, { "source": "updater", "during": "download" }]),
      json!(["error", "UpdateError", r"C:\Users\~\AppData\Local\sooskasse-fints-updater: Zugriff verweigert", { "source": "updater", "during": "install" }]),
      json!(["error", "UpdateError", texts(Lang::De).check_failed, { "source": "updater", "during": "check" }]),
    ];
    for consent in [None, Some("off")] {
      assert_eq!(run_through_telemetry(consent), errors, "consent {consent:?}: the events wait for the yes");
    }
  }

  #[test]
  fn with_the_yes_the_update_events_go_out_with_their_fields() {
    let sent = run_through_telemetry(Some("on"));
    let events: Vec<&Value> = sent.iter().filter(|v| v[0] == "event").collect();
    assert_eq!(
      events,
      vec![
        &json!(["event", "update_available", { "version": "6.0.1" }]),
        &json!(["event", "update_downloaded", { "version": "6.0.1" }]),
        &json!(["event", "update_installed", { "from": "6.0.0-nightly.202611070217.gabc1234", "to": "6.0.1" }]),
      ]
    );
    assert_eq!(sent.iter().filter(|v| v[0] == "error").count(), 3, "the failures as without the yes");
  }
}
