// The category model (lib/category-model.ts): multilingual-e5-base, int8,
// run by ONNX Runtime here as onnxruntime-node ran it beside the Electron
// shell's server. The page keeps everything around it — the tokenizer, the
// pooling, the prototypes, the thresholds — and desktop/shims/ort.ts gives
// lib/category-model.ts the part of onnxruntime-node it uses, over these:
//
//   model_files    at server start: the model folder's files, the weights only by name
//   model_read     one of those files (raw bytes), for the page's in-memory tree
//   model_open     InferenceSession.create: the session, loaded once and shared
//   model_run      session.run: int64 tensors in, the outputs back as raw bytes
//   model_release  session.release: the session goes when no handle is left
//
// ONNX Runtime is not linked in. It is loaded at run time from the library
// the bundle ships (bundle.resources, staged by scripts/build-desktop.mjs from
// onnxruntime-node — the very build the Electron app shipped and the model's
// thresholds were calibrated with). Linking ort's own prebuilt binaries would
// have needed AVX2 (an older CPU would crash on the first guess, taking the
// whole app with it) and the Visual C++ runtime for girovo.exe itself.
//
// Nothing leaves the machine: telemetry is off, and the session runs on the
// CPU only, as onnxruntime-node's did.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, Weak};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use ort::environment::Environment;
use ort::session::{Session, SessionOutputs};
use ort::value::{DynValue, Tensor, TensorElementType, ValueType};
use tauri::Manager;

/// The model folder among the app's resources (scripts/fetch-model.mjs fetches it).
const MODEL_DIR: [&str; 2] = ["models", "category-model"];
/// Where the bundle keeps ONNX Runtime (tauri.conf.json, bundle.resources).
const RUNTIME_DIR: &str = "onnxruntime";
/// A file the page may read through model_read: the tokenizer is the largest, 17 MB.
const READ_MAX: u64 = 64 * 1024 * 1024;

/// ONNX Runtime's library for this platform: its name, and onnxruntime-node's folder for it.
fn runtime_library() -> Option<(&'static str, &'static str)> {
  match std::env::consts::OS {
    "windows" => Some(("onnxruntime.dll", "win32")),
    "linux" => Some(("libonnxruntime.so.1", "linux")),
    _ => None,
  }
}

#[derive(Clone)]
struct Located {
  dir: PathBuf,
  runtime: PathBuf,
}

impl Located {
  /// The model is here when its folder holds weights and the runtime to run them is beside it.
  fn complete(&self) -> bool {
    self.runtime.is_file() && weights(&self.dir).next().is_some()
  }
}

fn entries(dir: &Path) -> impl Iterator<Item = (String, PathBuf)> {
  std::fs::read_dir(dir).into_iter().flatten().flatten().filter_map(|entry| {
    let path = entry.path();
    let name = entry.file_name().to_str()?.to_string();
    path.is_file().then_some((name, path))
  })
}

fn is_weights(name: &str) -> bool {
  name.ends_with(".onnx")
}

fn weights(dir: &Path) -> impl Iterator<Item = String> {
  entries(dir).map(|(name, _)| name).filter(|name| is_weights(name))
}

/// The bundle's model and runtime; in a debug build, else the repository's own:
/// models/category-model and onnxruntime-node's library in node_modules.
fn locate(app: &tauri::AppHandle) -> Option<Located> {
  let (library, node_os) = runtime_library()?;
  let bundled = app.path().resource_dir().ok().map(|res| Located {
    dir: MODEL_DIR.iter().fold(res.clone(), |p, part| p.join(part)),
    runtime: res.join(RUNTIME_DIR).join(library),
  });
  let repo = cfg!(debug_assertions).then(|| {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    Located {
      dir: MODEL_DIR.iter().fold(root.clone(), |p, part| p.join(part)),
      runtime: root.join("node_modules/onnxruntime-node/bin/napi-v6").join(node_os).join("x64").join(library),
    }
  });
  [bundled, repo].into_iter().flatten().find(Located::complete)
}

/// A file name the page names: plain, inside the folder, never a path.
fn plain(name: &str) -> Result<&str, String> {
  let ok = !name.is_empty() && name.len() <= 120 && !name.starts_with('.') && !name.contains(['/', '\\', ':']);
  if ok { Ok(name) } else { Err(format!("EINVAL: not a model file: {name}")) }
}

// ---------------------------------------------------------------------------
// ONNX Runtime

/// The process's one ONNX Runtime environment (ort allows no second, not even
/// after the first is dropped), made on the first session.
fn environment(runtime: &Path) -> Result<&'static Environment, String> {
  static ENV: OnceLock<Environment> = OnceLock::new();
  if let Some(env) = ENV.get() {
    return Ok(env);
  }
  let builder = match ort::init_from(runtime) {
    Ok(builder) => builder,
    Err(first) => {
      // Windows: onnxruntime.dll needs the Visual C++ runtime. The system's is
      // taken first, kept current by Windows Update; a PC without one gets the
      // copy the bundle ships beside the library.
      load_beside(runtime).map_err(|_| format!("ELIBACC: {first}"))?;
      ort::init_from(runtime).map_err(|e| format!("ELIBACC: {e}"))?
    }
  };
  let env = builder.with_name("girovo").with_telemetry(false).build().map_err(|e| format!("EIO: {e}"))?;
  Ok(ENV.get_or_init(|| env))
}

/// Loads the library with its own folder searched first for what it imports,
/// and keeps it loaded: ort's own load then finds it in the process.
#[cfg(windows)]
fn load_beside(runtime: &Path) -> Result<(), libloading::Error> {
  use libloading::os::windows::{LOAD_WITH_ALTERED_SEARCH_PATH, Library};
  let library = unsafe { Library::load_with_flags(runtime, LOAD_WITH_ALTERED_SEARCH_PATH) }?;
  std::mem::forget(library);
  Ok(())
}

#[cfg(not(windows))]
fn load_beside(_runtime: &Path) -> Result<(), ()> {
  Err(())
}

/// A tensor's element type as onnxruntime-node names it: the two the model uses.
fn element(kind: &str) -> Result<TensorElementType, String> {
  match kind {
    "int64" => Ok(TensorElementType::Int64),
    "float32" => Ok(TensorElementType::Float32),
    other => Err(format!("EINVAL: tensor type {other} is not supported here")),
  }
}

/// Plain numbers as their bytes, the page reads them back as its typed arrays.
trait Plain: Copy {}
impl Plain for f32 {}
impl Plain for i64 {}

fn bytes_of<T: Plain>(data: &[T]) -> &[u8] {
  // f32 and i64 have no padding and every byte pattern is a valid u8; the
  // page's typed arrays read the platform's byte order, as written here.
  unsafe { std::slice::from_raw_parts(data.as_ptr().cast::<u8>(), std::mem::size_of_val(data)) }
}

/// A tensor from the page: its name, `int64` or `float32`, its shape, its bytes (base64).
#[derive(serde::Deserialize)]
pub struct Input {
  name: String,
  #[serde(rename = "type")]
  kind: String,
  dims: Vec<i64>,
  data: String,
}

impl Input {
  fn value(self) -> Result<(String, DynValue), String> {
    let bytes = B64.decode(self.data.as_bytes()).map_err(|e| format!("EINVAL: {e}"))?;
    let count = self
      .dims
      .iter()
      .try_fold(1usize, |n, &d| usize::try_from(d).ok().and_then(|d| n.checked_mul(d)))
      .ok_or_else(|| format!("EINVAL: bad shape {:?}", self.dims))?;
    let ty = element(&self.kind)?;
    let size = if ty == TensorElementType::Int64 { 8 } else { 4 };
    if bytes.len() != count * size {
      return Err(format!("EINVAL: {} holds {} bytes, its shape needs {}", self.name, bytes.len(), count * size));
    }
    let value = if ty == TensorElementType::Int64 {
      let data: Vec<i64> = bytes.chunks_exact(8).map(|c| i64::from_le_bytes(c.try_into().unwrap())).collect();
      Tensor::from_array((self.dims, data)).map_err(|e| format!("EINVAL: {e}"))?.into_dyn()
    } else {
      let data: Vec<f32> = bytes.chunks_exact(4).map(|c| f32::from_le_bytes(c.try_into().unwrap())).collect();
      Tensor::from_array((self.dims, data)).map_err(|e| format!("EINVAL: {e}"))?.into_dyn()
    };
    Ok((self.name, value))
  }
}

#[derive(serde::Serialize)]
struct Described {
  name: String,
  #[serde(rename = "type")]
  kind: &'static str,
  dims: Vec<i64>,
}

/// The outputs in one buffer, for one IPC answer without base64:
///
///   u32 (little-endian)   length of the header
///   header                JSON, [{ name, type, dims }] in output order
///   each output's data    in that order, every part starting at a multiple of 8
fn frame(names: &[String], outputs: &SessionOutputs<'_>) -> Result<Vec<u8>, String> {
  let mut header = Vec::with_capacity(names.len());
  let mut parts: Vec<&[u8]> = Vec::with_capacity(names.len());
  for name in names {
    let value = outputs.get(name).ok_or_else(|| format!("EIO: no output {name}"))?;
    let (kind, shape, bytes) = match value.dtype() {
      ValueType::Tensor { ty: TensorElementType::Float32, .. } => {
        let (shape, data) = value.try_extract_tensor::<f32>().map_err(|e| format!("EIO: {e}"))?;
        ("float32", shape.to_vec(), bytes_of(data))
      }
      ValueType::Tensor { ty: TensorElementType::Int64, .. } => {
        let (shape, data) = value.try_extract_tensor::<i64>().map_err(|e| format!("EIO: {e}"))?;
        ("int64", shape.to_vec(), bytes_of(data))
      }
      other => return Err(format!("EIO: output {name} is {other:?}, not a float32 or int64 tensor")),
    };
    header.push(Described { name: name.clone(), kind, dims: shape });
    parts.push(bytes);
  }
  let header = serde_json::to_vec(&header).map_err(|e| e.to_string())?;
  let pad = |n: usize| n.next_multiple_of(8);
  let total = parts.iter().fold(pad(4 + header.len()), |at, p| pad(at + p.len()));
  let mut out = Vec::with_capacity(total);
  out.extend_from_slice(&(header.len() as u32).to_le_bytes());
  out.extend_from_slice(&header);
  for part in parts {
    out.resize(pad(out.len()), 0);
    out.extend_from_slice(part);
  }
  Ok(out)
}

// ---------------------------------------------------------------------------
// Sessions

/// A loaded session and its names, shared by every handle the page holds on it.
struct Loaded {
  session: Mutex<Session>,
  inputs: Vec<String>,
  outputs: Vec<String>,
}

impl Loaded {
  fn run(&self, inputs: Vec<Input>) -> Result<Vec<u8>, String> {
    let feeds = inputs.into_iter().map(Input::value).collect::<Result<Vec<_>, _>>()?;
    // ort runs a session from one thread at a time; lib/category-model.ts queues its calls anyway.
    let mut session = self.session.lock().unwrap();
    let outputs = session.run(feeds).map_err(|e| format!("EIO: {e}"))?;
    frame(&self.outputs, &outputs)
  }
}

#[derive(Default)]
struct Open {
  /// The session while any handle holds it: a second create gets the same one.
  live: Weak<Loaded>,
  handles: HashMap<u32, Arc<Loaded>>,
  next: u32,
}

#[derive(Default)]
struct Shared {
  located: OnceLock<Option<Located>>,
  /// Held while a session loads, so two creates load it once.
  loading: Mutex<()>,
  open: Mutex<Open>,
}

/// The model's state in the shell: where it is, and the session the page's handles share.
#[derive(Clone, Default)]
pub struct Model(Arc<Shared>);

impl Model {
  fn located(&self, app: &tauri::AppHandle) -> Option<Located> {
    self.0.located.get_or_init(|| locate(app)).clone()
  }

  fn handle(&self, id: u32) -> Result<Arc<Loaded>, String> {
    self.0.open.lock().unwrap().handles.get(&id).cloned().ok_or_else(|| "EBADF: the session was released".into())
  }

  fn register(&self, loaded: Arc<Loaded>) -> Opened {
    let mut open = self.0.open.lock().unwrap();
    open.next += 1;
    let id = open.next;
    open.live = Arc::downgrade(&loaded);
    let opened = Opened { id, input_names: loaded.inputs.clone(), output_names: loaded.outputs.clone() };
    open.handles.insert(id, loaded);
    opened
  }

  fn open(&self, located: &Located, file: &str, threads: Threads) -> Result<Opened, String> {
    let _loading = self.0.loading.lock().unwrap();
    let live = self.0.open.lock().unwrap().live.upgrade();
    if let Some(loaded) = live {
      return Ok(self.register(loaded));
    }
    let path = located.dir.join(file);
    if !is_weights(file) || !path.is_file() {
      return Err(format!("ENOENT: {file}"));
    }
    let env = environment(&located.runtime)?;
    let cores = std::thread::available_parallelism().map_or(1, |n| n.get());
    // Session options as onnxruntime-node set them: ONNX Runtime's defaults (the
    // CPU, every graph optimisation) and the page's thread counts.
    let mut builder = Session::builder(env).map_err(|e| format!("EIO: {e}"))?;
    if let Some(n) = threads.intra {
      builder = builder.with_intra_threads(n.clamp(1, cores)).map_err(|e| format!("EIO: {e}"))?;
    }
    if let Some(n) = threads.inter {
      builder = builder.with_inter_threads(n.clamp(1, cores)).map_err(|e| format!("EIO: {e}"))?;
    }
    let session = builder.commit_from_file(&path).map_err(|e| format!("EIO: {e}"))?;
    let loaded = Arc::new(Loaded {
      inputs: session.inputs().iter().map(|i| i.name().to_string()).collect(),
      outputs: session.outputs().iter().map(|o| o.name().to_string()).collect(),
      session: Mutex::new(session),
    });
    Ok(self.register(loaded))
  }

  /// Drops a handle; the session itself goes with its last one.
  fn release(&self, id: u32) -> Option<Arc<Loaded>> {
    self.0.open.lock().unwrap().handles.remove(&id)
  }
}

#[derive(Clone, Copy)]
struct Threads {
  intra: Option<usize>,
  inter: Option<usize>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
  id: u32,
  input_names: Vec<String>,
  output_names: Vec<String>,
}

#[derive(serde::Serialize)]
pub struct Files {
  /// Files the page reads into its tree.
  read: Vec<String>,
  /// The weights: listed there, never read — they stay here.
  weights: Vec<String>,
}

async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
  tauri::async_runtime::spawn_blocking(job).await.map_err(|e| format!("EIO: {e}"))?
}

// ---------------------------------------------------------------------------
// Commands — all async, so none of them runs on the window's thread.

#[tauri::command]
pub async fn model_files(app: tauri::AppHandle, state: tauri::State<'_, Model>) -> Result<Option<Files>, String> {
  let Some(located) = state.located(&app) else { return Ok(None) };
  let (mut read, mut weights): (Vec<String>, Vec<String>) = entries(&located.dir).map(|(name, _)| name).partition(|n| !is_weights(n));
  read.sort();
  weights.sort();
  Ok(Some(Files { read, weights }))
}

#[tauri::command]
pub async fn model_read(app: tauri::AppHandle, state: tauri::State<'_, Model>, name: String) -> Result<tauri::ipc::Response, String> {
  let located = state.located(&app).ok_or("ENOENT: no model")?;
  let name = plain(&name)?.to_string();
  if is_weights(&name) {
    return Err(format!("EACCES: {name} stays in the shell"));
  }
  let bytes = blocking(move || {
    let path = located.dir.join(&name);
    let size = std::fs::metadata(&path).map_err(|_| format!("ENOENT: {name}"))?.len();
    if size > READ_MAX {
      return Err(format!("EFBIG: {name}"));
    }
    std::fs::read(&path).map_err(|e| format!("EIO: {e}"))
  })
  .await?;
  Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn model_open(
  app: tauri::AppHandle,
  state: tauri::State<'_, Model>,
  file: String,
  intra_op_num_threads: Option<usize>,
  inter_op_num_threads: Option<usize>,
) -> Result<Opened, String> {
  let located = state.located(&app).ok_or("ENOENT: no model")?;
  let file = plain(&file)?.to_string();
  let model = state.inner().clone();
  let threads = Threads { intra: intra_op_num_threads, inter: inter_op_num_threads };
  blocking(move || model.open(&located, &file, threads)).await
}

#[tauri::command]
pub async fn model_run(state: tauri::State<'_, Model>, id: u32, inputs: Vec<Input>) -> Result<tauri::ipc::Response, String> {
  let loaded = state.handle(id)?;
  let frame = blocking(move || loaded.run(inputs)).await?;
  Ok(tauri::ipc::Response::new(frame))
}

#[tauri::command]
pub async fn model_release(state: tauri::State<'_, Model>, id: u32) -> Result<(), String> {
  // Freeing a few hundred MB takes a moment: not on the command's own thread either.
  let released = state.release(id);
  blocking(move || {
    drop(released);
    Ok(())
  })
  .await
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn refuses_names_that_are_paths() {
    assert!(plain("tokenizer.json").is_ok());
    assert!(plain("../prefs.json").is_err());
    assert!(plain("a/b.json").is_err());
    assert!(plain("a\\b.json").is_err());
    assert!(plain("C:x.json").is_err());
    assert!(plain(".hidden").is_err());
    assert!(plain("").is_err());
  }
}
