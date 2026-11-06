// The route handlers' requests that leave the machine — to the bank, to
// Brandfetch — sent from here, not from the WebView: banks' FinTS endpoints
// send no CORS headers, so the page's own fetch could never read them. The
// page's side is mobile/server/fetch.ts, the phone's GirovoHttp, unchanged:
//
//   http_open   sends the request, answers once the head is in
//   http_body   the body, read to the end (base64)
//   http_cancel drops a request, wherever it is
//
// Two steps like a real fetch, so lib/bank-fetch.ts can tell a bank that does
// not start answering from one taking long to send twelve months of Umsätze.
//
// Only https leaves: every bank URL in banks-data.json is https, and a
// request in the clear would show the bank's traffic to the network.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use tokio::sync::oneshot;

/// Requests in flight: a response whose body is not read yet, or a cancel switch for one still opening.
#[derive(Default)]
pub struct Requests {
  open: Mutex<HashMap<String, reqwest::Response>>,
  cancels: Mutex<HashMap<String, oneshot::Sender<()>>>,
  client: Mutex<Option<reqwest::Client>>,
}

impl Requests {
  fn client(&self) -> Result<reqwest::Client, String> {
    let mut slot = self.client.lock().unwrap();
    if let Some(c) = slot.as_ref() {
      return Ok(c.clone());
    }
    let client = reqwest::Client::builder()
      .https_only(true)
      .connect_timeout(Duration::from_secs(30))
      // Redirects are the bank's own business; FinTS servers answer in place.
      .redirect(reqwest::redirect::Policy::limited(3))
      .user_agent(concat!("Girovo/", env!("CARGO_PKG_VERSION")))
      .build()
      .map_err(|e| e.to_string())?;
    *slot = Some(client.clone());
    Ok(client)
  }
}

#[derive(serde::Deserialize)]
pub struct OpenArgs {
  id: String,
  url: String,
  method: String,
  #[serde(default)]
  headers: HashMap<String, String>,
  body: Option<String>,
}

#[derive(serde::Serialize)]
pub struct Head {
  status: u16,
  #[serde(rename = "statusText")]
  status_text: String,
  headers: HashMap<String, String>,
}

/// An error the page's fetch reads like Node's: `code` first (ENOTFOUND,
/// ECONNREFUSED… prove the request never left), then what happened.
fn failure(err: &reqwest::Error) -> String {
  let text = format!("{err:?}");
  let code = if err.is_timeout() {
    "ETIMEDOUT"
  } else if text.contains("dns error") || text.contains("No such host") || text.contains("failed to lookup") {
    "ENOTFOUND"
  } else if text.contains("ConnectionRefused") || text.contains("actively refused") {
    "ECONNREFUSED"
  } else if text.contains("NetworkUnreachable") {
    "ENETUNREACH"
  } else if text.contains("HostUnreachable") {
    "EHOSTUNREACH"
  } else if err.is_connect() {
    "ECONNRESET"
  } else {
    "EIO"
  };
  format!("{code}: {err}")
}

#[tauri::command]
pub async fn http_open(state: tauri::State<'_, Requests>, args: OpenArgs) -> Result<Head, String> {
  let url = reqwest::Url::parse(&args.url).map_err(|e| format!("EINVAL: {e}"))?;
  if url.scheme() != "https" {
    return Err("EPROTO: only https leaves the app".into());
  }
  let method = reqwest::Method::from_bytes(args.method.to_uppercase().as_bytes()).map_err(|e| format!("EINVAL: {e}"))?;
  let mut req = state.client()?.request(method, url);
  for (k, v) in &args.headers {
    req = req.header(k, v);
  }
  if let Some(body) = args.body {
    req = req.body(B64.decode(body.as_bytes()).map_err(|e| format!("EINVAL: {e}"))?);
  }
  let (tx, rx) = oneshot::channel();
  state.cancels.lock().unwrap().insert(args.id.clone(), tx);
  let sent = tokio::select! {
    r = req.send() => Some(r),
    _ = rx => None,
  };
  state.cancels.lock().unwrap().remove(&args.id);
  let resp = match sent {
    None => return Err("ECANCELED: cancelled".into()),
    Some(Err(err)) => return Err(failure(&err)),
    Some(Ok(r)) => r,
  };
  let mut headers = HashMap::new();
  for (k, v) in resp.headers() {
    if let Ok(v) = v.to_str() {
      headers
        .entry(k.as_str().to_string())
        .and_modify(|e: &mut String| {
          e.push_str(", ");
          e.push_str(v);
        })
        .or_insert_with(|| v.to_string());
    }
  }
  let head = Head {
    status: resp.status().as_u16(),
    status_text: resp.status().canonical_reason().unwrap_or("").to_string(),
    headers,
  };
  state.open.lock().unwrap().insert(args.id, resp);
  Ok(head)
}

#[derive(serde::Serialize)]
pub struct Body {
  body: String,
}

#[tauri::command]
pub async fn http_body(state: tauri::State<'_, Requests>, id: String) -> Result<Body, String> {
  let resp = state.open.lock().unwrap().remove(&id).ok_or("ECANCELED: no such request")?;
  let (tx, rx) = oneshot::channel();
  state.cancels.lock().unwrap().insert(id.clone(), tx);
  let read = tokio::select! {
    r = resp.bytes() => Some(r),
    _ = rx => None,
  };
  state.cancels.lock().unwrap().remove(&id);
  match read {
    None => Err("ECANCELED: cancelled".into()),
    Some(Err(err)) => Err(failure(&err)),
    Some(Ok(bytes)) => Ok(Body { body: B64.encode(bytes) }),
  }
}

#[tauri::command]
pub fn http_cancel(state: tauri::State<'_, Requests>, id: String) {
  state.open.lock().unwrap().remove(&id);
  if let Some(tx) = state.cancels.lock().unwrap().remove(&id) {
    let _ = tx.send(());
  }
}
