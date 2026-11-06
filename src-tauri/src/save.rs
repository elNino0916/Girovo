// Saving a file the app made — the CSV export, a GiroCode, the Steuer-
// Jahresübersicht's ZIP, a backup — for window.electronFiles (bridge.js,
// lib/download.ts saveFile), as the Electron shell's file-save.cjs did it.
//
// A native Save As in Downloads with the type's filter, then the bytes are
// written here, so the page hears whether the file exists or the dialog was
// dismissed, and only then says "gespeichert". A plain <a download> cannot
// tell it either. Only the types the app produces, a bare file name, and a
// size no export comes near. What it says, it says in the shell's language at
// the time (texts.rs).
//
// The bytes come as the request's raw body (Tauri's IPC sends a Uint8Array
// as it is), the suggested name URI-encoded in a header beside them.

use std::path::{Path, PathBuf};

use tauri::Manager;
use tauri::ipc::InvokeBody;

use crate::texts::Files;

/// The largest file it writes. A year of bookings is well under 1 MB; a
/// backup carries every kept document of a login (48 MB at most, lib/docs.ts)
/// and its kept Umsätze beside them.
pub const SAVE_MAX_BYTES: usize = 128 * 1024 * 1024;

/// The header bridge.js puts the suggested name in, URI-encoded.
const NAME_HEADER: &str = "girovo-name";

/// What a save answers the page: `{ ok: true }`, `{ ok: false, canceled: true }`
/// or `{ ok: false, error }` — and the PDF export `{ ok: true, filePath }`.
#[derive(serde::Serialize, Debug, PartialEq)]
pub struct Answer {
  ok: bool,
  #[serde(skip_serializing_if = "Option::is_none")]
  canceled: Option<bool>,
  #[serde(skip_serializing_if = "Option::is_none")]
  error: Option<String>,
  #[serde(rename = "filePath", skip_serializing_if = "Option::is_none")]
  file_path: Option<String>,
}

impl Answer {
  pub fn saved() -> Self {
    Answer { ok: true, canceled: None, error: None, file_path: None }
  }
  pub fn saved_at(path: &Path) -> Self {
    Answer { file_path: Some(path.to_string_lossy().into_owned()), ..Answer::saved() }
  }
  pub fn canceled() -> Self {
    Answer { ok: false, canceled: Some(true), error: None, file_path: None }
  }
  pub fn failed(error: impl Into<String>) -> Self {
    Answer { ok: false, canceled: None, error: Some(error.into()), file_path: None }
  }
}

/// A Save As's one filter: its name in the shell's language, and the extensions.
#[derive(Debug, PartialEq)]
pub struct Filter {
  pub name: &'static str,
  pub extensions: &'static [&'static str],
}

/// The types the app saves, by lower-case extension ('.csv' …): the Electron shell's main.cjs downloadFilters.
pub fn filter_for(ext: &str, t: &Files) -> Option<Filter> {
  let (name, extensions): (&'static str, &'static [&'static str]) = match ext {
    ".csv" => (t.csv, &["csv"]),
    ".png" => (t.png, &["png"]),
    ".pdf" => (t.pdf, &["pdf"]),
    // The Steuer-Jahresübersicht's receipts, and a backup of the saved data.
    ".zip" => (t.zip, &["zip"]),
    ".girovo" => (t.backup, &["girovo"]),
    _ => return None,
  };
  Some(Filter { name, extensions })
}

/// Node's path.extname of a bare name: from the last dot on — none for a name
/// that starts with its only dot (".csv") or for "..".
pub fn extname(name: &str) -> &str {
  match name.rfind('.') {
    Some(dot) if dot > 0 && name != ".." => &name[dot..],
    _ => "",
  }
}

/// The last segment on either separator, whatever the platform's own is; "Download" for none.
pub fn bare_name(suggested: &str) -> &str {
  match suggested.rsplit(['/', '\\']).next() {
    Some(n) if !n.is_empty() => n,
    _ => "Download",
  }
}

/// What the dialog is asked: a name and the filter of its type — or the
/// refusal, before any dialog, of a type the app does not make, of no bytes,
/// or of too many.
pub fn ask(suggested: &str, bytes: Option<&[u8]>, texts: &Files) -> Result<(String, Filter), Answer> {
  let name = bare_name(suggested);
  let filter = filter_for(&extname(name).to_lowercase(), texts);
  match (filter, bytes) {
    (Some(filter), Some(b)) if b.len() <= SAVE_MAX_BYTES => Ok((name.to_string(), filter)),
    _ => Err(Answer::failed(texts.save_failed)),
  }
}

/// A failed write, said so the user knows what to do. Windows refuses to
/// replace a file another program holds open — the usual case being last
/// month's export still open in Excel.
pub fn write_failed(err: &std::io::Error, texts: &Files) -> Answer {
  let busy = err.kind() == std::io::ErrorKind::ResourceBusy || (cfg!(windows) && matches!(err.raw_os_error(), Some(32 | 33)));
  Answer::failed(if busy { texts.open_elsewhere } else { texts.not_there })
}

/// The native Save As, in front of `window`: in `dir` (or where the system
/// opens it), the name filled in, one filter. The chosen path, or None for a
/// dismissed dialog.
pub async fn save_dialog(app: &tauri::AppHandle, window: tauri::WebviewWindow, dir: Option<PathBuf>, name: String, filter: Filter) -> Option<PathBuf> {
  // A debug build's test run answers the dialog itself: GIROVO_TEST_SAVE_AS
  // names the folder the file goes to under its suggested name, or "cancel".
  if cfg!(debug_assertions) {
    if let Some(answer) = std::env::var_os("GIROVO_TEST_SAVE_AS").filter(|a| !a.is_empty()) {
      return (answer != "cancel").then(|| PathBuf::from(answer).join(&name));
    }
  }
  let (tx, rx) = tokio::sync::oneshot::channel();
  // Made on the main thread, as GTK wants it; awaited off it (tauri-plugin-dialog's way).
  let made = app.run_on_main_thread(move || {
    let mut dialog = rfd::AsyncFileDialog::new().set_parent(&window).set_file_name(name).add_filter(filter.name, filter.extensions);
    if let Some(dir) = dir {
      dialog = dialog.set_directory(dir);
    }
    let saving = dialog.save_file();
    std::thread::spawn(move || {
      let _ = tx.send(tauri::async_runtime::block_on(saving));
    });
  });
  if made.is_err() {
    return None;
  }
  rx.await.ok().flatten().map(|h| h.path().to_path_buf())
}

/// What a header carries URI-encoded (encodeURIComponent), decoded.
fn uri_decode(text: &str) -> String {
  let bytes = text.as_bytes();
  let mut out = Vec::with_capacity(bytes.len());
  let mut i = 0;
  while i < bytes.len() {
    let hex = |b: u8| (b as char).to_digit(16);
    if bytes[i] == b'%' && i + 2 < bytes.len() {
      if let (Some(h), Some(l)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
        out.push((h * 16 + l) as u8);
        i += 3;
        continue;
      }
    }
    out.push(bytes[i]);
    i += 1;
  }
  String::from_utf8_lossy(&out).into_owned()
}

#[tauri::command]
pub async fn file_save(app: tauri::AppHandle, window: tauri::WebviewWindow, request: tauri::ipc::Request<'_>) -> Result<Answer, ()> {
  let texts = &Files::now(&app);
  let suggested = request.headers().get(NAME_HEADER).and_then(|v| v.to_str().ok()).map(uri_decode).unwrap_or_default();
  // Anything but bytes arrives as JSON: refused before any dialog (bridge.js sends `{}` then).
  let bytes = match request.body() {
    InvokeBody::Raw(b) => Some(b.as_slice()),
    InvokeBody::Json(_) => None,
  };
  let (name, filter) = match ask(&suggested, bytes, texts) {
    Ok(asked) => asked,
    Err(refused) => return Ok(refused),
  };
  let Some(path) = save_dialog(&app, window, dirs::download_dir(), name, filter).await else {
    return Ok(Answer::canceled());
  };
  let texts = &Files::now(&app);
  Ok(match std::fs::write(&path, bytes.unwrap_or_default()) {
    Ok(()) => Answer::saved(),
    Err(err) => write_failed(&err, texts),
  })
}

// ---------------------------------------------------------------------------
// UTF-16, as the page counts a string's length

/// The length JavaScript gives `s`.
pub fn utf16_len(s: &str) -> usize {
  s.chars().map(char::len_utf16).sum()
}

/// `s` cut to at most `max` UTF-16 units, as String.prototype.slice(0, max) — never in the middle of a character.
pub fn utf16_prefix(s: &str, max: usize) -> &str {
  let mut units = 0;
  for (i, c) in s.char_indices() {
    units += c.len_utf16();
    if units > max {
      return &s[..i];
    }
  }
  s
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::texts::Lang;

  fn de() -> Files {
    Files::of(Lang::De)
  }

  #[test]
  fn asks_with_the_name_and_the_types_filter() {
    let (name, filter) = ask("Umsaetze_345932.csv", Some(&[0xef, 0xbb, 0xbf, 0x41]), &de()).unwrap();
    assert_eq!(name, "Umsaetze_345932.csv");
    assert_eq!(filter, Filter { name: "CSV-Datei", extensions: &["csv"] });
    assert_eq!(ask("Steuer.ZIP", Some(&[1]), &Files::of(Lang::En)).unwrap().1, Filter { name: "ZIP archive", extensions: &["zip"] });
    assert_eq!(ask("Sicherung.girovo", Some(&[]), &de()).unwrap().1.name, "Girovo-Sicherung");
  }

  #[test]
  fn the_suggested_name_is_reduced_to_a_file_name() {
    assert_eq!(ask("..\\..\\Windows\\evil.csv", Some(&[1]), &de()).unwrap().0, "evil.csv");
    assert_eq!(ask("../../etc/evil.csv", Some(&[1]), &de()).unwrap().0, "evil.csv");
    assert_eq!(bare_name(""), "Download");
    assert_eq!(bare_name("dir/"), "Download");
  }

  #[test]
  fn only_the_types_the_app_makes_real_bytes_and_a_sane_size_refused_before_any_dialog() {
    let big = vec![0u8; SAVE_MAX_BYTES + 1];
    for (name, data) in [("run.exe", Some(&[1u8][..])), ("notes", Some(&[1u8][..])), (".csv", Some(&[1u8][..])), ("a.csv", None), ("a.csv", Some(&big[..]))] {
      assert_eq!(ask(name, data, &de()), Err(Answer::failed("Die Datei konnte nicht gespeichert werden.")), "{name}");
    }
    assert_eq!(ask("a.csv", None, &Files::of(Lang::En)), Err(Answer::failed("The file could not be saved.")));
  }

  #[test]
  fn a_failed_write_says_what_to_do_in_german_a_file_open_in_excel_by_name() {
    let busy = std::io::Error::from_raw_os_error(if cfg!(windows) { 32 } else { 16 });
    let denied = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
    let a = write_failed(&busy, &de());
    assert!(a.error.as_deref().unwrap().contains("in einem anderen Programm geöffnet, zum Beispiel in Excel"));
    let b = write_failed(&denied, &de());
    assert!(b.error.as_deref().unwrap().starts_with("Die Datei konnte dort nicht gespeichert werden"));
    assert!(!b.error.as_deref().unwrap().contains("EACCES"));
  }

  #[test]
  fn answers_have_the_preloads_shapes() {
    assert_eq!(serde_json::to_value(Answer::saved()).unwrap(), serde_json::json!({ "ok": true }));
    assert_eq!(serde_json::to_value(Answer::canceled()).unwrap(), serde_json::json!({ "ok": false, "canceled": true }));
    assert_eq!(serde_json::to_value(Answer::failed("x")).unwrap(), serde_json::json!({ "ok": false, "error": "x" }));
    assert_eq!(serde_json::to_value(Answer::saved_at(Path::new("a.pdf"))).unwrap(), serde_json::json!({ "ok": true, "filePath": "a.pdf" }));
  }

  #[test]
  fn extname_is_nodes() {
    assert_eq!(extname("a.csv"), ".csv");
    assert_eq!(extname("a.tar.gz"), ".gz");
    assert_eq!(extname(".csv"), "");
    assert_eq!(extname(".."), "");
    assert_eq!(extname("a."), ".");
    assert_eq!(extname("...csv"), ".csv");
    assert_eq!(extname("notes"), "");
  }

  #[test]
  fn uri_names_come_back_whole() {
    assert_eq!(uri_decode("Ums%C3%A4tze%20Oktober.csv"), "Umsätze Oktober.csv");
    assert_eq!(uri_decode("100%"), "100%");
    assert_eq!(uri_decode("a%2"), "a%2");
  }

  #[test]
  fn utf16_as_javascript_counts() {
    assert_eq!(utf16_len("a😀"), 3);
    assert_eq!(utf16_prefix("a😀b", 2), "a");
    assert_eq!(utf16_prefix("a😀b", 3), "a😀");
    assert_eq!(utf16_prefix("abc", 5), "abc");
  }
}
