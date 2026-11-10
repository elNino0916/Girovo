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
// One wait at a time: whoever asks while the page is still writing (the X
// clicked twice, the X and then the tray's "Beenden") joins the wait under
// way and goes on with it. A second ask never ends the first one early — it
// once did, and the app ended before the page had written.
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

/// What goes on once the page has flushed.
type Then = Box<dyn FnOnce(&AppHandle) + Send>;

#[derive(Default)]
pub struct Closing {
  /// The page listens for FLUSH_EVENT (app_flush_ready).
  listening: AtomicBool,
  /// Who waits for the page's answer, if a flush is asked for.
  waiting: Waiting<Then>,
  /// The window's close may go through: the page has flushed.
  passed: AtomicBool,
}

/// The one wait for the page's answer and everyone in it.
struct Waiting<T>(Mutex<Option<Wait<T>>>);

struct Wait<T> {
  /// Tells the thread that waits: the page has answered.
  answered: mpsc::Sender<()>,
  /// What goes on when the wait is over, in the order asked.
  thens: Vec<T>,
}

impl<T> Default for Waiting<T> {
  fn default() -> Self {
    Waiting(Mutex::new(None))
  }
}

impl<T> Waiting<T> {
  /// Adds `then` to the wait under way (None), or starts one: then the
  /// caller asks the page and waits on what comes back (over()).
  fn join(&self, then: T) -> Option<mpsc::Receiver<()>> {
    let mut wait = self.0.lock().unwrap();
    if let Some(wait) = wait.as_mut() {
      wait.thens.push(then);
      return None;
    }
    let (answered, answer) = mpsc::channel();
    *wait = Some(Wait { answered, thens: vec![then] });
    Some(answer)
  }

  /// The page's answer. The wait stays until its thread ends it, so whoever
  /// asks in between still joins it.
  fn answer(&self) {
    if let Some(wait) = self.0.lock().unwrap().as_ref() {
      let _ = wait.answered.send(());
    }
  }

  /// Ends the wait: everyone in it. The next ask starts a new one.
  fn end(&self) -> Vec<T> {
    self.0.lock().unwrap().take().map(|wait| wait.thens).unwrap_or_default()
  }

  /// Waits for the answer, `limit` at most, and ends the wait.
  fn over(&self, answer: mpsc::Receiver<()>, limit: Duration) -> Vec<T> {
    let _ = answer.recv_timeout(limit);
    self.end()
  }
}

/// Asks the page to flush, then runs `then` (off the main thread, whose loop
/// carries the page's answer) — at once where no page listens. While a flush
/// is under way, `then` runs with it.
pub fn after_flush(app: &AppHandle, then: impl FnOnce(&AppHandle) + Send + 'static) {
  let closing = app.state::<Closing>();
  if !closing.listening.load(Ordering::SeqCst) || app.get_webview_window("main").is_none() {
    then(app);
    return;
  }
  let Some(answer) = closing.waiting.join(Box::new(then)) else { return };
  if app.emit_to("main", FLUSH_EVENT, ()).is_err() {
    for then in closing.waiting.end() {
      then(app);
    }
    return;
  }
  let app = app.clone();
  std::thread::spawn(move || {
    for then in app.state::<Closing>().waiting.over(answer, LIMIT) {
      then(&app);
    }
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
  app.state::<Closing>().waiting.answer();
}

#[cfg(test)]
mod tests {
  use std::sync::Arc;
  use std::time::Instant;

  use super::*;

  #[test]
  fn a_second_request_joins_the_wait_and_does_not_release_the_first_early() {
    let waiting = Arc::new(Waiting::<u8>::default());
    let answer = waiting.join(1).expect("the first ask starts the wait");
    let (done, ended) = mpsc::channel();
    let waiter = waiting.clone();
    std::thread::spawn(move || {
      let _ = done.send(waiter.over(answer, Duration::from_secs(30)));
    });
    // The X again, the tray's "Beenden": no new wait, and the first goes on waiting.
    assert!(waiting.join(2).is_none());
    assert!(waiting.join(3).is_none());
    assert!(ended.recv_timeout(Duration::from_millis(300)).is_err(), "released before the page answered");
    // The page's answer releases all of them, in the order asked.
    waiting.answer();
    assert_eq!(ended.recv_timeout(Duration::from_secs(10)).unwrap(), [1, 2, 3]);
    // Over: the next ask starts a wait of its own.
    assert!(waiting.join(4).is_some());
  }

  #[test]
  fn a_page_that_does_not_answer_holds_everyone_for_the_limit_and_no_longer() {
    let waiting = Waiting::<u8>::default();
    let answer = waiting.join(1).unwrap();
    assert!(waiting.join(2).is_none());
    let started = Instant::now();
    assert_eq!(waiting.over(answer, Duration::from_millis(120)), [1, 2]);
    assert!(started.elapsed() >= Duration::from_millis(110), "{:?}", started.elapsed());
    // An answer that comes late finds nobody waiting and starts nothing.
    waiting.answer();
    assert!(waiting.end().is_empty());
  }

  #[test]
  fn an_answer_before_the_wait_began_is_not_lost() {
    let waiting = Waiting::<u8>::default();
    let answer = waiting.join(1).unwrap();
    waiting.answer();
    let started = Instant::now();
    assert_eq!(waiting.over(answer, Duration::from_secs(30)), [1]);
    assert!(started.elapsed() < Duration::from_secs(10));
  }
}
