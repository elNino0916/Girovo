// The start window (6.0, Tauri): comes up first and says what the start is
// doing, step by step, with the version; the app's window opens once its page
// has loaded, and this one goes — after at least MIN_VISIBLE, never a flash
// (the owner's call, 2026-10-07). After SLOW_AFTER without the app's window it
// says that the first start after an update or a restart often takes longer.
//
// Ported from the Electron shell's splash.cjs: the same steps and the same card
// (shell/splash.html, served from the binary), the model worked out here and
// drawn there. The first start after the Electron app draws the migration
// screen in the same card first (migrate.rs, `migrating`).

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::texts::{Lang, Migration, Splash as Words};

/// The steps a start goes through, in order (the Electron shell's splash.cjs STEPS).
const STEPS: [&str; 7] = ["finishing", "preparing", "checking", "downloading", "installing", "starting", "opening"];
/// The 440px card and the margins its shadow needs.
const WIDTH: f64 = 440.0 + 2.0 * 28.0;
const SLOW_AFTER: Duration = Duration::from_secs(10);
const MIN_VISIBLE: Duration = Duration::from_secs(2);
pub const LABEL: &str = "splash";

/// The migration screen's state: its steps, which one is at work, what went wrong.
#[derive(Clone)]
pub struct Migrating {
  pub steps: Vec<&'static str>,
  pub at: usize,
  pub secret_failed: bool,
}

struct State {
  lang: Lang,
  version: String,
  dark: bool,
  updated: bool,
  current: &'static str,
  checks: bool,
  update: Option<String>,
  progress: Option<u8>,
  slow: bool,
  migrating: Option<Migrating>,
  shown_at: Option<Instant>,
  closed: bool,
}

pub struct Splash {
  app: AppHandle,
  state: Mutex<State>,
}

fn model(s: &State) -> Value {
  if let Some(m) = &s.migrating {
    let words = Migration::of(s.lang);
    let steps: Vec<Value> = m
      .steps
      .iter()
      .enumerate()
      .map(|(i, key)| {
        let state = if i < m.at { "done" } else if i == m.at { "active" } else { "pending" };
        json!({ "key": key, "label": Migration::step(s.lang, key), "state": state })
      })
      .collect();
    let note = if m.secret_failed { words.secret_failed } else { words.note };
    return json!({ "dark": s.dark, "title": words.title, "version": Words::version(&s.version), "steps": steps, "note": note });
  }
  let words = Words::of(s.lang);
  let steps: Vec<&str> = STEPS
    .iter()
    .copied()
    .filter(|key| match *key {
      "finishing" => s.updated,
      "checking" => s.checks,
      "downloading" | "installing" | "starting" => s.update.is_some(),
      "opening" => s.update.is_none(),
      _ => true,
    })
    .collect();
  let at = steps.iter().position(|k| *k == s.current).unwrap_or(0);
  let steps: Vec<Value> = steps
    .iter()
    .enumerate()
    .map(|(i, key)| {
      let mut label = Words::step(s.lang, key).to_string();
      if *key == "downloading" && s.current == "downloading" {
        if let Some(p) = s.progress {
          label = format!("{label} · {}", Words::progress(s.lang, p));
        }
      }
      let state = if i < at { "done" } else if i == at { "active" } else { "pending" };
      json!({ "key": key, "label": label, "state": state })
    })
    .collect();
  let version = match &s.update {
    Some(to) => Words::version_to(&s.version, to),
    None => Words::version(&s.version),
  };
  json!({
    "dark": s.dark,
    "title": crate::edition::named(if s.update.is_some() { words.title_updating } else { words.title }),
    "edition": crate::edition::edition().id(),
    "version": version,
    "steps": steps,
    "note": if s.slow && s.update.is_none() { Value::String(words.slow.into()) } else { Value::Null },
  })
}

/// The custom protocol's address of the card: Windows has WebView2 map custom schemes to hosts.
fn card_url(model: &Value) -> tauri::Url {
  let hash = urlencoding(&model.to_string());
  let base = if cfg!(windows) { "http://girovo-shell.localhost/splash.html" } else { "girovo-shell://localhost/splash.html" };
  tauri::Url::parse(&format!("{base}#{hash}")).expect("splash url")
}

/// encodeURIComponent, which the card's decodeURIComponent reverses.
fn urlencoding(text: &str) -> String {
  let mut out = String::with_capacity(text.len() * 3);
  for b in text.bytes() {
    if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
      out.push(b as char);
    } else {
      out.push_str(&format!("%{b:02X}"));
    }
  }
  out
}

impl Splash {
  /// Opens the card (hidden until it has its height), and starts the slow-start clock.
  pub fn open(
    app: &AppHandle, lang: Lang, dark: bool, version: String, updated: bool, migrating: Option<Migrating>,
  ) -> tauri::Result<Arc<Splash>> {
    let state = State {
      lang,
      version,
      dark,
      updated,
      current: if updated { "finishing" } else { "preparing" },
      checks: false,
      update: None,
      progress: None,
      slow: false,
      migrating,
      shown_at: None,
      closed: false,
    };
    let url = card_url(&model(&state));
    // Again while a copy that has just quit still holds WebView2's folder (shell.rs).
    crate::shell::build_retrying(|| {
      let mut builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::CustomProtocol(url.clone()));
      if let Some(dir) = crate::shell::webview_dir() {
        builder = builder.data_directory(dir);
      }
      builder
        .title(crate::edition::name())
        .inner_size(WIDTH, 320.0)
        .resizable(false)
        .maximizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .center()
        .visible(false)
        // One WebView2 environment for every window of the app: the same flags
        // as the app's window, or the second one cannot be made (0x8007139F).
        .additional_browser_args(&crate::shell::browser_args())
        .build()
    })?;
    let splash = Arc::new(Splash { app: app.clone(), state: Mutex::new(state) });
    // Closed by the user (Alt+F4): the start gives up on an update at start
    // (updater/start.rs is_open) and opens Girovo as always.
    if let Some(w) = app.get_webview_window(LABEL) {
      let weak = Arc::downgrade(&splash);
      w.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed)
          && let Some(s) = weak.upgrade()
        {
          s.state.lock().unwrap().closed = true;
        }
      });
    }
    let later = splash.clone();
    std::thread::spawn(move || {
      std::thread::sleep(SLOW_AFTER);
      let mut s = later.state.lock().unwrap();
      if s.closed {
        return;
      }
      s.slow = true;
      drop(s);
      later.render();
    });
    Ok(splash)
  }

  fn render(&self) {
    let s = self.state.lock().unwrap();
    if s.closed {
      return;
    }
    let js = format!("window.splash && window.splash.render({})", model(&s));
    drop(s);
    if let Some(w) = self.app.get_webview_window(LABEL) {
      let _ = w.eval(js);
    }
  }

  /// The card's height, from the card itself: the window takes it, still centred where it was.
  pub fn fit(&self, height: f64) {
    let Some(w) = self.app.get_webview_window(LABEL) else { return };
    let scale = w.scale_factor().unwrap_or(1.0);
    let before = w.inner_size().map(|s| s.height as f64 / scale).unwrap_or(height);
    if (before - height).abs() >= 1.0 {
      if let Ok(pos) = w.outer_position() {
        let dy = ((height - before) / 2.0 * scale).round() as i32;
        let _ = w.set_position(tauri::PhysicalPosition::new(pos.x, pos.y - dy));
      }
      let _ = w.set_size(tauri::LogicalSize::new(WIDTH, height));
    }
    let mut s = self.state.lock().unwrap();
    if s.shown_at.is_none() && !s.closed {
      s.shown_at = Some(Instant::now());
      drop(s);
      let _ = w.show();
    }
  }

  pub fn step(&self, key: &'static str) {
    let mut s = self.state.lock().unwrap();
    if s.current == key {
      return;
    }
    s.current = key;
    drop(s);
    self.render();
  }

  /// This start looks for an update: "Nach Updates suchen" is one of its steps.
  pub fn set_checks(&self, on: bool) {
    self.state.lock().unwrap().checks = on;
    self.render();
  }

  /// The version found to install (its download and install become the steps), or None again.
  pub fn set_update(&self, found: Option<String>) {
    let mut s = self.state.lock().unwrap();
    s.update = found;
    s.progress = None;
    drop(s);
    self.render();
  }

  /// How far the download is, 0–100.
  pub fn progress(&self, percent: f64) {
    let p = percent.clamp(0.0, 100.0).floor() as u8;
    let mut s = self.state.lock().unwrap();
    if s.progress == Some(p) {
      return;
    }
    s.progress = Some(p);
    drop(s);
    self.render();
  }

  /// The migration screen: its state now (migrate.rs), or None to go on as the start window.
  pub fn migrating(&self, m: Option<Migrating>) {
    self.state.lock().unwrap().migrating = m;
    self.render();
  }

  /// What the card shows now, for the install window, which takes over looking
  /// the same (the Electron shell's splash.cjs view()): theme, language, title, version
  /// line and the steps with their states.
  pub fn install_view(&self) -> (bool, Lang, String, String, Vec<(String, String)>) {
    let s = self.state.lock().unwrap();
    let m = model(&s);
    let text = |v: &Value| v.as_str().unwrap_or("").to_string();
    let steps = m["steps"].as_array().map(|list| list.iter().map(|st| (text(&st["state"]), text(&st["label"]))).collect()).unwrap_or_default();
    (s.dark, s.lang, text(&m["title"]), text(&m["version"]), steps)
  }

  /// When the card came into view (None until it has).
  pub fn shown_at(&self) -> Option<Instant> {
    self.state.lock().unwrap().shown_at
  }

  /// Blocks until the card has been in view MIN_VISIBLE. A card that never
  /// came into view (it could not say its height) holds nothing up for long.
  pub fn wait_held(&self) {
    let asked = Instant::now();
    loop {
      let (shown, closed) = {
        let s = self.state.lock().unwrap();
        (s.shown_at, s.closed)
      };
      match shown {
        _ if closed => return,
        Some(at) if at.elapsed() >= MIN_VISIBLE => return,
        Some(at) => std::thread::sleep(MIN_VISIBLE - at.elapsed()),
        None if asked.elapsed() > Duration::from_secs(3) => return,
        None => std::thread::sleep(Duration::from_millis(50)),
      }
    }
  }

  /** Whether the start window is still up: neither closed by the start nor by the user. */
  pub fn is_open(&self) -> bool {
    !self.state.lock().unwrap().closed
  }

  pub fn close(&self) {
    self.state.lock().unwrap().closed = true;
    if let Some(w) = self.app.get_webview_window(LABEL) {
      let _ = w.destroy();
    }
  }
}

/// The card says how tall it is (shell/splash.html fit()).
#[tauri::command]
pub fn splash_fit(app: AppHandle, height: f64) {
  if let Some(splash) = app.try_state::<Arc<Splash>>() {
    splash.fit(height.clamp(120.0, 900.0));
  }
}

/// Whether the stored theme, or the system's, is dark (fints.theme; the Electron shell's main.cjs nativeTheme).
pub fn dark(theme_pref: Option<String>) -> bool {
  match theme_pref.as_deref() {
    Some("dark") => true,
    Some("light") => false,
    _ => system_dark(),
  }
}

#[cfg(windows)]
fn system_dark() -> bool {
  use windows::Win32::System::Registry::{HKEY_CURRENT_USER, RRF_RT_REG_DWORD, RegGetValueW};
  use windows::core::w;
  let mut value: u32 = 1;
  let mut size = std::mem::size_of::<u32>() as u32;
  let read = unsafe {
    RegGetValueW(
      HKEY_CURRENT_USER,
      w!("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"),
      w!("AppsUseLightTheme"),
      RRF_RT_REG_DWORD,
      None,
      Some(&mut value as *mut u32 as *mut _),
      Some(&mut size),
    )
  };
  read.is_ok() && value == 0
}

#[cfg(not(windows))]
fn system_dark() -> bool {
  false
}

#[cfg(test)]
mod tests {
  use super::*;

  fn state() -> State {
    State {
      lang: Lang::De,
      version: "6.0.0".into(),
      dark: false,
      updated: false,
      current: "preparing",
      checks: false,
      update: None,
      progress: None,
      slow: false,
      migrating: None,
      shown_at: None,
      closed: false,
    }
  }

  #[test]
  fn a_plain_start_prepares_then_opens() {
    let m = model(&state());
    let keys: Vec<&str> = m["steps"].as_array().unwrap().iter().map(|s| s["key"].as_str().unwrap()).collect();
    assert_eq!(keys, ["preparing", "opening"]);
    assert_eq!(m["title"], "Girovo wird gestartet");
    assert_eq!(m["steps"][0]["state"], "active");
    assert_eq!(m["version"], "Version 6.0.0");
  }

  #[test]
  fn an_update_at_start_downloads_with_progress() {
    let mut s = state();
    s.checks = true;
    s.update = Some("6.0.1".into());
    s.current = "downloading";
    s.progress = Some(42);
    let m = model(&s);
    let keys: Vec<&str> = m["steps"].as_array().unwrap().iter().map(|s| s["key"].as_str().unwrap()).collect();
    assert_eq!(keys, ["preparing", "checking", "downloading", "installing", "starting"]);
    assert_eq!(m["steps"][2]["label"], "Update herunterladen · 42 %");
    assert_eq!(m["title"], "Girovo wird aktualisiert");
    assert_eq!(m["version"], "Version 6.0.0 → 6.0.1");
  }

  #[test]
  fn the_migration_screen_names_its_own_steps() {
    let mut s = state();
    s.migrating = Some(Migrating { steps: vec!["found", "settings", "starting"], at: 1, secret_failed: false });
    let m = model(&s);
    assert_eq!(m["title"], "Girovo zieht um");
    assert_eq!(m["steps"][0]["state"], "done");
    assert_eq!(m["steps"][1]["label"], "Einstellungen übernehmen");
    assert!(m["note"].as_str().unwrap().starts_with("Ab Version 6"));
  }

  #[test]
  fn the_hash_survives_decode_uri_component() {
    assert_eq!(urlencoding("a b→"), "a%20b%E2%86%92");
  }
}
