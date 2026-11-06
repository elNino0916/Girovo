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

/// What the page needs before its first script runs: the preferences (read
/// synchronously, the theme before the first frame), the platform, then the bridges.
pub fn boot_script(prefs: &BTreeMap<String, String>) -> String {
  let boot = serde_json::json!({
    "prefs": prefs,
    "platform": std::env::consts::OS,
    "version": env!("CARGO_PKG_VERSION"),
  });
  format!("window.__GIROVO_BOOT__ = {boot};\n{BRIDGE}")
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

/// SessionGuard's last minute: the taskbar button flashes until the window is in front again.
#[tauri::command]
pub fn window_attention(app: tauri::AppHandle, on: bool) {
  if let Some(w) = app.get_webview_window("main") {
    let kind = if on { Some(tauri::UserAttentionType::Informational) } else { None };
    let _ = w.request_user_attention(kind);
  }
}
