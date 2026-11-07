// The window that stands in for the app while an update installs (6.0, Tauri),
// in place of the Electron shell's C# install window (UpdateWindow.cs): the start window's card
// (shell/splash.html), drawn by this very program started a second time from a
// copy outside the installation — which the installer is about to replace —
// with `--install-window` and the same arguments the C# window took.
//
// It takes over from the start window, which downloaded the update: what is
// happening beside the G€ plate (--header), the steps (--step state:label)
// with the install's at work, the version line (--footer). It only watches:
// the installer's exit says how it went (--installer-pid). Then "Girovo
// starten" until the new version's window is up — started by this window
// when the installer did not start it itself (--app-exe) — and it closes.
// An installer that fails leaves the reason and the way on (open Girovo while
// it is still there, else the download page, --releases-url).
//
// Its WebView2 folder is a temporary one: the app's own is the app's.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::texts::{Install, Lang};

const LABEL: &str = "install";
/// How long the new version may take to show its window before this one goes anyway.
const APP_LIMIT: Duration = Duration::from_secs(60);
/// How long an installer may run before this window stops watching.
const INSTALL_LIMIT: Duration = Duration::from_secs(15 * 60);

#[derive(Default, Clone)]
pub struct Options {
  pub installer_pid: u32,
  pub app_exe: String,
  pub version: String,
  pub releases_url: String,
  pub dark: bool,
  pub lang: Option<Lang>,
  pub header: String,
  pub footer: String,
  /// The start window's steps as they stood: (state, label).
  pub steps: Vec<(String, String)>,
}

impl Options {
  /// The arguments the C# window took (the Electron shell's main.cjs showInstallWindow), after `--install-window`.
  pub fn parse(args: &[String]) -> Options {
    let mut o = Options::default();
    let mut it = args.iter();
    while let Some(a) = it.next() {
      let mut value = || it.next().cloned().unwrap_or_default();
      match a.as_str() {
        "--installer-pid" => o.installer_pid = value().parse().unwrap_or(0),
        "--app-exe" => o.app_exe = value(),
        "--version" => o.version = value(),
        "--releases-url" => o.releases_url = value(),
        "--theme" => o.dark = value() == "dark",
        "--lang" => o.lang = Some(if value() == "en" { Lang::En } else { Lang::De }),
        "--header" => o.header = value(),
        "--footer" => o.footer = value(),
        "--step" => {
          let v = value();
          if let Some((state, label)) = v.split_once(':') {
            o.steps.push((state.to_string(), label.to_string()));
          }
        }
        _ => {}
      }
    }
    o
  }

  /// The same, as arguments for the copy to start with.
  pub fn args(&self) -> Vec<String> {
    let mut a = vec!["--install-window".to_string()];
    let mut push = |k: &str, v: String| {
      a.push(k.to_string());
      a.push(v);
    };
    push("--installer-pid", self.installer_pid.to_string());
    push("--app-exe", self.app_exe.clone());
    push("--version", self.version.clone());
    push("--releases-url", self.releases_url.clone());
    push("--theme", if self.dark { "dark".into() } else { "light".into() });
    push("--lang", if self.lang == Some(Lang::En) { "en".into() } else { "de".into() });
    push("--header", self.header.clone());
    push("--footer", self.footer.clone());
    for (state, label) in &self.steps {
      push("--step", format!("{state}:{label}"));
    }
    a
  }
}

/// Started with `--install-window`: this run is the install window, not the app.
pub fn requested() -> bool {
  std::env::args().nth(1).as_deref() == Some("--install-window")
}

/// Copies this program out of the installation and starts the copy as the install
/// window for `options`; the app quits right after, so the installer may replace it.
pub fn spawn(options: &Options) -> std::io::Result<()> {
  let exe = std::env::current_exe()?;
  let dir = std::env::temp_dir().join("girovo-update");
  std::fs::create_dir_all(&dir)?;
  let copy = dir.join("Girovo-Update.exe");
  std::fs::copy(&exe, &copy)?;
  std::process::Command::new(copy).args(options.args()).spawn()?;
  Ok(())
}

struct State {
  options: Options,
  lang: Lang,
  /// Index of the step at work; the steps after it wait.
  at: usize,
  failed: bool,
}

fn model(s: &State) -> Value {
  let words = Install::of(s.lang);
  if s.failed {
    let app_there = !s.options.app_exe.is_empty() && PathBuf::from(&s.options.app_exe).exists();
    let mut actions = vec![json!({ "id": "close", "label": words.close })];
    if app_there {
      actions.push(json!({ "id": "open", "label": words.open, "primary": true }));
    } else if s.options.releases_url.starts_with("https://github.com/") {
      actions.push(json!({ "id": "download", "label": words.download, "primary": true }));
    }
    return json!({
      "dark": s.options.dark,
      "title": words.failed_title,
      "version": s.options.footer,
      "steps": [],
      "note": if app_there { words.failed_kept } else { words.failed_gone },
      "actions": actions,
    });
  }
  let steps: Vec<Value> = s
    .options
    .steps
    .iter()
    .enumerate()
    .map(|(i, (_, label))| {
      let state = if i < s.at { "done" } else if i == s.at { "active" } else { "pending" };
      json!({ "key": i.to_string(), "label": label, "state": state })
    })
    .collect();
  let title = if s.options.header.is_empty() { words.title.to_string() } else { s.options.header.clone() };
  json!({ "dark": s.options.dark, "nightly": crate::edition::nightly(), "title": title, "version": s.options.footer, "steps": steps, "note": null })
}

/// The install window's run: its own small app, the card, the watching.
pub fn run() {
  let args: Vec<String> = std::env::args().skip(2).collect();
  let options = Options::parse(&args);
  // The installer's process, held first thing: it started a moment before
  // this window, and one that failed fast must not have gone unwatched by the
  // time the window is up (an exit nobody saw would be taken for success).
  let installer = Installer::open(options.installer_pid);
  let lang = options.lang.unwrap_or(Lang::De);
  // At work: the first step the start window had not finished — its install.
  let at = options.steps.iter().position(|(state, _)| state != "done").unwrap_or(0);
  let state = State { options, lang, at, failed: false };
  let first = model(&state);
  let data_dir = std::env::temp_dir().join("girovo-update").join("webview2");
  tauri::Builder::default()
    .runtime(tauri_runtime_wry::Wry::default())
    .manage(Mutex::new(state))
    .register_uri_scheme_protocol("girovo-shell", |_ctx, request| crate::shell::serve_shell(request.uri().path()))
    .setup(move |app| {
      let base = if cfg!(windows) { "http://girovo-shell.localhost/splash.html" } else { "girovo-shell://localhost/splash.html" };
      let hash: String = first.to_string().bytes().map(|b| {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }
      }).collect();
      let url = tauri::Url::parse(&format!("{base}#{hash}")).expect("install url");
      WebviewWindowBuilder::new(app, LABEL, WebviewUrl::CustomProtocol(url))
        .title(crate::edition::name())
        .inner_size(496.0, 320.0)
        .resizable(false)
        .maximizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .center()
        .always_on_top(false)
        .data_directory(data_dir.clone())
        .additional_browser_args(&crate::shell::browser_args())
        .build()?;
      let handle = app.handle().clone();
      std::thread::spawn(move || watch(handle, installer));
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![splash_fit, splash_action])
    .run(tauri::generate_context!())
    .expect("error while running the install window");
}

fn render(app: &AppHandle) {
  let js = {
    let s = app.state::<Mutex<State>>();
    let s = s.lock().unwrap();
    format!("window.splash && window.splash.render({})", model(&s))
  };
  if let Some(w) = app.get_webview_window(LABEL) {
    let _ = w.eval(js);
  }
}

/// The installer's exit, then the new version's window.
fn watch(app: AppHandle, installer: Installer) {
  let app_exe = app.state::<Mutex<State>>().lock().unwrap().options.app_exe.clone();
  let code = installer.wait(INSTALL_LIMIT);
  // Not watched (it could not be held): how it went is not known, so this
  // window starts nothing itself — only the installer's own start counts.
  let watched = code.is_some();
  if code != Some(0) && code.is_some() {
    app.state::<Mutex<State>>().lock().unwrap().failed = true;
    render(&app);
    return;
  }
  // Installed: the install's step done, "Girovo starten" at work.
  {
    let s = app.state::<Mutex<State>>();
    let mut s = s.lock().unwrap();
    s.at = (s.at + 1).min(s.options.steps.len().saturating_sub(1));
  }
  render(&app);
  let started = Instant::now();
  let mut launched = false;
  while started.elapsed() < APP_LIMIT {
    if !app_exe.is_empty() && window_of(&app_exe) {
      break;
    }
    // The installer did not start it within a few seconds: this window does.
    if watched && !launched && started.elapsed() > Duration::from_secs(4) && !app_exe.is_empty() {
      launched = std::process::Command::new(&app_exe).spawn().is_ok();
    }
    std::thread::sleep(Duration::from_millis(250));
  }
  app.exit(0);
}

/// The card says how tall it is (shell/splash.html fit()), as in the start window.
#[tauri::command]
fn splash_fit(app: AppHandle, height: f64) {
  if let Some(w) = app.get_webview_window(LABEL) {
    let _ = w.set_size(tauri::LogicalSize::new(496.0, height.clamp(120.0, 900.0)));
  }
}

/// The card's buttons after a failure.
#[tauri::command]
fn splash_action(app: AppHandle, id: String) {
  let (app_exe, url) = {
    let s = app.state::<Mutex<State>>();
    let s = s.lock().unwrap();
    (s.options.app_exe.clone(), s.options.releases_url.clone())
  };
  match id.as_str() {
    "open" if !app_exe.is_empty() => {
      let _ = std::process::Command::new(app_exe).spawn();
    }
    "download" => crate::shell::open_external(&url),
    _ => {}
  }
  app.exit(0);
}

/// The installer's process, held from the install window's first moment: its
/// handle as a number (it crosses to the watching thread).
struct Installer(Option<isize>);

#[cfg(windows)]
impl Installer {
  fn open(pid: u32) -> Self {
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE};
    if pid == 0 {
      return Installer(None);
    }
    let process = unsafe { OpenProcess(PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, false, pid) };
    Installer(process.ok().map(|h| h.0 as isize))
  }

  /// Waits for it to end: its exit code, or None when it could not be held.
  fn wait(&self, limit: Duration) -> Option<u32> {
    use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
    use windows::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};
    let process = HANDLE(self.0? as *mut core::ffi::c_void);
    unsafe {
      let waited = WaitForSingleObject(process, limit.as_millis() as u32);
      let mut code = 1u32;
      let got = waited == WAIT_OBJECT_0 && GetExitCodeProcess(process, &mut code).is_ok();
      let _ = CloseHandle(process);
      if got { Some(code) } else { Some(1) }
    }
  }
}

#[cfg(not(windows))]
impl Installer {
  fn open(_pid: u32) -> Self {
    Installer(None)
  }
  fn wait(&self, _limit: Duration) -> Option<u32> {
    None
  }
}

/// Whether a visible window of a process started from `exe` is up.
#[cfg(windows)]
fn window_of(exe: &str) -> bool {
  use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
  use windows::Win32::System::Threading::{OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW};
  use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowThreadProcessId, IsWindowVisible};
  use windows::core::{BOOL, PWSTR};

  struct Search {
    exe: String,
    found: bool,
  }
  unsafe extern "system" fn each(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let search = unsafe { &mut *(lparam.0 as *mut Search) };
    unsafe {
      if !IsWindowVisible(hwnd).as_bool() {
        return true.into();
      }
      let mut pid = 0u32;
      GetWindowThreadProcessId(hwnd, Some(&mut pid));
      if let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
        let mut buf = [0u16; 520];
        let mut len = buf.len() as u32;
        if QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok() {
          let path = String::from_utf16_lossy(&buf[..len as usize]);
          if path.eq_ignore_ascii_case(&search.exe) {
            search.found = true;
          }
        }
        let _ = CloseHandle(process);
      }
      (!search.found).into()
    }
  }
  let mut search = Search { exe: exe.to_string(), found: false };
  unsafe {
    let _ = EnumWindows(Some(each), LPARAM(&mut search as *mut Search as isize));
  }
  search.found
}

#[cfg(not(windows))]
fn window_of(_exe: &str) -> bool {
  false
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn arguments_round_trip() {
    let o = Options {
      installer_pid: 42,
      app_exe: "C:\\Apps\\Girovo\\Girovo.exe".into(),
      version: "6.0.1".into(),
      releases_url: "https://github.com/elNino0916/Girovo/releases".into(),
      dark: true,
      lang: Some(Lang::En),
      header: "Updating Girovo".into(),
      footer: "Version 6.0.0 → 6.0.1".into(),
      steps: vec![("done".into(), "Download the update".into()), ("active".into(), "Install the update".into())],
    };
    let args = o.args();
    let back = Options::parse(&args[1..]);
    assert_eq!(back.installer_pid, 42);
    assert_eq!(back.app_exe, o.app_exe);
    assert!(back.dark);
    assert_eq!(back.lang, Some(Lang::En));
    assert_eq!(back.steps, o.steps);
    assert_eq!(back.footer, o.footer);
  }

  #[test]
  fn a_failure_offers_the_download_page_when_girovo_is_gone() {
    let s = State {
      options: Options { app_exe: "C:\\nowhere\\Girovo.exe".into(), releases_url: "https://github.com/elNino0916/Girovo/releases".into(), ..Default::default() },
      lang: Lang::De,
      at: 0,
      failed: true,
    };
    let m = model(&s);
    assert_eq!(m["title"], "Update nicht abgeschlossen");
    assert_eq!(m["actions"][1]["id"], "download");
  }
}
