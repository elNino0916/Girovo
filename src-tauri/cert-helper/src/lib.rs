// girovo-cert.exe (this library; src/main.rs only calls `main_with`): puts
// the MT-Media code-signing certificate into the machine's trust stores or
// takes it out again (docs/mt-media-code-signing.md).
//
// Girovo starts it through Windows' "run as administrator" (UAC) only after
// the person confirmed in Einstellungen → Sicherheit, waits for it and then
// reads the stores itself (src-tauri/src/publisher_cert.rs): this program
// reports nothing but its exit code. It takes exactly one word:
//
//   install   the compiled-in certificate into LocalMachine\Root and
//             LocalMachine\TrustedPublisher (and earlier MT-Media
//             certificates this build names out of them)
//   remove    that certificate, found by its thumbprint, out of both
//
// No path, no other certificate: the bytes come from identity.rs and must
// pass its checks first. No private key is involved anywhere.


pub mod identity;

/// Exit codes Girovo reads (publisher_cert.rs keeps the same numbers).
pub const OK: i32 = 0;
pub const BAD_ARGS: i32 = 2;
pub const REFUSED: i32 = 3;
pub const STORE_FAILED: i32 = 4;
pub const NOT_WINDOWS: i32 = 5;

#[derive(Debug, PartialEq, Eq)]
pub enum Action {
  Install,
  Remove,
}

pub fn parse(args: &[String]) -> Option<Action> {
  match args {
    [one] if one == "install" => Some(Action::Install),
    [one] if one == "remove" => Some(Action::Remove),
    _ => None,
  }
}

/// The exit code for these arguments (the program's own, without its name).
pub fn main_with(args: &[String]) -> i32 {
  match parse(args) {
    Some(action) => run(action),
    None => BAD_ARGS,
  }
}

#[cfg(windows)]
pub fn run(action: Action) -> i32 {
  use identity::*;
  use windows::Win32::Security::Cryptography::*;

  let cert = match check(CER) {
    Ok(cert) => cert,
    Err(_) => return REFUSED,
  };
  for name in STORES {
    let Some(store) = Store::machine(name, true) else { return STORE_FAILED };
    // Earlier MT-Media certificates go on both paths; only those this build names.
    for old in EARLIER {
      if let Some(found) = store.find(old) {
        if !delete(found) {
          return STORE_FAILED;
        }
      }
    }
    match action {
      Action::Install => {
        let added = unsafe { CertAddCertificateContextToStore(Some(store.0), cert.ctx(), CERT_STORE_ADD_REPLACE_EXISTING, None) };
        if added.is_err() {
          return STORE_FAILED;
        }
      }
      Action::Remove => {
        while let Some(found) = store.find(&THUMBPRINT) {
          if !delete(found) {
            return STORE_FAILED;
          }
        }
      }
    }
  }
  OK
}

/// Deletes a certificate found in a store; the call frees its context either way.
#[cfg(windows)]
fn delete(found: identity::Cert) -> bool {
  let ctx = found.0;
  std::mem::forget(found);
  unsafe { windows::Win32::Security::Cryptography::CertDeleteCertificateFromStore(ctx).is_ok() }
}

#[cfg(not(windows))]
pub fn run(_: Action) -> i32 {
  NOT_WINDOWS
}

#[cfg(test)]
mod tests {
  use super::*;

  fn args(words: &[&str]) -> Vec<String> {
    words.iter().map(|w| w.to_string()).collect()
  }

  #[test]
  fn takes_one_word_and_nothing_else() {
    assert_eq!(parse(&args(&["install"])), Some(Action::Install));
    assert_eq!(parse(&args(&["remove"])), Some(Action::Remove));
    assert_eq!(parse(&args(&[])), None);
    assert_eq!(parse(&args(&["install", "C:\\other.cer"])), None);
    assert_eq!(parse(&args(&["C:\\other.cer"])), None);
    assert_eq!(parse(&args(&["Install"])), None);
  }
}
