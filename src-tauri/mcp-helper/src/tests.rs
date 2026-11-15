// The MCP side against a fake Girovo: a pipe (Windows) or a socket (Unix) of
// the test's own, answering girovo.hello and the methods the way Girovo's
// router does (lib/api/router.ts): not_permitted with data.permission for a
// permission the grant lacks, refused_by_user for a refused dialog.

use std::collections::BTreeSet;
use std::io::{BufRead, BufReader, Write};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread::JoinHandle;
use std::time::Duration;

use serde_json::{Value, json};

use crate::{Config, NOT_RUNNING, Out, serve};

// ---------------------------------------------------------------------------
// The fake Girovo
// ---------------------------------------------------------------------------

/// What the user does in the fake's dialog for a hello that asks for something new.
#[derive(Clone, Copy, PartialEq)]
enum Dialog {
  AllowAll,
  /// Zulassen with every new switch turned off.
  SwitchOff,
  Refuse,
}

struct FakeState {
  granted: BTreeSet<String>,
  dialog: Dialog,
  /// Every request as it came: (method, params).
  seen: Vec<(String, Value)>,
  /// Turns every connection away with this reason, as Girovo's shell does when busy.
  refuse: Option<&'static str>,
}

type Shared = Arc<Mutex<FakeState>>;

static NEXT: AtomicUsize = AtomicUsize::new(0);

fn unique_address() -> String {
  let n = NEXT.fetch_add(1, Ordering::SeqCst);
  #[cfg(windows)]
  return format!(r"\\.\pipe\girovo-mcp-test-{}-{n}", std::process::id());
  #[cfg(unix)]
  return std::env::temp_dir().join(format!("girovo-mcp-test-{}-{n}.sock", std::process::id())).to_string_lossy().into_owned();
}

fn accounts_fixture() -> Value {
  json!({
    "accounts": [
      { "id": "a_1", "name": "Girokonto", "balance": { "cents": 100000, "currency": "EUR", "day": "2026-11-14" } },
      { "id": "a_2", "name": "Tagesgeld", "balance": { "cents": 23456, "currency": "EUR", "day": "2026-11-14" } },
    ],
    "total": [{ "cents": 123456, "currency": "EUR" }],
  })
}

const PERMISSION: &[(&str, &str)] = &[
  ("girovo.accounts.list", "accounts.read"),
  ("girovo.transactions.list", "transactions.read"),
  ("girovo.notes.set", "notes.write"),
  ("girovo.transfers.request", "transfers.request"),
];

/// One answer as Girovo's router and shell give it.
fn answer(state: &mut FakeState, method: &str, params: &Value) -> Result<Value, Value> {
  state.seen.push((method.to_string(), params.clone()));
  let error = |reason: &str, message: &str, extra: Value| {
    let mut data = extra.as_object().cloned().unwrap_or_default();
    data.insert("reason".into(), json!(reason));
    json!({ "code": -32000, "message": message, "data": data })
  };
  if method == "girovo.hello" {
    let asked: Vec<String> = params["permissions"].as_array().unwrap().iter().map(|p| p.as_str().unwrap().to_string()).collect();
    let new: Vec<String> = asked.into_iter().filter(|p| !state.granted.contains(p)).collect();
    if !new.is_empty() {
      match state.dialog {
        Dialog::AllowAll => state.granted.extend(new),
        Dialog::SwitchOff => {}
        Dialog::Refuse => return Err(error("refused_by_user", "The user did not allow it.", json!({}))),
      }
    }
    return Ok(json!({ "granted": state.granted.iter().collect::<Vec<_>>(), "girovo": { "version": "7.0.0", "api": 1 } }));
  }
  let Some((_, permission)) = PERMISSION.iter().find(|(m, _)| *m == method) else {
    return Err(error("method_not_found", "Unknown method.", json!({ "method": method })));
  };
  if !state.granted.contains(*permission) {
    return Err(error("not_permitted", "This app does not have the permission for this method.", json!({ "permission": permission })));
  }
  Ok(match method {
    "girovo.accounts.list" => accounts_fixture(),
    "girovo.notes.set" => json!({ "booking": params["booking"], "note": params["text"] }),
    "girovo.transfers.request" => json!({ "request": "r_1", "state": "pending" }),
    _ => json!({ "transactions": [] }),
  })
}

/// Answers one connection's lines until it ends, or until `limit` requests.
fn serve_connection<S: std::io::Read + Write>(stream: S, writer: &mut dyn Write, state: &Shared, limit: Option<usize>) {
  let mut reader = BufReader::new(stream);
  let mut handled = 0;
  loop {
    let mut line = String::new();
    if reader.read_line(&mut line).unwrap_or(0) == 0 {
      return;
    }
    if let Some(reason) = state.lock().unwrap().refuse {
      let error = json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32000, "message": "Too many connections", "data": { "reason": reason } } });
      writer.write_all(format!("{error}\n").as_bytes()).unwrap();
      writer.flush().unwrap();
      return;
    }
    let request: Value = serde_json::from_str(&line).unwrap();
    let method = request["method"].as_str().unwrap().to_string();
    let reply = match answer(&mut state.lock().unwrap(), &method, &request["params"]) {
      Ok(result) => json!({ "jsonrpc": "2.0", "id": request["id"], "result": result }),
      Err(error) => json!({ "jsonrpc": "2.0", "id": request["id"], "error": error }),
    };
    // A notification first, as Girovo may send one any time: the helper must pass over it.
    let notification = json!({ "jsonrpc": "2.0", "method": "girovo.transfer.updated", "params": { "request": "r_0", "state": "sent" } });
    writer.write_all(format!("{notification}\n{reply}\n").as_bytes()).unwrap();
    writer.flush().unwrap();
    handled += 1;
    if limit.is_some_and(|l| handled >= l) {
      return;
    }
  }
}

/// A fake Girovo listening at `address` for `connections` connections, one
/// after the other; each answers `limit` requests at most, then hangs up.
fn fake_at(address: &str, state: Shared, connections: usize, limit: Option<usize>) -> JoinHandle<()> {
  #[cfg(windows)]
  {
    use std::os::windows::io::FromRawHandle;
    use windows::Win32::Storage::FileSystem::{FILE_FLAG_FIRST_PIPE_INSTANCE, FILE_FLAGS_AND_ATTRIBUTES, PIPE_ACCESS_DUPLEX};
    use windows::Win32::System::Pipes::{ConnectNamedPipe, CreateNamedPipeW, PIPE_READMODE_BYTE, PIPE_TYPE_BYTE, PIPE_UNLIMITED_INSTANCES, PIPE_WAIT};
    use windows::core::PCWSTR;

    let wide: Vec<u16> = address.encode_utf16().chain(Some(0)).collect();
    let create = move |first: bool| -> std::fs::File {
      let flags = if first { FILE_FLAG_FIRST_PIPE_INSTANCE } else { FILE_FLAGS_AND_ATTRIBUTES(0) };
      let handle = unsafe {
        CreateNamedPipeW(PCWSTR(wide.as_ptr()), PIPE_ACCESS_DUPLEX | flags, PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT, PIPE_UNLIMITED_INSTANCES, 65536, 65536, 0, None)
      };
      assert!(!handle.is_invalid(), "CreateNamedPipeW");
      unsafe { std::fs::File::from_raw_handle(handle.0) }
    };
    // The first instance exists before the test goes on, so the client finds it.
    let mut next = Some(create(true));
    return std::thread::spawn(move || {
      for i in 0..connections {
        let pipe = next.take().unwrap_or_else(|| create(false));
        // ERROR_PIPE_CONNECTED (the client came first) is a connection too.
        let _ = unsafe { ConnectNamedPipe(windows::Win32::Foundation::HANDLE(std::os::windows::io::AsRawHandle::as_raw_handle(&pipe)), None) };
        let mut writer = pipe.try_clone().unwrap();
        serve_connection(pipe, &mut writer, &state, limit);
        if i + 1 < connections {
          next = Some(create(false));
        }
      }
    });
  }
  #[cfg(unix)]
  {
    let _ = std::fs::remove_file(address);
    let listener = std::os::unix::net::UnixListener::bind(address).unwrap();
    return std::thread::spawn(move || {
      for _ in 0..connections {
        let (stream, _) = listener.accept().unwrap();
        let mut writer = stream.try_clone().unwrap();
        serve_connection(stream, &mut writer, &state, limit);
      }
    });
  }
}

fn state(granted: &[&str], dialog: Dialog) -> Shared {
  Arc::new(Mutex::new(FakeState { granted: granted.iter().map(|s| s.to_string()).collect(), dialog, seen: Vec::new(), refuse: None }))
}

fn methods(state: &Shared) -> Vec<String> {
  state.lock().unwrap().seen.iter().map(|(m, _)| m.clone()).collect()
}

// ---------------------------------------------------------------------------
// The assistant's side
// ---------------------------------------------------------------------------

struct Lines(Mutex<mpsc::Sender<String>>);

impl Out for Lines {
  fn line(&self, line: &str) {
    let _ = self.0.lock().unwrap().send(line.to_string());
  }
}

struct Assistant {
  input: Option<mpsc::Sender<String>>,
  output: mpsc::Receiver<String>,
  server: Option<JoinHandle<()>>,
  /// Messages read while waiting for another: notifications, mostly.
  others: Vec<Value>,
}

impl Assistant {
  fn start(address: &str) -> Assistant {
    Assistant::start_with(address, None)
  }

  fn start_with(address: &str, launcher: Option<u32>) -> Assistant {
    let (input, lines) = mpsc::channel::<String>();
    let (out, output) = mpsc::channel::<String>();
    let config = Config { address: Some(address.to_string()), version: "1.0.0".into(), launcher };
    let server = std::thread::spawn(move || serve(lines.into_iter().map(Ok), Arc::new(Lines(Mutex::new(out))), config));
    Assistant { input: Some(input), output, server: Some(server), others: Vec::new() }
  }

  fn send_raw(&self, line: &str) {
    self.input.as_ref().unwrap().send(line.to_string()).unwrap();
  }

  fn send(&self, message: Value) {
    self.send_raw(&message.to_string());
  }

  fn next(&self) -> Value {
    let line = self.output.recv_timeout(Duration::from_secs(20)).expect("an answer from girovo-mcp");
    serde_json::from_str(&line).expect("one JSON message per line")
  }

  fn request(&mut self, id: u64, method: &str, params: Value) -> Value {
    self.send(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }));
    loop {
      let message = self.next();
      if message.get("id") == Some(&json!(id)) {
        return message;
      }
      self.others.push(message);
    }
  }

  fn initialize(&mut self, version: &str) -> Value {
    let answer = self.request(0, "initialize", json!({ "protocolVersion": version, "capabilities": {}, "clientInfo": { "name": "test", "version": "1" } }));
    self.send(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }));
    answer
  }

  fn call(&mut self, id: u64, name: &str, arguments: Value) -> Value {
    let answer = self.request(id, "tools/call", json!({ "name": name, "arguments": arguments }));
    answer["result"].clone()
  }

  fn list_changed(&self) -> usize {
    self.others.iter().filter(|m| m["method"] == "notifications/tools/list_changed").count()
  }
}

impl Drop for Assistant {
  fn drop(&mut self) {
    self.input.take();
    if let Some(s) = self.server.take() {
      let _ = s.join();
    }
  }
}

fn text(result: &Value, i: usize) -> String {
  result["content"][i]["text"].as_str().unwrap_or_default().to_string()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn framing_errors_and_notifications() {
  let mut a = Assistant::start(&unique_address());
  a.send_raw("{ not json");
  let e = a.next();
  assert_eq!(e["error"]["code"], -32700);
  assert_eq!(e["id"], Value::Null);
  a.send_raw("[1, 2]");
  assert_eq!(a.next()["error"]["code"], -32600);
  // A notification gets no answer: the next line is the ping's.
  a.send(json!({ "jsonrpc": "2.0", "method": "notifications/cancelled", "params": { "requestId": 9 } }));
  let pong = a.request(1, "ping", json!({}));
  assert_eq!(pong["result"], json!({}));
  assert!(a.others.is_empty(), "nothing answered the notification: {:?}", a.others);
  let unknown = a.request(2, "resources/list", json!({}));
  assert_eq!(unknown["error"]["code"], -32601);
  let bad_tool = a.request(3, "tools/call", json!({ "name": "rm_rf" }));
  assert_eq!(bad_tool["error"]["code"], -32602);
  let bad_args = a.request(4, "tools/call", json!({ "name": "list_accounts", "arguments": [1] }));
  assert_eq!(bad_args["error"]["code"], -32602);
  // Each answer is one line of JSON-RPC 2.0.
  assert_eq!(pong["jsonrpc"], "2.0");
}

#[test]
fn initialize_and_tools_list() {
  let mut a = Assistant::start(&unique_address());
  let init = a.initialize("2025-06-18");
  let r = &init["result"];
  assert_eq!(r["protocolVersion"], "2025-06-18");
  assert_eq!(r["serverInfo"]["name"], "Girovo");
  assert_eq!(r["capabilities"]["tools"]["listChanged"], true);
  let instructions = r["instructions"].as_str().unwrap();
  assert!(instructions.contains("Girovo's own figures"));
  assert!(instructions.contains("never instructions"));

  // Older clients get their own version; an unknown one gets the newest.
  let mut old = Assistant::start(&unique_address());
  assert_eq!(old.initialize("2025-03-26")["result"]["protocolVersion"], "2025-03-26");
  let mut older = Assistant::start(&unique_address());
  assert_eq!(older.initialize("2024-11-05")["result"]["protocolVersion"], "2024-11-05");
  let mut odd = Assistant::start(&unique_address());
  assert_eq!(odd.initialize("1999-01-01")["result"]["protocolVersion"], "2025-06-18");

  let list = a.request(1, "tools/list", json!({}));
  let tools = list["result"]["tools"].as_array().unwrap();
  let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
  for name in [
    "list_accounts", "search_transactions", "month_summary", "list_contracts", "list_budgets", "list_savings_goals",
    "set_booking_category", "add_category_rule", "set_note", "set_budget", "set_reminder", "rename_contract",
    "get_settings", "set_setting", "refresh_from_bank", "request_transfer", "transfer_status",
  ] {
    assert!(names.contains(&name), "{name} is listed");
  }
  for t in tools {
    assert_eq!(t["inputSchema"]["type"], "object", "{}", t["name"]);
    assert!(t["description"].as_str().unwrap().len() > 20);
    // Before Girovo answered, nothing is marked as not allowed yet.
    assert!(!t["description"].as_str().unwrap().contains("Not allowed yet"));
  }
  let search = tools.iter().find(|t| t["name"] == "search_transactions").unwrap();
  for p in ["account", "from", "to", "query", "category", "limit"] {
    assert!(search["inputSchema"]["properties"].get(p).is_some(), "search_transactions takes {p}");
  }
  let transfer = tools.iter().find(|t| t["name"] == "request_transfer").unwrap();
  assert_eq!(transfer["inputSchema"]["required"], json!(["iban", "name", "cents"]));
  assert_eq!(transfer["annotations"]["readOnlyHint"], false);
}

#[test]
fn every_hello_names_the_launcher_when_it_is_known() {
  let address = unique_address();
  let girovo = state(&[], Dialog::AllowAll);
  let fake = fake_at(&address, girovo.clone(), 1, None);
  let mut a = Assistant::start_with(&address, Some(4242));
  a.initialize("2025-06-18");
  assert_eq!(a.call(1, "list_accounts", json!({}))["isError"], false);
  let seen = girovo.lock().unwrap().seen.clone();
  assert_eq!(seen[0].0, "girovo.hello");
  assert_eq!(seen[0].1["launcher"], 4242);
  drop(a);
  fake.join().unwrap();

  // Not known (stdin no pipe, or not Windows): no key at all.
  let address = unique_address();
  let girovo = state(&[], Dialog::AllowAll);
  let fake = fake_at(&address, girovo.clone(), 1, None);
  let mut a = Assistant::start(&address);
  a.initialize("2025-06-18");
  assert_eq!(a.call(1, "list_accounts", json!({}))["isError"], false);
  assert!(girovo.lock().unwrap().seen[0].1.get("launcher").is_none());
  drop(a);
  fake.join().unwrap();
}

#[test]
fn a_tool_call_says_hello_then_calls_the_method() {
  let address = unique_address();
  let girovo = state(&[], Dialog::AllowAll);
  let fake = fake_at(&address, girovo.clone(), 1, None);
  let mut a = Assistant::start(&address);
  a.initialize("2025-06-18");
  let r = a.call(1, "list_accounts", json!({ "ignored": true }));
  assert_eq!(r["isError"], false);
  assert_eq!(text(&r, 0), "2 Konten. Gesamtsaldo: 1.234,56 EUR.");
  assert_eq!(serde_json::from_str::<Value>(&text(&r, 1)).unwrap(), accounts_fixture());
  assert_eq!(r["structuredContent"], accounts_fixture());

  let seen = girovo.lock().unwrap().seen.clone();
  assert_eq!(seen[0].0, "girovo.hello");
  assert_eq!(seen[0].1["app"], "Girovo MCP");
  assert_eq!(seen[0].1["permissions"], json!(["accounts.read", "transactions.read", "insights.read"]));
  assert_eq!(seen[1], ("girovo.accounts.list".to_string(), json!({})), "only the schema's arguments go on");

  // Girovo answered what it allows: the list changed, and says what it will ask about.
  let list = a.request(2, "tools/list", json!({}));
  assert_eq!(a.list_changed(), 1);
  let tools = list["result"]["tools"].as_array().unwrap();
  let describe = |name: &str| tools.iter().find(|t| t["name"] == name).unwrap()["description"].as_str().unwrap().to_string();
  assert!(!describe("list_accounts").contains("Not allowed yet"));
  assert!(describe("set_note").contains("Not allowed yet"));

  // A second call uses the same connection, without another hello.
  a.call(3, "search_transactions", json!({ "limit": 5, "query": "Miete" }));
  assert_eq!(methods(&girovo), ["girovo.hello", "girovo.accounts.list", "girovo.transactions.list"]);
  assert_eq!(girovo.lock().unwrap().seen[2].1, json!({ "limit": 5, "query": "Miete" }));
  drop(a);
  fake.join().unwrap();
}

#[test]
fn older_protocols_get_no_structured_content() {
  let address = unique_address();
  let girovo = state(&[], Dialog::AllowAll);
  let fake = fake_at(&address, girovo, 1, None);
  let mut a = Assistant::start(&address);
  a.initialize("2025-03-26");
  let r = a.call(1, "list_accounts", json!({}));
  assert!(r.get("structuredContent").is_none());
  assert_eq!(serde_json::from_str::<Value>(&text(&r, 1)).unwrap(), accounts_fixture());
  drop(a);
  fake.join().unwrap();
}

#[test]
fn the_first_hello_asks_for_what_the_first_tool_needs() {
  let address = unique_address();
  let girovo = state(&[], Dialog::AllowAll);
  let fake = fake_at(&address, girovo.clone(), 1, None);
  let mut a = Assistant::start(&address);
  a.initialize("2025-06-18");
  let r = a.call(1, "request_transfer", json!({ "iban": "DE02120300000000202051", "name": "Max", "cents": 2550 }));
  assert_eq!(r["isError"], false);
  assert!(text(&r, 0).contains("Gesendet wird sie erst, wenn der Nutzer sie dort sendet"));
  let seen = girovo.lock().unwrap().seen.clone();
  assert_eq!(seen[0].1["permissions"], json!(["accounts.read", "transactions.read", "insights.read", "transfers.request"]));
  drop(a);
  fake.join().unwrap();
}

#[test]
fn a_missing_permission_asks_girovo_and_tries_once_more() {
  let address = unique_address();
  let girovo = state(&[], Dialog::AllowAll);
  let fake = fake_at(&address, girovo.clone(), 1, None);
  let mut a = Assistant::start(&address);
  a.initialize("2025-06-18");
  a.call(1, "list_accounts", json!({}));
  let r = a.call(2, "set_note", json!({ "booking": "t_1", "text": "Geburtstag" }));
  assert_eq!(r["isError"], false, "{r}");
  assert_eq!(r["structuredContent"], json!({ "booking": "t_1", "note": "Geburtstag" }));
  let seen = girovo.lock().unwrap().seen.clone();
  let names: Vec<&str> = seen.iter().map(|(m, _)| m.as_str()).collect();
  assert_eq!(names, ["girovo.hello", "girovo.accounts.list", "girovo.notes.set", "girovo.hello", "girovo.notes.set"]);
  assert_eq!(seen[3].1["permissions"], json!(["notes.write"]), "a hello for just that permission");
  assert!(seen[3].1["reason"].as_str().unwrap().contains("Notiz"));
  // Allowed twice over: two changes to the list.
  a.request(3, "ping", json!({}));
  assert_eq!(a.list_changed(), 2);
  drop(a);
  fake.join().unwrap();
}

#[test]
fn a_refused_permission_is_a_tool_error() {
  for dialog in [Dialog::Refuse, Dialog::SwitchOff] {
    let address = unique_address();
    let girovo = state(&["accounts.read", "transactions.read", "insights.read"], dialog);
    let fake = fake_at(&address, girovo.clone(), 1, None);
    let mut a = Assistant::start(&address);
    a.initialize("2025-06-18");
    let r = a.call(1, "list_accounts", json!({}));
    assert_eq!(r["isError"], false);
    let r = a.call(2, "set_note", json!({ "booking": "t_1", "text": "x" }));
    assert_eq!(r["isError"], true);
    assert_eq!(text(&r, 0), "Der Nutzer hat das in Girovo nicht erlaubt.");
    assert_eq!(methods(&girovo).iter().filter(|m| *m == "girovo.notes.set").count(), 1, "tried once, not again after the no");
    drop(a);
    fake.join().unwrap();
  }
}

#[test]
fn girovo_not_running_is_a_tool_error_and_the_next_call_connects() {
  let address = unique_address();
  let mut a = Assistant::start(&address);
  a.initialize("2025-06-18");
  let r = a.call(1, "list_accounts", json!({}));
  assert_eq!(r["isError"], true);
  assert_eq!(text(&r, 0), NOT_RUNNING);
  // The helper is still there.
  assert_eq!(a.request(2, "ping", json!({}))["result"], json!({}));

  let girovo = state(&[], Dialog::AllowAll);
  let fake = fake_at(&address, girovo.clone(), 1, None);
  let r = a.call(3, "list_accounts", json!({}));
  assert_eq!(r["isError"], false, "{r}");
  assert_eq!(methods(&girovo), ["girovo.hello", "girovo.accounts.list"]);
  drop(a);
  fake.join().unwrap();
}

#[test]
fn a_girovo_that_went_away_and_came_back_is_reached_again() {
  let address = unique_address();
  let girovo = state(&[], Dialog::AllowAll);
  // The first connection ends after hello and one call, as when Girovo quits; the second is the new Girovo.
  let fake = fake_at(&address, girovo.clone(), 2, Some(2));
  let mut a = Assistant::start(&address);
  a.initialize("2025-06-18");
  assert_eq!(a.call(1, "list_accounts", json!({}))["isError"], false);
  std::thread::sleep(Duration::from_millis(100));
  // The old connection is gone: either the helper finds out on writing and goes
  // to the new Girovo at once, or on reading, and the next call does.
  let mut r = a.call(2, "list_accounts", json!({}));
  if r["isError"] == true {
    assert_eq!(text(&r, 0), NOT_RUNNING);
    r = a.call(3, "list_accounts", json!({}));
  }
  assert_eq!(r["isError"], false, "{r}");
  assert_eq!(methods(&girovo).iter().filter(|m| *m == "girovo.hello").count(), 2, "the new connection says hello again");
  drop(a);
  fake.join().unwrap();
}

#[test]
fn a_connection_girovo_turns_away_says_so() {
  let address = unique_address();
  let girovo = state(&[], Dialog::AllowAll);
  girovo.lock().unwrap().refuse = Some("busy");
  let fake = fake_at(&address, girovo.clone(), 1, None);
  let mut a = Assistant::start(&address);
  a.initialize("2025-06-18");
  let r = a.call(1, "list_accounts", json!({}));
  assert_eq!(r["isError"], true);
  assert_eq!(text(&r, 0), "Girovo hat die Verbindung abgelehnt. Zu viele Verbindungen sind offen.");
  drop(a);
  fake.join().unwrap();
}

#[test]
fn girovo_errors_read_plainly() {
  use crate::{CallError, error_text};
  let rpc = |reason: &str, data: Value| CallError::Rpc { reason: reason.into(), message: "m".into(), data };
  assert!(error_text(&rpc("locked", json!({ "reason": "locked" }))).starts_with("Girovo ist gesperrt"));
  assert_eq!(error_text(&rpc("bank_error", json!({ "reason": "bank_error", "text": "PIN falsch" }))), "Die Bank meldet: PIN falsch");
  assert_eq!(error_text(&rpc("invalid", json!({ "reason": "invalid", "param": "month" }))), "Ungültige Angabe. m ({\"param\":\"month\"})");
  assert!(error_text(&CallError::NotAllowed { refused_app: true }).contains("abgelehnt"));
  assert!(error_text(&CallError::NotGirovo).contains("anderen Benutzers"));
  let refused = |reason: &str| CallError::Refused { reason: reason.into(), message: "Girovo could not tell which program this is".into() };
  assert_eq!(error_text(&refused("denied")), "Girovo hat die Verbindung abgelehnt. Girovo konnte nicht erkennen, welches Programm fragt.");
  assert_eq!(error_text(&refused("new")), "Girovo hat die Verbindung abgelehnt. Girovo could not tell which program this is");
}

#[test]
fn money_is_written_as_girovo_writes_it() {
  use crate::tools::money;
  assert_eq!(money(&json!({ "cents": 123456, "currency": "EUR" })).unwrap(), "1.234,56 EUR");
  assert_eq!(money(&json!({ "cents": -1230, "currency": "EUR" })).unwrap(), "-12,30 EUR");
  assert_eq!(money(&json!({ "cents": 5, "currency": "USD" })).unwrap(), "0,05 USD");
  assert_eq!(money(&json!({ "cents": 100000000, "currency": "EUR" })).unwrap(), "1.000.000,00 EUR");
  assert!(money(&json!({ "currency": "EUR" })).is_none());
}

#[test]
fn every_tool_names_a_girovo_method_once() {
  let mut seen = BTreeSet::new();
  for t in crate::tools::TOOLS {
    assert!(t.method.starts_with("girovo."), "{}", t.name);
    assert!(seen.insert(t.method), "{} is mapped twice", t.method);
    assert!(t.name.chars().all(|c| c.is_ascii_lowercase() || c == '_'), "{} is snake_case", t.name);
  }
}

#[test]
fn the_address_is_the_one_girovo_listens_on() {
  if std::env::var_os("GIROVO_API_ADDRESS").is_some() {
    return;
  }
  let address = crate::girovo::default_address().unwrap();
  #[cfg(windows)]
  assert!(address.starts_with(r"\\.\pipe\girovo-api-S-1-5-"), "{address}");
  #[cfg(unix)]
  assert!(address.ends_with("/girovo-api.sock"), "{address}");
}

/// The fallback for an elevated Girovo reads the pipe's owner; a pipe made by
/// this user (no descriptor of its own) is owned by this user.
#[cfg(windows)]
#[test]
fn the_pipe_owner_is_this_user() {
  use crate::girovo::for_tests::{connect, current_user_sid, pipe_owner};
  let address = unique_address();
  let fake = fake_at(&address, state(&[], Dialog::SwitchOff), 1, None);
  let stream = connect(&address).unwrap();
  assert_eq!(pipe_owner(&stream).unwrap(), current_user_sid().unwrap());
  drop(stream);
  fake.join().unwrap();
}
