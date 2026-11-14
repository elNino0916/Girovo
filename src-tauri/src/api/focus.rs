// Girovo's window comes forward for the API's consent dialog and for an
// approval inside Girovo (docs/girovo-api.md "The dialog"): out of the tray
// when it hid there, restored when minimised, then in front.
//
// The shell's own way (background.rs show_window) comes first: Tauri shows
// the window and asks for the focus, and tao already presses its synthetic
// Alt to get past Windows' foreground lock. That lock lets only the process
// the user last worked with take the foreground, and an app calling the API
// is the one in front, not Girovo, so on Windows the shell then tries once
// more with its input joined to the foreground thread's (AttachThreadInput),
// as Microsoft's notes on SetForegroundWindow allow. Refused even so, the
// taskbar button flashes until the user comes over, as for the dialog's
// waiting turn, and the answer is false.

use std::time::Duration;

use tauri::{AppHandle, Manager};

/// How long the main thread may take to run the last attempt: it is the
/// window's own thread, busy at most for a moment.
#[cfg(windows)]
const MAIN_THREAD_LIMIT: Duration = Duration::from_secs(2);

/// Brings the main window to the front; whether it got there.
pub fn bring_forward(app: &AppHandle) -> bool {
  // During the start (an update may still install) the start window stays in
  // front and the app's window stays hidden under it (background.rs bring_forward).
  if app.get_webview_window(crate::splash::LABEL).is_some() {
    crate::background::bring_forward(app);
    return false;
  }
  let Some(window) = app.get_webview_window("main") else { return false };
  crate::background::show_window(app);
  let in_front = in_front_now(app, &window);
  if !in_front {
    let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
  }
  in_front
}

#[cfg(windows)]
fn in_front_now(app: &AppHandle, window: &tauri::WebviewWindow) -> bool {
  let Ok(hwnd) = window.hwnd().map(|h| h.0 as isize) else { return false };
  // On the window's thread, after the show and focus queued above (the event
  // loop runs them in order): only there does the foreground lock count the
  // joined input as the window's own.
  let (tx, rx) = std::sync::mpsc::channel();
  if app.run_on_main_thread(move || { let _ = tx.send(win::to_front(hwnd)); }).is_err() {
    return false;
  }
  rx.recv_timeout(MAIN_THREAD_LIMIT).unwrap_or(false)
}

/// Linux: the window manager decides, a moment after GTK's present; the
/// shell waits a little for its word.
#[cfg(not(windows))]
fn in_front_now(_app: &AppHandle, window: &tauri::WebviewWindow) -> bool {
  let deadline = std::time::Instant::now() + Duration::from_millis(800);
  loop {
    if window.is_focused().unwrap_or(false) {
      return true;
    }
    if std::time::Instant::now() >= deadline {
      return false;
    }
    std::thread::sleep(Duration::from_millis(50));
  }
}

/// What to try next once SetForegroundWindow has had its go (Windows; the
/// tests read it everywhere).
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Next {
  /// The window is in front.
  Done,
  /// Another thread holds the foreground: join its input and try again.
  JoinInput,
  /// Nothing left to try (no foreground window to join, as on the lock
  /// screen, or it is this thread's already): the taskbar button flashes.
  GiveUp,
}

#[cfg_attr(not(windows), allow(dead_code))]
pub fn next_step(in_front: bool, foreground_thread: u32, own_thread: u32) -> Next {
  if in_front {
    Next::Done
  } else if foreground_thread == 0 || foreground_thread == own_thread {
    Next::GiveUp
  } else {
    Next::JoinInput
  }
}

#[cfg(windows)]
pub mod win {
  use super::{Next, next_step};
  use windows::Win32::Foundation::HWND;
  use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
  use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, GA_ROOT, GetAncestor, GetForegroundWindow, GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, SW_RESTORE, SW_SHOW,
    SetForegroundWindow, ShowWindow,
  };

  /// Whether the foreground window is `hwnd` (or one of its children, as a
  /// WebView2 window may be named).
  fn in_front(hwnd: HWND) -> bool {
    // SAFETY: both only read the window manager's state.
    unsafe {
      let fg = GetForegroundWindow();
      !fg.is_invalid() && (fg == hwnd || GetAncestor(fg, GA_ROOT) == hwnd)
    }
  }

  /// The last attempt, on the window's own thread: restored and shown if
  /// Tauri's turn left it otherwise, then SetForegroundWindow, then once more
  /// with the input joined to the foreground thread's. Whether it is in front.
  pub fn to_front(raw: isize) -> bool {
    let hwnd = HWND(raw as _);
    // SAFETY: every call takes the window by handle and checks it itself; an
    // invalid or closed handle makes them fail, nothing more. The input is
    // joined only between the two AttachThreadInput calls.
    unsafe {
      if raw == 0 || !IsWindow(Some(hwnd)).as_bool() {
        return false;
      }
      if IsIconic(hwnd).as_bool() {
        let _ = ShowWindow(hwnd, SW_RESTORE);
      }
      if !IsWindowVisible(hwnd).as_bool() {
        let _ = ShowWindow(hwnd, SW_SHOW);
      }
      if in_front(hwnd) {
        return true;
      }
      let _ = SetForegroundWindow(hwnd);
      let own = GetCurrentThreadId();
      let foreground = GetWindowThreadProcessId(GetForegroundWindow(), None);
      match next_step(in_front(hwnd), foreground, own) {
        Next::Done => true,
        Next::GiveUp => false,
        Next::JoinInput => {
          let joined = AttachThreadInput(own, foreground, true).as_bool();
          let _ = BringWindowToTop(hwnd);
          let _ = SetForegroundWindow(hwnd);
          if joined {
            let _ = AttachThreadInput(own, foreground, false);
          }
          in_front(hwnd)
        }
      }
    }
  }
}
