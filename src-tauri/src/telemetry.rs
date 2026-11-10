// Telemetry to the developer's own server (config.json → telemetry), from the
// shell — the Electron shell's telemetry.cjs and its vendored SDK (the Electron shell's telemetry-sdk.mjs),
// in Rust. Same endpoint, same batches, same rules.
//
// Two kinds, two rules:
//
//   errors        always sent: failures of the shell, the route handlers and
//                 the page. Scrubbed (telemetry_scrub.rs) and tagged only with
//                 where they happened.
//   usage         events and metrics — which screens are used, how a login
//                 went and how long the bank took. Only after the user said
//                 yes ("Nutzungsdaten teilen", asked once on the Übersicht,
//                 changeable in the Sitzung panel).
//
// The install id — the one thing stored on the machine for this — exists only
// while usage is shared: without the yes, an error report carries just this
// start's session id, and switching usage off deletes the id. Every report
// shows the server the user's IP address, as any request does.
//
// Only events and fields listed below can be sent, each field of a fixed type
// (telemetry_scrub::props), so nothing from the bookings can reach a report.
//
// Where the reports come from: the page (bridge.js window.electronTelemetry),
// the route handlers, which run in the page too — lib/telemetry.ts hands
// them to a sink desktop/server/telemetry.ts puts up, where the Electron shell
// read them off its server's stdout — and the shell itself (its start, its
// end, a panic). A release build reports; a debug build only with
// GIROVO_TELEMETRY=1, as "development", so development stays out of the reports.

use std::collections::VecDeque;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{Map, Value, json};
use tauri::Manager;

use crate::prefs::Prefs;
use crate::telemetry_scrub::{self as scrub, Kind, Scrubbed, Spec};

pub const CONSENT_PREF: &str = "fints.telemetry";
pub const ID_PREF: &str = "fints.telemetry.id";

const LOGIN_OUTCOMES: &[&str] = &["ok", "refused", "unreachable", "unavailable", "insecure", "cancelled", "error"];

/// The usage events and the fields each may carry.
const EVENTS: &[(&str, Spec)] = &[
  // apk / play: the Android app from GitHub, or from Google Play (mobile/bridges/telemetry.ts).
  ("app_started", &[("installKind", Kind::OneOf(&["nsis", "portable", "manual", "dev", "apk", "play"])), ("locale", Kind::Id)]),
  ("app_closed", &[("minutes", Kind::Int)]),
  ("screen_viewed", &[("screen", Kind::Id)]),
  (
    "login_result",
    &[("blz", Kind::Blz), ("outcome", Kind::OneOf(LOGIN_OUTCOMES)), ("restored", Kind::Bool), ("tanMethods", Kind::Int), ("ms", Kind::Int)],
  ),
  // taxYear: the Steuer-Jahresübersicht (PDF, CSV, or ZIP with its receipts).
  (
    "export_created",
    &[("format", Kind::OneOf(&["pdf", "csv", "zip"])), ("kind", Kind::OneOf(&["statement", "transaction", "message", "transactions", "taxYear"]))],
  ),
  ("update_available", &[("version", Kind::Version)]),
  ("update_downloaded", &[("version", Kind::Version)]),
  ("update_installed", &[("from", Kind::Version), ("to", Kind::Version)]),
];

/// The usage metrics and their fields.
const METRICS: &[(&str, Spec)] = &[
  ("bank.request_ms", &[("blz", Kind::Blz), ("ok", Kind::Bool)]),
  ("server.start_ms", &[]),
  // From the process start to the app's window drawn; after an update or not.
  ("app.start_ms", &[("updated", Kind::Bool)]),
];

/// Where an error happened — the only fields an error report carries.
const ERROR_PROPS: Spec = &[
  ("source", Kind::OneOf(&["main", "server", "route", "renderer", "updater"])),
  ("route", Kind::Id),
  ("blz", Kind::Blz),
  ("kind", Kind::Id),
  // How a connection to the bank failed, as the network stack names it (lib/api.ts).
  ("code", Kind::Id),
  ("during", Kind::OneOf(&["check", "download", "install"])),
  ("fatal", Kind::Bool),
];

fn spec_of(list: &[(&str, Spec)], name: &str) -> Option<Spec> {
  list.iter().find(|(n, _)| *n == name).map(|(_, s)| *s)
}

// ---------------------------------------------------------------------------
// The hub: what may go out

/// Where the hub keeps the consent and the install id (prefs.json; a map in the tests).
pub trait Store {
  fn get(&self, key: &str) -> Option<String>;
  fn set(&self, key: &str, value: &str);
  fn del(&self, key: &str);
}

impl Store for Prefs {
  fn get(&self, key: &str) -> Option<String> {
    Prefs::get(self, key)
  }
  fn set(&self, key: &str, value: &str) {
    Prefs::set(self, key, Some(value));
  }
  fn del(&self, key: &str) {
    Prefs::set(self, key, None);
  }
}

pub type BoxFuture<'a> = Pin<Box<dyn Future<Output = ()> + Send + 'a>>;

/// What the hub hands its reports to: the client below, or a recorder in the tests.
pub trait Sdk: Send + Sync {
  /// The user id attached to every report from now on; None for none.
  fn identify(&self, id: Option<String>);
  fn capture_error(&self, error: &Scrubbed, props: Map<String, Value>);
  fn track(&self, name: &str, props: Map<String, Value>);
  fn metric(&self, name: &str, value: Value, props: Map<String, Value>);
  /// Sends what is queued and stops.
  fn shutdown(&self) -> BoxFuture<'_>;
}

/// the Electron shell's telemetry.cjs createTelemetryHub: decides what reaches the client.
pub struct Hub {
  client: Option<Arc<dyn Sdk>>,
  random_id: fn() -> String,
}

impl Hub {
  /// Whether this hub sends at all (a client: this build reports, and has started).
  pub fn sends(&self) -> bool {
    self.client.is_some()
  }

  /// Without a client nothing is sent; with one, it learns at once whose reports these are.
  pub fn new(client: Option<Arc<dyn Sdk>>, store: &dyn Store, random_id: fn() -> String) -> Hub {
    let hub = Hub { client, random_id };
    hub.sync_identity(store);
    hub
  }

  /// 'on' | 'off' | 'unasked' — the user's answer to "Nutzungsdaten teilen?".
  pub fn consent(&self, store: &dyn Store) -> &'static str {
    match store.get(CONSENT_PREF).as_deref() {
      Some("on") => "on",
      Some("off") => "off",
      _ => "unasked",
    }
  }

  fn install_id(&self, store: &dyn Store) -> String {
    match store.get(ID_PREF).filter(|id| !id.is_empty()) {
      Some(id) => id,
      None => {
        let id = (self.random_id)();
        store.set(ID_PREF, &id);
        id
      }
    }
  }

  // The user id the client attaches to every report: the install id with the
  // yes, none without it.
  fn sync_identity(&self, store: &dyn Store) {
    if let Some(client) = &self.client {
      client.identify((self.consent(store) == "on").then(|| self.install_id(store)));
    }
  }

  pub fn set_consent(&self, store: &dyn Store, on: bool) -> &'static str {
    store.set(CONSENT_PREF, if on { "on" } else { "off" });
    if !on {
      store.del(ID_PREF);
    }
    self.sync_identity(store);
    self.consent(store)
  }

  /// Always: an unexpected failure, scrubbed, with where it happened.
  pub fn error(&self, raw: &Value, place: &Value) {
    let Some(client) = &self.client else { return };
    if let Some(e) = scrub::error(raw) {
      client.capture_error(&e, scrub::props(place, ERROR_PROPS));
    }
  }

  /// With the yes only: one of EVENTS.
  pub fn event(&self, store: &dyn Store, name: &str, props: &Value) {
    let Some(client) = &self.client else { return };
    let Some(spec) = spec_of(EVENTS, name) else { return };
    if self.consent(store) != "on" {
      return;
    }
    client.track(name, scrub::props(props, spec));
  }

  /// With the yes only: one of METRICS.
  pub fn metric(&self, store: &dyn Store, name: &str, value: f64, props: &Value) {
    let Some(client) = &self.client else { return };
    let Some(spec) = spec_of(METRICS, name) else { return };
    if self.consent(store) != "on" || !value.is_finite() {
      return;
    }
    client.metric(name, scrub::whole(scrub::js_round(value)), scrub::props(props, spec));
  }

  /// Sends what is queued, waiting at most `wait` — the app is quitting.
  pub async fn shutdown(&self, wait: Duration) {
    if let Some(client) = &self.client {
      let _ = tokio::time::timeout(wait, client.shutdown()).await;
    }
  }

  /// A report of the route handlers (lib/telemetry.ts send()), held to the
  /// same rules as the shell's own: the Electron shell's telemetry.cjs relayServerLine.
  pub fn relay(&self, store: &dyn Store, msg: &Value) {
    let Some(m) = msg.as_object() else { return };
    let name = m.get("name").and_then(Value::as_str);
    match m.get("t").and_then(Value::as_str) {
      Some("error") => {
        let raw = json!({ "name": m.get("name"), "message": m.get("message"), "stack": m.get("stack") });
        let mut place = Map::new();
        place.insert("source".into(), "server".into());
        if let Some(props) = m.get("props").and_then(Value::as_object) {
          place.extend(props.clone());
        }
        self.error(&raw, &Value::Object(place));
      }
      Some("event") => {
        if let Some(name) = name {
          self.event(store, name, m.get("props").unwrap_or(&Value::Null));
        }
      }
      Some("metric") => {
        if let (Some(name), Some(value)) = (name, m.get("value").and_then(Value::as_f64)) {
          self.metric(store, name, value, m.get("props").unwrap_or(&Value::Null));
        }
      }
      _ => {}
    }
  }
}

// ---------------------------------------------------------------------------
// The client: the Electron shell's telemetry-sdk.mjs's queue and batches

const FLUSH_EVERY: Duration = Duration::from_secs(5);
const MAX_BATCH: usize = 100;
const MAX_QUEUE: usize = 2000;

pub struct ClientOptions {
  pub endpoint: String,
  pub key: String,
  pub release: String,
  pub environment: &'static str,
  pub client: &'static str,
  pub os: &'static str,
  pub os_version: String,
  pub device: &'static str,
}

/// Reports are queued and sent in batches. A failed send is retried with
/// backoff; the queue is bounded, so a dead endpoint can never exhaust memory.
pub struct Client {
  url: String,
  key: String,
  context: Value,
  user_id: Mutex<Option<String>>,
  queue: Mutex<VecDeque<Value>>,
  /// One flush at a time; a second caller waits for it.
  sending: tokio::sync::Mutex<()>,
  backoff_until: Mutex<Option<Instant>>,
  failures: AtomicU32,
  closed: AtomicBool,
  http: reqwest::Client,
}

fn now_ms() -> u64 {
  SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// The SDK's events URL: the endpoint as given if it already is one, else /v1/events on it.
fn events_url(endpoint: &str) -> String {
  let trimmed = endpoint.trim_end_matches('/');
  if trimmed.ends_with("/v1/events") { endpoint.to_string() } else { format!("{trimmed}/v1/events") }
}

impl Client {
  /// Starts its five-second flush on Tauri's runtime.
  pub fn start(o: ClientOptions) -> Arc<Client> {
    let client = Arc::new(Client {
      url: events_url(&o.endpoint),
      key: o.key,
      // What the SDK in the Electron shell's Node process sent: Node's own
      // context with the client, the version and the device put in its place.
      context: json!({
        "client": o.client,
        "clientVersion": o.release,
        "os": o.os,
        "device": o.device,
        "release": o.release,
        "environment": o.environment,
        "sessionId": uuid::Uuid::new_v4().to_string(),
        "osVersion": o.os_version,
      }),
      user_id: Mutex::new(None),
      queue: Mutex::new(VecDeque::new()),
      sending: tokio::sync::Mutex::new(()),
      backoff_until: Mutex::new(None),
      failures: AtomicU32::new(0),
      closed: AtomicBool::new(false),
      http: reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30))
        .user_agent(concat!("Girovo/", env!("CARGO_PKG_VERSION")))
        .build()
        .unwrap_or_default(),
    });
    let ticking = Arc::downgrade(&client);
    tauri::async_runtime::spawn(async move {
      loop {
        tokio::time::sleep(FLUSH_EVERY).await;
        let Some(c) = ticking.upgrade() else { break };
        if c.closed.load(Ordering::SeqCst) {
          break;
        }
        c.flush().await;
      }
    });
    client
  }

  fn enqueue(self: &Arc<Self>, mut event: Map<String, Value>) {
    if self.closed.load(Ordering::SeqCst) {
      return;
    }
    event.insert("timestamp".into(), now_ms().into());
    if let Some(id) = self.user_id.lock().unwrap().clone() {
      event.entry("userId").or_insert(id.into());
    }
    let full = {
      let mut q = self.queue.lock().unwrap();
      q.push_back(Value::Object(event));
      while q.len() > MAX_QUEUE {
        q.pop_front();
      }
      q.len() >= MAX_BATCH
    };
    if full {
      let me = Arc::clone(self);
      tauri::async_runtime::spawn(async move { me.flush().await });
    }
  }

  /// One batch to the server. Err(retry after) for an answer worth retrying
  /// (429, 5xx, no answer at all); a batch the server refuses otherwise is dropped.
  async fn send(&self, batch: &[Value]) -> Result<(), Duration> {
    let body = json!({ "context": self.context, "events": batch });
    let res = self
      .http
      .post(&self.url)
      .header("Content-Type", "application/json")
      .header("Authorization", format!("Bearer {}", self.key))
      .body(body.to_string())
      .send()
      .await
      .map_err(|_| Duration::ZERO)?;
    let status = res.status().as_u16();
    if status == 429 || status >= 500 {
      let retry = res.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|v| v.trim().parse::<f64>().ok());
      return Err(retry.filter(|s| s.is_finite() && *s > 0.0).map(Duration::from_secs_f64).unwrap_or(Duration::ZERO));
    }
    if !res.status().is_success() {
      // A 4xx other than 429 won't succeed on retry.
      eprintln!("[telemetry] batch rejected ({status}) {}", res.text().await.unwrap_or_default());
    }
    Ok(())
  }

  /// Sends everything queued; returns once the queue is drained or a send failed.
  pub async fn flush(&self) {
    self.flush_now(false).await
  }

  async fn flush_now(&self, ignore_backoff: bool) {
    let _one = self.sending.lock().await;
    if !ignore_backoff && self.backoff_until.lock().unwrap().is_some_and(|t| Instant::now() < t) {
      return;
    }
    loop {
      let batch: Vec<Value> = {
        let mut q = self.queue.lock().unwrap();
        let n = q.len().min(MAX_BATCH);
        q.drain(..n).collect()
      };
      if batch.is_empty() {
        return;
      }
      match self.send(&batch).await {
        Ok(()) => self.failures.store(0, Ordering::SeqCst),
        Err(retry_after) => {
          // Back at the front, the newest MAX_QUEUE kept.
          let mut q = self.queue.lock().unwrap();
          for e in batch.into_iter().rev() {
            q.push_front(e);
          }
          while q.len() > MAX_QUEUE {
            q.pop_front();
          }
          let failures = self.failures.fetch_add(1, Ordering::SeqCst) + 1;
          let backoff = Duration::from_millis((1000u64 << failures.min(6)).min(60_000));
          *self.backoff_until.lock().unwrap() = Some(Instant::now() + retry_after.max(backoff));
          return;
        }
      }
    }
  }
}

/// The client as the hub sees it.
struct Shared(Arc<Client>);

impl Sdk for Shared {
  fn identify(&self, id: Option<String>) {
    *self.0.user_id.lock().unwrap() = id;
  }
  fn capture_error(&self, e: &Scrubbed, props: Map<String, Value>) {
    let mut event = Map::new();
    event.insert("type".into(), "error".into());
    event.insert("name".into(), e.name.clone().into());
    event.insert("message".into(), e.message.clone().into());
    event.insert("stack".into(), e.stack.clone().into());
    event.insert("properties".into(), Value::Object(props));
    self.0.enqueue(event);
  }
  fn track(&self, name: &str, props: Map<String, Value>) {
    let mut event = Map::new();
    event.insert("type".into(), "event".into());
    event.insert("name".into(), name.into());
    event.insert("properties".into(), Value::Object(props));
    self.0.enqueue(event);
  }
  fn metric(&self, name: &str, value: Value, props: Map<String, Value>) {
    let mut event = Map::new();
    event.insert("type".into(), "metric".into());
    event.insert("name".into(), name.into());
    event.insert("value".into(), value);
    event.insert("properties".into(), Value::Object(props));
    self.0.enqueue(event);
  }
  fn shutdown(&self) -> BoxFuture<'_> {
    Box::pin(async move {
      *self.0.backoff_until.lock().unwrap() = None;
      self.0.flush_now(true).await;
      self.0.closed.store(true, Ordering::SeqCst);
    })
  }
}

// ---------------------------------------------------------------------------
// The shell's telemetry: managed state, its commands, its own reports

/// The hub, managed state: without a client until start() (and for good in a
/// debug build, or one without config.json's telemetry block).
pub struct Telemetry {
  hub: RwLock<Hub>,
  started: Instant,
  shown: AtomicBool,
  closed: AtomicBool,
}

fn random_id() -> String {
  uuid::Uuid::new_v4().to_string()
}

/// No reports, no store needed: the hub before start().
struct Nothing;
impl Store for Nothing {
  fn get(&self, _: &str) -> Option<String> {
    None
  }
  fn set(&self, _: &str, _: &str) {}
  fn del(&self, _: &str) {}
}

impl Default for Telemetry {
  fn default() -> Self {
    Telemetry {
      hub: RwLock::new(Hub::new(None, &Nothing, random_id)),
      started: Instant::now(),
      shown: AtomicBool::new(false),
      closed: AtomicBool::new(false),
    }
  }
}

/// config.json's telemetry block, built in.
fn config() -> Option<(String, String)> {
  let config: Value = serde_json::from_str(include_str!("../../config.json")).ok()?;
  let t = config.get("telemetry")?;
  Some((t.get("endpoint")?.as_str()?.to_string(), t.get("key")?.as_str()?.to_string()))
}

/// The system's version, as Node's os.release() gives it: "10.0.26100" on Windows, the kernel's on Linux.
fn os_version() -> String {
  #[cfg(windows)]
  {
    let v = windows_version::OsVersion::current();
    format!("{}.{}.{}", v.major, v.minor, v.build)
  }
  #[cfg(not(windows))]
  {
    std::fs::read_to_string("/proc/sys/kernel/osrelease").map(|s| s.trim().to_string()).unwrap_or_default()
  }
}

/// How this copy was installed (update-logic.cjs installKind): Tauri's NSIS
/// installer leaves its uninstaller beside the program.
fn install_kind() -> &'static str {
  if cfg!(debug_assertions) {
    return "dev";
  }
  let beside = std::env::current_exe().ok().and_then(|exe| exe.parent().map(|d| d.join("uninstall.exe")));
  if cfg!(windows) && beside.is_some_and(|f| f.is_file()) { "nsis" } else { "manual" }
}

impl Telemetry {
  fn hub(&self) -> std::sync::RwLockReadGuard<'_, Hub> {
    self.hub.read().unwrap_or_else(|e| e.into_inner())
  }

  /// Sets the client up, if this build reports, and says the app started.
  pub fn start(&self, app: &tauri::AppHandle) {
    let enabled = !cfg!(debug_assertions) || std::env::var("GIROVO_TELEMETRY").as_deref() == Ok("1");
    let Some((mut endpoint, key)) = config().filter(|_| enabled) else { return };
    // A debug build can be pointed at a local stand-in for the server, to see what would go out.
    if cfg!(debug_assertions) {
      if let Ok(local) = std::env::var("GIROVO_TELEMETRY_ENDPOINT") {
        endpoint = local;
      }
    }
    let version = app.package_info().version.to_string();
    let production = !cfg!(debug_assertions) && !version.contains('-');
    let client = Client::start(ClientOptions {
      endpoint,
      key,
      release: version,
      environment: if production { "production" } else { "development" },
      client: "Girovo",
      os: if cfg!(windows) { "Windows" } else if cfg!(target_os = "macos") { "macOS" } else { "Linux" },
      os_version: os_version(),
      device: "desktop",
    });
    let prefs = app.state::<Prefs>();
    let hub = Hub::new(Some(Arc::new(Shared(client))), &*prefs, random_id);
    hub.event(&*prefs, "app_started", &json!({ "installKind": install_kind(), "locale": sys_locale::get_locale() }));
    *self.hub.write().unwrap_or_else(|e| e.into_inner()) = hub;
    install_panic_hook(app.clone());
  }

  pub fn error(&self, raw: &Value, place: Value) {
    self.hub().error(raw, &place);
  }

  /// A usage event of the shell's own (the updater's, updater/report.rs): held to the user's yes like the page's.
  pub fn event(&self, prefs: &Prefs, name: &str, props: &Value) {
    self.hub().event(prefs, name, props);
  }

  /// Whether reports go out yet: false before start() and in a build that does not report.
  pub fn ready(&self) -> bool {
    self.hub().sends()
  }

  /// The app is ending (RunEvent::Exit, on the main thread): how long it ran,
  /// then what is queued goes out, a second and a half at most — once.
  pub fn closing(&self, app: &tauri::AppHandle) {
    if self.closed.swap(true, Ordering::SeqCst) {
      return;
    }
    let prefs = app.state::<Prefs>();
    let minutes = self.started.elapsed().as_secs_f64() / 60.0;
    self.hub().event(&*prefs, "app_closed", &json!({ "minutes": minutes }));
    let hub = self.hub();
    tauri::async_runtime::block_on(hub.shutdown(Duration::from_millis(1500)));
  }
}

/// A panic in the shell: reported as the Electron shell reported its uncaught
/// exceptions, and given its chance to go out before the process ends.
fn install_panic_hook(app: tauri::AppHandle) {
  let previous = std::panic::take_hook();
  std::panic::set_hook(Box::new(move |info| {
    let message = info
      .payload()
      .downcast_ref::<&str>()
      .map(|s| s.to_string())
      .or_else(|| info.payload().downcast_ref::<String>().cloned())
      .unwrap_or_default();
    let place = info.location().map(|l| format!("    at {}:{}:{}", l.file(), l.line(), l.column())).unwrap_or_default();
    if let Some(t) = app.try_state::<Telemetry>() {
      t.error(&json!({ "name": "Panic", "message": message, "stack": place }), json!({ "source": "main", "fatal": true }));
      // Sent from a thread of its own: this one may be the runtime's, and must not block it.
      let app = app.clone();
      let (tx, rx) = std::sync::mpsc::channel();
      std::thread::spawn(move || {
        if let Some(t) = app.try_state::<Telemetry>() {
          let hub = t.hub();
          tauri::async_runtime::block_on(hub.shutdown(Duration::from_millis(1500)));
        }
        let _ = tx.send(());
      });
      let _ = rx.recv_timeout(Duration::from_millis(1600));
    }
    previous(info);
  }));
}

/// The window is drawn: how long the start took (the Electron shell measured it at ready-to-show).
#[tauri::command]
pub fn telemetry_shown(app: tauri::AppHandle, state: tauri::State<'_, Telemetry>) {
  if state.shown.swap(true, Ordering::SeqCst) {
    return;
  }
  let updated = std::env::args().any(|a| a == "--updated");
  let ms = state.started.elapsed().as_secs_f64() * 1000.0;
  state.hub().metric(&*app.state::<Prefs>(), "app.start_ms", ms, &json!({ "updated": updated }));
}

/// The user's yes or no; answers the consent as it is now.
#[tauri::command]
pub fn telemetry_set_consent(prefs: tauri::State<'_, Prefs>, state: tauri::State<'_, Telemetry>, on: bool) -> &'static str {
  state.hub().set_consent(&*prefs, on)
}

#[tauri::command]
pub fn telemetry_event(prefs: tauri::State<'_, Prefs>, state: tauri::State<'_, Telemetry>, name: String, props: Value) {
  state.hub().event(&*prefs, &name, &props);
}

#[tauri::command]
pub fn telemetry_error(state: tauri::State<'_, Telemetry>, err: Value) {
  state.error(&err, json!({ "source": "renderer" }));
}

/// A report of the route handlers in the page (desktop/server/telemetry.ts).
#[tauri::command]
pub fn telemetry_relay(prefs: tauri::State<'_, Prefs>, state: tauri::State<'_, Telemetry>, message: Value) {
  state.hub().relay(&*prefs, &message);
}

/// The preference keys that are the hub's alone: a yes, a no and the install
/// id change together through set_consent, never one of them through the
/// page's store (the Electron shell's main.cjs pageKey).
pub fn hub_key(key: &str) -> bool {
  key == CONSENT_PREF || key.starts_with("fints.telemetry.")
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::cell::RefCell;
  use std::collections::HashMap;

  /// A stand-in for the client that records every call.
  #[derive(Default)]
  struct Recorder(Mutex<Vec<Value>>, Mutex<bool>);

  impl Sdk for Recorder {
    fn identify(&self, id: Option<String>) {
      self.0.lock().unwrap().push(json!(["identify", id]));
    }
    fn capture_error(&self, e: &Scrubbed, props: Map<String, Value>) {
      self.0.lock().unwrap().push(json!(["error", e.name, e.message, props]));
    }
    fn track(&self, name: &str, props: Map<String, Value>) {
      self.0.lock().unwrap().push(json!(["track", name, props]));
    }
    fn metric(&self, name: &str, value: Value, props: Map<String, Value>) {
      self.0.lock().unwrap().push(json!(["metric", name, value, props]));
    }
    fn shutdown(&self) -> BoxFuture<'_> {
      // Never done, when the test says so.
      let hang = *self.1.lock().unwrap();
      Box::pin(async move {
        if hang {
          std::future::pending::<()>().await;
        }
      })
    }
  }

  #[derive(Default)]
  struct MapStore(RefCell<HashMap<String, String>>);

  impl Store for MapStore {
    fn get(&self, key: &str) -> Option<String> {
      self.0.borrow().get(key).cloned()
    }
    fn set(&self, key: &str, value: &str) {
      self.0.borrow_mut().insert(key.into(), value.into());
    }
    fn del(&self, key: &str) {
      self.0.borrow_mut().remove(key);
    }
  }

  thread_local!(static NEXT: RefCell<u32> = const { RefCell::new(0) });
  fn counted_id() -> String {
    NEXT.with(|n| {
      *n.borrow_mut() += 1;
      format!("id-{}", n.borrow())
    })
  }

  fn setup(initial: &[(&str, &str)]) -> (Hub, Arc<Recorder>, MapStore) {
    NEXT.with(|n| *n.borrow_mut() = 0);
    let store = MapStore::default();
    for (k, v) in initial {
      store.set(k, v);
    }
    let client = Arc::new(Recorder::default());
    let hub = Hub::new(Some(client.clone() as Arc<dyn Sdk>), &store, counted_id);
    (hub, client, store)
  }

  fn calls(c: &Recorder) -> Vec<Value> {
    c.0.lock().unwrap().clone()
  }

  fn not_identify(c: &Recorder) -> Vec<Value> {
    calls(c).into_iter().filter(|v| v[0] != "identify").collect()
  }

  #[test]
  fn errors_go_out_without_consent_scrubbed_without_an_install_id() {
    let (hub, client, store) = setup(&[]);
    assert_eq!(hub.consent(&store), "unasked");
    hub.error(
      &json!({ "name": "TypeError", "message": "Empfänger: Max Mustermann" }),
      &json!({ "source": "route", "route": "/api/transfer", "blz": "37040044", "note": "x" }),
    );
    assert_eq!(
      calls(&client),
      vec![json!(["identify", null]), json!(["error", "TypeError", "Empfänger: […]", { "source": "route", "route": "/api/transfer", "blz": "37040044" }])]
    );
    assert_eq!(store.get(ID_PREF), None, "nothing stored for an error report");
  }

  #[test]
  fn usage_waits_for_the_yes() {
    let (hub, client, store) = setup(&[]);
    hub.event(&store, "screen_viewed", &json!({ "screen": "umsaetze" }));
    hub.metric(&store, "bank.request_ms", 120.0, &json!({ "blz": "37040044", "ok": true }));
    assert!(not_identify(&client).is_empty());

    let (off, off_client, off_store) = setup(&[(CONSENT_PREF, "off")]);
    off.event(&off_store, "screen_viewed", &json!({ "screen": "umsaetze" }));
    assert!(not_identify(&off_client).is_empty());
  }

  #[test]
  fn with_the_yes_an_install_id_declared_events_and_fields_only() {
    let (hub, client, store) = setup(&[]);
    hub.set_consent(&store, true);
    assert_eq!(store.get(CONSENT_PREF).as_deref(), Some("on"));
    assert_eq!(store.get(ID_PREF).as_deref(), Some("id-1"));
    hub.event(&store, "login_result", &json!({ "blz": "37040044", "outcome": "ok", "ms": 812.4, "userId": "erika", "iban": "DE89…" }));
    hub.event(&store, "made_up_event", &json!({ "a": 1 }));
    hub.metric(&store, "bank.request_ms", 99.6, &json!({ "blz": "37040044", "ok": true, "path": "/x" }));
    hub.metric(&store, "bank.request_ms", f64::NAN, &json!({}));
    assert_eq!(
      calls(&client)[1..].to_vec(),
      vec![
        json!(["identify", "id-1"]),
        json!(["track", "login_result", { "blz": "37040044", "outcome": "ok", "ms": 812 }]),
        json!(["metric", "bank.request_ms", 100, { "blz": "37040044", "ok": true }]),
      ]
    );
  }

  #[test]
  fn switching_usage_off_deletes_the_install_id() {
    let (hub, client, store) = setup(&[(CONSENT_PREF, "on"), (ID_PREF, "kept-id")]);
    assert_eq!(calls(&client)[0], json!(["identify", "kept-id"]));
    hub.set_consent(&store, false);
    assert_eq!(store.get(CONSENT_PREF).as_deref(), Some("off"));
    assert_eq!(store.get(ID_PREF), None);
    assert_eq!(calls(&client).last().unwrap(), &json!(["identify", null]));
    // Back on: a new id, not the old one.
    hub.set_consent(&store, true);
    assert_eq!(store.get(ID_PREF).as_deref(), Some("id-1"));
  }

  #[test]
  fn without_a_client_nothing_happens() {
    let store = MapStore::default();
    let hub = Hub::new(None, &store, counted_id);
    hub.error(&json!({ "message": "x" }), &json!({}));
    hub.event(&store, "screen_viewed", &json!({ "screen": "a" }));
    assert_eq!(hub.consent(&store), "unasked");
    assert!(store.0.borrow().is_empty());
  }

  #[tokio::test]
  async fn shutdown_does_not_wait_longer_than_allowed() {
    let (hub, client, _store) = setup(&[]);
    *client.1.lock().unwrap() = true;
    let started = Instant::now();
    hub.shutdown(Duration::from_millis(50)).await;
    assert!(started.elapsed() < Duration::from_secs(1));
  }

  #[test]
  fn relay_the_server_is_held_to_the_same_rules() {
    let (hub, client, store) = setup(&[]);
    hub.relay(&store, &json!({ "t": "error", "name": "Error", "message": "Konto 0532013000", "props": { "route": "/api/balance", "blz": "37040044", "fatal": true } }));
    hub.relay(&store, &json!({ "t": "event", "name": "login_result", "props": { "outcome": "ok" } }));
    hub.relay(&store, &json!("{not json"));
    hub.relay(&store, &json!({ "t": "metric", "name": "bank.request_ms", "value": "12" }));
    assert_eq!(
      calls(&client)[1..].to_vec(),
      vec![json!(["error", "Error", "Konto [Zahl]", { "source": "server", "route": "/api/balance", "blz": "37040044", "fatal": true }])]
    );
    // A route's report keeps its own source.
    hub.relay(&store, &json!({ "t": "error", "message": "x", "props": { "source": "route", "route": "/api/tx" } }));
    assert_eq!(calls(&client).last().unwrap(), &json!(["error", "Error", "x", { "source": "route", "route": "/api/tx" }]));
    // A failed connection says how, by its code; anything that is no code stays behind.
    hub.relay(&store, &json!({ "t": "error", "name": "TypeError", "message": "fetch failed", "props": { "source": "route", "route": "/api/transactions", "kind": "unavailable", "code": "ETIMEDOUT" } }));
    assert_eq!(calls(&client).last().unwrap(), &json!(["error", "TypeError", "fetch failed", { "source": "route", "route": "/api/transactions", "kind": "unavailable", "code": "ETIMEDOUT" }]));
    hub.relay(&store, &json!({ "t": "error", "message": "x", "props": { "source": "route", "kind": "unavailable", "code": "connect to bank.example failed" } }));
    assert_eq!(calls(&client).last().unwrap(), &json!(["error", "Error", "x", { "source": "route", "kind": "unavailable" }]));
  }

  #[test]
  fn the_page_never_touches_the_hubs_keys() {
    assert!(hub_key("fints.telemetry"));
    assert!(hub_key("fints.telemetry.id"));
    assert!(!hub_key("fints.telemetryx"));
    assert!(!hub_key("fints.theme"));
  }

  #[test]
  fn the_events_url_is_the_sdks() {
    assert_eq!(events_url("https://telemetry.example"), "https://telemetry.example/v1/events");
    assert_eq!(events_url("https://telemetry.example/"), "https://telemetry.example/v1/events");
    assert_eq!(events_url("https://telemetry.example/v1/events"), "https://telemetry.example/v1/events");
  }
}
