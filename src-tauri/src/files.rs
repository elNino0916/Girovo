// The files the route handlers keep, for the page's in-memory tree
// (mobile/shims/fs.ts through desktop/capacitor/filesystem.ts): device
// profiles, vaults, kept Umsätze, the background box, the LAN shelf's tokens.
// Every path is relative to the data folder and stays inside it
// (paths::inside_root); every file is UTF-8 text.
//
// Also the sync folders (lib/sync-stores.ts folderStore): the LAN shelf's
// folder, which the phone writes into over the network (sync_lan.rs), and a
// folder of the user's choosing. Those are read from disk each time — never
// from the page's tree, which would not see what arrived meanwhile.
//
// Every command here runs off the main thread (`async`): a vault of a few MB
// takes a moment to write, longer while a virus scanner looks at it, and on
// the main thread that moment froze the whole window — its caption buttons,
// dragging, every other call to the shell (measured: 750 ms for 14 MB).
//
// A delete is never lost. The page's tree forgets a file at once and nobody
// waits for the disk (mobile/shims/fs.ts), so a file another program holds
// just then — a virus scanner on a kept PIN's file during "Gerät vergessen" —
// would be back after a restart, the PIN in it. A delete that gives up is
// therefore written down (the note OWED in the data folder, each change of it
// a whole new file renamed into place), and the next start deletes what is on
// it before the page or anything else reads those files (finish_owed_deletes,
// lib.rs), keeping what still will not go for the start after. A file written
// again meanwhile, or renamed into that place, is wanted: its path comes off
// the note.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;

use crate::paths::{data_root, inside_root};

/// Set once "Girovo zurücksetzen" begins (reset.rs): from then on nothing is
/// written or moved in the data folder, so a save the page still had under way
/// cannot bring back what the reset deletes.
pub static FROZEN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn writable() -> Result<(), String> {
  if FROZEN.load(std::sync::atomic::Ordering::SeqCst) { Err("EROFS: Girovo is being reset".into()) } else { Ok(()) }
}

fn resolve(path: &str) -> Result<PathBuf, String> {
  inside_root(path).ok_or_else(|| format!("refused path: {path}"))
}

fn io(err: std::io::Error) -> String {
  // The page's shim reads the code like Node's (ENOENT etc.).
  match err.kind() {
    std::io::ErrorKind::NotFound => "ENOENT".into(),
    std::io::ErrorKind::PermissionDenied => "EACCES".into(),
    std::io::ErrorKind::AlreadyExists => "EEXIST".into(),
    _ => format!("EIO: {err}"),
  }
}

#[derive(serde::Serialize)]
pub struct Listed {
  name: String,
  #[serde(rename = "type")]
  kind: &'static str,
}

#[tauri::command(async)]
pub fn fs_list(path: String) -> Result<Vec<Listed>, String> {
  let dir = resolve(&path)?;
  let mut out = Vec::new();
  for entry in fs::read_dir(&dir).map_err(io)? {
    let entry = entry.map_err(io)?;
    let kind = if entry.file_type().map_err(io)?.is_dir() { "directory" } else { "file" };
    if let Some(name) = entry.file_name().to_str() {
      out.push(Listed { name: name.to_string(), kind });
    }
  }
  Ok(out)
}

/// The file's bytes as they are (the page decodes them): a JSON string of a
/// few MB would be escaped, sent and parsed on the main thread.
#[tauri::command(async)]
pub fn fs_read(path: String) -> Result<tauri::ipc::Response, String> {
  let file = resolve(&path)?;
  let mut attempt = 0;
  // Ridden out as a rename is: a virus scanner or OneDrive holding it a moment.
  let bytes = loop {
    match fs::read(&file) {
      Ok(bytes) => break bytes,
      Err(err) if attempt < 5 && locked(&err) => {
        std::thread::sleep(std::time::Duration::from_millis(15 << attempt));
        attempt += 1;
      }
      Err(err) => return Err(io(err)),
    }
  };
  if std::str::from_utf8(&bytes).is_err() {
    return Err(format!("EIO: not UTF-8: {path}"));
  }
  Ok(tauri::ipc::Response::new(bytes))
}

/// The path URI-encoded in this header, beside the content as the request's
/// raw body — never a JSON argument, for the same reason as fs_read.
const PATH_HEADER: &str = "girovo-path";

/// The file commands under way: the end of the process waits for them
/// (leftover.rs end_process), so no file is cut off half written.
static IN_FLIGHT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

struct Busy;

impl Busy {
  fn new() -> Self {
    IN_FLIGHT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    Busy
  }
}

impl Drop for Busy {
  fn drop(&mut self) {
    IN_FLIGHT.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
  }
}

/// Waits, at most `limit`, for the file commands under way to finish.
pub fn settle(limit: std::time::Duration) {
  let start = std::time::Instant::now();
  while IN_FLIGHT.load(std::sync::atomic::Ordering::SeqCst) > 0 && start.elapsed() < limit {
    std::thread::sleep(std::time::Duration::from_millis(10));
  }
}

#[tauri::command]
pub async fn fs_write(request: tauri::ipc::Request<'_>) -> Result<(), String> {
  let path = request.headers().get(PATH_HEADER).and_then(|v| v.to_str().ok()).map(crate::save::uri_decode).unwrap_or_default();
  let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
    return Err("EINVAL: fs_write takes the content as bytes".into());
  };
  if std::str::from_utf8(bytes).is_err() {
    return Err("EINVAL: not UTF-8".into());
  }
  writable()?;
  let _busy = Busy::new();
  with_owed(|owed| owed.write(&path, bytes))
}

#[tauri::command(async)]
pub fn fs_delete(path: String) -> Result<(), String> {
  writable()?;
  let _busy = Busy::new();
  with_owed(|owed| owed.delete(&path))
}

#[tauri::command(async)]
pub fn fs_rename(from: String, to: String) -> Result<(), String> {
  writable()?;
  let _busy = Busy::new();
  with_owed(|owed| owed.rename(&from, &to))
}

// ---------------------------------------------------------------------------
// The deletes still owed

/// The note of the deletes that gave up, in the data folder: OWED_HEAD, then
/// a path a line, relative to the folder, its parts joined by "/".
const OWED: &str = ".girovo-delete-pending";
const OWED_HEAD: &str = "girovo-deletes 1";
/// More than this is no list of files a scanner held for a moment.
const OWED_MAX: usize = 500;
/// All the time a start spends on the note's files that still will not go.
const OWED_BUDGET: Duration = Duration::from_secs(1);

/// A data folder's files as the page changes them, and the deletes it still
/// owes them. One change at a time (with_owed): a delete giving up and a
/// write of the same file never cross on the way to the note.
struct Owed {
  root: PathBuf,
  paths: BTreeSet<String>,
  /// The note was there and could not be read at this start: left as it is by finish().
  unread: bool,
}

static OWED_NOW: Mutex<Option<Owed>> = Mutex::new(None);

/// Runs `change` with the data folder's Owed, read from the note on first use.
fn with_owed<T>(change: impl FnOnce(&mut Owed) -> T) -> T {
  let mut now = OWED_NOW.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
  change(now.get_or_insert_with(|| Owed::load(data_root())))
}

/// At the start, before the page or the shell reads the saved files (lib.rs):
/// the deletes the last run owed. In the app's own setup, which a second start
/// handed over to the running copy never reaches — that copy's files and its
/// note are its own.
pub fn finish_owed_deletes() {
  let mut now = OWED_NOW.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
  let mut owed = Owed::load(data_root());
  owed.finish(OWED_BUDGET);
  *now = Some(owed);
}

/// A path as the note keeps it — its parts joined by "/" — or None for one
/// that would leave the folder: an absolute path, "..", a drive prefix.
fn owed_key(relative: &str) -> Option<String> {
  let rel = Path::new(relative);
  if rel.is_absolute() {
    return None;
  }
  let mut parts = Vec::new();
  for part in rel.components() {
    match part {
      Component::Normal(p) => parts.push(p.to_str()?),
      Component::CurDir => {}
      _ => return None,
    }
  }
  (!parts.is_empty()).then(|| parts.join("/"))
}

/// Windows does not tell "A.skey" from "a.skey": neither does the note there.
fn same_path(a: &str, b: &str) -> bool {
  if cfg!(windows) { a.eq_ignore_ascii_case(b) } else { a == b }
}

impl Owed {
  /// What the note in `root` says. A note that is not one says nothing.
  fn load(root: &Path) -> Self {
    let mut attempt = 0;
    let (text, unread) = loop {
      match fs::read_to_string(root.join(OWED)) {
        Ok(text) => break (text, false),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => break (String::new(), false),
        Err(err) if attempt < 5 && locked(&err) => {
          std::thread::sleep(Duration::from_millis(15 << attempt));
          attempt += 1;
        }
        // Not text: no note. Held by another program: one, for all anyone knows.
        Err(err) => break (String::new(), locked(&err)),
      }
    };
    let mut lines = text.lines();
    let mut paths = BTreeSet::new();
    if lines.next() == Some(OWED_HEAD) {
      // Only paths as this file writes them: anything else is not followed.
      paths.extend(lines.filter(|line| owed_key(line).as_deref() == Some(*line)).take(OWED_MAX).map(str::to_string));
    }
    Owed { root: root.to_path_buf(), paths, unread }
  }

  /// The file a path of the page's means, inside the folder.
  fn file(&self, path: &str) -> Result<PathBuf, String> {
    let key = owed_key(path).ok_or_else(|| format!("refused path: {path}"))?;
    Ok(self.root.join(key))
  }

  /// The note as the list is now, a whole new file renamed into place; no
  /// note where nothing is owed.
  fn save(&self) -> bool {
    let note = self.root.join(OWED);
    if self.paths.is_empty() {
      return match fs::remove_file(&note) {
        Ok(()) => true,
        Err(err) => err.kind() == std::io::ErrorKind::NotFound,
      };
    }
    let mut text = String::from(OWED_HEAD);
    for path in &self.paths {
      text.push('\n');
      text.push_str(path);
    }
    text.push('\n');
    let tmp = self.root.join(format!("{OWED}.{}.tmp", std::process::id()));
    let written = (|| -> std::io::Result<()> {
      use std::io::Write;
      let mut out = fs::File::create(&tmp)?;
      out.write_all(text.as_bytes())?;
      out.sync_all()?;
      rename_retrying(&tmp, &note)
    })();
    if let Err(err) = &written {
      eprintln!("[files] the note of owed deletes was not written: {err}");
      let _ = fs::remove_file(&tmp);
    }
    written.is_ok()
  }

  /// A delete gave up on `path`: owed from now on.
  fn owe(&mut self, path: &str) {
    let Some(key) = owed_key(path) else { return };
    if self.paths.len() >= OWED_MAX || self.paths.iter().any(|owed| same_path(owed, &key)) {
      return;
    }
    self.paths.insert(key);
    self.save();
  }

  /// `path` is as the page wants it — deleted, or written anew: nothing is owed for it.
  fn settled(&mut self, path: &str) {
    let Some(key) = owed_key(path) else { return };
    let before = self.paths.len();
    self.paths.retain(|owed| !same_path(owed, &key));
    if self.paths.len() != before {
      self.save();
    }
  }

  fn write(&mut self, path: &str, bytes: &[u8]) -> Result<(), String> {
    let file = self.file(path)?;
    if let Some(parent) = file.parent() {
      fs::create_dir_all(parent).map_err(io)?;
    }
    // On the disk before the shim renames it into place: a power cut right
    // after a save must not leave an empty vault (the Electron shell's writeFileAtomic).
    use std::io::Write;
    let mut out = fs::File::create(file).map_err(io)?;
    out.write_all(bytes).map_err(io)?;
    out.sync_all().map_err(io)?;
    // Written again: wanted, whatever delete was owed for it.
    self.settled(path);
    Ok(())
  }

  fn delete(&mut self, path: &str) -> Result<(), String> {
    let file = self.file(path)?;
    let mut attempt = 0;
    let gave_up = loop {
      match fs::remove_file(&file) {
        Ok(()) => {
          self.settled(path);
          return Ok(());
        }
        // A virus scanner or OneDrive holding it a moment, as for a rename.
        Err(err) if attempt < 5 && locked(&err) => {
          std::thread::sleep(Duration::from_millis(15 << attempt));
          attempt += 1;
        }
        Err(err) => break err,
      }
    };
    if gave_up.kind() == std::io::ErrorKind::NotFound {
      self.settled(path);
    } else if !file.is_dir() {
      // Still there: the next start takes it away (finish). The error stands.
      self.owe(path);
    }
    Err(io(gave_up))
  }

  fn rename(&mut self, from: &str, to: &str) -> Result<(), String> {
    let (source, target) = (self.file(from)?, self.file(to)?);
    if let Some(parent) = target.parent() {
      fs::create_dir_all(parent).map_err(io)?;
    }
    rename_retrying(&source, &target).map_err(io)?;
    // A file put in that place is wanted; the place it left is empty.
    self.settled(to);
    self.settled(from);
    Ok(())
  }

  /// The start's turn: every file on the note is deleted, `budget` at most
  /// spent on those another program still holds. What is gone — or was gone
  /// already, or is no file of this folder — comes off the note; the rest
  /// stays for the start after.
  fn finish(&mut self, budget: Duration) {
    if self.unread {
      return;
    }
    let until = Instant::now() + budget;
    let real_root = fs::canonicalize(&self.root).ok();
    let paths = std::mem::take(&mut self.paths);
    self.paths = paths.into_iter().filter(|path| !self.done_with(path, real_root.as_deref(), until)).collect();
    // Also where nothing was owed: a note that was not one goes.
    self.save();
  }

  /// Deletes one file of the note; answers whether it comes off the note.
  fn done_with(&self, path: &str, real_root: Option<&Path>, until: Instant) -> bool {
    let file = self.root.join(path);
    match fs::symlink_metadata(&file) {
      Err(err) if err.kind() == std::io::ErrorKind::NotFound => return true,
      // Cannot be looked at now: asked again at the next start.
      Err(_) => return false,
      // A folder is not what a file's delete takes away.
      Ok(meta) if meta.is_dir() => return true,
      Ok(_) => {}
    }
    // Never through a link that leads out of the folder: such a path is dropped, not followed.
    let inside = match (real_root, file.parent().and_then(|parent| fs::canonicalize(parent).ok())) {
      (Some(real_root), Some(parent)) => parent.starts_with(real_root),
      _ => false,
    };
    if !inside {
      return true;
    }
    let mut attempt = 0;
    loop {
      match fs::remove_file(&file) {
        Ok(()) => return true,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return true,
        Err(err) if attempt < 5 && locked(&err) && Instant::now() < until => {
          std::thread::sleep(Duration::from_millis(15 << attempt));
          attempt += 1;
        }
        Err(_) => return false,
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Sync folders

/// The largest sync file read (lib/sync-stores.ts MAX_BYTES, the shelf's limit too).
const SYNC_MAX_BYTES: u64 = 64 * 1024 * 1024;

/// A sync file's name, by the very rule the shelf serves them by
/// (sync_lan::group_of, lib/sync-stores.ts NAME): nothing else is read or
/// written in a sync folder.
fn sync_name(name: &str) -> Result<&str, String> {
  match crate::sync_lan::group_of(name) {
    Some(_) => Ok(name),
    None => Err(format!("not a sync file name: {}", name.chars().take(40).collect::<String>())),
  }
}

/// `lan`: the shelf the phone reaches; otherwise an absolute folder that exists.
fn sync_dir(place: &str) -> Result<PathBuf, String> {
  if place == "lan" {
    return Ok(crate::sync_lan::lan_dir());
  }
  let dir = Path::new(place);
  if !dir.is_absolute() || !dir.is_dir() {
    return Err("ENOENT".into());
  }
  Ok(dir.to_path_buf())
}

/// Renames, riding out the brief locks Windows lets another process hold on
/// the target — OneDrive, a virus scanner, the shelf serving the old file
/// (lib/sealed-file.ts renameRetrying).
pub fn rename_retrying(from: &Path, to: &Path) -> std::io::Result<()> {
  let mut attempt = 0;
  loop {
    match fs::rename(from, to) {
      Ok(()) => return Ok(()),
      Err(err) if attempt < 5 && locked(&err) => {
        std::thread::sleep(std::time::Duration::from_millis(15 << attempt));
        attempt += 1;
      }
      Err(err) => return Err(err),
    }
  }
}

/// Node's EPERM, EACCES and EBUSY: denied, or held open by someone else (Windows'
/// sharing and lock violations, 32 and 33).
pub fn locked(err: &std::io::Error) -> bool {
  matches!(err.kind(), std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::ResourceBusy)
    || (cfg!(windows) && matches!(err.raw_os_error(), Some(32 | 33)))
}

// The sync files are read and written off the main thread: one can be tens of megabytes.

#[tauri::command]
pub async fn folder_get(place: String, name: String) -> Result<Option<String>, String> {
  let file = sync_dir(&place)?.join(sync_name(&name)?);
  match fs::metadata(&file) {
    // As lib/sync-stores.ts: a file larger than any sync file is none.
    Ok(meta) if meta.len() > SYNC_MAX_BYTES => return Ok(None),
    Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
    _ => {}
  }
  match fs::read(&file) {
    Ok(bytes) => Ok(Some(B64.encode(bytes))),
    Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
    Err(err) => Err(io(err)),
  }
}

#[tauri::command]
pub async fn folder_put(place: String, name: String, data: String) -> Result<(), String> {
  let dir = if place == "lan" {
    let d = crate::sync_lan::lan_dir();
    fs::create_dir_all(&d).map_err(io)?;
    d
  } else {
    sync_dir(&place)?
  };
  let name = sync_name(&name)?;
  let bytes = B64.decode(data.as_bytes()).map_err(|e| e.to_string())?;
  // A name of its own for each write, as the shelf's: two at once never share a temporary file.
  let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
  let tmp = dir.join(format!("{name}.{}.{stamp}.tmp", std::process::id()));
  fs::write(&tmp, bytes).map_err(|err| {
    let _ = fs::remove_file(&tmp);
    io(err)
  })?;
  rename_retrying(&tmp, &dir.join(name)).map_err(|err| {
    // No half-written file left for the other devices (or the shelf's file count).
    let _ = fs::remove_file(&tmp);
    io(err)
  })
}

/// A deleted receipt's bytes out of a sync folder (lib/sync.ts): only a
/// receipt's file (sync_lan::removable), and one that is not there is gone already.
#[tauri::command]
pub async fn folder_remove(place: String, name: String) -> Result<(), String> {
  if !crate::sync_lan::removable(&name) {
    return Err(format!("not a receipt's sync file: {}", name.chars().take(40).collect::<String>()));
  }
  let file = sync_dir(&place)?.join(&name);
  let mut attempt = 0;
  loop {
    match fs::remove_file(&file) {
      Ok(()) => return Ok(()),
      Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
      // OneDrive, a virus scanner or the shelf serving it a moment, as for a rename.
      Err(err) if attempt < 5 && locked(&err) => {
        std::thread::sleep(std::time::Duration::from_millis(15 << attempt));
        attempt += 1;
      }
      Err(err) => return Err(io(err)),
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  /// A data folder of this test's own under the system's temp folder, with a kept PIN's file in it.
  fn folder(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("girovo-files-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("fints-state")).unwrap();
    fs::write(dir.join("fints-state/abc.skey"), "sealed").unwrap();
    dir
  }

  /// The next start in `dir`: what it still owes after its turn.
  fn next_start(dir: &Path) -> Vec<String> {
    let mut owed = Owed::load(dir);
    owed.finish(Duration::from_millis(200));
    owed.paths.into_iter().collect()
  }

  fn note(dir: &Path) -> Option<String> {
    fs::read_to_string(dir.join(OWED)).ok()
  }

  /// Opened as a scanner or a backup would: nobody else may touch it meanwhile.
  #[cfg(windows)]
  fn held(file: &Path) -> fs::File {
    use std::os::windows::fs::OpenOptionsExt;
    fs::OpenOptions::new().read(true).share_mode(0).open(file).unwrap()
  }

  #[test]
  fn paths_are_kept_as_parts_of_the_folder_or_not_at_all() {
    assert_eq!(owed_key("fints-state/abc.skey").as_deref(), Some("fints-state/abc.skey"));
    assert_eq!(owed_key("./fints-state//abc.skey").as_deref(), Some("fints-state/abc.skey"));
    for outside in ["", ".", "../abc.skey", "fints-state/../../abc.skey", "/etc/passwd", "C:\\Windows\\win.ini"] {
      if cfg!(windows) || !outside.starts_with("C:") {
        assert_eq!(owed_key(outside), None, "{outside}");
      }
    }
  }

  #[test]
  fn a_delete_that_works_owes_nothing() {
    let dir = folder("plain");
    let mut owed = Owed::load(&dir);
    assert_eq!(owed.delete("fints-state/abc.skey"), Ok(()));
    assert!(!dir.join("fints-state/abc.skey").exists());
    // One that is not there is gone already (the shim reads ENOENT as that).
    assert_eq!(owed.delete("fints-state/abc.skey"), Err("ENOENT".to_string()));
    assert!(owed.paths.is_empty() && note(&dir).is_none());
    assert!(owed.delete("../abc.skey").is_err());
    fs::remove_dir_all(&dir).unwrap();
  }

  #[cfg(windows)]
  #[test]
  fn a_delete_that_gives_up_is_noted_and_finished_at_a_later_start() {
    let dir = folder("held");
    let holder = held(&dir.join("fints-state/abc.skey"));
    let mut owed = Owed::load(&dir);
    // The error stands, as before; the file is still there, and written down.
    assert!(owed.delete("fints-state/abc.skey").is_err());
    assert!(dir.join("fints-state/abc.skey").exists());
    assert_eq!(note(&dir).as_deref(), Some("girovo-deletes 1\nfints-state/abc.skey\n"));
    // Asked again: once on the note. And no half-written note beside it.
    assert!(owed.delete("fints-state/abc.skey").is_err());
    assert_eq!(owed.paths.len(), 1);
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);
    // A start while it is still held: kept for the start after.
    assert_eq!(next_start(&dir), ["fints-state/abc.skey"]);
    assert!(dir.join("fints-state/abc.skey").exists());
    assert_eq!(note(&dir).as_deref(), Some("girovo-deletes 1\nfints-state/abc.skey\n"));
    // Let go: the next start takes the file away, and the note with it.
    drop(holder);
    assert!(next_start(&dir).is_empty());
    assert!(!dir.join("fints-state/abc.skey").exists());
    assert!(note(&dir).is_none());
    fs::remove_dir_all(&dir).unwrap();
  }

  #[cfg(windows)]
  #[test]
  fn of_several_owed_the_start_takes_what_goes_and_keeps_the_rest() {
    let dir = folder("some");
    fs::write(dir.join("fints-state/abc.hello"), "sealed").unwrap();
    fs::write(dir.join("fints-state/abc.linked"), "sealed").unwrap();
    let mut owed = Owed::load(&dir);
    for name in ["fints-state/abc.skey", "fints-state/abc.hello", "fints-state/abc.linked", "fints-state/gone.refused"] {
      owed.owe(name);
    }
    let holder = held(&dir.join("fints-state/abc.hello"));
    assert_eq!(next_start(&dir), ["fints-state/abc.hello"]);
    assert_eq!(note(&dir).as_deref(), Some("girovo-deletes 1\nfints-state/abc.hello\n"));
    assert!(!dir.join("fints-state/abc.skey").exists() && !dir.join("fints-state/abc.linked").exists());
    drop(holder);
    assert!(next_start(&dir).is_empty());
    assert_eq!(fs::read_dir(dir.join("fints-state")).unwrap().count(), 0);
    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn a_file_written_again_or_renamed_into_place_is_no_longer_owed() {
    let dir = folder("again");
    let mut owed = Owed::load(&dir);
    owed.owe("fints-state/abc.skey");
    owed.owe("fints-state/abc.hello");
    owed.owe("fints-state/other.linked");
    assert_eq!(owed.paths.len(), 3);
    // Windows Hello set up afresh: written in place.
    assert_eq!(owed.write("fints-state/abc.hello", b"new"), Ok(()));
    // The shim's way: a part, then renamed over the file (a.skey and A.SKEY being one file on Windows).
    let spelled = if cfg!(windows) { "fints-state/ABC.skey" } else { "fints-state/abc.skey" };
    assert_eq!(owed.write("fints-state/abc.skey.part", b"new"), Ok(()));
    assert_eq!(owed.paths.len(), 2, "the part is another file");
    assert_eq!(owed.rename("fints-state/abc.skey.part", spelled), Ok(()));
    assert_eq!(note(&dir).as_deref(), Some("girovo-deletes 1\nfints-state/other.linked\n"));
    // The next start leaves both alone.
    assert_eq!(next_start(&dir), Vec::<String>::new());
    assert_eq!(fs::read_to_string(dir.join("fints-state/abc.hello")).unwrap(), "new");
    assert_eq!(fs::read_to_string(dir.join("fints-state/abc.skey")).unwrap(), "new");
    assert!(note(&dir).is_none());
    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn a_path_out_of_the_folder_is_refused_and_never_followed() {
    let dir = folder("outside");
    let outside = dir.with_file_name(format!("{}-outside.txt", dir.file_name().unwrap().to_string_lossy()));
    fs::write(&outside, "not Girovo's").unwrap();
    let outside_name = outside.file_name().unwrap().to_string_lossy().into_owned();
    // Not taken onto the note.
    let mut owed = Owed::load(&dir);
    owed.owe(&format!("../{outside_name}"));
    owed.owe(&outside.to_string_lossy());
    assert!(owed.paths.is_empty() && note(&dir).is_none());
    // Nor followed from a note someone else wrote: only the folder's own file goes, and a folder never.
    let lines = [
      OWED_HEAD.to_string(),
      format!("../{outside_name}"),
      format!("fints-state/../../{outside_name}"),
      outside.to_string_lossy().into_owned(),
      "fints-state".to_string(),
      "fints-state/abc.skey".to_string(),
    ];
    fs::write(dir.join(OWED), lines.join("\n")).unwrap();
    fs::write(dir.join("fints-state/vault.json"), "{}").unwrap();
    assert!(next_start(&dir).is_empty());
    assert_eq!(fs::read_to_string(&outside).unwrap(), "not Girovo's");
    assert!(!dir.join("fints-state/abc.skey").exists());
    assert!(dir.join("fints-state/vault.json").exists());
    assert!(note(&dir).is_none());
    fs::remove_file(&outside).unwrap();
    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn a_note_that_is_not_one_is_ignored() {
    for (name, text) in [("words", "fints-state/abc.skey\n"), ("version", "girovo-deletes 2\nfints-state/abc.skey\n"), ("empty", "")] {
      let dir = folder(&format!("broken-{name}"));
      fs::write(dir.join(OWED), text).unwrap();
      assert!(next_start(&dir).is_empty(), "{name}");
      assert!(dir.join("fints-state/abc.skey").exists(), "{name}");
      assert!(note(&dir).is_none(), "{name}: it does not stay around either");
      fs::remove_dir_all(&dir).unwrap();
    }
    // Not text at all.
    let dir = folder("broken-bytes");
    fs::write(dir.join(OWED), [0xff, 0xfe, 0x00, 0x41]).unwrap();
    assert!(next_start(&dir).is_empty());
    assert!(dir.join("fints-state/abc.skey").exists());
    fs::remove_dir_all(&dir).unwrap();
  }

  #[cfg(windows)]
  #[test]
  fn a_note_held_at_the_start_is_left_as_it_is() {
    let dir = folder("note-held");
    let mut owed = Owed::load(&dir);
    owed.owe("fints-state/abc.skey");
    let holder = held(&dir.join(OWED));
    assert!(next_start(&dir).is_empty(), "nothing is known of it at this start");
    drop(holder);
    assert_eq!(note(&dir).as_deref(), Some("girovo-deletes 1\nfints-state/abc.skey\n"));
    assert!(dir.join("fints-state/abc.skey").exists());
    // Read at the start after, and done then.
    assert!(next_start(&dir).is_empty());
    assert!(!dir.join("fints-state/abc.skey").exists());
    fs::remove_dir_all(&dir).unwrap();
  }
}
