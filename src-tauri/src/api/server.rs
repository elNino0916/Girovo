// The Girovo API's server: accepts connections, identifies each client once,
// reads its JSON-RPC lines and hands every request to a Router (the page, in
// the app), then writes the page's answer back, and whatever the page sends a
// client on its own (notify, for events.subscribe). It knows nothing of
// Tauri, so the tests drive it with a stand-in for the window.
//
// It runs on a thread of its own with a small runtime, started and stopped
// with the API's switch: off, there is no thread, no pipe and no socket.

use std::collections::HashMap;
use std::io;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, mpsc as std_mpsc};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::{Notify, mpsc, oneshot, watch};
use tokio::task::JoinSet;

use super::identify::Client;
use super::rpc::{self, LineError, Message, Reply, WireError};
use super::transport;

#[derive(Debug, Clone)]
pub struct Limits {
  pub max_message: usize,
  pub max_connections: usize,
  /// How long the page may take to answer: long enough for a consent dialog
  /// the user reads, then `timeout`.
  pub call_timeout: Duration,
  pub per_second: f64,
  pub burst: f64,
  /// Calls one connection may have waiting for the page at once.
  pub max_pending: usize,
  /// Lines one connection may have waiting to be written, and their bytes: a
  /// client that stops reading must not fill Girovo's memory with what the
  /// page sends it, so past either its connection is dropped.
  pub max_queued: usize,
  pub max_queued_bytes: usize,
}

impl Default for Limits {
  fn default() -> Limits {
    Limits {
      max_message: rpc::MAX_MESSAGE,
      max_connections: 16,
      call_timeout: Duration::from_secs(150),
      per_second: 20.0,
      burst: 40.0,
      max_pending: 32,
      max_queued: 256,
      max_queued_bytes: 8 * rpc::MAX_MESSAGE,
    }
  }
}

/// One request on its way to the page: the `api:call` event's payload.
#[derive(Debug, Clone, Serialize)]
pub struct Call {
  pub id: String,
  pub connection: String,
  pub client: Client,
  pub method: String,
  pub params: Value,
}

/// Who answers the calls. In the app, the main window's page (mod.rs).
pub trait Router: Send + Sync + 'static {
  /// Hands a call on; false when nobody is there to answer it, and the client hears `locked`.
  fn call(&self, call: &Call) -> bool;
  /// A connection that had been identified has ended.
  fn closed(&self, connection: &str);
}

/// Finds out who a process is (identify::client in the app).
pub type Identify = fn(u32) -> Option<Client>;

struct Pending {
  connection: String,
  answer: oneshot::Sender<Reply>,
}

/// A connection's way out: the queue its one writer reads, the bytes waiting
/// in it, and the switch that ends the connection.
#[derive(Clone)]
struct Outbox {
  lines: mpsc::Sender<Vec<u8>>,
  queued: Arc<AtomicUsize>,
  end: Arc<Notify>,
  /// Who is on the other end, for the log line when it is dropped.
  who: String,
}

impl Outbox {
  /// A line from the connection itself (an answer, an error): it waits for
  /// room, which holds up only this connection.
  async fn send(&self, line: Vec<u8>) {
    let len = line.len();
    self.queued.fetch_add(len, Ordering::SeqCst);
    if self.lines.send(line).await.is_err() {
      self.queued.fetch_sub(len, Ordering::SeqCst);
    }
  }
}

/// Why a notification did not go out.
#[derive(Debug, PartialEq)]
pub enum NotSent {
  /// No such connection, or it is ending.
  Gone,
  /// Its queue was full: the connection is dropped.
  Overflow,
  /// Not a line the wire may carry (too large, a bad method, params that are no object or array).
  Refused,
}

struct Shared {
  router: Arc<dyn Router>,
  limits: Limits,
  identify: Identify,
  pending: Mutex<HashMap<String, Pending>>,
  outboxes: Mutex<HashMap<String, Outbox>>,
  connections: AtomicUsize,
}

pub struct Server {
  shared: Arc<Shared>,
  address: String,
  stop: watch::Sender<bool>,
  thread: Option<JoinHandle<()>>,
}

impl Server {
  /// Listens at `address`; the error when the pipe or socket can't be made.
  pub fn start(address: &str, router: Arc<dyn Router>, limits: Limits, identify: Identify) -> io::Result<Server> {
    let shared = Arc::new(Shared {
      router,
      limits,
      identify,
      pending: Mutex::new(HashMap::new()),
      outboxes: Mutex::new(HashMap::new()),
      connections: AtomicUsize::new(0),
    });
    let (stop, stopped) = watch::channel(false);
    let (ready_tx, ready) = std_mpsc::channel::<io::Result<()>>();
    let thread = {
      let shared = shared.clone();
      let address = address.to_string();
      std::thread::Builder::new().name("girovo-api".into()).spawn(move || {
        let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
          Ok(rt) => rt,
          Err(e) => {
            let _ = ready_tx.send(Err(e));
            return;
          }
        };
        runtime.block_on(serve(shared, address, stopped, ready_tx));
        // Connections still open end with the runtime; an identification
        // still hashing a file is not waited for long.
        runtime.shutdown_timeout(Duration::from_secs(1));
      })?
    };
    match ready.recv() {
      Ok(Ok(())) => Ok(Server { shared, address: address.to_string(), stop, thread: Some(thread) }),
      Ok(Err(e)) => {
        let _ = thread.join();
        Err(e)
      }
      Err(_) => {
        let _ = thread.join();
        Err(io::Error::other("the API's thread ended at its start"))
      }
    }
  }

  pub fn address(&self) -> &str {
    &self.address
  }

  pub fn connections(&self) -> usize {
    self.shared.connections.load(Ordering::Relaxed)
  }

  /// The page's answer to call `id`; false when nobody waits for it any more
  /// (answered already, timed out, or its connection gone).
  pub fn reply(&self, id: &str, reply: Reply) -> bool {
    let pending = self.shared.pending.lock().unwrap().remove(id);
    match pending {
      Some(p) => p.answer.send(reply).is_ok(),
      None => false,
    }
  }

  /// A JSON-RPC notification to one connection, queued for its writer; the
  /// caller never waits on a client. A client that leaves its queue full is
  /// dropped, so one that stops reading costs nobody else anything.
  pub fn notify(&self, connection: &str, method: &str, params: Value) -> Result<(), NotSent> {
    if !rpc::method_fits(method) || !matches!(params, Value::Null | Value::Object(_) | Value::Array(_)) {
      eprintln!("[api] notification {method:?} not sent: JSON-RPC wants a method name and params as an object or an array");
      return Err(NotSent::Refused);
    }
    let line = rpc::notification_line(method, params);
    // The same cap as for what a client sends, newline aside.
    if line.len() - 1 > self.shared.limits.max_message {
      eprintln!("[api] notification {method} not sent: {} bytes, more than a message may have", line.len() - 1);
      return Err(NotSent::Refused);
    }
    let mut outboxes = self.shared.outboxes.lock().unwrap();
    let Some(outbox) = outboxes.get(connection) else { return Err(NotSent::Gone) };
    let len = line.len();
    let before = outbox.queued.fetch_add(len, Ordering::SeqCst);
    let sent = if before + len > self.shared.limits.max_queued_bytes { None } else { Some(outbox.lines.try_send(line)) };
    match sent {
      Some(Ok(())) => Ok(()),
      Some(Err(mpsc::error::TrySendError::Closed(_))) => {
        outbox.queued.fetch_sub(len, Ordering::SeqCst);
        Err(NotSent::Gone)
      }
      None | Some(Err(mpsc::error::TrySendError::Full(_))) => {
        outbox.queued.fetch_sub(len, Ordering::SeqCst);
        // Out of the list at once, so nothing more is queued for it while it ends.
        let outbox = outboxes.remove(connection).expect("looked up above");
        drop(outboxes);
        eprintln!("[api] {} does not read what Girovo sends it: connection dropped", outbox.who);
        outbox.end.notify_one();
        Err(NotSent::Overflow)
      }
    }
  }

  /// Every connection ends, the pipe or socket goes.
  pub fn stop(mut self) {
    self.halt();
  }

  fn halt(&mut self) {
    let _ = self.stop.send(true);
    if let Some(thread) = self.thread.take() {
      let _ = thread.join();
    }
    self.shared.pending.lock().unwrap().clear();
  }
}

impl Drop for Server {
  fn drop(&mut self) {
    self.halt();
  }
}

async fn serve(shared: Arc<Shared>, address: String, mut stopped: watch::Receiver<bool>, ready: std_mpsc::Sender<io::Result<()>>) {
  let mut listener = match transport::Listener::bind(&address) {
    Ok(l) => {
      let _ = ready.send(Ok(()));
      l
    }
    Err(e) => {
      let _ = ready.send(Err(e));
      return;
    }
  };
  loop {
    tokio::select! {
      _ = stopped.changed() => break,
      accepted = listener.accept() => match accepted {
        Ok((stream, pid)) => {
          tokio::spawn(connection(shared.clone(), stream, pid, stopped.clone()));
        }
        Err(e) => {
          eprintln!("[api] accept: {e}");
          // A pipe or socket that keeps failing must not spin a core.
          tokio::time::sleep(Duration::from_millis(100)).await;
        }
      },
    }
  }
}

/// Counts a connection while it lives.
struct Counted(Arc<Shared>);

impl Drop for Counted {
  fn drop(&mut self) {
    self.0.connections.fetch_sub(1, Ordering::Relaxed);
  }
}

/// At the end of an identified connection: its calls nobody will read the
/// answer to are dropped, and the page hears that it ended.
struct Announced {
  shared: Arc<Shared>,
  id: String,
}

impl Drop for Announced {
  fn drop(&mut self) {
    // First, so a notification after the page heard of the end finds nobody.
    self.shared.outboxes.lock().unwrap().remove(&self.id);
    self.shared.pending.lock().unwrap().retain(|_, p| p.connection != self.id);
    self.shared.router.closed(&self.id);
  }
}

async fn connection<S>(shared: Arc<Shared>, stream: S, pid: Option<u32>, mut stopped: watch::Receiver<bool>)
where
  S: AsyncRead + AsyncWrite + Send + 'static,
{
  let count = shared.connections.fetch_add(1, Ordering::Relaxed) + 1;
  let _counted = Counted(shared.clone());
  let (read, mut write) = tokio::io::split(stream);

  // Turned away before anything else: one line, then the end.
  let refuse = |reason: &str, message: &str| rpc::error_line(&Value::Null, &WireError::from_reason(reason, message, None));
  if count > shared.limits.max_connections {
    let _ = write.write_all(&refuse("busy", "Too many connections")).await;
    let _ = write.shutdown().await;
    return;
  }
  let identify = shared.identify;
  let client = match pid {
    Some(pid) => tokio::task::spawn_blocking(move || identify(pid)).await.ok().flatten(),
    None => None,
  };
  let Some(client) = client else {
    let _ = write.write_all(&refuse("denied", "Girovo could not tell which program this is")).await;
    let _ = write.shutdown().await;
    return;
  };

  let id = uuid::Uuid::new_v4().to_string();
  let _announced = Announced { shared: shared.clone(), id: id.clone() };

  // One writer, so answers that finish in any order and the page's
  // notifications still go out whole, one line each.
  let (lines_tx, mut lines) = mpsc::channel::<Vec<u8>>(shared.limits.max_queued.max(1));
  let end = Arc::new(Notify::new());
  let out = Outbox { lines: lines_tx, queued: Arc::new(AtomicUsize::new(0)), end: end.clone(), who: format!("{} (process {})", client.name, client.pid) };
  shared.outboxes.lock().unwrap().insert(id.clone(), out.clone());
  let queued = out.queued.clone();
  let mut writer = tokio::spawn(async move {
    while let Some(line) = lines.recv().await {
      let written = write.write_all(&line).await.is_ok() && write.flush().await.is_ok();
      // Counted until written: a line stuck in a pipe nobody reads still takes room.
      queued.fetch_sub(line.len(), Ordering::SeqCst);
      if !written {
        break;
      }
    }
    let _ = write.shutdown().await;
  });

  let mut reader = BufReader::new(read);
  let mut calls = JoinSet::new();
  let mut bucket = rpc::Bucket::new(shared.limits.per_second, shared.limits.burst, Instant::now());
  // Dropped for not reading, the connection ends at once, even while a line
  // of its own waits for room in its full queue.
  let reading = async {
    loop {
      let line = tokio::select! {
        _ = stopped.changed() => break,
        line = rpc::read_line(&mut reader, shared.limits.max_message) => line,
      };
      let line = match line {
        Ok(Some(line)) => line,
        Ok(None) | Err(LineError::Io) => break,
        Err(LineError::TooLarge) => {
          out.send(refuse("too_large", "Message too large")).await;
          break;
        }
      };
      if line.iter().all(u8::is_ascii_whitespace) {
        continue;
      }
      let allowed = bucket.take(Instant::now());
      let (request_id, method, params) = match rpc::parse(&line) {
        Message::Request { id, method, params } => (id, method, params),
        Message::Invalid { id, error } => {
          if allowed {
            out.send(rpc::error_line(&id, &error)).await;
          }
          continue;
        }
        Message::Notification | Message::Response => continue,
      };
      if !allowed {
        out.send(rpc::error_line(&request_id, &WireError::from_reason("rate_limited", "Too many requests", None))).await;
        continue;
      }
      while calls.try_join_next().is_some() {}
      if calls.len() >= shared.limits.max_pending {
        out.send(rpc::error_line(&request_id, &WireError::from_reason("busy", "Too many requests waiting", None))).await;
        continue;
      }

      let call = Call { id: uuid::Uuid::new_v4().to_string(), connection: id.clone(), client: client.clone(), method, params };
      let (answer, answered) = oneshot::channel();
      // Waiting before the page hears of it, so even an instant answer finds its call.
      shared.pending.lock().unwrap().insert(call.id.clone(), Pending { connection: id.clone(), answer });
      if !shared.router.call(&call) {
        shared.pending.lock().unwrap().remove(&call.id);
        out.send(rpc::error_line(&request_id, &WireError::from_reason("locked", "Girovo is not ready", None))).await;
        continue;
      }
      let (shared, out, call_id, limit) = (shared.clone(), out.clone(), call.id, shared.limits.call_timeout);
      calls.spawn(async move {
        let line = match tokio::time::timeout(limit, answered).await {
          Ok(Ok(reply)) => rpc::reply_line(&request_id, reply),
          // Dropped unanswered: the server is stopping.
          Ok(Err(_)) => return,
          Err(_) => {
            shared.pending.lock().unwrap().remove(&call_id);
            rpc::error_line(&request_id, &WireError::from_reason("timeout", "Girovo did not answer in time", None))
          }
        };
        out.send(line).await;
      });
    }
  };
  let dropped = tokio::select! {
    _ = end.notified() => true,
    _ = reading => false,
  };
  // The calls still waiting have nobody to answer to; what is written goes
  // out first, unless the client stopped reading, and never for longer than
  // a second: a writer stuck on a full pipe would keep the connection open.
  drop(calls);
  drop(out);
  if !dropped {
    let _ = tokio::time::timeout(Duration::from_secs(1), &mut writer).await;
  }
  writer.abort();
}
