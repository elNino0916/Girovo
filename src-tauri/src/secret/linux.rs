// The shell secret on Linux: an item in the Secret Service (GNOME Keyring,
// KWallet's Secret Service, KeePassXC…), through keyring-core and its zbus
// store. Where no Secret Service answers on the session bus there is no
// secret, and the page does not offer what needs it.
//
// Electron's secret is opened with the password Chromium kept in KWallet or
// the Secret Service (os_crypt.rs), asked for here over D-Bus.

use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use keyring_core::{Entry, Error};
use secret_service::EncryptionType;
use secret_service::blocking::{Item, SecretService};
use zbus::blocking::Proxy;

use super::Unreadable;
use super::os_crypt::{APP, KWALLET_ENTRY, KWALLET_FOLDER, KWallet, Keyring, Lookups};

const SERVICE: &str = "Girovo";
const USER: &str = "shell-secret";

fn entry() -> Result<Entry, String> {
  if keyring_core::get_default_store().is_none() {
    let store = zbus_secret_service_keyring_store::Store::new().map_err(|err| format!("no Secret Service: {err}"))?;
    keyring_core::set_default_store(store);
  }
  Entry::new(SERVICE, USER).map_err(|err| err.to_string())
}

/// The kept secret's text; None when there is none (or it is no text).
pub fn read(_root: &Path) -> Result<Option<String>, String> {
  match entry()?.get_password() {
    Ok(secret) => Ok(Some(secret)),
    Err(Error::NoEntry) | Err(Error::BadEncoding(_)) => Ok(None),
    Err(err) => Err(err.to_string()),
  }
}

pub fn write(_root: &Path, secret: &str) -> Result<(), String> {
  entry()?.set_password(secret).map_err(|err| err.to_string())
}

/// "Girovo zurücksetzen" (reset.rs): the keyring's item goes too — the data
/// folder alone would leave it to seal the next start's PINs.
pub fn forget(_root: &Path) {
  if let Ok(entry) = entry() {
    let _ = entry.delete_credential();
  }
}

/// How long an ask waits for Chromium's keyring at most: an unlock prompt
/// left unanswered (or behind the start window) must not hold the start —
/// the migration screen, the page's first ask, the shell secret's lock in
/// secret.rs — for longer. The lookup goes on behind; what it finds is taken
/// at the next ask.
const KEYRING_DEADLINE: Duration = Duration::from_secs(25);

/// This run's keyring lookups (os_crypt.rs Lookups).
static LOOKUPS: Lookups = Lookups::new();

/// Opens what Electron's safeStorage sealed (os_crypt.rs), asking the keyring
/// Chromium kept its password in on a thread of its own, KEYRING_DEADLINE at most.
pub fn electron(_root: &Path, sealed: &[u8]) -> Result<String, Unreadable> {
  LOOKUPS.open(sealed, KEYRING_DEADLINE, Chromiums, |name| std::env::var(name).ok())
}

/// Chromium's keyrings over the session bus, asked as FreedesktopSecretKeyProvider asked them.
struct Chromiums;

/// How long one KWallet call may take: opening the wallet can ask for its
/// password on screen. Only the lookup's own thread waits that long.
const KWALLET_CALL: Duration = Duration::from_secs(120);

fn said(err: impl std::fmt::Display) -> String {
  err.to_string()
}

/// The daemon is not on this system, nor startable: an answer, not a failure that may pass.
fn absent(err: &zbus::Error) -> bool {
  match err {
    zbus::Error::MethodError(name, _, _) => {
      matches!(name.as_str(), "org.freedesktop.DBus.Error.ServiceUnknown" | "org.freedesktop.DBus.Error.NameHasNoOwner")
    }
    zbus::Error::FDO(err) => matches!(**err, zbus::fdo::Error::ServiceUnknown(_) | zbus::fdo::Error::NameHasNoOwner(_)),
    _ => false,
  }
}

impl Keyring for Chromiums {
  fn kwallet(&self, daemon: KWallet) -> Result<Option<Vec<u8>>, String> {
    let bus = zbus::blocking::connection::Builder::session()
      .and_then(|b| b.method_timeout(KWALLET_CALL).build())
      .map_err(|err| format!("no session bus: {err}"))?;
    let wallet = Proxy::new(&bus, daemon.service, daemon.path, "org.kde.KWallet").map_err(said)?;
    let enabled: bool = match wallet.call("isEnabled", &()) {
      Ok(enabled) => enabled,
      Err(err) if absent(&err) => {
        eprintln!("[shell-secret] {} is not there: {err}", daemon.service);
        return Ok(None);
      }
      Err(err) => return Err(said(err)),
    };
    if !enabled {
      eprintln!("[shell-secret] KWallet is switched off");
      return Ok(None);
    }
    let name: String = wallet.call("networkWallet", &()).map_err(said)?;
    let handle: i32 = wallet.call("open", &(name.as_str(), 0i64, APP)).map_err(said)?;
    if handle < 0 {
      return Err(format!("the wallet {name} did not open"));
    }
    let read = (|| -> zbus::Result<Option<String>> {
      let has: bool = wallet.call("hasEntry", &(handle, KWALLET_FOLDER, KWALLET_ENTRY, APP))?;
      if !has {
        return Ok(None);
      }
      wallet.call("readPassword", &(handle, KWALLET_FOLDER, KWALLET_ENTRY, APP)).map(Some)
    })();
    let _: zbus::Result<i32> = wallet.call("close", &(handle, false, APP));
    Ok(read.map_err(said)?.filter(|p| !p.is_empty()).map(String::into_bytes))
  }

  fn secret_service(&self) -> Result<Vec<Vec<u8>>, String> {
    let service = SecretService::connect(EncryptionType::Dh).map_err(|err| format!("no Secret Service: {err}"))?;
    let found = service.search_items(HashMap::from([("application", APP)])).map_err(said)?;
    let mut secrets: Vec<Vec<u8>> = found.unlocked.iter().filter_map(|item| item.get_secret().ok()).collect();
    if !found.locked.is_empty() {
      // Unlocking may ask for the keyring's password, as Chromium's start did.
      let locked: Vec<&Item> = found.locked.iter().collect();
      match service.unlock_all(&locked) {
        Ok(()) => secrets.extend(found.locked.iter().filter_map(|item| item.get_secret().ok())),
        Err(err) if secrets.is_empty() => return Err(format!("not unlocked: {err}")),
        Err(_) => {}
      }
    }
    secrets.retain(|s| !s.is_empty());
    Ok(secrets)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  /// What Electron 45's own safeStorage.encryptStringAsync sealed on this
  /// desktop, opened through its keyring. Run with
  /// GIROVO_ELECTRON_SEALED=<its user data folder> and
  /// GIROVO_ELECTRON_SECRET=<the text sealed>, after sealing it with Electron
  /// (productName "Girovo", as the shell was built); skipped otherwise.
  #[test]
  #[ignore]
  fn opens_what_electron_sealed() {
    let root = std::path::PathBuf::from(std::env::var("GIROVO_ELECTRON_SEALED").expect("GIROVO_ELECTRON_SEALED"));
    let expected = std::env::var("GIROVO_ELECTRON_SECRET").expect("GIROVO_ELECTRON_SECRET");
    let sealed = std::fs::read(root.join(super::super::ELECTRON_FILE)).unwrap();
    assert_eq!(electron(&root, &sealed).unwrap(), expected);
  }
}
