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

#[cfg(test)]
mod tests {
  use super::empty;

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
