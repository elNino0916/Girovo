// "MT-Media als Herausgeber" in Einstellungen → Sicherheit (Windows only,
// docs/mt-media-code-signing.md): whether the machine trusts the MT-Media
// code-signing certificate Girovo's programs are signed with, and the way to
// put it in or take it out.
//
// This process only reads the stores. Changing them needs an administrator,
// so install and remove start girovo-cert.exe (cert-helper/, beside
// Girovo.exe) through Windows' "run as administrator"; UAC asks first. The
// page has already asked the person (components/settings/PublisherCert.tsx).
// After the helper ends, the stores are read again: "done" only when Windows
// shows the change.

use serde::Serialize;

#[path = "../cert-helper/src/identity.rs"]
mod identity;

/// The helper's exit codes (cert-helper/src/lib.rs).
const HELPER_OK: i32 = 0;
const HELPER_REFUSED: i32 = 3;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
  /// false off Windows (and where this build has no helper).
  pub available: bool,
  /// notInstalled | trusted | invalid | expired | mismatch
  pub state: &'static str,
  pub publisher: &'static str,
  pub subject: &'static str,
  pub thumbprint: &'static str,
  pub sha256: &'static str,
  /// The certificate's last valid day, "2028-11-14" (UTC).
  pub valid_until: String,
  pub in_root: bool,
  pub in_trusted_publisher: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
  /// done | canceled | refused | failed | unavailable
  pub result: &'static str,
  pub status: Status,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub code: Option<i32>,
}

/// What the stores say, from the facts read out of them.
#[derive(Debug, Default, Clone, Copy)]
struct Found {
  in_root: bool,
  in_trusted_publisher: bool,
  /// In a Disallowed store (the machine's or this user's).
  disallowed: bool,
  /// Another certificate named MT-Media in Root or TrustedPublisher.
  other_mt_media: bool,
  expired: bool,
  /// Windows built a chain to a trusted root for code signing, without errors.
  chain_trusted: bool,
}

fn state_of(f: Found) -> &'static str {
  if !f.in_root && !f.in_trusted_publisher {
    return if f.other_mt_media { "mismatch" } else if f.expired { "expired" } else { "notInstalled" };
  }
  if f.expired {
    return "expired";
  }
  if f.in_root && f.in_trusted_publisher && !f.disallowed && f.chain_trusted { "trusted" } else { "invalid" }
}

/// FILETIME ticks (100 ns since 1601) to a UTC date, "YYYY-MM-DD".
fn date_of(ticks: u64) -> String {
  let secs = (ticks / 10_000_000) as i64 - 11_644_473_600;
  // Howard Hinnant's days-to-civil.
  let z = secs.div_euclid(86_400) + 719_468;
  let era = z.div_euclid(146_097);
  let doe = z - era * 146_097;
  let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
  let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  let mp = (5 * doy + 2) / 153;
  let d = doy - (153 * mp + 2) / 5 + 1;
  let m = if mp < 10 { mp + 3 } else { mp - 9 };
  let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
  format!("{y:04}-{m:02}-{d:02}")
}

fn status_from(available: bool, f: Found, valid_until: String) -> Status {
  Status {
    available,
    state: state_of(f),
    publisher: identity::COMMON_NAME,
    subject: identity::SUBJECT,
    thumbprint: identity::THUMBPRINT_HEX,
    sha256: identity::SHA256_HEX,
    valid_until,
    in_root: f.in_root,
    in_trusted_publisher: f.in_trusted_publisher,
  }
}

#[cfg(windows)]
mod win {
  use super::*;
  use identity::*;
  use std::ffi::c_void;
  use windows::Win32::Foundation::{CloseHandle, ERROR_CANCELLED, HWND, WAIT_OBJECT_0};
  use windows::Win32::Security::Cryptography::*;
  use windows::Win32::System::Threading::{GetExitCodeProcess, INFINITE, WaitForSingleObject};
  use windows::Win32::UI::Shell::{SEE_MASK_NOCLOSEPROCESS, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW, ShellExecuteExW};
  use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;
  use windows::core::{PCWSTR, w};

  /// Builds the chain the machine's engine sees for code signing and asks the base policy.
  fn chain_trusted(cert: &Cert) -> bool {
    unsafe {
      let mut oid = CODE_SIGNING_OID_Z.as_ptr() as *mut u8;
      let para = CERT_CHAIN_PARA {
        cbSize: std::mem::size_of::<CERT_CHAIN_PARA>() as u32,
        RequestedUsage: CERT_USAGE_MATCH {
          dwType: USAGE_MATCH_TYPE_AND,
          Usage: CTL_USAGE { cUsageIdentifier: 1, rgpszUsageIdentifier: &mut oid as *mut *mut u8 as *mut windows::core::PSTR },
        },
        ..Default::default()
      };
      let mut chain: *mut CERT_CHAIN_CONTEXT = std::ptr::null_mut();
      // HCCE_LOCAL_MACHINE: the machine's engine, so a root only this user trusts does not count.
      let engine = HCERTCHAINENGINE(1usize as *mut c_void);
      if CertGetCertificateChain(Some(engine), cert.ctx(), None, None, &para, 0, None, &mut chain).is_err() || chain.is_null() {
        return false;
      }
      let policy = CERT_CHAIN_POLICY_PARA { cbSize: std::mem::size_of::<CERT_CHAIN_POLICY_PARA>() as u32, ..Default::default() };
      let mut out = CERT_CHAIN_POLICY_STATUS { cbSize: std::mem::size_of::<CERT_CHAIN_POLICY_STATUS>() as u32, ..Default::default() };
      let checked = CertVerifyCertificateChainPolicy(CERT_CHAIN_POLICY_BASE, chain, &policy, &mut out).as_bool();
      let clean = (*chain).TrustStatus.dwErrorStatus == 0;
      CertFreeCertificateChain(chain);
      checked && clean && out.dwError == 0
    }
  }

  const CODE_SIGNING_OID_Z: &[u8] = b"1.3.6.1.5.5.7.3.3\0";

  pub fn read() -> Status {
    let Ok(cert) = check(CER) else {
      return status_from(false, Found::default(), String::new());
    };
    let mut f = Found { expired: cert.time_validity() > 0, ..Found::default() };
    for name in STORES {
      let Some(store) = Store::machine(name, false) else { continue };
      let ours = store.find(&THUMBPRINT).is_some();
      if name == "Root" {
        f.in_root = ours;
      } else {
        f.in_trusted_publisher = ours;
      }
      if store.mt_media().iter().any(|t| *t != THUMBPRINT) {
        f.other_mt_media = true;
      }
    }
    f.disallowed = Store::machine("Disallowed", false).is_some_and(|s| s.find(&THUMBPRINT).is_some())
      || Store::user("Disallowed").is_some_and(|s| s.find(&THUMBPRINT).is_some());
    if f.in_root && f.in_trusted_publisher {
      f.chain_trusted = chain_trusted(&cert);
    }
    status_from(helper().is_some(), f, date_of(cert.not_after()))
  }

  /// girovo-cert.exe beside this program (the bundle's sidecar; Tauri copies it for debug builds too).
  pub fn helper() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let helper = exe.parent()?.join("girovo-cert.exe");
    helper.is_file().then_some(helper)
  }

  /// Runs the helper elevated and waits. Ok(exit code), Err(None) when the
  /// person said no to UAC, Err(Some(hresult)) when it would not start.
  pub fn run_elevated(word: &str, owner: isize) -> Result<i32, Option<i32>> {
    let helper = helper().ok_or(Some(0))?;
    let file: Vec<u16> = helper.as_os_str().to_string_lossy().encode_utf16().chain(Some(0)).collect();
    let args: Vec<u16> = word.encode_utf16().chain(Some(0)).collect();
    let mut info = SHELLEXECUTEINFOW {
      cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
      fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC,
      hwnd: HWND(owner as *mut c_void),
      lpVerb: w!("runas"),
      lpFile: PCWSTR(file.as_ptr()),
      lpParameters: PCWSTR(args.as_ptr()),
      nShow: SW_HIDE.0,
      ..Default::default()
    };
    if let Err(e) = unsafe { ShellExecuteExW(&mut info) } {
      return Err(if e.code() == ERROR_CANCELLED.to_hresult() { None } else { Some(e.code().0) });
    }
    if info.hProcess.is_invalid() {
      return Err(Some(0));
    }
    unsafe {
      let waited = WaitForSingleObject(info.hProcess, INFINITE);
      let mut code = 1u32;
      let got = GetExitCodeProcess(info.hProcess, &mut code);
      let _ = CloseHandle(info.hProcess);
      if waited != WAIT_OBJECT_0 || got.is_err() {
        return Err(Some(0));
      }
      Ok(code as i32)
    }
  }
}

#[cfg(windows)]
pub fn read() -> Status {
  win::read()
}

#[cfg(not(windows))]
pub fn read() -> Status {
  status_from(false, Found::default(), String::new())
}

/// `install`: done once the stores hold it and Windows trusts it;
/// `remove`: done once neither store holds it.
fn change(word: &'static str, owner: isize) -> Answer {
  let before = read();
  if !before.available {
    return Answer { result: "unavailable", status: before, code: None };
  }
  #[cfg(windows)]
  let ran = win::run_elevated(word, owner);
  #[cfg(not(windows))]
  let ran: Result<i32, Option<i32>> = {
    let _ = owner;
    Err(Some(0))
  };
  let status = read();
  match ran {
    Err(None) => Answer { result: "canceled", status, code: None },
    Err(Some(code)) => Answer { result: "failed", status, code: Some(code) },
    Ok(HELPER_REFUSED) => Answer { result: "refused", status, code: Some(HELPER_REFUSED) },
    Ok(HELPER_OK) => {
      let shows = match word {
        "install" => status.state == "trusted",
        _ => !status.in_root && !status.in_trusted_publisher,
      };
      Answer { result: if shows { "done" } else { "failed" }, status, code: None }
    }
    Ok(code) => Answer { result: "failed", status, code: Some(code) },
  }
}

fn owner_of(window: &tauri::WebviewWindow) -> isize {
  #[cfg(windows)]
  {
    window.hwnd().map(|h| h.0 as isize).unwrap_or(0)
  }
  #[cfg(not(windows))]
  {
    let _ = window;
    0
  }
}

// ---------------------------------------------------------------------------
// The page's bridge: window.electronPublisherCert (src/bridge.js)

#[tauri::command]
pub async fn publisher_cert_status() -> Status {
  tauri::async_runtime::spawn_blocking(read).await.unwrap_or_else(|_| status_from(false, Found::default(), String::new()))
}

#[tauri::command]
pub async fn publisher_cert_install(window: tauri::WebviewWindow) -> Answer {
  let owner = owner_of(&window);
  tauri::async_runtime::spawn_blocking(move || change("install", owner)).await.unwrap_or_else(|_| failed())
}

#[tauri::command]
pub async fn publisher_cert_remove(window: tauri::WebviewWindow) -> Answer {
  let owner = owner_of(&window);
  tauri::async_runtime::spawn_blocking(move || change("remove", owner)).await.unwrap_or_else(|_| failed())
}

fn failed() -> Answer {
  Answer { result: "failed", status: read(), code: None }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn found(in_root: bool, in_tp: bool) -> Found {
    Found { in_root, in_trusted_publisher: in_tp, chain_trusted: in_root && in_tp, ..Found::default() }
  }

  #[test]
  fn states() {
    assert_eq!(state_of(found(false, false)), "notInstalled");
    assert_eq!(state_of(found(true, true)), "trusted");
    assert_eq!(state_of(found(true, false)), "invalid");
    assert_eq!(state_of(found(false, true)), "invalid");
    assert_eq!(state_of(Found { chain_trusted: false, ..found(true, true) }), "invalid");
    assert_eq!(state_of(Found { disallowed: true, ..found(true, true) }), "invalid");
    assert_eq!(state_of(Found { expired: true, ..found(true, true) }), "expired");
    assert_eq!(state_of(Found { expired: true, ..found(false, false) }), "expired");
    assert_eq!(state_of(Found { other_mt_media: true, ..found(false, false) }), "mismatch");
  }

  #[test]
  fn dates() {
    // 2028-11-14 10:22:04 UTC, the certificate's NotAfter.
    let secs: u64 = 1_857_810_124;
    assert_eq!(date_of((secs + 11_644_473_600) * 10_000_000), "2028-11-14");
    assert_eq!(date_of(11_644_473_600 * 10_000_000), "1970-01-01");
  }

  #[cfg(windows)]
  #[test]
  fn reads_the_stores_without_failing() {
    // Whatever this machine holds: the read never panics and names the right certificate.
    let s = read();
    eprintln!("this machine: {s:?}");
    assert_eq!(s.thumbprint, "07995B7408F1482085F8DC239DEC4294F0CAF149");
    assert_eq!(s.valid_until, "2028-11-14");
    assert!(["notInstalled", "trusted", "invalid", "expired", "mismatch"].contains(&s.state));
  }
}
