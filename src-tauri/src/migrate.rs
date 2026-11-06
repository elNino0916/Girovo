// The first start of the Tauri app on a computer where the Electron app ran
// (6.0): the migration screen, drawn in the start window's card, at least ten
// seconds long (the owner's call, 2026-11-06), saying what is taken over.
//
// Most of it needs no moving: the Tauri shell uses the Electron one's data
// folder as it is (paths.rs) — prefs.json, fints-state/ with every remembered
// device, vault and kept Umsätze. A test run (GIROVO_DATA_DIR) migrates its
// own folder and never the system's settings. What does need doing:
//
//   secret     the shell secret that seals the further banks' PINs, the
//              Windows Hello PIN and the background checks' box was kept with
//              Electron's safeStorage; it is read once and kept with DPAPI
//              (secret.rs). If that fails, those three features are off and
//              the screen says to switch them on again.
//   autostart  "Neue Umsätze melden" had Windows start Girovo hidden at login:
//              an entry naming an executable that is gone is pointed at this
//              one, under the same name, so a "disabled" set in Task Manager
//              stays as it was.
//   cleanup    Chromium's caches the Electron shell left in the data folder:
//              shader and code caches, rebuilt by nothing any more. Only
//              those — never Local State, the PIN-sealed files or prefs.json.
//
// Done once: fints.shell.tauri marks it (also on a computer that never had
// the Electron app, where there is nothing to show).

use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::AppHandle;

use crate::paths::data_root;
use crate::prefs::Prefs;
use crate::splash::{Migrating, Splash};

pub const MARKER: &str = "fints.shell.tauri";
/// The screen stays at least this long (the owner's call).
const SHOWN_AT_LEAST: Duration = Duration::from_secs(10);
/// Each step at least this long, so it can be read.
const STEP_AT_LEAST: Duration = Duration::from_millis(1500);
/// What Electron's Chromium kept in the data folder and nothing reads any more.
const CACHES: [&str; 8] = [
  "Cache", "Code Cache", "GPUCache", "GPUPersistentCache", "GrShaderCache", "ShaderCache", "DawnGraphiteCache", "DawnWebGPUCache",
];
/// The Run entry's name: Electron's setLoginItemSettings used the app's AppUserModelId.
#[cfg(windows)]
const RUN_NAME: &str = "de.elnino0916.sooskasse-fints";

/// Whether this start takes over from the Electron app. On a computer that never had it, marks it done at once.
pub fn needed(prefs: &Prefs) -> bool {
  if prefs.get(MARKER).is_some() {
    return false;
  }
  let root = data_root();
  let had = ["prefs.json", "fints-state", "linked-unlock.key", "Local State"].iter().any(|f| root.join(f).exists());
  if !had {
    prefs.set(MARKER, Some("new"));
  }
  had
}

/// The steps this computer needs, in order.
pub fn steps() -> Vec<&'static str> {
  let mut steps = vec!["found", "settings", "secret"];
  if autostart_entry().is_some() {
    steps.push("autostart");
  }
  if CACHES.iter().any(|c| data_root().join(c).is_dir()) {
    steps.push("cleanup");
  }
  steps.push("starting");
  steps
}

/// Walks the screen through the steps and does each; returns once the screen
/// has stood SHOWN_AT_LEAST and only "Girovo starten" is left at work.
pub fn run(app: &AppHandle, splash: &Arc<Splash>, prefs: &Prefs, steps: Vec<&'static str>) {
  let _ = app;
  // Counted from when the card is in view (it waits for its height first).
  let wait_from = Instant::now();
  while splash.shown_at().is_none() && wait_from.elapsed() < Duration::from_secs(5) {
    std::thread::sleep(Duration::from_millis(50));
  }
  let shown = splash.shown_at().unwrap_or_else(Instant::now);
  let mut secret_failed = false;
  for (at, key) in steps.iter().enumerate() {
    splash.migrating(Some(Migrating { steps: steps.clone(), at, secret_failed }));
    let started = Instant::now();
    match *key {
      "secret" => secret_failed = !take_over_secret(),
      "autostart" => take_over_autostart(),
      "cleanup" => clear_caches(),
      "starting" => break,
      _ => {}
    }
    if let Some(left) = STEP_AT_LEAST.checked_sub(started.elapsed()) {
      std::thread::sleep(left);
    }
  }
  // The last step stays at work until the app's window is there; the screen, at least ten seconds.
  splash.migrating(Some(Migrating { steps: steps.clone(), at: steps.len() - 1, secret_failed }));
  if let Some(left) = SHOWN_AT_LEAST.checked_sub(shown.elapsed()) {
    std::thread::sleep(left);
  }
  prefs.set(MARKER, Some(if secret_failed { "secret-failed" } else { "done" }));
}

/// The shell secret, from Electron's safeStorage to DPAPI (secret.rs). True when
/// nothing needed moving or it moved.
fn take_over_secret() -> bool {
  if !data_root().join("linked-unlock.key").exists() {
    return true;
  }
  crate::secret_migration::take_over()
}

/// Electron's Run entry, when "Neue Umsätze melden" made one and it names an
/// executable that is gone: its value. One that still names a program is left
/// alone — the installer puts the Tauri app where the Electron app was, so the
/// entry already starts it. A test run (GIROVO_DATA_DIR) never touches it.
#[cfg(windows)]
fn autostart_entry() -> Option<String> {
  use windows::Win32::System::Registry::{HKEY_CURRENT_USER, RRF_RT_REG_SZ, RegGetValueW};
  use windows::core::{HSTRING, w};
  if std::env::var_os("GIROVO_DATA_DIR").is_some() {
    return None;
  }
  let name = HSTRING::from(RUN_NAME);
  let mut size: u32 = 0;
  let key = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
  let value = unsafe {
    RegGetValueW(HKEY_CURRENT_USER, key, &name, RRF_RT_REG_SZ, None, None, Some(&mut size)).ok().ok()?;
    let mut buf = vec![0u16; (size as usize).div_ceil(2)];
    RegGetValueW(HKEY_CURRENT_USER, key, &name, RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr().cast()), Some(&mut size)).ok().ok()?;
    String::from_utf16_lossy(&buf).trim_end_matches('\0').to_string()
  };
  // `"C:\…\Girovo.exe" --background`: the path between the quotes.
  let exe = value.trim_start_matches('"').split('"').next().unwrap_or("").to_string();
  (!exe.is_empty() && !std::path::Path::new(&exe).exists()).then_some(value)
}

#[cfg(not(windows))]
fn autostart_entry() -> Option<String> {
  None
}

/// Points Electron's Run entry at this executable, keeping its name and its `--background`.
#[cfg(windows)]
fn take_over_autostart() {
  if autostart_entry().is_none() {
    return;
  }
  use windows::Win32::System::Registry::{HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE, REG_SZ, RegCloseKey, RegOpenKeyExW, RegSetValueExW};
  use windows::core::{HSTRING, w};
  let Ok(exe) = std::env::current_exe() else { return };
  let data = format!("\"{}\" --background", exe.display());
  let wide: Vec<u16> = data.encode_utf16().chain(std::iter::once(0)).collect();
  let bytes = unsafe { std::slice::from_raw_parts(wide.as_ptr().cast::<u8>(), wide.len() * 2) };
  unsafe {
    let mut key = HKEY::default();
    if RegOpenKeyExW(HKEY_CURRENT_USER, w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run"), Some(0), KEY_SET_VALUE, &mut key).is_ok() {
      let _ = RegSetValueExW(key, &HSTRING::from(RUN_NAME), Some(0), REG_SZ, Some(bytes));
      let _ = RegCloseKey(key);
    }
  }
}

#[cfg(not(windows))]
fn take_over_autostart() {}

fn clear_caches() {
  for name in CACHES {
    let dir = data_root().join(name);
    if dir.is_dir() {
      let _ = std::fs::remove_dir_all(dir);
    }
  }
}
