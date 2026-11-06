// The shell secret on Linux: an item in the Secret Service (GNOME Keyring,
// KWallet's Secret Service, KeePassXC…), through keyring-core and its zbus
// store. Where no Secret Service answers on the session bus there is no
// secret, and the page does not offer what needs it.

use std::path::Path;

use keyring_core::{Entry, Error};

use super::Unreadable;

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

/// Electron's secret on Linux is not opened here (see secret.rs).
pub fn electron(_root: &Path, _sealed: &[u8]) -> Result<String, Unreadable> {
  Err(Unreadable::new("unsupported", "Electron's keyring-sealed secret is not read on Linux"))
}
