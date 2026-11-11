// "Girovo zurücksetzen" (Einstellungen → Dieses Gerät, components/settings/ResetApp.tsx):
// everything Girovo keeps on this computer goes, and it starts again as on
// its first day. The page has logged out and emptied its own storage first.
//
// What goes: the data folder's contents (device profiles, vaults, kept
// Umsätze, the background box, the shell secret, the LAN shelf's folder and
// tokens, the preferences — the Electron shell's leftovers too, in the folder
// it shared, and on Linux the folder a 6.0.0 to 6.0.3 made beside it,
// paths.rs unused_roots), Girovo Next's local model in the app's local data
// folder (gemma.rs), Windows Hello's key in Windows, the start with Windows. What
// stays: the installation, one preference — the move from the Electron
// app is done, so a fresh start never shows that screen again — and on Linux
// the mark that this folder is the one in use (paths.rs ROOT_MARKER).
//
// A file another program holds (a scanner, a backup) is tried again for a
// moment. If anything is still there after that, the reset is not over: what
// is left is written down in the data folder (PENDING), Girovo starts again as
// after any reset, and the next start finishes the deletion before anything
// reads the folder or a window opens (prefs_at_start, from lib.rs). Should
// something stay even then, that start goes on as usual and the page says so
// once (LEFT_PREF, components/settings/ResetApp.tsx ResetLeftNotice). Staying
// in the app that asked was no way out: its page has logged out, nothing may
// be written any more (files.rs FROZEN), the secret and the preferences are
// gone already.
//
// Also here, the smaller deletion: "Gespeicherte Daten löschen" for one login
// takes its sync group's files off the LAN shelf (lan_forget).

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

use crate::paths::data_root;
use crate::prefs::Prefs;

/// The preferences a reset leaves: the Electron move, done for good (migrate.rs).
const KEPT: &[(&str, &str)] = &[("fints.shell.tauri", "done")];
/// How often a deletion that failed is tried again, a little later each time (half a second in all).
const DELETE_AGAIN: u32 = 5;
/// The note of a reset that could not delete everything, in the data folder:
/// when it was (seconds since 1970), then what was left, a name a line.
const PENDING: &str = ".girovo-reset-pending";
/// How long that note stands, in seconds. Girovo starts again at once, so the
/// next start is seconds away; a note found much later (the start that should
/// have followed never came) must not empty a folder that is in use again.
const PENDING_FOR: u64 = 10 * 60;
/// The start that finishes a reset goes over the folder this often, this far apart.
const FINISH_ROUNDS: u32 = 2;
const FINISH_PAUSE: Duration = Duration::from_millis(400);
/// Set when something stayed even after that: the page says settings.resetApp.left
/// once and deletes it (components/settings/ResetApp.tsx ResetLeftNotice).
pub const LEFT_PREF: &str = "fints.reset.left";

fn now() -> u64 {
  SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

#[tauri::command]
pub async fn app_reset(app: AppHandle) -> Result<(), String> {
  // First: nothing the page still writes may land after what follows.
  crate::files::FROZEN.store(true, Ordering::SeqCst);
  app.state::<Arc<crate::sync_lan::LanShelf>>().stop();
  crate::background::set_login_item(false);
  tauri::async_runtime::spawn_blocking(crate::hello::forget).await.map_err(|e| e.to_string())?;
  // The shell secret where it lives beyond the data folder (the keyring on Linux).
  tauri::async_runtime::spawn_blocking(crate::secret::forget).await.map_err(|e| e.to_string())?;
  // The local model: its server stopped first, which holds the model's file open (gemma.rs).
  crate::gemma::forget(&app).await;

  let root = data_root().to_path_buf();
  let mut left = tauri::async_runtime::spawn_blocking(move || {
    let mut left = empty(&root);
    for other in crate::paths::unused_roots() {
      if !remove(&other) {
        // Its name, not its path: the error goes to the page.
        left.push(other.file_name().unwrap_or_default().to_string_lossy().into_owned());
      }
    }
    left
  })
  .await
  .map_err(|e| e.to_string())?;
  // In memory as on disk, so nothing writes the old ones back on the way out.
  // Written anew, the file that would not go holds nothing of before either.
  let prefs = app.state::<Prefs>();
  if prefs.replace(KEPT) {
    left.retain(|name| name != "prefs.json");
  }
  if !left.is_empty() {
    eprintln!("[reset] could not delete: {}", left.join(", "));
    // The next start finishes it (finish). Without the note it cannot: then
    // the page of that start says at least that something stayed.
    if !note_pending(data_root(), &left, now()) {
      prefs.set(LEFT_PREF, Some("1"));
    }
  }
  crate::updater::relaunch(&app);
  Ok(())
}

/// The preferences for this start (lib.rs) — after a reset the last run could
/// not finish has been finished: before the preferences or anything else in
/// the data folder is read, before any window.
pub fn prefs_at_start() -> Prefs {
  let finished = finish(data_root(), &crate::paths::unused_roots(), now());
  let prefs = Prefs::load();
  if let Some(finished) = finished {
    settle(&prefs, finished);
  }
  prefs
}

/// Writes down that a reset is not over. Answers whether the note is there.
fn note_pending(root: &Path, left: &[String], at: u64) -> bool {
  let mut text = at.to_string();
  for name in left {
    text.push('\n');
    text.push_str(name);
  }
  fs::write(root.join(PENDING), text).is_ok()
}

/// What became of a reset the last run could not finish.
#[derive(Debug, PartialEq)]
struct Finished {
  /// The folder was emptied again at this start (the preferences with it).
  emptied: bool,
  /// What is still there.
  left: Vec<String>,
}

/// Finishes a reset the last run noted as not over (None: there is no note):
/// empties `root` again and removes `others`, going over them a few times.
///
/// The note is taken away first, and only a note that is gone and was written
/// moments ago empties anything: one that cannot be removed, or that some
/// later start comes across, must never delete what has been kept since.
/// Such a note only says what of its list is still there.
fn finish(root: &Path, others: &[PathBuf], now: u64) -> Option<Finished> {
  let note = root.join(PENDING);
  let text = match fs::read_to_string(&note) {
    Ok(text) => text,
    Err(err) if err.kind() == std::io::ErrorKind::NotFound => return None,
    // There and not readable: nothing to go by.
    Err(_) => String::new(),
  };
  let mut lines = text.lines();
  let at = lines.next().and_then(|line| line.trim().parse::<u64>().ok());
  let fresh = at.is_some_and(|at| now >= at && now - at <= PENDING_FOR);
  if !remove(&note) || !fresh {
    // Names only, as they were written: never a path out of the folder.
    let plain = |name: &&str| {
      let mut parts = Path::new(name).components();
      matches!((parts.next(), parts.next()), (Some(Component::Normal(_)), None))
    };
    let there = |name: &&str| root.join(name).exists() || others.iter().any(|other| other.file_name().is_some_and(|n| n == *name) && other.exists());
    let left = lines.filter(plain).filter(there).map(str::to_string).collect();
    return Some(Finished { emptied: false, left });
  }
  let mut left = Vec::new();
  for round in 0..FINISH_ROUNDS {
    if round > 0 {
      std::thread::sleep(FINISH_PAUSE);
    }
    left = empty(root);
    left.extend(others.iter().filter(|other| !remove(other)).map(|other| other.file_name().unwrap_or_default().to_string_lossy().into_owned()));
    if left.is_empty() {
      break;
    }
  }
  Some(Finished { emptied: true, left })
}

/// The preferences after a reset finished at this start: as a reset leaves
/// them where the folder was emptied, and the word for the page where
/// something stayed all the same.
fn settle(prefs: &Prefs, finished: Finished) {
  let Finished { emptied, mut left } = finished;
  if emptied && prefs.replace(KEPT) {
    left.retain(|name| name != "prefs.json");
  }
  if !left.is_empty() {
    eprintln!("[reset] still not deleted: {}", left.join(", "));
    prefs.set(LEFT_PREF, Some("1"));
  }
}

/// Deletes everything in `root` but a test run's WebView2 folder, which the
/// running window holds (shell::webview_dir), and the mark of the folder in
/// use (paths.rs). Answers what could not go.
fn empty(root: &Path) -> Vec<String> {
  let keep_webview = std::env::var_os("GIROVO_DATA_DIR").is_some_and(|d| !d.is_empty());
  let Ok(entries) = fs::read_dir(root) else { return Vec::new() };
  let mut left = Vec::new();
  for entry in entries.flatten() {
    let name = entry.file_name().to_string_lossy().to_string();
    if (keep_webview && name == "webview2") || name == crate::paths::ROOT_MARKER {
      continue;
    }
    if !remove(&entry.path()) {
      left.push(name);
    }
  }
  left
}

/// Deletes a file, or a folder with all that is in it. What another program
/// holds for a moment — a virus scanner, a backup, the search index — is
/// tried again. Answers whether it is gone.
fn remove(path: &Path) -> bool {
  let mut attempt = 0;
  loop {
    let gone = if path.is_dir() { fs::remove_dir_all(path) } else { fs::remove_file(path) };
    match gone {
      Ok(()) => return true,
      Err(err) if err.kind() == std::io::ErrorKind::NotFound => return true,
      Err(_) if attempt < DELETE_AGAIN => {
        std::thread::sleep(Duration::from_millis(15 << attempt));
        attempt += 1;
      }
      Err(_) => return false,
    }
  }
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
  use super::*;

  /// A folder of this test's own under the system's temp folder, with what a used Girovo keeps in it.
  fn used(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("girovo-reset-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("fints-state")).unwrap();
    fs::write(dir.join("fints-state/vault.json"), "{}").unwrap();
    fs::write(dir.join("prefs.json"), r#"{"fints.theme":"dark"}"#).unwrap();
    fs::write(dir.join(crate::paths::ROOT_MARKER), "").unwrap();
    dir
  }

  fn names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    names.sort();
    names
  }

  #[test]
  fn without_a_note_a_start_deletes_nothing() {
    let dir = used("no-note");
    assert_eq!(finish(&dir, &[], 1_000), None);
    assert_eq!(names(&dir), [crate::paths::ROOT_MARKER, "fints-state", "prefs.json"]);
    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn a_reset_noted_as_not_over_is_finished_at_the_next_start() {
    let dir = used("finish");
    let other = used("finish-other");
    assert!(note_pending(&dir, &["fints-state".to_string()], 1_000));
    assert_eq!(fs::read_to_string(dir.join(PENDING)).unwrap(), "1000\nfints-state");
    // Seconds later: everything goes, the other folder too; the mark of the folder in use stays.
    assert_eq!(finish(&dir, &[other.clone()], 1_004), Some(Finished { emptied: true, left: Vec::new() }));
    assert_eq!(names(&dir), [crate::paths::ROOT_MARKER]);
    assert!(!other.exists());
    // Once: the note is gone, the start after it deletes nothing.
    fs::write(dir.join("prefs.json"), "{}").unwrap();
    assert_eq!(finish(&dir, &[], 1_010), None);
    assert!(dir.join("prefs.json").exists());
    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn a_note_from_long_ago_deletes_nothing_and_only_says_what_is_still_there() {
    for (name, at, now) in [("old", 1_000, 1_000 + PENDING_FOR + 1), ("clock", 5_000, 4_000)] {
      let dir = used(&format!("stale-{name}"));
      let other = used(&format!("stale-other-{name}"));
      let other_name = other.file_name().unwrap().to_string_lossy().into_owned();
      let noted = ["fints-state".to_string(), "linked-unlock.key".to_string(), other_name.clone(), "../elsewhere".to_string()];
      assert!(note_pending(&dir, &noted, at));
      // What has been kept since stays; of the list, what is there is named (never a path out of the folder).
      assert_eq!(finish(&dir, &[other.clone()], now), Some(Finished { emptied: false, left: vec!["fints-state".to_string(), other_name] }), "{name}");
      assert_eq!(names(&dir), [crate::paths::ROOT_MARKER, "fints-state", "prefs.json"], "{name}");
      assert!(other.join("fints-state/vault.json").exists(), "{name}");
      fs::remove_dir_all(&dir).unwrap();
      fs::remove_dir_all(&other).unwrap();
    }
    // A note that says nothing readable: the same.
    let dir = used("stale-empty");
    fs::write(dir.join(PENDING), "").unwrap();
    assert_eq!(finish(&dir, &[], 1_000), Some(Finished { emptied: false, left: Vec::new() }));
    assert_eq!(names(&dir), [crate::paths::ROOT_MARKER, "fints-state", "prefs.json"]);
    fs::remove_dir_all(&dir).unwrap();
  }

  #[cfg(windows)]
  #[test]
  fn what_is_still_held_at_the_next_start_is_named_and_the_start_goes_on() {
    let dir = used("finish-held");
    assert!(note_pending(&dir, &["fints-state".to_string()], 1_000));
    let holder = held(&dir.join("fints-state/vault.json"));
    assert_eq!(finish(&dir, &[], 1_001), Some(Finished { emptied: true, left: vec!["fints-state".to_string()] }));
    drop(holder);
    // The rest went, and the note with it: no start after this one deletes again.
    assert_eq!(names(&dir), [crate::paths::ROOT_MARKER, "fints-state"]);
    assert_eq!(finish(&dir, &[], 1_002), None);
    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn after_a_finished_reset_the_preferences_are_a_resets_and_what_stayed_is_said_once() {
    let kept = |pairs: &[(&str, &str)]| pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect::<std::collections::BTreeMap<_, _>>();
    // Emptied, nothing left: what a reset keeps, and no word.
    let dir = used("settle");
    fs::remove_file(dir.join("prefs.json")).unwrap();
    let prefs = Prefs::open(dir.join("prefs.json"));
    settle(&prefs, Finished { emptied: true, left: Vec::new() });
    assert_eq!(prefs.snapshot(), kept(KEPT));
    // Emptied, something stayed: the word for the page with it. A prefs.json that would not go is written anew, so it is no leftover.
    let prefs = Prefs::open(dir.join("prefs.json"));
    settle(&prefs, Finished { emptied: true, left: vec!["prefs.json".to_string()] });
    assert_eq!(prefs.snapshot(), kept(KEPT));
    settle(&prefs, Finished { emptied: true, left: vec!["prefs.json".to_string(), "fints-state".to_string()] });
    assert_eq!(prefs.snapshot(), kept(&[KEPT[0], (LEFT_PREF, "1")]));
    assert_eq!(Prefs::open(dir.join("prefs.json")).get(LEFT_PREF).as_deref(), Some("1"));
    // Not emptied (a note from long ago): the preferences of now stay, with the word.
    fs::write(dir.join("prefs.json"), r#"{"fints.theme":"dark"}"#).unwrap();
    let prefs = Prefs::open(dir.join("prefs.json"));
    settle(&prefs, Finished { emptied: false, left: Vec::new() });
    assert_eq!(prefs.snapshot(), kept(&[("fints.theme", "dark")]));
    settle(&prefs, Finished { emptied: false, left: vec!["fints-state".to_string()] });
    assert_eq!(prefs.snapshot(), kept(&[(LEFT_PREF, "1"), ("fints.theme", "dark")]));
    fs::remove_dir_all(&dir).unwrap();
  }

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

  #[test]
  fn the_mark_of_the_folder_in_use_stays() {
    let dir = std::env::temp_dir().join(format!("girovo-reset-mark-{}", std::process::id()));
    std::fs::create_dir_all(dir.join("fints-state")).unwrap();
    std::fs::write(dir.join(crate::paths::ROOT_MARKER), "").unwrap();
    std::fs::write(dir.join("prefs.json"), "{}").unwrap();
    assert!(empty(&dir).is_empty());
    let left: Vec<String> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    assert_eq!(left, [crate::paths::ROOT_MARKER]);
    std::fs::remove_dir_all(&dir).unwrap();
  }

  /// Opened as a scanner or a backup would: nobody else may touch it meanwhile.
  #[cfg(windows)]
  fn held(file: &std::path::Path) -> std::fs::File {
    use std::os::windows::fs::OpenOptionsExt;
    std::fs::OpenOptions::new().read(true).share_mode(0).open(file).unwrap()
  }

  #[cfg(windows)]
  #[test]
  fn a_file_held_for_a_moment_is_deleted_all_the_same() {
    let dir = std::env::temp_dir().join(format!("girovo-reset-held-{}", std::process::id()));
    std::fs::create_dir_all(dir.join("fints-state")).unwrap();
    std::fs::write(dir.join("fints-state/background-box.json"), "{}").unwrap();
    std::fs::write(dir.join("linked-unlock.key"), "x").unwrap();
    let (in_folder, alone) = (held(&dir.join("fints-state/background-box.json")), held(&dir.join("linked-unlock.key")));
    let release = std::thread::spawn(move || {
      std::thread::sleep(std::time::Duration::from_millis(60));
      drop((in_folder, alone));
    });
    assert!(empty(&dir).is_empty());
    release.join().unwrap();
    assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
    std::fs::remove_dir_all(&dir).unwrap();
  }

  #[cfg(windows)]
  #[test]
  fn what_stays_held_is_named_and_the_rest_goes() {
    let dir = std::env::temp_dir().join(format!("girovo-reset-left-{}", std::process::id()));
    std::fs::create_dir_all(dir.join("fints-state")).unwrap();
    std::fs::write(dir.join("fints-state/background-box.json"), "{}").unwrap();
    std::fs::write(dir.join("fints-state/vault.json"), "{}").unwrap();
    std::fs::write(dir.join("prefs.json"), "{}").unwrap();
    let holder = held(&dir.join("fints-state/background-box.json"));
    assert_eq!(empty(&dir), ["fints-state"]);
    assert!(dir.join("fints-state/background-box.json").exists());
    assert!(!dir.join("prefs.json").exists());
    // Asked again once it is let go: nothing is left.
    drop(holder);
    assert!(empty(&dir).is_empty());
    assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
    std::fs::remove_dir_all(&dir).unwrap();
  }
}
