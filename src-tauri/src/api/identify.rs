// Who is on the other end of a connection (docs/girovo-api.md "Who is
// asking"). Only the shell decides this, from the operating system's facts:
// the process behind the pipe or socket, its executable, the file's SHA-256
// and, on Windows, its Authenticode signature. Nothing a client says about
// itself goes into it.
//
// The parent process is identified the same way and sent along: Girovo's own
// MCP helper (phase 3) stands for the assistant that started it, and the
// dialog shows that one.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
  /// Signed with Girovo's pinned MT-Media certificate, whatever the machine's stores hold.
  Mtmedia,
  /// A valid signature whose chain Windows trusts.
  Verified,
  /// Unsigned, a broken or revoked signature, an untrusted chain, and every program on Linux.
  Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Publisher {
  pub kind: Kind,
  /// The signer certificate's organisation, else its common name. Never set
  /// for an unknown publisher: a name from a chain nobody trusts would only mislead.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub name: Option<String>,
  /// SHA-1 of the signer certificate, upper-case hex, as Windows shows it.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub thumbprint: Option<String>,
}

impl Publisher {
  pub fn unknown() -> Publisher {
    Publisher { kind: Kind::Unknown, name: None, thumbprint: None }
  }
}

/// The client as the page gets it in `api:call`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Client {
  pub pid: u32,
  pub exe: String,
  pub sha256: String,
  pub name: String,
  pub publisher: Publisher,
  /// Only on the client itself; a parent carries no parent of its own.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub parent: Option<Box<Client>>,
}

/// A display name is the program's own text; this much is plenty for a dialog.
const MAX_NAME: usize = 120;
/// Files looked at once are remembered; past this many the memory starts over.
const CACHE_MAX: usize = 64;

/// The process `pid` and its parent, or None when the process can't be read
/// (gone already, or not this user's).
pub fn client(pid: u32) -> Option<Client> {
  let mut me = process(pid)?;
  me.parent = os::parent_of(pid).and_then(process).map(Box::new);
  Some(me)
}

fn process(pid: u32) -> Option<Client> {
  let exe = os::exe_of(pid)?;
  let facts = facts_cached(&exe, pid)?;
  Some(Client {
    pid,
    exe: exe.to_string_lossy().into_owned(),
    sha256: facts.sha256,
    name: facts.name,
    publisher: facts.publisher,
    parent: None,
  })
}

#[derive(Debug, Clone)]
struct Facts {
  sha256: String,
  name: String,
  publisher: Publisher,
}

/// What tells a changed file from the one looked at before.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Stamp {
  len: u64,
  modified: Option<SystemTime>,
  /// Linux: the inode, so a file replaced under the same name and time is new.
  node: (u64, u64),
}

fn cache() -> &'static Mutex<HashMap<PathBuf, (Stamp, Facts)>> {
  static CACHE: OnceLock<Mutex<HashMap<PathBuf, (Stamp, Facts)>>> = OnceLock::new();
  CACHE.get_or_init(Default::default)
}

/// Hashing a large program and checking its signature takes a moment, and an
/// app connects again and again: the facts are kept per (path, size, time).
fn facts_cached(exe: &Path, pid: u32) -> Option<Facts> {
  let source = os::readable(exe, pid);
  let stamp = stamp_of(&source)?;
  if let Some((seen, facts)) = cache().lock().unwrap().get(exe) {
    if *seen == stamp {
      return Some(facts.clone());
    }
  }
  let facts = facts_of(exe, &source)?;
  let mut cache = cache().lock().unwrap();
  if cache.len() >= CACHE_MAX {
    cache.clear();
  }
  cache.insert(exe.to_path_buf(), (stamp, facts.clone()));
  Some(facts)
}

fn stamp_of(path: &Path) -> Option<Stamp> {
  let meta = std::fs::metadata(path).ok()?;
  #[cfg(unix)]
  let node = {
    use std::os::unix::fs::MetadataExt;
    (meta.dev(), meta.ino())
  };
  #[cfg(not(unix))]
  let node = (0, 0);
  Some(Stamp { len: meta.len(), modified: meta.modified().ok(), node })
}

/// `exe` is the path shown; `source` the file read, which on Linux is
/// /proc/<pid>/exe: the very file that runs, even if the path now names another.
fn facts_of(exe: &Path, source: &Path) -> Option<Facts> {
  let sha256 = sha256_of(source)?;
  let file_name = exe.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| exe.to_string_lossy().into_owned());
  let (publisher, name) = os::publisher_and_name(exe);
  let name = name.map(|n| clean(&n)).filter(|n| !n.is_empty()).unwrap_or_else(|| clean(&file_name));
  Some(Facts { sha256, name, publisher })
}

pub fn sha256_of(path: &Path) -> Option<String> {
  let mut file = std::fs::File::open(path).ok()?;
  let mut hasher = Sha256::new();
  let mut buf = vec![0u8; 256 * 1024];
  loop {
    let n = file.read(&mut buf).ok()?;
    if n == 0 {
      break;
    }
    hasher.update(&buf[..n]);
  }
  Some(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// A name from a program's own resources: one line, no control characters, not too long.
fn clean(name: &str) -> String {
  let one_line: String = name.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
  let trimmed = one_line.split_whitespace().collect::<Vec<_>>().join(" ");
  trimmed.chars().take(MAX_NAME).collect()
}

#[cfg(windows)]
mod os {
  use super::*;
  pub use crate::api::signature::publisher_and_name;
  use windows::Win32::Foundation::{CloseHandle, FILETIME, HANDLE};
  use windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS};
  use windows::Win32::System::Threading::{GetProcessTimes, OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW};
  use windows::core::PWSTR;

  struct Handle(HANDLE);
  impl Drop for Handle {
    fn drop(&mut self) {
      unsafe {
        let _ = CloseHandle(self.0);
      }
    }
  }

  fn open(pid: u32) -> Option<Handle> {
    unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok().map(Handle) }
  }

  pub fn exe_of(pid: u32) -> Option<PathBuf> {
    let process = open(pid)?;
    let mut buf = vec![0u16; 32_768];
    let mut len = buf.len() as u32;
    unsafe { QueryFullProcessImageNameW(process.0, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).ok()? };
    let path = String::from_utf16_lossy(&buf[..len as usize]);
    (!path.is_empty()).then(|| PathBuf::from(path))
  }

  /// A running program's file can't be written while it runs, so the path is the file.
  pub fn readable(exe: &Path, _pid: u32) -> PathBuf {
    exe.to_path_buf()
  }

  fn started(pid: u32) -> Option<u64> {
    let process = open(pid)?;
    let (mut created, mut exited, mut kernel, mut user) = (FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default());
    unsafe { GetProcessTimes(process.0, &mut created, &mut exited, &mut kernel, &mut user).ok()? };
    Some(((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64)
  }

  /// The parent as Windows remembers it. Windows reuses process ids, and a
  /// parent that has ended leaves its id behind for anyone: a "parent" that
  /// started after the child is someone else.
  pub fn parent_of(pid: u32) -> Option<u32> {
    let snapshot = Handle(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()? });
    let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
    let mut parent = None;
    let mut more = unsafe { Process32FirstW(snapshot.0, &mut entry).is_ok() };
    while more {
      if entry.th32ProcessID == pid {
        parent = Some(entry.th32ParentProcessID);
        break;
      }
      more = unsafe { Process32NextW(snapshot.0, &mut entry).is_ok() };
    }
    let parent = parent.filter(|&p| p != 0 && p != pid)?;
    (started(parent)? <= started(pid)?).then_some(parent)
  }
}

#[cfg(target_os = "linux")]
mod os {
  use super::*;

  pub fn exe_of(pid: u32) -> Option<PathBuf> {
    std::fs::read_link(format!("/proc/{pid}/exe")).ok()
  }

  /// /proc/<pid>/exe opens the file the process runs, even when its path has
  /// since been replaced or deleted.
  pub fn readable(_exe: &Path, pid: u32) -> PathBuf {
    PathBuf::from(format!("/proc/{pid}/exe"))
  }

  /// Programs on Linux carry no signatures: every one is an unknown publisher, named by its file.
  pub fn publisher_and_name(_exe: &Path) -> (Publisher, Option<String>) {
    (Publisher::unknown(), None)
  }

  /// The parent id and the start time (in clock ticks since boot) from
  /// /proc/<pid>/stat. The name in brackets may hold spaces and brackets
  /// itself, so the fields are counted from the last ')'.
  fn stat(pid: u32) -> Option<(u32, u64)> {
    let text = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let rest = &text[text.rfind(')')? + 1..];
    let fields: Vec<&str> = rest.split_whitespace().collect();
    // Field 4 is the parent, field 22 the start; the list starts at field 3.
    Some((fields.get(1)?.parse().ok()?, fields.get(19)?.parse().ok()?))
  }

  /// The parent, unless its id now belongs to a process that started after the child.
  pub fn parent_of(pid: u32) -> Option<u32> {
    let (parent, child_start) = stat(pid)?;
    if parent == 0 || parent == pid {
      return None;
    }
    let (_, parent_start) = stat(parent)?;
    (parent_start <= child_start).then_some(parent)
  }
}

#[cfg(not(any(windows, target_os = "linux")))]
mod os {
  use super::*;
  pub fn exe_of(_pid: u32) -> Option<PathBuf> {
    None
  }
  pub fn readable(exe: &Path, _pid: u32) -> PathBuf {
    exe.to_path_buf()
  }
  pub fn publisher_and_name(_exe: &Path) -> (Publisher, Option<String>) {
    (Publisher::unknown(), None)
  }
  pub fn parent_of(_pid: u32) -> Option<u32> {
    None
  }
}
