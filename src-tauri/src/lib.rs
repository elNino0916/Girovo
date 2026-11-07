// Girovo's desktop shell on Tauri (6.0): a window onto the page, exported
// ahead of time like the Android app's (scripts/build-desktop.mjs), with the
// route handlers running inside it (desktop/server) and this process doing
// what a page cannot — reaching the bank past CORS, keeping files, secrets
// and preferences, the tray, the notifications, the updates.
//
// It replaces the Electron shell: every bridge the page knew there (window.electron*)
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
mod closing;
mod edition;
mod files;
mod frame;
mod hello;
mod http;
pub mod install_window;
mod leftover;
mod migrate;
mod model;
mod paths;
mod pdf;
mod prefs;
mod reset;
mod save;
mod secret;
mod secret_migration;
mod shell;
mod splash;
mod sync_lan;
mod telemetry;
mod telemetry_scrub;
mod texts;
mod updater;

use std::sync::Arc;
use std::sync::mpsc;
use std::time::Duration;

use tauri::webview::PageLoadEvent;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// Off the main thread, like the file commands (files.rs): a write the disk or a
/// virus scanner holds up must never stall the window.
#[tauri::command(async)]
fn prefs_set(state: tauri::State<'_, prefs::Prefs>, key: String, value: Option<String>) -> bool {
  // The consent and the install id are the telemetry hub's (telemetry::hub_key).
  if telemetry::hub_key(&key) {
    return false;
  }
  state.set(&key, value.as_deref())
}

/// How long the app's page may take to load before its window shows anyway.
const PAGE_LOAD_LIMIT: Duration = Duration::from_secs(30);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default().runtime(tauri_runtime_wry::Wry::default());
  // First: a second start (the Start menu, a click on a notice) brings the
  // running window forward instead. Not for a test run (GIROVO_DATA_DIR): a
  // copy of its own, which must never hand itself over to the installed app.
  let test_run = std::env::var_os("GIROVO_DATA_DIR").is_some_and(|d| !d.is_empty());
  let builder =
    if test_run { builder } else { builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| background::bring_forward(app))) };
  let app = builder
    .plugin(tauri_plugin_notification::init())
    .manage(prefs::Prefs::load())
    .manage(http::Requests::default())
    .manage(background::Background::default())
    .manage(closing::Closing::default())
    .manage(shell::Zoom::default())
    .plugin(updater::plugin())
    .manage(model::Model::default())
    .manage(Arc::new(sync_lan::LanShelf::default()))
    .manage(telemetry::Telemetry::default())
    .register_uri_scheme_protocol("girovo-shell", |_ctx, request| shell::serve_shell(request.uri().path()))
    .setup(|app| {
      // Before any window: a copy stuck on its way out would freeze this one's page (leftover.rs).
      leftover::end_stuck_copies();
      // First, so that a start that fails is reported too.
      app.state::<telemetry::Telemetry>().start(app.handle());
      // What the updater found before telemetry was up: this start being an update, say.
      updater::report_state(app.handle());
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

      // Updates (updater/): the install window takes over from the start
      // window once the app has quit for an installer, looking as it did; the
      // way back to 5.x takes the start with Windows away first, as Electron's
      // beforeInstall did (5.x would not know the entry's `--background`).
      let card = splash.clone();
      updater::set_install_window(&handle, move |started| {
        let (dark, lang, header, footer, steps) = match &card {
          Some(c) => c.install_view(),
          None => (false, texts::Lang::De, String::new(), String::new(), Vec::new()),
        };
        let options = install_window::Options {
          installer_pid: started.installer_pid,
          app_exe: started.app_exe.as_ref().map(|p| p.display().to_string()).unwrap_or_default(),
          version: started.version.clone(),
          releases_url: started.releases_url.clone(),
          dark,
          lang: Some(lang),
          header,
          footer,
          steps,
        };
        if let Err(err) = install_window::spawn(&options) {
          eprintln!("[updater] no install window: {err}");
        }
      });
      updater::get(&handle).on_before_install(|notice| {
        if notice.back {
          background::set_login_item(false);
        }
      });

      // The app's window, hidden until it is ready to be seen.
      let (loaded_tx, loaded) = mpsc::channel::<()>();
      let script = shell::boot_script(&prefs.snapshot(), &app.package_info().version.to_string());
      // Again while a copy that has just quit still holds WebView2's folder (shell.rs).
      shell::build_retrying(|| {
        let loaded_tx = loaded_tx.clone();
        let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()));
        if let Some(dir) = shell::webview_dir() {
          builder = builder.data_directory(dir);
        }
        builder
          .title(edition::name())
          .inner_size(1280.0, 840.0)
          .min_inner_size(900.0, 600.0)
          .center()
          .visible(false)
          // Windows: the page draws the title bar and its caption buttons (frame.rs). Linux keeps its own.
          .decorations(cfg!(not(windows)))
          .initialization_script(script.clone())
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
          .build()
      })?;
      frame::install(&handle);
      frame::watch_maximized(&handle);
      // With "Neue Umsätze melden" on, closing hides the window in the notification area.
      if let Some(w) = app.get_webview_window("main") {
        let closer = handle.clone();
        w.on_window_event(move |event| {
          if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            if background::hide_on_close(&closer) {
              api.prevent_close();
            } else if !closing::passed(&closer) {
              // The page's writes on the disk first (closing.rs), then the close again.
              api.prevent_close();
              closing::after_flush(&closer, |app| {
                closing::pass(app);
                if let Some(w) = app.get_webview_window("main") {
                  let _ = w.close();
                }
              });
            }
          }
        });
      }
      background::start(&handle);
      // The LAN shelf as the last start left it.
      sync_lan::start_if_on(&app.state::<Arc<sync_lan::LanShelf>>(), &prefs);

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
      model::model_files,
      model::model_read,
      model::model_open,
      model::model_run,
      model::model_release,
      pdf::pdf_export,
      save::file_save,
      shell::titlebar_set_theme,
      frame::caption_minimize,
      frame::caption_toggle_maximize,
      frame::caption_close,
      frame::caption_is_maximized,
      frame::caption_rect,
      shell::window_attention,
      shell::window_shown,
      reset::app_reset,
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
      closing::app_flush_ready,
      closing::app_flushed,
      updater::updater_set_auto,
      updater::updater_set_channel,
      updater::updater_open_release,
      sync_lan::sync_lan,
      sync_lan::sync_pick_folder,
      sync_lan::sync_device_name,
      telemetry::telemetry_shown,
      telemetry::telemetry_set_consent,
      telemetry::telemetry_event,
      telemetry::telemetry_error,
      telemetry::telemetry_relay,
    ])
    .build(tauri::generate_context!())
    .expect("error while running Girovo");
  let code = app.run_return(|app, event| {
    // Telemetry's last word, however the app ends: the last window closed,
    // the tray's "Beenden", an update (the Electron shell's main.cjs will-quit).
    if let tauri::RunEvent::Exit = event {
      app.state::<telemetry::Telemetry>().closing(app);
    }
  });
  // Past Tauri's cleanup (the plugins' exit hooks, the updater's installer
  // among them, then the windows hidden): the end, without the DLLs' exit code
  // a quitting copy once hung in (leftover.rs).
  leftover::end_process(code);
}

/// The start, off the main thread: the migration if this is the first start
/// after the Electron app, then the app's window once its page has loaded.
/// Without a start window (a start with Windows) the window stays hidden.
fn start(app: tauri::AppHandle, splash: Option<Arc<splash::Splash>>, migration: Option<Vec<&'static str>>, loaded: mpsc::Receiver<()>) {
  let Some(splash) = splash else { return };
  // An update at start (the Electron shell's main.cjs updateAtStart): its check runs
  // beside the rest of the start; what it found is installed before the app's
  // window opens — the app then quits for the installer.
  let updater = updater::get(&app);
  let check = updater.start_check(&*splash);
  if let Some(steps) = migration {
    migrate::run(&app, &splash, &app.state::<prefs::Prefs>(), steps);
  }
  let _ = loaded.recv_timeout(PAGE_LOAD_LIMIT);
  if updater.update_at_start_blocking(check, &*splash) {
    return;
  }
  splash.step("opening");
  splash.wait_held();
  let shown = splash.clone();
  let _ = app.clone().run_on_main_thread(move || {
    if let Some(w) = app.get_webview_window("main") {
      let _ = w.show();
      let _ = w.set_focus();
    }
    shell::tell_shown(&app, true);
    shown.close();
  });
}
