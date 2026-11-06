// The shell secret: 32 random bytes for this user account of this computer,
// behind "Weitere Banken mit anmelden" (lib/linked-unlock.ts), Windows Hello
// (lib/windows-hello.ts) and "Neue Umsätze melden" (the background checks'
// box). The page sends it with each request about the PINs kept for those, and
// the route handlers mix it into their keys; neither keeps it. Without it,
// nothing kept for them opens — not for someone who copied the data folder,
// nor for another user account of this computer.
//
// Kept where only this user, logged in here, reads it back:
//
//   Windows  shell-secret.dpapi in the data folder, sealed with DPAPI for the
//            current user (secret/win.rs)
//   Linux    the Secret Service — GNOME Keyring, KWallet — as the item
//            "Girovo" / "shell-secret" (secret/linux.rs)
//
// Elsewhere, or on a Linux desktop without a Secret Service, there is no
// secret and the page does not offer those features, as in Electron when
// safeStorage had no protected store.
//
// Electron kept the same secret in linked-unlock.key, sealed with its
// safeStorage. The migration screen's step (secret_migration.rs), or the
// page's first ask if that comes sooner, takes it over, so the PINs kept under
// it still open.
// Electron's file stays as it was, and this shell's secret has a file of its
// own rather than taking its place: the Update-Kanal goes back from a 6.0
// preview to a 5.x Stabil — Electron — which reads linked-unlock.key with
// safeStorage. A file it could not open would make it start a new secret, and
// every PIN kept under the old one would be lost; with two files holding the
// same secret, both shells open the same PINs.
//
// On Linux Electron's secret is not taken over: safeStorage sealed it under a
// password Chromium keeps in the keyring, in one of several backends (KWallet,
// the Secret Service, a portal) that cannot be tried from here. A Linux user
// coming from Electron switches the features on again; the PINs kept under the
// old secret no longer open, and the route handlers delete them at the next
// login, as when Electron found its secret unreadable.

use std::fs;
use std::path::Path;
use std::sync::Mutex;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;

use crate::paths::data_root;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
use linux as store;
#[cfg(windows)]
mod win;
#[cfg(windows)]
use win as store;

/// "Girovo zurücksetzen" (reset.rs): the secret wherever it is kept beyond the
/// data folder — on Linux the keyring; on Windows its file goes with the folder.
pub fn forget() {
  store::forget(data_root());
  *kept() = Kept { secret: None, taken: None };
}

/// Electron's sealed secret, left where it is.
const ELECTRON_FILE: &str = "linked-unlock.key";
const SECRET_BYTES: usize = 32;

/// What this run knows: the secret once read (DPAPI or the keyring is asked
/// once per run), and what taking Electron's over came to if the first ask did
/// it — the page's window loads while the migration screen still shows, so its
/// first ask can come before the screen's step, which must then hear how it went.
struct Kept {
  secret: Option<String>,
  taken: Option<Migration>,
}

static KEPT: Mutex<Kept> = Mutex::new(Kept { secret: None, taken: None });

/// What the migration came to, for the migration screen:
///
///   {"status":"migrated"}  Electron's secret is this shell's now; the PINs kept under it open
///   {"status":"done"}      this shell has its secret already (taken over before, or made here)
///   {"status":"nothing"}   no secret of Electron's: nothing to take over
///   {"status":"failed","reason","detail"}
///                          Electron's secret is there but was not taken over. reason:
///                          "unsupported" (Linux), "unreadable" (it does not open: another
///                          Windows account, a missing or changed "Local State"), "store"
///                          (this shell could not keep it). detail: for the log, in English.
///
/// After "failed" the features that need the secret are switched on again.
#[derive(serde::Serialize, Debug, Clone, PartialEq)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum Migration {
  Migrated,
  Done,
  Nothing,
  Failed { reason: &'static str, detail: String },
}

/// Why Electron's secret did not open.
#[derive(Debug)]
pub struct Unreadable {
  reason: &'static str,
  detail: String,
}

impl Unreadable {
  fn new(reason: &'static str, detail: impl Into<String>) -> Self {
    Unreadable { reason, detail: detail.into() }
  }
}

fn kept() -> std::sync::MutexGuard<'static, Kept> {
  KEPT.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The secret in base64, or None where it cannot be kept protected (or keeping it failed).
pub fn secret() -> Option<String> {
  secret_in(&mut kept(), data_root())
}

/// Takes Electron's secret over, if there is one and this shell has none yet;
/// answers how the first ask's takeover went if that came first in this run.
pub fn migrate() -> Migration {
  migrate_with(&mut kept(), data_root())
}

fn secret_in(kept: &mut Kept, root: &Path) -> Option<String> {
  if kept.secret.is_none() {
    match load(root) {
      Ok((secret, taken)) => {
        kept.secret = Some(secret);
        kept.taken = taken;
      }
      Err(err) => eprintln!("[shell-secret] no secret: {err}"),
    }
  }
  kept.secret.clone()
}

fn migrate_with(kept: &mut Kept, root: &Path) -> Migration {
  if let Some(taken) = &kept.taken {
    return taken.clone();
  }
  let (answer, secret) = migrate_in(root);
  if let Some(secret) = secret {
    kept.secret = Some(secret);
    kept.taken = Some(answer.clone());
  }
  answer
}

/// This shell's secret; else Electron's, taken over; else a new one. With it,
/// what taking Electron's over came to, where that was tried.
fn load(root: &Path) -> Result<(String, Option<Migration>), String> {
  if let Some(secret) = store::read(root)?.and_then(valid) {
    return Ok((secret, None));
  }
  let (secret, taken) = match electron_secret(root) {
    Ok(Some(secret)) => (secret, Some(Migration::Migrated)),
    Ok(None) => (fresh()?, None),
    Err(why) => {
      // Unreadable for good, as when Electron could not open its own: a new
      // secret, and the PINs kept under the old one are deleted at the next login.
      eprintln!("[shell-secret] Electron's secret not taken over: {} ({})", why.reason, why.detail);
      (fresh()?, Some(Migration::Failed { reason: why.reason, detail: why.detail }))
    }
  };
  store::write(root, &secret)?;
  Ok((secret, taken))
}

/// The migration's answer, and the secret this shell has now if it took Electron's.
fn migrate_in(root: &Path) -> (Migration, Option<String>) {
  match fs::metadata(root.join(ELECTRON_FILE)) {
    Ok(_) => {}
    Err(err) if err.kind() == std::io::ErrorKind::NotFound => return (Migration::Nothing, None),
    Err(err) => return (Migration::Failed { reason: "unreadable", detail: format!("{ELECTRON_FILE}: {err}") }, None),
  }
  match store::read(root) {
    Ok(Some(secret)) if is_secret(&secret) => return (Migration::Done, None),
    Ok(_) => {}
    Err(err) => return (Migration::Failed { reason: "store", detail: err }, None),
  }
  let secret = match electron_secret(root) {
    Ok(Some(secret)) => secret,
    Ok(None) => return (Migration::Nothing, None),
    Err(why) => return (Migration::Failed { reason: why.reason, detail: why.detail }, None),
  };
  match store::write(root, &secret) {
    Ok(()) => (Migration::Migrated, Some(secret)),
    Err(err) => (Migration::Failed { reason: "store", detail: err }, None),
  }
}

/// Electron's secret as its safeStorage sealed it, opened: None when there is none.
fn electron_secret(root: &Path) -> Result<Option<String>, Unreadable> {
  let sealed = match fs::read(root.join(ELECTRON_FILE)) {
    Ok(sealed) => sealed,
    Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
    Err(err) => return Err(Unreadable::new("unreadable", format!("{ELECTRON_FILE}: {err}"))),
  };
  let text = store::electron(root, &sealed)?;
  valid(text).map(Some).ok_or_else(|| Unreadable::new("unreadable", "not a secret of 32 bytes"))
}

/// The secret's text if it is one: 32 bytes in base64, as Electron made it (randomBytes(32).toString('base64')).
fn valid(text: String) -> Option<String> {
  is_secret(&text).then_some(text)
}

fn is_secret(text: &str) -> bool {
  B64.decode(text).is_ok_and(|bytes| bytes.len() == SECRET_BYTES)
}

fn fresh() -> Result<String, String> {
  let mut bytes = [0u8; SECRET_BYTES];
  aws_lc_rs::rand::fill(&mut bytes).map_err(|_| "no random bytes".to_string())?;
  Ok(B64.encode(bytes))
}

/// Neither Windows nor Linux: no protected store, no secret.
#[cfg(not(any(windows, target_os = "linux")))]
mod store {
  use std::path::Path;

  use super::Unreadable;

  pub fn read(_root: &Path) -> Result<Option<String>, String> {
    Err("no protected store here".into())
  }
  pub fn write(_root: &Path, _secret: &str) -> Result<(), String> {
    Err("no protected store here".into())
  }
  pub fn electron(_root: &Path, _sealed: &[u8]) -> Result<String, Unreadable> {
    Err(Unreadable::new("unsupported", "no protected store here"))
  }
  pub fn forget(_root: &Path) {}
}

// ---------------------------------------------------------------------------
// The page's bridge: window.electronLinkedUnlock (src/bridge.js); and
// migrate_secret, the migration's answer for a look from the page
// (__girovoShell.invoke), which the migration screen gets from take_over().

#[tauri::command]
pub async fn linked_unlock_secret() -> Option<String> {
  tauri::async_runtime::spawn_blocking(secret).await.unwrap_or(None)
}

#[tauri::command]
pub async fn migrate_secret() -> Migration {
  tauri::async_runtime::spawn_blocking(migrate)
    .await
    .unwrap_or_else(|err| Migration::Failed { reason: "store", detail: err.to_string() })
}

#[cfg(all(test, windows))]
mod tests {
  use std::path::PathBuf;

  use super::*;

  /// A data folder of its own, gone with the test.
  struct Root(PathBuf);

  impl Root {
    fn new() -> Self {
      let dir = std::env::temp_dir().join(format!("girovo-secret-test-{}", &fresh().unwrap()[..12].replace(['/', '+'], "_")));
      fs::create_dir_all(&dir).unwrap();
      Root(dir)
    }
  }

  impl Drop for Root {
    fn drop(&mut self) {
      let _ = fs::remove_dir_all(&self.0);
    }
  }

  const ELECTRONS: &str = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

  /// A run of the app: nothing known yet.
  fn run() -> Kept {
    Kept { secret: None, taken: None }
  }

  #[test]
  fn the_first_ask_makes_a_secret_and_later_runs_read_the_same() {
    let root = Root::new();
    let first = secret_in(&mut run(), &root.0).unwrap();
    assert_eq!(B64.decode(&first).unwrap().len(), 32);
    assert_eq!(secret_in(&mut run(), &root.0).unwrap(), first);
    assert_eq!(migrate_with(&mut run(), &root.0), Migration::Nothing);
  }

  #[test]
  fn the_migration_takes_electrons_secret_over_once() {
    let root = Root::new();
    win::tests::electron_folder(&root.0, ELECTRONS);
    let mut first = run();
    assert_eq!(migrate_with(&mut first, &root.0), Migration::Migrated);
    assert_eq!(secret_in(&mut first, &root.0).as_deref(), Some(ELECTRONS));
    // The next run reads it from this shell's own file.
    let mut next = run();
    assert_eq!(secret_in(&mut next, &root.0).as_deref(), Some(ELECTRONS));
    assert_eq!(migrate_with(&mut run(), &root.0), Migration::Done);
    // Electron's file stays as it was.
    assert!(root.0.join(ELECTRON_FILE).is_file());
  }

  #[test]
  fn the_pages_first_ask_before_the_screen_takes_it_over_and_the_screen_hears_so() {
    let root = Root::new();
    win::tests::electron_folder(&root.0, ELECTRONS);
    let mut first = run();
    assert_eq!(secret_in(&mut first, &root.0).as_deref(), Some(ELECTRONS));
    assert_eq!(migrate_with(&mut first, &root.0), Migration::Migrated);
  }

  #[test]
  fn an_electron_secret_that_does_not_open_fails_the_migration_and_a_new_one_is_made() {
    let root = Root::new();
    win::tests::electron_folder(&root.0, ELECTRONS);
    fs::remove_file(root.0.join("Local State")).unwrap();
    let mut first = run();
    let answer = migrate_with(&mut first, &root.0);
    assert!(matches!(answer, Migration::Failed { reason: "unreadable", .. }), "{answer:?}");
    let fresh = secret_in(&mut first, &root.0).unwrap();
    assert_ne!(fresh, ELECTRONS);
    assert_eq!(migrate_with(&mut run(), &root.0), Migration::Done);
  }

  #[test]
  fn the_screen_hears_of_a_failure_the_pages_first_ask_met() {
    let root = Root::new();
    win::tests::electron_folder(&root.0, ELECTRONS);
    fs::remove_file(root.0.join("Local State")).unwrap();
    let mut first = run();
    assert!(secret_in(&mut first, &root.0).is_some_and(|s| s != ELECTRONS));
    let answer = migrate_with(&mut first, &root.0);
    assert!(matches!(answer, Migration::Failed { reason: "unreadable", .. }), "{answer:?}");
  }

  #[test]
  fn statuses_serialise_for_the_migration_screen() {
    assert_eq!(serde_json::to_string(&Migration::Migrated).unwrap(), r#"{"status":"migrated"}"#);
    assert_eq!(serde_json::to_string(&Migration::Nothing).unwrap(), r#"{"status":"nothing"}"#);
    let failed = Migration::Failed { reason: "unreadable", detail: "x".into() };
    assert_eq!(serde_json::to_string(&failed).unwrap(), r#"{"status":"failed","reason":"unreadable","detail":"x"}"#);
  }
}
