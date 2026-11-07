// Before the app ends, the page's writes reach the disk (the close handshake).
//
// The page's saves are queued in its server (mobile/shims/fs.ts, in the
// worker beside the page): each one is three file commands here, and the
// queue may hold a vault of several megabytes that has not left the page
// yet. The Electron shell wrote synchronously in Node, so nothing was pending
// at its end; here the window closing, the tray's "Beenden" or a restart into
// an update would cut that queue off. So each of them first asks the page to
// put what it has on the disk (FLUSH_EVENT), and goes on once the page says it
// did (app_flushed) — or after LIMIT, a page that does not answer never
// keeping the app from ending. A page that has not said it listens (before it
// loaded: a start with Windows that ends at once, an update installed at
// start) is not waited for at all.
//
// leftover.rs end_process then waits for the file commands under way
// (files.rs settle), so the last one is not cut in half either.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, mpsc};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

/// How long the app waits for the page's answer.
const LIMIT: Duration = Duration::from_secs(3);
/// What the page listens for (desktop/host.ts).
pub const FLUSH_EVENT: &str = "girovo://flush";

#[derive(Default)]
pub struct Closing {
  /// The page listens for FLUSH_EVENT (app_flush_ready).
  listening: AtomicBool,
  /// The answer awaited, if a flush is asked for.
  waiting: Mutex<Option<mpsc::Sender<()>>>,
  /// The window's close may go through: the page has flushed.
  passed: AtomicBool,
}

/// Asks the page to flush, then runs `then` (off the main thread, whose loop
/// carries the page's answer) — at once where no page listens.
pub fn after_flush(app: &AppHandle, then: impl FnOnce(&AppHandle) + Send + 'static) {
  let closing = app.state::<Closing>();
  if !closing.listening.load(Ordering::SeqCst) || app.get_webview_window("main").is_none() {
    then(app);
    return;
  }
  let (tx, rx) = mpsc::channel();
  *closing.waiting.lock().unwrap() = Some(tx);
  if app.emit_to("main", FLUSH_EVENT, ()).is_err() {
    closing.waiting.lock().unwrap().take();
    then(app);
    return;
  }
  let app = app.clone();
  std::thread::spawn(move || {
    let _ = rx.recv_timeout(LIMIT);
    then(&app);
  });
}

/// Whether the window's close may go through now.
pub fn passed(app: &AppHandle) -> bool {
  app.state::<Closing>().passed.load(Ordering::SeqCst)
}

/// From now on the window's close goes through.
pub fn pass(app: &AppHandle) {
  app.state::<Closing>().passed.store(true, Ordering::SeqCst);
}

/// The page listens for FLUSH_EVENT.
#[tauri::command]
pub fn app_flush_ready(app: AppHandle) {
  app.state::<Closing>().listening.store(true, Ordering::SeqCst);
}

/// The page's answer: what it had is on the disk.
#[tauri::command]
pub fn app_flushed(app: AppHandle) {
  if let Some(tx) = app.state::<Closing>().waiting.lock().unwrap().take() {
    let _ = tx.send(());
  }
}
