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
// window has been in view long enough, and the start window goes. A start
// with Windows for "Neue Umsätze melden" (`--background`) shows neither: Girovo
// waits in the notification area (background.rs).

mod background;
mod files;
mod frame;
mod hello;
mod http;
pub mod install_window;
mod migrate;
mod paths;
mod prefs;
mod secret;
mod secret_migration;
mod shell;
mod splash;
mod texts;
mod updater;

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
    // First: a second start (the Start menu, a click on a notice) brings the running window forward instead.
    .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| background::show_window(app)))
    .plugin(tauri_plugin_notification::init())
    .manage(prefs::Prefs::load())
    .manage(http::Requests::default())
    .manage(background::Background::default())
    .manage(shell::Zoom::default())
    .plugin(updater::plugin())
    .register_uri_scheme_protocol("girovo-shell", |_ctx, request| shell::serve_shell(request.uri().path()))
    .setup(|app| {
      let handle = app.handle().clone();
      let prefs = app.state::<prefs::Prefs>();
      let lang = texts::lang(&prefs);
      let hidden = background::started_hidden();
      // Started with Windows by an entry the checks no longer want: the entry
      // goes, and so does this start, which nobody asked to see.
      if hidden && !background::enabled(&handle) {
        background::set_login_item(false);
        handle.exit(0);
        return Ok(());
      }
      let mut migration = migrate::needed(&prefs).then(migrate::steps);
      if hidden {
        if let Some(steps) = migration.take() {
          migrate::run_unseen(&prefs, &steps);
        }
      }
      let splash = if hidden {
        None
      } else {
        let s = splash::Splash::open(
          &handle,
          lang,
          splash::dark(prefs.get("fints.theme")),
          app.package_info().version.to_string(),
          false,
          migration.clone().map(|steps| splash::Migrating { steps, at: 0, secret_failed: false }),
        )?;
        app.manage(s.clone());
        Some(s)
      };

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
      // With "Neue Umsätze melden" on, closing hides the window in the notification area.
      if let Some(w) = app.get_webview_window("main") {
        let closer = handle.clone();
        w.on_window_event(move |event| {
          if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            if background::hide_on_close(&closer) {
              api.prevent_close();
            }
          }
        });
      }
      background::start(&handle);

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
      shell::zoom_step,
      shell::open_url,
      splash::splash_fit,
      background::background_set,
      background::background_result,
      hello::hello_available,
      hello::hello_enroll,
      hello::hello_unlock,
      secret::linked_unlock_secret,
      secret::migrate_secret,
      updater::updater_get,
      updater::updater_check,
      updater::updater_download,
      updater::updater_cancel,
      updater::updater_install,
      updater::updater_restart,
      updater::updater_set_auto,
      updater::updater_set_channel,
      updater::updater_open_release,
    ])
    .run(tauri::generate_context!())
    .expect("error while running Girovo");
}

/// The start, off the main thread: the migration if this is the first start
/// after the Electron app, then the app's window once its page has loaded.
/// Without a start window (a start with Windows) the window stays hidden.
fn start(app: tauri::AppHandle, splash: Option<Arc<splash::Splash>>, migration: Option<Vec<&'static str>>, loaded: mpsc::Receiver<()>) {
  let Some(splash) = splash else { return };
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
