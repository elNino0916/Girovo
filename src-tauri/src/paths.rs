// Where Girovo keeps its files: the very folder the Electron shell used, so an
// update from it finds every remembered device, vault and preference where
// they were (the Electron shell's main.cjs, LEGACY_USER_DATA).
//
//   Windows  %APPDATA%\Sooskasse-FinTS if an install up to 4.3 made it, else %APPDATA%\Girovo
//   Linux    ~/.config/girovo if the Electron app left its data there, else ~/.config/Girovo
//
// Electron named its folder after package.json's name, not the product's:
// "girovo" on Linux, in lower case, for every version it was built for there
// (5.3 to 5.16). 6.0.0 to 6.0.3 looked for "Girovo" and so started empty after
// an update (a user's report, 2026-11-10). Where both are there now, Electron's
// wins: it has the names, the banks and the rules; the one a 6.0 made stays
// where it is, untouched and unused. Windows does not tell the two apart.
//
// Inside it: prefs.json (the page's preferences), fints-state/ (FINTS_STATE_DIR:
// device profiles, vaults, kept Umsätze, the background box, the LAN shelf),
// linked-unlock.key (the shell secret, Electron's safeStorage format until the
// first Tauri start migrates it).

use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

const LEGACY: &str = "Sooskasse-FinTS";
const NAME: &str = "Girovo";
/// The folders the Electron app kept its data in, the first that has any wins.
#[cfg(windows)]
const ELECTRON: &[&str] = &[LEGACY];
#[cfg(not(windows))]
const ELECTRON: &[&str] = &[LEGACY, "girovo"];

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
    let root = pick_root(&base, ELECTRON, |dir| dir.join("fints-state").is_dir() || dir.join("prefs.json").is_file());
    let _ = std::fs::create_dir_all(&root);
    root
  })
}

/// The data folder under `base`: the first of the Electron app's that holds
/// data, else the app's own. An Electron folder with nothing of Girovo's in it
/// (Chromium's leftovers alone) is no reason to leave the app's own.
fn pick_root(base: &Path, electron: &[&str], has_data: impl Fn(&Path) -> bool) -> PathBuf {
  electron.iter().map(|name| base.join(name)).find(|dir| has_data(dir)).unwrap_or_else(|| base.join(NAME))
}

/// Girovo's other folders beside the one in use: on Linux the one a 6.0.0 to
/// 6.0.3 made next to Electron's (or Electron's without data). Nothing reads
/// them; "Girovo zurücksetzen" deletes them too (reset.rs). None on Windows,
/// none in a test run.
pub fn unused_roots() -> Vec<PathBuf> {
  if cfg!(windows) || std::env::var_os("GIROVO_DATA_DIR").is_some_and(|d| !d.is_empty()) {
    return Vec::new();
  }
  let Some(base) = dirs::config_dir() else { return Vec::new() };
  others(&base, ELECTRON, data_root()).into_iter().filter(|dir| dir.is_dir()).collect()
}

/// Every folder Girovo may have under `base` but `used`.
fn others(base: &Path, electron: &[&str], used: &Path) -> Vec<PathBuf> {
  electron.iter().copied().chain([NAME]).map(|name| base.join(name)).filter(|dir| dir != used).collect()
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

  /// Linux's list, tested everywhere.
  const LINUX: &[&str] = &[LEGACY, "girovo"];

  fn picked(with_data: &[&str]) -> PathBuf {
    let base = Path::new("cfg");
    pick_root(base, LINUX, |dir| with_data.iter().any(|name| base.join(name) == dir))
  }

  #[test]
  fn linux_takes_the_electron_apps_folder_where_it_has_data() {
    // A new install, and one a 6.0 started: the app's own.
    assert_eq!(picked(&[]), Path::new("cfg").join("Girovo"));
    assert_eq!(picked(&["Girovo"]), Path::new("cfg").join("Girovo"));
    // An update from 5.x, and one a 6.0 already started empty: Electron's.
    assert_eq!(picked(&["girovo"]), Path::new("cfg").join("girovo"));
    assert_eq!(picked(&["girovo", "Girovo"]), Path::new("cfg").join("girovo"));
    // The oldest name first.
    assert_eq!(picked(&["Sooskasse-FinTS", "girovo"]), Path::new("cfg").join("Sooskasse-FinTS"));
  }

  #[test]
  fn the_folder_in_use_is_never_among_the_others() {
    let base = Path::new("cfg");
    assert_eq!(others(base, LINUX, &base.join("girovo")), [base.join("Sooskasse-FinTS"), base.join("Girovo")]);
    assert_eq!(others(base, LINUX, &base.join("Girovo")), [base.join("Sooskasse-FinTS"), base.join("girovo")]);
  }

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
