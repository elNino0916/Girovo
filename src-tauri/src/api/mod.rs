// The Girovo API's shell side (docs/girovo-api.md): a local JSON-RPC API for
// other apps on this computer, over a named pipe (Windows) or a Unix socket
// (Linux). The shell listens, tells who is asking (identify.rs, from the
// operating system, never from the app), keeps the wire in shape (rpc.rs:
// framing, a size cap, a rate limit) and hands each request to the page, which
// holds the grants, the dialog and the methods, as it holds the vault and the
// bank session.
//
// The bridge (bridge.js electronGirovoApi):
// - `api_set_enabled { on }` is the user's switch (Einstellungen → Girovo API
//   zulassen): the shell keeps it in prefs.json (API_PREF) and listens from
//   every start while it is on, logged in or not; off, there is no pipe;
// - `api_page_ready { ready }`: the page can answer (logged in, the vault
//   open), or no longer (the logout); a page that starts loading is not ready;
// - `api:call { id, connection, client, method, params }` to the main window
//   for every request while the page is ready; one that comes while it is not
//   is held (server.rs): Girovo comes forward (focus.rs) so the login shows,
//   `api:waiting { clients }` says who waits (`api_waiting` asks), and the
//   held calls go to the page once it is ready, else `locked` after 120 s;
// - the page answers with `api_reply { id, result | error }`; unanswered after
//   150 s the client hears `timeout`;
// - `api:closed { connection }` once a connection ends;
// - `api_notify { connection, method, params }` sends that connection a
//   JSON-RPC notification (events.subscribe), false once it is gone;
// - `api_focus_window` brings Girovo's window to the front for the consent
//   dialog or an approval, and says whether it got there (focus.rs).

mod focus;
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

use crate::prefs::Prefs;
use identify::Client;
use rpc::{PageError, Reply};
use server::{Call, Limits, Router, Server};

pub const CALL_EVENT: &str = "api:call";
pub const CLOSED_EVENT: &str = "api:closed";
pub const WAITING_EVENT: &str = "api:waiting";
/// "Girovo API zulassen", as the shell remembers it across starts: "1" or absent.
pub const API_PREF: &str = "fints.api.on";

#[derive(Default)]
pub struct Api {
  server: Mutex<Option<Server>>,
  /// The page can answer: logged in, the vault open (`api_page_ready`). Kept
  /// here as well, for a server started after the page said so.
  ready: AtomicBool,
}

/// The main window's page as the Router.
struct Page {
  app: AppHandle,
  /// A bring_forward is under way: calls held one after the other bring the window once.
  forwarding: Arc<AtomicBool>,
}

#[derive(Serialize, Clone)]
struct Closed<'a> {
  connection: &'a str,
}

#[derive(Serialize, Clone)]
struct Waiting<'a> {
  clients: &'a [Client],
}

impl Router for Page {
  fn call(&self, call: &Call) -> bool {
    if self.app.get_webview_window("main").is_none() {
      return false;
    }
    self.app.emit_to("main", CALL_EVENT, call).is_ok()
  }

  fn closed(&self, connection: &str) {
    let _ = self.app.emit_to("main", CLOSED_EVENT, Closed { connection });
  }

  fn waiting(&self, clients: &[Client], arrived: bool) {
    let _ = self.app.emit_to("main", WAITING_EVENT, Waiting { clients });
    // Out of the tray and in front, so the login shows: on a thread of its
    // own, since it waits for the window's thread (and this must not wait).
    if arrived && !self.forwarding.swap(true, Ordering::SeqCst) {
      let (app, forwarding) = (self.app.clone(), self.forwarding.clone());
      std::thread::spawn(move || {
        focus::bring_forward(&app);
        forwarding.store(false, Ordering::SeqCst);
      });
    }
  }
}

#[derive(Serialize)]
pub struct Enabled {
  running: bool,
  address: String,
}

#[derive(Serialize)]
pub struct Status {
  /// The user's switch, as the shell remembers it.
  on: bool,
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

fn switched_on(app: &AppHandle) -> bool {
  app.state::<Prefs>().get(API_PREF).as_deref() == Some("1")
}

/// Starts listening if it does not yet; the log says why when it can't.
fn listen(app: &AppHandle, api: &Api, server: &mut Option<Server>) {
  if server.is_some() {
    return;
  }
  let router = Arc::new(Page { app: app.clone(), forwarding: Arc::new(AtomicBool::new(false)) });
  match transport::default_address().and_then(|addr| Server::start(&addr, router, Limits::default(), identify::client)) {
    Ok(s) => {
      s.set_ready(api.ready.load(Ordering::SeqCst));
      *server = Some(s);
    }
    Err(e) => eprintln!("[api] could not listen: {e}"),
  }
}

/// The user's switch: remembered across starts, and listening from now on
/// or not. `running` false while on says the pipe could not be made (another
/// program holds the name).
#[tauri::command(async)]
pub fn api_set_enabled(app: AppHandle, state: tauri::State<'_, Api>, prefs: tauri::State<'_, Prefs>, on: bool) -> Enabled {
  prefs.set(API_PREF, on.then_some("1"));
  let mut server = state.server.lock().unwrap();
  if on {
    listen(&app, &state, &mut server);
  } else if let Some(s) = server.take() {
    s.stop();
  }
  Enabled { running: server.is_some(), address: address(&server) }
}

/// Whether the page can answer calls: true once logged in with the vault
/// open, false at the logout. Calls held meanwhile go to it now.
#[tauri::command(async)]
pub fn api_page_ready(state: tauri::State<'_, Api>, ready: bool) {
  state.ready.store(ready, Ordering::SeqCst);
  if let Some(s) = state.server.lock().unwrap().as_ref() {
    s.set_ready(ready);
  }
}

/// Who waits for the page now (the login's notice asks when it appears).
#[tauri::command(async)]
pub fn api_waiting(state: tauri::State<'_, Api>) -> Vec<Client> {
  state.server.lock().unwrap().as_ref().map(|s| s.waiting()).unwrap_or_default()
}

#[tauri::command(async)]
pub fn api_status(app: AppHandle, state: tauri::State<'_, Api>) -> Status {
  let server = state.server.lock().unwrap();
  Status {
    on: switched_on(&app),
    running: server.is_some(),
    address: address(&server),
    connections: server.as_ref().map_or(0, |s| s.connections()),
  }
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

/// A notification to one connection, as `{"jsonrpc":"2.0","method":…,"params":…}`.
/// false when it did not go out: the connection is gone, or was just dropped
/// for leaving its queue full, or the message is none the wire may carry
/// (over the 1 MiB cap, or params that are no object or array; the log says which).
#[tauri::command(async)]
pub fn api_notify(state: tauri::State<'_, Api>, connection: String, method: String, params: Option<Value>) -> bool {
  let server = state.server.lock().unwrap();
  match server.as_ref() {
    Some(s) => s.notify(&connection, &method, params.unwrap_or(Value::Null)).is_ok(),
    None => false,
  }
}

/// Girovo's window out of the tray or the taskbar and in front; whether it
/// got there. Not in front, its taskbar button flashes until the user comes.
#[tauri::command(async)]
pub fn api_focus_window(app: AppHandle) -> bool {
  focus::bring_forward(&app)
}

/// The executable's icon as a PNG data URL, null where there is none (and off Windows).
#[tauri::command(async)]
pub fn api_client_icon(exe: String) -> Option<String> {
  icon::data_url(&exe)
}

/// The app starts: with the switch on, the pipe is there before any login,
/// so a call that comes now brings Girovo forward and waits for the user.
pub fn start_if_on(app: &AppHandle) {
  if !switched_on(app) {
    return;
  }
  if let Some(api) = app.try_state::<Api>() {
    let mut server = api.server.lock().unwrap();
    listen(app, &api, &mut server);
  }
}

/// The main window's page starts loading: whatever answered calls is gone
/// with the old page, so calls are held until the new one is ready.
pub fn page_loading(app: &AppHandle) {
  if let Some(api) = app.try_state::<Api>() {
    api.ready.store(false, Ordering::SeqCst);
    if let Some(s) = api.server.lock().unwrap().as_ref() {
      s.set_ready(false);
    }
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
