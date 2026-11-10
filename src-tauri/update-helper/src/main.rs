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
//   4. starts the new version (--app-exe) once its window has closed — the
//      installer is told not to, so Girovo never opens beside this window,
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
/// How long the window stays at least, so a quick update is still seen (owner, 2026-11-07).
const MIN_SHOWN: Duration = Duration::from_secs(10);

// ---- what to do ----------------------------------------------------------------------

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Plan {
  pub installer: PathBuf,
  /// The installer's SHA-256 from the signed manifest, lower-case hex.
  pub sha256: String,
  pub version: String,
  /// Girovo's process, which must have ended first; 0: none to wait for.
  pub wait_pid: u32,
  /// The installed app, which this starts once its window is gone.
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
  /// The card's heading (window C).
  pub title: &'static str,
  pub failed: &'static str,
  pub open: &'static str,
  pub download: &'static str,
  pub close: &'static str,
}

const DE: Words = Words {
  caption: "Update",
  heading: "wird aktualisiert",
  title: "Girovo wird aktualisiert",
  failed: "Das Update hat nicht geklappt",
  open: "Girovo öffnen",
  download: "Zur Download-Seite",
  close: "Schließen",
};

const EN: Words = Words {
  caption: "Update",
  heading: "is being updated",
  title: "Updating Girovo",
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
    match (stage, self.english) {
      (Stage::Waiting, false) => format!("{} wird beendet …", self.name),
      (Stage::Waiting, true) => format!("Closing {} …", self.name),
      (Stage::Checking, false) => "Das Update wird geprüft …".into(),
      (Stage::Checking, true) => "Checking the update …".into(),
      (Stage::Installing, false) => "Update installieren …".into(),
      (Stage::Installing, true) => "Installing the update …".into(),
      // The installer's end and the wait up to MIN_SHOWN (owner, 2026-11-07).
      (Stage::Starting, false) => "Update abschließen …".into(),
      (Stage::Starting, true) => "Finishing the update …".into(),
    }
  }

  /// The installer's arguments without the ones that have it start Girovo
  /// (Tauri's /R; --force-run for the hooks and electron-builder): with the
  /// app to start, this does that itself, after its window has closed.
  pub fn install_args(&self) -> Vec<String> {
    if self.app_exe.is_none() {
      return self.installer_args.clone();
    }
    self.installer_args.iter().filter(|a| !a.eq_ignore_ascii_case("/R") && *a != "--force-run").cloned().collect()
  }

  /// What Girovo starts with after the update: what /ARGS had for it (up to
  /// the next /option, as NSIS reads it), else --updated.
  pub fn app_args(&self) -> Vec<String> {
    let Some(at) = self.installer_args.iter().position(|a| a.eq_ignore_ascii_case("/ARGS")) else {
      return vec!["--updated".into()];
    };
    self.installer_args[at + 1..].iter().take_while(|a| !a.starts_with('/')).filter(|a| *a != "--force-run").cloned().collect()
  }

  /// "Version 6.0.2 Nightly": the version as a person reads it, not the build's whole name.
  pub fn version_line(&self) -> String {
    let (core, pre) = self.version.split_once('-').unwrap_or((self.version.as_str(), ""));
    let kind = if pre.starts_with("nightly.") || (pre.starts_with("preview.") && pre.len() > 12) {
      " Nightly".to_string()
    } else if let Some(n) = pre.strip_prefix("preview.").filter(|n| n.chars().all(|c| c.is_ascii_digit())) {
      format!(" Preview {n}")
    } else {
      String::new()
    };
    if self.english { format!("Version {core}{kind}") } else { format!("Version {core}{kind}") }
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
  let mut child = Command::new(&plan.installer).args(plan.install_args()).spawn().map_err(|_| Failure::NoInstaller)?;
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
  Ok(())
}

/// Step 4: the new version, unless something already started it.
pub fn start_app(plan: &Plan) {
  let Some(app) = plan.app_exe.as_deref() else { return };
  if !app.is_file() || os::running(&app.to_string_lossy()) {
    return;
  }
  let mut command = Command::new(app);
  command.args(plan.app_args());
  if let Some(dir) = app.parent() {
    command.current_dir(dir);
  }
  let _ = command.spawn();
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

/// The two buttons' ids. Never 1 or 2: those are Windows' IDOK and IDCANCEL,
/// which the message loop (IsDialogMessageW) sends for Enter and Esc at any
/// time, button or no button.
pub const ID_PRIMARY: usize = 101;
pub const ID_CLOSE: usize = 102;
const ID_ENTER: usize = 1;
const ID_ESC: usize = 2;

/// What a command to the window asks for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pressed {
  /// The way on (way_on), then the window closes.
  Primary,
  Close,
}

/// What the command `id` means. Nothing while the update runs: the buttons
/// are only there after a failure, and Enter or Esc must neither start Girovo
/// under the installer nor end this window before the installer has run.
/// After a failure Enter is the way on and Esc closes.
pub fn pressed(id: usize, failed: bool) -> Option<Pressed> {
  if !failed {
    return None;
  }
  match id {
    ID_PRIMARY | ID_ENTER => Some(Pressed::Primary),
    ID_CLOSE | ID_ESC => Some(Pressed::Close),
    _ => None,
  }
}

fn main() {
  #[allow(unused_mut)]
  let mut args: Vec<String> = std::env::args().skip(1).collect();
  #[cfg(all(windows, debug_assertions))]
  if let Some(at) = args.iter().position(|a| a == "--snapshot") {
    let out = std::path::PathBuf::from(args.get(at + 1).cloned().unwrap_or_default());
    args.drain(at..=at + 1);
    let mut flag = |name: &str| args.iter().position(|a| a == name).map(|i| args.remove(i)).is_some();
    let (dark, failed) = (flag("--dark"), flag("--failed"));
    let _ = flag("--light");
    let dpi = args.iter().position(|a| a == "--dpi").map(|i| {
      let v = args.get(i + 1).and_then(|v| v.parse().ok()).unwrap_or(96);
      args.drain(i..=i + 1);
      v
    });
    if let Ok(plan) = Plan::parse(&args) {
      ui::snapshot(plan, &out, dark, failed, dpi.unwrap_or(96));
    }
    return;
  }
  let plan = match Plan::parse(&args) {
    Ok(plan) => plan,
    Err(err) => {
      eprintln!("girovo-update: {err}");
      std::process::exit(2);
    }
  };
  if plan.quiet {
    match run(&plan, &|stage| eprintln!("girovo-update: {stage:?}")) {
      Ok(()) => {
        start_app(&plan);
        std::process::exit(0)
      }
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
    Ok(()) => {
      start_app(&plan);
      0
    }
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
  use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowThreadProcessId};
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
    found: bool,
  }

  unsafe extern "system" fn each(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let search = unsafe { &mut *(lparam.0 as *mut Search) };
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if image_of(pid).is_some_and(|path| path.eq_ignore_ascii_case(&search.exe)) {
      search.found = true;
    }
    (!search.found).into()
  }

  /// Whether a process started from `exe` has a window, shown or not yet (it runs or is starting).
  pub fn running(exe: &str) -> bool {
    let mut s = Search { exe: exe.to_string(), found: false };
    unsafe {
      let _ = EnumWindows(Some(each), LPARAM(&mut s as *mut Search as isize));
    }
    s.found
  }
}

#[cfg(not(windows))]
mod os {
  use std::time::Duration;
  pub fn wait_for_exit(_pid: u32, _limit: Duration) -> bool {
    true
  }
  pub fn running(_exe: &str) -> bool {
    false
  }
}

#[cfg(windows)]
mod ui {
  //! Window C (owner's pick, 2026-11-07): Windows' own title bar in the
  //! window's tint, and on it a white card — the app's icon large, "Girovo
  //! wird aktualisiert", the version, a rounded moving bar in Girovo blue and
  //! the step under it. A failure keeps the card, says why and offers the way
  //! on as real Windows buttons. Light or dark as Windows is set; sharp at
  //! any scaling. Shapes through GDI+ (smooth corners), text through GDI
  //! (ClearType), painted off screen and copied in one go.

  use std::sync::{Mutex, OnceLock};
  use std::time::Instant;

  use windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, RECT, WPARAM};
  use windows::Win32::Graphics::Dwm::{DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR, DWMWA_USE_IMMERSIVE_DARK_MODE, DwmSetWindowAttribute};
  use windows::Win32::Graphics::Gdi::*;
  use windows::Win32::Graphics::GdiPlus::{
    FillModeAlternate, GdipAddPathArc, GdipAddPathRectangle, GdipClosePathFigure, GdipCreateFromHDC, GdipCreatePath, GdipCreateSolidFill,
    GdipDeleteBrush, GdipDeleteGraphics, GdipDeletePath, GdipFillPath, GdipSetSmoothingMode, GdiplusShutdown, GdiplusStartup, GdiplusStartupInput,
    GpBrush, GpGraphics, GpPath, GpSolidFill, SmoothingModeAntiAlias,
  };
  use windows::Win32::System::LibraryLoader::GetModuleHandleW;
  use windows::Win32::System::Registry::{HKEY_CURRENT_USER, RRF_RT_REG_DWORD, RegGetValueW};
  use windows::Win32::UI::Controls::{ICC_STANDARD_CLASSES, INITCOMMONCONTROLSEX, InitCommonControlsEx, SetWindowTheme};
  use windows::Win32::UI::HiDpi::{AdjustWindowRectExForDpi, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, GetDpiForWindow, SetProcessDpiAwarenessContext};
  use windows::Win32::UI::Shell::ShellExecuteW;
  use windows::Win32::UI::WindowsAndMessaging::*;
  use windows::core::{HSTRING, PCWSTR, w};

  use super::{Failure, ID_CLOSE, ID_PRIMARY, Plan, Pressed, Stage, WayOn};

  const WM_STAGE: u32 = WM_APP + 1;
  const WM_DONE: u32 = WM_APP + 2;
  const WM_FAILED: u32 = WM_APP + 3;
  const TIMER: usize = 1;

  // The layout at 96 dpi (the mock's numbers).
  const WIDTH: i32 = 440;
  const MARGIN: i32 = 6;
  const PAD: i32 = 22;
  const PLATE: i32 = 56;
  const GAP: i32 = 18;
  const CARD_WORKING: i32 = 124;
  const CARD_FAILED: i32 = 168;

  struct Colors {
    window: u32,
    card: u32,
    ink: u32,
    ink2: u32,
    track: u32,
    accent: u32,
  }

  const LIGHT: Colors = Colors { window: 0xf3f5f8, card: 0xffffff, ink: 0x1b1f24, ink2: 0x5b6470, track: 0xe2e6eb, accent: 0x2563c9 };
  const DARK: Colors = Colors { window: 0x202124, card: 0x2b2d31, ink: 0xf1f3f5, ink2: 0xa9b0b8, track: 0x3c3f45, accent: 0x6ea8ff };

  /// 0xRRGGBB as GDI's COLORREF (0x00BBGGRR).
  fn cref(rgb: u32) -> COLORREF {
    COLORREF(((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff))
  }

  struct Ui {
    plan: Plan,
    dark: bool,
    dpi: u32,
    heading_font: isize,
    body_font: isize,
    small_font: isize,
    icon: isize,
    step: String,
    failure: Option<Failure>,
    primary: isize,
    close: isize,
    started: Instant,
  }

  static UI: OnceLock<Mutex<Ui>> = OnceLock::new();

  fn hwnd(raw: isize) -> HWND {
    HWND(raw as *mut _)
  }

  fn px(v: i32, dpi: u32) -> i32 {
    v * dpi as i32 / 96
  }

  /// Whether Windows shows apps dark.
  fn system_dark() -> bool {
    let mut value: u32 = 1;
    let mut size = std::mem::size_of::<u32>() as u32;
    let ok = unsafe {
      RegGetValueW(
        HKEY_CURRENT_USER,
        w!("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"),
        w!("AppsUseLightTheme"),
        RRF_RT_REG_DWORD,
        None,
        Some(&mut value as *mut u32 as *mut _),
        Some(&mut size),
      )
    }
    .is_ok();
    ok && value == 0
  }

  fn font(px_height: i32, weight: i32) -> isize {
    unsafe {
      CreateFontW(
        -px_height, 0, 0, 0, weight, 0, 0, 0, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
        FF_DONTCARE.0 as u32, w!("Segoe UI"),
      )
    }
    .0 as isize
  }

  /// The app's own icon at `size` pixels, from the program the update is for.
  fn app_icon(plan: &Plan, size: i32) -> isize {
    let Some(app) = plan.app_exe.as_ref().filter(|p| p.exists()) else { return 0 };
    use std::os::windows::ffi::OsStrExt;
    let mut wide: Vec<u16> = app.as_os_str().encode_wide().collect();
    wide.resize(260, 0);
    let mut icon = HICON::default();
    let got = unsafe {
      PrivateExtractIconsW(&wide.try_into().unwrap_or([0u16; 260]), 0, size, size, Some(std::slice::from_mut(&mut icon)), None, 0)
    };
    if got >= 1 && !icon.is_invalid() { icon.0 as isize } else { 0 }
  }

  fn make_fonts(ui: &mut Ui) {
    for f in [ui.heading_font, ui.body_font, ui.small_font] {
      if f != 0 {
        unsafe {
          let _ = DeleteObject(HGDIOBJ(f as *mut _));
        }
      }
    }
    ui.heading_font = font(px(19, ui.dpi), FW_SEMIBOLD.0 as i32);
    ui.body_font = font(px(13, ui.dpi), FW_NORMAL.0 as i32);
    ui.small_font = font(px(12, ui.dpi), FW_NORMAL.0 as i32);
    for b in [ui.primary, ui.close] {
      unsafe {
        SendMessageW(hwnd(b), WM_SETFONT, Some(WPARAM(ui.body_font as usize)), Some(LPARAM(1)));
      }
    }
  }

  fn card_height(ui: &Ui) -> i32 {
    if ui.failure.is_some() { CARD_FAILED } else { CARD_WORKING }
  }

  /// The window's outer size for the client area the card needs.
  fn fit(window: HWND, ui: &Ui) {
    let style = WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX;
    let mut rect = RECT { left: 0, top: 0, right: px(WIDTH, ui.dpi), bottom: px(card_height(ui) + MARGIN, ui.dpi) };
    unsafe {
      let _ = AdjustWindowRectExForDpi(&mut rect, style, false, WINDOW_EX_STYLE(0), ui.dpi);
      let _ = SetWindowPos(window, None, 0, 0, rect.right - rect.left, rect.bottom - rect.top, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
    }
  }

  fn place_buttons(ui: &Ui) {
    let d = ui.dpi;
    let bottom = card_height(ui) - PAD;
    let close_w = 104;
    let primary_w = 176;
    let right = WIDTH - MARGIN - PAD;
    unsafe {
      let _ = MoveWindow(hwnd(ui.close), px(right - close_w, d), px(bottom - 30, d), px(close_w, d), px(30, d), true);
      let _ = MoveWindow(hwnd(ui.primary), px(right - close_w - 8 - primary_w, d), px(bottom - 30, d), px(primary_w, d), px(30, d), true);
    }
  }

  fn tint_caption(window: HWND, dark: bool) {
    let c = if dark { &DARK } else { &LIGHT };
    let on: i32 = dark as i32;
    unsafe {
      let _ = DwmSetWindowAttribute(window, DWMWA_USE_IMMERSIVE_DARK_MODE, &on as *const i32 as *const _, 4);
      let caption = cref(c.window);
      let _ = DwmSetWindowAttribute(window, DWMWA_CAPTION_COLOR, &caption as *const COLORREF as *const _, 4);
      let text = cref(c.ink);
      let _ = DwmSetWindowAttribute(window, DWMWA_TEXT_COLOR, &text as *const COLORREF as *const _, 4);
    }
  }

  pub fn show(plan: Plan) {
    unsafe {
      let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
      let _ = InitCommonControlsEx(&INITCOMMONCONTROLSEX {
        dwSize: std::mem::size_of::<INITCOMMONCONTROLSEX>() as u32,
        dwICC: ICC_STANDARD_CLASSES,
      });
    }
    let mut token = 0usize;
    let input = GdiplusStartupInput { GdiplusVersion: 1, ..Default::default() };
    unsafe {
      let _ = GdiplusStartup(&mut token, &input, std::ptr::null_mut());
    }

    let instance: HINSTANCE = unsafe { GetModuleHandleW(None) }.map(Into::into).unwrap_or_default();
    let dark = system_dark();
    let colors = if dark { &DARK } else { &LIGHT };
    let class = w!("GirovoUpdate");
    unsafe {
      let wc = WNDCLASSW {
        lpfnWndProc: Some(proc_),
        hInstance: instance,
        lpszClassName: class,
        hCursor: LoadCursorW(None, IDC_ARROW).unwrap_or_default(),
        hbrBackground: CreateSolidBrush(cref(colors.window)),
        ..Default::default()
      };
      RegisterClassW(&wc);
    }
    let caption = HSTRING::from(plan.name.as_str());
    let style = WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX;
    let Ok(main) = (unsafe {
      CreateWindowExW(WINDOW_EX_STYLE(0), class, PCWSTR(caption.as_ptr()), style, CW_USEDEFAULT, CW_USEDEFAULT, 100, 100, None, None, Some(instance), None)
    }) else {
      let _ = super::run(&plan, &|_| {});
      return;
    };
    let dpi = unsafe { GetDpiForWindow(main) }.max(96);
    tint_caption(main, dark);

    // The small icon in the title bar and the taskbar: the app's.
    let small = app_icon(&plan, px(16, dpi));
    let big = app_icon(&plan, px(32, dpi));
    unsafe {
      if small != 0 {
        SendMessageW(main, WM_SETICON, Some(WPARAM(ICON_SMALL as usize)), Some(LPARAM(small)));
      }
      if big != 0 {
        SendMessageW(main, WM_SETICON, Some(WPARAM(ICON_BIG as usize)), Some(LPARAM(big)));
      }
    }

    let words = plan.words();
    let button = |text: &str, default: bool, id: usize| -> isize {
      let text = HSTRING::from(text);
      let style = WINDOW_STYLE((if default { BS_DEFPUSHBUTTON } else { BS_PUSHBUTTON }) as u32) | WS_CHILD | WS_TABSTOP;
      let made = unsafe {
        CreateWindowExW(WINDOW_EX_STYLE(0), w!("BUTTON"), PCWSTR(text.as_ptr()), style, 0, 0, 10, 10, Some(main), Some(HMENU(id as *mut _)), Some(instance), None)
      };
      let h = made.map(|h| h.0 as isize).unwrap_or(0);
      if dark && h != 0 {
        unsafe {
          let _ = SetWindowTheme(hwnd(h), w!("DarkMode_Explorer"), PCWSTR::null());
        }
      }
      h
    };
    let close = button(words.close, false, ID_CLOSE);
    let primary = button("", true, ID_PRIMARY);

    let mut ui = Ui {
      step: plan.line(Stage::Waiting),
      icon: app_icon(&plan, px(PLATE, dpi)),
      plan: plan.clone(),
      dark,
      dpi,
      heading_font: 0,
      body_font: 0,
      small_font: 0,
      failure: None,
      primary,
      close,
      started: Instant::now(),
    };
    make_fonts(&mut ui);
    fit(main, &ui);
    // Centred on the screen the window is on.
    unsafe {
      let mut r = RECT::default();
      let _ = GetWindowRect(main, &mut r);
      let (w, h) = (r.right - r.left, r.bottom - r.top);
      let (sw, sh) = (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN));
      let _ = SetWindowPos(main, None, (sw - w) / 2, (sh - h) / 2, 0, 0, SWP_NOSIZE | SWP_NOZORDER);
    }
    let _ = UI.set(Mutex::new(ui));
    unsafe {
      SetTimer(Some(main), TIMER, 16, None);
      let _ = ShowWindow(main, SW_SHOWNORMAL);
      let _ = UpdateWindow(main);
    }

    // The work beside the window; it reports through messages.
    let raw = main.0 as isize;
    let shown = Instant::now();
    let after = plan.clone();
    let finished = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let done = finished.clone();
    std::thread::spawn(move || {
      let post = |msg: u32, w: usize| unsafe {
        let _ = PostMessageW(Some(hwnd(raw)), msg, WPARAM(w), LPARAM(0));
      };
      let report = |stage: Stage| post(WM_STAGE, stage as usize);
      match super::run(&plan, &report) {
        Ok(()) => {
          // A quick update: the window stays until MIN_SHOWN, saying "Update abschließen".
          std::thread::sleep(super::MIN_SHOWN.saturating_sub(shown.elapsed()));
          done.store(true, std::sync::atomic::Ordering::SeqCst);
          post(WM_DONE, 0);
        }
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
      GdiplusShutdown(token);
    }
    // Girovo only once the window has gone, never beside it (owner, 2026-11-07).
    if finished.load(std::sync::atomic::Ordering::SeqCst) {
      super::start_app(&after);
    }
  }

  const STAGES: [Stage; 4] = [Stage::Waiting, Stage::Checking, Stage::Installing, Stage::Starting];

  /// A rounded rectangle, smooth, in 0xRRGGBB.
  unsafe fn round_rect(g: *mut GpGraphics, x: f32, y: f32, w: f32, h: f32, r: f32, rgb: u32) {
    if w <= 0.0 || h <= 0.0 {
      return;
    }
    let r = r.min(w / 2.0).min(h / 2.0);
    let d = r * 2.0;
    let mut path: *mut GpPath = std::ptr::null_mut();
    let mut brush: *mut GpSolidFill = std::ptr::null_mut();
    unsafe {
      GdipCreatePath(FillModeAlternate, &mut path);
      if r > 0.0 {
        GdipAddPathArc(path, x, y, d, d, 180.0, 90.0);
        GdipAddPathArc(path, x + w - d, y, d, d, 270.0, 90.0);
        GdipAddPathArc(path, x + w - d, y + h - d, d, d, 0.0, 90.0);
        GdipAddPathArc(path, x, y + h - d, d, d, 90.0, 90.0);
      } else {
        GdipAddPathRectangle(path, x, y, w, h);
      }
      GdipClosePathFigure(path);
      GdipCreateSolidFill(0xff00_0000 | rgb, &mut brush);
      GdipFillPath(g, brush as *mut GpBrush, path);
      GdipDeleteBrush(brush as *mut GpBrush);
      GdipDeletePath(path);
    }
  }

  unsafe fn text(dc: HDC, font: isize, rgb: u32, s: &str, rect: &mut RECT, flags: DRAW_TEXT_FORMAT) {
    let mut wide: Vec<u16> = s.encode_utf16().collect();
    unsafe {
      SelectObject(dc, HGDIOBJ(font as *mut _));
      SetTextColor(dc, cref(rgb));
      DrawTextW(dc, &mut wide, rect, flags);
    }
  }

  fn paint(window: HWND, ui: &Ui) {
    let mut client = RECT::default();
    unsafe {
      let _ = GetClientRect(window, &mut client);
    }
    let mut ps = PAINTSTRUCT::default();
    let screen = unsafe { BeginPaint(window, &mut ps) };
    unsafe {
      let dc = CreateCompatibleDC(Some(screen));
      let bitmap = CreateCompatibleBitmap(screen, client.right, client.bottom);
      let old = SelectObject(dc, HGDIOBJ(bitmap.0));
      render(dc, client, ui);
      let _ = BitBlt(screen, 0, 0, client.right, client.bottom, Some(dc), 0, 0, SRCCOPY);
      SelectObject(dc, old);
      let _ = DeleteObject(HGDIOBJ(bitmap.0));
      let _ = DeleteDC(dc);
      let _ = EndPaint(window, &ps);
    }
  }

  /// The window's client area, drawn into `dc`.
  fn render(dc: HDC, client: RECT, ui: &Ui) {
    let c = if ui.dark { &DARK } else { &LIGHT };
    let d = ui.dpi;
    let p = |v: i32| px(v, d);
    let card_h = p(card_height(ui));
    let (ix, iy) = (p(MARGIN + PAD), p(PAD));
    let tx = p(MARGIN + PAD + PLATE + GAP);
    let right = client.right - p(MARGIN + PAD);
    unsafe {
      let back = CreateSolidBrush(cref(c.window));
      FillRect(dc, &client, back);
      let _ = DeleteObject(HGDIOBJ(back.0));

      // Shapes first, through GDI+ (smooth edges). GDI+ keeps its drawing
      // until the Graphics goes, so text and the icon follow only after it:
      // drawn in between, the card would land on top of them.
      let mut g: *mut GpGraphics = std::ptr::null_mut();
      GdipCreateFromHDC(dc, &mut g);
      GdipSetSmoothingMode(g, SmoothingModeAntiAlias);
      // The card, below the title bar, with the window's tint round it.
      round_rect(g, p(MARGIN) as f32, 0.0, (client.right - p(MARGIN) * 2) as f32, card_h as f32, p(6) as f32, c.card);
      // Without the app's icon, a plate of the edition's colour.
      if ui.icon == 0 {
        let nightly = ui.plan.name.contains("Nightly");
        round_rect(g, ix as f32, iy as f32, p(PLATE) as f32, p(PLATE) as f32, p(14) as f32, if nightly { 0xf5a623 } else { 0x0a2c5e });
      }
      if ui.failure.is_none() {
        // The bar: a rounded track, a rounded part running along it.
        let (bx, by, bw, bh) = (tx as f32, p(PAD + 58) as f32, (right - tx) as f32, p(4).max(3) as f32);
        round_rect(g, bx, by, bw, bh, bh / 2.0, c.track);
        let t = (ui.started.elapsed().as_secs_f32() % 1.4) / 1.4;
        let eased = t * t * (3.0 - 2.0 * t);
        let seg = bw * 0.35;
        let start = -seg + (bw + seg) * eased;
        let (s0, s1) = (start.max(0.0), (start + seg).min(bw));
        if s1 > s0 {
          round_rect(g, bx + s0, by, s1 - s0, bh, bh / 2.0, c.accent);
        }
      }
      GdipDeleteGraphics(g);

      // Then GDI: the icon and the text (ClearType).
      if ui.icon != 0 {
        let _ = DrawIconEx(dc, ix, iy, HICON(ui.icon as *mut _), p(PLATE), p(PLATE), 0, None, DI_NORMAL);
      }
      SetBkMode(dc, TRANSPARENT);
      let words = ui.plan.words();
      if let Some(failure) = ui.failure.as_ref() {
        let mut r = RECT { left: tx, top: p(PAD) - p(1), right, bottom: p(PAD + 28) };
        text(dc, ui.heading_font, c.ink, words.failed, &mut r, DT_LEFT | DT_SINGLELINE | DT_END_ELLIPSIS);
        let mut r = RECT { left: tx, top: p(PAD + 30), right, bottom: card_h - p(PAD + 30 + 10) };
        text(dc, ui.body_font, c.ink2, &ui.plan.why(failure), &mut r, DT_LEFT | DT_WORDBREAK);
      } else {
        let mut r = RECT { left: tx, top: p(PAD) - p(1), right, bottom: p(PAD + 28) };
        text(dc, ui.heading_font, c.ink, words.title, &mut r, DT_LEFT | DT_SINGLELINE | DT_END_ELLIPSIS);
        let mut r = RECT { left: tx, top: p(PAD + 28), right, bottom: p(PAD + 48) };
        text(dc, ui.body_font, c.ink2, &ui.plan.version_line(), &mut r, DT_LEFT | DT_SINGLELINE | DT_END_ELLIPSIS);
        let mut r = RECT { left: tx, top: p(PAD + 70), right, bottom: p(PAD + 88) };
        text(dc, ui.small_font, c.ink2, &ui.step, &mut r, DT_LEFT | DT_SINGLELINE | DT_END_ELLIPSIS);
      }
    }
  }

  /// A debug build's picture of the window, without showing one:
  /// `girovo-update --snapshot out.bmp --dark|--light [--failed] [--dpi 144] <the usual arguments>`.
  #[cfg(debug_assertions)]
  pub fn snapshot(plan: Plan, out: &std::path::Path, dark: bool, failed: bool, dpi: u32) {
    let mut token = 0usize;
    let input = GdiplusStartupInput { GdiplusVersion: 1, ..Default::default() };
    unsafe {
      let _ = GdiplusStartup(&mut token, &input, std::ptr::null_mut());
    }
    let mut ui = Ui {
      step: plan.line(Stage::Installing),
      icon: app_icon(&plan, px(PLATE, dpi)),
      plan,
      dark,
      dpi,
      heading_font: 0,
      body_font: 0,
      small_font: 0,
      failure: failed.then_some(Failure::InstallerFailed(2)),
      primary: 0,
      close: 0,
      started: Instant::now() - std::time::Duration::from_millis(560),
    };
    make_fonts(&mut ui);
    let (w, h) = (px(WIDTH, dpi), px(card_height(&ui) + MARGIN, dpi));
    let client = RECT { left: 0, top: 0, right: w, bottom: h };
    unsafe {
      let screen = GetDC(None);
      let dc = CreateCompatibleDC(Some(screen));
      let bitmap = CreateCompatibleBitmap(screen, w, h);
      let old = SelectObject(dc, HGDIOBJ(bitmap.0));
      render(dc, client, &ui);
      // Top-down 32-bit pixels out of the bitmap, into a .bmp file.
      let mut info = BITMAPINFO::default();
      info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
      info.bmiHeader.biWidth = w;
      info.bmiHeader.biHeight = -h;
      info.bmiHeader.biPlanes = 1;
      info.bmiHeader.biBitCount = 32;
      let mut pixels = vec![0u8; (w * h * 4) as usize];
      GetDIBits(dc, bitmap, 0, h as u32, Some(pixels.as_mut_ptr() as *mut _), &mut info, DIB_RGB_COLORS);
      // GDI's text leaves the alpha byte at 0; the screen ignores it, a picture viewer would not.
      for px in pixels.chunks_exact_mut(4) {
        px[3] = 255;
      }
      SelectObject(dc, old);
      let _ = DeleteObject(HGDIOBJ(bitmap.0));
      let _ = DeleteDC(dc);
      ReleaseDC(None, screen);
      let mut file = Vec::with_capacity(54 + pixels.len());
      let size = (54 + pixels.len()) as u32;
      file.extend_from_slice(b"BM");
      file.extend_from_slice(&size.to_le_bytes());
      file.extend_from_slice(&0u32.to_le_bytes());
      file.extend_from_slice(&54u32.to_le_bytes());
      file.extend_from_slice(&40u32.to_le_bytes());
      file.extend_from_slice(&w.to_le_bytes());
      file.extend_from_slice(&(-h).to_le_bytes());
      file.extend_from_slice(&1u16.to_le_bytes());
      file.extend_from_slice(&32u16.to_le_bytes());
      file.extend_from_slice(&[0u8; 24]);
      file.extend_from_slice(&pixels);
      let _ = std::fs::write(out, file);
      GdiplusShutdown(token);
    }
  }

  unsafe extern "system" fn proc_(window: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
      WM_PAINT => {
        if let Some(ui) = UI.get() {
          paint(window, &ui.lock().unwrap());
          return LRESULT(0);
        }
        unsafe { DefWindowProcW(window, msg, wparam, lparam) }
      }
      WM_ERASEBKGND => LRESULT(1),
      WM_TIMER => {
        unsafe {
          let _ = InvalidateRect(Some(window), None, false);
        }
        LRESULT(0)
      }
      WM_STAGE => {
        if let (Some(ui), Some(stage)) = (UI.get(), STAGES.get(wparam.0)) {
          let mut ui = ui.lock().unwrap();
          ui.step = ui.plan.line(*stage);
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
          unsafe {
            let _ = KillTimer(Some(window), TIMER);
          }
          fit(window, &ui);
          place_buttons(&ui);
          let label = match super::way_on(&ui.plan) {
            WayOn::Open(_) => Some(words.open),
            WayOn::Download(_) => Some(words.download),
            WayOn::None => None,
          };
          unsafe {
            let _ = ShowWindow(hwnd(ui.close), SW_SHOW);
            if let Some(label) = label {
              let label = HSTRING::from(label);
              let _ = SetWindowTextW(hwnd(ui.primary), PCWSTR(label.as_ptr()));
              let _ = ShowWindow(hwnd(ui.primary), SW_SHOW);
            }
            let _ = InvalidateRect(Some(window), None, false);
          }
        }
        LRESULT(0)
      }
      WM_DPICHANGED => {
        if let Some(ui) = UI.get() {
          let mut ui = ui.lock().unwrap();
          ui.dpi = ((wparam.0 & 0xffff) as u32).max(96);
          make_fonts(&mut ui);
          ui.icon = app_icon(&ui.plan, px(PLATE, ui.dpi));
          let suggested = unsafe { &*(lparam.0 as *const RECT) };
          unsafe {
            let _ = SetWindowPos(window, None, suggested.left, suggested.top, suggested.right - suggested.left, suggested.bottom - suggested.top, SWP_NOZORDER | SWP_NOACTIVATE);
          }
          if ui.failure.is_some() {
            place_buttons(&ui);
          }
        }
        LRESULT(0)
      }
      WM_COMMAND => {
        // Only after a failure, like WM_CLOSE below: Enter and Esc arrive
        // here as commands at any time (super::pressed).
        let failed = UI.get().is_some_and(|ui| ui.lock().unwrap().failure.is_some());
        let Some(pressed) = super::pressed(wparam.0 & 0xffff, failed) else { return LRESULT(0) };
        if pressed == Pressed::Primary {
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
        let _ = unsafe { DestroyWindow(window) };
        LRESULT(0)
      }
      WM_CTLCOLORBTN => {
        // The buttons' corners in the card's colour.
        let dark = UI.get().is_some_and(|ui| ui.lock().unwrap().dark);
        LRESULT(unsafe { CreateSolidBrush(cref(if dark { DARK.card } else { LIGHT.card })) }.0 as isize)
      }
      WM_CLOSE => {
        // While the installer works the window stays: closing it would only hide what is happening.
        let failed = UI.get().is_some_and(|ui| ui.lock().unwrap().failure.is_some());
        if failed {
          let _ = unsafe { DestroyWindow(window) };
        }
        LRESULT(0)
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
    assert_eq!(plan.line(Stage::Installing), "Installing the update …");
    assert_eq!(plan.version_line(), "Version 6.0.3");
  }

  #[test]
  fn girovo_is_started_by_this_not_by_the_installer() {
    let tauri = Plan {
      app_exe: Some(PathBuf::from("C:\\Apps\\Girovo\\Girovo.exe")),
      installer_args: args(&["/S", "/UPDATE", "/R", "/ARGS", "--updated", "--force-run"]),
      ..Plan::default()
    };
    assert_eq!(tauri.install_args(), ["/S", "/UPDATE", "/ARGS", "--updated"]);
    assert_eq!(tauri.app_args(), ["--updated"]);
    // 5.x's electron-builder installer, on the way back.
    let electron = Plan { installer_args: args(&["/S", "--updated", "--force-run"]), ..tauri.clone() };
    assert_eq!(electron.install_args(), ["/S", "--updated"]);
    assert_eq!(electron.app_args(), ["--updated"]);
    // Without an app to start, the installer still starts it.
    let alone = Plan { app_exe: None, ..tauri.clone() };
    assert_eq!(alone.install_args(), tauri.installer_args);
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
  fn enter_esc_and_the_buttons_do_nothing_while_the_update_runs() {
    // 1 and 2 are what Windows sends for Enter and Esc (IDOK, IDCANCEL).
    for id in [1, 2, ID_PRIMARY, ID_CLOSE] {
      assert_eq!(pressed(id, false), None, "{id} while the installer works");
    }
    assert!(![1, 2].contains(&ID_PRIMARY) && ![1, 2].contains(&ID_CLOSE), "the buttons are not Enter and Esc");
    // After a failure the buttons are there, and the keys go with them.
    assert_eq!(pressed(ID_PRIMARY, true), Some(Pressed::Primary));
    assert_eq!(pressed(ID_CLOSE, true), Some(Pressed::Close));
    assert_eq!(pressed(1, true), Some(Pressed::Primary));
    assert_eq!(pressed(2, true), Some(Pressed::Close));
    assert_eq!(pressed(7, true), None);
  }

  #[test]
  fn the_version_reads_as_a_person_says_it() {
    let at = |v: &str| Plan { version: v.into(), ..Plan::default() }.version_line();
    assert_eq!(at("6.0.2-nightly.202611072051.gf607061"), "Version 6.0.2 Nightly");
    assert_eq!(at("6.0.0-preview.202611071208.gef82cf6"), "Version 6.0.0 Nightly");
    assert_eq!(at("6.0.0-preview.3"), "Version 6.0.0 Preview 3");
    assert_eq!(at("6.0.2"), "Version 6.0.2");
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
