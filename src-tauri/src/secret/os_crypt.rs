// Electron's sealed secret on Linux: Chromium's os_crypt, as the Electron
// shell's safeStorage.encryptStringAsync used it (its linked-unlock.cjs;
// Electron 45.2.3 on Chromium 156, os_crypt_async — read from their sources,
// browser_process_impl.cc CreateOSCryptAsync and
// components/os_crypt/async/browser/*). Only the 6.0 previews built on
// Electron (2026-11-03 to 11-06) kept the secret; 5.x never had one.
//
// The blob is a tag, then AES-128-CBC with PKCS#7 padding and an IV of 16
// spaces, under PBKDF2-HMAC-SHA1 of a password: salt "saltysalt", one
// iteration, 16 bytes. The tag says which password:
//
//   v11  the one Chromium keeps in the keyring for the app
//        (FreedesktopSecretKeyProvider), named after Electron's app name.
//        On Linux that was package.json's name, "girovo" in lower case — the
//        name its data folder had too, ~/.config/girovo (paths.rs) — and not
//        the product's, "Girovo", which is asked for after it all the same:
//          KDE        KWallet's network wallet, folder "girovo Keys", entry
//                     "girovo Safe Storage"
//          elsewhere  the Secret Service item whose attribute application
//                     is "girovo" (label "girovo Safe Storage")
//   v10  "peanuts", built into Chromium (PosixKeyProvider): what it sealed
//        with when the keyring did not answer at start. (Where Chromium chose
//        no keyring at all, "basic_text", the shell kept no secret.)
//
// v12, the secret portal's key, only opens in Electron 45; it sealed nothing
// with it. Which keyring Chromium asked followed the desktop
// (base::nix::GetDesktopEnvironment; the shell passed no --password-store),
// and so does kwallet_of(). The keyrings themselves are asked over D-Bus in
// linux.rs; everything else is here, so the tests run on any system.

use std::num::NonZeroU32;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use aws_lc_rs::cipher::{AES_128, DecryptionContext, PaddedBlockDecryptingKey, UnboundCipherKey};
use aws_lc_rs::iv::FixedLength;
use aws_lc_rs::pbkdf2;

use super::{KEYRING, Unreadable, valid};

/// Electron's app name, which the keyring's entries are named after: the
/// spellings to look under, the one Electron used on Linux first.
pub const APPS: [&str; 2] = ["girovo", "Girovo"];

/// The KWallet folder and entry of an app (Electron: app name + " Keys", + " Safe Storage").
pub fn kwallet_names(app: &str) -> (String, String) {
  (format!("{app} Keys"), format!("{app} Safe Storage"))
}

/// v10's password, built into Chromium.
const BUILT_IN: &[u8] = b"peanuts";
const SALT: &[u8] = b"saltysalt";
const IV: [u8; 16] = [b' '; 16];

/// A KWallet daemon on the session bus.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KWallet {
  pub service: &'static str,
  pub path: &'static str,
}

pub const KWALLETD: KWallet = KWallet { service: "org.kde.kwalletd", path: "/modules/kwalletd" };
pub const KWALLETD5: KWallet = KWallet { service: "org.kde.kwalletd5", path: "/modules/kwalletd5" };
pub const KWALLETD6: KWallet = KWallet { service: "org.kde.kwalletd6", path: "/modules/kwalletd6" };

/// Where Chromium kept v11's password: asked over D-Bus (linux.rs), stand-ins
/// in the tests. An error says the keyring did not answer — its prompt
/// dismissed, no session bus — which may pass; a keyring that answered with
/// nothing (no entry, no such daemon, KWallet switched off) is no error.
pub trait Keyring {
  /// The passwords in KWallet's entries, one for each of APPS that has one; none when there is none.
  fn kwallet(&self, daemon: KWallet) -> Result<Vec<Vec<u8>>, String>;
  /// The secrets of the Secret Service's items whose attribute application is one of APPS.
  fn secret_service(&self) -> Result<Vec<Vec<u8>>, String>;
}

/// The secret Electron's safeStorage sealed on Linux, opened. `env` reads an
/// environment variable (the desktop's, for which keyring Chromium asked).
/// Not opened: KEYRING when a keyring asked did not answer (secret.rs asks
/// again at the next start), "unreadable" when every one answered and none
/// had a password that opens it — gone for good.
pub fn open(sealed: &[u8], keyring: &dyn Keyring, env: &dyn Fn(&str) -> Option<String>) -> Result<String, Unreadable> {
  if let Some(body) = sealed.strip_prefix(b"v10") {
    return open_with(body, BUILT_IN).ok_or_else(|| Unreadable::new("unreadable", "v10, and Chromium's built-in key does not open it"));
  }
  let Some(body) = sealed.strip_prefix(b"v11") else {
    return Err(Unreadable::new("unreadable", "not os_crypt's v10 or v11 format"));
  };
  if body.is_empty() || body.len() % 16 != 0 {
    return Err(Unreadable::new("unreadable", "v11, but no AES-CBC blocks"));
  }
  // Chromium's own keyring first; on KDE the Secret Service after it, for a
  // copy that ran on another desktop of this account. Every password found is
  // tried: a wrong one does not open the blob to a secret.
  let mut said = Vec::new();
  let mut unanswered = false;
  if let Some(daemon) = kwallet_of(env) {
    match keyring.kwallet(daemon) {
      Ok(passwords) => match passwords.iter().find_map(|password| open_with(body, password)) {
        Some(secret) => return Ok(secret),
        None if passwords.is_empty() => said.push(format!("{}: no entry", daemon.service)),
        None => said.push(format!("{}: its password does not open it", daemon.service)),
      },
      Err(err) => {
        unanswered = true;
        said.push(format!("{}: {err}", daemon.service));
      }
    }
  }
  match keyring.secret_service() {
    Ok(passwords) => match passwords.iter().find_map(|password| open_with(body, password)) {
      Some(secret) => return Ok(secret),
      None if passwords.is_empty() => said.push("Secret Service: no item".into()),
      None => said.push(format!("Secret Service: {} item(s), none opens it", passwords.len())),
    },
    Err(err) => {
      unanswered = true;
      said.push(format!("Secret Service: {err}"));
    }
  }
  // The password may yet be in the keyring that did not answer.
  let reason = if unanswered { KEYRING } else { "unreadable" };
  Err(Unreadable::new(reason, format!("v11; {}", said.join("; "))))
}

/// What a lookup found, once it has.
type Slot = (Mutex<Option<Result<String, Unreadable>>>, Condvar);

enum Lookup {
  Idle,
  Running(Arc<Slot>),
  /// No keyring answered: asked again at the next start, not prompting again at every ask of this run.
  GaveUp,
}

/// A run's lookups in the keyring (linux.rs keeps one), each on a thread of
/// its own: an unlock prompt left unanswered holds an ask — and with it the
/// migration screen, or secret.rs's lock — for the deadline at most. The
/// ask that started a lookup waits that long; while it is still under way,
/// a later ask does not wait, and the first ask after it is done takes what
/// it found. Nothing that would end the lookup is at hand: a prompt has no
/// timeout of its own.
pub struct Lookups(Mutex<Lookup>);

impl Lookups {
  pub const fn new() -> Self {
    Lookups(Mutex::new(Lookup::Idle))
  }

  /// open() of `sealed`, on the lookup's thread.
  pub fn open(
    &self,
    sealed: &[u8],
    deadline: Duration,
    keyring: impl Keyring + Send + 'static,
    env: fn(&str) -> Option<String>,
  ) -> Result<String, Unreadable> {
    let state = || self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let (slot, started) = {
      let mut now = state();
      match &*now {
        Lookup::GaveUp => return Err(Unreadable::new(KEYRING, "no keyring answered earlier in this run")),
        Lookup::Running(slot) => (slot.clone(), false),
        Lookup::Idle => {
          let slot = Arc::<Slot>::default();
          let (worker, sealed) = (slot.clone(), sealed.to_vec());
          std::thread::Builder::new()
            .name("girovo-keyring".into())
            .spawn(move || {
              let found = open(&sealed, &keyring, &env);
              *worker.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(found);
              worker.1.notify_all();
            })
            .map_err(|err| Unreadable::new(KEYRING, format!("no thread for the keyring: {err}")))?;
          *now = Lookup::Running(slot.clone());
          (slot, true)
        }
      }
    };
    let wait = if started { deadline } else { Duration::ZERO };
    let found = {
      let held = slot.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
      let (mut held, _) = slot.1.wait_timeout_while(held, wait, |found| found.is_none()).unwrap_or_else(|poisoned| poisoned.into_inner());
      held.take()
    };
    let Some(found) = found else {
      let detail = if started { format!("no keyring answered within {} s", deadline.as_secs_f32()) } else { "still waiting for the keyring".into() };
      return Err(Unreadable::new(KEYRING, detail));
    };
    *state() = match &found {
      Err(why) if why.reason == KEYRING => Lookup::GaveUp,
      _ => Lookup::Idle,
    };
    found
  }
}

/// The KWallet daemon Chromium asked on this desktop
/// (FreedesktopSecretKeyProvider by base::nix::GetDesktopEnvironment): KDE 3
/// and 4 the first one, 5 and 6 their own. None elsewhere — GNOME, Cinnamon,
/// XFCE, COSMIC, an unknown desktop… — where it asked the Secret Service.
pub fn kwallet_of(env: &dyn Fn(&str) -> Option<String>) -> Option<KWallet> {
  if let Some(current) = env("XDG_CURRENT_DESKTOP") {
    // Several, in order; the first one Chromium knows decides.
    for value in current.split(':').map(str::trim).filter(|v| !v.is_empty()) {
      match value {
        "KDE" => {
          return Some(match env("KDE_SESSION_VERSION").as_deref() {
            Some("5") => KWALLETD5,
            Some("6") => KWALLETD6,
            _ => KWALLETD,
          });
        }
        "Unity" | "Deepin" | "GNOME" | "X-Cinnamon" | "Pantheon" | "XFCE" | "UKUI" | "LXQt" | "COSMIC" => return None,
        _ => {}
      }
    }
  }
  let session = env("DESKTOP_SESSION").unwrap_or_default();
  match session.as_str() {
    "kde4" | "kde-plasma" | "kde" => return Some(KWALLETD),
    "deepin" | "gnome" | "mate" | "xubuntu" | "ukui" => return None,
    s if s.contains("xfce") => return None,
    _ => {}
  }
  if env("GNOME_DESKTOP_SESSION_ID").is_some() {
    return None;
  }
  env("KDE_FULL_SESSION").map(|_| KWALLETD)
}

/// The secret in `body` under the key made from `password` — or, as Chromium
/// tries next, under the empty password's (crbug.com/40055416). None when
/// neither opens it to a secret of 32 bytes in base64.
fn open_with(body: &[u8], password: &[u8]) -> Option<String> {
  [password, b""].into_iter().find_map(|password| {
    let plain = decrypt(body, &key(password))?;
    String::from_utf8(plain).ok().and_then(valid)
  })
}

/// os_crypt's AES-128 key for `password`.
fn key(password: &[u8]) -> [u8; 16] {
  let mut key = [0u8; 16];
  pbkdf2::derive(pbkdf2::PBKDF2_HMAC_SHA1, NonZeroU32::MIN, SALT, password, &mut key);
  key
}

/// AES-128-CBC with os_crypt's fixed IV; None when the padding does not check out.
fn decrypt(body: &[u8], key: &[u8; 16]) -> Option<Vec<u8>> {
  let key = PaddedBlockDecryptingKey::cbc_pkcs7(UnboundCipherKey::new(&AES_128, key).ok()?).ok()?;
  let mut buffer = body.to_vec();
  let plain = key.decrypt(&mut buffer, DecryptionContext::Iv128(FixedLength::from(IV))).ok()?;
  Some(plain.to_vec())
}

#[cfg(test)]
mod tests {
  use std::cell::RefCell;
  use std::collections::HashMap;

  use base64::Engine;
  use base64::engine::general_purpose::STANDARD as B64;

  use super::*;

  // Sealed by Node's crypto, not by this file (AES-128-CBC, IV of 16 spaces,
  // PBKDF2-HMAC-SHA1 over "saltysalt", once): the secret below, under v10's
  // built-in key, under v11 with PASSWORD, under v11 with the empty password,
  // and "hello" under v11 with PASSWORD.
  const SECRET: &str = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
  const PASSWORD: &str = "ZGVyIEtleXJpbmcgaGFsdCBtaWNo";
  const V10: &str = "djEw7qV5OhK8YCKfh4UnCX34Pgo6PqhjqBMfCiK3pO5C+Ra2IEPnAZCJdXRJ68W1PRS5";
  const V11: &str = "djExISxhHYF3vA9FBnQSxRurYRwJ8fLytt9pXcRU/h2fs5hZI5J8WW5/UtB2mNlTBJHl";
  const V11_EMPTY: &str = "djExGqCZIgFwL862vJ8khQGAyhRJsxbtyptygbPjD2jbmzh5kLygIfzdVTG49r8c2TLW";
  const V11_HELLO: &str = "djExjaSyjUCWl3x6S8KjcwKD0w==";

  fn blob(b64: &str) -> Vec<u8> {
    B64.decode(b64).unwrap()
  }

  /// A keyring that answers as told and notes who was asked.
  #[derive(Default)]
  struct Fake {
    kwallet: HashMap<&'static str, Result<Vec<Vec<u8>>, String>>,
    secret_service: Option<Result<Vec<Vec<u8>>, String>>,
    asked: RefCell<Vec<&'static str>>,
  }

  impl Keyring for Fake {
    fn kwallet(&self, daemon: KWallet) -> Result<Vec<Vec<u8>>, String> {
      self.asked.borrow_mut().push(daemon.service);
      self.kwallet.get(daemon.service).cloned().unwrap_or(Err("not running".into()))
    }
    fn secret_service(&self) -> Result<Vec<Vec<u8>>, String> {
      self.asked.borrow_mut().push("secret-service");
      self.secret_service.clone().unwrap_or(Ok(Vec::new()))
    }
  }

  fn env<'a>(vars: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
    move |name| vars.iter().find(|(k, _)| *k == name).map(|(_, v)| v.to_string())
  }

  const GNOME: &[(&str, &str)] = &[("XDG_CURRENT_DESKTOP", "ubuntu:GNOME")];
  const PLASMA6: &[(&str, &str)] = &[("XDG_CURRENT_DESKTOP", "KDE"), ("KDE_SESSION_VERSION", "6")];

  #[test]
  fn the_keys_are_chromiums() {
    // posix_key_provider.cc's kV10Key, and encryptor.cc's empty-password fallback.
    assert_eq!(key(b"peanuts"), [0xfd, 0x62, 0x1f, 0xe5, 0xa2, 0xb4, 0x02, 0x53, 0x9d, 0xfa, 0x14, 0x7c, 0xa9, 0x27, 0x27, 0x78]);
    assert_eq!(key(b""), [0xd0, 0xd0, 0xec, 0x9c, 0x7d, 0x77, 0xd4, 0x3a, 0xc5, 0x41, 0x87, 0xfa, 0x48, 0x18, 0xd1, 0x7f]);
  }

  #[test]
  fn the_names_are_electrons() {
    // browser_process_impl.cc: app_name + " Keys", app_name + " Safe Storage".
    // Electron's name on Linux first — lower case, as its data folder — then the product's.
    assert_eq!(APPS, ["girovo", "Girovo"]);
    assert_eq!(kwallet_names(APPS[0]), ("girovo Keys".to_string(), "girovo Safe Storage".to_string()));
    assert_eq!(kwallet_names(APPS[1]), ("Girovo Keys".to_string(), "Girovo Safe Storage".to_string()));
  }

  #[test]
  fn every_entry_kwallet_has_is_tried() {
    // One under each spelling of the name, the first of them another app's.
    let keyring = Fake { kwallet: HashMap::from([("org.kde.kwalletd6", Ok(vec![b"another".to_vec(), PASSWORD.into()]))]), ..Fake::default() };
    assert_eq!(open(&blob(V11), &keyring, &env(PLASMA6)).unwrap(), SECRET);
    assert_eq!(*keyring.asked.borrow(), ["org.kde.kwalletd6"]);
    // None of them the one: said so, and the Secret Service is asked after it.
    let wrong = Fake { kwallet: HashMap::from([("org.kde.kwalletd6", Ok(vec![b"another".to_vec()]))]), ..Fake::default() };
    let err = open(&blob(V11), &wrong, &env(PLASMA6)).unwrap_err();
    assert_eq!(err.reason, "unreadable");
    assert!(err.detail.contains("org.kde.kwalletd6: its password does not open it"), "{}", err.detail);
    assert_eq!(*wrong.asked.borrow(), ["org.kde.kwalletd6", "secret-service"]);
  }

  #[test]
  fn v10_opens_with_the_built_in_key_and_no_keyring() {
    let keyring = Fake::default();
    assert_eq!(open(&blob(V10), &keyring, &env(PLASMA6)).unwrap(), SECRET);
    assert!(keyring.asked.borrow().is_empty());
  }

  #[test]
  fn v11_opens_with_the_secret_services_password_off_kde() {
    let keyring = Fake { secret_service: Some(Ok(vec![PASSWORD.into()])), ..Fake::default() };
    assert_eq!(open(&blob(V11), &keyring, &env(GNOME)).unwrap(), SECRET);
    assert_eq!(*keyring.asked.borrow(), ["secret-service"], "KWallet is never started off KDE");
  }

  #[test]
  fn v11_opens_with_kwallets_password_on_kde() {
    let keyring = Fake { kwallet: HashMap::from([("org.kde.kwalletd6", Ok(vec![PASSWORD.into()]))]), ..Fake::default() };
    assert_eq!(open(&blob(V11), &keyring, &env(PLASMA6)).unwrap(), SECRET);
    assert_eq!(*keyring.asked.borrow(), ["org.kde.kwalletd6"]);
  }

  #[test]
  fn on_kde_without_kwallets_entry_the_secret_service_is_asked_too() {
    let keyring = Fake {
      kwallet: HashMap::from([("org.kde.kwalletd6", Ok(Vec::new()))]),
      secret_service: Some(Ok(vec![PASSWORD.into()])),
      ..Fake::default()
    };
    assert_eq!(open(&blob(V11), &keyring, &env(PLASMA6)).unwrap(), SECRET);
    assert_eq!(*keyring.asked.borrow(), ["org.kde.kwalletd6", "secret-service"]);
  }

  #[test]
  fn every_item_found_is_tried() {
    let keyring = Fake { secret_service: Some(Ok(vec![b"another".to_vec(), Vec::new(), PASSWORD.into()])), ..Fake::default() };
    assert_eq!(open(&blob(V11), &keyring, &env(GNOME)).unwrap(), SECRET);
  }

  #[test]
  fn a_blob_sealed_under_the_empty_password_opens_as_in_chromium() {
    let keyring = Fake { secret_service: Some(Ok(vec![b"whatever is kept".to_vec()])), ..Fake::default() };
    assert_eq!(open(&blob(V11_EMPTY), &keyring, &env(GNOME)).unwrap(), SECRET);
  }

  #[test]
  fn what_does_not_open_says_why() {
    let wrong = Fake { secret_service: Some(Ok(vec![b"wrong".to_vec()])), ..Fake::default() };
    let err = open(&blob(V11), &wrong, &env(GNOME)).unwrap_err();
    assert_eq!(err.reason, "unreadable");
    assert!(err.detail.contains("none opens it"), "{}", err.detail);

    let none = Fake::default();
    let err = open(&blob(V11), &none, &env(GNOME)).unwrap_err();
    assert_eq!(err.reason, "unreadable");
    assert!(err.detail.contains("no item"), "{}", err.detail);

    let down = Fake { secret_service: Some(Err("no Secret Service".into())), ..Fake::default() };
    let err = open(&blob(V11), &down, &env(PLASMA6)).unwrap_err();
    assert!(err.detail.contains("org.kde.kwalletd6: not running") && err.detail.contains("no Secret Service"), "{}", err.detail);

    // Opens, but to no secret: not taken.
    let right = Fake { secret_service: Some(Ok(vec![PASSWORD.into()])), ..Fake::default() };
    assert_eq!(open(&blob(V11_HELLO), &right, &env(GNOME)).unwrap_err().reason, "unreadable");
  }

  /// A keyring that did not answer may hold the password yet: KEYRING, which
  /// secret.rs asks again later; only keyrings that all answered without it
  /// make it unreadable for good.
  #[test]
  fn a_keyring_that_does_not_answer_is_a_passing_failure() {
    let reason = |keyring: &Fake, vars| open(&blob(V11), keyring, &env(vars)).unwrap_err().reason;
    let dismissed = Fake { secret_service: Some(Err("prompt dismissed".into())), ..Fake::default() };
    assert_eq!(reason(&dismissed, GNOME), KEYRING);
    // KDE: KWallet's open cancelled, the Secret Service without the item.
    let cancelled = Fake { kwallet: HashMap::from([("org.kde.kwalletd6", Err("the wallet did not open".into()))]), ..Fake::default() };
    assert_eq!(reason(&cancelled, PLASMA6), KEYRING);
    // KDE: KWallet without the entry, the Secret Service not answering.
    let half = Fake {
      kwallet: HashMap::from([("org.kde.kwalletd6", Ok(Vec::new()))]),
      secret_service: Some(Err("no Secret Service".into())),
      ..Fake::default()
    };
    assert_eq!(reason(&half, PLASMA6), KEYRING);
    // Both answered, neither has it.
    let gone = Fake { kwallet: HashMap::from([("org.kde.kwalletd6", Ok(Vec::new()))]), ..Fake::default() };
    assert_eq!(reason(&gone, PLASMA6), "unreadable");
    // One that did not answer is no matter once another one opens it.
    let found = Fake { secret_service: Some(Ok(vec![PASSWORD.into()])), ..cancelled };
    assert_eq!(open(&blob(V11), &found, &env(PLASMA6)).unwrap(), SECRET);
  }

  #[test]
  fn other_formats_are_refused_without_asking_a_keyring() {
    let keyring = Fake { secret_service: Some(Ok(vec![PASSWORD.into()])), ..Fake::default() };
    let mut v12 = blob(V11);
    v12[2] = b'2';
    for sealed in [v12, b"v11".to_vec(), b"v11short".to_vec(), b"plain text".to_vec(), Vec::new()] {
      assert_eq!(open(&sealed, &keyring, &env(GNOME)).unwrap_err().reason, "unreadable", "{sealed:?}");
    }
    assert!(keyring.asked.borrow().is_empty());
    // v10 with its key's text damaged.
    let mut v10 = blob(V10);
    let last = v10.len() - 1;
    v10[last] ^= 1;
    assert_eq!(open(&v10, &keyring, &env(GNOME)).unwrap_err().reason, "unreadable");
  }

  #[test]
  fn the_keyring_follows_the_desktop_as_chromium_chose_it() {
    let cases: &[(&[(&str, &str)], Option<KWallet>)] = &[
      (PLASMA6, Some(KWALLETD6)),
      (&[("XDG_CURRENT_DESKTOP", "KDE"), ("KDE_SESSION_VERSION", "5")], Some(KWALLETD5)),
      (&[("XDG_CURRENT_DESKTOP", "KDE")], Some(KWALLETD)),
      (GNOME, None),
      (&[("XDG_CURRENT_DESKTOP", "X-Cinnamon")], None),
      (&[("XDG_CURRENT_DESKTOP", "COSMIC")], None),
      // The first known value decides; unknown ones are passed over.
      (&[("XDG_CURRENT_DESKTOP", "Budgie:GNOME"), ("KDE_SESSION_VERSION", "6")], None),
      (&[("XDG_CURRENT_DESKTOP", "sway"), ("DESKTOP_SESSION", "kde-plasma")], Some(KWALLETD)),
      (&[("DESKTOP_SESSION", "kde")], Some(KWALLETD)),
      (&[("DESKTOP_SESSION", "xfce4")], None),
      (&[("DESKTOP_SESSION", "gnome"), ("KDE_FULL_SESSION", "true")], None),
      (&[("GNOME_DESKTOP_SESSION_ID", "this-is-deprecated"), ("KDE_FULL_SESSION", "true")], None),
      (&[("KDE_FULL_SESSION", "true")], Some(KWALLETD)),
      (&[("XDG_CURRENT_DESKTOP", "Hyprland")], None),
      (&[], None),
    ];
    for (vars, expected) in cases {
      assert_eq!(kwallet_of(&env(vars)), *expected, "{vars:?}");
    }
  }

  // ---- Lookups: the keyring asked on a thread of its own, a deadline at most ----

  use std::sync::atomic::{AtomicUsize, Ordering};
  use std::sync::mpsc;
  use std::time::Instant;

  /// A Secret Service on the lookup's thread: answers what the test sends it
  /// (an unlock prompt being answered), counting the lookups that asked.
  struct Gated {
    answer: mpsc::Receiver<Result<Vec<Vec<u8>>, String>>,
    asked: Arc<AtomicUsize>,
  }

  impl Keyring for Gated {
    fn kwallet(&self, _daemon: KWallet) -> Result<Vec<Vec<u8>>, String> {
      Ok(Vec::new())
    }
    fn secret_service(&self) -> Result<Vec<Vec<u8>>, String> {
      self.asked.fetch_add(1, Ordering::SeqCst);
      self.answer.recv().unwrap_or(Err("gone".into()))
    }
  }

  /// One that answers at once.
  fn answering(answer: Result<Vec<Vec<u8>>, String>, asked: &Arc<AtomicUsize>) -> Gated {
    let (tell, rx) = mpsc::channel();
    tell.send(answer).unwrap();
    Gated { answer: rx, asked: asked.clone() }
  }

  fn gnome(name: &str) -> Option<String> {
    (name == "XDG_CURRENT_DESKTOP").then(|| "GNOME".into())
  }

  #[test]
  fn an_unanswered_keyring_holds_the_ask_until_the_deadline_and_a_later_ask_takes_what_it_found() {
    let lookups = Lookups::new();
    let asked = Arc::new(AtomicUsize::new(0));
    let (tell, answer) = mpsc::channel();
    let started = Instant::now();
    let first = lookups.open(&blob(V11), Duration::from_millis(100), Gated { answer, asked: asked.clone() }, gnome).unwrap_err();
    assert_eq!(first.reason, KEYRING);
    assert!(first.detail.contains("within"), "{}", first.detail);
    assert!(started.elapsed() >= Duration::from_millis(90) && started.elapsed() < Duration::from_secs(10), "{:?}", started.elapsed());

    // Still under way: a later ask neither waits nor starts another lookup.
    let later = Instant::now();
    let second = lookups.open(&blob(V11), Duration::from_secs(60), answering(Ok(Vec::new()), &asked), gnome).unwrap_err();
    assert_eq!(second.reason, KEYRING);
    assert!(second.detail.contains("still waiting"), "{}", second.detail);
    assert!(later.elapsed() < Duration::from_secs(10));

    // The prompt answered meanwhile: the next ask takes the secret it found.
    tell.send(Ok(vec![PASSWORD.into()])).unwrap();
    let found = (0..500).find_map(|_| match lookups.open(&blob(V11), Duration::from_secs(60), answering(Ok(Vec::new()), &asked), gnome) {
      Err(why) if why.detail.contains("still waiting") => {
        std::thread::sleep(Duration::from_millis(10));
        None
      }
      other => Some(other),
    });
    assert_eq!(found.expect("the lookup ended").unwrap(), SECRET);
    assert_eq!(asked.load(Ordering::SeqCst), 1, "one lookup throughout");
  }

  #[test]
  fn a_keyring_that_did_not_answer_is_not_asked_again_this_run() {
    let lookups = Lookups::new();
    let asked = Arc::new(AtomicUsize::new(0));
    let dismissed = lookups.open(&blob(V11), Duration::from_secs(60), answering(Err("prompt dismissed".into()), &asked), gnome).unwrap_err();
    assert_eq!(dismissed.reason, KEYRING);
    let again = lookups.open(&blob(V11), Duration::from_secs(60), answering(Ok(vec![PASSWORD.into()]), &asked), gnome).unwrap_err();
    assert_eq!(again.reason, KEYRING);
    assert!(again.detail.contains("earlier in this run"), "{}", again.detail);
    assert_eq!(asked.load(Ordering::SeqCst), 1, "no second prompt in this run");
  }

  #[test]
  fn after_an_answer_the_next_ask_looks_again() {
    let lookups = Lookups::new();
    let asked = Arc::new(AtomicUsize::new(0));
    let open = |answer| lookups.open(&blob(V11), Duration::from_secs(60), answering(answer, &asked), gnome);
    assert_eq!(open(Ok(vec![PASSWORD.into()])).unwrap(), SECRET);
    assert_eq!(open(Ok(Vec::new())).unwrap_err().reason, "unreadable");
    assert_eq!(open(Ok(vec![PASSWORD.into()])).unwrap(), SECRET);
    assert_eq!(asked.load(Ordering::SeqCst), 3);
  }
}
