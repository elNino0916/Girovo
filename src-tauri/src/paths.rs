// Where Girovo keeps its files: the very folder the Electron shell used, so an
// update from it finds every remembered device, vault and preference where
// they were (the Electron shell's main.cjs, LEGACY_USER_DATA).
//
//   Windows  %APPDATA%\Sooskasse-FinTS if an install up to 4.3 made it, else %APPDATA%\Girovo
//   Linux    ~/.config/Sooskasse-FinTS, else ~/.config/Girovo
//
// Inside it: prefs.json (the page's preferences), fints-state/ (FINTS_STATE_DIR:
// device profiles, vaults, kept Umsätze, the background box, the LAN shelf),
// linked-unlock.key (the shell secret, Electron's safeStorage format until the
// first Tauri start migrates it).

use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

const LEGACY: &str = "Sooskasse-FinTS";
const NAME: &str = "Girovo";

static ROOT: OnceLock<PathBuf> = OnceLock::new();

/// The data folder, made if missing. GIROVO_DATA_DIR replaces it, for test
/// runs that must not touch the real one.
pub fn data_root() -> &'static Path {
  ROOT.get_or_init(|| {
    if let Some(dir) = std::env::var_os("GIROVO_DATA_DIR").filter(|d| !d.is_empty()) {
      let root = PathBuf::from(dir);
      let _ = std::fs::create_dir_all(&root);
      return root;
    }
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    let legacy = base.join(LEGACY);
    let root = if legacy.is_dir() { legacy } else { base.join(NAME) };
    let _ = std::fs::create_dir_all(&root);
    root
  })
}

/// The state folder the route handlers see as /data/fints-state.
pub fn state_dir() -> PathBuf {
  data_root().join("fints-state")
}

/// A path the page names relative to the data folder ("fints-state/x.json"),
/// joined onto it — or None for anything that would leave it: an absolute
/// path, "..", a drive prefix.
pub fn inside_root(relative: &str) -> Option<PathBuf> {
  let rel = Path::new(relative);
  if relative.is_empty() || rel.is_absolute() {
    return None;
  }
  let mut out = data_root().to_path_buf();
  for part in rel.components() {
    match part {
      Component::Normal(p) => out.push(p),
      Component::CurDir => {}
      _ => return None,
    }
  }
  Some(out)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn refuses_paths_out_of_the_root() {
    assert!(inside_root("fints-state/a.json").is_some());
    assert!(inside_root("../x").is_none());
    assert!(inside_root("fints-state/../../x").is_none());
    assert!(inside_root("").is_none());
    assert!(inside_root("C:\\Windows").is_none());
    assert!(inside_root("/etc/passwd").is_none());
  }
}
