// Who is on the other end of a connection (docs/girovo-api.md "Who is
// asking"). Only the shell decides this, from the operating system's facts:
// the process behind the pipe or socket, its executable, the file's SHA-256
// and, on Windows, its Authenticode signature. Nothing a client says about
// itself goes into it.
//
// The parent process is identified the same way and sent along: Girovo's own
// MCP helper (phase 3) stands for the assistant that started it, and the
// dialog shows that one. On Windows a program may name any other as the
// parent of what it starts, so the helper's hello also says `launcher`: the
// process behind the pipe on its stdin, which Windows reports and no program
// can choose for another. The server weighs the two (parent_from).

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

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
/// Signatures looked at once are remembered; past this many the memory starts over.
const CACHE_MAX: usize = 64;

/// The process `pid` and its parent, or None when the process can't be read
/// (gone already, or not this user's).
pub fn client(pid: u32) -> Option<Client> {
  let mut me = process(pid)?;
  me.parent = os::parent_of(pid).and_then(process).map(Box::new);
  Some(me)
}

/// The process that started Girovo's MCP helper `helper`, by the pipe on the
/// helper's stdin: identified only when it started before the helper, since a
/// process id that came free since belongs to someone else.
pub fn launcher(pid: u32, helper: u32) -> Option<Client> {
  if !os::started_before(pid, helper) {
    return None;
  }
  let who = process(pid)?;
  os::started_before(pid, helper).then_some(who)
}

/// Girovo's MCP helper, as the page tells it (lib/api/grants.ts isMcpHelper):
/// signed by MT-Media and named girovo-mcp(.exe). Only it may speak for another program.
pub fn is_mcp_helper(client: &Client) -> bool {
  let file = client.exe.rsplit(['\\', '/']).next().unwrap_or(&client.exe).to_ascii_lowercase();
  client.publisher.kind == Kind::Mtmedia && (file == "girovo-mcp" || file == "girovo-mcp.exe")
}

/// Windows lets a program name another as its child's parent: there the
/// helper's hello must say who launched it, or its parent counts for nothing.
pub const LAUNCHER_REQUIRED: bool = cfg!(windows);

/// Whom Girovo's MCP helper stands for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParentFrom {
  /// The parent the system reports.
  Parent,
  /// Another process: the one that made the helper's stdin, to be identified.
  Launcher(u32),
  /// Nobody: the connection is the helper alone, and the user is asked again.
  Nobody,
}

/// The helper `helper` with the parent the system reports and the launcher
/// its hello names. A launcher that is the parent changes nothing; another
/// one is who started the helper, whatever parent Windows was told; the
/// helper itself is nobody. Without a launcher the parent stands only where
/// a parent can't be made up (`required` false: Linux).
pub fn parent_from(helper: u32, parent: Option<u32>, launcher: Option<u32>, required: bool) -> ParentFrom {
  match launcher {
    Some(l) if l == helper => ParentFrom::Nobody,
    Some(l) if Some(l) == parent => ParentFrom::Parent,
    Some(l) => ParentFrom::Launcher(l),
    None if required => ParentFrom::Nobody,
    None => ParentFrom::Parent,
  }
}

fn process(pid: u32) -> Option<Client> {
  let exe = os::exe_of(pid)?;
  let facts = facts_of(&exe, &os::readable(&exe, pid))?;
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
pub(super) struct Facts {
  pub(super) sha256: String,
  pub(super) name: String,
  pub(super) publisher: Publisher,
}

/// What a file's signature says and the name in its resources, by the file's SHA-256.
fn cache() -> &'static Mutex<HashMap<String, (Publisher, Option<String>)>> {
  static CACHE: OnceLock<Mutex<HashMap<String, (Publisher, Option<String>)>>> = OnceLock::new();
  CACHE.get_or_init(Default::default)
}

/// `exe` is the path shown; `source` the file read, which on Linux is
/// /proc/<pid>/exe: the very file that runs, even if the path now names another.
///
/// The file is hashed on every connection. Its size and time prove nothing: a
/// program of the same user could put another file of the same size and the
/// old time in a granted app's place and take over its grant. Only the slow
/// part, the signature check, is remembered, by the hash. While it is hashed
/// and checked the file stays open with nobody allowed to write, rename or
/// delete it (Windows), so the signature speaks for the very bytes hashed.
pub(super) fn facts_of(exe: &Path, source: &Path) -> Option<Facts> {
  let mut file = open_unchangeable(source).ok()?;
  let sha256 = sha256_from(&mut file)?;
  let (publisher, name) = signed_cached(&sha256, exe);
  drop(file);
  let file_name = exe.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| exe.to_string_lossy().into_owned());
  let name = name.map(|n| clean(&n)).filter(|n| !n.is_empty()).unwrap_or_else(|| clean(&file_name));
  Some(Facts { sha256, name, publisher })
}

/// Checking a signature takes a moment and an app connects again and again:
/// the result is kept for the file's content, which the hash names.
fn signed_cached(sha256: &str, exe: &Path) -> (Publisher, Option<String>) {
  if let Some(known) = cache().lock().unwrap().get(sha256) {
    return known.clone();
  }
  let found = os::publisher_and_name(exe);
  let mut cache = cache().lock().unwrap();
  if cache.len() >= CACHE_MAX {
    cache.clear();
  }
  cache.insert(sha256.to_string(), found.clone());
  found
}

/// The file opened for reading, on Windows without sharing it for writing or
/// deleting: nobody can change, rename or replace it while this is open, and
/// it fails while someone is writing it.
pub(super) fn open_unchangeable(path: &Path) -> std::io::Result<std::fs::File> {
  #[cfg(windows)]
  {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_SHARE_READ: u32 = 1;
    std::fs::OpenOptions::new().read(true).share_mode(FILE_SHARE_READ).open(path)
  }
  #[cfg(not(windows))]
  std::fs::File::open(path)
}

#[cfg(test)]
pub fn sha256_of(path: &Path) -> Option<String> {
  sha256_from(&mut std::fs::File::open(path).ok()?)
}

fn sha256_from(file: &mut std::fs::File) -> Option<String> {
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

  /// Whether `pid` started no later than `other`; false when either can't be read.
  pub fn started_before(pid: u32, other: u32) -> bool {
    started(pid).zip(started(other)).is_some_and(|(a, b)| a <= b)
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

  /// Whether `pid` started no later than `other`; false when either can't be read.
  pub fn started_before(pid: u32, other: u32) -> bool {
    stat(pid).zip(stat(other)).is_some_and(|((_, a), (_, b))| a <= b)
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
  pub fn started_before(_pid: u32, _other: u32) -> bool {
    false
  }
}
