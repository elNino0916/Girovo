// Girovo's desktop shell on Tauri (6.0): a window onto the page, exported
// ahead of time like the Android app's (scripts/build-desktop.mjs), with the
// route handlers running inside it (desktop/server) and this process doing
// what a page cannot — reaching the bank past CORS, keeping files, secrets
// and preferences, the tray, the notifications, the updates.
//
// It replaces electron/: every bridge the page knew there (window.electron*)
// is offered again by src/bridge.js with the same shape, so the page itself
// does not know which shell it runs in.
//
// A start: the start window first (splash.rs) — on the first start after the
// Electron app, the migration screen in it (migrate.rs) — while the app's
// window loads hidden; that one shows once its page has loaded and the start
// window has been in view long enough, and the start window goes.

mod files;
mod frame;
mod http;
mod migrate;
mod paths;
mod prefs;
mod secret_migration;
mod shell;
mod splash;
mod texts;

use std::sync::Arc;
use std::sync::mpsc;
use std::time::Duration;

use tauri::webview::PageLoadEvent;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
fn prefs_set(state: tauri::State<'_, prefs::Prefs>, key: String, value: Option<String>) -> bool {
  state.set(&key, value.as_deref())
}

/// How long the app's page may take to load before its window shows anyway.
const PAGE_LOAD_LIMIT: Duration = Duration::from_secs(30);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .runtime(tauri_runtime_wry::Wry::default())
    .manage(prefs::Prefs::load())
    .manage(http::Requests::default())
    .register_uri_scheme_protocol("girovo-shell", |_ctx, request| shell::serve_shell(request.uri().path()))
    .setup(|app| {
      let handle = app.handle().clone();
      let prefs = app.state::<prefs::Prefs>();
      let lang = texts::lang(&prefs);
      let migration = migrate::needed(&prefs).then(migrate::steps);
      let splash = splash::Splash::open(
        &handle,
        lang,
        splash::dark(prefs.get("fints.theme")),
        app.package_info().version.to_string(),
        false,
        migration.clone().map(|steps| splash::Migrating { steps, at: 0, secret_failed: false }),
      )?;
      app.manage(splash.clone());

      // The app's window, hidden until it is ready to be seen.
      let (loaded_tx, loaded) = mpsc::channel::<()>();
      let script = shell::boot_script(&prefs.snapshot());
      let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()));
      if let Some(dir) = shell::webview_dir() {
        builder = builder.data_directory(dir);
      }
      builder
        .title("Girovo")
        .inner_size(1280.0, 840.0)
        .min_inner_size(900.0, 600.0)
        .center()
        .visible(false)
        // Windows: the page draws the title bar and its caption buttons (frame.rs). Linux keeps its own.
        .decorations(cfg!(not(windows)))
        .initialization_script(script)
        .additional_browser_args(&shell::browser_args())
        .on_page_load(move |_window, payload| {
          if payload.event() == PageLoadEvent::Finished {
            let _ = loaded_tx.send(());
          }
        })
        .on_new_window(|url, _features| {
          // A link the page opens in a new window goes to the browser, never into the app.
          shell::open_external(url.as_str());
          tauri::webview::NewWindowResponse::Deny
        })
        .build()?;
      frame::install(&handle);
      frame::watch_maximized(&handle);

      std::thread::spawn(move || start(handle, splash, migration, loaded));
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
      splash::splash_fit,
    ])
    .run(tauri::generate_context!())
    .expect("error while running Girovo");
}

/// The start, off the main thread: the migration if this is the first start
/// after the Electron app, then the app's window once its page has loaded.
fn start(app: tauri::AppHandle, splash: Arc<splash::Splash>, migration: Option<Vec<&'static str>>, loaded: mpsc::Receiver<()>) {
  if let Some(steps) = migration {
    migrate::run(&app, &splash, &app.state::<prefs::Prefs>(), steps);
  }
  let _ = loaded.recv_timeout(PAGE_LOAD_LIMIT);
  splash.step("opening");
  splash.wait_held();
  let shown = splash.clone();
  let _ = app.clone().run_on_main_thread(move || {
    if let Some(w) = app.get_webview_window("main") {
      let _ = w.show();
      let _ = w.set_focus();
    }
    shown.close();
  });
}
