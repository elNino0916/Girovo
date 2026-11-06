// Girovo's desktop shell on Tauri (6.0): a window onto the page, exported
// ahead of time like the Android app's (scripts/build-desktop.mjs), with the
// route handlers running inside it (desktop/server) and this process doing
// what a page cannot — reaching the bank past CORS, keeping files, secrets
// and preferences, the tray, the notifications, the updates.
//
// It replaces electron/: every bridge the page knew there (window.electron*)
// is offered again by src/bridge.js with the same shape, so the page itself
// does not know which shell it runs in.

mod files;
mod frame;
mod http;
mod paths;
mod prefs;
mod shell;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
fn prefs_set(state: tauri::State<'_, prefs::Prefs>, key: String, value: Option<String>) -> bool {
  state.set(&key, value.as_deref())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .runtime(tauri_runtime_wry::Wry::default())
    .manage(prefs::Prefs::load())
    .manage(http::Requests::default())
    .setup(|app| {
      let script = shell::boot_script(&app.state::<prefs::Prefs>().snapshot());
      let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Girovo")
        .inner_size(1280.0, 840.0)
        .min_inner_size(900.0, 600.0)
        // Windows: the page draws the title bar and its caption buttons (frame.rs). Linux keeps its own.
        .decorations(cfg!(not(windows)))
        .initialization_script(script)
        .additional_browser_args(&shell::browser_args())
        .on_new_window(|url, _features| {
          // A link the page opens in a new window goes to the browser, never into the app.
          shell::open_external(url.as_str());
          tauri::webview::NewWindowResponse::Deny
        })
        .build()?;
      let _ = window;
      frame::install(app.handle());
      frame::watch_maximized(app.handle());
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      prefs_set,
      files::fs_list,
      files::fs_read,
      files::fs_write,
      files::fs_delete,
      files::fs_rename,
      files::folder_get,
      files::folder_put,
      http::http_open,
      http::http_body,
      http::http_cancel,
      shell::titlebar_set_theme,
      frame::caption_minimize,
      frame::caption_toggle_maximize,
      frame::caption_close,
      frame::caption_is_maximized,
      frame::caption_rect,
      shell::window_attention,
      shell::open_url,
    ])
    .run(tauri::generate_context!())
    .expect("error while running Girovo");
}
