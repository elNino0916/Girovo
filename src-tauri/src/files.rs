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

use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;

use crate::paths::{inside_root, state_dir};

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

#[tauri::command]
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

#[tauri::command]
pub fn fs_read(path: String) -> Result<String, String> {
  fs::read_to_string(resolve(&path)?).map_err(io)
}

#[tauri::command]
pub fn fs_write(path: String, data: String) -> Result<(), String> {
  let file = resolve(&path)?;
  if let Some(parent) = file.parent() {
    fs::create_dir_all(parent).map_err(io)?;
  }
  fs::write(file, data).map_err(io)
}

#[tauri::command]
pub fn fs_delete(path: String) -> Result<(), String> {
  fs::remove_file(resolve(&path)?).map_err(io)
}

#[tauri::command]
pub fn fs_rename(from: String, to: String) -> Result<(), String> {
  let (from, to) = (resolve(&from)?, resolve(&to)?);
  if let Some(parent) = to.parent() {
    fs::create_dir_all(parent).map_err(io)?;
  }
  fs::rename(from, to).map_err(io)
}

// ---------------------------------------------------------------------------
// Sync folders

/// A sync file's name as lib/sync-stores.ts makes them: no separators, no "..".
fn sync_name(name: &str) -> Result<&str, String> {
  let ok = !name.is_empty()
    && name.len() <= 120
    && !name.starts_with('.')
    && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
  if ok { Ok(name) } else { Err(format!("not a sync file name: {name}")) }
}

/// `lan`: the shelf the phone reaches; otherwise an absolute folder that exists.
fn sync_dir(place: &str) -> Result<PathBuf, String> {
  if place == "lan" {
    return Ok(state_dir().join("sync-lan"));
  }
  let dir = Path::new(place);
  if !dir.is_absolute() || !dir.is_dir() {
    return Err("ENOENT".into());
  }
  Ok(dir.to_path_buf())
}

#[tauri::command]
pub fn folder_get(place: String, name: String) -> Result<Option<String>, String> {
  let file = sync_dir(&place)?.join(sync_name(&name)?);
  match fs::read(&file) {
    Ok(bytes) => Ok(Some(B64.encode(bytes))),
    Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
    Err(err) => Err(io(err)),
  }
}

#[tauri::command]
pub fn folder_put(place: String, name: String, data: String) -> Result<(), String> {
  let dir = if place == "lan" {
    let d = state_dir().join("sync-lan");
    fs::create_dir_all(&d).map_err(io)?;
    d
  } else {
    sync_dir(&place)?
  };
  let name = sync_name(&name)?;
  let bytes = B64.decode(data.as_bytes()).map_err(|e| e.to_string())?;
  let tmp = dir.join(format!("{name}.{}.part", std::process::id()));
  fs::write(&tmp, bytes).map_err(io)?;
  fs::rename(&tmp, dir.join(name)).map_err(|err| {
    let _ = fs::remove_file(&tmp);
    io(err)
  })
}
