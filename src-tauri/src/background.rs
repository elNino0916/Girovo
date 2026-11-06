// "Neue Umsätze melden" in the Tauri shell (lib/background-check.ts): every
// six hours, while Girovo runs — in the window or in the notification area —
// a check of the banks, and what it found as the system's notifications.
// Ported from electron/background.cjs and main.cjs.
//
// The check itself runs in the page now, in the route handler the Electron
// shell asked over HTTP (app/api/background, op "check"): this side keeps
// time, asks the page (event "background:run", desktop/background.ts answers
// with background_result) and shows the notices. The last check and whether
// it is on are preferences, as before; the next one is due six hours after the
// last, and two minutes after a start or a wake from sleep at the earliest. A
// check that could not run is tried again after half an hour.
//
// Time is kept on the wall clock, looked at every half minute: a timer stands
// still while the computer sleeps, the clock does not — so a wake is seen as
// a gap and the next check waits the two minutes the network needs.
//
// While it is on: the icon in the notification area (open, look now, quit),
// closing the window hides it there (and ends the bank session, as quitting
// did), and Windows starts Girovo hidden at login (`--background`).

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::prefs::Prefs;
use crate::texts::{self, Tray as Words};

pub const ON_PREF: &str = "fints.background.on";
const LAST_PREF: &str = "fints.background.last";
const TOLD_PREF: &str = "fints.background.told";
const INTERVAL: u64 = 6 * 60 * 60_000;
const SETTLE: u64 = 2 * 60_000;
const RETRY: u64 = 30 * 60_000;
const TICK: Duration = Duration::from_secs(30);
/// A check of a few banks takes a minute at most; one that never answers must not block the next.
const CHECK_LIMIT: Duration = Duration::from_secs(5 * 60);
const TRAY_ID: &str = "girovo";
/// The Run entry's name: the one Electron's setLoginItemSettings used (migrate.rs).
#[cfg(windows)]
const RUN_NAME: &str = "de.elnino0916.sooskasse-fints";

#[derive(Default)]
pub struct Background {
  /// When the next check is due (ms since the epoch); 0 before the first plan.
  due: AtomicU64,
  /// The check the page is running: its id and since when.
  running: Mutex<Option<(u64, Instant)>>,
  next_id: AtomicU64,
  /// Quitting for real (the tray's "Beenden", an update): closing does not hide.
  pub quitting: AtomicBool,
}

fn now_ms() -> u64 {
  SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Started with Windows for the checks: no start window, the app's window stays hidden.
pub fn started_hidden() -> bool {
  std::env::args().any(|a| a == "--background")
}

pub fn enabled(app: &AppHandle) -> bool {
  app.state::<Prefs>().get(ON_PREF).as_deref() == Some("1")
}

/// Six hours after the last check, and never before the app has settled.
fn due_after_start(prefs: &Prefs) -> u64 {
  let last = prefs.get(LAST_PREF).and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
  (last + INTERVAL).max(now_ms() + SETTLE)
}

/// At the start: the plan, the tray and the start with Windows if it is on, and the clock.
pub fn start(app: &AppHandle) {
  let bg = app.state::<Background>();
  bg.due.store(due_after_start(&app.state::<Prefs>()), Ordering::Relaxed);
  if enabled(app) {
    ensure_tray(app);
    set_login_item(true);
  }
  let handle = app.clone();
  std::thread::spawn(move || {
    let mut last_tick = now_ms();
    loop {
      std::thread::sleep(TICK);
      let now = now_ms();
      let bg = handle.state::<Background>();
      // A gap far longer than the tick: the computer slept. The network needs a moment.
      if now.saturating_sub(last_tick) > 4 * TICK.as_millis() as u64 {
        let due = bg.due.load(Ordering::Relaxed);
        bg.due.store(due.max(now + SETTLE), Ordering::Relaxed);
      }
      last_tick = now;
      // A check the page never answered: tried again later.
      {
        let mut running = bg.running.lock().unwrap();
        if running.is_some_and(|(_, since)| since.elapsed() > CHECK_LIMIT) {
          *running = None;
          bg.due.store(now + RETRY, Ordering::Relaxed);
        }
      }
      if enabled(&handle) && now >= bg.due.load(Ordering::Relaxed) {
        run_now(&handle);
      }
    }
  });
}

/// Asks the page for a check now (a second ask while one runs joins it).
pub fn run_now(app: &AppHandle) {
  let bg = app.state::<Background>();
  let mut running = bg.running.lock().unwrap();
  if running.is_some() {
    return;
  }
  let id = bg.next_id.fetch_add(1, Ordering::Relaxed) + 1;
  *running = Some((id, Instant::now()));
  drop(running);
  let _ = app.emit_to("main", "background:run", id);
}

/// What a notice is: lib/background-check.ts Notice.
#[derive(Deserialize)]
pub struct Notice {
  #[serde(default)]
  title: String,
  #[serde(default)]
  text: String,
  #[serde(default)]
  lines: Vec<String>,
}

#[derive(Deserialize)]
pub struct CheckResult {
  #[serde(default)]
  notices: Vec<Notice>,
  /// False: nothing is kept any more (the last PIN refused, the box gone).
  #[serde(default = "yes")]
  on: bool,
}

fn yes() -> bool {
  true
}

/// The page's answer to a "background:run": the check's result, or none when it could not run.
#[tauri::command]
pub fn background_result(app: AppHandle, id: u64, result: Option<CheckResult>) {
  let bg = app.state::<Background>();
  {
    let mut running = bg.running.lock().unwrap();
    if running.map(|(r, _)| r) != Some(id) {
      return;
    }
    *running = None;
  }
  let Some(result) = result else {
    bg.due.store(now_ms() + RETRY, Ordering::Relaxed);
    return;
  };
  app.state::<Prefs>().set(LAST_PREF, Some(&now_ms().to_string()));
  for notice in &result.notices {
    let body = if notice.lines.is_empty() { notice.text.clone() } else { notice.lines.join("\n") };
    let title = if notice.title.is_empty() { "Girovo".to_string() } else { notice.title.clone() };
    let _ = app.notification().builder().title(title).body(body).show();
  }
  if result.on {
    bg.due.store(now_ms() + INTERVAL, Ordering::Relaxed);
  } else {
    stopped(&app);
  }
}

/// The server says nothing is kept any more: the shell lets go too.
fn stopped(app: &AppHandle) {
  app.state::<Prefs>().set(ON_PREF, None);
  drop_tray(app);
  set_login_item(false);
  // Hidden in the notification area or never shown: without the icon there
  // is no way back to the window, so the app ends instead of running unseen.
  if let Some(w) = app.get_webview_window("main") {
    if !w.is_visible().unwrap_or(true) && !w.is_minimized().unwrap_or(false) {
      quit(app);
    }
  }
}

/// window.electronBackground.set: the switch in Einstellungen (the page keeps or dropped the PINs already).
#[tauri::command]
pub fn background_set(app: AppHandle, on: bool) -> bool {
  app.state::<Prefs>().set(ON_PREF, on.then_some("1"));
  set_login_item(on);
  if on {
    app.state::<Background>().due.store(now_ms() + SETTLE, Ordering::Relaxed);
    ensure_tray(&app);
  } else {
    drop_tray(&app);
  }
  enabled(&app)
}

pub fn show_window(app: &AppHandle) {
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_focus();
  }
}

pub fn quit(app: &AppHandle) {
  app.state::<Background>().quitting.store(true, Ordering::Relaxed);
  app.exit(0);
}

fn ensure_tray(app: &AppHandle) {
  if app.tray_by_id(TRAY_ID).is_some() {
    return;
  }
  let words = Words::of(texts::lang(&app.state::<Prefs>()));
  let built = (|| -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", words.open, true, None::<&str>)?;
    let check = MenuItem::with_id(app, "check", words.check, true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", words.quit, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &check, &PredefinedMenuItem::separator(app)?, &quit_item])?;
    let mut tray = TrayIconBuilder::with_id(TRAY_ID).tooltip(words.tooltip).menu(&menu).show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
      tray = tray.icon(icon.clone());
    }
    tray
      .on_menu_event(|app, event| match event.id().as_ref() {
        "open" => show_window(app),
        "check" => run_now(app),
        "quit" => quit(app),
        _ => {}
      })
      .on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
          show_window(tray.app_handle());
        }
      })
      .build(app)?;
    Ok(())
  })();
  if let Err(err) = built {
    eprintln!("[background] tray: {err}");
  }
}

fn drop_tray(app: &AppHandle) {
  let _ = app.remove_tray_by_id(TRAY_ID);
}

/// Closing the window while the checks are on: it hides in the notification
/// area instead, and the page ends its bank session. Answers whether it did.
pub fn hide_on_close(app: &AppHandle) -> bool {
  if app.state::<Background>().quitting.load(Ordering::Relaxed) || !enabled(app) {
    return false;
  }
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.hide();
  }
  let _ = app.emit_to("main", "window:hidden-to-tray", ());
  ensure_tray(app);
  tell_still_running(app);
  true
}

/// The first time the window closes into the notification area: said, once ever.
fn tell_still_running(app: &AppHandle) {
  let prefs = app.state::<Prefs>();
  if prefs.get(TOLD_PREF).as_deref() == Some("1") {
    return;
  }
  prefs.set(TOLD_PREF, Some("1"));
  let words = Words::of(texts::lang(&prefs));
  let _ = app.notification().builder().title(words.still_title).body(words.still).show();
}

/// Windows: start with the system, hidden, while the checks are on. Written
/// only when it changes — a rewrite would also undo the user switching Girovo
/// off under Task Manager's startup apps. Never from a debug build or a test run.
#[cfg(windows)]
pub fn set_login_item(on: bool) {
  use windows::Win32::System::Registry::{
    HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, REG_SZ, RegCloseKey, RegDeleteValueW, RegOpenKeyExW,
    RegQueryValueExW, RegSetValueExW,
  };
  use windows::core::{HSTRING, w};
  if cfg!(debug_assertions) || std::env::var_os("GIROVO_DATA_DIR").is_some() {
    return;
  }
  let Ok(exe) = std::env::current_exe() else { return };
  let wanted = format!("\"{}\" --background", exe.display());
  let name = HSTRING::from(RUN_NAME);
  unsafe {
    let mut key = HKEY::default();
    if RegOpenKeyExW(HKEY_CURRENT_USER, w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run"), Some(0), KEY_QUERY_VALUE | KEY_SET_VALUE, &mut key).is_err() {
      return;
    }
    let mut size: u32 = 0;
    let exists = RegQueryValueExW(key, &name, None, None, None, Some(&mut size)).is_ok();
    let current = if exists {
      let mut buf = vec![0u16; (size as usize).div_ceil(2)];
      let _ = RegQueryValueExW(key, &name, None, None, Some(buf.as_mut_ptr().cast()), Some(&mut size));
      String::from_utf16_lossy(&buf).trim_end_matches('\0').to_string()
    } else {
      String::new()
    };
    if on && current != wanted {
      let wide: Vec<u16> = wanted.encode_utf16().chain(std::iter::once(0)).collect();
      let bytes = std::slice::from_raw_parts(wide.as_ptr().cast::<u8>(), wide.len() * 2);
      let _ = RegSetValueExW(key, &name, Some(0), REG_SZ, Some(bytes));
    } else if !on && exists {
      let _ = RegDeleteValueW(key, &name);
    }
    let _ = RegCloseKey(key);
  }
}

#[cfg(not(windows))]
pub fn set_login_item(_on: bool) {}
