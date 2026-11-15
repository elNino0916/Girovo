// Where the Girovo API listens: a named pipe on Windows, a Unix socket on
// Linux (docs/girovo-api.md "Transport"). Neither is reachable from the
// network or from a web page, and both admit only this user: the pipe by its
// security descriptor (this user and SYSTEM, remote clients refused), the
// socket by its mode 0600 and a check of the peer's uid.
//
// Each accepted connection comes with the process the operating system
// names for its other end (a Peer); identify.rs takes it from there.

use std::io;

#[cfg(windows)]
pub use win::*;

#[cfg(unix)]
pub use unix::*;

/// The process at a connection's other end, taken hold of the moment it
/// connects. Process ids are reused: a client that ends right after
/// connecting leaves its id to the next process started, which must not be
/// identified in its place. On Windows an open handle keeps the id from being
/// given out again; on Linux the start time is compared after identifying.
pub struct Peer {
  pub pid: u32,
  hold: Hold,
}

impl Peer {
  /// Still the process that connected (Linux: the same start time; Windows:
  /// the held handle has kept its id from being reused).
  pub fn same_process(&self) -> bool {
    self.hold.same_process(self.pid)
  }
}

#[cfg(windows)]
mod win {
  use super::*;
  use std::ffi::c_void;
  use std::os::windows::io::AsRawHandle;

  use tokio::net::windows::named_pipe::{NamedPipeServer, PipeMode, ServerOptions};
  use windows::Win32::Foundation::{CloseHandle, HANDLE, HLOCAL, LocalFree};
  use windows::Win32::Security::Authorization::{ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1};
  use windows::Win32::Security::{GetTokenInformation, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER, TokenUser};
  use windows::Win32::System::Pipes::GetNamedPipeClientProcessId;
  use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION};
  use windows::core::{PCWSTR, PWSTR};

  pub type Stream = NamedPipeServer;

  /// `\\.\pipe\girovo-api-<SID>`: one name per Windows user, so two people
  /// logged in at once each reach their own Girovo.
  pub fn default_address() -> io::Result<String> {
    Ok(format!(r"\\.\pipe\girovo-api-{}", user_sid()?))
  }

  /// This process's user as a SID string ("S-1-5-21-…").
  pub fn user_sid() -> io::Result<String> {
    unsafe {
      let mut token = HANDLE::default();
      OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).map_err(io::Error::other)?;
      let mut len = 0u32;
      let _ = GetTokenInformation(token, TokenUser, None, 0, &mut len);
      let mut buf = vec![0u64; (len as usize).div_ceil(8)];
      let read = GetTokenInformation(token, TokenUser, Some(buf.as_mut_ptr() as *mut c_void), len, &mut len);
      let _ = CloseHandle(token);
      read.map_err(io::Error::other)?;
      let user = &*(buf.as_ptr() as *const TOKEN_USER);
      let mut text = PWSTR::null();
      ConvertSidToStringSidW(user.User.Sid, &mut text).map_err(io::Error::other)?;
      let sid = text.to_string().map_err(io::Error::other);
      let _ = LocalFree(Some(HLOCAL(text.0 as *mut c_void)));
      sid
    }
  }

  /// A security descriptor from SDDL, freed with LocalFree.
  struct Descriptor(PSECURITY_DESCRIPTOR);

  impl Drop for Descriptor {
    fn drop(&mut self) {
      unsafe {
        let _ = LocalFree(Some(HLOCAL(self.0.0)));
      }
    }
  }

  impl Descriptor {
    /// A protected DACL (nothing inherited) with full access for this user and
    /// SYSTEM and nobody else. Lower-integrity processes (a browser's sandbox)
    /// stay out too: without a label of its own, the pipe gets the default
    /// medium label, which they can't write up to.
    fn current_user() -> io::Result<Descriptor> {
      let sid = user_sid()?;
      // The owner is this user even when Girovo runs elevated (whose default
      // owner is the Administrators group): Girovo MCP checks it when it
      // can't read an elevated server's token.
      let sddl = format!("O:{sid}D:P(A;;GA;;;{sid})(A;;GA;;;SY)");
      let wide: Vec<u16> = sddl.encode_utf16().chain(Some(0)).collect();
      let mut sd = PSECURITY_DESCRIPTOR::default();
      unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(PCWSTR(wide.as_ptr()), SDDL_REVISION_1, &mut sd, None).map_err(io::Error::other)?;
      }
      Ok(Descriptor(sd))
    }
  }

  pub struct Listener {
    name: String,
    descriptor: Descriptor,
    /// The instance waiting for the next client.
    next: NamedPipeServer,
  }

  impl Listener {
    /// The first instance must be new: if another process already holds the
    /// name, clients would reach it instead, so binding fails rather than share.
    pub fn bind(name: &str) -> io::Result<Listener> {
      let descriptor = Descriptor::current_user()?;
      let next = create(name, &descriptor, true)?;
      Ok(Listener { name: name.to_string(), descriptor, next })
    }

    /// The next client, and its process as Windows names it.
    pub async fn accept(&mut self) -> io::Result<(Stream, Option<Peer>)> {
      let connected = self.next.connect().await;
      // A fresh instance waits before the connected one is handed on, so a
      // client arriving meanwhile finds the pipe there.
      let fresh = create(&self.name, &self.descriptor, false)?;
      let instance = std::mem::replace(&mut self.next, fresh);
      connected?;
      let peer = client_pid(&instance).and_then(|pid| Hold::open(pid).map(|hold| Peer { pid, hold }));
      Ok((instance, peer))
    }
  }

  fn create(name: &str, descriptor: &Descriptor, first: bool) -> io::Result<NamedPipeServer> {
    let mut attributes = SECURITY_ATTRIBUTES {
      nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
      lpSecurityDescriptor: descriptor.0.0,
      bInheritHandle: false.into(),
    };
    unsafe {
      ServerOptions::new()
        .first_pipe_instance(first)
        .reject_remote_clients(true)
        .pipe_mode(PipeMode::Byte)
        .create_with_security_attributes_raw(name, &mut attributes as *mut SECURITY_ATTRIBUTES as *mut c_void)
    }
  }

  /// An open handle to the client's process: while it is open, Windows gives
  /// its id to no other process.
  pub(super) struct Hold(HANDLE);
  unsafe impl Send for Hold {}
  unsafe impl Sync for Hold {}

  impl Hold {
    fn open(pid: u32) -> Option<Hold> {
      unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok().map(Hold) }
    }
    pub(super) fn same_process(&self, _pid: u32) -> bool {
      true
    }
  }

  impl Drop for Hold {
    fn drop(&mut self) {
      unsafe {
        let _ = CloseHandle(self.0);
      }
    }
  }

  fn client_pid(pipe: &NamedPipeServer) -> Option<u32> {
    let mut pid = 0u32;
    unsafe { GetNamedPipeClientProcessId(HANDLE(pipe.as_raw_handle()), &mut pid).ok()? };
    (pid != 0).then_some(pid)
  }
}

#[cfg(unix)]
mod unix {
  use super::*;
  use std::os::unix::fs::{MetadataExt, PermissionsExt};
  use std::path::{Path, PathBuf};

  use tokio::net::{UnixListener, UnixStream};

  pub type Stream = UnixStream;

  /// `$XDG_RUNTIME_DIR/girovo-api.sock` (a folder only this user can enter,
  /// emptied at logout); without one, Girovo's data folder.
  pub fn default_address() -> io::Result<String> {
    let dir = std::env::var_os("XDG_RUNTIME_DIR")
      .filter(|d| !d.is_empty())
      .map(PathBuf::from)
      .filter(|d| d.is_dir())
      .unwrap_or_else(|| crate::paths::data_root().to_path_buf());
    Ok(dir.join("girovo-api.sock").to_string_lossy().into_owned())
  }

  pub struct Listener {
    path: PathBuf,
    /// The socket file this listener made, to remove only that one at the end.
    node: (u64, u64),
    inner: UnixListener,
  }

  impl Listener {
    /// Bound under a temporary name, set to 0600, then renamed into place: the
    /// socket is never reachable under its real name with wider rights. A
    /// socket left by a crash is replaced by the rename.
    pub fn bind(path: &str) -> io::Result<Listener> {
      let path = PathBuf::from(path);
      let dir = path.parent().unwrap_or(Path::new("."));
      let temp = dir.join(format!(".girovo-api.{}.tmp", std::process::id()));
      let _ = std::fs::remove_file(&temp);
      let inner = UnixListener::bind(&temp)?;
      let placed = std::fs::set_permissions(&temp, std::fs::Permissions::from_mode(0o600)).and_then(|_| std::fs::rename(&temp, &path));
      if let Err(e) = placed {
        let _ = std::fs::remove_file(&temp);
        return Err(e);
      }
      let meta = std::fs::symlink_metadata(&path)?;
      Ok(Listener { path, node: (meta.dev(), meta.ino()), inner })
    }

    /// The next client, and its process id; none for another user's process
    /// (root gets past the file's mode), which is then turned away.
    pub async fn accept(&mut self) -> io::Result<(Stream, Option<Peer>)> {
      let (stream, _) = self.inner.accept().await?;
      let peer = stream
        .peer_cred()
        .ok()
        .filter(|cred| cred.uid() == unsafe { libc::geteuid() })
        .and_then(|cred| cred.pid())
        .and_then(|pid| u32::try_from(pid).ok())
        .filter(|&pid| pid != 0)
        .and_then(|pid| Some(Peer { pid, hold: Hold(started(pid)?) }));
      Ok((stream, peer))
    }
  }

  /// The process's start time when it connected, in clock ticks since boot.
  pub(super) struct Hold(u64);

  impl Hold {
    pub(super) fn same_process(&self, pid: u32) -> bool {
      started(pid) == Some(self.0)
    }
  }

  /// Field 22 of /proc/<pid>/stat, counted from the last ')' since the name may hold any.
  fn started(pid: u32) -> Option<u64> {
    let text = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let rest = &text[text.rfind(')')? + 1..];
    rest.split_whitespace().nth(19)?.parse().ok()
  }

  impl Drop for Listener {
    /// Off, the socket does not exist: the file goes, unless another Girovo has put its own there since.
    fn drop(&mut self) {
      if let Ok(meta) = std::fs::symlink_metadata(&self.path) {
        if (meta.dev(), meta.ino()) == self.node {
          let _ = std::fs::remove_file(&self.path);
        }
      }
    }
  }
}
