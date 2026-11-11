// Girovo Next's "Fragen" on the desktop: Gemma 4 E2B, run by llama.cpp's
// llama-server on this computer. Nothing of it ships with the app: both the
// runtime (llama.cpp's own release build, about 36 MB) and the model (about
// 3.4 GB) are downloaded only when the user asks for them, each pinned to one
// file and its SHA-256, and a file that does not match is deleted, never run.
//
//   gemma_state     the state below
//   gemma_download  runtime first (small), then the model; answers at once, the progress comes as events
//   gemma_cancel    stops the download; what has arrived stays for the next try (HTTP Range)
//   gemma_remove    stops the server, deletes everything this file ever put on the disk
//   gemma_prompt    one question, one answer: the model's text, or null
//
// Every change goes out as STATE_EVENT (the bridge's onState, src/bridge.js
// electronGemma), progress at most four times a second.
//
// The server is started on the first prompt, not with the app: it holds
// about 3 GB of memory. It stays warm for the next question and stops after
// IDLE without one, and when the app ends. It listens on 127.0.0.1 only, on a
// port picked anew for each start, and answers only requests that carry a key
// made anew for each start; neither ever reaches the page, which only gets
// the text; before the first prompt the server must prove it is ours (it
// refuses a request without the key and names our model), so a program that
// took the port in between gets nothing. The first start on a GPU compiles
// Vulkan's shaders (about half a minute); a start that fails there is tried
// once more on the CPU alone (8 threads at most: llama.cpp's default of every
// logical core is half as fast), and that choice holds for the rest of the
// run, so a broken driver does not cost the wait every time. Only for the
// run: the GPU may just have been busy (a game), so the next app start tries
// it again. A GPU server that answers slower than the CPU would (a busy GPU,
// GPU_SLOW) is swapped for a CPU one the same way. When neither works, the
// runtime says so (state.unavailable) and stops trying for this run. A server
// that hangs over a prompt, or fails twice in a row, is ended and started
// afresh for the next one. It ends with Girovo even after a crash: a job
// object on Windows, the kernel's death signal on Linux.
//
// Where: the app's local data folder (%LOCALAPPDATA%\<identifier>\gemma on
// Windows, ~/.local/share/<identifier>/gemma on Linux), not the data folder
// paths.rs names. That one is roaming on Windows, no place for 3.4 GB, and
// Tauri's uninstaller already offers to delete the local one with the app's
// data. A test run (GIROVO_DATA_DIR) keeps it inside its own data folder.
// "Girovo zurücksetzen" deletes it too (reset.rs).

use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::watch;

use crate::texts::Lang;

/// The event every state change goes out as (the bridge's onState).
pub const STATE_EVENT: &str = "gemma:state";

// ---- the pinned files ------------------------------------------------------------

/// llama.cpp's release the runtime comes from, and the folder it is unpacked into.
const RELEASE: &str = "b12250";
const RUNTIME_DIR: &str = "llama-b12250";
const RUNTIME_BASE: &str = "https://github.com/ggml-org/llama.cpp/releases/download/b12250/";
/// Written into the runtime's folder once everything is unpacked: a folder
/// without it is a half-done unpacking and is done again.
const RUNTIME_COMPLETE: &str = ".girovo-complete";

/// One file to download, as it must arrive.
#[derive(Debug, PartialEq, Eq)]
pub struct Pinned {
  pub name: &'static str,
  pub size: u64,
  pub sha256: &'static str,
}

/// llama.cpp's Vulkan builds: the GPU where one is there (any vendor's), and
/// the CPU builds' code beside it for where there is none.
const RUNTIMES: &[(&str, &str, Pinned)] = &[
  (
    "windows",
    "x86_64",
    Pinned {
      name: "llama-b12250-bin-win-vulkan-x64.zip",
      size: 37_895_112,
      sha256: "00ba40348fa2c5f60c605c00f67a670725e48781977c4a365de5c0ec8aa13845",
    },
  ),
  (
    "windows",
    "aarch64",
    Pinned {
      name: "llama-b12250-bin-win-vulkan-arm64.zip",
      size: 25_825_119,
      sha256: "eca63d0864ad503455b1f4ed0ae7b875b3e49dffc8c0b2f5a1c695899bd25016",
    },
  ),
  (
    "linux",
    "x86_64",
    Pinned {
      name: "llama-b12250-bin-ubuntu-vulkan-x64.tar.gz",
      size: 35_983_675,
      sha256: "c01b17254738658735ed6c1c8682542edca3f17e19846683b00e8a0f9e8b9dd1",
    },
  ),
  (
    "linux",
    "aarch64",
    Pinned {
      name: "llama-b12250-bin-ubuntu-vulkan-arm64.tar.gz",
      size: 29_259_142,
      sha256: "7813e18ee26341796ad51b564d8c360f60955ffa4657d85a2172d0a8fdfd55d8",
    },
  ),
];

/// The runtime for this system, None where llama.cpp builds none we pin.
fn runtime_for(os: &str, arch: &str) -> Option<&'static Pinned> {
  RUNTIMES.iter().find(|(o, a, _)| *o == os && *a == arch).map(|(_, _, p)| p)
}

/// Google's quantization-aware Q4_0 build, at one commit of its repository (a
/// later push there changes nothing here). Apache 2.0, not gated: no account,
/// no token. The URL answers with a redirect to Hugging Face's CDN.
const MODEL_URL: &str =
  "https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf/resolve/675cff42a74c774d6cb76f76d8eacb49b48c9b93/gemma-4-E2B_q4_0-it.gguf";
const MODEL_FILE: &str = "gemma-4-E2B_q4_0-it.gguf";
const MODEL_SHA256: &str = "fa401b55b07ee70a54c6dae3903c783a6e65064312529ea57175cb5f8dec6634";
/// The model's size until the server says it exactly (Content-Length): the
/// page shows "about 3.4 GB" from its own texts.
pub const MODEL_SIZE_APPROX: u64 = 3_350_000_000;

/// The server's program in the runtime's folder.
const SERVER_EXE: &str = if cfg!(windows) { "llama-server.exe" } else { "llama-server" };

// ---- timings -----------------------------------------------------------------------

/// How long a start may take before /health answers. The first start on a
/// GPU compiles Vulkan's shaders, about 34 s on the owner's machine.
const START_LIMIT: Duration = Duration::from_secs(90);
/// How long one answer may take once the server is up. One that takes longer
/// means a hung server: it is ended, and started afresh for the next prompt.
const PROMPT_LIMIT: Duration = Duration::from_secs(30);
/// Failed prompts in a row (HTTP errors, unreadable answers) after which the
/// server is ended too.
const FAILURES_IN_A_ROW: u32 = 2;
/// Without a prompt for this long, the server stops and gives its memory back.
const IDLE: Duration = Duration::from_secs(5 * 60);
/// Progress goes out at most this often (four times a second).
const PROGRESS_EVERY: Duration = Duration::from_millis(250);
/// A download that receives nothing for this long counts as broken off.
const STALL: Duration = Duration::from_secs(60);
/// How often a broken-off download is tried again by itself, from where it stopped.
const RETRIES: u32 = 2;
#[cfg(not(test))]
const RETRY_PAUSE: Duration = Duration::from_secs(2);
#[cfg(test)]
const RETRY_PAUSE: Duration = Duration::from_millis(10);

/// The context the server keeps: Girovo's prompts are a few hundred tokens.
const CONTEXT: &str = "4096";
/// The longest prompt text the page may send, either part. The context is far
/// smaller; this only keeps a runaway string off the IPC and the server.
const PROMPT_TEXT_MAX: usize = 64 * 1024;
const MAX_TOKENS_MAX: u32 = 2048;

/// Where builds before 7.0 remembered a failed GPU start for good. Deleted
/// at start: the choice is per run now (Core::cpu_only).
const OLD_CPU_ONLY: &str = "cpu-only";
/// At most this many CPU threads: more of them (llama.cpp takes every logical
/// core by default) made it slower on the owner's 24-thread i9, 14 tokens/s
/// against 26 with 8.
const CPU_THREADS_MAX: usize = 8;
/// A GPU server slower than this (tokens/s, from the server's own timings)
/// is slower than the CPU would be: the GPU is busy with something else.
const GPU_SLOW: f64 = 20.0;
/// An answer this short says little about the speed: not judged.
const SLOW_MIN_TOKENS: u64 = 8;
const SERVER_LOG: &str = "llama-server.log";
const KEY_FILE: &str = "llama-server.key";

// ---- the state ---------------------------------------------------------------------

#[derive(Clone, Copy, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
  Absent,
  Downloading,
  Ready,
  Error,
}

#[derive(Clone, Copy, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
  Runtime,
  Model,
}

/// What the page sees (types/electron-window.d.ts GirovoGemmaState).
#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GemmaState {
  pub state: Kind,
  /// While downloading: which file.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub phase: Option<Phase>,
  /// Bytes of the file being downloaded now: what is on the disk, and all of it.
  pub received: u64,
  pub total: u64,
  /// state 'error': what went wrong, in the app's language, one short line.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error: Option<String>,
  /// Whether the server runs on the GPU; null until a start has told.
  pub gpu: Option<bool>,
  /// The server is up: the next answer comes without the start's wait.
  pub warm: bool,
  /// The server is starting (the first prompt waits for it).
  pub starting: bool,
  /// This system has a runtime to download (Windows and Linux, x64 and arm64).
  pub supported: bool,
  /// Bytes of a download that stopped (cancelled, failed) and goes on from
  /// there next time; 0 when there is none and while downloading. The page
  /// offers to delete them (remove).
  pub partial: u64,
  /// The server could start neither on the GPU nor on the CPU in this run:
  /// prompts answer null at once until the app starts again or remove().
  /// `error` says so.
  pub unavailable: bool,
}

// ---- why a download failed ---------------------------------------------------------

#[derive(Debug)]
enum Fail {
  Cancelled,
  Unsupported,
  /// The connection: refused, broken off, stalled. Tried again by itself.
  Network(String),
  Http(u16),
  /// The server's file is not as long as the pinned one.
  Size,
  /// The bytes arrived and are not the pinned ones.
  Digest,
  Disk(io::Error),
  Unpack(String),
}

impl From<io::Error> for Fail {
  fn from(e: io::Error) -> Self {
    Fail::Disk(e)
  }
}

impl std::fmt::Display for Fail {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      Fail::Cancelled => write!(f, "cancelled"),
      Fail::Unsupported => write!(f, "no runtime for {} {}", std::env::consts::OS, std::env::consts::ARCH),
      Fail::Network(e) => write!(f, "network: {e}"),
      Fail::Http(status) => write!(f, "HTTP {status}"),
      Fail::Size => write!(f, "the file's size is not the pinned one"),
      Fail::Digest => write!(f, "SHA-256 mismatch, file deleted"),
      Fail::Disk(e) => write!(f, "disk: {e}"),
      Fail::Unpack(e) => write!(f, "unpack: {e}"),
    }
  }
}

impl Fail {
  fn retryable(&self) -> bool {
    match self {
      Fail::Network(_) => true,
      Fail::Http(status) => *status == 429 || *status >= 500,
      _ => false,
    }
  }

  /// What the page shows. Short and plain (lib/i18n/README.md Voice).
  fn text(&self, lang: Lang) -> String {
    let de = lang == Lang::De;
    let text = match self {
      Fail::Cancelled => "",
      Fail::Unsupported => {
        if de {
          "Auf diesem System nicht verfügbar."
        } else {
          "Not available on this system."
        }
      }
      Fail::Network(_) | Fail::Http(_) => {
        if de {
          "Der Download hat nicht geklappt. Bitte später noch einmal versuchen."
        } else {
          "The download didn't work. Please try again later."
        }
      }
      Fail::Size | Fail::Digest => {
        if de {
          "Die Datei war beschädigt und wurde gelöscht. Bitte noch einmal laden."
        } else {
          "The file was damaged and has been deleted. Please download it again."
        }
      }
      Fail::Disk(e) if e.kind() == io::ErrorKind::StorageFull => {
        if de {
          "Nicht genug Speicherplatz."
        } else {
          "Not enough disk space."
        }
      }
      Fail::Disk(_) => {
        if de {
          "Die Datei ließ sich nicht speichern."
        } else {
          "The file could not be saved."
        }
      }
      Fail::Unpack(_) => {
        if de {
          "Die Datei ließ sich nicht entpacken."
        } else {
          "The file could not be unpacked."
        }
      }
    };
    text.to_string()
  }
}

fn network(e: reqwest::Error) -> Fail {
  // Without the URL: the model's is long, and the log needs only what happened.
  Fail::Network(e.without_url().to_string())
}

// ---- a cancel switch ---------------------------------------------------------------

/// A cancel switch that can be awaited (as the updater's).
#[derive(Clone)]
struct Cancel(Arc<watch::Sender<bool>>);

impl Cancel {
  fn new() -> Self {
    Cancel(Arc::new(watch::channel(false).0))
  }
  fn cancel(&self) {
    self.0.send_replace(true);
  }
  async fn cancelled(&self) {
    let mut rx = self.0.subscribe();
    let _ = rx.wait_for(|on| *on).await;
  }
  fn same(&self, other: &Cancel) -> bool {
    Arc::ptr_eq(&self.0, &other.0)
  }
}

/// `fut`, unless `cancel` comes first.
async fn abortable<T>(cancel: &Cancel, fut: impl Future<Output = Result<T, Fail>>) -> Result<T, Fail> {
  tokio::select! {
    r = fut => r,
    _ = cancel.cancelled() => Err(Fail::Cancelled),
  }
}

// ---- downloading -------------------------------------------------------------------

fn hex(bytes: &[u8]) -> String {
  bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The hash of the first `len` bytes of `file`: a download that resumes goes
/// on from there, and the digest at its end still covers the whole file.
fn hash_prefix(file: &Path, len: u64) -> io::Result<Sha256> {
  let mut hash = Sha256::new();
  let mut f = File::open(file)?.take(len);
  let mut buf = vec![0u8; 1024 * 1024];
  let mut read = 0u64;
  loop {
    match f.read(&mut buf) {
      Ok(0) => break,
      Ok(n) => {
        hash.update(&buf[..n]);
        read += n as u64;
      }
      Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
      Err(e) => return Err(e),
    }
  }
  if read != len {
    return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "the partial file got shorter"));
  }
  Ok(hash)
}

/// "bytes 100-199/1000" → (100, 1000).
fn content_range(value: &str) -> Option<(u64, u64)> {
  let rest = value.trim().strip_prefix("bytes ")?;
  let (range, total) = rest.split_once('/')?;
  let (start, _end) = range.split_once('-')?;
  Some((start.trim().parse().ok()?, total.trim().parse().ok()?))
}

/// A file only this user may read, where the system has such a thing.
fn create_private(path: &Path) -> io::Result<File> {
  let mut options = OpenOptions::new();
  options.write(true).create(true).truncate(true);
  #[cfg(unix)]
  std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
  options.open(path)
}

/// How much of a download is written to the disk at a time.
const WRITE_BLOCK: usize = 4 * 1024 * 1024;

/// Appends `buf` to `file` on a blocking thread (and syncs it to the disk if
/// `sync`), handing both back for the next block.
async fn write_off(mut file: File, mut buf: Vec<u8>, sync: bool) -> io::Result<(File, Vec<u8>)> {
  tokio::task::spawn_blocking(move || {
    file.write_all(&buf)?;
    if sync {
      file.sync_all()?;
    }
    buf.clear();
    Ok((file, buf))
  })
  .await
  .map_err(io::Error::other)?
}

/// Downloads `url` into `part`, going on from what is there already (HTTP
/// Range), hashing on the way. Answers once `part` holds exactly the pinned
/// bytes. A file of the wrong size or digest is deleted; a download broken
/// off keeps what arrived.
async fn fetch(
  client: &reqwest::Client,
  url: &str,
  part: &Path,
  expected: Option<u64>,
  sha256: &str,
  cancel: &Cancel,
  progress: &(dyn Fn(u64, u64) + Sync),
) -> Result<(), Fail> {
  let mut have = fs::metadata(part).map(|m| m.len()).unwrap_or(0);
  if expected.is_some_and(|size| have > size) {
    fs::remove_file(part)?;
    have = 0;
  }
  let mut hash = if have > 0 {
    let file = part.to_path_buf();
    tokio::task::spawn_blocking(move || hash_prefix(&file, have)).await.map_err(|e| Fail::Disk(io::Error::other(e)))??
  } else {
    Sha256::new()
  };
  let mut total = expected;
  // All there already (cancelled while it was checked, say): only the digest is left.
  let complete = have > 0 && expected == Some(have);
  if !complete {
    let mut request = client.get(url);
    if have > 0 {
      request = request.header(reqwest::header::RANGE, format!("bytes={have}-"));
    }
    let mut res = abortable(cancel, async { request.send().await.map_err(network) }).await?;
    let status = res.status().as_u16();
    let mut out = match status {
      206 if have > 0 => {
        let range = res.headers().get(reqwest::header::CONTENT_RANGE).and_then(|v| v.to_str().ok()).and_then(content_range);
        let Some((_, size)) = range.filter(|(start, _)| *start == have) else {
          // Not where this file ends: start over, next time.
          let _ = fs::remove_file(part);
          return Err(Fail::Network("a range the request did not ask for".into()));
        };
        total = Some(size);
        Some(OpenOptions::new().append(true).open(part)?)
      }
      200 => {
        // The server ignored the range (or there was nothing yet): from the start.
        have = 0;
        hash = Sha256::new();
        total = res.content_length().or(expected);
        Some(create_private(part)?)
      }
      // Nothing after what is there: the digest says whether it is all.
      416 if have > 0 => {
        total = Some(have);
        None
      }
      other => return Err(Fail::Http(other)),
    };
    if let (Some(want), Some(size)) = (expected, total)
      && want != size
    {
      drop(out);
      let _ = fs::remove_file(part);
      return Err(Fail::Size);
    }
    if let Some(mut file) = out.take() {
      // Written in blocks off the async workers: a slow disk never holds up the app's other tasks.
      let mut pending: Vec<u8> = Vec::with_capacity(WRITE_BLOCK);
      progress(have, total.unwrap_or(0));
      loop {
        let next = abortable(cancel, async {
          tokio::time::timeout(STALL, res.chunk()).await.map_err(|_| Fail::Network("stalled".into()))?.map_err(network)
        })
        .await;
        let next = match next {
          Ok(next) => next,
          Err(e) => {
            // What arrived stays on the disk for the next try.
            let _ = write_off(file, pending, false).await;
            return Err(e);
          }
        };
        let Some(chunk) = next else { break };
        have += chunk.len() as u64;
        if total.is_some_and(|t| have > t) {
          drop(file);
          let _ = fs::remove_file(part);
          return Err(Fail::Size);
        }
        hash.update(&chunk);
        pending.extend_from_slice(&chunk);
        if pending.len() >= WRITE_BLOCK {
          (file, pending) = write_off(file, pending, false).await?;
        }
        progress(have, total.unwrap_or(0));
      }
      write_off(file, pending, true).await?;
      if total.is_some_and(|t| have != t) {
        return Err(Fail::Network("the connection ended early".into()));
      }
    }
  }
  progress(have, total.unwrap_or(have));
  if hex(&hash.finalize()) != sha256 {
    let _ = fs::remove_file(part);
    return Err(Fail::Digest);
  }
  Ok(())
}

/// fetch(), tried again by itself (from where it stopped) when the connection
/// broke off or the server stumbled.
async fn fetch_retrying(
  client: &reqwest::Client,
  url: &str,
  part: &Path,
  expected: Option<u64>,
  sha256: &str,
  cancel: &Cancel,
  progress: &(dyn Fn(u64, u64) + Sync),
) -> Result<(), Fail> {
  let mut attempt = 0;
  loop {
    match fetch(client, url, part, expected, sha256, cancel, progress).await {
      Err(e) if e.retryable() && attempt < RETRIES => {
        attempt += 1;
        eprintln!("[gemma] download broken off ({e}), trying again");
        abortable(cancel, async {
          tokio::time::sleep(RETRY_PAUSE * attempt).await;
          Ok(())
        })
        .await?;
      }
      result => return result,
    }
  }
}

// ---- unpacking ---------------------------------------------------------------------

/// The first file named `name` under `dir`, the shallowest first: where the
/// archive keeps llama-server has changed between llama.cpp's releases (the
/// root, build/bin/, a folder named after the release), so it is looked for.
fn find_binary(dir: &Path, name: &str) -> Option<PathBuf> {
  let mut level = vec![dir.to_path_buf()];
  for _depth in 0..6 {
    let mut next = Vec::new();
    for folder in &level {
      let Ok(entries) = fs::read_dir(folder) else { continue };
      let mut entries: Vec<_> = entries.flatten().collect();
      entries.sort_by_key(|e| e.file_name());
      for entry in entries {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_file() && entry.file_name() == name {
          return Some(path);
        }
        if kind.is_dir() {
          next.push(path);
        }
      }
    }
    if next.is_empty() {
      break;
    }
    level = next;
  }
  None
}

/// Unpacks the runtime's archive (a .zip on Windows, a .tar.gz on Linux) into
/// `into`, finds llama-server in it, and marks the folder complete. Both
/// crates refuse entries that would land outside `into`.
fn unpack(archive: &Path, into: &Path) -> Result<PathBuf, Fail> {
  let unpack_err = |e: &dyn std::fmt::Display| Fail::Unpack(e.to_string());
  if into.exists() {
    fs::remove_dir_all(into)?;
  }
  fs::create_dir_all(into)?;
  let name = archive.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
  let file = File::open(archive)?;
  if name.ends_with(".zip") || name.ends_with(".zip.part") {
    let mut zip = zip::ZipArchive::new(file).map_err(|e| unpack_err(&e))?;
    zip.extract(into).map_err(|e| unpack_err(&e))?;
  } else {
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(file));
    tar.set_overwrite(true);
    tar.unpack(into).map_err(|e| unpack_err(&e))?;
  }
  let exe = find_binary(into, SERVER_EXE).ok_or_else(|| Fail::Unpack(format!("no {SERVER_EXE} in the archive")))?;
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&exe, fs::Permissions::from_mode(0o755))?;
  }
  fs::write(into.join(RUNTIME_COMPLETE), RELEASE)?;
  Ok(exe)
}

/// Deletes `path` (a folder or a file), trying again for a moment while
/// another program holds a file in it (a virus scanner, the server just ended).
fn remove_retrying(path: &Path) -> bool {
  for attempt in 0..8u64 {
    let gone = if path.is_dir() { fs::remove_dir_all(path) } else { fs::remove_file(path) };
    match gone {
      Ok(()) => return true,
      Err(e) if e.kind() == io::ErrorKind::NotFound => return true,
      Err(_) => std::thread::sleep(Duration::from_millis(100 * (attempt + 1))),
    }
  }
  !path.exists()
}

fn rename_retrying(from: &Path, to: &Path) -> io::Result<()> {
  let mut attempt = 0u64;
  loop {
    match fs::rename(from, to) {
      Ok(()) => return Ok(()),
      Err(e) if attempt < 8 && (e.kind() == io::ErrorKind::PermissionDenied || matches!(e.raw_os_error(), Some(32 | 33))) => {
        attempt += 1;
        std::thread::sleep(Duration::from_millis(150 * attempt));
      }
      Err(e) => return Err(e),
    }
  }
}

// ---- the server --------------------------------------------------------------------

/// What this runtime's llama-server understands, read from its --help once:
/// flags come and go between releases, and one it does not know ends it at
/// start.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct Flags {
  /// --no-webui: no chat page on the port.
  no_webui: bool,
  /// The key from the environment (LLAMA_API_KEY): on no command line other
  /// programs could read (on Linux every user can read another's).
  key_env: bool,
  /// --api-key-file, the next best.
  key_file: bool,
  /// --device: Vulkan0 for a GPU start (as the evaluation ran it), none for
  /// the CPU alone, the GPU's library not even touched.
  device: bool,
  /// -t and -tb: the CPU's threads, for the model and for the prompt.
  threads: bool,
  threads_batch: bool,
  /// --list-devices: whether there is a Vulkan0 to start on; None when the
  /// runtime could not tell (then the GPU is tried).
  vulkan0: Option<bool>,
}

impl Flags {
  fn from_help(help: &str) -> Flags {
    Flags {
      no_webui: help.contains("--no-webui"),
      key_env: help.contains("LLAMA_API_KEY"),
      key_file: help.contains("--api-key-file"),
      device: help.contains("--device"),
      threads: help.contains("--threads "),
      threads_batch: help.contains("--threads-batch"),
      vulkan0: None,
    }
  }

  /// Whether a GPU start is worth trying.
  fn gpu_worth_trying(&self) -> bool {
    self.vulkan0 != Some(false)
  }
}

/// The CPU threads for a CPU start: about the physical cores (half the
/// logical ones), 2 at least, CPU_THREADS_MAX at most.
fn cpu_threads(logical: usize) -> usize {
  (logical / 2).clamp(2, CPU_THREADS_MAX)
}

/// How the key reaches the server.
#[derive(Debug, PartialEq, Eq)]
enum KeyVia {
  Env,
  File(PathBuf),
  /// Only where neither is understood.
  Arg,
}

fn key_via(flags: &Flags, dir: &Path) -> KeyVia {
  if flags.key_env {
    KeyVia::Env
  } else if flags.key_file {
    KeyVia::File(dir.join(KEY_FILE))
  } else {
    KeyVia::Arg
  }
}

/// llama-server's command line. -np 1: one prompt at a time anyway, and the
/// whole context for it. A GPU start on Vulkan0, a CPU start on `threads`
/// threads. The key on it only as the last way (KeyVia::Arg).
fn server_args(model: &Path, port: u16, gpu: bool, threads: usize, flags: &Flags, key: &KeyVia, secret: &str) -> Vec<OsString> {
  let mut args: Vec<OsString> = vec!["-m".into(), model.into()];
  for arg in ["--host", "127.0.0.1", "--port"] {
    args.push(arg.into());
  }
  args.push(port.to_string().into());
  for arg in ["--jinja", "-c", CONTEXT, "-np", "1", "-ngl", if gpu { "99" } else { "0" }] {
    args.push(arg.into());
  }
  if flags.device {
    args.push("--device".into());
    args.push(if gpu { "Vulkan0" } else { "none" }.into());
  }
  if !gpu {
    if flags.threads {
      args.push("-t".into());
      args.push(threads.to_string().into());
    }
    if flags.threads_batch {
      args.push("-tb".into());
      args.push(threads.to_string().into());
    }
  }
  if flags.no_webui {
    args.push("--no-webui".into());
  }
  match key {
    KeyVia::Env => {}
    KeyVia::File(file) => {
      args.push("--api-key-file".into());
      args.push(file.into());
    }
    KeyVia::Arg => {
      args.push("--api-key".into());
      args.push(secret.into());
    }
  }
  args
}

/// A port nobody listens on now: the system's pick for 127.0.0.1:0, let go
/// at once for the server to take.
fn free_port() -> io::Result<u16> {
  let listener = std::net::TcpListener::bind(("127.0.0.1", 0))?;
  Ok(listener.local_addr()?.port())
}

/// 32 random bytes as hex, the server's key for one start.
fn random_key() -> Option<String> {
  let mut bytes = [0u8; 32];
  aws_lc_rs::rand::fill(&mut bytes).ok()?;
  Some(hex(&bytes))
}

/// Whether the model went onto the GPU, from the server's log
/// ("offloaded 36/36 layers to GPU"); None when the log does not say.
fn offloaded(log: &str) -> Option<bool> {
  let re = regex::Regex::new(r"offloaded (\d+)/(\d+) layers to GPU").ok()?;
  let caps = re.captures_iter(log).last()?;
  Some(caps[1].parse::<u32>().ok()? > 0)
}

/// The request, as the evaluation asked it (girovo-llm-eval scripts/run.mjs
/// chat()): the same answers for the same question, thinking off.
fn chat_body(system: &str, user: &str, max_tokens: u32, json_out: bool) -> Value {
  let mut body = json!({
    "messages": [{ "role": "system", "content": system }, { "role": "user", "content": user }],
    "temperature": 0,
    "top_k": 1,
    "seed": 0,
    "max_tokens": max_tokens,
    "cache_prompt": true,
    "chat_template_kwargs": { "enable_thinking": false },
  });
  if json_out {
    body["response_format"] = json!({ "type": "json_object" });
  }
  body
}

/// The answer's text, trimmed; None for none or an empty one.
fn answer_text(body: &Value) -> Option<String> {
  let text = body.get("choices")?.get(0)?.get("message")?.get("content")?.as_str()?.trim();
  (!text.is_empty()).then(|| text.to_string())
}

/// The server's own count of an answer's speed: tokens per second, and how
/// many tokens (timings.predicted_per_second, timings.predicted_n).
fn speed(body: &Value) -> Option<(f64, u64)> {
  let timings = body.get("timings")?;
  Some((timings.get("predicted_per_second")?.as_f64()?, timings.get("predicted_n")?.as_u64()?))
}

/// Slower than GPU_SLOW, over an answer long enough to tell.
fn too_slow(speed: Option<(f64, u64)>) -> bool {
  matches!(speed, Some((per_second, tokens)) if tokens >= SLOW_MIN_TOKENS && per_second < GPU_SLOW)
}

/// No console window for the server or its --help (Windows).
fn hide_window(command: &mut Command) {
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
  }
  #[cfg(not(windows))]
  let _ = command;
}

/// The runtime's environment: its own libraries found beside it (Linux), and
/// none of the user's LLAMA_* variables, which llama.cpp reads as flags.
fn runtime_env(command: &mut Command, exe: &Path) {
  for (name, _) in std::env::vars_os() {
    if name.to_string_lossy().starts_with("LLAMA_") {
      command.env_remove(name);
    }
  }
  if let Some(dir) = exe.parent() {
    command.current_dir(dir);
    #[cfg(unix)]
    {
      let mut paths = vec![dir.to_path_buf()];
      if let Some(old) = std::env::var_os("LD_LIBRARY_PATH") {
        paths.extend(std::env::split_paths(&old));
      }
      if let Ok(joined) = std::env::join_paths(paths) {
        command.env("LD_LIBRARY_PATH", joined);
      }
    }
  }
}

/// Reads what this runtime understands from `llama-server --help`, written
/// to a file (no pipes to drain), 20 s at most.
fn probe_flags(exe: &Path, dir: &Path) -> Flags {
  let help = run_for_output(exe, dir, "--help");
  let mut flags = Flags::from_help(&help);
  if help.contains("--list-devices") {
    let devices = run_for_output(exe, dir, "--list-devices");
    flags.vulkan0 = listed_vulkan0(&devices);
  }
  flags
}

/// Whether `llama-server --list-devices` names a Vulkan0 ("Vulkan0: NVIDIA
/// GeForce RTX 4080 SUPER (16376 MiB, 14839 MiB free)"); None when it said
/// nothing readable.
fn listed_vulkan0(devices: &str) -> Option<bool> {
  if devices.contains("Vulkan0") {
    Some(true)
  } else if devices.contains("Available devices") {
    Some(false)
  } else {
    None
  }
}

/// What `exe arg` writes, both streams, written to a file (no pipes to
/// drain), 20 s at most.
fn run_for_output(exe: &Path, dir: &Path, arg: &str) -> String {
  let out = dir.join("llama-server-probe.txt");
  let Ok(file) = File::create(&out) else { return String::new() };
  let Ok(err) = file.try_clone() else { return String::new() };
  let mut command = Command::new(exe);
  command.arg(arg).stdin(Stdio::null()).stdout(file).stderr(err);
  hide_window(&mut command);
  runtime_env(&mut command, exe);
  let Ok(mut child) = command.spawn() else {
    let _ = fs::remove_file(&out);
    return String::new();
  };
  let until = Instant::now() + Duration::from_secs(20);
  while child.try_wait().ok().flatten().is_none() && Instant::now() < until {
    std::thread::sleep(Duration::from_millis(50));
  }
  let _ = child.kill();
  let _ = child.wait();
  let text = fs::read(&out).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
  let _ = fs::remove_file(&out);
  text
}

/// Windows: the server goes into a job that ends it with this process — also
/// when Girovo is ended from the Task Manager or crashes, which no exit hook
/// hears, and a 3 GB server left behind would be nobody's.
#[cfg(windows)]
fn tie_to_app(child: &Child) {
  use std::os::windows::io::AsRawHandle;
  use std::sync::OnceLock;
  use windows::Win32::Foundation::HANDLE;
  use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JobObjectExtendedLimitInformation, SetInformationJobObject,
  };
  // The handle stays open as long as the process lives: its end closes it.
  static JOB: OnceLock<Option<usize>> = OnceLock::new();
  let job = JOB.get_or_init(|| unsafe {
    let job = CreateJobObjectW(None, windows::core::PCWSTR::null()).ok()?;
    let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    SetInformationJobObject(
      job,
      JobObjectExtendedLimitInformation,
      &info as *const _ as *const std::ffi::c_void,
      std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
    )
    .ok()?;
    Some(job.0 as usize)
  });
  if let Some(job) = *job {
    unsafe {
      let _ = AssignProcessToJobObject(HANDLE(job as *mut std::ffi::c_void), HANDLE(child.as_raw_handle()));
    }
  }
}

#[cfg(not(windows))]
fn tie_to_app(_child: &Child) {}

/// Starts the server. On Linux it gets the kernel's death signal: SIGKILL
/// the moment Girovo ends, a crash included, which no exit hook hears (the
/// job object does this on Windows, tie_to_app). The signal follows the
/// thread that forked, not the process, so the fork happens on one thread
/// that lives as long as the app: a blocking pool's thread that ends after
/// a while would take the server with it.
#[cfg(target_os = "linux")]
fn spawn_server(mut command: Command) -> io::Result<Child> {
  use std::os::unix::process::CommandExt;
  use std::sync::OnceLock;
  use std::sync::mpsc;

  let parent = std::process::id() as libc::pid_t;
  // SAFETY: between fork and exec only async-signal-safe calls (prctl, getppid).
  unsafe {
    command.pre_exec(move || {
      if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL as libc::c_ulong, 0 as libc::c_ulong, 0 as libc::c_ulong, 0 as libc::c_ulong) != 0 {
        return Err(io::Error::last_os_error());
      }
      // Girovo ended between the fork and the prctl: the signal will never come.
      if libc::getppid() != parent {
        return Err(io::Error::other("Girovo has ended"));
      }
      Ok(())
    });
  }
  type Job = (Command, mpsc::Sender<io::Result<Child>>);
  static SPAWNER: OnceLock<Option<Mutex<mpsc::Sender<Job>>>> = OnceLock::new();
  let spawner = SPAWNER.get_or_init(|| {
    let (tx, rx) = mpsc::channel::<Job>();
    let thread = std::thread::Builder::new().name("gemma-spawner".into()).spawn(move || {
      for (mut command, reply) in rx {
        let _ = reply.send(command.spawn());
      }
    });
    thread.ok().map(|_| Mutex::new(tx))
  });
  let Some(spawner) = spawner else { return Err(io::Error::other("no thread to start the server from")) };
  let (reply, answer) = mpsc::channel();
  spawner.lock().unwrap().send((command, reply)).map_err(|_| io::Error::other("the spawner thread is gone"))?;
  answer.recv().map_err(|_| io::Error::other("the spawner thread is gone"))?
}

#[cfg(not(target_os = "linux"))]
fn spawn_server(mut command: Command) -> io::Result<Child> {
  command.spawn()
}

/// Whether the server on `port` is ours: it refuses a request without the
/// key (401), and with the key it names our model. A program that took the
/// port before our server could would fail one of them.
async fn answers_as_ours(client: &reqwest::Client, port: u16, key: &str) -> bool {
  let base = format!("http://127.0.0.1:{port}");
  let limit = Duration::from_secs(5);
  let bare = client.post(format!("{base}/v1/chat/completions")).json(&json!({})).timeout(limit).send().await;
  if !bare.is_ok_and(|r| r.status() == reqwest::StatusCode::UNAUTHORIZED) {
    return false;
  }
  match client.get(format!("{base}/v1/models")).bearer_auth(key).timeout(limit).send().await {
    Ok(res) if res.status().is_success() => res.text().await.is_ok_and(|text| text.contains(MODEL_FILE)),
    _ => false,
  }
}

/// state.error while unavailable. Short and plain (lib/i18n/README.md Voice).
fn unavailable_text(lang: Lang) -> String {
  match lang {
    Lang::De => "Das Modell ließ sich auf diesem Computer nicht starten.",
    Lang::En => "The model could not be started on this computer.",
  }
  .to_string()
}

/// Ends `child` and waits for its end on a blocking thread.
async fn end_child(mut child: Child) {
  let _ = child.kill();
  let _ = tokio::task::spawn_blocking(move || child.wait()).await;
}

/// The server while it runs.
struct Server {
  child: Child,
  port: u16,
  key: String,
  /// /health has answered.
  healthy: bool,
  /// Started with the model on the GPU.
  gpu: bool,
  /// Prompts it has answered: the first one's speed is not judged (warm-up).
  answers: u32,
}

impl Server {
  fn alive(&mut self) -> bool {
    matches!(self.child.try_wait(), Ok(None))
  }
}

// ---- the runtime -------------------------------------------------------------------

type Publish = Box<dyn Fn(&GemmaState) + Send + Sync>;
type LangOf = Box<dyn Fn() -> Lang + Send + Sync>;

pub struct Core {
  dir: PathBuf,
  runtime: Option<&'static Pinned>,
  /// Downloads: https only, redirects followed (Hugging Face's CDN).
  client: reqwest::Client,
  /// The server on 127.0.0.1: never through a proxy, which would see the key.
  local: reqwest::Client,
  state: Mutex<GemmaState>,
  publish: Publish,
  lang: LangOf,
  last_progress: Mutex<Option<Instant>>,
  /// The download under way's switch.
  cancel: Mutex<Option<Cancel>>,
  /// Held by the download under way: remove() waits for it before deleting.
  downloading: tokio::sync::Mutex<()>,
  /// One prompt (with the server's start) at a time.
  prompting: tokio::sync::Mutex<()>,
  /// Here from the spawn on, so a stop ends a start under way too.
  server: Mutex<Option<Server>>,
  /// Raised by every stop: a start under way gives up instead of trying again.
  epoch: AtomicU64,
  /// Counts prompts: the idle stop belongs to the last one.
  used: AtomicU64,
  flags: Mutex<Option<Flags>>,
  /// Failed prompts in a row (FAILURES_IN_A_ROW).
  failures: AtomicU32,
  /// PROMPT_LIMIT in milliseconds; the tests' fake servers shorten it.
  prompt_limit_ms: AtomicU64,
  /// The GPU failed, hung or was too slow in this run: the next starts are on
  /// the CPU. Never on the disk: the next app start tries the GPU again.
  cpu_only: AtomicBool,
  /// remove()s under way: no download starts meanwhile, so none can be
  /// declared absent by a remove that was waiting for its locks.
  removing: AtomicU32,
  me: Weak<Core>,
}

impl Core {
  fn new(dir: PathBuf, runtime: Option<&'static Pinned>, publish: Publish, lang: LangOf) -> Arc<Core> {
    let client = reqwest::Client::builder()
      .https_only(true)
      .connect_timeout(Duration::from_secs(30))
      // The User-Agent names the app and its version and nothing else about this machine.
      .user_agent(format!("Girovo/{}", env!("GIROVO_VERSION")))
      .build()
      .expect("a client without custom TLS cannot fail to build");
    let local = reqwest::Client::builder().no_proxy().connect_timeout(Duration::from_secs(5)).build().expect("a plain client builds");
    Arc::new_cyclic(|me| {
      let core = Core {
        dir,
        runtime,
        client,
        local,
        state: Mutex::new(GemmaState {
          state: Kind::Absent,
          phase: None,
          received: 0,
          total: 0,
          error: None,
          gpu: None,
          warm: false,
          starting: false,
          supported: runtime.is_some(),
          partial: 0,
          unavailable: false,
        }),
        publish,
        lang,
        last_progress: Mutex::new(None),
        cancel: Mutex::new(None),
        downloading: tokio::sync::Mutex::new(()),
        prompting: tokio::sync::Mutex::new(()),
        server: Mutex::new(None),
        epoch: AtomicU64::new(0),
        used: AtomicU64::new(0),
        flags: Mutex::new(None),
        failures: AtomicU32::new(0),
        prompt_limit_ms: AtomicU64::new(PROMPT_LIMIT.as_millis() as u64),
        cpu_only: AtomicBool::new(false),
        removing: AtomicU32::new(0),
        me: me.clone(),
      };
      {
        let mut s = core.state.lock().unwrap();
        s.state = core.on_disk();
        // A GPU start that failed once is no reason to stay off the GPU for good.
        let _ = fs::remove_file(core.dir.join(OLD_CPU_ONLY));
        s.partial = core.partial_bytes();
      }
      core
    })
  }

  fn arc(&self) -> Arc<Core> {
    self.me.upgrade().expect("the runtime is alive while it runs")
  }

  fn runtime_dir(&self) -> PathBuf {
    self.dir.join(RUNTIME_DIR)
  }

  fn model_file(&self) -> PathBuf {
    self.dir.join(MODEL_FILE)
  }

  /// llama-server, if the runtime is unpacked completely.
  fn server_exe(&self) -> Option<PathBuf> {
    let dir = self.runtime_dir();
    if !dir.join(RUNTIME_COMPLETE).is_file() {
      return None;
    }
    find_binary(&dir, SERVER_EXE)
  }

  /// Ready when both are there. The model's file has its final name only
  /// once its digest matched, so its presence is enough: 3.4 GB are not
  /// hashed again at every start.
  fn on_disk(&self) -> Kind {
    if self.runtime.is_some() && self.server_exe().is_some() && self.model_file().is_file() { Kind::Ready } else { Kind::Absent }
  }

  pub fn state(&self) -> GemmaState {
    self.state.lock().unwrap().clone()
  }

  fn set(&self, patch: impl FnOnce(&mut GemmaState)) -> GemmaState {
    let state = {
      let mut s = self.state.lock().unwrap();
      patch(&mut s);
      s.clone()
    };
    (self.publish)(&state);
    state
  }

  /// Progress: always kept, sent at most every PROGRESS_EVERY.
  fn progress(&self, received: u64, total: u64) {
    let state = {
      let mut s = self.state.lock().unwrap();
      s.received = received;
      s.total = total;
      s.clone()
    };
    let mut last = self.last_progress.lock().unwrap();
    if last.is_none_or(|t| t.elapsed() >= PROGRESS_EVERY) {
      *last = Some(Instant::now());
      drop(last);
      (self.publish)(&state);
    }
  }

  // ---- download ----

  /// Starts the download, unless there is nothing to download or one is under
  /// way; answers at once with the state.
  pub fn begin_download(&self) -> GemmaState {
    let cancel = {
      let mut s = self.state.lock().unwrap();
      // A remove() under way finishes first (its waits would otherwise end in
      // "absent" over this download).
      if matches!(s.state, Kind::Ready | Kind::Downloading) || self.removing.load(Ordering::SeqCst) > 0 {
        return s.clone();
      }
      if self.runtime.is_none() {
        s.state = Kind::Error;
        s.phase = None;
        s.error = Some(Fail::Unsupported.text((self.lang)()));
        let state = s.clone();
        drop(s);
        (self.publish)(&state);
        return state;
      }
      let runtime_first = self.server_exe().is_none();
      s.state = Kind::Downloading;
      s.phase = Some(if runtime_first { Phase::Runtime } else { Phase::Model });
      s.received = 0;
      s.total = if runtime_first { self.runtime.map_or(0, |p| p.size) } else { MODEL_SIZE_APPROX };
      s.error = None;
      s.partial = 0;
      let cancel = Cancel::new();
      *self.cancel.lock().unwrap() = Some(cancel.clone());
      cancel
    };
    let state = self.state();
    (self.publish)(&state);
    let me = self.arc();
    tauri::async_runtime::spawn(async move { me.run_download(cancel).await });
    state
  }

  async fn run_download(self: Arc<Self>, cancel: Cancel) {
    let _one = self.downloading.lock().await;
    let result = self.download_all(&cancel).await;
    // Only the download that is still the current one says how it ended: a
    // newer one (cancel, then download again) or remove() says it instead.
    let current = {
      let mut slot = self.cancel.lock().unwrap();
      let same = slot.as_ref().is_some_and(|c| c.same(&cancel));
      if same {
        *slot = None;
      }
      same
    };
    if !current {
      return;
    }
    let partial = self.partial_bytes();
    match result {
      Ok(()) => {
        self.set(|s| {
          s.state = Kind::Ready;
          s.phase = None;
          s.error = None;
          s.partial = partial;
          s.unavailable = false;
        });
      }
      Err(Fail::Cancelled) => {
        self.set(|s| {
          s.state = Kind::Absent;
          s.phase = None;
          s.received = 0;
          s.total = 0;
          s.partial = partial;
        });
      }
      Err(e) => {
        eprintln!("[gemma] download failed: {e}");
        let text = e.text((self.lang)());
        self.set(|s| {
          s.state = Kind::Error;
          s.phase = None;
          s.error = Some(text);
          s.partial = partial;
        });
      }
    }
  }

  async fn download_all(&self, cancel: &Cancel) -> Result<(), Fail> {
    let pinned = self.runtime.ok_or(Fail::Unsupported)?;
    fs::create_dir_all(&self.dir)?;
    let progress = |received, total| self.progress(received, total);
    if self.server_exe().is_none() {
      self.enter(Phase::Runtime, pinned.size);
      let part = self.dir.join(format!("{}.part", pinned.name));
      let url = format!("{RUNTIME_BASE}{}", pinned.name);
      fetch_retrying(&self.client, &url, &part, Some(pinned.size), pinned.sha256, cancel, &progress).await?;
      let (archive, into) = (part.clone(), self.runtime_dir());
      tokio::task::spawn_blocking(move || unpack(&archive, &into)).await.map_err(|e| Fail::Unpack(e.to_string()))??;
      let _ = fs::remove_file(&part);
      *self.flags.lock().unwrap() = None;
    }
    if !self.model_file().is_file() {
      self.enter(Phase::Model, MODEL_SIZE_APPROX);
      let part = self.dir.join(format!("{MODEL_FILE}.part"));
      fetch_retrying(&self.client, MODEL_URL, &part, None, MODEL_SHA256, cancel, &progress).await?;
      let (from, to) = (part, self.model_file());
      tokio::task::spawn_blocking(move || rename_retrying(&from, &to)).await.map_err(|e| Fail::Disk(io::Error::other(e)))??;
    }
    Ok(())
  }

  fn enter(&self, phase: Phase, total: u64) {
    *self.last_progress.lock().unwrap() = None;
    self.set(|s| {
      s.phase = Some(phase);
      s.received = 0;
      s.total = total;
    });
  }

  /// Stops the download; what arrived stays for the next one.
  pub fn cancel(&self) -> GemmaState {
    if let Some(cancel) = self.cancel.lock().unwrap().as_ref() {
      cancel.cancel();
    }
    self.state()
  }

  // ---- stopping and removing ----

  /// Bytes of the downloads that stopped on their way (*.part).
  fn partial_bytes(&self) -> u64 {
    let Ok(entries) = fs::read_dir(&self.dir) else { return 0 };
    entries
      .flatten()
      .filter(|e| e.file_name().to_string_lossy().ends_with(".part"))
      .filter_map(|e| e.metadata().ok())
      .filter(|m| m.is_file())
      .map(|m| m.len())
      .sum()
  }

  /// Ends the server, and a start under way, waiting for its end right here:
  /// for the app's end, where nothing async runs any more.
  fn kill_server(&self, publish: bool) {
    let server = self.server.lock().unwrap().take();
    if let Some(mut server) = server {
      let _ = server.child.kill();
      let _ = server.child.wait();
    }
    self.killed(publish);
  }

  /// kill_server(), its end waited for on a blocking thread.
  async fn kill_server_async(&self, publish: bool) {
    let server = self.server.lock().unwrap().take();
    if let Some(server) = server {
      end_child(server.child).await;
    }
    self.killed(publish);
  }

  fn killed(&self, publish: bool) {
    if publish {
      let changed = {
        let s = self.state.lock().unwrap();
        s.warm || s.starting
      };
      if changed {
        self.set(|s| {
          s.warm = false;
          s.starting = false;
        });
      }
    } else {
      let mut s = self.state.lock().unwrap();
      s.warm = false;
      s.starting = false;
    }
  }

  /// Everything stops at once, nothing waited for: the app's end.
  pub fn stop(&self) {
    self.epoch.fetch_add(1, Ordering::SeqCst);
    if let Some(cancel) = self.cancel.lock().unwrap().take() {
      cancel.cancel();
    }
    self.kill_server(false);
  }

  /// Stops the server and the download, then deletes everything. Works in
  /// every state: a partial download after a cancel or a failure goes too.
  pub async fn remove(&self) -> GemmaState {
    {
      // Under the state's lock, as begin_download checks it.
      let _state = self.state.lock().unwrap();
      self.removing.fetch_add(1, Ordering::SeqCst);
    }
    self.epoch.fetch_add(1, Ordering::SeqCst);
    if let Some(cancel) = self.cancel.lock().unwrap().take() {
      cancel.cancel();
    }
    self.kill_server_async(false).await;
    // The download's file and a start's are closed before they are deleted.
    let _download = self.downloading.lock().await;
    let _prompt = self.prompting.lock().await;
    self.kill_server_async(false).await;
    *self.flags.lock().unwrap() = None;
    self.failures.store(0, Ordering::SeqCst);
    self.cpu_only.store(false, Ordering::SeqCst);
    let dir = self.dir.clone();
    let gone = tokio::task::spawn_blocking(move || remove_retrying(&dir)).await.unwrap_or(false);
    if !gone {
      eprintln!("[gemma] could not delete everything in its folder");
    }
    let (kind, partial) = (self.on_disk(), self.partial_bytes());
    self.set(|s| {
      s.state = kind;
      s.phase = None;
      s.received = 0;
      s.total = 0;
      s.error = None;
      s.gpu = None;
      s.warm = false;
      s.starting = false;
      s.partial = partial;
      s.unavailable = false;
      // Still under the state's lock: a download asked for from here on starts.
      self.removing.fetch_sub(1, Ordering::SeqCst);
    })
  }

  // ---- the server ----

  /// The server's port and key, started if it is not up. None at once when
  /// neither start worked earlier in this run (state.unavailable).
  async fn ensure_server(&self) -> Option<(u16, String)> {
    {
      let mut server = self.server.lock().unwrap();
      if let Some(s) = server.as_mut()
        && s.healthy
        && s.alive()
      {
        return Some((s.port, s.key.clone()));
      }
    }
    if self.state().unavailable {
      return None;
    }
    // Whatever is left of an earlier one goes first.
    self.kill_server_async(false).await;
    let epoch = self.epoch.load(Ordering::SeqCst);
    let (Some(exe), model) = (self.server_exe(), self.model_file()) else {
      eprintln!("[gemma] no llama-server to start");
      return None;
    };
    if !model.is_file() {
      return None;
    }
    let flags = self.flags_of(&exe).await;
    self.set(|s| s.starting = true);
    let cpu_only = self.cpu_only.load(Ordering::SeqCst) || !flags.gpu_worth_trying();
    let tries: &[bool] = if cpu_only { &[false] } else { &[true, false] };
    let threads = cpu_threads(std::thread::available_parallelism().map_or(4, |n| n.get()));
    for &gpu in tries {
      if self.epoch.load(Ordering::SeqCst) != epoch {
        break;
      }
      match self.start_once(&exe, &model, gpu, threads, &flags, epoch).await {
        Ok((port, key, on_gpu)) => {
          if !gpu {
            // The GPU failed (or was not tried): the rest of this run stays on the CPU.
            self.cpu_only.store(true, Ordering::SeqCst);
          }
          self.set(|s| {
            s.starting = false;
            s.warm = true;
            s.gpu = Some(on_gpu);
          });
          return Some((port, key));
        }
        Err(e) => eprintln!("[gemma] the server did not start ({}): {e}", if gpu { "GPU" } else { "CPU" }),
      }
    }
    if self.epoch.load(Ordering::SeqCst) != epoch {
      // Stopped (remove, the app's end), not failed.
      self.set(|s| s.starting = false);
      return None;
    }
    // Neither way worked: every later prompt would wait the same 90 s (or
    // twice that) for nothing. Not again in this run; remove() or the app's
    // next start try afresh.
    eprintln!("[gemma] no start worked; unavailable until the app starts again");
    let text = unavailable_text((self.lang)());
    self.set(|s| {
      s.starting = false;
      s.unavailable = true;
      s.error = Some(text);
    });
    None
  }

  async fn flags_of(&self, exe: &Path) -> Flags {
    if let Some(flags) = self.flags.lock().unwrap().clone() {
      return flags;
    }
    let (exe, dir) = (exe.to_path_buf(), self.dir.clone());
    let flags = tokio::task::spawn_blocking(move || probe_flags(&exe, &dir)).await.unwrap_or_default();
    *self.flags.lock().unwrap() = Some(flags.clone());
    flags
  }

  /// One start: spawned, then /health asked until it answers, the process
  /// ends, or START_LIMIT has passed; then checked to be our own server.
  /// Answers the port, the key and whether the model went onto the GPU.
  async fn start_once(&self, exe: &Path, model: &Path, gpu: bool, threads: usize, flags: &Flags, epoch: u64) -> Result<(u16, String, bool), String> {
    let port = free_port().map_err(|e| format!("no free port: {e}"))?;
    let key = random_key().ok_or("no random bytes")?;
    let via = key_via(flags, &self.dir);
    let log_path = self.dir.join(SERVER_LOG);
    let mut command = Command::new(exe);
    command.args(server_args(model, port, gpu, threads, flags, &via, &key)).stdin(Stdio::null());
    hide_window(&mut command);
    runtime_env(&mut command, exe);
    if via == KeyVia::Env {
      command.env("LLAMA_API_KEY", &key);
    }
    // The files and the spawn on a blocking thread, off the async workers.
    let (log, secret, key_file) = (log_path.clone(), key.clone(), self.dir.join(KEY_FILE));
    let spawned = tokio::task::spawn_blocking(move || -> Result<Child, String> {
      if let KeyVia::File(file) = &via {
        create_private(file).and_then(|mut f| f.write_all(secret.as_bytes())).map_err(|e| format!("key file: {e}"))?;
      }
      let out = File::create(&log).map_err(|e| format!("log: {e}"))?;
      let err = out.try_clone().map_err(|e| format!("log: {e}"))?;
      command.stdout(out).stderr(err);
      match spawn_server(command) {
        Ok(child) => {
          tie_to_app(&child);
          Ok(child)
        }
        Err(e) => {
          let _ = fs::remove_file(&key_file);
          Err(format!("spawn: {e}"))
        }
      }
    })
    .await
    .map_err(|e| format!("spawn: {e}"))?;
    let child = spawned?;
    *self.server.lock().unwrap() = Some(Server { child, port, key: key.clone(), healthy: false, gpu, answers: 0 });
    let health = format!("http://127.0.0.1:{port}/health");
    let until = Instant::now() + START_LIMIT;
    let mine_alive = || -> Result<(), String> {
      let mut server = self.server.lock().unwrap();
      match server.as_mut() {
        Some(s) if s.port == port => match s.child.try_wait() {
          Ok(Some(status)) => Err(format!("ended ({status}), see {SERVER_LOG}")),
          Ok(None) => Ok(()),
          Err(e) => Err(e.to_string()),
        },
        _ => Err("stopped".to_string()),
      }
    };
    let mut result = loop {
      if self.epoch.load(Ordering::SeqCst) != epoch {
        break Err("stopped".to_string());
      }
      if let Err(why) = mine_alive() {
        break Err(why);
      }
      let asked = self.local.get(&health).bearer_auth(&key).timeout(Duration::from_secs(2)).send().await;
      if asked.is_ok_and(|r| r.status().is_success()) {
        break Ok(());
      }
      if Instant::now() >= until {
        break Err(format!("no answer from /health within {} s", START_LIMIT.as_secs()));
      }
      tokio::time::sleep(Duration::from_millis(250)).await;
    };
    // Whoever answered must be ours: the port was free a moment before the
    // spawn, and another program may have taken it in between (then our
    // server could not listen and ends). Ours is still running, refuses a
    // request without the key, and names our model to one with it.
    if result.is_ok() {
      result = match mine_alive() {
        Err(why) => Err(format!("{why} (after /health answered)")),
        Ok(()) if !answers_as_ours(&self.local, port, &key).await => Err("the port answered as another program".to_string()),
        Ok(()) => mine_alive(),
      };
    }
    // Read at its start: the key is not needed on the disk any longer.
    let _ = fs::remove_file(self.dir.join(KEY_FILE));
    match result {
      Ok(()) => {
        let log = tokio::task::spawn_blocking(move || fs::read(&log_path).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default())
          .await
          .unwrap_or_default();
        let on_gpu = offloaded(&log).unwrap_or(gpu);
        let mut server = self.server.lock().unwrap();
        match server.as_mut() {
          Some(s) if s.port == port => {
            s.healthy = true;
            s.gpu = on_gpu;
            Ok((port, key, on_gpu))
          }
          _ => Err("stopped".to_string()),
        }
      }
      Err(e) => {
        // Only this start's server: a stop may have taken it already.
        let mine = {
          let mut server = self.server.lock().unwrap();
          if server.as_ref().is_some_and(|s| s.port == port) { server.take() } else { None }
        };
        if let Some(s) = mine {
          end_child(s.child).await;
        }
        Err(e)
      }
    }
  }

  /// One question, one answer: the model's text, or None on anything that
  /// went wrong (logged, without the texts).
  pub async fn prompt(&self, system: &str, user: &str, max_tokens: u32, json_out: bool) -> Option<String> {
    if system.len() > PROMPT_TEXT_MAX || user.len() > PROMPT_TEXT_MAX {
      eprintln!("[gemma] prompt refused: too long");
      return None;
    }
    let _one = self.prompting.lock().await;
    let state = self.state();
    if state.state != Kind::Ready || state.unavailable {
      return None;
    }
    let (port, key) = self.ensure_server().await?;
    let ticket = self.used.fetch_add(1, Ordering::SeqCst) + 1;
    let body = chat_body(system, user, max_tokens.clamp(1, MAX_TOKENS_MAX), json_out);
    let url = format!("http://127.0.0.1:{port}/v1/chat/completions");
    let sent = self.local.post(&url).bearer_auth(&key).json(&body).timeout(Duration::from_millis(self.prompt_limit_ms.load(Ordering::SeqCst))).send().await;
    // Some(text): the server answered (the text may still be None, an empty answer).
    let (answered, timed_out) = match sent {
      Ok(res) if res.status().is_success() => match res.json::<Value>().await {
        Ok(body) => {
          self.judge_speed(port, speed(&body)).await;
          (Some(answer_text(&body)), false)
        }
        Err(e) => {
          let timed_out = e.is_timeout();
          eprintln!("[gemma] unreadable answer: {}", e.without_url());
          (None, timed_out)
        }
      },
      Ok(res) => {
        eprintln!("[gemma] the server answered HTTP {}", res.status().as_u16());
        (None, false)
      }
      Err(e) => {
        let timed_out = e.is_timeout();
        eprintln!("[gemma] no answer: {}", e.without_url());
        (None, timed_out)
      }
    };
    match answered {
      Some(_) => self.failures.store(0, Ordering::SeqCst),
      None => self.after_failure(timed_out).await,
    }
    self.schedule_idle_stop(ticket);
    answered.flatten()
  }

  /// After a failed prompt: a server that died, hung (no answer within
  /// PROMPT_LIMIT) or failed FAILURES_IN_A_ROW times is ended, for the next
  /// prompt to start a new one. One that died or hung on the GPU leaves the
  /// next start to the CPU.
  async fn after_failure(&self, timed_out: bool) {
    let (alive, on_gpu) = {
      let mut server = self.server.lock().unwrap();
      match server.as_mut() {
        Some(s) => (s.alive(), s.gpu),
        None => return,
      }
    };
    let failures = self.failures.fetch_add(1, Ordering::SeqCst) + 1;
    if alive && !timed_out && failures < FAILURES_IN_A_ROW {
      return;
    }
    let why = if !alive {
      "it ended during a prompt"
    } else if timed_out {
      "it did not answer in time"
    } else {
      "prompts failed in a row"
    };
    eprintln!("[gemma] server ended: {why}");
    self.failures.store(0, Ordering::SeqCst);
    self.kill_server_async(true).await;
    if on_gpu && (!alive || timed_out) {
      self.cpu_only.store(true, Ordering::SeqCst);
      self.set(|s| s.gpu = Some(false));
    }
  }

  /// A GPU server that answers slower than GPU_SLOW, from its second answer
  /// on, is ended: the next prompt starts on the CPU, for the rest of this run.
  async fn judge_speed(&self, port: u16, speed: Option<(f64, u64)>) {
    let slow = {
      let mut server = self.server.lock().unwrap();
      let Some(s) = server.as_mut().filter(|s| s.port == port) else { return };
      s.answers += 1;
      s.gpu && s.answers > 1 && too_slow(speed)
    };
    if !slow {
      return;
    }
    if let Some((per_second, _)) = speed {
      eprintln!("[gemma] the GPU answers at {per_second:.1} tokens/s; the CPU takes over for this run");
    }
    self.cpu_only.store(true, Ordering::SeqCst);
    self.kill_server_async(true).await;
    self.set(|s| s.gpu = Some(false));
  }

  /// After IDLE without another prompt, the server stops.
  fn schedule_idle_stop(&self, ticket: u64) {
    let me = self.me.clone();
    tauri::async_runtime::spawn(async move {
      tokio::time::sleep(IDLE).await;
      let Some(me) = me.upgrade() else { return };
      if me.used.load(Ordering::SeqCst) != ticket {
        return;
      }
      // A prompt under way stops it later, after itself.
      let Ok(_idle) = me.prompting.try_lock() else { return };
      if me.used.load(Ordering::SeqCst) == ticket {
        me.kill_server_async(true).await;
      }
    });
  }
}

// ---- the Tauri side ----------------------------------------------------------------

/// The runtime of this app (managed in lib.rs's setup).
pub struct Gemma(Arc<Core>);

impl Gemma {
  pub fn new(app: &AppHandle) -> Gemma {
    let emitter = app.clone();
    let asker = app.clone();
    Gemma(Core::new(
      dir(app),
      runtime_for(std::env::consts::OS, std::env::consts::ARCH),
      Box::new(move |state| {
        let _ = emitter.emit(STATE_EVENT, state);
      }),
      Box::new(move || crate::texts::lang(&asker.state::<crate::prefs::Prefs>())),
    ))
  }
}

/// The folder (see the top of this file).
fn dir(app: &AppHandle) -> PathBuf {
  if std::env::var_os("GIROVO_DATA_DIR").is_some_and(|d| !d.is_empty()) {
    return crate::paths::data_root().join("gemma");
  }
  app.path().app_local_data_dir().map(|d| d.join("gemma")).unwrap_or_else(|_| crate::paths::data_root().join("gemma"))
}

/// The app ends: the server with it, the download stopped (lib.rs, RunEvent::Exit).
pub fn on_exit(app: &AppHandle) {
  if let Some(gemma) = app.try_state::<Gemma>() {
    gemma.0.stop();
  }
}

/// "Girovo zurücksetzen": everything of it goes too (reset.rs).
pub async fn forget(app: &AppHandle) {
  let Some(core) = app.try_state::<Gemma>().map(|g| g.0.clone()) else { return };
  core.remove().await;
}

type Runtime<'a> = tauri::State<'a, Gemma>;

#[tauri::command]
pub fn gemma_state(g: Runtime<'_>) -> GemmaState {
  g.0.state()
}

/// Answers at once; the download reports through the pushed state.
#[tauri::command]
pub fn gemma_download(g: Runtime<'_>) -> GemmaState {
  g.0.begin_download()
}

#[tauri::command]
pub fn gemma_cancel(g: Runtime<'_>) -> GemmaState {
  g.0.cancel()
}

#[tauri::command]
pub async fn gemma_remove(g: Runtime<'_>) -> Result<GemmaState, String> {
  let core = g.0.clone();
  Ok(core.remove().await)
}

#[tauri::command]
pub async fn gemma_prompt(g: Runtime<'_>, system: String, user: String, max_tokens: u32, json: Option<bool>) -> Result<Option<String>, String> {
  let core = g.0.clone();
  Ok(core.prompt(&system, &user, max_tokens, json == Some(true)).await)
}

#[cfg(test)]
mod tests {
  use std::io::BufRead;
  use std::net::TcpListener;

  use super::*;

  /// A folder of this test's own under the system's temp folder.
  fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("girovo-gemma-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
  }

  fn sha(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
  }

  fn body(len: usize) -> Arc<Vec<u8>> {
    Arc::new((0..len).map(|i| (i * 31 % 251) as u8).collect())
  }

  /// How the test server behaves.
  #[derive(Clone, Default)]
  struct Serving {
    /// Cut the first response off after this many bytes.
    cut_first_at: Option<usize>,
    /// Answer every request with the whole file (200), Range or not.
    ignore_range: bool,
  }

  /// A small HTTP/1.1 server for one file, Range included. Answers its URL and
  /// the Range headers it was sent (None for a request without one).
  fn serve(file: Arc<Vec<u8>>, how: Serving) -> (String, Arc<Mutex<Vec<Option<String>>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/file", listener.local_addr().unwrap());
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    std::thread::spawn(move || {
      for (n, stream) in listener.incoming().enumerate() {
        let Ok(mut stream) = stream else { continue };
        let mut reader = io::BufReader::new(stream.try_clone().unwrap());
        let mut range = None;
        loop {
          let mut line = String::new();
          if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
            break;
          }
          if let Some(v) = line.to_ascii_lowercase().strip_prefix("range: bytes=") {
            range = Some(v.trim().trim_end_matches('-').to_string());
          }
        }
        log.lock().unwrap().push(range.clone());
        let start = if how.ignore_range { 0 } else { range.as_deref().and_then(|r| r.parse::<usize>().ok()).unwrap_or(0) };
        let head = if start > 0 {
          if start >= file.len() {
            let _ = stream.write_all(format!("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", file.len()).as_bytes());
            continue;
          }
          format!(
            "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes {start}-{}/{}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            file.len() - 1,
            file.len(),
            file.len() - start
          )
        } else {
          format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", file.len())
        };
        let _ = stream.write_all(head.as_bytes());
        let end = match how.cut_first_at {
          Some(cut) if n == 0 => (start + cut).min(file.len()),
          _ => file.len(),
        };
        let _ = stream.write_all(&file[start..end]);
        let _ = stream.flush();
      }
    });
    (url, seen)
  }

  fn client() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
  }

  fn no_progress() -> impl Fn(u64, u64) + Sync {
    |_, _| {}
  }

  #[tokio::test]
  async fn a_download_whose_digest_matches_is_kept() {
    let dir = temp("digest-ok");
    let file = body(300_000);
    let (url, seen) = serve(file.clone(), Serving::default());
    let part = dir.join("f.part");
    fetch(&client(), &url, &part, Some(file.len() as u64), &sha(&file), &Cancel::new(), &no_progress()).await.unwrap();
    assert_eq!(fs::read(&part).unwrap(), *file);
    assert_eq!(*seen.lock().unwrap(), [None]);
    fs::remove_dir_all(&dir).unwrap();
  }

  #[tokio::test]
  async fn a_download_whose_digest_does_not_match_is_deleted() {
    let dir = temp("digest-bad");
    let file = body(50_000);
    let (url, _) = serve(file.clone(), Serving::default());
    let part = dir.join("f.part");
    let wrong = sha(b"something else");
    let err = fetch(&client(), &url, &part, Some(file.len() as u64), &wrong, &Cancel::new(), &no_progress()).await.unwrap_err();
    assert!(matches!(err, Fail::Digest), "{err}");
    assert!(!part.exists());
    // Never tried again by itself: the same bytes would come again.
    assert!(!err.retryable());
    fs::remove_dir_all(&dir).unwrap();
  }

  #[tokio::test]
  async fn a_download_resumes_from_what_is_on_the_disk() {
    let dir = temp("resume");
    let file = body(200_000);
    let (url, seen) = serve(file.clone(), Serving::default());
    let part = dir.join("f.part");
    fs::write(&part, &file[..70_000]).unwrap();
    let reports = Mutex::new(Vec::new());
    let progress = |r, t| reports.lock().unwrap().push((r, t));
    fetch(&client(), &url, &part, Some(file.len() as u64), &sha(&file), &Cancel::new(), &progress).await.unwrap();
    assert_eq!(fs::read(&part).unwrap(), *file);
    assert_eq!(*seen.lock().unwrap(), [Some("70000".to_string())]);
    let reports = reports.lock().unwrap();
    assert_eq!(reports.first(), Some(&(70_000, 200_000)));
    assert_eq!(reports.last(), Some(&(200_000, 200_000)));
    fs::remove_dir_all(&dir).unwrap();
  }

  #[tokio::test]
  async fn a_connection_cut_off_is_resumed_by_itself() {
    let dir = temp("cut");
    let file = body(400_000);
    let (url, seen) = serve(file.clone(), Serving { cut_first_at: Some(123_456), ..Default::default() });
    let part = dir.join("f.part");
    fetch_retrying(&client(), &url, &part, Some(file.len() as u64), &sha(&file), &Cancel::new(), &no_progress()).await.unwrap();
    assert_eq!(fs::read(&part).unwrap(), *file);
    assert_eq!(*seen.lock().unwrap(), [None, Some("123456".to_string())]);
    fs::remove_dir_all(&dir).unwrap();
  }

  #[tokio::test]
  async fn a_server_that_ignores_the_range_starts_the_file_over() {
    let dir = temp("no-range");
    let file = body(100_000);
    let (url, _) = serve(file.clone(), Serving { ignore_range: true, ..Default::default() });
    let part = dir.join("f.part");
    // What is there is not even the file's beginning: replaced, not appended to.
    fs::write(&part, vec![0xAAu8; 5_000]).unwrap();
    fetch(&client(), &url, &part, Some(file.len() as u64), &sha(&file), &Cancel::new(), &no_progress()).await.unwrap();
    assert_eq!(fs::read(&part).unwrap(), *file);
    fs::remove_dir_all(&dir).unwrap();
  }

  #[tokio::test]
  async fn a_complete_part_is_only_checked_and_a_wrong_one_goes() {
    let dir = temp("complete");
    let file = body(10_000);
    let (url, seen) = serve(file.clone(), Serving::default());
    let part = dir.join("f.part");
    fs::write(&part, &*file).unwrap();
    // Size known: not even asked for.
    fetch(&client(), &url, &part, Some(file.len() as u64), &sha(&file), &Cancel::new(), &no_progress()).await.unwrap();
    assert!(seen.lock().unwrap().is_empty());
    // Size unknown (the model): the server says there is nothing more (416), the digest decides.
    fetch(&client(), &url, &part, None, &sha(&file), &Cancel::new(), &no_progress()).await.unwrap();
    assert_eq!(*seen.lock().unwrap(), [Some("10000".to_string())]);
    let err = fetch(&client(), &url, &part, None, &sha(b"x"), &Cancel::new(), &no_progress()).await.unwrap_err();
    assert!(matches!(err, Fail::Digest));
    assert!(!part.exists());
    fs::remove_dir_all(&dir).unwrap();
  }

  #[tokio::test]
  async fn a_file_of_another_size_than_pinned_is_refused() {
    let dir = temp("size");
    let file = body(10_000);
    let (url, _) = serve(file.clone(), Serving::default());
    let part = dir.join("f.part");
    let err = fetch(&client(), &url, &part, Some(9_999), &sha(&file), &Cancel::new(), &no_progress()).await.unwrap_err();
    assert!(matches!(err, Fail::Size), "{err}");
    assert!(!part.exists());
    fs::remove_dir_all(&dir).unwrap();
  }

  #[tokio::test]
  async fn a_cancel_keeps_what_arrived() {
    let dir = temp("cancel");
    let file = body(10_000);
    let (url, _) = serve(file.clone(), Serving::default());
    let part = dir.join("f.part");
    fs::write(&part, &file[..4_000]).unwrap();
    let cancel = Cancel::new();
    cancel.cancel();
    let err = fetch(&client(), &url, &part, Some(file.len() as u64), &sha(&file), &cancel, &no_progress()).await.unwrap_err();
    assert!(matches!(err, Fail::Cancelled));
    assert_eq!(fs::metadata(&part).unwrap().len(), 4_000);
    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn reads_content_range() {
    assert_eq!(content_range("bytes 100-199/1000"), Some((100, 1000)));
    assert_eq!(content_range(" bytes 0-0/1 "), Some((0, 1)));
    assert_eq!(content_range("bytes */1000"), None);
    assert_eq!(content_range("items 1-2/3"), None);
  }

  /// A runtime that records what it published.
  fn core(dir: &Path, runtime: Option<&'static Pinned>) -> (Arc<Core>, Arc<Mutex<Vec<GemmaState>>>) {
    let published = Arc::new(Mutex::new(Vec::new()));
    let log = published.clone();
    let core = Core::new(dir.to_path_buf(), runtime, Box::new(move |s| log.lock().unwrap().push(s.clone())), Box::new(|| Lang::De));
    (core, published)
  }

  /// The files of a finished download, without downloading.
  fn lay_out(dir: &Path) {
    let rt = dir.join(RUNTIME_DIR).join("build").join("bin");
    fs::create_dir_all(&rt).unwrap();
    fs::write(rt.join(SERVER_EXE), b"").unwrap();
    fs::write(dir.join(RUNTIME_DIR).join(RUNTIME_COMPLETE), RELEASE).unwrap();
    fs::write(dir.join(MODEL_FILE), b"gguf").unwrap();
  }

  #[test]
  fn the_state_at_start_follows_the_disk() {
    let dir = temp("start-state");
    let pinned = runtime_for("windows", "x86_64");
    let (c, published) = core(&dir, pinned);
    let s = c.state();
    assert_eq!((s.state, s.phase, s.gpu, s.warm, s.supported), (Kind::Absent, None, None, false, true));
    assert!(published.lock().unwrap().is_empty());
    // The model without a complete runtime is not ready; a runtime without its mark neither.
    fs::write(dir.join(MODEL_FILE), b"gguf").unwrap();
    assert_eq!(core(&dir, pinned).0.state().state, Kind::Absent);
    lay_out(&dir);
    fs::remove_file(dir.join(RUNTIME_DIR).join(RUNTIME_COMPLETE)).unwrap();
    assert_eq!(core(&dir, pinned).0.state().state, Kind::Absent);
    lay_out(&dir);
    assert_eq!(core(&dir, pinned).0.state().state, Kind::Ready);
    // The marker of a GPU that failed in an older build is no reason to stay off it: gone.
    fs::write(dir.join(OLD_CPU_ONLY), b"").unwrap();
    let again = core(&dir, pinned).0;
    assert_eq!(again.state().gpu, None);
    assert!(!again.cpu_only.load(Ordering::SeqCst));
    assert!(!dir.join(OLD_CPU_ONLY).exists());
    // A system without a runtime is never ready, whatever is on the disk.
    let (none, _) = core(&dir, None);
    assert_eq!((none.state().state, none.state().supported), (Kind::Absent, false));
    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn a_download_on_a_system_without_runtime_is_an_error_at_once() {
    let dir = temp("unsupported");
    let (c, published) = core(&dir, None);
    let s = c.begin_download();
    assert_eq!(s.state, Kind::Error);
    assert_eq!(s.error.as_deref(), Some("Auf diesem System nicht verfügbar."));
    assert_eq!(published.lock().unwrap().len(), 1);
    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn a_ready_runtime_downloads_nothing_and_a_cancel_without_download_changes_nothing() {
    let dir = temp("ready");
    lay_out(&dir);
    let (c, published) = core(&dir, runtime_for("linux", "x86_64"));
    assert_eq!(c.begin_download().state, Kind::Ready);
    assert_eq!(c.cancel().state, Kind::Ready);
    assert!(published.lock().unwrap().is_empty());
    fs::remove_dir_all(&dir).unwrap();
  }

  #[tokio::test]
  async fn remove_deletes_everything_and_says_absent() {
    let dir = temp("remove");
    lay_out(&dir);
    fs::write(dir.join(format!("{MODEL_FILE}.part")), b"half").unwrap();
    let (c, published) = core(&dir, runtime_for("windows", "x86_64"));
    assert_eq!(c.state().state, Kind::Ready);
    c.cpu_only.store(true, Ordering::SeqCst);
    let s = c.remove().await;
    assert!(!c.cpu_only.load(Ordering::SeqCst));
    assert_eq!((s.state, s.gpu, s.warm, s.received), (Kind::Absent, None, false, 0));
    assert!(!dir.exists());
    assert_eq!(published.lock().unwrap().last().map(|s| s.state), Some(Kind::Absent));
    // Not ready: a prompt answers nothing and starts nothing.
    assert_eq!(c.prompt("s", "u", 8, false).await, None);
  }

  #[test]
  fn progress_goes_out_at_most_four_times_a_second_and_is_always_kept() {
    let dir = temp("throttle");
    let (c, published) = core(&dir, runtime_for("windows", "x86_64"));
    for i in 0..1000 {
      c.progress(i, 1000);
    }
    assert_eq!(published.lock().unwrap().len(), 1);
    assert_eq!(c.state().received, 999);
    // A new phase sends at once.
    c.enter(Phase::Model, MODEL_SIZE_APPROX);
    c.progress(5, MODEL_SIZE_APPROX);
    let published = published.lock().unwrap();
    assert_eq!(published.len(), 3);
    assert_eq!((published[2].phase, published[2].received), (Some(Phase::Model), 5));
    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn the_state_reaches_the_page_in_its_shape() {
    let dir = temp("shape");
    let (c, _) = core(&dir, runtime_for("windows", "x86_64"));
    let v = serde_json::to_value(c.state()).unwrap();
    assert_eq!(v, json!({ "state": "absent", "received": 0, "total": 0, "gpu": null, "warm": false, "starting": false, "supported": true, "partial": 0, "unavailable": false }));
    c.set(|s| {
      s.state = Kind::Downloading;
      s.phase = Some(Phase::Runtime);
      s.error = Some("x".into());
    });
    let v = serde_json::to_value(c.state()).unwrap();
    assert_eq!((v["state"].as_str(), v["phase"].as_str(), v["error"].as_str()), (Some("downloading"), Some("runtime"), Some("x")));
    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn every_system_gets_its_own_runtime() {
    assert_eq!(runtime_for("windows", "x86_64").unwrap().name, "llama-b12250-bin-win-vulkan-x64.zip");
    assert_eq!(runtime_for("windows", "aarch64").unwrap().size, 25_825_119);
    assert!(runtime_for("linux", "x86_64").unwrap().name.ends_with(".tar.gz"));
    assert!(runtime_for("linux", "aarch64").unwrap().name.contains("arm64"));
    assert_eq!(runtime_for("macos", "aarch64"), None);
    for (_, _, p) in RUNTIMES {
      assert!(p.name.contains(RELEASE));
      assert_eq!(p.sha256.len(), 64);
    }
  }

  #[test]
  fn the_server_command_line() {
    let model = Path::new("m.gguf");
    let all = Flags { no_webui: true, key_env: true, key_file: true, device: true, threads: true, threads_batch: true, vulkan0: Some(true) };
    let text = |args: Vec<OsString>| args.into_iter().map(|a| a.to_string_lossy().into_owned()).collect::<Vec<_>>().join(" ");
    // The GPU as the evaluation ran it, the CPU on its threads.
    let gpu = text(server_args(model, 4321, true, 8, &all, &KeyVia::Env, "secret"));
    assert_eq!(gpu, "-m m.gguf --host 127.0.0.1 --port 4321 --jinja -c 4096 -np 1 -ngl 99 --device Vulkan0 --no-webui");
    let cpu = text(server_args(model, 4321, false, 8, &all, &KeyVia::Env, "secret"));
    assert_eq!(cpu, "-m m.gguf --host 127.0.0.1 --port 4321 --jinja -c 4096 -np 1 -ngl 0 --device none -t 8 -tb 8 --no-webui");
    // A runtime that knows none of the flags gets none of them.
    let none = Flags::default();
    let bare = text(server_args(model, 1, false, 4, &none, &KeyVia::File(PathBuf::from("k")), "secret"));
    assert_eq!(bare, "-m m.gguf --host 127.0.0.1 --port 1 --jinja -c 4096 -np 1 -ngl 0 --api-key-file k");
    assert_eq!(text(server_args(model, 1, true, 4, &none, &KeyVia::Env, "s")), "-m m.gguf --host 127.0.0.1 --port 1 --jinja -c 4096 -np 1 -ngl 99");
    // The key on the command line only as the last way.
    assert!(!gpu.contains("secret") && !cpu.contains("secret") && !bare.contains("secret"));
    assert!(text(server_args(model, 1, true, 4, &none, &KeyVia::Arg, "secret")).ends_with("--api-key secret"));
    // How the key goes, by what the runtime understands.
    let dir = Path::new("d");
    assert_eq!(key_via(&all, dir), KeyVia::Env);
    assert_eq!(key_via(&Flags { key_file: true, ..none.clone() }, dir), KeyVia::File(dir.join(KEY_FILE)));
    assert_eq!(key_via(&none, dir), KeyVia::Arg);
  }

  #[test]
  fn reads_what_the_runtime_understands_from_its_help() {
    let help = "  --api-key KEY   API key to use for authentication (env: LLAMA_API_KEY)\n  --api-key-file FNAME\n  --no-webui   Disable the Web UI\n  -dev, --device <dev1,dev2,..>\n  -t,    --threads N\n  -tb,   --threads-batch N\n  --threads-http N";
    let all = Flags { no_webui: true, key_env: true, key_file: true, device: true, threads: true, threads_batch: true, vulkan0: None };
    assert_eq!(Flags::from_help(help), all);
    // --threads-http alone is not --threads.
    assert!(!Flags::from_help("  --threads-http N\n  --threads-batch N").threads);
    assert_eq!(Flags::from_help(""), Flags::default());
  }

  #[test]
  fn reads_from_the_device_list_whether_there_is_a_gpu_to_try() {
    let listed = "Available devices:\n  Vulkan0: NVIDIA GeForce RTX 4080 SUPER (16376 MiB, 14839 MiB free)\n";
    assert_eq!(listed_vulkan0(listed), Some(true));
    assert_eq!(listed_vulkan0("Available devices:\n"), Some(false));
    assert_eq!(listed_vulkan0(""), None);
    let mut flags = Flags::default();
    assert!(flags.gpu_worth_trying());
    flags.vulkan0 = Some(false);
    assert!(!flags.gpu_worth_trying());
  }

  #[test]
  fn the_cpu_gets_about_its_physical_cores_and_eight_at_most() {
    assert_eq!(cpu_threads(24), 8);
    assert_eq!(cpu_threads(16), 8);
    assert_eq!(cpu_threads(12), 6);
    assert_eq!(cpu_threads(4), 2);
    assert_eq!(cpu_threads(2), 2);
    assert_eq!(cpu_threads(1), 2);
  }

  #[test]
  fn reads_the_servers_speed_and_judges_it() {
    let body = json!({ "choices": [], "timings": { "predicted_per_second": 14.2, "predicted_n": 40 } });
    assert_eq!(speed(&body), Some((14.2, 40)));
    assert!(too_slow(speed(&body)));
    assert!(!too_slow(Some((204.0, 40))));
    // Too short an answer to tell, or no timings at all: not slow.
    assert!(!too_slow(Some((5.0, 3))));
    assert!(!too_slow(speed(&json!({ "choices": [] }))));
  }

  #[test]
  fn a_free_port_can_be_taken() {
    let port = free_port().unwrap();
    assert!(port > 0);
    let taken = TcpListener::bind(("127.0.0.1", port)).unwrap();
    assert_eq!(taken.local_addr().unwrap().port(), port);
  }

  #[test]
  fn a_key_is_64_hex_digits_and_new_every_time() {
    let (a, b) = (random_key().unwrap(), random_key().unwrap());
    assert_eq!(a.len(), 64);
    assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    assert_ne!(a, b);
  }

  #[test]
  fn finds_the_server_wherever_the_archive_keeps_it() {
    let dir = temp("find");
    assert_eq!(find_binary(&dir, SERVER_EXE), None);
    fs::create_dir_all(dir.join("llama-b12250").join("build").join("bin")).unwrap();
    fs::write(dir.join("llama-b12250").join("build").join("bin").join(SERVER_EXE), b"").unwrap();
    // A folder of that name is not it.
    fs::create_dir_all(dir.join("a").join(SERVER_EXE)).unwrap();
    assert_eq!(find_binary(&dir, SERVER_EXE), Some(dir.join("llama-b12250").join("build").join("bin").join(SERVER_EXE)));
    // The shallowest wins.
    fs::write(dir.join(SERVER_EXE), b"").unwrap();
    assert_eq!(find_binary(&dir, SERVER_EXE), Some(dir.join(SERVER_EXE)));
    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn unpacks_a_zip_and_marks_it_complete() {
    let dir = temp("zip");
    let archive = dir.join("rt.zip.part");
    {
      let mut zip = zip::ZipWriter::new(File::create(&archive).unwrap());
      let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
      zip.start_file(format!("bin/{SERVER_EXE}"), options).unwrap();
      zip.write_all(b"exe").unwrap();
      zip.start_file("bin/ggml.dll", options).unwrap();
      zip.write_all(b"dll").unwrap();
      zip.finish().unwrap();
    }
    let into = dir.join(RUNTIME_DIR);
    // Something of a half-done unpacking before: gone.
    fs::create_dir_all(&into).unwrap();
    fs::write(into.join("old"), b"").unwrap();
    let exe = unpack(&archive, &into).unwrap();
    assert_eq!(exe, into.join("bin").join(SERVER_EXE));
    assert_eq!(fs::read(&exe).unwrap(), b"exe");
    assert!(into.join(RUNTIME_COMPLETE).is_file());
    assert!(!into.join("old").exists());
    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn unpacks_a_tar_gz_and_refuses_one_without_the_server() {
    let dir = temp("targz");
    let make = |name: &str, entry: &str| {
      let path = dir.join(name);
      let gz = flate2::write::GzEncoder::new(File::create(&path).unwrap(), flate2::Compression::fast());
      let mut tar = tar::Builder::new(gz);
      let mut header = tar::Header::new_gnu();
      header.set_size(3);
      header.set_mode(0o755);
      header.set_cksum();
      tar.append_data(&mut header, entry, &b"exe"[..]).unwrap();
      tar.into_inner().unwrap().finish().unwrap();
      path
    };
    let good = make("rt.tar.gz.part", &format!("llama-b12250/{SERVER_EXE}"));
    let into = dir.join(RUNTIME_DIR);
    assert_eq!(unpack(&good, &into).unwrap(), into.join("llama-b12250").join(SERVER_EXE));
    let bad = make("other.tar.gz.part", "llama-b12250/README.md");
    assert!(matches!(unpack(&bad, &into), Err(Fail::Unpack(_))));
    assert!(!into.join(RUNTIME_COMPLETE).exists());
    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn reads_from_the_log_whether_the_gpu_took_the_model() {
    assert_eq!(offloaded("load_tensors: offloaded 36/36 layers to GPU\n"), Some(true));
    assert_eq!(offloaded("load_tensors: offloaded 0/36 layers to GPU\n"), Some(false));
    assert_eq!(offloaded("nothing about it"), None);
  }

  #[test]
  fn the_request_is_the_evaluations() {
    let body = chat_body("sys", "frage", 64, false);
    assert_eq!(
      body,
      json!({
        "messages": [{ "role": "system", "content": "sys" }, { "role": "user", "content": "frage" }],
        "temperature": 0, "top_k": 1, "seed": 0, "max_tokens": 64, "cache_prompt": true,
        "chat_template_kwargs": { "enable_thinking": false },
      })
    );
    assert_eq!(chat_body("s", "u", 1, true)["response_format"], json!({ "type": "json_object" }));
    assert_eq!(answer_text(&json!({ "choices": [{ "message": { "content": "  42 €  \n" } }] })).as_deref(), Some("42 €"));
    assert_eq!(answer_text(&json!({ "choices": [{ "message": { "content": "  " } }] })), None);
    assert_eq!(answer_text(&json!({ "error": "x" })), None);
  }

  #[test]
  fn texts_are_short_and_have_no_dashes() {
    let fails = [
      Fail::Unsupported,
      Fail::Network("x".into()),
      Fail::Http(500),
      Fail::Size,
      Fail::Digest,
      Fail::Disk(io::Error::from(io::ErrorKind::StorageFull)),
      Fail::Disk(io::Error::other("x")),
      Fail::Unpack("x".into()),
    ];
    for fail in &fails {
      for lang in [Lang::De, Lang::En] {
        let text = fail.text(lang);
        assert!(!text.is_empty() && text.len() < 100, "{text}");
        assert!(!text.contains(['-', '–', '—']), "{text}");
      }
    }
    for lang in [Lang::De, Lang::En] {
      let text = unavailable_text(lang);
      assert!(!text.is_empty() && text.len() < 100, "{text}");
      assert!(!text.contains(['-', '–', '—']), "{text}");
    }
  }

  /// A small HTTP server whose answer to each request `answer` decides from
  /// the request's head (lower case): Some(response), or None to hold the
  /// connection open and never answer (a hung server).
  fn fake_server(answer: impl Fn(&str) -> Option<String> + Send + 'static) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
      let mut held = Vec::new();
      for stream in listener.incoming() {
        let Ok(mut stream) = stream else { continue };
        let mut reader = io::BufReader::new(stream.try_clone().unwrap());
        let mut head = String::new();
        let mut length = 0usize;
        loop {
          let mut line = String::new();
          if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
            break;
          }
          let lower = line.to_ascii_lowercase();
          if let Some(v) = lower.strip_prefix("content-length:") {
            length = v.trim().parse().unwrap_or(0);
          }
          head.push_str(&lower);
        }
        let mut body = vec![0u8; length];
        let _ = reader.read_exact(&mut body);
        match answer(&head) {
          Some(response) => {
            let _ = stream.write_all(response.as_bytes());
          }
          None => held.push(stream),
        }
      }
    });
    port
  }

  fn response(status: &str, body: &str) -> String {
    format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
  }

  /// A process that runs until it is ended, standing in for llama-server.
  fn long_running() -> Child {
    let mut command = if cfg!(windows) {
      let mut c = Command::new("ping");
      c.args(["-n", "60", "127.0.0.1"]);
      c
    } else {
      let mut c = Command::new("sleep");
      c.arg("60");
      c
    };
    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    hide_window(&mut command);
    command.spawn().unwrap()
  }

  /// The prompt limit for the fake servers: a hung one is told in a second.
  const SHORT_LIMIT: Duration = Duration::from_secs(1);

  /// A runtime with its files laid out and a warm "server" on `port`.
  fn warm(name: &str, port: u16, gpu: bool) -> (PathBuf, Arc<Core>) {
    let dir = temp(name);
    lay_out(&dir);
    let (c, _) = core(&dir, runtime_for("windows", "x86_64"));
    c.prompt_limit_ms.store(SHORT_LIMIT.as_millis() as u64, Ordering::SeqCst);
    *c.server.lock().unwrap() = Some(Server { child: long_running(), port, key: "k".into(), healthy: true, gpu, answers: 0 });
    c.set(|s| {
      s.warm = true;
      s.gpu = Some(gpu);
    });
    (dir, c)
  }

  #[tokio::test]
  async fn a_hung_server_is_ended_and_the_next_start_is_on_the_cpu() {
    let port = fake_server(|_| None);
    let (dir, c) = warm("hung", port, true);
    let started = Instant::now();
    assert_eq!(c.prompt("s", "u", 8, false).await, None);
    assert!(started.elapsed() < SHORT_LIMIT * 5, "{:?}", started.elapsed());
    assert!(c.server.lock().unwrap().is_none(), "the hung server still runs");
    let s = c.state();
    assert_eq!((s.warm, s.gpu), (false, Some(false)));
    // For this run only: nothing on the disk.
    assert!(c.cpu_only.load(Ordering::SeqCst));
    assert!(!dir.join(OLD_CPU_ONLY).exists());
    fs::remove_dir_all(&dir).unwrap();
  }

  #[tokio::test]
  async fn failures_in_a_row_end_the_server_but_leave_the_gpu() {
    let port = fake_server(|_| Some(response("500 Internal Server Error", "{}")));
    let (dir, c) = warm("in-a-row", port, true);
    assert_eq!(c.prompt("s", "u", 8, false).await, None);
    assert!(c.server.lock().unwrap().is_some(), "one failure is not yet a broken server");
    assert_eq!(c.prompt("s", "u", 8, false).await, None);
    assert!(c.server.lock().unwrap().is_none());
    assert!(!c.state().warm);
    assert!(!c.cpu_only.load(Ordering::SeqCst));
    fs::remove_dir_all(&dir).unwrap();
  }

  fn answer_at(per_second: f64) -> String {
    response("200 OK", &format!(r#"{{"choices":[{{"message":{{"content":"ok"}}}}],"timings":{{"predicted_per_second":{per_second},"predicted_n":40}}}}"#))
  }

  #[tokio::test]
  async fn a_slow_gpu_hands_over_to_the_cpu_from_its_second_answer() {
    let port = fake_server(|_| Some(answer_at(12.0)));
    let (dir, c) = warm("slow-gpu", port, true);
    // The first answer is warm-up: not judged.
    assert_eq!(c.prompt("s", "u", 8, false).await.as_deref(), Some("ok"));
    assert!(c.server.lock().unwrap().is_some());
    // The second is, and still reaches the page; the server goes, the CPU is next.
    assert_eq!(c.prompt("s", "u", 8, false).await.as_deref(), Some("ok"));
    assert!(c.server.lock().unwrap().is_none());
    assert!(c.cpu_only.load(Ordering::SeqCst));
    let s = c.state();
    assert_eq!((s.warm, s.gpu), (false, Some(false)));
    fs::remove_dir_all(&dir).unwrap();
  }

  #[tokio::test]
  async fn a_fast_gpu_and_a_slow_cpu_stay_as_they_are() {
    let fast = fake_server(|_| Some(answer_at(204.0)));
    let (dir, c) = warm("fast-gpu", fast, true);
    for _ in 0..3 {
      assert_eq!(c.prompt("s", "u", 8, false).await.as_deref(), Some("ok"));
    }
    assert!(c.server.lock().unwrap().is_some());
    assert!(!c.cpu_only.load(Ordering::SeqCst));
    c.stop();
    fs::remove_dir_all(&dir).unwrap();
    // The CPU is where a slow GPU goes: nothing to hand over to.
    let slow = fake_server(|_| Some(answer_at(12.0)));
    let (dir, c) = warm("slow-cpu", slow, false);
    for _ in 0..3 {
      assert_eq!(c.prompt("s", "u", 8, false).await.as_deref(), Some("ok"));
    }
    assert!(c.server.lock().unwrap().is_some());
    c.stop();
    fs::remove_dir_all(&dir).unwrap();
  }

  #[tokio::test]
  async fn an_answer_resets_the_count_of_failures() {
    let port = fake_server(|_| Some(response("200 OK", r#"{"choices":[{"message":{"content":" ok "}}]}"#)));
    let (dir, c) = warm("reset-count", port, false);
    c.failures.store(1, Ordering::SeqCst);
    assert_eq!(c.prompt("s", "u", 8, false).await.as_deref(), Some("ok"));
    assert_eq!(c.failures.load(Ordering::SeqCst), 0);
    assert!(c.server.lock().unwrap().is_some());
    c.stop();
    fs::remove_dir_all(&dir).unwrap();
  }

  #[tokio::test]
  async fn when_no_start_works_later_prompts_answer_null_at_once() {
    let dir = temp("unavailable");
    // An llama-server that cannot even be started (an empty file).
    lay_out(&dir);
    let (c, published) = core(&dir, runtime_for("windows", "x86_64"));
    assert_eq!(c.prompt("s", "u", 8, false).await, None);
    let s = c.state();
    assert!(s.unavailable && !s.starting);
    assert_eq!(s.state, Kind::Ready);
    assert_eq!(s.error.as_deref(), Some("Das Modell ließ sich auf diesem Computer nicht starten."));
    let starts = |p: &Mutex<Vec<GemmaState>>| p.lock().unwrap().iter().filter(|s| s.starting).count();
    assert_eq!(starts(&published), 1);
    // No second try in this run.
    assert_eq!(c.prompt("s", "u", 8, false).await, None);
    assert_eq!(starts(&published), 1);
    // remove() lifts it, with everything else.
    let s = c.remove().await;
    assert!(!s.unavailable && s.error.is_none());
  }

  #[tokio::test]
  async fn only_our_own_server_is_trusted_with_prompts() {
    // Another program on the port, answering everything.
    let foreign = fake_server(|_| Some(response("200 OK", "{}")));
    assert!(!answers_as_ours(&client(), foreign, "k").await);
    // A llama-server, but not ours: it wants a key and serves another model.
    let other = fake_server(|head| {
      Some(if !head.contains("authorization: bearer k") { response("401 Unauthorized", "{}") } else { response("200 OK", r#"{"data":[{"id":"other.gguf"}]}"#) })
    });
    assert!(!answers_as_ours(&client(), other, "k").await);
    // Ours.
    let ours = fake_server(|head| {
      Some(if !head.contains("authorization: bearer k") {
        response("401 Unauthorized", "{}")
      } else {
        response("200 OK", &format!(r#"{{"data":[{{"id":"C:/x/{MODEL_FILE}"}}]}}"#))
      })
    });
    assert!(answers_as_ours(&client(), ours, "k").await);
    assert!(!answers_as_ours(&client(), ours, "wrong").await);
  }

  #[tokio::test]
  async fn partial_downloads_are_reported_and_removed() {
    let dir = temp("partial");
    fs::write(dir.join(format!("{MODEL_FILE}.part")), vec![0u8; 1234]).unwrap();
    fs::write(dir.join("llama-b12250-bin-win-vulkan-x64.zip.part"), vec![0u8; 66]).unwrap();
    fs::write(dir.join("other.txt"), b"not counted").unwrap();
    let (c, _) = core(&dir, runtime_for("windows", "x86_64"));
    let s = c.state();
    assert_eq!((s.state, s.partial), (Kind::Absent, 1300));
    assert_eq!(serde_json::to_value(&s).unwrap()["partial"], 1300);
    // remove() works from absent (and error) too.
    let s = c.remove().await;
    assert_eq!((s.state, s.partial), (Kind::Absent, 0));
    assert!(!dir.exists());
  }

  #[test]
  fn no_download_starts_while_a_remove_is_under_way() {
    let dir = temp("removing");
    let (c, published) = core(&dir, runtime_for("windows", "x86_64"));
    c.removing.fetch_add(1, Ordering::SeqCst);
    let s = c.begin_download();
    assert_eq!(s.state, Kind::Absent);
    assert!(c.cancel.lock().unwrap().is_none());
    assert!(published.lock().unwrap().is_empty());
    fs::remove_dir_all(&dir).unwrap();
  }

  /// The real runtime from GitHub (about 36 MB) into a temp folder: pinned
  /// digest, unpacking, the server found, its --help read. Not in the usual
  /// run: `cargo test gemma::tests::real_runtime -- --ignored --nocapture`.
  #[tokio::test]
  #[ignore]
  async fn real_runtime_download() {
    let Some(pinned) = runtime_for(std::env::consts::OS, std::env::consts::ARCH) else { return };
    let dir = temp("real");
    let part = dir.join(format!("{}.part", pinned.name));
    let client = reqwest::Client::builder().https_only(true).user_agent("Girovo-test").build().unwrap();
    let url = format!("{RUNTIME_BASE}{}", pinned.name);
    fetch_retrying(&client, &url, &part, Some(pinned.size), pinned.sha256, &Cancel::new(), &no_progress()).await.unwrap();
    let into = dir.join(RUNTIME_DIR);
    let exe = unpack(&part, &into).unwrap();
    println!("llama-server at {}", exe.strip_prefix(&dir).unwrap().display());
    let flags = probe_flags(&exe, &dir);
    println!("{flags:?}");
    assert!(flags.device, "the help was not read");
    fs::remove_dir_all(&dir).unwrap();
  }

  /// The whole server path with the real runtime and llama.cpp's own tiny
  /// test model (stories260K, about 1 MB) in Gemma's place: the start, the
  /// key, a prompt, the stop. `cargo test gemma::tests::real_server -- --ignored --nocapture`.
  #[tokio::test]
  #[ignore]
  async fn real_server_start_prompt_stop() {
    let Some(pinned) = runtime_for(std::env::consts::OS, std::env::consts::ARCH) else { return };
    let dir = temp("real-server");
    let client = reqwest::Client::builder().https_only(true).user_agent("Girovo-test").build().unwrap();
    let part = dir.join(format!("{}.part", pinned.name));
    let url = format!("{RUNTIME_BASE}{}", pinned.name);
    fetch_retrying(&client, &url, &part, Some(pinned.size), pinned.sha256, &Cancel::new(), &no_progress()).await.unwrap();
    unpack(&part, &dir.join(RUNTIME_DIR)).unwrap();
    fs::remove_file(&part).unwrap();
    let tiny = client.get("https://huggingface.co/ggml-org/models/resolve/main/tinyllamas/stories260K.gguf").send().await.unwrap();
    assert!(tiny.status().is_success());
    fs::write(dir.join(MODEL_FILE), tiny.bytes().await.unwrap()).unwrap();

    let (c, published) = core(&dir, Some(pinned));
    assert_eq!(c.state().state, Kind::Ready);
    let started = Instant::now();
    let answer = c.prompt("You are a storyteller.", "Once upon a time", 16, false).await;
    println!("answer after {:?}: {answer:?}", started.elapsed());
    assert!(answer.is_some());
    let s = c.state();
    println!("gpu {:?}, warm {}", s.gpu, s.warm);
    assert!(s.warm && !s.starting && s.gpu.is_some());
    assert!(published.lock().unwrap().iter().any(|s| s.starting));
    // The key file is gone, and the server refuses a request without the key.
    assert!(!dir.join(KEY_FILE).exists());
    let port = c.server.lock().unwrap().as_ref().unwrap().port;
    let body = chat_body("s", "u", 4, false);
    let bare = reqwest::Client::builder().no_proxy().build().unwrap();
    let refused = bare.post(format!("http://127.0.0.1:{port}/v1/chat/completions")).json(&body).send().await.unwrap();
    assert_eq!(refused.status().as_u16(), 401);
    // Warm: the second answer needs no start.
    let again = Instant::now();
    assert!(c.prompt("You are a storyteller.", "The cat", 8, false).await.is_some());
    println!("second answer after {:?}", again.elapsed());
    // The app's end: the server is gone, its port free again.
    c.stop();
    assert!(c.server.lock().unwrap().is_none());
    assert!(!c.state().warm);
    std::thread::sleep(Duration::from_millis(300));
    assert!(TcpListener::bind(("127.0.0.1", port)).is_ok());
    // A CPU start (after a GPU that failed in this run), with its threads: understood by this runtime.
    c.cpu_only.store(true, Ordering::SeqCst);
    let cpu = Instant::now();
    assert!(c.prompt("You are a storyteller.", "The dog", 8, false).await.is_some());
    println!("CPU start and answer after {:?}", cpu.elapsed());
    assert_eq!(c.state().gpu, Some(false));
    let log = fs::read_to_string(dir.join(SERVER_LOG)).unwrap_or_default();
    assert!(!log.contains("error: invalid argument"), "{log}");
    c.stop();
    let s = c.remove().await;
    assert_eq!(s.state, Kind::Absent);
    assert!(!dir.exists());
  }

  /// The real model, through the app's own download: GEMMA_TEST_DIR names where
  /// the runtime and the 3.35 GB model go (kept there for a headless prompt run;
  /// delete the folder afterwards). The model's download is cut after ~300 MB
  /// and resumed, so the Range resume on Hugging Face's CDN is tried for real.
  /// `cargo test real_model_download -- --ignored --nocapture`
  #[tokio::test]
  #[ignore]
  async fn real_model_download() {
    let Ok(target) = std::env::var("GEMMA_TEST_DIR") else { return };
    let dir = PathBuf::from(target);
    fs::create_dir_all(&dir).unwrap();
    let pinned = runtime_for(std::env::consts::OS, std::env::consts::ARCH).unwrap();
    let client = reqwest::Client::builder().https_only(true).user_agent("Girovo-test").build().unwrap();
    let part = dir.join(format!("{}.part", pinned.name));
    fetch_retrying(&client, &format!("{RUNTIME_BASE}{}", pinned.name), &part, Some(pinned.size), pinned.sha256, &Cancel::new(), &no_progress()).await.unwrap();
    let exe = unpack(&part, &dir.join(RUNTIME_DIR)).unwrap();
    fs::remove_file(&part).unwrap();
    println!("runtime at {}", exe.display());

    let model_part = dir.join(format!("{MODEL_FILE}.part"));
    let cut = Cancel::new();
    let cutter = cut.clone();
    let started = Instant::now();
    let first = fetch(&client, MODEL_URL, &model_part, None, MODEL_SHA256, &cut, &move |got, _| {
      if got > 300_000_000 {
        cutter.cancel();
      }
    })
    .await;
    let had = fs::metadata(&model_part).map(|m| m.len()).unwrap_or(0);
    println!("cut after {had} bytes ({:?}): {}", started.elapsed(), first.is_err());
    assert!(first.is_err() && had > 0);
    let last = std::sync::Mutex::new(Instant::now());
    fetch_retrying(&client, MODEL_URL, &model_part, None, MODEL_SHA256, &Cancel::new(), &|got, total| {
      let mut l = last.lock().unwrap();
      if l.elapsed() > Duration::from_secs(15) {
        println!("  {got} / {total}");
        *l = Instant::now();
      }
    })
    .await
    .unwrap();
    rename_retrying(&model_part, &dir.join(MODEL_FILE)).unwrap();
    println!("model verified and in place after {:?}", started.elapsed());
  }

  /// The app's own start, on an existing gemma folder (GEMMA_APP_DIR): whether
  /// the GPU is used and how fast a prompt is. Nothing is deleted.
  /// `cargo test real_app_dir_start -- --ignored --nocapture`
  #[tokio::test]
  #[ignore]
  async fn real_app_dir_start() {
    let Ok(target) = std::env::var("GEMMA_APP_DIR") else { return };
    let dir = PathBuf::from(target);
    let pinned = runtime_for(std::env::consts::OS, std::env::consts::ARCH);
    let (c, _published) = core(&dir, pinned);
    println!("state {:?} gpu {:?}", c.state().state, c.state().gpu);
    for i in 0..3 {
      let t = Instant::now();
      let a = c.prompt("Antworte kurz auf Deutsch.", "Nenne drei Farben.", 48, false).await;
      println!("prompt {i}: {:?} in {:?}", a, t.elapsed());
    }
    println!("gpu {:?}", c.state().gpu);
    c.stop();
  }
}
