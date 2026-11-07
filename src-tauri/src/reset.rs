// "Girovo zurücksetzen" (Einstellungen → Dieses Gerät, components/settings/ResetApp.tsx):
// everything Girovo keeps on this computer goes, and it starts again as on
// its first day. The page has logged out and emptied its own storage first.
//
// What goes: the data folder's contents (device profiles, vaults, kept
// Umsätze, the background box, the shell secret, the LAN shelf's folder and
// tokens, the preferences — the Electron shell's leftovers too, in the folder
// it shared), Windows Hello's key in Windows, the start with Windows. What
// stays: the installation, and one preference — the move from the Electron
// app is done, so a fresh start never shows that screen again.
//
// Also here, the smaller deletion: "Gespeicherte Daten löschen" for one login
// takes its sync group's files off the LAN shelf (lan_forget).

use std::fs;
use std::sync::Arc;
use std::sync::atomic::Ordering;

use tauri::{AppHandle, Manager};

use crate::paths::data_root;

/// The preferences a reset leaves: the Electron move, done for good (migrate.rs).
const KEPT: &[(&str, &str)] = &[("fints.shell.tauri", "done")];

#[tauri::command]
pub async fn app_reset(app: AppHandle) -> Result<(), String> {
  // First: nothing the page still writes may land after what follows.
  crate::files::FROZEN.store(true, Ordering::SeqCst);
  app.state::<Arc<crate::sync_lan::LanShelf>>().stop();
  crate::background::set_login_item(false);
  tauri::async_runtime::spawn_blocking(crate::hello::forget).await.map_err(|e| e.to_string())?;
  // The shell secret where it lives beyond the data folder (the keyring on Linux).
  tauri::async_runtime::spawn_blocking(crate::secret::forget).await.map_err(|e| e.to_string())?;

  let root = data_root().to_path_buf();
  let failed = tauri::async_runtime::spawn_blocking(move || empty(&root)).await.map_err(|e| e.to_string())?;
  // In memory as on disk, so nothing writes the old ones back on the way out.
  app.state::<crate::prefs::Prefs>().replace(KEPT);
  if !failed.is_empty() {
    eprintln!("[reset] could not delete: {}", failed.join(", "));
  }
  crate::updater::relaunch(&app);
  Ok(())
}

/// Deletes everything in `root` but a test run's WebView2 folder, which the
/// running window holds (shell::webview_dir). Answers what could not go.
fn empty(root: &std::path::Path) -> Vec<String> {
  let keep_webview = std::env::var_os("GIROVO_DATA_DIR").is_some_and(|d| !d.is_empty());
  let Ok(entries) = fs::read_dir(root) else { return Vec::new() };
  let mut failed = Vec::new();
  for entry in entries.flatten() {
    let name = entry.file_name().to_string_lossy().to_string();
    if keep_webview && name == "webview2" {
      continue;
    }
    let path = entry.path();
    let gone = if path.is_dir() { fs::remove_dir_all(&path) } else { fs::remove_file(&path) };
    if gone.is_err() {
      failed.push(name);
    }
  }
  failed
}

/// "Gespeicherte Daten löschen" (lib/wipe-saved.ts forgetLanGroup): every file
/// of one sync group on the LAN shelf — the list of its devices, their states,
/// its receipts, its token, a write cut short — and nothing of another group.
/// The shelf is this computer, so the group's files are on it, and the page's
/// in-memory tree never sees most of them (files.rs folder_get/folder_put).
/// Answers how many went; an error when one stays.
#[tauri::command]
pub async fn lan_forget(group: String) -> Result<u32, String> {
  let dir = crate::sync_lan::lan_dir();
  tauri::async_runtime::spawn_blocking(move || forget_group(&dir, &group)).await.map_err(|e| e.to_string())?
}

/// The files named `<group>.…` in `dir`, `group` being a sync group's 24 hex digits.
fn forget_group(dir: &std::path::Path, group: &str) -> Result<u32, String> {
  if group.len() != 24 || !group.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
    return Err(format!("not a sync group: {}", group.chars().take(40).collect::<String>()));
  }
  let entries = match fs::read_dir(dir) {
    Ok(entries) => entries,
    Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(0),
    Err(err) => return Err(format!("EIO: {err}")),
  };
  let prefix = format!("{group}.");
  let (mut removed, mut left) = (0u32, 0u32);
  for entry in entries.flatten() {
    if !entry.file_name().to_str().is_some_and(|n| n.starts_with(&prefix)) || !entry.file_type().is_ok_and(|t| t.is_file()) {
      continue;
    }
    let mut attempt = 0;
    loop {
      match fs::remove_file(entry.path()) {
        Ok(()) => removed += 1,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        // The shelf serving it to the phone, a virus scanner: a moment.
        Err(err) if attempt < 5 && crate::files::locked(&err) => {
          std::thread::sleep(std::time::Duration::from_millis(15 << attempt));
          attempt += 1;
          continue;
        }
        Err(_) => left += 1,
      }
      break;
    }
  }
  if left > 0 {
    return Err(format!("EIO: {left} file(s) of the group left"));
  }
  Ok(removed)
}

#[cfg(test)]
mod tests {
  use super::{empty, forget_group};

  #[test]
  fn forgets_one_groups_files_on_the_shelf_and_nothing_else() {
    let dir = std::env::temp_dir().join(format!("girovo-lan-forget-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let ours = "0123456789abcdef01234567";
    let theirs = "fedcba9876543210fedcba98";
    let mine = [
      format!("{ours}.devices"),
      format!("{ours}.0011223344556677.state"),
      format!("{ours}.00112233445566778899aabbccddeeff.doc"),
      format!("{ours}.token"),
      format!("{ours}.devices.1234.5678.tmp"),
    ];
    for name in &mine {
      std::fs::write(dir.join(name), "x").unwrap();
    }
    for name in [format!("{theirs}.devices"), format!("{theirs}.token"), format!("{ours}x.devices")] {
      std::fs::write(dir.join(name), "x").unwrap();
    }
    assert_eq!(forget_group(&dir, ours), Ok(mine.len() as u32));
    let mut left: Vec<String> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    left.sort();
    assert_eq!(left, vec![format!("{ours}x.devices"), format!("{theirs}.devices"), format!("{theirs}.token")]);
    // Again: nothing of it left, nothing to do.
    assert_eq!(forget_group(&dir, ours), Ok(0));
    std::fs::remove_dir_all(&dir).unwrap();
    // No shelf folder at all: nothing to forget.
    assert_eq!(forget_group(&dir, ours), Ok(0));
  }

  #[test]
  fn forgets_nothing_for_what_is_no_group() {
    let dir = std::env::temp_dir();
    for group in ["", "..", "0123456789abcdef0123456", "0123456789ABCDEF01234567", "0123456789abcdef0123/../"] {
      assert!(forget_group(&dir, group).is_err(), "{group}");
    }
  }

  #[test]
  fn empties_the_folder_files_and_folders_alike() {
    let dir = std::env::temp_dir().join(format!("girovo-reset-{}", std::process::id()));
    std::fs::create_dir_all(dir.join("fints-state/lan")).unwrap();
    std::fs::write(dir.join("prefs.json"), "{}").unwrap();
    std::fs::write(dir.join("fints-state/vault.json"), "{}").unwrap();
    std::fs::write(dir.join("fints-state/lan/x.sync"), "x").unwrap();
    assert!(empty(&dir).is_empty());
    assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
    std::fs::remove_dir_all(&dir).unwrap();
  }
}
