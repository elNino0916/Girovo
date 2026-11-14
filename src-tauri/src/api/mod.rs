// The Girovo API's shell side (docs/girovo-api.md): a local JSON-RPC API for
// other apps on this computer, over a named pipe (Windows) or a Unix socket
// (Linux). The shell listens, tells who is asking (identify.rs, from the
// operating system, never from the app), keeps the wire in shape (rpc.rs:
// framing, a size cap, a rate limit) and hands each request to the page, which
// holds the grants, the dialog and the methods, as it holds the vault and the
// bank session.
//
// The bridge (bridge.js electronGirovoApi):
// - `api:call { id, connection, client, method, params }` to the main window for every request;
// - the page answers with `api_reply { id, result | error }`; unanswered after
//   150 s the client hears `timeout`, and with no page to ask, `locked`;
// - `api:closed { connection }` once a connection ends.
//
// Off by default and off at every start: the page switches it on with
// `api_set_enabled` once it has loaded and its setting says so. A page that
// loads again has to say so again; until then calls answer `locked`.

mod icon;
mod identify;
mod rpc;
mod server;
#[cfg(windows)]
mod signature;
mod transport;

#[cfg(test)]
mod tests;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use rpc::{PageError, Reply};
use server::{Call, Limits, Router, Server};

pub const CALL_EVENT: &str = "api:call";
pub const CLOSED_EVENT: &str = "api:closed";

#[derive(Default)]
pub struct Api {
  server: Mutex<Option<Server>>,
  /// The page has switched the API on since it last loaded, so it listens for calls.
  registered: Arc<AtomicBool>,
}

/// The main window's page as the Router.
struct Page {
  app: AppHandle,
  registered: Arc<AtomicBool>,
}

#[derive(Serialize, Clone)]
struct Closed<'a> {
  connection: &'a str,
}

impl Router for Page {
  fn call(&self, call: &Call) -> bool {
    if !self.registered.load(Ordering::SeqCst) || self.app.get_webview_window("main").is_none() {
      return false;
    }
    self.app.emit_to("main", CALL_EVENT, call).is_ok()
  }

  fn closed(&self, connection: &str) {
    let _ = self.app.emit_to("main", CLOSED_EVENT, Closed { connection });
  }
}

#[derive(Serialize)]
pub struct Enabled {
  running: bool,
  address: String,
}

#[derive(Serialize)]
pub struct Status {
  running: bool,
  address: String,
  connections: usize,
}

/// Where the API listens (or would): the page shows it to developers.
fn address(server: &Option<Server>) -> String {
  match server {
    Some(s) => s.address().to_string(),
    None => transport::default_address().unwrap_or_default(),
  }
}

/// Switches the API on or off. On, it answers once the pipe or socket is
/// there; `running` false says it could not be made (another program holds the name).
#[tauri::command(async)]
pub fn api_set_enabled(app: AppHandle, state: tauri::State<'_, Api>, on: bool) -> Enabled {
  let mut server = state.server.lock().unwrap();
  if !on {
    state.registered.store(false, Ordering::SeqCst);
    if let Some(s) = server.take() {
      s.stop();
    }
    return Enabled { running: false, address: address(&server) };
  }
  state.registered.store(true, Ordering::SeqCst);
  if server.is_none() {
    let router = Arc::new(Page { app: app.clone(), registered: state.registered.clone() });
    match transport::default_address().and_then(|addr| Server::start(&addr, router, Limits::default(), identify::client)) {
      Ok(s) => *server = Some(s),
      Err(e) => eprintln!("[api] could not listen: {e}"),
    }
  }
  Enabled { running: server.is_some(), address: address(&server) }
}

#[tauri::command(async)]
pub fn api_status(state: tauri::State<'_, Api>) -> Status {
  let server = state.server.lock().unwrap();
  Status { running: server.is_some(), address: address(&server), connections: server.as_ref().map_or(0, |s| s.connections()) }
}

/// The page's answer to one call. false when nobody waits for it any more.
#[tauri::command(async)]
pub fn api_reply(state: tauri::State<'_, Api>, id: String, result: Option<Value>, error: Option<PageError>) -> bool {
  let server = state.server.lock().unwrap();
  match server.as_ref() {
    Some(s) => s.reply(&id, Reply::from_parts(result, error)),
    None => false,
  }
}

/// The executable's icon as a PNG data URL, null where there is none (and off Windows).
#[tauri::command(async)]
pub fn api_client_icon(exe: String) -> Option<String> {
  icon::data_url(&exe)
}

/// The main window's page starts loading: whatever listened for calls is gone
/// with the old page, so calls answer `locked` until the new one switches the API on.
pub fn page_loading(app: &AppHandle) {
  if let Some(api) = app.try_state::<Api>() {
    api.registered.store(false, Ordering::SeqCst);
  }
}

/// The app ends: connections close, the socket file goes.
pub fn on_exit(app: &AppHandle) {
  if let Some(api) = app.try_state::<Api>() {
    if let Some(s) = api.server.lock().unwrap().take() {
      s.stop();
    }
  }
}
