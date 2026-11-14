// The Girovo side: a client of the Girovo API's pipe or socket
// (docs/girovo-api.md "Transport", scripts/girovo-api-client.mjs).
//
// One connection, one request at a time: write a line, read lines until the
// answer with that id comes (notifications in between are passed over). A
// synchronous pipe on Windows serialises reads and writes on its handle, so
// a reader thread beside a writer could stall both; one at a time can't.
//
// The connection opens with girovo.hello for the default permissions plus the
// one the first tool needs. A tool whose permission is missing gets a hello for
// just that one, which opens Girovo's dialog, and is tried once more. Girovo
// not running, the API off or the connection gone: NotRunning, and the next
// call connects again.

use std::collections::BTreeSet;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::sync::{Arc, Mutex};

use serde_json::{Map, Value, json};

use crate::tools::{DEFAULT_PERMISSIONS, Tool};

/// Girovo's lines stay well under this (a notification may be 1 MiB); a longer one ends the connection.
const MAX_LINE: u64 = 32 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub enum CallError {
  /// No Girovo to reach: not running, the API off, or the connection gone.
  NotRunning,
  /// The user said no: in the dialog, by switching the permission off, or earlier in this run.
  NotAllowed { refused_app: bool },
  /// Girovo's own error: its string code (data.reason), message and data.
  Rpc { reason: String, message: String, data: Value },
}

/// Where Girovo listens: GIROVO_API_ADDRESS, else the pipe or socket of this user.
pub fn default_address() -> io::Result<String> {
  if let Some(a) = std::env::var_os("GIROVO_API_ADDRESS").filter(|a| !a.is_empty()) {
    return Ok(a.to_string_lossy().into_owned());
  }
  os::default_address()
}

struct Conn {
  reader: BufReader<os::Stream>,
  writer: os::Stream,
}

enum Fail {
  /// The line could not be written: nothing reached Girovo, so it may be sent again.
  Write,
  /// Read failed or ended: Girovo may have acted on it.
  Read,
  Rpc { reason: String, message: String, data: Value },
}

pub struct Girovo {
  address: Option<String>,
  app_version: String,
  conn: Option<Conn>,
  /// The connection's hello was answered.
  said_hello: bool,
  next_id: u64,
  /// What Girovo allows this assistant, as its last answer said; None before the first.
  granted: Arc<Mutex<Option<BTreeSet<String>>>>,
}

impl Girovo {
  pub fn new(address: Option<String>, app_version: String, granted: Arc<Mutex<Option<BTreeSet<String>>>>) -> Girovo {
    Girovo { address, app_version, conn: None, said_hello: false, next_id: 1, granted }
  }

  fn connect(&mut self) -> Result<(), CallError> {
    if self.conn.is_some() {
      return Ok(());
    }
    let address = match &self.address {
      Some(a) => a.clone(),
      None => default_address().map_err(|_| CallError::NotRunning)?,
    };
    let stream = os::connect(&address).map_err(|_| CallError::NotRunning)?;
    let writer = stream.try_clone().map_err(|_| CallError::NotRunning)?;
    self.conn = Some(Conn { reader: BufReader::new(stream), writer });
    self.said_hello = false;
    Ok(())
  }

  fn drop_connection(&mut self) {
    self.conn = None;
    self.said_hello = false;
  }

  /// One request and its answer.
  fn request(&mut self, method: &str, params: Value) -> Result<Value, Fail> {
    let id = self.next_id;
    self.next_id += 1;
    let conn = self.conn.as_mut().ok_or(Fail::Write)?;
    let mut line = serde_json::to_vec(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })).unwrap();
    line.push(b'\n');
    if conn.writer.write_all(&line).and_then(|_| conn.writer.flush()).is_err() {
      self.drop_connection();
      return Err(Fail::Write);
    }
    loop {
      let mut buf = Vec::new();
      let n = (&mut conn.reader).take(MAX_LINE).read_until(b'\n', &mut buf);
      match n {
        Ok(n) if n > 0 && buf.ends_with(b"\n") => {}
        _ => {
          self.drop_connection();
          return Err(Fail::Read);
        }
      }
      let Ok(message) = serde_json::from_slice::<Value>(&buf) else { continue };
      // A notification (girovo.transfer.updated and the like): transfer_status asks for it instead.
      let Some(got) = message.get("id") else { continue };
      if got.as_u64() != Some(id) {
        continue;
      }
      if let Some(error) = message.get("error") {
        let data = error.get("data").cloned().unwrap_or(Value::Null);
        let reason = data.get("reason").and_then(Value::as_str).unwrap_or("internal").to_string();
        let message = error.get("message").and_then(Value::as_str).unwrap_or("").to_string();
        return Err(Fail::Rpc { reason, message, data });
      }
      return Ok(message.get("result").cloned().unwrap_or(Value::Null));
    }
  }

  /// girovo.hello for these permissions; what Girovo allows afterwards.
  fn hello(&mut self, permissions: &[&str], reason: &str) -> Result<BTreeSet<String>, CallError> {
    let params = json!({ "app": "Girovo MCP", "version": self.app_version, "permissions": permissions, "reason": reason });
    match self.request("girovo.hello", params) {
      Ok(result) => {
        let granted: BTreeSet<String> = result
          .get("granted")
          .and_then(Value::as_array)
          .map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect())
          .unwrap_or_default();
        self.said_hello = true;
        *self.granted.lock().unwrap() = Some(granted.clone());
        Ok(granted)
      }
      Err(Fail::Write | Fail::Read) => Err(CallError::NotRunning),
      Err(Fail::Rpc { reason, message, data }) => Err(match reason.as_str() {
        "refused_by_user" => CallError::NotAllowed { refused_app: false },
        "denied" => CallError::NotAllowed { refused_app: true },
        _ => CallError::Rpc { reason, message, data },
      }),
    }
  }

  /// Connected and greeted, asking for the defaults and what `tool` needs.
  fn ready(&mut self, tool: &Tool) -> Result<(), CallError> {
    self.connect()?;
    if self.said_hello {
      return Ok(());
    }
    let mut permissions: Vec<&str> = DEFAULT_PERMISSIONS.to_vec();
    if !permissions.contains(&tool.permission) {
      permissions.push(tool.permission);
    }
    self.hello(&permissions, "Ein KI-Assistent möchte über Girovo MCP mit deinen Finanzen in Girovo arbeiten.").map(|_| ())
  }

  /// Runs one tool: the method's result, or why not.
  pub fn call(&mut self, tool: &Tool, args: &Map<String, Value>) -> Result<Value, CallError> {
    let params = tool.params(args);
    let reused = self.conn.is_some();
    self.ready(tool)?;
    let mut asked = false;
    let mut resent = false;
    loop {
      match self.request(tool.method, params.clone()) {
        Ok(result) => return Ok(result),
        // Girovo was restarted since the last call: the old connection is gone, nothing was sent.
        Err(Fail::Write) if reused && !resent => {
          resent = true;
          self.ready(tool)?;
        }
        Err(Fail::Write | Fail::Read) => return Err(CallError::NotRunning),
        Err(Fail::Rpc { reason, message, data }) => {
          let needed = data.get("permission").and_then(Value::as_str).map(String::from);
          match needed {
            Some(permission) if reason == "not_permitted" && !asked => {
              asked = true;
              if let Some(set) = self.granted.lock().unwrap().as_mut() {
                set.remove(&permission);
              }
              let reason_line = format!("Ein KI-Assistent möchte über Girovo MCP „{}“ verwenden.", tool.title);
              let granted = self.hello(&[permission.as_str()], &reason_line)?;
              if !granted.contains(&permission) {
                return Err(CallError::NotAllowed { refused_app: false });
              }
            }
            _ => return Err(CallError::Rpc { reason, message, data }),
          }
        }
      }
    }
  }
}

#[cfg(windows)]
mod os {
  use std::ffi::c_void;
  use std::io;
  use std::time::{Duration, Instant};

  use windows::Win32::Foundation::{CloseHandle, HANDLE, HLOCAL, LocalFree};
  use windows::Win32::Security::Authorization::ConvertSidToStringSidW;
  use windows::Win32::Security::{GetTokenInformation, TOKEN_QUERY, TOKEN_USER, TokenUser};
  use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
  use windows::core::PWSTR;

  pub type Stream = std::fs::File;

  /// All of the pipe's instances are taken for a moment: Girovo puts a fresh one there right after.
  const ERROR_PIPE_BUSY: i32 = 231;

  /// `\\.\pipe\girovo-api-<SID>`, as Girovo's shell names it (src-tauri/src/api/transport.rs).
  pub fn default_address() -> io::Result<String> {
    Ok(format!(r"\\.\pipe\girovo-api-{}", user_sid()?))
  }

  fn user_sid() -> io::Result<String> {
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

  pub fn connect(address: &str) -> io::Result<Stream> {
    let start = Instant::now();
    loop {
      match std::fs::OpenOptions::new().read(true).write(true).open(address) {
        Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY) && start.elapsed() < Duration::from_secs(2) => {
          std::thread::sleep(Duration::from_millis(20));
        }
        other => return other,
      }
    }
  }
}

#[cfg(unix)]
mod os {
  use std::io;
  use std::path::PathBuf;

  pub type Stream = std::os::unix::net::UnixStream;

  /// `$XDG_RUNTIME_DIR/girovo-api.sock`, else in Girovo's data folder (~/.config/Girovo), as the shell does.
  pub fn default_address() -> io::Result<String> {
    let dir = std::env::var_os("XDG_RUNTIME_DIR")
      .filter(|d| !d.is_empty())
      .map(PathBuf::from)
      .filter(|d| d.is_dir())
      .or_else(|| {
        let config = std::env::var_os("XDG_CONFIG_HOME").filter(|d| !d.is_empty()).map(PathBuf::from);
        config.or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config"))).map(|c| c.join("Girovo"))
      })
      .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no runtime or home folder"))?;
    Ok(dir.join("girovo-api.sock").to_string_lossy().into_owned())
  }

  pub fn connect(address: &str) -> io::Result<Stream> {
    Stream::connect(address)
  }
}
