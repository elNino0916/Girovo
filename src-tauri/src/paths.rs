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
// On Linux an Electron folder counts only once something is kept in it (its
// fints-state is not empty): a 5.x that was merely opened leaves prefs.json
// and nothing to take over, and must not win over a 6.x folder in full use.
// And the choice is made once: the folder chosen gets a marker file
// (ROOT_MARKER), and a folder that carries it is the one from then on — a 5.x
// tried out later beside a 6.x never moves the 6.x to another folder.
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

/// Linux: marks the folder this app chose, once and for good. Empty; "Girovo
/// zurücksetzen" leaves it where it is (reset.rs).
pub const ROOT_MARKER: &str = ".girovo6-root";

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
    // Windows as ever: its two folders were never told apart by 5.x and 6.x.
    if cfg!(windows) {
      let root = pick_root(&base, ELECTRON, |_| false, |dir| dir.join("fints-state").is_dir() || dir.join("prefs.json").is_file());
      let _ = std::fs::create_dir_all(&root);
      return root;
    }
    let root = pick_root(&base, ELECTRON, |dir| dir.join(ROOT_MARKER).is_file(), keeps_state);
    let _ = std::fs::create_dir_all(&root);
    mark(&root);
    root
  })
}

/// The data folder under `base`: one that carries the marker, else the first
/// of the Electron app's that holds data, else the app's own. An Electron
/// folder with nothing of Girovo's in it (Chromium's leftovers alone) is no
/// reason to leave the app's own. Should several carry the marker (a folder
/// copied by hand), the same order decides among them.
fn pick_root(base: &Path, electron: &[&str], marked: impl Fn(&Path) -> bool, has_data: impl Fn(&Path) -> bool) -> PathBuf {
  let own = base.join(NAME);
  let electrons = || electron.iter().map(|name| base.join(name));
  electrons().chain([own.clone()]).find(|dir| marked(dir)).or_else(|| electrons().find(|dir| has_data(dir))).unwrap_or(own)
}

/// Whether something is kept in `dir`: its fints-state is there and not
/// empty. prefs.json alone is a copy that was opened and never used.
fn keeps_state(dir: &Path) -> bool {
  std::fs::read_dir(dir.join("fints-state")).is_ok_and(|mut entries| entries.next().is_some())
}

/// Leaves the marker in the folder chosen, unless it is there. A folder that
/// cannot be written to starts all the same: it is chosen again by its data.
fn mark(root: &Path) {
  let marker = root.join(ROOT_MARKER);
  if !marker.exists() {
    let _ = std::fs::write(marker, b"");
  }
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

  fn picked_among(marked: &[&str], with_data: &[&str]) -> PathBuf {
    let base = Path::new("cfg");
    let one_of = |names: &[&str], dir: &Path| names.iter().any(|name| base.join(name) == dir);
    pick_root(base, LINUX, |dir| one_of(marked, dir), |dir| one_of(with_data, dir))
  }

  fn picked(with_data: &[&str]) -> PathBuf {
    picked_among(&[], with_data)
  }

  /// A folder of this test's own under the system's temp folder.
  fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("girovo-paths-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
  }

  /// The rule as data_root() applies it on Linux, on the real disk — with
  /// Electron's oldest name alone: where these tests also run, on Windows,
  /// "girovo" and "Girovo" are one folder.
  fn picked_on_disk(base: &Path) -> PathBuf {
    pick_root(base, &[LEGACY], |dir| dir.join(ROOT_MARKER).is_file(), keeps_state)
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
  fn a_copy_of_5_that_was_only_opened_does_not_count_as_data() {
    let base = temp("opened");
    // 5.x opened once: its preferences, and a state folder with nothing in it.
    let electron = base.join(LEGACY);
    std::fs::create_dir_all(electron.join("fints-state")).unwrap();
    std::fs::write(electron.join("prefs.json"), "{}").unwrap();
    assert!(!keeps_state(&electron));
    // 6.x in full use beside it.
    let own = base.join("Girovo");
    std::fs::create_dir_all(own.join("fints-state")).unwrap();
    std::fs::write(own.join("fints-state").join("vault.json"), "{}").unwrap();
    assert_eq!(picked_on_disk(&base), own);
    // Preferences alone, without a state folder, count as little; no folder at all, neither.
    std::fs::remove_dir_all(electron.join("fints-state")).unwrap();
    assert!(!keeps_state(&electron));
    assert!(!keeps_state(&base.join("never-there")));
    assert_eq!(picked_on_disk(&base), own);
    // Once 5.x has kept something, its folder is the one to take over.
    std::fs::create_dir_all(electron.join("fints-state")).unwrap();
    std::fs::write(electron.join("fints-state").join("profile-12030000.json"), "{}").unwrap();
    assert!(keeps_state(&electron));
    assert_eq!(picked_on_disk(&base), electron);
    std::fs::remove_dir_all(&base).unwrap();
  }

  #[test]
  fn the_folder_chosen_once_stays_whatever_comes_later() {
    // 6.x in its own folder; a 5.x tried out later fills Electron's.
    assert_eq!(picked_among(&["Girovo"], &["girovo"]), Path::new("cfg").join("Girovo"));
    assert_eq!(picked_among(&["Girovo"], &["Sooskasse-FinTS", "girovo"]), Path::new("cfg").join("Girovo"));
    // Electron's, chosen at the update from 5.x, stays too.
    assert_eq!(picked_among(&["girovo"], &["Sooskasse-FinTS"]), Path::new("cfg").join("girovo"));
    assert_eq!(picked_among(&["girovo"], &[]), Path::new("cfg").join("girovo"));
    // Several marked (a folder copied by hand): the order as without markers.
    assert_eq!(picked_among(&["girovo", "Girovo"], &[]), Path::new("cfg").join("girovo"));
    assert_eq!(picked_among(&["Sooskasse-FinTS", "Girovo"], &["girovo"]), Path::new("cfg").join("Sooskasse-FinTS"));
  }

  #[test]
  fn the_marker_is_written_once_and_decides_the_next_start() {
    let base = temp("marker");
    // The first start of 6.x on a new computer: its own folder, marked.
    let own = picked_on_disk(&base);
    assert_eq!(own, base.join("Girovo"));
    std::fs::create_dir_all(&own).unwrap();
    mark(&own);
    assert!(own.join(ROOT_MARKER).is_file());
    // 5.x tried out and used: its folder has data now, and 6.x stays where it is.
    std::fs::create_dir_all(base.join(LEGACY).join("fints-state")).unwrap();
    std::fs::write(base.join(LEGACY).join("fints-state").join("vault.json"), "{}").unwrap();
    assert!(keeps_state(&base.join(LEGACY)));
    assert_eq!(picked_on_disk(&base), own);
    // Marking again changes nothing; a folder that is not there is no failure.
    mark(&own);
    mark(&base.join("missing"));
    assert!(!base.join("missing").exists());
    std::fs::remove_dir_all(&base).unwrap();
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
