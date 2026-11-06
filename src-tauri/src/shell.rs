// The window's small services: the initialization script with the bridges
// and the preferences in it, the WebView's flags, links to the browser, the
// taskbar flash.

use std::collections::BTreeMap;

use tauri::Manager;

/// The page's bridges (window.electron*), the same shape electron/preload.cjs gave them.
const BRIDGE: &str = include_str!("bridge.js");

/// WebView2's flags: Tauri's own defaults, and no timer throttling while the
/// window is hidden or covered — the approval poll and the six-hourly check
/// run in the page now, and must not slow to a crawl behind another window.
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
  --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows";

/// The flags; a debug build also opens the page to DevTools on port 9350 (local
/// only), or on GIROVO_DEVTOOLS_PORT when several debug builds run at once.
pub fn browser_args() -> String {
  if cfg!(debug_assertions) {
    let port = std::env::var("GIROVO_DEVTOOLS_PORT").ok().and_then(|p| p.parse::<u16>().ok()).unwrap_or(9350);
    format!("{BROWSER_ARGS} --remote-debugging-port={port}")
  } else {
    BROWSER_ARGS.to_string()
  }
}

/// WebView2's own folder. A test run (GIROVO_DATA_DIR) keeps it inside its
/// data folder: every process on one WebView2 folder must start it with the
/// same flags, so two debug builds side by side (each with its DevTools port)
/// would refuse each other otherwise (0x8007139F). A real install keeps Tauri's.
pub fn webview_dir() -> Option<std::path::PathBuf> {
  std::env::var_os("GIROVO_DATA_DIR").filter(|d| !d.is_empty()).map(|d| std::path::PathBuf::from(d).join("webview2"))
}

/// What the page needs before its first script runs: the preferences (read
/// synchronously, the theme before the first frame), the platform, then the bridges.
pub fn boot_script(prefs: &BTreeMap<String, String>, version: &str) -> String {
  let boot = serde_json::json!({
    "prefs": prefs,
    "platform": std::env::consts::OS,
    // The app's version as package.json has it — a nightly's with its stamp — not Cargo's.
    "version": version,
  });
  format!("window.__GIROVO_BOOT__ = {boot};\n{BRIDGE}")
}

/// The shell's own pages (girovo-shell:), served from the binary: the start
/// window's card and its font. Nothing else is there.
pub fn serve_shell(path: &str) -> tauri::http::Response<Vec<u8>> {
  let (body, kind): (&[u8], &str) = match path {
    "/splash.html" => (include_bytes!("../shell/splash.html"), "text/html; charset=utf-8"),
    "/fonts/google-sans-flex-latin.woff2" => (include_bytes!("../shell/fonts/google-sans-flex-latin.woff2"), "font/woff2"),
    _ => {
      return tauri::http::Response::builder().status(404).body(Vec::new()).unwrap();
    }
  };
  tauri::http::Response::builder()
    .header("Content-Type", kind)
    .header("Cache-Control", "no-store")
    .body(body.to_vec())
    .unwrap()
}

/// Opens a link outside the app: http(s) and mailto only.
pub fn open_external(url: &str) {
  let allowed = url.starts_with("https://") || url.starts_with("http://") || url.starts_with("mailto:");
  if allowed {
    let _ = open::that_detached(url);
  }
}

#[tauri::command]
pub fn open_url(url: String) {
  open_external(&url);
}

/// The frame's colours follow the page's theme (electron/main.cjs barColors). Native frame for now: nothing to colour.
#[tauri::command]
pub fn titlebar_set_theme(_dark: bool, _dim: u32) {}

/// The window's zoom level (electron/zoom.cjs): 1.2^level, in half steps from
/// −4 (≈ 48 %) to 4 (≈ 207 %), every start at 100 %.
#[derive(Default)]
pub struct Zoom(std::sync::Mutex<f64>);

/// Strg++ / Strg+- / Strg+0 (src/bridge.js reads the keys by the character they type).
#[tauri::command]
pub fn zoom_step(app: tauri::AppHandle, state: tauri::State<'_, Zoom>, command: String) -> f64 {
  let mut level = state.0.lock().unwrap();
  *level = match command.as_str() {
    "in" => (*level + 0.5).min(4.0),
    "out" => (*level - 0.5).max(-4.0),
    _ => 0.0,
  };
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.set_zoom(1.2f64.powf(*level));
  }
  *level
}

/// SessionGuard's last minute: the taskbar button flashes until the window is in front again.
#[tauri::command]
pub fn window_attention(app: tauri::AppHandle, on: bool) {
  if let Some(w) = app.get_webview_window("main") {
    let kind = if on { Some(tauri::UserAttentionType::Informational) } else { None };
    let _ = w.request_user_attention(kind);
  }
}
