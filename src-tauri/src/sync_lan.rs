// Sync "Direkt im WLAN" (lib/sync.ts, lib/sync-stores.ts): while the app runs,
// the shell serves the sync folder to the home network, so the phone can leave
// its files there and read the computer's. The computer's own sync — the
// route handlers in the page — reads and writes the same folder directly
// (files.rs folder_get / folder_put, place "lan"). Ported from
// electron/sync-lan.cjs, rule for rule.
//
// It is a dumb file shelf: GET and PUT of one file by name under
// /girovo-sync/v1/, nothing else. Every file is sealed with the group's key
// before it gets here, so the network and this shelf see sizes and times,
// never content. A name must look like a sync file, and every request must
// carry its group's token — derived from the key, kept beside the files by
// this computer's own sync (lib/sync-stores.ts keepLanToken) — so nobody else
// on the network can read, overwrite or store anything. A group holds at most
// MAX_FILES files, and only a few uploads run at once.
//
// Plain HTTP/1.1 on std's sockets, one thread per connection, every answer
// with its length and `connection: close`: the phone reads it over a plain
// socket (SyncPlugin.java) and sends one request per connection.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::Manager;

use crate::paths::state_dir;
use crate::prefs::Prefs;

pub const PREFIX: &str = "/girovo-sync/v1/";
const MAX_BYTES: u64 = 64 * 1024 * 1024;
const MAX_FILES: usize = 600;
const MAX_UPLOADS: usize = 3;
const TOKEN_HEADER: &str = "x-girovo-sync";
/// Node's limit for a request's head; beyond it the request is turned away.
const MAX_HEAD: usize = 16 * 1024;
/// Connections at once. Node set none; a thread each here, so a flood from
/// the network is answered "busy" instead of costing a thread per socket.
const MAX_CONNECTIONS: usize = 32;
/// A phone that stops sending mid-request does not hold its thread for long.
const IO_TIMEOUT: Duration = Duration::from_secs(30);

/// The preference that keeps the shelf on across starts.
const ON_PREF: &str = "fints.sync.lan";
/// One port per install, kept: the phone keeps the address it was given.
const PORT_PREF: &str = "fints.sync.lanPort";

/// The folder the phone's files are kept in: the state folder's sync-lan
/// (lib/sync-stores.ts lanHostDir).
pub fn lan_dir() -> PathBuf {
  state_dir().join("sync-lan")
}

fn hex(b: &u8) -> bool {
  b.is_ascii_digit() || (b'a'..=b'f').contains(b)
}

/// A sync file's group, when `name` is one — `<24 hex>[.<16–32 hex>].(devices|state|doc)`,
/// lib/sync-stores.ts NAME — else None.
pub fn group_of(name: &str) -> Option<&str> {
  let bytes = name.as_bytes();
  if bytes.len() < 24 || !bytes[..24].iter().all(hex) {
    return None;
  }
  let kind = |k: &str| matches!(k, "devices" | "state" | "doc");
  let rest = name[24..].strip_prefix('.')?;
  let ok = match rest.split_once('.') {
    None => kind(rest),
    Some((mid, k)) => (16..=32).contains(&mid.len()) && mid.as_bytes().iter().all(hex) && kind(k),
  };
  ok.then(|| &name[..24])
}

// ---------------------------------------------------------------------------
// This computer's addresses

/// A network interface as the system lists it.
pub struct Nic {
  pub name: String,
  pub ip: IpAddr,
  pub internal: bool,
}

/// Adapters of virtual machines and containers: never where the phone is.
fn is_virtual(name: &str) -> bool {
  let n = name.to_ascii_lowercase();
  const PARTS: [&str; 11] = ["vethernet", "virtualbox", "vmware", "hyper-v", "wsl", "docker", "vbox", "veth", "virbr", "tailscale", "zerotier"];
  n.starts_with("br-") || PARTS.iter().any(|p| n.contains(p))
}

/// This computer's addresses on private networks, the ones the phone can reach: at most four.
pub fn private_addresses(nics: &[Nic]) -> Vec<String> {
  let mut out = Vec::new();
  for nic in nics {
    if is_virtual(&nic.name) || nic.internal {
      continue;
    }
    if let IpAddr::V4(v4) = nic.ip {
      let [a, b, ..] = v4.octets();
      if a == 10 || (a == 192 && b == 168) || (a == 172 && (16..=31).contains(&b)) {
        out.push(v4.to_string());
      }
    }
  }
  out.truncate(4);
  out
}

/// The system's interfaces that are up, as Node's os.networkInterfaces() lists them.
fn system_nics() -> Vec<Nic> {
  if_addrs::get_if_addrs()
    .unwrap_or_default()
    .into_iter()
    .filter(|i| i.is_oper_up())
    .map(|i| Nic { internal: i.is_loopback(), ip: i.ip(), name: i.name })
    .collect()
}

// ---------------------------------------------------------------------------
// The server

struct Running {
  stop: Arc<AtomicBool>,
  port: u16,
  thread: Option<JoinHandle<()>>,
}

/// The shelf, on or off; one per app (managed state).
pub struct LanShelf {
  running: Mutex<Option<Running>>,
  host: Ipv4Addr,
  dir: Box<dyn Fn() -> PathBuf + Send + Sync>,
}

impl Default for LanShelf {
  /// Every IPv4 interface, where the phone reaches it — except in a test run
  /// (GIROVO_DATA_DIR): listening on the network makes Windows offer the
  /// user a firewall rule, and a test run leaves the system as it was.
  fn default() -> Self {
    let test_run = std::env::var_os("GIROVO_DATA_DIR").is_some_and(|d| !d.is_empty());
    LanShelf::new(if test_run { Ipv4Addr::LOCALHOST } else { Ipv4Addr::UNSPECIFIED }, lan_dir)
  }
}

impl LanShelf {
  /// `host`: the address it listens on; `dir`: the folder it serves, asked for each request.
  pub fn new(host: Ipv4Addr, dir: impl Fn() -> PathBuf + Send + Sync + 'static) -> Self {
    LanShelf { running: Mutex::new(None), host, dir: Box::new(dir) }
  }

  /// Starts listening on `port`; returns once it does. Already running: nothing changes.
  pub fn start(self: &Arc<Self>, port: u16) -> std::io::Result<()> {
    let mut running = self.running.lock().unwrap();
    if running.is_some() {
      return Ok(());
    }
    let listener = TcpListener::bind(SocketAddr::from((self.host, port)))?;
    let stop = Arc::new(AtomicBool::new(false));
    let shelf = Arc::clone(self);
    let stopped = Arc::clone(&stop);
    let thread = std::thread::Builder::new().name("sync-lan".into()).spawn(move || shelf.serve(listener, stopped))?;
    *running = Some(Running { stop, port, thread: Some(thread) });
    Ok(())
  }

  /// Stops listening; requests already in flight finish.
  pub fn stop(&self) {
    let Some(mut run) = self.running.lock().unwrap().take() else { return };
    run.stop.store(true, Ordering::SeqCst);
    // The listener waits in accept(): a connection of its own wakes it, and
    // the socket is closed once this returns, so a start right after can bind
    // the port again.
    let woken = TcpStream::connect_timeout(&SocketAddr::from((Ipv4Addr::LOCALHOST, run.port)), Duration::from_secs(2)).is_ok();
    if woken {
      if let Some(t) = run.thread.take() {
        let _ = t.join();
      }
    }
  }

  #[cfg(test)]
  pub fn running(&self) -> bool {
    self.running.lock().unwrap().is_some()
  }

  fn serve(self: Arc<Self>, listener: TcpListener, stop: Arc<AtomicBool>) {
    let uploads = Arc::new(AtomicUsize::new(0));
    let connections = Arc::new(AtomicUsize::new(0));
    for conn in listener.incoming() {
      if stop.load(Ordering::SeqCst) {
        break;
      }
      let Ok(stream) = conn else {
        // A connection reset before it was accepted; a short pause keeps a
        // listener in trouble from spinning.
        std::thread::sleep(Duration::from_millis(20));
        continue;
      };
      if connections.fetch_add(1, Ordering::SeqCst) >= MAX_CONNECTIONS {
        connections.fetch_sub(1, Ordering::SeqCst);
        let mut stream = stream;
        let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
        answer(&mut stream, 503, &[]);
        continue;
      }
      let shelf = Arc::clone(&self);
      let uploads = Arc::clone(&uploads);
      let count = Arc::clone(&connections);
      let spawned = std::thread::Builder::new().name("sync-lan-request".into()).spawn(move || {
        shelf.handle(stream, &uploads);
        count.fetch_sub(1, Ordering::SeqCst);
      });
      if spawned.is_err() {
        connections.fetch_sub(1, Ordering::SeqCst);
      }
    }
  }

  fn handle(&self, mut stream: TcpStream, uploads: &AtomicUsize) {
    let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(IO_TIMEOUT));
    let _ = stream.set_nodelay(true);
    let Ok(read_half) = stream.try_clone() else { return };
    let mut reader = BufReader::new(read_half);
    let head = match read_head(&mut reader) {
      Ok(h) => h,
      Err(status) => {
        answer(&mut stream, status, &[]);
        return;
      }
    };
    let (status, body) = self.respond(&head, &mut reader, uploads);
    answer(&mut stream, status, &body);
  }

  /// The answer to one request: the shelf's rules, electron/sync-lan.cjs handle().
  fn respond(&self, head: &Head, body: &mut impl BufRead, uploads: &AtomicUsize) -> (u16, Vec<u8>) {
    let Some(name) = head.target.strip_prefix(PREFIX) else { return (404, Vec::new()) };
    let Some(group) = group_of(name) else { return (404, Vec::new()) };
    let folder = (self.dir)();
    // Only groups this computer is in, and only with their token.
    let token = match std::fs::read(folder.join(format!("{group}.token"))) {
      Ok(t) if !t.is_empty() => t,
      _ => return (404, Vec::new()),
    };
    match head.token.as_deref() {
      Some(sent) if same(sent.as_bytes(), &token) => {}
      _ => return (404, Vec::new()),
    }
    let file = folder.join(name);
    match head.method.as_str() {
      "GET" => match std::fs::read(&file) {
        Ok(data) => (200, data),
        Err(_) => (404, Vec::new()),
      },
      "PUT" => (self.put(&folder, group, &file, head, body, uploads), Vec::new()),
      _ => (405, Vec::new()),
    }
  }

  fn put(&self, folder: &Path, group: &str, file: &Path, head: &Head, body: &mut impl BufRead, uploads: &AtomicUsize) -> u16 {
    if !file.exists() {
      let prefix = format!("{group}.");
      let count = match std::fs::read_dir(folder) {
        Ok(entries) => entries.filter_map(Result::ok).filter(|e| e.file_name().to_string_lossy().starts_with(&prefix)).count(),
        Err(_) => return 500,
      };
      if count >= MAX_FILES {
        return 507;
      }
    }
    // A place among the uploads, given back however this one ends.
    if uploads.fetch_add(1, Ordering::SeqCst) >= MAX_UPLOADS {
      uploads.fetch_sub(1, Ordering::SeqCst);
      return 503;
    }
    struct Release<'a>(&'a AtomicUsize);
    impl Drop for Release<'_> {
      fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
      }
    }
    let _release = Release(uploads);
    let data = match read_body(head, body) {
      Ok(d) => d,
      Err(status) => return status,
    };
    let millis = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let tmp = PathBuf::from(format!("{}.{}.{millis}.tmp", file.display(), std::process::id()));
    if std::fs::write(&tmp, &data).is_err() {
      let _ = std::fs::remove_file(&tmp);
      return 500;
    }
    if crate::files::rename_retrying(&tmp, file).is_err() {
      let _ = std::fs::remove_file(&tmp);
      return 500;
    }
    204
  }
}

/// Equal bytes, compared in full whatever the first difference — a token is a secret.
fn same(a: &[u8], b: &[u8]) -> bool {
  a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

// ---------------------------------------------------------------------------
// HTTP/1.1, as far as the phone speaks it

struct Head {
  method: String,
  target: String,
  /// The token header; several are joined with ", " as Node joins them (and then never match).
  token: Option<String>,
  content_length: Option<u64>,
  chunked: bool,
}

/// One line of the head, without its line end; Err(431) once the head is too long.
fn read_line(reader: &mut impl BufRead, budget: &mut usize) -> Result<String, u16> {
  let mut line = Vec::new();
  let limit = (*budget as u64) + 1;
  let n = reader.by_ref().take(limit).read_until(b'\n', &mut line).map_err(|_| 400u16)?;
  if n == 0 {
    return Err(400);
  }
  if !line.ends_with(b"\n") {
    return Err(if n as u64 >= limit { 431 } else { 400 });
  }
  *budget = budget.saturating_sub(n);
  line.pop();
  if line.ends_with(b"\r") {
    line.pop();
  }
  // Header bytes as Node reads them: one character per byte.
  Ok(line.iter().map(|&b| b as char).collect())
}

fn read_head(reader: &mut impl BufRead) -> Result<Head, u16> {
  let mut budget = MAX_HEAD;
  let request = read_line(reader, &mut budget)?;
  let mut parts = request.split(' ');
  let (Some(method), Some(target), Some(version), None) = (parts.next(), parts.next(), parts.next(), parts.next()) else {
    return Err(400);
  };
  if method.is_empty() || !method.bytes().all(|b| b.is_ascii_uppercase()) || target.is_empty() || !version.starts_with("HTTP/1.") {
    return Err(400);
  }
  let mut head = Head { method: method.to_string(), target: target.to_string(), token: None, content_length: None, chunked: false };
  loop {
    let line = read_line(reader, &mut budget)?;
    if line.is_empty() {
      break;
    }
    let Some((name, value)) = line.split_once(':') else { return Err(400) };
    if name.is_empty() || name.contains([' ', '\t']) {
      return Err(400);
    }
    let value = value.trim_matches([' ', '\t']);
    match name.to_ascii_lowercase().as_str() {
      TOKEN_HEADER => {
        head.token = Some(match head.token.take() {
          Some(earlier) => format!("{earlier}, {value}"),
          None => value.to_string(),
        });
      }
      "content-length" => {
        let n: u64 = value.parse().map_err(|_| 400u16)?;
        if !value.bytes().all(|b| b.is_ascii_digit()) || head.content_length.is_some_and(|m| m != n) {
          return Err(400);
        }
        head.content_length = Some(n);
      }
      "transfer-encoding" => {
        if value.to_ascii_lowercase().split(',').any(|t| t.trim() == "chunked") {
          head.chunked = true;
        }
      }
      _ => {}
    }
  }
  // Both at once is how requests are smuggled past a proxy; Node refuses it too.
  if head.chunked && head.content_length.is_some() {
    return Err(400);
  }
  Ok(head)
}

/// The request's body, whole; Err(413) once it is larger than a sync file may be.
fn read_body(head: &Head, reader: &mut impl BufRead) -> Result<Vec<u8>, u16> {
  if head.chunked {
    return read_chunked(reader);
  }
  let len = head.content_length.unwrap_or(0);
  if len > MAX_BYTES {
    return Err(413);
  }
  let mut data = Vec::with_capacity(len.min(1 << 20) as usize);
  reader.by_ref().take(len).read_to_end(&mut data).map_err(|_| 400u16)?;
  if (data.len() as u64) < len {
    return Err(400);
  }
  Ok(data)
}

fn read_chunked(reader: &mut impl BufRead) -> Result<Vec<u8>, u16> {
  let mut data = Vec::new();
  let mut budget = MAX_HEAD;
  loop {
    let line = read_line(reader, &mut budget)?;
    let size = u64::from_str_radix(line.split(';').next().unwrap_or("").trim(), 16).map_err(|_| 400u16)?;
    if size == 0 {
      // Trailers, if any, up to the empty line.
      while !read_line(reader, &mut budget)?.is_empty() {}
      return Ok(data);
    }
    if data.len() as u64 + size > MAX_BYTES {
      return Err(413);
    }
    let before = data.len();
    reader.by_ref().take(size).read_to_end(&mut data).map_err(|_| 400u16)?;
    if (data.len() - before) as u64 != size {
      return Err(400);
    }
    let mut crlf = [0u8; 2];
    reader.read_exact(&mut crlf).map_err(|_| 400u16)?;
    if &crlf != b"\r\n" {
      return Err(400);
    }
    budget = MAX_HEAD;
  }
}

fn reason(status: u16) -> &'static str {
  match status {
    200 => "OK",
    204 => "No Content",
    400 => "Bad Request",
    404 => "Not Found",
    405 => "Method Not Allowed",
    413 => "Payload Too Large",
    431 => "Request Header Fields Too Large",
    500 => "Internal Server Error",
    503 => "Service Unavailable",
    507 => "Insufficient Storage",
    _ => "",
  }
}

/// With its length, never chunked: the phone reads the answer over a plain socket (SyncPlugin.java).
fn answer(stream: &mut TcpStream, status: u16, body: &[u8]) {
  let head = format!(
    "HTTP/1.1 {status} {}\r\ncontent-type: application/octet-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
    reason(status),
    body.len()
  );
  let _ = stream.write_all(head.as_bytes()).and_then(|_| stream.write_all(body)).and_then(|_| stream.flush());
  let _ = stream.shutdown(std::net::Shutdown::Write);
}

// ---------------------------------------------------------------------------
// window.electronSync (bridge.js): the shelf on or off, a folder, this computer's name

/// The kept port, or a new one between 41000 and 48999, kept.
fn lan_port(prefs: &Prefs) -> u16 {
  if let Some(port) = prefs.get(PORT_PREF).and_then(|p| p.parse::<u16>().ok()).filter(|p| (41000..=48999).contains(p)) {
    return port;
  }
  let port = 41000 + (uuid::Uuid::new_v4().as_u128() % 8000) as u16;
  prefs.set(PORT_PREF, Some(&port.to_string()));
  port
}

fn start_lan(shelf: &Arc<LanShelf>, prefs: &Prefs) -> std::io::Result<u16> {
  std::fs::create_dir_all(lan_dir())?;
  let port = lan_port(prefs);
  shelf.start(port)?;
  Ok(port)
}

/// The shelf as the last start left it: on again if it was on.
pub fn start_if_on(shelf: &Arc<LanShelf>, prefs: &Prefs) {
  if prefs.get(ON_PREF).as_deref() == Some("1") {
    if let Err(err) = start_lan(shelf, prefs) {
      eprintln!("[sync-lan] {err}");
    }
  }
}

#[derive(serde::Serialize)]
pub struct LanInfo {
  port: u16,
  addresses: Vec<String>,
}

/// On: where the phone finds it (the port and this computer's private
/// addresses), or null when it cannot listen. Off: null.
#[tauri::command]
pub async fn sync_lan(shelf: tauri::State<'_, Arc<LanShelf>>, prefs: tauri::State<'_, Prefs>, on: bool) -> Result<Option<LanInfo>, ()> {
  if !on {
    prefs.set(ON_PREF, None);
    shelf.stop();
    return Ok(None);
  }
  prefs.set(ON_PREF, Some("1"));
  match start_lan(&shelf, &prefs) {
    Ok(port) => Ok(Some(LanInfo { port, addresses: private_addresses(&system_nics()) })),
    Err(err) => {
      eprintln!("[sync-lan] {err}");
      Ok(None)
    }
  }
}

/// A folder of the user's choosing for "Ordner" sync, or null.
#[tauri::command]
pub async fn sync_pick_folder(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<Option<String>, ()> {
  let (tx, rx) = tokio::sync::oneshot::channel();
  // Made on the main thread, as GTK wants it; awaited off it.
  let made = app.run_on_main_thread(move || {
    let picking = rfd::AsyncFileDialog::new().set_parent(&window).pick_folder();
    std::thread::spawn(move || {
      let _ = tx.send(tauri::async_runtime::block_on(picking));
    });
  });
  if made.is_err() {
    return Ok(None);
  }
  Ok(rx.await.ok().flatten().map(|h| h.path().to_string_lossy().into_owned()))
}

/// This computer's name, for the other devices of the group: at most 40 characters as the page counts them.
#[tauri::command]
pub fn sync_device_name() -> Option<String> {
  let name = gethostname::gethostname().to_string_lossy().into_owned();
  Some(crate::save::utf16_prefix(&name, 40).to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  const GROUP: &str = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const TOKEN: &str = "ffffffffffffffffffffffffffffffff";

  struct Rig {
    dir: PathBuf,
    shelf: Arc<LanShelf>,
    port: u16,
  }

  impl Rig {
    fn new() -> Rig {
      let dir = std::env::temp_dir().join(format!("girovo-lan-{}", uuid::Uuid::new_v4().simple()));
      std::fs::create_dir_all(&dir).unwrap();
      let served = dir.clone();
      // On loopback: a test leaves the firewall alone.
      let shelf = Arc::new(LanShelf::new(Ipv4Addr::LOCALHOST, move || served.clone()));
      // A free port, found by asking the system first.
      let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
      shelf.start(port).unwrap();
      Rig { dir, shelf, port }
    }

    /// One request as the phone sends it; the status, the head and the body of the answer.
    fn ask(&self, method: &str, name: &str, body: Option<&[u8]>, token: Option<&str>) -> (u16, String, Vec<u8>) {
      let mut s = TcpStream::connect(("127.0.0.1", self.port)).unwrap();
      let body = body.unwrap_or(&[]);
      let mut req = format!("{method} {PREFIX}{name} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n", self.port);
      if let Some(t) = token {
        req.push_str(&format!("X-Girovo-Sync: {t}\r\n"));
      }
      req.push_str(&format!("Content-Length: {}\r\n\r\n", body.len()));
      s.write_all(req.as_bytes()).unwrap();
      s.write_all(body).unwrap();
      let mut all = Vec::new();
      s.read_to_end(&mut all).unwrap();
      let split = all.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
      let head = String::from_utf8_lossy(&all[..split]).to_string();
      let status = head.split(' ').nth(1).unwrap().parse().unwrap();
      (status, head, all[split + 4..].to_vec())
    }

    fn status(&self, method: &str, name: &str, body: Option<&[u8]>, token: Option<&str>) -> u16 {
      self.ask(method, name, body, token).0
    }
  }

  impl Drop for Rig {
    fn drop(&mut self) {
      self.shelf.stop();
      let _ = std::fs::remove_dir_all(&self.dir);
    }
  }

  #[test]
  fn a_group_this_computer_is_in_files_go_and_come_back() {
    let r = Rig::new();
    std::fs::write(r.dir.join(format!("{GROUP}.token")), TOKEN).unwrap();
    let name = format!("{GROUP}.{}.state", "b".repeat(16));
    assert_eq!(r.status("GET", &name, None, Some(TOKEN)), 404);
    assert_eq!(r.status("PUT", &name, Some(b"sealed state"), Some(TOKEN)), 204);
    let (status, head, body) = r.ask("GET", &name, None, Some(TOKEN));
    assert_eq!(status, 200);
    // Never chunked: the phone reads it over a plain socket.
    assert!(head.contains(&format!("content-length: {}", "sealed state".len())));
    assert!(!head.to_ascii_lowercase().contains("transfer-encoding"));
    assert_eq!(body, b"sealed state");
    // No temporary file stays behind.
    let left: Vec<_> = std::fs::read_dir(&r.dir).unwrap().map(|e| e.unwrap().file_name()).collect();
    assert_eq!(left.len(), 2);
  }

  #[test]
  fn a_group_it_is_not_in_a_wrong_token_or_a_name_that_is_no_sync_file_nothing() {
    let r = Rig::new();
    assert_eq!(r.status("PUT", &format!("{}.devices", "c".repeat(24)), Some(b"x"), Some(TOKEN)), 404);
    assert_eq!(std::fs::read_dir(&r.dir).unwrap().count(), 0);
    std::fs::write(r.dir.join(format!("{GROUP}.token")), TOKEN).unwrap();
    assert_eq!(r.status("PUT", &format!("{GROUP}.devices"), Some(b"x"), Some(&"e".repeat(32))), 404);
    assert_eq!(r.status("GET", &format!("{GROUP}.devices"), None, None), 404);
    // The token itself is never served.
    assert_eq!(r.status("GET", &format!("{GROUP}.token"), None, Some(TOKEN)), 404);
    std::fs::write(r.dir.join(format!("{GROUP}.devices")), "sealed").unwrap();
    assert_eq!(r.status("GET", &format!("{GROUP}.devices/../../etc"), None, Some(TOKEN)), 404);
    assert_eq!(r.status("GET", "index.html", None, Some(TOKEN)), 404);
    assert_eq!(r.status("DELETE", &format!("{GROUP}.devices"), None, Some(TOKEN)), 405);
    // A token sent twice is no token.
    let mut s = TcpStream::connect(("127.0.0.1", r.port)).unwrap();
    write!(s, "GET {PREFIX}{GROUP}.devices HTTP/1.1\r\nX-Girovo-Sync: {TOKEN}\r\nX-Girovo-Sync: {TOKEN}\r\n\r\n").unwrap();
    let mut answer = String::new();
    s.read_to_string(&mut answer).unwrap();
    assert!(answer.starts_with("HTTP/1.1 404 "), "{answer}");
    // An empty token file lets nobody in, not even with an empty token.
    std::fs::write(r.dir.join(format!("{GROUP}.token")), "").unwrap();
    assert_eq!(r.status("GET", &format!("{GROUP}.devices"), None, Some("")), 404);
  }

  #[test]
  fn a_full_group_takes_no_new_file_but_its_files_still_change() {
    let r = Rig::new();
    std::fs::write(r.dir.join(format!("{GROUP}.token")), TOKEN).unwrap();
    for i in 0..MAX_FILES - 1 {
      std::fs::write(r.dir.join(format!("{GROUP}.{i:016x}.doc")), "x").unwrap();
    }
    assert_eq!(r.status("PUT", &format!("{GROUP}.{:016x}.doc", 1u64 << 40), Some(b"y"), Some(TOKEN)), 507);
    assert_eq!(r.status("PUT", &format!("{GROUP}.{:016x}.doc", 5), Some(b"changed"), Some(TOKEN)), 204);
    assert_eq!(std::fs::read(r.dir.join(format!("{GROUP}.{:016x}.doc", 5))).unwrap(), b"changed");
  }

  #[test]
  fn an_upload_larger_than_a_sync_file_is_refused() {
    let r = Rig::new();
    std::fs::write(r.dir.join(format!("{GROUP}.token")), TOKEN).unwrap();
    let mut s = TcpStream::connect(("127.0.0.1", r.port)).unwrap();
    write!(s, "PUT {PREFIX}{GROUP}.state HTTP/1.1\r\nX-Girovo-Sync: {TOKEN}\r\nContent-Length: {}\r\n\r\n", MAX_BYTES + 1).unwrap();
    let mut answer = String::new();
    s.read_to_string(&mut answer).unwrap();
    assert!(answer.starts_with("HTTP/1.1 413 "), "{answer}");
    assert!(!r.dir.join(format!("{GROUP}.state")).exists());
  }

  #[test]
  fn a_chunked_upload_arrives_whole() {
    let r = Rig::new();
    std::fs::write(r.dir.join(format!("{GROUP}.token")), TOKEN).unwrap();
    let mut s = TcpStream::connect(("127.0.0.1", r.port)).unwrap();
    write!(s, "PUT {PREFIX}{GROUP}.state HTTP/1.1\r\nX-Girovo-Sync: {TOKEN}\r\nTransfer-Encoding: chunked\r\n\r\n6\r\nsealed\r\n6\r\n state\r\n0\r\n\r\n").unwrap();
    let mut answer = String::new();
    s.read_to_string(&mut answer).unwrap();
    assert!(answer.starts_with("HTTP/1.1 204 "), "{answer}");
    assert_eq!(std::fs::read(r.dir.join(format!("{GROUP}.state"))).unwrap(), b"sealed state");
  }

  #[test]
  fn stopped_it_answers_no_more_and_starts_again_on_the_same_port() {
    let r = Rig::new();
    assert!(r.shelf.running());
    r.shelf.stop();
    assert!(!r.shelf.running());
    assert!(TcpStream::connect_timeout(&SocketAddr::from((Ipv4Addr::LOCALHOST, r.port)), Duration::from_millis(500)).is_err());
    r.shelf.start(r.port).unwrap();
    std::fs::write(r.dir.join(format!("{GROUP}.token")), TOKEN).unwrap();
    assert_eq!(r.status("GET", &format!("{GROUP}.devices"), None, Some(TOKEN)), 404);
  }

  #[test]
  fn names_are_the_sync_files_names() {
    let g = "0123456789abcdef01234567";
    assert_eq!(group_of(&format!("{g}.devices")), Some(g));
    assert_eq!(group_of(&format!("{g}.{}.state", "a".repeat(16))), Some(g));
    assert_eq!(group_of(&format!("{g}.{}.doc", "a".repeat(32))), Some(g));
    for bad in [
      format!("{g}.token"),
      format!("{g}.{}.doc", "a".repeat(15)),
      format!("{g}.{}.doc", "a".repeat(33)),
      format!("{g}.{}.doc", "A".repeat(16)),
      format!("{g}.devices.tmp"),
      format!("{g}devices"),
      format!("{}.devices", &g[..23]),
      format!("{}.devices", g.to_uppercase()),
      format!("{g}.x.y.state"),
      "ä".repeat(12) + ".devices",
    ] {
      assert_eq!(group_of(&bad), None, "{bad}");
    }
  }

  #[test]
  fn private_addresses_the_home_network_only_no_virtual_adapters_at_most_four() {
    let nic = |name: &str, ip: &str, internal: bool| Nic { name: name.into(), ip: ip.parse().unwrap(), internal };
    assert_eq!(
      private_addresses(&[
        nic("vEthernet (WSL)", "172.21.224.1", false),
        nic("eth", "192.168.1.20", false),
        nic("eth", "fe80::1", false),
        nic("lo", "127.0.0.1", true),
        nic("vpn", "10.8.0.2", false),
        nic("pub", "84.12.0.1", false),
      ]),
      vec!["192.168.1.20", "10.8.0.2"]
    );
    assert_eq!(
      private_addresses(&[
        nic("br-1a2b", "172.18.0.1", false),
        nic("docker0", "172.17.0.1", false),
        nic("WLAN", "172.32.0.1", false),
        nic("a", "10.0.0.1", false),
        nic("b", "10.0.0.2", false),
        nic("c", "10.0.0.3", false),
        nic("d", "10.0.0.4", false),
        nic("e", "10.0.0.5", false),
      ]),
      vec!["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4"]
    );
  }
}
