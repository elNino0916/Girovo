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

use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;

use crate::paths::inside_root;

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
  let bytes = fs::read(resolve(&path)?).map_err(io)?;
  if std::str::from_utf8(&bytes).is_err() {
    return Err(format!("EIO: not UTF-8: {path}"));
  }
  Ok(tauri::ipc::Response::new(bytes))
}

/// The path URI-encoded in this header, beside the content as the request's
/// raw body — never a JSON argument, for the same reason as fs_read.
const PATH_HEADER: &str = "girovo-path";

#[tauri::command]
pub async fn fs_write(request: tauri::ipc::Request<'_>) -> Result<(), String> {
  let path = request.headers().get(PATH_HEADER).and_then(|v| v.to_str().ok()).map(crate::save::uri_decode).unwrap_or_default();
  let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
    return Err("EINVAL: fs_write takes the content as bytes".into());
  };
  if std::str::from_utf8(bytes).is_err() {
    return Err("EINVAL: not UTF-8".into());
  }
  let file = resolve(&path)?;
  if let Some(parent) = file.parent() {
    fs::create_dir_all(parent).map_err(io)?;
  }
  fs::write(file, bytes).map_err(io)
}

#[tauri::command(async)]
pub fn fs_delete(path: String) -> Result<(), String> {
  fs::remove_file(resolve(&path)?).map_err(io)
}

#[tauri::command(async)]
pub fn fs_rename(from: String, to: String) -> Result<(), String> {
  let (from, to) = (resolve(&from)?, resolve(&to)?);
  if let Some(parent) = to.parent() {
    fs::create_dir_all(parent).map_err(io)?;
  }
  fs::rename(from, to).map_err(io)
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
