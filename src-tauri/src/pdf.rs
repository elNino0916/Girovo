// The PDF export for window.electronPDF (bridge.js; components/Statement.tsx):
// the window's page as a PDF, printed with its print stylesheet — the
// Kontoauszug, a Buchungsbeleg, a Mitteilung, the Steuer-Jahresübersicht —
// then a native Save As (electron/main.cjs pdf:export).
//
// The page could call window.print(), but on Windows that hands the PDF to the
// OS print dialog's "Microsoft Print to PDF" printer, whose driver is a
// separate OS component that fails on some machines ("Configuration error.
// 0x80070002"). So the PDF comes straight out of the engine instead, as
// Electron's webContents.printToPDF did — and through the very call it made:
// the DevTools protocol's Page.printToPDF, which WebView2 offers every app
// for its own page (ICoreWebView2::CallDevToolsProtocolMethod, no DevTools
// window involved), with Electron's settings: backgrounds printed, the CSS
// @page size and margins preferred (app/globals.css: A4 with its Heftrand),
// Letter and 0.4 inch margins only for a page that names none. WebView2's
// own ICoreWebView2_7::PrintToPdf has no such "prefer the CSS page size"
// setting: it is told a paper size.
//
// Linux has no such call in WebKitGTK; bridge.js offers no electronPDF there,
// and the page prints through window.print() — GTK's print dialog, which has
// "Print to File" (PDF) among its printers.

use crate::save::{Answer, Filter, bare_name, save_dialog};
use crate::texts::Files;

/// webContents.printToPDF's settings as Electron sends them, with
/// `{ printBackground: true, preferCSSPageSize: true }`.
#[cfg(windows)]
const PRINT_TO_PDF: &str = r#"{"landscape":false,"displayHeaderFooter":false,"headerTemplate":"","footerTemplate":"","printBackground":true,"scale":1,"paperWidth":8.5,"paperHeight":11,"marginTop":0.4,"marginBottom":0.4,"marginLeft":0.4,"marginRight":0.4,"pageRanges":"","preferCSSPageSize":true,"transferMode":"ReturnAsBase64"}"#;

/// The window's page as a PDF: its bytes, or why not.
#[cfg(windows)]
async fn print_to_pdf(window: &tauri::WebviewWindow) -> Result<Vec<u8>, String> {
  use std::sync::{Arc, Mutex};

  use base64::Engine;
  use base64::engine::general_purpose::STANDARD as B64;
  use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
  use windows::core::{HSTRING, PCWSTR};

  type Reply = tokio::sync::oneshot::Sender<Result<String, String>>;
  let (tx, rx) = tokio::sync::oneshot::channel();
  // Answered once, by the completion handler or by the call failing first.
  let reply: Arc<Mutex<Option<Reply>>> = Arc::new(Mutex::new(Some(tx)));
  let answer = |reply: &Arc<Mutex<Option<Reply>>>, result: Result<String, String>| {
    if let Some(tx) = reply.lock().unwrap().take() {
      let _ = tx.send(result);
    }
  };
  let on_main = Arc::clone(&reply);
  window
    .with_webview(move |webview| {
      // On the main thread, where WebView2 lives; the handler is called there too, later.
      let started = (|| -> Result<(), String> {
        let wv = webview.downcast_ref::<tauri_runtime_wry::Webview>().ok_or("no WebView2 here")?;
        let core = unsafe { wv.controller().CoreWebView2() }.map_err(|e| e.message())?;
        let done = Arc::clone(&on_main);
        let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, json| {
          answer(&done, result.map(|()| json).map_err(|e| e.message()));
          Ok(())
        }));
        let method = HSTRING::from("Page.printToPDF");
        let params = HSTRING::from(PRINT_TO_PDF);
        unsafe { core.CallDevToolsProtocolMethod(PCWSTR(method.as_ptr()), PCWSTR(params.as_ptr()), &handler) }.map_err(|e| e.message())
      })();
      if let Err(err) = started {
        answer(&on_main, Err(err));
      }
    })
    .map_err(|e| e.to_string())?;
  let json = rx.await.map_err(|_| "the window went away".to_string())??;
  let data = serde_json::from_str::<serde_json::Value>(&json)
    .ok()
    .and_then(|v| v.get("data").and_then(|d| d.as_str()).map(str::to_owned))
    .ok_or("no PDF in the answer")?;
  B64.decode(data.as_bytes()).map_err(|e| e.to_string())
}

#[cfg(not(windows))]
async fn print_to_pdf(_window: &tauri::WebviewWindow) -> Result<Vec<u8>, String> {
  Err("PDF export is not available here".into())
}

#[tauri::command]
pub async fn pdf_export(app: tauri::AppHandle, window: tauri::WebviewWindow, suggested_name: String) -> Result<Answer, ()> {
  let data = match print_to_pdf(&window).await {
    Ok(d) => d,
    Err(err) => return Ok(Answer::failed(err)),
  };
  let filter = Filter { name: Files::now(&app).pdf_document, extensions: &["pdf"] };
  // Where the system opens a Save As, the name filled in — as electron/main.cjs left it.
  let Some(path) = save_dialog(&app, window, None, bare_name(&suggested_name).to_string(), filter).await else {
    return Ok(Answer::canceled());
  };
  Ok(match std::fs::write(&path, data) {
    Ok(()) => Answer::saved_at(&path),
    Err(err) => Answer::failed(err.to_string()),
  })
}
