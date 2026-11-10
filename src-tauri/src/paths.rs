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
// On Linux, in this order: an Electron folder that keeps something (its
// fints-state is not empty); else the app's own if that keeps something — a
// 5.x that was merely opened leaves prefs.json and nothing to take over, and
// must not win over a 6.x folder in full use; else an Electron folder as 6.0.4
// chose it (a fints-state folder or prefs.json), so nobody who started 6.0.4
// there is moved; else the app's own. And the choice is made once: the folder
// chosen gets a marker file (ROOT_MARKER), and a folder that carries it is the
// one from then on — a 5.x tried out later beside a 6.x never moves the 6.x
// to another folder. A folder that is there and cannot be looked into (its
// rights, a network home that hiccups) counts as keeping something, and that
// start leaves no marker: one bad look must not decide for good.
//
// Inside it: prefs.json (the page's preferences), fints-state/ (FINTS_STATE_DIR:
// device profiles, vaults, kept Umsätze, the background box, the LAN shelf),
// linked-unlock.key (the shell secret, Electron's safeStorage format until the
// first Tauri start migrates it).

use std::cell::Cell;
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
    // Windows as ever: its two folders were never told apart by 5.x and 6.x,
    // so only the rule 6.0.4 had is left of the list, and no marker.
    if cfg!(windows) {
      let (root, _) = pick_root(&base, ELECTRON, |_| Some(false), |_| Some(false), has_anything);
      let _ = std::fs::create_dir_all(&root);
      return root;
    }
    let (root, sure) = pick_root(&base, ELECTRON, has_marker, keeps_state, has_anything);
    let _ = std::fs::create_dir_all(&root);
    if sure {
      mark(&root);
    }
    root
  })
}

/// The data folder under `base`, and whether the choice is sure (every folder
/// asked about could be looked into). In this order:
///
///   0. a folder that carries the marker (several — a folder copied by hand —
///      in the order of this list: Electron's, then the app's own);
///   1. an Electron folder that keeps something;
///   2. the app's own, if it keeps something;
///   3. an Electron folder as 6.0.4 chose it (`used`: anything of Girovo's in it);
///   4. the app's own.
///
/// `marked` and `keeps` answer None for a folder they could not look into:
/// such a folder has no marker to go by and counts as keeping something, and
/// the choice is not sure. An Electron folder with nothing of Girovo's in it
/// (Chromium's leftovers alone) is no reason to leave the app's own.
fn pick_root(
  base: &Path,
  electron: &[&str],
  marked: impl Fn(&Path) -> Option<bool>,
  keeps: impl Fn(&Path) -> Option<bool>,
  used: impl Fn(&Path) -> bool,
) -> (PathBuf, bool) {
  let sure = Cell::new(true);
  let or_unsure = |found: Option<bool>, if_unknown: bool| {
    found.unwrap_or_else(|| {
      sure.set(false);
      if_unknown
    })
  };
  let own = base.join(NAME);
  let electrons = || electron.iter().map(|name| base.join(name));
  let root = None
    .or_else(|| electrons().chain([own.clone()]).find(|dir| or_unsure(marked(dir), false)))
    .or_else(|| electrons().find(|dir| or_unsure(keeps(dir), true)))
    .or_else(|| or_unsure(keeps(&own), true).then(|| own.clone()))
    .or_else(|| electrons().find(|dir| used(dir)))
    .unwrap_or_else(|| own.clone());
  (root, sure.get())
}

/// Whether `dir` carries the marker; None when that cannot be told (the
/// folder is there and cannot be looked into).
fn has_marker(dir: &Path) -> Option<bool> {
  match std::fs::metadata(dir.join(ROOT_MARKER)) {
    Ok(meta) => Some(meta.is_file()),
    Err(err) if err.kind() == std::io::ErrorKind::NotFound => Some(false),
    Err(_) => None,
  }
}

/// Whether something is kept in `dir`: its fints-state is there and not
/// empty. prefs.json alone is a copy that was opened and never used. None
/// when the folder is there and cannot be listed.
fn keeps_state(dir: &Path) -> Option<bool> {
  match std::fs::read_dir(dir.join("fints-state")) {
    Ok(mut entries) => match entries.next() {
      None => Some(false),
      Some(Ok(_)) => Some(true),
      Some(Err(_)) => None,
    },
    Err(err) if err.kind() == std::io::ErrorKind::NotFound => Some(false),
    Err(_) => None,
  }
}

/// 6.0.4's rule for an Electron folder: anything of Girovo's in it, its state
/// folder or its preferences.
fn has_anything(dir: &Path) -> bool {
  dir.join("fints-state").is_dir() || dir.join("prefs.json").is_file()
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

  /// The folders under "cfg" by name: which carry the marker, which keep
  /// something, which have only their preferences, which cannot be looked into.
  #[derive(Default)]
  struct Folders<'a> {
    marked: &'a [&'a str],
    keep: &'a [&'a str],
    prefs_only: &'a [&'a str],
    unreadable: &'a [&'a str],
  }

  impl Folders<'_> {
    fn pick(&self) -> (PathBuf, bool) {
      let base = Path::new("cfg");
      let one_of = |names: &[&str], dir: &Path| names.iter().any(|name| base.join(name) == dir);
      pick_root(
        base,
        LINUX,
        |dir| (!one_of(self.unreadable, dir)).then(|| one_of(self.marked, dir)),
        |dir| (!one_of(self.unreadable, dir)).then(|| one_of(self.keep, dir)),
        |dir| one_of(self.keep, dir) || one_of(self.prefs_only, dir),
      )
    }

    /// The folder chosen, the choice being sure.
    fn picked(&self) -> PathBuf {
      let (root, sure) = self.pick();
      assert!(sure);
      root
    }
  }

  fn cfg(name: &str) -> PathBuf {
    Path::new("cfg").join(name)
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
    let (root, sure) = pick_root(base, &[LEGACY], has_marker, keeps_state, has_anything);
    assert!(sure);
    root
  }

  #[test]
  fn row_1_an_electron_folder_that_keeps_something_comes_first() {
    // An update from 5.x.
    assert_eq!(Folders { keep: &["girovo"], ..Default::default() }.picked(), cfg("girovo"));
    // One a 6.0.0 to 6.0.3 started empty beside it, and has used since: Electron's all the same.
    assert_eq!(Folders { keep: &["girovo", "Girovo"], ..Default::default() }.picked(), cfg("girovo"));
    assert_eq!(Folders { keep: &["girovo"], prefs_only: &["Girovo"], ..Default::default() }.picked(), cfg("girovo"));
    // The oldest name first.
    assert_eq!(Folders { keep: &["Sooskasse-FinTS", "girovo"], ..Default::default() }.picked(), cfg("Sooskasse-FinTS"));
    // One that keeps something before an older name that was only opened.
    assert_eq!(Folders { keep: &["girovo"], prefs_only: &["Sooskasse-FinTS"], ..Default::default() }.picked(), cfg("girovo"));
  }

  #[test]
  fn row_2_the_apps_own_that_keeps_something_beats_an_electron_folder_only_opened() {
    // 6.x in full use; a 5.x opened once beside it left its preferences.
    assert_eq!(Folders { keep: &["Girovo"], prefs_only: &["girovo"], ..Default::default() }.picked(), cfg("Girovo"));
    assert_eq!(Folders { keep: &["Girovo"], prefs_only: &["Sooskasse-FinTS", "girovo"], ..Default::default() }.picked(), cfg("Girovo"));
    assert_eq!(Folders { keep: &["Girovo"], ..Default::default() }.picked(), cfg("Girovo"));
  }

  #[test]
  fn row_3_an_electron_folder_6_0_4_chose_stays_while_nothing_else_keeps_anything() {
    // 5.x, then 6.0.4, never a login kept: its theme, language, terms and channel are there.
    assert_eq!(Folders { prefs_only: &["girovo"], ..Default::default() }.picked(), cfg("girovo"));
    // Beside an own folder that keeps nothing either (a 6.0.0 to 6.0.3 opened once).
    assert_eq!(Folders { prefs_only: &["girovo", "Girovo"], ..Default::default() }.picked(), cfg("girovo"));
    assert_eq!(Folders { prefs_only: &["Sooskasse-FinTS", "girovo"], ..Default::default() }.picked(), cfg("Sooskasse-FinTS"));
  }

  #[test]
  fn row_4_the_apps_own_where_there_is_nothing_else() {
    // A new install, and one a 6.x opened without keeping anything.
    assert_eq!(Folders::default().picked(), cfg("Girovo"));
    assert_eq!(Folders { prefs_only: &["Girovo"], ..Default::default() }.picked(), cfg("Girovo"));
  }

  #[test]
  fn the_folder_chosen_once_stays_whatever_comes_later() {
    // 6.x in its own folder; a 5.x tried out later fills Electron's.
    assert_eq!(Folders { marked: &["Girovo"], keep: &["girovo"], ..Default::default() }.picked(), cfg("Girovo"));
    assert_eq!(Folders { marked: &["Girovo"], keep: &["Sooskasse-FinTS", "girovo"], ..Default::default() }.picked(), cfg("Girovo"));
    // Electron's, chosen at the update from 5.x, stays too — over every row below.
    assert_eq!(Folders { marked: &["girovo"], keep: &["Sooskasse-FinTS", "Girovo"], ..Default::default() }.picked(), cfg("girovo"));
    assert_eq!(Folders { marked: &["girovo"], ..Default::default() }.picked(), cfg("girovo"));
    // Several marked (a folder copied by hand): the order as without markers.
    assert_eq!(Folders { marked: &["girovo", "Girovo"], ..Default::default() }.picked(), cfg("girovo"));
    assert_eq!(Folders { marked: &["Sooskasse-FinTS", "Girovo"], keep: &["girovo"], ..Default::default() }.picked(), cfg("Sooskasse-FinTS"));
  }

  #[test]
  fn a_folder_that_cannot_be_looked_into_counts_as_data_and_the_choice_is_not_sure() {
    // Electron's, there and not listable: taken, not passed over for the own one — and no marker for it.
    assert_eq!(Folders { unreadable: &["girovo"], keep: &["Girovo"], ..Default::default() }.pick(), (cfg("girovo"), false));
    assert_eq!(Folders { unreadable: &["girovo"], ..Default::default() }.pick(), (cfg("girovo"), false));
    // The own one not listable, Electron's only opened: the own one may keep something.
    assert_eq!(Folders { unreadable: &["Girovo"], prefs_only: &["girovo"], ..Default::default() }.pick(), (cfg("Girovo"), false));
    // Its marker could not be looked for either: no other folder is marked in its place.
    assert_eq!(Folders { unreadable: &["Girovo"], keep: &["girovo"], ..Default::default() }.pick(), (cfg("girovo"), false));
    // A folder never asked about does not make the choice unsure.
    assert_eq!(Folders { marked: &["Sooskasse-FinTS"], unreadable: &["girovo", "Girovo"], ..Default::default() }.pick(), (cfg("Sooskasse-FinTS"), true));
    // Windows' probes (data_root): only 6.0.4's rule is left, and it is always sure.
    let windows = |names: &[&str]| {
      let names = names.to_vec();
      pick_root(Path::new("cfg"), &[LEGACY], |_| Some(false), |_| Some(false), move |dir| names.iter().any(|name| cfg(name) == dir))
    };
    assert_eq!(windows(&["Sooskasse-FinTS", "Girovo"]), (cfg("Sooskasse-FinTS"), true));
    assert_eq!(windows(&["Girovo"]), (cfg("Girovo"), true));
    assert_eq!(windows(&[]), (cfg("Girovo"), true));
  }

  #[test]
  fn on_the_disk_a_copy_of_5_that_was_only_opened_does_not_beat_a_folder_in_use() {
    let base = temp("opened");
    // 5.x opened once: its preferences, and a state folder with nothing in it.
    let electron = base.join(LEGACY);
    std::fs::create_dir_all(electron.join("fints-state")).unwrap();
    std::fs::write(electron.join("prefs.json"), "{}").unwrap();
    assert_eq!(keeps_state(&electron), Some(false));
    assert!(has_anything(&electron));
    // Nothing else there: it is the folder 6.0.4 used, and stays (row 3).
    assert_eq!(picked_on_disk(&base), electron);
    // 6.x in full use beside it: that one (row 2).
    let own = base.join("Girovo");
    std::fs::create_dir_all(own.join("fints-state")).unwrap();
    std::fs::write(own.join("fints-state").join("vault.json"), "{}").unwrap();
    assert_eq!(keeps_state(&own), Some(true));
    assert_eq!(picked_on_disk(&base), own);
    // Preferences alone, without a state folder, count as little; no folder at all is no data and no doubt.
    std::fs::remove_dir_all(electron.join("fints-state")).unwrap();
    assert_eq!(keeps_state(&electron), Some(false));
    assert_eq!(keeps_state(&base.join("never-there")), Some(false));
    assert_eq!(has_marker(&base.join("never-there")), Some(false));
    assert_eq!(picked_on_disk(&base), own);
    // Once 5.x has kept something, its folder is the one to take over (row 1).
    std::fs::create_dir_all(electron.join("fints-state")).unwrap();
    std::fs::write(electron.join("fints-state").join("profile-12030000.json"), "{}").unwrap();
    assert_eq!(keeps_state(&electron), Some(true));
    assert_eq!(picked_on_disk(&base), electron);
    std::fs::remove_dir_all(&base).unwrap();
  }

  #[test]
  fn the_marker_is_written_once_and_decides_the_next_start() {
    let base = temp("marker");
    // The first start of 6.x on a new computer: its own folder, marked.
    let own = picked_on_disk(&base);
    assert_eq!(own, base.join("Girovo"));
    std::fs::create_dir_all(&own).unwrap();
    assert_eq!(has_marker(&own), Some(false));
    mark(&own);
    assert_eq!(has_marker(&own), Some(true));
    // 5.x tried out and used: its folder has data now, and 6.x stays where it is.
    std::fs::create_dir_all(base.join(LEGACY).join("fints-state")).unwrap();
    std::fs::write(base.join(LEGACY).join("fints-state").join("vault.json"), "{}").unwrap();
    assert_eq!(keeps_state(&base.join(LEGACY)), Some(true));
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
