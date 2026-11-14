use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;

use super::identify::{self, Kind};
use super::rpc::{self, LineError, Message, PageError, Reply};
use super::server::{Call, Limits, NotSent, Router, Server};

// --- the wire ---

async fn lines_of(bytes: &[u8], max: usize, chunk: usize) -> Vec<Result<Vec<u8>, String>> {
  let mut reader = tokio::io::BufReader::with_capacity(chunk, bytes);
  let mut out = Vec::new();
  loop {
    match rpc::read_line(&mut reader, max).await {
      Ok(Some(line)) => out.push(Ok(line)),
      Ok(None) => break,
      Err(LineError::TooLarge) => {
        out.push(Err("too large".into()));
        break;
      }
      Err(LineError::Io) => {
        out.push(Err("io".into()));
        break;
      }
    }
  }
  out
}

#[tokio::test]
async fn lines_split_on_newlines_across_reads() {
  // A buffer of 3 bytes: every line arrives in pieces.
  let got = lines_of(b"{\"a\":1}\r\n\n{\"b\":2}\nunfinished", 100, 3).await;
  assert_eq!(got, vec![Ok(b"{\"a\":1}".to_vec()), Ok(Vec::new()), Ok(b"{\"b\":2}".to_vec())]);
}

#[tokio::test]
async fn a_line_over_the_cap_is_refused() {
  let exact = [vec![b'x'; 16], b"\n".to_vec()].concat();
  assert_eq!(lines_of(&exact, 16, 4).await, vec![Ok(vec![b'x'; 16])]);
  let over = [vec![b'x'; 17], b"\n".to_vec()].concat();
  assert_eq!(lines_of(&over, 16, 4).await, vec![Err("too large".to_string())]);
  // No newline at all: refused once past the cap, not read on forever.
  assert_eq!(lines_of(&vec![b'x'; 1000], 16, 8).await, vec![Err("too large".to_string())]);
}

#[test]
fn requests_notifications_and_bad_lines() {
  assert_eq!(
    rpc::parse(br#"{"jsonrpc":"2.0","id":7,"method":"girovo.hello","params":{"app":"x"}}"#),
    Message::Request { id: json!(7), method: "girovo.hello".into(), params: json!({ "app": "x" }) }
  );
  assert_eq!(
    rpc::parse(br#"{"jsonrpc":"2.0","id":"a","method":"girovo.accounts.list"}"#),
    Message::Request { id: json!("a"), method: "girovo.accounts.list".into(), params: Value::Null }
  );
  assert_eq!(rpc::parse(br#"{"jsonrpc":"2.0","method":"girovo.ping"}"#), Message::Notification);
  assert_eq!(rpc::parse(br#"{"jsonrpc":"2.0","id":1,"result":{}}"#), Message::Response);

  let code_of = |line: &[u8]| match rpc::parse(line) {
    Message::Invalid { id, error } => (id, error.code, error.data["reason"].clone()),
    other => panic!("not invalid: {other:?}"),
  };
  assert_eq!(code_of(b"{not json"), (Value::Null, rpc::PARSE_ERROR, json!("invalid")));
  assert_eq!(code_of(br#"[{"jsonrpc":"2.0","id":1,"method":"a"}]"#).1, rpc::INVALID_REQUEST);
  assert_eq!(code_of(br#"{"id":1,"method":"a"}"#), (json!(1), rpc::INVALID_REQUEST, json!("invalid")));
  assert_eq!(code_of(br#"{"jsonrpc":"2.0","id":{},"method":"a"}"#).0, Value::Null);
  assert_eq!(code_of(br#"{"jsonrpc":"2.0","id":2,"method":5}"#).1, rpc::INVALID_REQUEST);
  assert_eq!(code_of(br#"{"jsonrpc":"2.0","id":3,"method":"a","params":"x"}"#).1, rpc::INVALID_PARAMS);
  let long = format!(r#"{{"jsonrpc":"2.0","id":4,"method":"{}"}}"#, "m".repeat(200));
  assert_eq!(code_of(long.as_bytes()).1, rpc::INVALID_REQUEST);
}

#[test]
fn the_pages_codes_go_out_as_numbers_with_the_reason() {
  let line = rpc::reply_line(
    &json!(9),
    Reply::Error(PageError { code: "not_permitted".into(), message: "Nicht erlaubt".into(), data: Some(json!({ "permission": "accounts.read" })) }),
  );
  let v: Value = serde_json::from_slice(&line).unwrap();
  assert_eq!(*line.last().unwrap(), b'\n');
  assert_eq!(v["jsonrpc"], "2.0");
  assert_eq!(v["id"], 9);
  assert_eq!(v["error"]["code"], -32003);
  assert_eq!(v["error"]["message"], "Nicht erlaubt");
  assert_eq!(v["error"]["data"], json!({ "reason": "not_permitted", "permission": "accounts.read" }));

  let plain = rpc::WireError::from_reason("bank_error", "x", Some(json!("Die Bank sagt nein")));
  assert_eq!(plain.data, json!({ "reason": "bank_error", "detail": "Die Bank sagt nein" }));
  assert_eq!(rpc::number_of("something_new"), -32000);
  assert_eq!(rpc::number_of("locked"), -32001);
  assert_eq!(rpc::number_of("timeout"), -32006);

  let ok: Value = serde_json::from_slice(&rpc::reply_line(&json!("q"), Reply::from_parts(None, None))).unwrap();
  assert_eq!(ok, json!({ "jsonrpc": "2.0", "id": "q", "result": null }));
}

#[test]
fn the_bucket_allows_a_burst_then_refills() {
  let start = Instant::now();
  let mut bucket = rpc::Bucket::new(2.0, 3.0, start);
  assert!(bucket.take(start) && bucket.take(start) && bucket.take(start));
  assert!(!bucket.take(start));
  // Half a second at two per second: one more.
  let later = start + Duration::from_millis(500);
  assert!(bucket.take(later));
  assert!(!bucket.take(later));
  // A long pause refills only up to the burst.
  let much_later = later + Duration::from_secs(60);
  assert!((0..3).all(|_| bucket.take(much_later)));
  assert!(!bucket.take(much_later));
}

#[test]
fn a_png_is_well_formed() {
  let px = [255u8, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 10, 20, 30, 40];
  let png = super::icon::png(2, 2, &px).unwrap();
  assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
  assert_eq!(&png[12..16], b"IHDR");
  assert_eq!(u32::from_be_bytes(png[16..20].try_into().unwrap()), 2);
  // The pixels come back out of IDAT, each row after its filter byte.
  let idat_len = u32::from_be_bytes(png[33..37].try_into().unwrap()) as usize;
  assert_eq!(&png[37..41], b"IDAT");
  let mut raw = Vec::new();
  use std::io::Read;
  flate2::read::ZlibDecoder::new(&png[41..41 + idat_len]).read_to_end(&mut raw).unwrap();
  assert_eq!(raw, [&[0u8][..], &px[..8], &[0u8][..], &px[8..]].concat());
  assert!(png.ends_with(&[0, 0, 0, 0, b'I', b'E', b'N', b'D', 0xAE, 0x42, 0x60, 0x82]));
  assert!(super::icon::png(2, 2, &px[..12]).is_none());
}

// --- who is asking ---

#[test]
fn this_test_process_is_an_unknown_publisher() {
  let me = identify::client(std::process::id()).expect("the test process can be identified");
  let exe = std::env::current_exe().unwrap();
  assert_eq!(me.pid, std::process::id());
  assert_eq!(me.exe.to_lowercase(), exe.to_string_lossy().to_lowercase());
  assert_eq!(me.sha256, identify::sha256_of(&exe).unwrap());
  assert_eq!(me.sha256.len(), 64);
  // Cargo's test programs are unsigned and carry no version resource: the file's name.
  assert_eq!(me.publisher, identify::Publisher::unknown());
  assert_eq!(me.name, exe.file_name().unwrap().to_string_lossy());
  // Started by cargo (or a shell): a parent, itself without one.
  let parent = me.parent.as_ref().expect("a parent process");
  assert_ne!(parent.pid, me.pid);
  assert!(parent.parent.is_none());
  assert!(!parent.exe.is_empty());

  // And the same again from the cache.
  assert_eq!(identify::client(std::process::id()).unwrap().sha256, me.sha256);

  let json = serde_json::to_value(&me).unwrap();
  assert_eq!(json["publisher"], json!({ "kind": "unknown" }));
  assert!(json["parent"].get("parent").is_none());
}

#[test]
fn a_process_that_is_not_there_is_nobody() {
  // Process ids are multiples of four on Windows; this one never is.
  assert!(identify::client(u32::MAX - 2).is_none());
}

#[test]
fn a_file_put_in_place_with_the_same_size_and_time_is_hashed_anew() {
  let dir = std::env::temp_dir().join(format!("girovo-identify-{}", uuid::Uuid::new_v4()));
  std::fs::create_dir_all(&dir).unwrap();
  let path = dir.join("app.exe");
  let (granted, other) = (b"granted app, first build", b"another app, same length");
  assert_eq!(granted.len(), other.len());
  std::fs::write(&path, granted).unwrap();
  let time = std::fs::metadata(&path).unwrap().modified().unwrap();
  let first = identify::facts_of(&path, &path).unwrap();
  // Another program in its place: same path, same size, the old time.
  std::fs::write(&path, other).unwrap();
  std::fs::File::options().write(true).open(&path).unwrap().set_modified(time).unwrap();
  assert_eq!(std::fs::metadata(&path).unwrap().modified().unwrap(), time);
  let second = identify::facts_of(&path, &path).unwrap();
  assert_ne!(second.sha256, first.sha256);
  assert_eq!(second.sha256, identify::sha256_of(&path).unwrap());
  assert_eq!(second.name, "app.exe");
  #[cfg(windows)]
  {
    // While it is hashed and checked, nobody can write, rename or delete it.
    let held = identify::open_unchangeable(&path).unwrap();
    assert!(std::fs::OpenOptions::new().write(true).open(&path).is_err());
    assert!(std::fs::rename(&path, dir.join("moved.exe")).is_err());
    assert!(std::fs::remove_file(&path).is_err());
    drop(held);
  }
  let _ = std::fs::remove_dir_all(&dir);
}

#[cfg(windows)]
#[test]
fn windows_own_programs_are_verified_through_their_catalog() {
  // cmd.exe carries no signature of its own: Windows signs it in a catalog.
  let cmd = std::path::Path::new(r"C:\Windows\System32\cmd.exe");
  let (publisher, name) = super::signature::publisher_and_name(cmd);
  assert_eq!(publisher.kind, Kind::Verified, "{publisher:?}");
  assert!(publisher.name.as_deref().unwrap_or("").contains("Microsoft"), "{publisher:?}");
  assert_eq!(publisher.thumbprint.as_deref().map(str::len), Some(40));
  assert!(name.is_some_and(|n| !n.is_empty()));
}

#[cfg(windows)]
#[test]
fn mt_media_is_known_by_its_thumbprint_alone() {
  use super::signature::classify;
  const OK: i32 = 0;
  const UNTRUSTED_ROOT: i32 = 0x800B_0109_u32 as i32;
  const BAD_DIGEST: i32 = 0x8009_6010_u32 as i32;
  const REVOKED: i32 = 0x800B_010C_u32 as i32;
  const NO_SIGNATURE: i32 = 0x800B_0100_u32 as i32;
  const OFFLINE: i32 = 0x800B_010E_u32 as i32;
  let mt = Some(crate::publisher_cert::identity::THUMBPRINT);
  let other = Some([7u8; 20]);
  // Not installed on this machine: the chain ends in an untrusted root, still MT-Media.
  assert_eq!(classify(UNTRUSTED_ROOT, mt), Kind::Mtmedia);
  assert_eq!(classify(OK, mt), Kind::Mtmedia);
  // A changed file or a revoked certificate is nobody's.
  assert_eq!(classify(BAD_DIGEST, mt), Kind::Unknown);
  assert_eq!(classify(REVOKED, mt), Kind::Unknown);
  assert_eq!(classify(OK, other), Kind::Verified);
  assert_eq!(classify(OFFLINE, other), Kind::Verified);
  assert_eq!(classify(UNTRUSTED_ROOT, other), Kind::Unknown);
  assert_eq!(classify(NO_SIGNATURE, None), Kind::Unknown);
}

/// A program Girovo's release signs with MT-Media (GIROVO_SIGNED_EXE, else an
/// installed Girovo's girovo-cert.exe). Only read, never started; skipped
/// where there is none.
#[cfg(windows)]
#[test]
fn a_program_signed_by_mt_media_is_mtmedia() {
  let candidate = std::env::var_os("GIROVO_SIGNED_EXE")
    .map(std::path::PathBuf::from)
    .or_else(|| std::env::var_os("LOCALAPPDATA").map(|d| std::path::Path::new(&d).join(r"Programs\Girovo\girovo-cert.exe")));
  let Some(exe) = candidate.filter(|p| p.is_file()) else {
    eprintln!("no MT-Media-signed program here, skipped");
    return;
  };
  let (publisher, _) = super::signature::publisher_and_name(&exe);
  assert_eq!(publisher.kind, Kind::Mtmedia, "{publisher:?}");
  assert_eq!(publisher.name.as_deref(), Some("MT-Media"));
  assert_eq!(publisher.thumbprint.as_deref(), Some(crate::publisher_cert::identity::THUMBPRINT_HEX));
}

#[cfg(windows)]
#[test]
fn an_executables_icon_is_a_png_data_url() {
  let url = super::icon::data_url(r"C:\Windows\explorer.exe").expect("explorer has an icon");
  assert!(url.starts_with("data:image/png;base64,"));
  assert!(super::icon::data_url(r"C:\no\such\file.exe").is_none());
  assert!(super::icon::data_url("relative.exe").is_none());
}

// --- the server, end to end ---

/// The window's stand-in: every call goes into a channel the test reads.
struct StandIn {
  calls: mpsc::UnboundedSender<Call>,
  closed: mpsc::UnboundedSender<String>,
  /// Each change of who waits for the page: the clients' process ids, and whether one just arrived.
  waiting: mpsc::UnboundedSender<(Vec<u32>, bool)>,
  open: AtomicBool,
}

impl Router for StandIn {
  fn call(&self, call: &Call) -> bool {
    self.open.load(Ordering::SeqCst) && self.calls.send(call.clone()).is_ok()
  }
  fn closed(&self, connection: &str) {
    let _ = self.closed.send(connection.to_string());
  }
  fn waiting(&self, clients: &[identify::Client], arrived: bool) {
    let _ = self.waiting.send((clients.iter().map(|c| c.pid).collect(), arrived));
  }
}

struct Harness {
  server: Server,
  router: Arc<StandIn>,
  calls: mpsc::UnboundedReceiver<Call>,
  closed: mpsc::UnboundedReceiver<String>,
  waiting: mpsc::UnboundedReceiver<(Vec<u32>, bool)>,
  #[cfg(unix)]
  _dir: std::path::PathBuf,
}

/// A server whose page is ready, as after the login.
fn harness(limits: Limits) -> Harness {
  let h = harness_not_ready(limits);
  h.server.set_ready(true);
  h
}

/// A server whose page is not ready yet: the app's start, or logged out.
fn harness_not_ready(limits: Limits) -> Harness {
  let (calls_tx, calls) = mpsc::unbounded_channel();
  let (closed_tx, closed) = mpsc::unbounded_channel();
  let (waiting_tx, waiting) = mpsc::unbounded_channel();
  let router = Arc::new(StandIn { calls: calls_tx, closed: closed_tx, waiting: waiting_tx, open: AtomicBool::new(true) });
  #[cfg(windows)]
  let address = format!(r"\\.\pipe\girovo-api-test-{}", uuid::Uuid::new_v4());
  #[cfg(unix)]
  let dir = {
    let d = std::env::temp_dir().join(format!("girovo-api-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&d).unwrap();
    d
  };
  #[cfg(unix)]
  let address = dir.join("girovo-api.sock").to_string_lossy().into_owned();
  let server = Server::start(&address, router.clone(), limits, identify::client).expect("the server listens");
  Harness {
    server,
    router,
    calls,
    closed,
    waiting,
    #[cfg(unix)]
    _dir: dir,
  }
}

#[cfg(windows)]
type ClientStream = tokio::net::windows::named_pipe::NamedPipeClient;
#[cfg(unix)]
type ClientStream = tokio::net::UnixStream;

async fn connect(address: &str) -> BufReader<ClientStream> {
  #[cfg(windows)]
  let stream = tokio::net::windows::named_pipe::ClientOptions::new().open(address).expect("the pipe opens");
  #[cfg(unix)]
  let stream = tokio::net::UnixStream::connect(address).await.expect("the socket connects");
  BufReader::new(stream)
}

async fn send(client: &mut BufReader<ClientStream>, value: Value) {
  let mut line = serde_json::to_vec(&value).unwrap();
  line.push(b'\n');
  client.get_mut().write_all(&line).await.unwrap();
}

/// The next line from the server, or None at the end of the stream.
async fn answer(client: &mut BufReader<ClientStream>) -> Option<Value> {
  let mut line = String::new();
  let n = tokio::time::timeout(Duration::from_secs(10), client.read_line(&mut line)).await.expect("an answer in time").unwrap_or(0);
  (n > 0).then(|| serde_json::from_str(&line).expect("one JSON message per line"))
}

async fn next<T>(rx: &mut mpsc::UnboundedReceiver<T>) -> T {
  tokio::time::timeout(Duration::from_secs(10), rx.recv()).await.expect("in time").expect("open")
}

fn hello(id: u32) -> Value {
  json!({ "jsonrpc": "2.0", "id": id, "method": "girovo.hello", "params": { "app": "Test", "version": "1", "permissions": ["accounts.read"] } })
}

#[tokio::test]
async fn a_call_goes_to_the_page_and_its_answer_comes_back() {
  let mut h = harness(Limits::default());
  let mut client = connect(h.server.address()).await;
  send(&mut client, hello(1)).await;

  let call = next(&mut h.calls).await;
  assert_eq!(call.method, "girovo.hello");
  assert_eq!(call.params["app"], "Test");
  // The shell says who is asking: this very process, by its own lookup.
  assert_eq!(call.client.pid, std::process::id());
  assert_eq!(call.client.publisher.kind, Kind::Unknown);
  let event = serde_json::to_value(&call).unwrap();
  for key in ["id", "connection", "client", "method", "params"] {
    assert!(event.get(key).is_some(), "api:call carries {key}");
  }
  assert!(h.server.reply(&call.id, Reply::Result(json!({ "granted": ["accounts.read"], "girovo": "7.0.0" }))));
  // Once only.
  assert!(!h.server.reply(&call.id, Reply::Result(json!(null))));
  assert_eq!(answer(&mut client).await.unwrap(), json!({ "jsonrpc": "2.0", "id": 1, "result": { "granted": ["accounts.read"], "girovo": "7.0.0" } }));

  // An error from the page, on the same connection.
  send(&mut client, json!({ "jsonrpc": "2.0", "id": "two", "method": "girovo.accounts.list" })).await;
  let call2 = next(&mut h.calls).await;
  assert_eq!(call2.connection, call.connection);
  assert_eq!(call2.params, Value::Null);
  h.server.reply(&call2.id, Reply::Error(PageError { code: "not_permitted".into(), message: "Nicht erlaubt".into(), data: Some(json!({ "permission": "accounts.read" })) }));
  let err = answer(&mut client).await.unwrap();
  assert_eq!(err["id"], "two");
  assert_eq!(err["error"]["code"], -32003);
  assert_eq!(err["error"]["data"]["reason"], "not_permitted");

  // Bad lines get JSON-RPC's own errors, notifications nothing, and the connection stays.
  client.get_mut().write_all(b"{oops\n\n").await.unwrap();
  assert_eq!(answer(&mut client).await.unwrap()["error"]["code"], rpc::PARSE_ERROR);
  send(&mut client, json!({ "jsonrpc": "2.0", "method": "girovo.note" })).await;
  send(&mut client, hello(3)).await;
  let call3 = next(&mut h.calls).await;
  assert_eq!(call3.method, "girovo.hello");
  h.server.reply(&call3.id, Reply::Result(json!(true)));
  assert_eq!(answer(&mut client).await.unwrap()["id"], 3);
  assert_eq!(h.server.connections(), 1);
}

#[tokio::test]
async fn answers_go_out_in_the_order_the_page_gives_them() {
  let mut h = harness(Limits::default());
  let mut client = connect(h.server.address()).await;
  send(&mut client, hello(1)).await;
  send(&mut client, hello(2)).await;
  let first = next(&mut h.calls).await;
  let second = next(&mut h.calls).await;
  h.server.reply(&second.id, Reply::Result(json!("b")));
  assert_eq!(answer(&mut client).await.unwrap()["id"], 2);
  h.server.reply(&first.id, Reply::Result(json!("a")));
  assert_eq!(answer(&mut client).await.unwrap()["id"], 1);
}

#[tokio::test]
async fn a_call_nobody_answers_times_out() {
  let mut h = harness(Limits { call_timeout: Duration::from_millis(300), ..Limits::default() });
  let mut client = connect(h.server.address()).await;
  send(&mut client, hello(5)).await;
  let call = next(&mut h.calls).await;
  let err = answer(&mut client).await.unwrap();
  assert_eq!(err["id"], 5);
  assert_eq!(err["error"]["code"], -32006);
  assert_eq!(err["error"]["data"]["reason"], "timeout");
  // Too late now.
  assert!(!h.server.reply(&call.id, Reply::Result(json!(1))));
}

#[tokio::test]
async fn a_bank_refresh_may_take_longer() {
  let mut h = harness(Limits { call_timeout: Duration::from_millis(200), long_call_timeout: Duration::from_secs(5), ..Limits::default() });
  let mut client = connect(h.server.address()).await;
  send(&mut client, json!({ "jsonrpc": "2.0", "id": 6, "method": "girovo.bank.refresh", "params": {} })).await;
  let call = next(&mut h.calls).await;
  // Well past the usual limit, the Freigabe still counts.
  tokio::time::sleep(Duration::from_millis(600)).await;
  assert!(h.server.reply(&call.id, Reply::Result(json!({ "newBookings": 0 }))));
  let ok = answer(&mut client).await.unwrap();
  assert_eq!(ok["id"], 6);
  assert_eq!(ok["result"]["newBookings"], 0);
}

#[tokio::test]
async fn a_connection_that_asks_nothing_is_closed() {
  let mut h = harness(Limits { first_request_timeout: Duration::from_millis(300), ..Limits::default() });
  let mut silent = connect(h.server.address()).await;
  let err = answer(&mut silent).await.unwrap();
  assert_eq!(err["id"], Value::Null);
  assert_eq!(err["error"]["data"]["reason"], "timeout");
  assert!(answer(&mut silent).await.is_none());
  // One that asked stays open past it.
  let mut talking = connect(h.server.address()).await;
  send(&mut talking, hello(1)).await;
  let call = next(&mut h.calls).await;
  tokio::time::sleep(Duration::from_millis(600)).await;
  h.server.reply(&call.id, Reply::Result(json!({ "granted": [] })));
  assert_eq!(answer(&mut talking).await.unwrap()["id"], 1);
}

#[tokio::test]
async fn one_program_cannot_take_every_connection() {
  let mut h = harness(Limits { max_per_client: 1, ..Limits::default() });
  let (_first, _) = connected(&mut h, 1).await;
  let mut second = connect(h.server.address()).await;
  let err = answer(&mut second).await.unwrap();
  assert_eq!(err["id"], Value::Null);
  assert_eq!(err["error"]["data"]["reason"], "busy");
  assert!(answer(&mut second).await.is_none());
}

#[tokio::test]
async fn without_a_page_calls_answer_locked() {
  let mut h = harness(Limits::default());
  h.router.open.store(false, Ordering::SeqCst);
  let mut client = connect(h.server.address()).await;
  send(&mut client, hello(1)).await;
  let err = answer(&mut client).await.unwrap();
  assert_eq!(err["error"]["code"], -32001);
  assert_eq!(err["error"]["data"]["reason"], "locked");
  assert!(h.calls.try_recv().is_err());
}

#[tokio::test]
async fn the_page_hears_when_a_connection_ends() {
  let mut h = harness(Limits::default());
  let mut client = connect(h.server.address()).await;
  send(&mut client, hello(1)).await;
  let call = next(&mut h.calls).await;
  drop(client);
  assert_eq!(next(&mut h.closed).await, call.connection);
  // Its waiting call went with it.
  assert!(!h.server.reply(&call.id, Reply::Result(json!(1))));
  let deadline = Instant::now() + Duration::from_secs(5);
  while h.server.connections() != 0 && Instant::now() < deadline {
    tokio::time::sleep(Duration::from_millis(20)).await;
  }
  assert_eq!(h.server.connections(), 0);
}

// --- held until the page is ready (logged out, in the tray, the start) ---

/// Nothing more arrives on `rx` for a moment.
async fn quiet<T: std::fmt::Debug>(rx: &mut mpsc::UnboundedReceiver<T>) {
  tokio::time::sleep(Duration::from_millis(150)).await;
  assert!(rx.try_recv().is_err(), "nothing more");
}

#[tokio::test]
async fn calls_wait_for_the_login_and_reach_the_page_in_order() {
  let mut h = harness_not_ready(Limits::default());
  let me = std::process::id();
  let mut client = connect(h.server.address()).await;
  send(&mut client, hello(1)).await;
  // Girovo comes forward, and the login hears who asks.
  assert_eq!(next(&mut h.waiting).await, (vec![me], true));
  send(&mut client, json!({ "jsonrpc": "2.0", "id": 2, "method": "girovo.accounts.list" })).await;
  // Each client once, however many of its calls wait.
  assert_eq!(next(&mut h.waiting).await, (vec![me], true));
  assert_eq!(h.server.waiting().iter().map(|c| c.pid).collect::<Vec<_>>(), vec![me]);
  quiet(&mut h.calls).await;

  h.server.set_ready(true);
  let first = next(&mut h.calls).await;
  let second = next(&mut h.calls).await;
  assert_eq!((first.method.as_str(), second.method.as_str()), ("girovo.hello", "girovo.accounts.list"));
  // The notice goes.
  assert_eq!(next(&mut h.waiting).await, (vec![], false));
  assert!(h.server.waiting().is_empty());
  h.server.reply(&first.id, Reply::Result(json!("a")));
  h.server.reply(&second.id, Reply::Result(json!("b")));
  assert_eq!(answer(&mut client).await.unwrap()["result"], "a");
  assert_eq!(answer(&mut client).await.unwrap()["result"], "b");

  // Ready, calls go straight on; logged out again, they wait again.
  send(&mut client, hello(3)).await;
  assert_eq!(next(&mut h.calls).await.params["app"], "Test");
  h.server.set_ready(false);
  send(&mut client, hello(4)).await;
  assert_eq!(next(&mut h.waiting).await, (vec![me], true));
  quiet(&mut h.calls).await;
}

#[tokio::test]
async fn a_call_nobody_logs_in_for_answers_locked() {
  let mut h = harness_not_ready(Limits { hold_timeout: Duration::from_millis(300), ..Limits::default() });
  let mut client = connect(h.server.address()).await;
  send(&mut client, hello(7)).await;
  assert_eq!(next(&mut h.waiting).await.1, true);
  let err = answer(&mut client).await.unwrap();
  assert_eq!(err["id"], 7);
  assert_eq!(err["error"]["code"], -32001);
  assert_eq!(err["error"]["data"]["reason"], "locked");
  assert_eq!(next(&mut h.waiting).await, (vec![], false));
  // A login after that has nothing to hand on.
  h.server.set_ready(true);
  quiet(&mut h.calls).await;
  // The connection stays, and the next call goes through.
  send(&mut client, hello(8)).await;
  let call = next(&mut h.calls).await;
  h.server.reply(&call.id, Reply::Result(json!(true)));
  assert_eq!(answer(&mut client).await.unwrap()["id"], 8);
}

#[tokio::test]
async fn a_held_call_goes_with_its_connection() {
  let mut h = harness_not_ready(Limits::default());
  let mut client = connect(h.server.address()).await;
  send(&mut client, hello(1)).await;
  assert_eq!(next(&mut h.waiting).await.1, true);
  drop(client);
  next(&mut h.closed).await;
  assert_eq!(next(&mut h.waiting).await, (vec![], false));
  assert!(h.server.waiting().is_empty());
  h.server.set_ready(true);
  quiet(&mut h.calls).await;
}

#[tokio::test]
async fn held_calls_are_bounded() {
  let mut h = harness_not_ready(Limits { max_held: 1, ..Limits::default() });
  let mut client = connect(h.server.address()).await;
  send(&mut client, hello(1)).await;
  assert_eq!(next(&mut h.waiting).await.1, true);
  send(&mut client, hello(2)).await;
  let err = answer(&mut client).await.unwrap();
  assert_eq!((err["id"].clone(), err["error"]["data"]["reason"].clone()), (json!(2), json!("locked")));
  h.server.set_ready(true);
  assert_eq!(next(&mut h.calls).await.method, "girovo.hello");
  quiet(&mut h.calls).await;
}

#[tokio::test]
async fn a_held_call_with_no_page_to_take_it_answers_locked() {
  let mut h = harness_not_ready(Limits::default());
  let mut client = connect(h.server.address()).await;
  send(&mut client, hello(1)).await;
  assert_eq!(next(&mut h.waiting).await.1, true);
  // Ready, but the window is gone.
  h.router.open.store(false, Ordering::SeqCst);
  h.server.set_ready(true);
  assert_eq!(answer(&mut client).await.unwrap()["error"]["data"]["reason"], "locked");
}

#[tokio::test]
async fn stopping_takes_the_held_calls_and_the_notice_away() {
  let mut h = harness_not_ready(Limits::default());
  let mut client = connect(h.server.address()).await;
  send(&mut client, hello(1)).await;
  assert_eq!(next(&mut h.waiting).await.1, true);
  let Harness { server, mut waiting, .. } = h;
  server.stop();
  // The notice goes (with the connection's end, or with the stop itself).
  let deadline = Instant::now() + Duration::from_secs(5);
  let mut last = None;
  while Instant::now() < deadline {
    match waiting.try_recv() {
      Ok(w) => last = Some(w),
      Err(_) if last.is_some() => break,
      Err(_) => tokio::time::sleep(Duration::from_millis(20)).await,
    }
  }
  assert_eq!(last, Some((vec![], false)));
  assert_eq!(answer(&mut client).await, None);
}

#[tokio::test]
async fn a_message_over_the_cap_ends_the_connection() {
  let mut h = harness(Limits { max_message: 1024, ..Limits::default() });
  let mut client = connect(h.server.address()).await;
  let big = json!({ "jsonrpc": "2.0", "id": 1, "method": "girovo.hello", "params": { "pad": "x".repeat(2000) } });
  send(&mut client, big).await;
  let err = answer(&mut client).await.unwrap();
  assert_eq!(err["error"]["data"]["reason"], "too_large");
  assert_eq!(err["id"], Value::Null);
  assert!(answer(&mut client).await.is_none(), "the connection ends");
  assert!(h.calls.try_recv().is_err());
}

#[tokio::test]
async fn a_client_that_floods_is_slowed_down() {
  let mut h = harness(Limits { burst: 3.0, per_second: 0.001, ..Limits::default() });
  let mut client = connect(h.server.address()).await;
  for id in 1..=4 {
    send(&mut client, hello(id)).await;
  }
  // The fourth is refused at once; the three before it reach the page.
  let err = answer(&mut client).await.unwrap();
  assert_eq!(err["id"], 4);
  assert_eq!(err["error"]["data"]["reason"], "rate_limited");
  for _ in 0..3 {
    next(&mut h.calls).await;
  }
}

#[tokio::test]
async fn connections_past_the_limit_are_turned_away() {
  let h = harness(Limits { max_connections: 1, ..Limits::default() });
  let mut first = connect(h.server.address()).await;
  send(&mut first, hello(1)).await;
  // The first is counted once its call is under way.
  let deadline = Instant::now() + Duration::from_secs(5);
  while h.server.connections() < 1 && Instant::now() < deadline {
    tokio::time::sleep(Duration::from_millis(20)).await;
  }
  let mut second = connect(h.server.address()).await;
  let err = answer(&mut second).await.unwrap();
  assert_eq!(err["error"]["data"]["reason"], "busy");
  assert!(answer(&mut second).await.is_none());
}

#[tokio::test]
async fn stopping_closes_everything() {
  let mut h = harness(Limits::default());
  let address = h.server.address().to_string();
  let mut client = connect(&address).await;
  send(&mut client, hello(1)).await;
  let call = next(&mut h.calls).await;
  let server = std::mem::replace(&mut h.server, Server::start(&format!("{address}-2"), h.router.clone(), Limits::default(), identify::client).unwrap());
  server.stop();
  assert!(answer(&mut client).await.is_none(), "the client sees the end");
  assert_eq!(next(&mut h.closed).await, call.connection);
  #[cfg(unix)]
  assert!(!std::path::Path::new(&address).exists(), "the socket file is gone");
  #[cfg(windows)]
  assert!(tokio::net::windows::named_pipe::ClientOptions::new().open(&address).is_err(), "the pipe is gone");
}

#[cfg(windows)]
#[test]
fn a_second_server_cannot_take_the_same_pipe() {
  let h = harness(Limits::default());
  let (calls, _) = mpsc::unbounded_channel();
  let (closed, _) = mpsc::unbounded_channel();
  let (waiting, _) = mpsc::unbounded_channel();
  let other = Arc::new(StandIn { calls, closed, waiting, open: AtomicBool::new(true) });
  assert!(Server::start(h.server.address(), other, Limits::default(), identify::client).is_err());
}

#[cfg(windows)]
#[test]
fn the_pipe_is_named_after_this_user() {
  let address = super::transport::default_address().unwrap();
  assert!(address.starts_with(r"\\.\pipe\girovo-api-S-1-5-"), "{address}");
}

// --- notifications from the page ---

/// A connection that has said hello, and its id as the page knows it.
async fn connected(h: &mut Harness, id: u32) -> (BufReader<ClientStream>, String) {
  let mut client = connect(h.server.address()).await;
  send(&mut client, hello(id)).await;
  let call = next(&mut h.calls).await;
  h.server.reply(&call.id, Reply::Result(json!({ "granted": [] })));
  assert_eq!(answer(&mut client).await.unwrap()["id"], id);
  (client, call.connection)
}

#[tokio::test]
async fn a_notification_reaches_its_connection_only() {
  let mut h = harness(Limits::default());
  let (mut a, a_id) = connected(&mut h, 1).await;
  let (mut b, _) = connected(&mut h, 2).await;

  let params = json!({ "kind": "booking", "text": "zwei\nZeilen" });
  assert_eq!(h.server.notify(&a_id, "girovo.event", params.clone()), Ok(()));
  assert_eq!(answer(&mut a).await.unwrap(), json!({ "jsonrpc": "2.0", "method": "girovo.event", "params": params }));
  // Without params, none on the wire: JSON-RPC has no null params.
  assert_eq!(h.server.notify(&a_id, "girovo.ping", Value::Null), Ok(()));
  assert_eq!(answer(&mut a).await.unwrap(), json!({ "jsonrpc": "2.0", "method": "girovo.ping" }));

  // B heard nothing: the next line it reads is the answer to its own call.
  send(&mut b, hello(3)).await;
  let call = next(&mut h.calls).await;
  h.server.reply(&call.id, Reply::Result(json!("b")));
  assert_eq!(answer(&mut b).await.unwrap(), json!({ "jsonrpc": "2.0", "id": 3, "result": "b" }));
}

#[tokio::test]
async fn a_notification_the_wire_cannot_carry_is_not_sent() {
  let mut h = harness(Limits { max_message: 1024, ..Limits::default() });
  let (mut a, a_id) = connected(&mut h, 1).await;
  assert_eq!(h.server.notify(&a_id, "girovo.event", json!({ "pad": "x".repeat(2000) })), Err(NotSent::Refused));
  assert_eq!(h.server.notify(&a_id, "girovo.event", json!("a string")), Err(NotSent::Refused));
  assert_eq!(h.server.notify(&a_id, "", json!({})), Err(NotSent::Refused));
  assert_eq!(h.server.notify(&a_id, &"m".repeat(200), json!({})), Err(NotSent::Refused));
  // The connection is still there and hears the next one that fits.
  assert_eq!(h.server.notify(&a_id, "girovo.event", json!([1, 2])), Ok(()));
  assert_eq!(answer(&mut a).await.unwrap()["params"], json!([1, 2]));
}

#[tokio::test]
async fn a_notification_to_a_closed_connection_fails_cleanly() {
  let mut h = harness(Limits::default());
  let (a, a_id) = connected(&mut h, 1).await;
  assert_eq!(h.server.notify("no-such-connection", "girovo.event", json!({})), Err(NotSent::Gone));
  drop(a);
  assert_eq!(next(&mut h.closed).await, a_id);
  assert_eq!(h.server.notify(&a_id, "girovo.event", json!({})), Err(NotSent::Gone));
}

#[tokio::test]
async fn a_client_that_does_not_read_is_dropped_alone() {
  let mut h = harness(Limits { max_queued: 8, max_queued_bytes: 256 * 1024, ..Limits::default() });
  let (mut slow, slow_id) = connected(&mut h, 1).await;
  let (mut b, b_id) = connected(&mut h, 2).await;

  // The slow one reads nothing: the pipe's buffer fills, then its queue.
  let big = json!({ "pad": "x".repeat(32 * 1024) });
  let mut outcome = Ok(());
  for _ in 0..2000 {
    outcome = h.server.notify(&slow_id, "girovo.event", big.clone());
    if outcome.is_err() {
      break;
    }
  }
  assert_eq!(outcome, Err(NotSent::Overflow));
  // Dropped: the page hears it, nothing more goes there, and the client sees the end.
  assert_eq!(next(&mut h.closed).await, slow_id);
  assert_eq!(h.server.notify(&slow_id, "girovo.event", json!({})), Err(NotSent::Gone));
  let mut rest = Vec::new();
  tokio::time::timeout(Duration::from_secs(10), tokio::io::AsyncReadExt::read_to_end(&mut slow, &mut rest))
    .await
    .expect("the slow client sees the end")
    .ok();

  // The other connection is untouched, both ways.
  assert_eq!(h.server.notify(&b_id, "girovo.event", json!({ "n": 1 })), Ok(()));
  assert_eq!(answer(&mut b).await.unwrap()["params"]["n"], 1);
  send(&mut b, hello(3)).await;
  let call = next(&mut h.calls).await;
  assert_eq!(call.connection, b_id);
  h.server.reply(&call.id, Reply::Result(json!(true)));
  assert_eq!(answer(&mut b).await.unwrap()["id"], 3);
  let deadline = Instant::now() + Duration::from_secs(5);
  while h.server.connections() != 1 && Instant::now() < deadline {
    tokio::time::sleep(Duration::from_millis(20)).await;
  }
  assert_eq!(h.server.connections(), 1);
}

#[tokio::test]
async fn a_client_dropped_while_its_own_answers_wait_still_ends() {
  // Its bad lines' errors fill the pipe and the queue, so the shell's reader
  // waits for room; the drop must end the connection all the same.
  let mut h = harness(Limits { max_queued: 8, burst: 1e9, per_second: 1e9, ..Limits::default() });
  let (mut slow, slow_id) = connected(&mut h, 1).await;
  slow.get_mut().write_all(&b"{oops\n".repeat(4000)).await.unwrap();
  let mut outcome = Ok(());
  let deadline = Instant::now() + Duration::from_secs(10);
  while outcome.is_ok() && Instant::now() < deadline {
    outcome = h.server.notify(&slow_id, "girovo.event", json!({}));
    tokio::time::sleep(Duration::from_millis(5)).await;
  }
  assert_eq!(outcome, Err(NotSent::Overflow));
  assert_eq!(next(&mut h.closed).await, slow_id);
  let deadline = Instant::now() + Duration::from_secs(5);
  while h.server.connections() != 0 && Instant::now() < deadline {
    tokio::time::sleep(Duration::from_millis(20)).await;
  }
  assert_eq!(h.server.connections(), 0);
}

#[test]
fn a_notification_line_is_json_rpc() {
  let line = rpc::notification_line("girovo.event", json!({ "a": 1 }));
  assert_eq!(*line.last().unwrap(), b'\n');
  assert_eq!(line.iter().filter(|&&c| c == b'\n').count(), 1);
  let v: Value = serde_json::from_slice(&line).unwrap();
  assert_eq!(v, json!({ "jsonrpc": "2.0", "method": "girovo.event", "params": { "a": 1 } }));
  assert!(v.get("id").is_none());
}

// --- the window to the front ---

#[test]
fn after_set_foreground_the_next_step() {
  use super::focus::{Next, next_step};
  assert_eq!(next_step(true, 0, 1), Next::Done);
  assert_eq!(next_step(true, 7, 1), Next::Done);
  // Another app's thread holds the foreground: join its input once.
  assert_eq!(next_step(false, 7, 1), Next::JoinInput);
  // No foreground window (the lock screen, a desktop switch) or our own thread: nothing to join.
  assert_eq!(next_step(false, 0, 1), Next::GiveUp);
  assert_eq!(next_step(false, 1, 1), Next::GiveUp);
}

/// Only handles that are no window: nothing is shown or opened on this PC.
#[cfg(windows)]
#[test]
fn a_handle_that_is_no_window_is_never_in_front() {
  assert!(!super::focus::win::to_front(0));
  assert!(!super::focus::win::to_front(0x7ff0_0000_0001_u64 as isize));
}
