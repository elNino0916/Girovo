// The Girovo API's wire (docs/girovo-api.md "Transport"): JSON-RPC 2.0, one
// message per line, as MCP's stdio does it. Only the shape is checked here;
// what a method means is the page's business.
//
// The page answers with a string code (`locked`, `not_permitted`, ...), and
// JSON-RPC wants a number: each code has a number of its own below, and the
// string goes along as `error.data.reason`, so a client can switch on either.

use std::time::Instant;

use serde::Deserialize;
use serde_json::{Map, Value, json};
use tokio::io::{AsyncBufRead, AsyncBufReadExt};

/// The longest line a client may send: a request is small, and a client that
/// sends more is either broken or trying to fill the shell's memory.
pub const MAX_MESSAGE: usize = 1024 * 1024;

/// A method's name is a short dotted word; anything longer is not one of ours.
const MAX_METHOD: usize = 128;

#[derive(Debug)]
pub enum LineError {
  /// A line longer than the cap: the rest of the stream can't be trusted to
  /// line up again, so the connection ends after one error.
  TooLarge,
  /// The stream failed: the client is gone.
  Io,
}

/// Reads one line, without its `\n` and a `\r` before it. None at the end of
/// the stream; an unfinished last line is dropped, since a message is only
/// complete with its newline.
pub async fn read_line<R: AsyncBufRead + Unpin>(reader: &mut R, max: usize) -> Result<Option<Vec<u8>>, LineError> {
  let mut line = Vec::new();
  loop {
    let buf = reader.fill_buf().await.map_err(|_| LineError::Io)?;
    if buf.is_empty() {
      return Ok(None);
    }
    if let Some(at) = buf.iter().position(|&b| b == b'\n') {
      if line.len() + at > max {
        return Err(LineError::TooLarge);
      }
      line.extend_from_slice(&buf[..at]);
      reader.consume(at + 1);
      if line.last() == Some(&b'\r') {
        line.pop();
      }
      return Ok(Some(line));
    }
    let n = buf.len();
    if line.len() + n > max {
      return Err(LineError::TooLarge);
    }
    line.extend_from_slice(buf);
    reader.consume(n);
  }
}

/// What a line turned out to be.
#[derive(Debug, PartialEq)]
pub enum Message {
  /// A call to answer. `params` is null when the request had none.
  Request { id: Value, method: String, params: Value },
  /// No id: nobody waits for an answer. Phase 1 has no notifications, so they are dropped.
  Notification,
  /// A client's answer to something: the shell never asks a client anything.
  Response,
  /// Not a request; answered with this error (id null where none could be read).
  Invalid { id: Value, error: WireError },
}

/// An error as it goes out: the JSON-RPC number, the message, and the
/// string code as `data.reason`.
#[derive(Debug, Clone, PartialEq)]
pub struct WireError {
  pub code: i64,
  pub message: String,
  pub data: Value,
}

impl WireError {
  /// From one of the API's string codes (the page's, or the shell's own).
  pub fn from_reason(reason: &str, message: &str, data: Option<Value>) -> WireError {
    let data = match data {
      Some(Value::Object(mut fields)) => {
        // data.reason is the error's code; the page's own finer reason
        // ("never", "busy", "plus" …) moves to data.detail, not lost.
        if let Some(own) = fields.insert("reason".into(), Value::String(reason.into())) {
          if own.as_str() != Some(reason) {
            fields.entry("detail").or_insert(own);
          }
        }
        Value::Object(fields)
      }
      Some(Value::Null) | None => json!({ "reason": reason }),
      Some(other) => json!({ "reason": reason, "detail": other }),
    };
    WireError { code: number_of(reason), message: message.to_string(), data }
  }

  /// The shell's own answer to a line that is no request; JSON-RPC's numbers, reason `invalid`.
  fn shape(code: i64, message: &str) -> WireError {
    WireError { code, message: message.into(), data: json!({ "reason": "invalid" }) }
  }
}

/// JSON-RPC's own numbers where one fits, the rest in the range JSON-RPC
/// leaves to servers (-32000 to -32099).
pub fn number_of(reason: &str) -> i64 {
  match reason {
    "invalid" => -32602,
    "method_not_found" | "unknown_method" => -32601,
    "internal" => -32603,
    "locked" => -32001,
    "denied" => -32002,
    "not_permitted" => -32003,
    "refused_by_user" => -32004,
    "bank_error" => -32005,
    "timeout" => -32006,
    "rate_limited" => -32007,
    "too_large" => -32008,
    "busy" => -32009,
    _ => -32000,
  }
}

pub const PARSE_ERROR: i64 = -32700;
pub const INVALID_REQUEST: i64 = -32600;
pub const INVALID_PARAMS: i64 = -32602;

pub fn parse(line: &[u8]) -> Message {
  let value: Value = match serde_json::from_slice(line) {
    Ok(v) => v,
    Err(_) => return Message::Invalid { id: Value::Null, error: WireError::shape(PARSE_ERROR, "Parse error") },
  };
  let fields = match value {
    Value::Object(fields) => fields,
    Value::Array(_) => {
      return Message::Invalid { id: Value::Null, error: WireError::shape(INVALID_REQUEST, "Batches are not supported") };
    }
    _ => return Message::Invalid { id: Value::Null, error: WireError::shape(INVALID_REQUEST, "Invalid Request") },
  };
  let id = match fields.get("id") {
    None => None,
    Some(id @ (Value::String(_) | Value::Number(_) | Value::Null)) => Some(id.clone()),
    Some(_) => return Message::Invalid { id: Value::Null, error: WireError::shape(INVALID_REQUEST, "Invalid Request") },
  };
  let answer_to = id.clone().unwrap_or(Value::Null);
  if fields.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
    return Message::Invalid { id: answer_to, error: WireError::shape(INVALID_REQUEST, "Invalid Request") };
  }
  let method = match fields.get("method") {
    Some(Value::String(m)) if method_fits(m) => m.clone(),
    None if fields.contains_key("result") || fields.contains_key("error") => return Message::Response,
    _ => return Message::Invalid { id: answer_to, error: WireError::shape(INVALID_REQUEST, "Invalid Request") },
  };
  let params = match fields.get("params") {
    None => Value::Null,
    Some(p @ (Value::Object(_) | Value::Array(_))) => p.clone(),
    Some(_) => return Message::Invalid { id: answer_to, error: WireError::shape(INVALID_PARAMS, "Invalid params") },
  };
  match id {
    Some(id) => Message::Request { id, method, params },
    None => Message::Notification,
  }
}

/// The page's answer to one call (bridge.js electronGirovoApi.reply).
#[derive(Debug, Clone, PartialEq)]
pub enum Reply {
  Result(Value),
  Error(PageError),
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct PageError {
  pub code: String,
  #[serde(default)]
  pub message: String,
  #[serde(default)]
  pub data: Option<Value>,
}

impl Reply {
  /// From api_reply's arguments: an error wins over a result; neither is a null result.
  pub fn from_parts(result: Option<Value>, error: Option<PageError>) -> Reply {
    match error {
      Some(e) => Reply::Error(e),
      None => Reply::Result(result.unwrap_or(Value::Null)),
    }
  }
}

pub fn result_line(id: &Value, result: Value) -> Vec<u8> {
  let mut out = Map::new();
  out.insert("jsonrpc".into(), "2.0".into());
  out.insert("id".into(), id.clone());
  out.insert("result".into(), result);
  line_of(Value::Object(out))
}

pub fn error_line(id: &Value, error: &WireError) -> Vec<u8> {
  let mut out = Map::new();
  out.insert("jsonrpc".into(), "2.0".into());
  out.insert("id".into(), id.clone());
  out.insert("error".into(), json!({ "code": error.code, "message": error.message, "data": error.data }));
  line_of(Value::Object(out))
}

pub fn reply_line(id: &Value, reply: Reply) -> Vec<u8> {
  match reply {
    Reply::Result(result) => result_line(id, result),
    Reply::Error(e) => error_line(id, &WireError::from_reason(&e.code, &e.message, e.data)),
  }
}

/// Whether a method's name is one a line may carry: not empty and short.
pub fn method_fits(method: &str) -> bool {
  !method.is_empty() && method.len() <= MAX_METHOD
}

/// A notification from Girovo to a client (events.subscribe): no id, since
/// nobody answers it. JSON-RPC wants params structured or left out, so a
/// null leaves them out and the caller refuses anything else that is not an
/// object or an array.
pub fn notification_line(method: &str, params: Value) -> Vec<u8> {
  let mut out = Map::new();
  out.insert("jsonrpc".into(), "2.0".into());
  out.insert("method".into(), method.into());
  if !params.is_null() {
    out.insert("params".into(), params);
  }
  line_of(Value::Object(out))
}

/// serde_json writes a newline inside a string as `\n`, so a message is always one line.
fn line_of(value: Value) -> Vec<u8> {
  let mut bytes = serde_json::to_vec(&value).unwrap_or_default();
  bytes.push(b'\n');
  bytes
}

/// A token bucket per connection: `burst` calls at once, then `per_second`.
/// Enough for any app that reads and writes as a person would ask, and a
/// stop for one that loops.
#[derive(Debug)]
pub struct Bucket {
  tokens: f64,
  last: Instant,
  per_second: f64,
  burst: f64,
}

impl Bucket {
  pub fn new(per_second: f64, burst: f64, now: Instant) -> Bucket {
    Bucket { tokens: burst, last: now, per_second, burst }
  }

  /// One call's token; false when the bucket is empty.
  pub fn take(&mut self, now: Instant) -> bool {
    let elapsed = now.saturating_duration_since(self.last).as_secs_f64();
    self.last = now;
    self.tokens = (self.tokens + elapsed * self.per_second).min(self.burst);
    if self.tokens >= 1.0 {
      self.tokens -= 1.0;
      true
    } else {
      false
    }
  }
}
