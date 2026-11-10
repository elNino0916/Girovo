// The page's preferences (theme, "Beträge ausblenden", the idle limit, the
// bank chosen last, the shell's own switches): prefs.json in the data folder,
// the very file and format the Electron shell kept (its main.cjs).
//
// The page reads them synchronously — layout.tsx's pre-paint script needs the
// theme before the first frame — and Tauri's IPC is asynchronous, so the whole
// map goes into the window's initialization script (shell::boot_script), and
// the bridge's set/del come back here to be written.
//
// Deliberately narrow, as before: `fints.*` keys, short string values, a
// bounded count. Preferences, not data.
//
// Only a file that is not there is an empty start. One that cannot be read —
// a scanner or a backup holding it for a moment — is read again a few times;
// one that still cannot be read, or is no longer what Girovo wrote, is kept
// beside it under another name (prefs.json.damaged-<time>) before the app goes
// on without it: the first change would otherwise write one key over the
// theme, the update channel, the terms agreed to and "Neue Umsätze melden".
//
// In memory first, then on disk: the map's lock is held for the change alone,
// never for the write, so whoever only reads (the window's thread among them)
// never waits for a disk or a scanner. Writes go one at a time under a lock
// of their own, each taking the map as it is then — the last one written is
// always the newest.

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::paths::data_root;

const VALUE_MAX: usize = 4096;
const MAX_KEYS: usize = 200;
/// How often a file that could not be read is read again, a little later each time (half a second in all).
const READ_AGAIN: u32 = 5;

pub struct Prefs {
  /// prefs.json.
  file: PathBuf,
  map: Mutex<BTreeMap<String, String>>,
  /// Held for a write; never taken while `map` is held.
  disk: Mutex<Disk>,
}

struct Disk {
  /// The file of this start could neither be read nor moved aside: moved
  /// aside before the first write, which would replace it.
  unread: bool,
}

/// `fints.` and 1–80 of [A-Za-z0-9_.-]: PREF_KEY in the Electron shell's preload.cjs.
pub fn valid_key(key: &str) -> bool {
  let Some(rest) = key.strip_prefix("fints.") else { return false };
  !rest.is_empty() && rest.len() <= 80 && rest.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
}

/// What prefs.json held at the start.
enum Kept {
  Map(BTreeMap<String, String>),
  /// No file: a first start.
  Nothing,
  /// A file that could not be read, or not as preferences.
  Unreadable,
}

impl Prefs {
  pub fn load() -> Self {
    Self::open(data_root().join("prefs.json"))
  }

  fn open(file: PathBuf) -> Self {
    let (map, unread) = match read(&file) {
      Kept::Map(map) => (map, false),
      Kept::Nothing => (BTreeMap::new(), false),
      Kept::Unreadable => (BTreeMap::new(), !set_aside(&file)),
    };
    Prefs { file, map: Mutex::new(map), disk: Mutex::new(Disk { unread }) }
  }

  pub fn snapshot(&self) -> BTreeMap<String, String> {
    self.map.lock().unwrap().clone()
  }

  pub fn get(&self, key: &str) -> Option<String> {
    self.map.lock().unwrap().get(key).cloned()
  }

  /// Everything at once ("Girovo zurücksetzen", reset.rs): only `keep` stays,
  /// in memory as on disk. Answers whether it is on disk.
  pub fn replace(&self, keep: &[(&str, &str)]) -> bool {
    {
      let mut map = self.map.lock().unwrap();
      map.clear();
      for (key, value) in keep {
        map.insert(key.to_string(), value.to_string());
      }
    }
    self.store()
  }

  /// Sets or (None) deletes a key; answers whether it is on disk.
  pub fn set(&self, key: &str, value: Option<&str>) -> bool {
    if !valid_key(key) {
      return false;
    }
    {
      let mut map = self.map.lock().unwrap();
      match value {
        Some(v) => {
          if v.len() > VALUE_MAX {
            return false;
          }
          if map.get(key).map(String::as_str) == Some(v) {
            return true;
          }
          if !map.contains_key(key) && map.len() >= MAX_KEYS {
            return false;
          }
          map.insert(key.to_string(), v.to_string());
        }
        None => {
          if map.remove(key).is_none() {
            return true;
          }
        }
      }
    }
    self.store()
  }

  /// The map as it is now, onto the disk. One write at a time, and the map
  /// taken under the writes' lock: a write that waited behind another writes
  /// what is newest then, never what it was called for.
  fn store(&self) -> bool {
    let mut disk = self.disk.lock().unwrap();
    let map = self.map.lock().unwrap().clone();
    if disk.unread {
      disk.unread = !set_aside(&self.file);
    }
    write(&self.file, &map)
  }
}

/// prefs.json's content. A read that fails for anything but the file not
/// being there is tried again: Windows refuses it while another program holds
/// the file.
fn read(file: &Path) -> Kept {
  let mut attempt = 0;
  let bytes = loop {
    match fs::read(file) {
      Ok(bytes) => break bytes,
      Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Kept::Nothing,
      Err(_) if attempt < READ_AGAIN => {
        std::thread::sleep(Duration::from_millis(15 << attempt));
        attempt += 1;
      }
      Err(err) => {
        eprintln!("[prefs] prefs.json not read: {err}");
        return Kept::Unreadable;
      }
    }
  };
  // An editor's byte order mark is no damage.
  let text = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
  let Ok(serde_json::Value::Object(raw)) = serde_json::from_slice::<serde_json::Value>(text) else {
    eprintln!("[prefs] prefs.json is not what Girovo wrote");
    return Kept::Unreadable;
  };
  let mut map = BTreeMap::new();
  for (key, value) in raw {
    if map.len() >= MAX_KEYS {
      break;
    }
    if let serde_json::Value::String(v) = value {
      if valid_key(&key) && v.len() <= VALUE_MAX {
        map.insert(key, v);
      }
    }
  }
  Kept::Map(map)
}

/// Moves a prefs.json that could not be read out of the next write's way,
/// to prefs.json.damaged-<seconds since 1970> beside it. Answers whether
/// nothing is left in the way (moved, or gone meanwhile).
fn set_aside(file: &Path) -> bool {
  let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
  let mut name = file.file_name().unwrap_or_default().to_os_string();
  name.push(format!(".damaged-{now}"));
  match crate::files::rename_retrying(file, &file.with_file_name(name)) {
    Ok(()) => true,
    Err(err) => {
      let gone = err.kind() == std::io::ErrorKind::NotFound;
      if !gone {
        eprintln!("[prefs] prefs.json not moved aside: {err}");
      }
      gone
    }
  }
}

/// A temp file renamed over prefs.json, so a crash leaves the old file, never
/// half a new one; Windows refuses the rename while a scanner holds the
/// target, so a few short retries.
fn write(file: &Path, map: &BTreeMap<String, String>) -> bool {
  let mut name = file.file_name().unwrap_or_default().to_os_string();
  name.push(format!(".{}.tmp", std::process::id()));
  let tmp = file.with_file_name(name);
  let text = match serde_json::to_string_pretty(map) {
    Ok(t) => t,
    Err(_) => return false,
  };
  let written = (|| -> std::io::Result<()> {
    let mut f = fs::File::create(&tmp)?;
    f.write_all(text.as_bytes())?;
    f.sync_all()
  })();
  if written.is_err() {
    let _ = fs::remove_file(&tmp);
    return false;
  }
  for attempt in 0..4 {
    match fs::rename(&tmp, file) {
      Ok(()) => return true,
      Err(_) if attempt < 3 => std::thread::sleep(Duration::from_millis(20 * (attempt + 1))),
      Err(_) => break,
    }
  }
  let _ = fs::remove_file(&tmp);
  false
}

#[cfg(test)]
mod tests {
  use std::sync::Arc;
  use std::time::Instant;

  use super::*;

  /// A folder of this test's own under the system's temp folder.
  fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("girovo-prefs-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
  }

  /// The files set aside in `dir`, by name.
  fn aside(dir: &Path) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> =
      fs::read_dir(dir).unwrap().flatten().map(|e| e.path()).filter(|p| p.file_name().unwrap().to_string_lossy().starts_with("prefs.json.damaged-")).collect();
    found.sort();
    found
  }

  const SAVED: &str = r#"{"fints.theme":"dark","fints.terms":"1","fints.background.on":"1","fints.update.channel":"preview"}"#;

  #[test]
  fn keys_are_narrow() {
    assert!(valid_key("fints.theme"));
    assert!(valid_key("fints.userId.12030000"));
    assert!(!valid_key("fints."));
    assert!(!valid_key("theme"));
    assert!(!valid_key("fints.a b"));
    assert!(!valid_key(&format!("fints.{}", "a".repeat(81))));
  }

  #[test]
  fn no_file_is_an_empty_start_and_what_is_set_is_there_at_the_next() {
    let dir = temp("new");
    let file = dir.join("prefs.json");
    let prefs = Prefs::open(file.clone());
    assert!(prefs.snapshot().is_empty());
    assert!(aside(&dir).is_empty() && !file.exists());
    assert!(prefs.set("fints.theme", Some("dark")));
    assert!(prefs.set("fints.terms", Some("1")));
    assert!(prefs.set("fints.terms", None));
    assert!(!prefs.set("theme", Some("dark")));
    let again = Prefs::open(file.clone());
    assert_eq!(again.snapshot(), BTreeMap::from([("fints.theme".to_string(), "dark".to_string())]));
    // "Girovo zurücksetzen": only what is kept, in memory as on disk.
    assert!(again.replace(&[("fints.shell.tauri", "done")]));
    assert_eq!(again.get("fints.theme"), None);
    assert_eq!(Prefs::open(file).snapshot(), BTreeMap::from([("fints.shell.tauri".to_string(), "done".to_string())]));
    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn what_is_read_is_narrowed_as_ever() {
    let dir = temp("narrow");
    let file = dir.join("prefs.json");
    fs::write(&file, format!("\u{feff}{}", r#"{"fints.theme":"dark","other":"x","fints.n":5,"fints.a b":"x"}"#)).unwrap();
    let prefs = Prefs::open(file);
    assert_eq!(prefs.snapshot(), BTreeMap::from([("fints.theme".to_string(), "dark".to_string())]));
    assert!(aside(&dir).is_empty(), "a file that reads is never set aside");
    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn a_damaged_file_is_kept_aside_and_never_written_over() {
    for (name, damaged) in [("cut", &SAVED[..40]), ("list", "[1,2]"), ("empty", ""), ("bytes", "\u{0}\u{0}\u{0}\u{0}")] {
      let dir = temp(name);
      let file = dir.join("prefs.json");
      fs::write(&file, damaged).unwrap();
      let prefs = Prefs::open(file.clone());
      assert!(prefs.snapshot().is_empty(), "{name}");
      // Out of the way, whole.
      assert!(!file.exists(), "{name}");
      let kept = aside(&dir);
      assert_eq!(kept.len(), 1, "{name}");
      assert_eq!(fs::read_to_string(&kept[0]).unwrap(), damaged, "{name}");
      // The start goes on: the first change makes a new file, the old one stays beside it.
      assert!(prefs.set("fints.theme", Some("light")), "{name}");
      assert_eq!(Prefs::open(file).get("fints.theme").as_deref(), Some("light"), "{name}");
      assert_eq!(fs::read_to_string(&kept[0]).unwrap(), damaged, "{name}");
      assert_eq!(aside(&dir).len(), 1, "{name}");
      fs::remove_dir_all(&dir).unwrap();
    }
  }

  /// Opened as a scanner or a backup would: nobody else may read it meanwhile.
  #[cfg(windows)]
  fn held(file: &Path) -> fs::File {
    use std::os::windows::fs::OpenOptionsExt;
    fs::OpenOptions::new().read(true).share_mode(0).open(file).unwrap()
  }

  #[cfg(windows)]
  #[test]
  fn a_file_held_for_a_moment_is_read_again_and_nothing_is_lost() {
    let dir = temp("held");
    let file = dir.join("prefs.json");
    fs::write(&file, SAVED).unwrap();
    let holder = held(&file);
    assert!(fs::read(&file).is_err(), "the file is held");
    let release = std::thread::spawn(move || {
      std::thread::sleep(Duration::from_millis(60));
      drop(holder);
    });
    let prefs = Prefs::open(file.clone());
    release.join().unwrap();
    assert_eq!(prefs.get("fints.theme").as_deref(), Some("dark"));
    assert_eq!(prefs.get("fints.background.on").as_deref(), Some("1"));
    assert_eq!(prefs.snapshot().len(), 4);
    // The next change keeps the rest.
    assert!(prefs.set("fints.theme", Some("light")));
    let again = Prefs::open(file);
    assert_eq!(again.get("fints.terms").as_deref(), Some("1"));
    assert_eq!(again.get("fints.theme").as_deref(), Some("light"));
    assert!(aside(&dir).is_empty());
    fs::remove_dir_all(&dir).unwrap();
  }

  #[cfg(windows)]
  #[test]
  fn a_file_held_all_through_the_start_is_moved_aside_before_the_first_write() {
    let dir = temp("held-long");
    let file = dir.join("prefs.json");
    fs::write(&file, SAVED).unwrap();
    let holder = held(&file);
    let prefs = Prefs::open(file.clone());
    // Neither read nor moved: the start goes on empty, the file is where it was.
    assert!(prefs.snapshot().is_empty());
    assert!(file.exists() && aside(&dir).is_empty());
    drop(holder);
    assert_eq!(fs::read_to_string(&file).unwrap(), SAVED);
    // The first write does not replace it: it is beside the new file, whole.
    assert!(prefs.set("fints.theme", Some("light")));
    let kept = aside(&dir);
    assert_eq!(kept.len(), 1);
    assert_eq!(fs::read_to_string(&kept[0]).unwrap(), SAVED);
    assert_eq!(Prefs::open(file).snapshot(), BTreeMap::from([("fints.theme".to_string(), "light".to_string())]));
    // Once only: later writes leave the new file in place.
    assert!(prefs.set("fints.terms", Some("1")));
    assert_eq!(aside(&dir).len(), 1);
    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn reading_never_waits_for_a_write() {
    let dir = temp("stalled");
    let file = dir.join("prefs.json");
    let prefs = Arc::new(Prefs::open(file.clone()));
    assert!(prefs.set("fints.theme", Some("dark")));
    // A write under way that the disk holds up.
    let stalled = prefs.disk.lock().unwrap();
    let writer = {
      let prefs = prefs.clone();
      std::thread::spawn(move || prefs.set("fints.background.on", Some("1")))
    };
    // The change is in memory at once, for everyone who reads.
    let since = Instant::now();
    while prefs.get("fints.background.on").is_none() {
      assert!(since.elapsed() < Duration::from_secs(10), "the change never reached the map");
      std::thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(prefs.get("fints.theme").as_deref(), Some("dark"));
    assert_eq!(prefs.snapshot().len(), 2);
    // Its own write waits its turn.
    std::thread::sleep(Duration::from_millis(50));
    assert!(!writer.is_finished());
    assert!(!fs::read_to_string(&file).unwrap().contains("fints.background.on"));
    drop(stalled);
    assert!(writer.join().unwrap());
    assert_eq!(Prefs::open(file).get("fints.background.on").as_deref(), Some("1"));
    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn whatever_order_the_writes_take_the_file_ends_as_the_newest_map() {
    let dir = temp("order");
    let file = dir.join("prefs.json");
    let prefs = Arc::new(Prefs::open(file.clone()));
    let writers: Vec<_> = (0..6)
      .map(|t| {
        let prefs = prefs.clone();
        std::thread::spawn(move || {
          let mut on_disk = true;
          for n in 0..12 {
            on_disk &= prefs.set(&format!("fints.k{t}.{n}"), Some("x"));
            on_disk &= prefs.set("fints.shared", Some(&format!("{t}-{n}")));
            if n % 3 == 0 {
              on_disk &= prefs.set(&format!("fints.k{t}.{n}"), None);
            }
          }
          on_disk
        })
      })
      .collect();
    let all_on_disk = writers.into_iter().map(|writer| writer.join().unwrap()).fold(true, |all, one| all && one);
    assert_eq!(prefs.snapshot().len(), 6 * 8 + 1);
    // Every write went through (a scanner on this machine may have refused one): the file is the map.
    if all_on_disk {
      assert_eq!(Prefs::open(file.clone()).snapshot(), prefs.snapshot());
    }
    // And one more write always leaves the whole map, not its own key alone.
    assert!(prefs.set("fints.last", Some("1")));
    assert_eq!(Prefs::open(file).snapshot(), prefs.snapshot());
    fs::remove_dir_all(&dir).unwrap();
  }
}
