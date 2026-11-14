// Where Girovo MCP lies (mcp-helper/, docs/girovo-api.md phase 3), for
// Einstellungen → Girovo API: the path an assistant's configuration names as
// its "command".
//
// The bundle puts it beside the app (externalBin): girovo-mcp.exe beside
// Girovo.exe on Windows, girovo-mcp beside girovo in /usr/bin from the deb.
// An AppImage runs from a mount that has another path each start, so a path
// into it would be gone tomorrow: there the helper is copied into Girovo's
// data folder, and again whenever this copy of Girovo carries another one.

#[cfg(target_os = "linux")]
use std::path::Path;
use std::path::PathBuf;

const NAME: &str = if cfg!(windows) { "girovo-mcp.exe" } else { "girovo-mcp" };

/// The helper beside this program, or None (a build without it, or a platform without one).
fn beside_app() -> Option<PathBuf> {
  let exe = std::env::current_exe().ok()?;
  let helper = exe.parent()?.join(NAME);
  helper.is_file().then_some(helper)
}

/// The AppImage's helper copied to `dir`, unless the copy there is the same already.
#[cfg(target_os = "linux")]
fn kept_copy(helper: &Path, dir: &Path) -> Option<PathBuf> {
  use std::os::unix::fs::PermissionsExt;
  let to = dir.join(NAME);
  let bytes = std::fs::read(helper).ok()?;
  if std::fs::read(&to).ok().as_deref() != Some(bytes.as_slice()) {
    // Written aside and renamed into place: an assistant running the old one keeps it until it ends.
    let temp = dir.join(format!(".{NAME}.{}.tmp", std::process::id()));
    std::fs::write(&temp, &bytes).ok()?;
    let placed = std::fs::set_permissions(&temp, std::fs::Permissions::from_mode(0o755)).and_then(|_| std::fs::rename(&temp, &to));
    if placed.is_err() {
      let _ = std::fs::remove_file(&temp);
      return None;
    }
  }
  Some(to)
}

fn path_for(helper: PathBuf) -> Option<PathBuf> {
  #[cfg(target_os = "linux")]
  if std::env::var_os("APPIMAGE").is_some() {
    return kept_copy(&helper, crate::paths::data_root());
  }
  Some(helper)
}

/// The full path of Girovo MCP on this computer; null where there is none.
#[tauri::command(async)]
pub fn api_mcp_path() -> Option<String> {
  path_for(beside_app()?).map(|p| p.to_string_lossy().into_owned())
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
  use super::*;

  #[test]
  fn the_appimage_copy_is_kept_and_refreshed() {
    let dir = std::env::temp_dir().join(format!("girovo-mcp-path-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let source = dir.join("source");
    std::fs::write(&source, b"one").unwrap();
    let copy = kept_copy(&source, &dir).unwrap();
    assert_eq!(std::fs::read(&copy).unwrap(), b"one");
    std::fs::write(&source, b"two").unwrap();
    assert_eq!(std::fs::read(kept_copy(&source, &dir).unwrap()).unwrap(), b"two");
    let _ = std::fs::remove_dir_all(&dir);
  }
}
