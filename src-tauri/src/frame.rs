// The window's frame on Windows (6.0, Tauri): no native title bar — the page
// draws its own bar and, at its right edge, the caption buttons
// (components/shell/CaptionButtons.tsx), where Electron's titleBarOverlay
// drew the system's.
//
// What a page cannot draw is Windows 11's snap layouts: the flyout over the
// maximize button comes only when the window answers WM_NCHITTEST with
// HTMAXBUTTON there. The WebView covers the whole window and answers every
// hit test itself, so a near-invisible child window lies over the page's
// maximize button and answers HTMAXBUTTON for it. The mouse messages that land
// there (hover, press, release) are handled by that window and told to the
// page, which draws the button's states. A release counts only after a press
// on the button itself: the second click of a double-click on the title bar
// can land there once the window has moved under the mouse.
//
// The page reports where its maximize button is (caption_rect), in physical
// pixels of the window's client area, whenever it moves (zoom, DPI, size).

use tauri::{AppHandle, Emitter, Manager};

#[tauri::command]
pub fn caption_minimize(app: AppHandle) {
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.minimize();
  }
}

#[tauri::command]
pub fn caption_toggle_maximize(app: AppHandle) {
  if let Some(w) = app.get_webview_window("main") {
    let _ = if w.is_maximized().unwrap_or(false) { w.unmaximize() } else { w.maximize() };
  }
}

#[tauri::command]
pub fn caption_close(app: AppHandle) {
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.close();
  }
}

#[tauri::command]
pub fn caption_is_maximized(app: AppHandle) -> bool {
  app.get_webview_window("main").and_then(|w| w.is_maximized().ok()).unwrap_or(false)
}

/// Where the page's maximize button is: physical pixels, client area.
#[tauri::command]
pub fn caption_rect(app: AppHandle, x: f64, y: f64, width: f64, height: f64) {
  #[cfg(windows)]
  {
    let rect = (x.round() as i32, y.round() as i32, width.round() as i32, height.round() as i32);
    let _ = app.run_on_main_thread(move || win::place(rect));
  }
  #[cfg(not(windows))]
  let _ = (app, x, y, width, height);
}

/// Tells the page about the maximized state as it changes (the button's glyph).
pub fn watch_maximized(app: &AppHandle) {
  let Some(w) = app.get_webview_window("main") else { return };
  let handle = app.clone();
  let last = std::sync::atomic::AtomicBool::new(w.is_maximized().unwrap_or(false));
  w.on_window_event(move |event| {
    if matches!(event, tauri::WindowEvent::Resized(_)) {
      if let Some(w) = handle.get_webview_window("main") {
        let now = w.is_maximized().unwrap_or(false);
        if last.swap(now, std::sync::atomic::Ordering::Relaxed) != now {
          let _ = handle.emit("caption:maximized", now);
        }
      }
    }
  });
}

#[cfg(windows)]
pub use win::install;

#[cfg(not(windows))]
pub fn install(_app: &AppHandle) {}

#[cfg(windows)]
mod win {
  use std::sync::{Mutex, OnceLock};

  use tauri::{AppHandle, Emitter, Manager};
  use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
  use windows::Win32::Graphics::Gdi::ScreenToClient;
  use windows::Win32::System::LibraryLoader::GetModuleHandleW;
  use windows::Win32::UI::Input::KeyboardAndMouse::{TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT, TrackMouseEvent};
  use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
  use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, GetCursorPos, GetParent, HTMAXBUTTON, HWND_TOP, IsZoomed, LWA_ALPHA, RegisterClassW,
    SW_MAXIMIZE, SW_RESTORE, SWP_NOACTIVATE, SWP_SHOWWINDOW, SetLayeredWindowAttributes, SetWindowPos, ShowWindow,
    WM_NCHITTEST, WM_NCLBUTTONDBLCLK, WM_NCLBUTTONDOWN, WM_NCLBUTTONUP, WM_NCMOUSELEAVE, WM_NCMOUSEMOVE, WNDCLASSW,
    WS_CHILD, WS_CLIPSIBLINGS, WS_EX_LAYERED, WS_EX_NOACTIVATE,
  };
  use windows::core::w;

  /// What the subclass and the overlay share. HWNDs as isize: they are not Send.
  struct Frame {
    overlay: isize,
    /// The maximize button: left, top, width, height in client pixels.
    rect: (i32, i32, i32, i32),
    hovering: bool,
    /// The mouse button went down on the overlay and has not come up or left since.
    pressed: bool,
  }

  static FRAME: OnceLock<Mutex<Frame>> = OnceLock::new();
  static APP: OnceLock<AppHandle> = OnceLock::new();
  const SUBCLASS_ID: usize = 0x6972_6f76; // "irov"

  fn frame() -> Option<std::sync::MutexGuard<'static, Frame>> {
    FRAME.get().map(|m| m.lock().unwrap())
  }

  fn emit(event: &str, value: bool) {
    if let Some(app) = APP.get() {
      let _ = app.emit(event, value);
    }
  }

  /// Subclasses the main window and lays the overlay over it (hidden until the page says where).
  pub fn install(app: &AppHandle) {
    let Some(w) = app.get_webview_window("main") else { return };
    let Ok(raw) = w.hwnd() else { return };
    let window = HWND(raw.0 as _);
    let _ = APP.set(app.clone());
    unsafe {
      let instance = GetModuleHandleW(None).unwrap_or_default();
      let class = WNDCLASSW {
        lpfnWndProc: Some(overlay_proc),
        hInstance: instance.into(),
        lpszClassName: w!("GirovoSnapOverlay"),
        ..Default::default()
      };
      RegisterClassW(&class);
      // Layered at alpha 1: invisible, yet hit-testable (alpha 0 would let every click through).
      let overlay = CreateWindowExW(
        WS_EX_LAYERED | WS_EX_NOACTIVATE,
        w!("GirovoSnapOverlay"),
        w!(""),
        WS_CHILD | WS_CLIPSIBLINGS,
        0,
        0,
        0,
        0,
        Some(window),
        None,
        Some(instance.into()),
        None,
      )
      .unwrap_or_default();
      if overlay.is_invalid() {
        eprintln!("[frame] snap overlay not created: {:?}", windows::core::Error::from_thread());
      } else {
        let _ = SetLayeredWindowAttributes(overlay, Default::default(), 1, LWA_ALPHA);
      }
      let _ = FRAME.set(Mutex::new(Frame {
        overlay: overlay.0 as isize,
        rect: (0, 0, 0, 0),
        hovering: false,
        pressed: false,
      }));
      let _ = SetWindowSubclass(window, Some(window_proc), SUBCLASS_ID, 0);
    }
  }

  /// Moves the overlay over the page's maximize button, above the WebView.
  /// Where the button has moved from under the mouse (the window maximized),
  /// hover and press start over: Windows does not always say the mouse left.
  /// With the mouse still on it they stay — the page may report the same
  /// place again between a press and its release, and the click must not be lost.
  pub fn place(rect: (i32, i32, i32, i32)) {
    let Some(mut f) = frame() else { return };
    f.rect = rect;
    let overlay = HWND(f.overlay as _);
    drop(f);
    if !cursor_within(overlay, rect) {
      let (hovered, pressed) = frame()
        .map(|mut f| (std::mem::replace(&mut f.hovering, false), std::mem::replace(&mut f.pressed, false)))
        .unwrap_or_default();
      if hovered {
        emit("caption:hover", false);
      }
      if hovered || pressed {
        emit("caption:press", false);
      }
    }
    if overlay.is_invalid() {
      return;
    }
    unsafe {
      let _ = SetWindowPos(overlay, Some(HWND_TOP), rect.0, rect.1, rect.2, rect.3, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    }
  }

  /// Whether the mouse is over `rect` (client pixels of the overlay's parent, the main window) right now.
  fn cursor_within(overlay: HWND, rect: (i32, i32, i32, i32)) -> bool {
    let (x, y, w, h) = rect;
    if overlay.is_invalid() || w <= 0 || h <= 0 {
      return false;
    }
    let mut pt = POINT::default();
    unsafe {
      let Ok(window) = GetParent(overlay) else { return false };
      if GetCursorPos(&mut pt).is_err() || !ScreenToClient(window, &mut pt).as_bool() {
        return false;
      }
    }
    pt.x >= x && pt.x < x + w && pt.y >= y && pt.y < y + h
  }

  fn over_button(window: HWND, lparam: LPARAM) -> bool {
    let Some(f) = frame() else { return false };
    let (x, y, w, h) = f.rect;
    if w <= 0 || h <= 0 {
      return false;
    }
    let mut pt = POINT { x: (lparam.0 & 0xffff) as i16 as i32, y: ((lparam.0 >> 16) & 0xffff) as i16 as i32 };
    unsafe {
      let _ = ScreenToClient(window, &mut pt);
    }
    pt.x >= x && pt.x < x + w && pt.y >= y && pt.y < y + h
  }

  unsafe extern "system" fn overlay_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
      // The button is this window's whole area, and the answer is given here.
      // HTTRANSPARENT was no way to pass it on: Windows then asks the next
      // window of this thread, which is the WebView's (WRY_WEBVIEW), never the
      // main window, so neither hover nor click reached anything (owner, 2026-11-08).
      WM_NCHITTEST => return LRESULT(HTMAXBUTTON as isize),
      WM_NCMOUSEMOVE => {
        let entered = frame().is_some_and(|mut f| !std::mem::replace(&mut f.hovering, true));
        if entered {
          let mut track = TRACKMOUSEEVENT {
            cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
            dwFlags: TME_LEAVE | TME_NONCLIENT,
            hwndTrack: hwnd,
            dwHoverTime: 0,
          };
          unsafe {
            let _ = TrackMouseEvent(&mut track);
          }
          emit("caption:hover", true);
        }
        return LRESULT(0);
      }
      WM_NCMOUSELEAVE => {
        // A press that leaves the button is given up, as on every button.
        let (hovered, pressed) = frame()
          .map(|mut f| (std::mem::replace(&mut f.hovering, false), std::mem::replace(&mut f.pressed, false)))
          .unwrap_or_default();
        if hovered {
          emit("caption:hover", false);
        }
        if hovered || pressed {
          emit("caption:press", false);
        }
        return LRESULT(0);
      }
      WM_NCLBUTTONDOWN | WM_NCLBUTTONDBLCLK => {
        if let Some(mut f) = frame() {
          f.pressed = true;
        }
        emit("caption:press", true);
        return LRESULT(0);
      }
      WM_NCLBUTTONUP => {
        // Only a press that began here: a release alone is the end of a click
        // on something else (the title bar's double-click).
        let pressed = frame().is_some_and(|mut f| std::mem::replace(&mut f.pressed, false));
        emit("caption:press", false);
        if pressed {
          unsafe {
            if let Ok(window) = GetParent(hwnd) {
              let _ = ShowWindow(window, if IsZoomed(window).as_bool() { SW_RESTORE } else { SW_MAXIMIZE });
            }
          }
        }
        return LRESULT(0);
      }
      _ => {}
    }
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
  }

  /// The main window gives the same answer for that spot, should Windows ask it directly.
  unsafe extern "system" fn window_proc(
    hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM, _id: usize, _data: usize,
  ) -> LRESULT {
    if msg == WM_NCHITTEST && over_button(hwnd, lparam) {
      return LRESULT(HTMAXBUTTON as isize);
    }
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
  }

}
