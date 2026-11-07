// girovo-update.exe: installs a downloaded Girovo update once Girovo has
// quit (docs/updater-v2.md, step 4). Girovo copies this program out of its
// installation (the installer is about to replace it), starts the copy with
// the installer, its signed SHA-256 and the installer's arguments, and quits.
// This then:
//
//   1. waits for Girovo to end (--wait-pid),
//   2. checks the installer once more against the signed hash (--sha256) —
//      a file changed after Girovo checked it is never run,
//   3. runs the installer (the arguments after `--`) and waits for it,
//   4. makes sure the new version comes up (--app-exe): the installer starts
//      it itself; when it doesn't within a few seconds, this does,
//
// in a plain Windows window: no WebView2, no Tauri, so an update still
// installs when the app itself is what is broken. A failure says what went
// wrong and offers Girovo (while it is still there) or the download page.
// `--quiet` does the same without a window (the tests).

#![cfg_attr(all(windows, not(test)), windows_subsystem = "windows")]

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

/// How long Girovo may take to end after it handed over.
const QUIT_LIMIT: Duration = Duration::from_secs(90);
/// How long an installer may run.
const INSTALL_LIMIT: Duration = Duration::from_secs(15 * 60);
/// How long the installer has to start the new version itself before this does.
const APP_GRACE: Duration = Duration::from_secs(6);
/// How long the new version may take to show its window before this ends anyway.
const APP_LIMIT: Duration = Duration::from_secs(45);

// ---- what to do ----------------------------------------------------------------------

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Plan {
  pub installer: PathBuf,
  /// The installer's SHA-256 from the signed manifest, lower-case hex.
  pub sha256: String,
  pub version: String,
  /// Girovo's process, which must have ended first; 0: none to wait for.
  pub wait_pid: u32,
  /// The installed app, started when the installer doesn't.
  pub app_exe: Option<PathBuf>,
  /// The way on when the install fails and Girovo is gone (github.com only).
  pub releases_url: String,
  pub english: bool,
  /// "Girovo" or "Girovo Nightly".
  pub name: String,
  pub quiet: bool,
  pub installer_args: Vec<String>,
}

impl Plan {
  /// The arguments Girovo starts this with (src-tauri/src/updater/helper.rs writes them).
  pub fn parse(args: &[String]) -> Result<Plan, String> {
    let mut plan = Plan { name: "Girovo".into(), ..Plan::default() };
    let mut it = args.iter();
    while let Some(a) = it.next() {
      if a == "--" {
        plan.installer_args = it.cloned().collect();
        break;
      }
      if a == "--quiet" {
        plan.quiet = true;
        continue;
      }
      let value = it.next().cloned().ok_or_else(|| format!("{a} needs a value"))?;
      match a.as_str() {
        "--installer" => plan.installer = PathBuf::from(value),
        "--sha256" => plan.sha256 = value.to_ascii_lowercase(),
        "--version" => plan.version = value,
        "--wait-pid" => plan.wait_pid = value.parse().map_err(|_| "--wait-pid is a number".to_string())?,
        "--app-exe" => plan.app_exe = Some(PathBuf::from(value)).filter(|p| !p.as_os_str().is_empty()),
        "--releases-url" => plan.releases_url = value,
        "--lang" => plan.english = value == "en",
        "--name" => plan.name = value,
        other => return Err(format!("unknown argument {other}")),
      }
    }
    if plan.installer.as_os_str().is_empty() {
      return Err("--installer is missing".into());
    }
    if plan.sha256.len() != 64 || !plan.sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
      return Err("--sha256 is not a SHA-256".into());
    }
    Ok(plan)
  }
}

// ---- the words ---------------------------------------------------------------------

pub struct Words {
  pub caption: &'static str,
  pub heading: &'static str,
  pub failed: &'static str,
  pub open: &'static str,
  pub download: &'static str,
  pub close: &'static str,
}

const DE: Words = Words {
  caption: "Update",
  heading: "wird aktualisiert",
  failed: "Das Update hat nicht geklappt",
  open: "Girovo öffnen",
  download: "Zur Download-Seite",
  close: "Schließen",
};

const EN: Words = Words {
  caption: "Update",
  heading: "is being updated",
  failed: "The update didn’t work",
  open: "Open Girovo",
  download: "Go to the download page",
  close: "Close",
};

impl Plan {
  pub fn words(&self) -> &'static Words {
    if self.english { &EN } else { &DE }
  }

  /// What the window says while `stage` runs.
  pub fn line(&self, stage: Stage) -> String {
    let v = &self.version;
    match (stage, self.english) {
      (Stage::Waiting, false) => format!("{} wird beendet …", self.name),
      (Stage::Waiting, true) => format!("Closing {} …", self.name),
      (Stage::Checking, false) => "Das Update wird geprüft …".into(),
      (Stage::Checking, true) => "Checking the update …".into(),
      (Stage::Installing, false) => format!("Version {v} wird installiert …"),
      (Stage::Installing, true) => format!("Installing version {v} …"),
      (Stage::Starting, false) => format!("{} wird gestartet …", self.name),
      (Stage::Starting, true) => format!("Starting {} …", self.name),
    }
  }

  /// What the window says when `failure` stopped it.
  pub fn why(&self, failure: &Failure) -> String {
    match (failure, self.english) {
      (Failure::StillRunning, false) => format!("{} hat sich nicht beendet. Schließe es und versuch es noch einmal.", self.name),
      (Failure::StillRunning, true) => format!("{} didn’t close. Close it and try again.", self.name),
      (Failure::Changed, false) => "Das Update wurde verändert und wird nicht installiert.".into(),
      (Failure::Changed, true) => "The update was changed and won’t be installed.".into(),
      (Failure::NoInstaller, false) => "Das Update ließ sich nicht starten.".into(),
      (Failure::NoInstaller, true) => "The update couldn’t start.".into(),
      (Failure::InstallerFailed(code), false) => format!("Die Installation ist fehlgeschlagen (Code {code})."),
      (Failure::InstallerFailed(code), true) => format!("The installation failed (code {code})."),
      (Failure::TooLong, false) => "Die Installation ist nach 15 Minuten noch nicht fertig.".into(),
      (Failure::TooLong, true) => "The installation still hasn’t finished after 15 minutes.".into(),
    }
  }
}

// ---- the work ------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stage {
  Waiting,
  Checking,
  Installing,
  Starting,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Failure {
  StillRunning,
  Changed,
  NoInstaller,
  InstallerFailed(i32),
  TooLong,
}

pub fn sha256_of(path: &Path) -> Option<String> {
  let mut file = std::fs::File::open(path).ok()?;
  let mut hasher = Sha256::new();
  let mut buf = vec![0u8; 1 << 20];
  loop {
    let n = file.read(&mut buf).ok()?;
    if n == 0 {
      break;
    }
    hasher.update(&buf[..n]);
  }
  Some(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Steps 1 to 4, telling `report` each stage as it begins.
pub fn run(plan: &Plan, report: &dyn Fn(Stage)) -> Result<(), Failure> {
  report(Stage::Waiting);
  if plan.wait_pid != 0 && !os::wait_for_exit(plan.wait_pid, QUIT_LIMIT) {
    return Err(Failure::StillRunning);
  }
  report(Stage::Checking);
  if sha256_of(&plan.installer).as_deref() != Some(plan.sha256.as_str()) {
    return Err(Failure::Changed);
  }
  report(Stage::Installing);
  let mut child = Command::new(&plan.installer).args(&plan.installer_args).spawn().map_err(|_| Failure::NoInstaller)?;
  let started = Instant::now();
  let code = loop {
    match child.try_wait() {
      Ok(Some(status)) => break status.code().unwrap_or(-1),
      Ok(None) if started.elapsed() > INSTALL_LIMIT => return Err(Failure::TooLong),
      Ok(None) => std::thread::sleep(Duration::from_millis(200)),
      Err(_) => return Err(Failure::NoInstaller),
    }
  };
  if code != 0 {
    return Err(Failure::InstallerFailed(code));
  }
  report(Stage::Starting);
  if let Some(app) = plan.app_exe.as_deref() {
    bring_up(app);
  }
  Ok(())
}

/// Waits for the new version's window; starts it when the installer didn't.
fn bring_up(app: &Path) {
  let exe = app.to_string_lossy().into_owned();
  let started = Instant::now();
  let mut launched = false;
  while started.elapsed() < APP_LIMIT {
    if os::window_of(&exe) {
      return;
    }
    if !launched && started.elapsed() > APP_GRACE && !os::running(&exe) {
      launched = Command::new(app).spawn().is_ok();
    }
    std::thread::sleep(Duration::from_millis(250));
  }
}

/// The way on after a failure: Girovo while it is still there, else the download page.
pub enum WayOn {
  Open(PathBuf),
  Download(String),
  None,
}

pub fn way_on(plan: &Plan) -> WayOn {
  match plan.app_exe.as_ref() {
    Some(app) if app.exists() => WayOn::Open(app.clone()),
    _ if plan.releases_url.starts_with("https://github.com/") => WayOn::Download(plan.releases_url.clone()),
    _ => WayOn::None,
  }
}

fn main() {
  let args: Vec<String> = std::env::args().skip(1).collect();
  let plan = match Plan::parse(&args) {
    Ok(plan) => plan,
    Err(err) => {
      eprintln!("girovo-update: {err}");
      std::process::exit(2);
    }
  };
  if plan.quiet {
    match run(&plan, &|stage| eprintln!("girovo-update: {stage:?}")) {
      Ok(()) => std::process::exit(0),
      Err(failure) => {
        eprintln!("girovo-update: {failure:?}");
        std::process::exit(1);
      }
    }
  }
  #[cfg(windows)]
  ui::show(plan);
  #[cfg(not(windows))]
  std::process::exit(match run(&plan, &|_| {}) {
    Ok(()) => 0,
    Err(_) => 1,
  });
}

// ---- Windows ---------------------------------------------------------------------------

#[cfg(windows)]
mod os {
  use std::time::Duration;
  use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, WAIT_OBJECT_0};
  use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE, QueryFullProcessImageNameW, WaitForSingleObject,
  };
  use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowThreadProcessId, IsWindowVisible};
  use windows::core::{BOOL, PWSTR};

  /// Whether process `pid` has ended within `limit` (or was never there).
  pub fn wait_for_exit(pid: u32, limit: Duration) -> bool {
    let Ok(process) = (unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid) }) else { return true };
    let done = unsafe { WaitForSingleObject(process, limit.as_millis() as u32) } == WAIT_OBJECT_0;
    unsafe {
      let _ = CloseHandle(process);
    }
    done
  }

  fn image_of(pid: u32) -> Option<String> {
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
    let mut buf = [0u16; 520];
    let mut len = buf.len() as u32;
    let ok = unsafe { QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len) }.is_ok();
    unsafe {
      let _ = CloseHandle(process);
    }
    ok.then(|| String::from_utf16_lossy(&buf[..len as usize]))
  }

  struct Search {
    exe: String,
    visible_only: bool,
    found: bool,
  }

  unsafe extern "system" fn each(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let search = unsafe { &mut *(lparam.0 as *mut Search) };
    if search.visible_only && !unsafe { IsWindowVisible(hwnd) }.as_bool() {
      return true.into();
    }
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if image_of(pid).is_some_and(|path| path.eq_ignore_ascii_case(&search.exe)) {
      search.found = true;
    }
    (!search.found).into()
  }

  fn search(exe: &str, visible_only: bool) -> bool {
    let mut s = Search { exe: exe.to_string(), visible_only, found: false };
    unsafe {
      let _ = EnumWindows(Some(each), LPARAM(&mut s as *mut Search as isize));
    }
    s.found
  }

  /// Whether a visible window of a process started from `exe` is up.
  pub fn window_of(exe: &str) -> bool {
    search(exe, true)
  }

  /// Whether a process started from `exe` has any window yet (it is starting).
  pub fn running(exe: &str) -> bool {
    search(exe, false)
  }
}

#[cfg(not(windows))]
mod os {
  use std::time::Duration;
  pub fn wait_for_exit(_pid: u32, _limit: Duration) -> bool {
    true
  }
  pub fn window_of(_exe: &str) -> bool {
    true
  }
  pub fn running(_exe: &str) -> bool {
    true
  }
}

#[cfg(windows)]
mod ui {
  use std::sync::Mutex;
  use std::sync::OnceLock;

  use windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, RECT, WPARAM};
  use windows::Win32::Graphics::Gdi::{
    CLEARTYPE_QUALITY, CLIP_DEFAULT_PRECIS, COLOR_WINDOW, CreateFontW, DEFAULT_CHARSET, FF_DONTCARE, FW_NORMAL, FW_SEMIBOLD, GetSysColor, GetSysColorBrush,
    HDC, HFONT, OUT_DEFAULT_PRECIS, SetBkColor, SetTextColor, COLOR_WINDOWTEXT, UpdateWindow,
  };
  use windows::Win32::System::LibraryLoader::GetModuleHandleW;
  use windows::Win32::UI::Controls::{ICC_PROGRESS_CLASS, ICC_STANDARD_CLASSES, INITCOMMONCONTROLSEX, InitCommonControlsEx, PBM_SETMARQUEE, PBS_MARQUEE};
  use windows::Win32::UI::HiDpi::{DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, GetDpiForSystem, SetProcessDpiAwarenessContext};
  use windows::Win32::UI::Shell::{ExtractIconW, ShellExecuteW};
  use windows::Win32::UI::WindowsAndMessaging::*;
  use windows::core::{HSTRING, PCWSTR, w};

  use super::{Failure, Plan, Stage, WayOn};

  const WM_STAGE: u32 = WM_APP + 1;
  const WM_DONE: u32 = WM_APP + 2;
  const WM_FAILED: u32 = WM_APP + 3;
  const ID_PRIMARY: usize = 1;
  const ID_CLOSE: usize = 2;
  /// The client area at 96 dpi.
  const WIDTH: i32 = 440;
  const HEIGHT: i32 = 150;

  struct Ui {
    plan: Plan,
    heading: isize,
    line: isize,
    progress: isize,
    primary: isize,
    close: isize,
    failure: Option<Failure>,
  }

  static UI: OnceLock<Mutex<Ui>> = OnceLock::new();

  fn hwnd(raw: isize) -> HWND {
    HWND(raw as *mut _)
  }

  fn set_text(raw: isize, text: &str) {
    let text = HSTRING::from(text);
    unsafe {
      let _ = SetWindowTextW(hwnd(raw), PCWSTR(text.as_ptr()));
    }
  }

  fn font(points: i32, weight: i32, dpi: u32) -> HFONT {
    let height = -(points * dpi as i32 / 72);
    unsafe {
      CreateFontW(
        height, 0, 0, 0, weight, 0, 0, 0, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, FF_DONTCARE.0 as u32, w!("Segoe UI"),
      )
    }
  }

  pub fn show(plan: Plan) {
    unsafe {
      let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
      let _ = InitCommonControlsEx(&INITCOMMONCONTROLSEX {
        dwSize: std::mem::size_of::<INITCOMMONCONTROLSEX>() as u32,
        dwICC: ICC_PROGRESS_CLASS | ICC_STANDARD_CLASSES,
      });
    }
    let dpi = unsafe { GetDpiForSystem() }.max(96);
    let px = |v: i32| v * dpi as i32 / 96;
    let instance: HINSTANCE = unsafe { GetModuleHandleW(None) }.map(Into::into).unwrap_or_default();
    let words = plan.words();
    let class = w!("GirovoUpdate");
    unsafe {
      let wc = WNDCLASSW {
        lpfnWndProc: Some(proc_),
        hInstance: instance,
        lpszClassName: class,
        hCursor: LoadCursorW(None, IDC_ARROW).unwrap_or_default(),
        hbrBackground: GetSysColorBrush(COLOR_WINDOW),
        ..Default::default()
      };
      RegisterClassW(&wc);
    }

    // The client area, centred on the primary screen.
    let style = WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX;
    let mut rect = RECT { left: 0, top: 0, right: px(WIDTH), bottom: px(HEIGHT) };
    unsafe {
      let _ = AdjustWindowRectEx(&mut rect, style, false, WINDOW_EX_STYLE(0));
    }
    let (w, h) = (rect.right - rect.left, rect.bottom - rect.top);
    let (sw, sh) = unsafe { (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN)) };
    let caption = HSTRING::from(format!("{} {}", plan.name, words.caption));
    let Ok(main) = (unsafe {
      CreateWindowExW(WINDOW_EX_STYLE(0), class, PCWSTR(caption.as_ptr()), style, (sw - w) / 2, (sh - h) / 2, w, h, None, None, Some(instance), None)
    }) else {
      // No window at all: install without one.
      let _ = super::run(&plan, &|_| {});
      return;
    };

    // Girovo's own icon, from the app the update is for.
    if let Some(app) = plan.app_exe.as_ref().filter(|p| p.exists()) {
      let path = HSTRING::from(app.as_os_str());
      let icon = unsafe { ExtractIconW(Some(instance), PCWSTR(path.as_ptr()), 0) };
      if !icon.is_invalid() {
        unsafe {
          SendMessageW(main, WM_SETICON, Some(WPARAM(ICON_BIG as usize)), Some(LPARAM(icon.0 as isize)));
          SendMessageW(main, WM_SETICON, Some(WPARAM(ICON_SMALL as usize)), Some(LPARAM(icon.0 as isize)));
        }
      }
    }

    let child = |class: PCWSTR, text: &str, style: WINDOW_STYLE, x: i32, y: i32, cw: i32, ch: i32, id: usize| -> isize {
      let text = HSTRING::from(text);
      unsafe {
        CreateWindowExW(
          WINDOW_EX_STYLE(0),
          class,
          PCWSTR(text.as_ptr()),
          WS_CHILD | WS_VISIBLE | style,
          px(x),
          px(y),
          px(cw),
          px(ch),
          Some(main),
          Some(HMENU(id as *mut _)),
          Some(instance),
          None,
        )
      }
      .map(|h| h.0 as isize)
      .unwrap_or(0)
    };
    let heading_text = format!("{} {}", plan.name, words.heading);
    let heading = child(w!("STATIC"), &heading_text, WINDOW_STYLE(0), 24, 20, WIDTH - 48, 26, 0);
    let line = child(w!("STATIC"), &plan.line(Stage::Waiting), WINDOW_STYLE(0), 24, 52, WIDTH - 48, 40, 0);
    let progress = child(w!("msctls_progress32"), "", WINDOW_STYLE(PBS_MARQUEE), 24, 100, WIDTH - 48, 6, 0);
    let close = child(w!("BUTTON"), words.close, WINDOW_STYLE(BS_PUSHBUTTON as u32) | WS_TABSTOP, WIDTH - 24 - 110, 104, 110, 30, ID_CLOSE);
    let primary = child(w!("BUTTON"), "", WINDOW_STYLE(BS_DEFPUSHBUTTON as u32) | WS_TABSTOP, WIDTH - 24 - 110 - 8 - 190, 104, 190, 30, ID_PRIMARY);
    let (big, normal) = (font(13, FW_SEMIBOLD.0 as i32, dpi), font(10, FW_NORMAL.0 as i32, dpi));
    unsafe {
      SendMessageW(hwnd(heading), WM_SETFONT, Some(WPARAM(big.0 as usize)), Some(LPARAM(1)));
      for c in [line, close, primary] {
        SendMessageW(hwnd(c), WM_SETFONT, Some(WPARAM(normal.0 as usize)), Some(LPARAM(1)));
      }
      SendMessageW(hwnd(progress), PBM_SETMARQUEE, Some(WPARAM(1)), Some(LPARAM(30)));
      let _ = ShowWindow(hwnd(close), SW_HIDE);
      let _ = ShowWindow(hwnd(primary), SW_HIDE);
    }
    let _ = UI.set(Mutex::new(Ui { plan: plan.clone(), heading, line, progress, primary, close, failure: None }));
    unsafe {
      let _ = ShowWindow(main, SW_SHOWNORMAL);
      let _ = UpdateWindow(main);
    }

    // The work beside the window; it reports through messages.
    let raw = main.0 as isize;
    std::thread::spawn(move || {
      let post = |msg: u32, w: usize| unsafe {
        let _ = PostMessageW(Some(hwnd(raw)), msg, WPARAM(w), LPARAM(0));
      };
      let report = |stage: Stage| post(WM_STAGE, stage as usize);
      match super::run(&plan, &report) {
        Ok(()) => post(WM_DONE, 0),
        Err(failure) => {
          if let Some(ui) = UI.get() {
            ui.lock().unwrap().failure = Some(failure);
          }
          post(WM_FAILED, 0);
        }
      }
    });

    let mut msg = MSG::default();
    unsafe {
      while GetMessageW(&mut msg, None, 0, 0).as_bool() {
        if !IsDialogMessageW(main, &msg).as_bool() {
          let _ = TranslateMessage(&msg);
          DispatchMessageW(&msg);
        }
      }
    }
  }

  const STAGES: [Stage; 4] = [Stage::Waiting, Stage::Checking, Stage::Installing, Stage::Starting];

  unsafe extern "system" fn proc_(window: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
      WM_STAGE => {
        if let (Some(ui), Some(stage)) = (UI.get(), STAGES.get(wparam.0)) {
          let ui = ui.lock().unwrap();
          set_text(ui.line, &ui.plan.line(*stage));
        }
        LRESULT(0)
      }
      WM_DONE => {
        let _ = unsafe { DestroyWindow(window) };
        LRESULT(0)
      }
      WM_FAILED => {
        if let Some(ui) = UI.get() {
          let ui = ui.lock().unwrap();
          let words = ui.plan.words();
          set_text(ui.heading, words.failed);
          if let Some(failure) = ui.failure.as_ref() {
            set_text(ui.line, &ui.plan.why(failure));
          }
          unsafe {
            let _ = ShowWindow(hwnd(ui.progress), SW_HIDE);
            let _ = ShowWindow(hwnd(ui.close), SW_SHOW);
          }
          let label = match super::way_on(&ui.plan) {
            WayOn::Open(_) => Some(words.open),
            WayOn::Download(_) => Some(words.download),
            WayOn::None => None,
          };
          if let Some(label) = label {
            set_text(ui.primary, label);
            unsafe {
              let _ = ShowWindow(hwnd(ui.primary), SW_SHOW);
            }
          }
        }
        unsafe { windows::Win32::UI::Input::KeyboardAndMouse::SetFocus(Some(window)).ok() };
        LRESULT(0)
      }
      WM_COMMAND => {
        let id = wparam.0 & 0xffff;
        if id == ID_PRIMARY {
          if let Some(ui) = UI.get() {
            match super::way_on(&ui.lock().unwrap().plan) {
              WayOn::Open(app) => {
                let _ = std::process::Command::new(app).spawn();
              }
              WayOn::Download(url) => {
                let url = HSTRING::from(url);
                unsafe { ShellExecuteW(None, w!("open"), PCWSTR(url.as_ptr()), None, None, SW_SHOWNORMAL) };
              }
              WayOn::None => {}
            }
          }
        }
        if id == ID_PRIMARY || id == ID_CLOSE {
          let _ = unsafe { DestroyWindow(window) };
        }
        LRESULT(0)
      }
      WM_CLOSE => {
        // While the installer works the window stays: closing it would only hide what is happening.
        let failed = UI.get().is_some_and(|ui| ui.lock().unwrap().failure.is_some());
        if failed {
          let _ = unsafe { DestroyWindow(window) };
        }
        LRESULT(0)
      }
      WM_CTLCOLORSTATIC => {
        let hdc = HDC(wparam.0 as *mut _);
        unsafe {
          SetBkColor(hdc, COLORREF(GetSysColor(COLOR_WINDOW)));
          SetTextColor(hdc, COLORREF(GetSysColor(COLOR_WINDOWTEXT)));
        }
        LRESULT(unsafe { GetSysColorBrush(COLOR_WINDOW) }.0 as isize)
      }
      WM_DESTROY => {
        unsafe { PostQuitMessage(0) };
        LRESULT(0)
      }
      _ => unsafe { DefWindowProcW(window, msg, wparam, lparam) },
    }
  }

}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp(name: &str, bytes: &[u8]) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("girovo-update-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(name);
    std::fs::write(&path, bytes).unwrap();
    path
  }

  fn args(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
  }

  #[test]
  fn the_arguments_girovo_passes_are_read() {
    let sha = "AB".repeat(32);
    let plan = Plan::parse(&args(&[
      "--installer", "C:\\Temp\\Girovo-6.0.3-Setup.exe", "--sha256", &sha, "--version", "6.0.3", "--wait-pid", "4711",
      "--app-exe", "C:\\Apps\\Girovo\\Girovo.exe", "--releases-url", "https://github.com/elNino0916/Girovo/releases", "--lang", "en",
      "--name", "Girovo Nightly", "--", "/S", "/UPDATE", "/R", "/ARGS", "--updated", "--force-run",
    ]))
    .unwrap();
    assert_eq!(plan.installer, PathBuf::from("C:\\Temp\\Girovo-6.0.3-Setup.exe"));
    assert_eq!(plan.sha256, "ab".repeat(32), "lower case");
    assert_eq!(plan.wait_pid, 4711);
    assert!(plan.english);
    assert_eq!(plan.name, "Girovo Nightly");
    assert_eq!(plan.installer_args, ["/S", "/UPDATE", "/R", "/ARGS", "--updated", "--force-run"]);
    assert_eq!(plan.line(Stage::Installing), "Installing version 6.0.3 …");
  }

  #[test]
  fn arguments_without_an_installer_or_a_hash_are_refused() {
    assert!(Plan::parse(&args(&["--sha256", &"a".repeat(64)])).is_err());
    assert!(Plan::parse(&args(&["--installer", "x.exe", "--sha256", "nope"])).is_err());
    assert!(Plan::parse(&args(&["--installer", "x.exe", "--sha256", &"a".repeat(64), "--bogus", "1"])).is_err());
    assert!(Plan::parse(&args(&["--installer", "x.exe", "--sha256", &"a".repeat(64), "--wait-pid"])).is_err());
  }

  #[test]
  fn the_hash_is_the_files() {
    let path = temp("hash.bin", b"girovo");
    assert_eq!(sha256_of(&path).unwrap(), "c3dad1f055a65a16fbe516c3c13f9d975719c8e66490dc623fcd147213fbbbbc");
    assert_eq!(sha256_of(Path::new("C:\\nowhere\\x.exe")), None);
  }

  #[cfg(windows)]
  fn cmd() -> PathBuf {
    PathBuf::from(std::env::var("ComSpec").unwrap_or_else(|_| "C:\\Windows\\System32\\cmd.exe".into()))
  }

  #[cfg(windows)]
  #[test]
  fn a_changed_file_is_never_run() {
    let plan = Plan { installer: cmd(), sha256: "0".repeat(64), installer_args: args(&["/c", "exit", "0"]), ..Plan::default() };
    let seen = std::cell::RefCell::new(Vec::new());
    assert_eq!(run(&plan, &|s| seen.borrow_mut().push(s)), Err(Failure::Changed));
    assert_eq!(*seen.borrow(), [Stage::Waiting, Stage::Checking], "stopped before installing");
  }

  #[cfg(windows)]
  #[test]
  fn the_installer_runs_and_its_exit_code_counts() {
    let installer = cmd();
    let sha256 = sha256_of(&installer).unwrap();
    let ok = Plan { installer: installer.clone(), sha256: sha256.clone(), installer_args: args(&["/c", "exit", "0"]), ..Plan::default() };
    let seen = std::cell::RefCell::new(Vec::new());
    assert_eq!(run(&ok, &|s| seen.borrow_mut().push(s)), Ok(()));
    assert_eq!(*seen.borrow(), [Stage::Waiting, Stage::Checking, Stage::Installing, Stage::Starting]);
    let failing = Plan { installer, sha256, installer_args: args(&["/c", "exit", "1223"]), ..Plan::default() };
    assert_eq!(run(&failing, &|_| {}), Err(Failure::InstallerFailed(1223)));
  }

  #[cfg(windows)]
  #[test]
  fn it_waits_for_girovo_to_end_first() {
    let mut girovo = std::process::Command::new(cmd()).args(["/c", "ping", "-n", "2", "127.0.0.1", ">", "nul"]).spawn().unwrap();
    let installer = cmd();
    let plan = Plan { sha256: sha256_of(&installer).unwrap(), installer, wait_pid: girovo.id(), installer_args: args(&["/c", "exit", "0"]), ..Plan::default() };
    let started = Instant::now();
    assert_eq!(run(&plan, &|_| {}), Ok(()));
    assert!(girovo.try_wait().unwrap().is_some(), "Girovo had ended before the installer ran");
    assert!(started.elapsed() >= Duration::from_millis(500));
  }

  #[test]
  fn after_a_failure_girovo_while_it_is_there_else_the_download_page() {
    let there = temp("Girovo.exe", b"x");
    let plan = Plan { app_exe: Some(there.clone()), releases_url: "https://github.com/elNino0916/Girovo/releases".into(), ..Plan::default() };
    assert!(matches!(way_on(&plan), WayOn::Open(p) if p == there));
    let gone = Plan { app_exe: Some(PathBuf::from("C:\\nowhere\\Girovo.exe")), ..plan.clone() };
    assert!(matches!(way_on(&gone), WayOn::Download(_)));
    let foreign = Plan { releases_url: "https://example.com/".into(), ..gone };
    assert!(matches!(way_on(&foreign), WayOn::None));
  }

  #[test]
  fn every_failure_is_said_in_both_languages() {
    let de = Plan { name: "Girovo".into(), ..Plan::default() };
    let en = Plan { english: true, ..de.clone() };
    for f in [Failure::StillRunning, Failure::Changed, Failure::NoInstaller, Failure::InstallerFailed(2), Failure::TooLong] {
      assert!(!de.why(&f).is_empty() && !en.why(&f).is_empty());
      assert_ne!(de.why(&f), en.why(&f));
    }
  }
}
