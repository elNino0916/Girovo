// The shell secret on Windows: DPAPI for the current user, and Electron's
// safeStorage format read back for the migration.
//
// Electron 45's safeStorage.encryptStringAsync (the Electron shell's linked-unlock.cjs) is
// Chromium's os_crypt: the blob is "v10", a 12-byte nonce, then AES-256-GCM's
// ciphertext and tag; the AES key is in the user data folder's "Local State",
// os_crypt.encrypted_key = base64("DPAPI" + the key under DPAPI). Checked
// against Electron itself: a secret its safeStorage sealed in a throwaway user
// data folder opens here (tests::opens_what_electron_sealed).

use std::fs;
use std::path::Path;
use std::time::Duration;

use aws_lc_rs::aead::{AES_256_GCM, Aad, LessSafeKey, NONCE_LEN, Nonce, UnboundKey};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use windows::Win32::Foundation::{HLOCAL, LocalFree};
use windows::Win32::Security::Cryptography::{CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData};
use windows::core::w;

use super::Unreadable;

/// This shell's secret: DPAPI's blob of the secret's base64 text, nothing around it.
const FILE: &str = "shell-secret.dpapi";
/// Ties the blob to this use: another program of the same user must name it to open the blob.
const ENTROPY: &[u8] = b"girovo/shell-secret/v1";

/// The kept secret's text; None when there is none, or when it does not open
/// (sealed under another Windows account, or damaged): unreadable for good.
pub fn read(root: &Path) -> Result<Option<String>, String> {
  let sealed = match fs::read(root.join(FILE)) {
    Ok(sealed) => sealed,
    Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
    Err(err) => return Err(format!("{FILE}: {err}")),
  };
  match unprotect(&sealed, Some(ENTROPY)) {
    Ok(plain) => Ok(String::from_utf8(plain).ok()),
    Err(err) => {
      eprintln!("[shell-secret] {FILE} does not open: {err}");
      Ok(None)
    }
  }
}

pub fn write(root: &Path, secret: &str) -> Result<(), String> {
  let sealed = protect(secret.as_bytes(), ENTROPY)?;
  replace(&root.join(FILE), &sealed)
}

/// Opens what Electron's safeStorage sealed, with the key in `root`/Local State.
/// Nothing beyond the data folder: the DPAPI-sealed file goes with it (reset.rs).
pub fn forget(_root: &Path) {}

pub fn electron(root: &Path, sealed: &[u8]) -> Result<String, Unreadable> {
  let Some(body) = sealed.strip_prefix(b"v10") else {
    return Err(Unreadable::new("unreadable", "not os_crypt's v10 format"));
  };
  if body.len() < NONCE_LEN + AES_256_GCM.tag_len() {
    return Err(Unreadable::new("unreadable", "too short for AES-GCM"));
  }
  let (nonce, data) = body.split_at(NONCE_LEN);
  let key = electron_key(root)?;
  let key = UnboundKey::new(&AES_256_GCM, &key).map_err(|_| Unreadable::new("unreadable", "Local State's key is no AES-256 key"))?;
  let nonce = Nonce::try_assume_unique_for_key(nonce).map_err(|_| Unreadable::new("unreadable", "bad nonce"))?;
  let mut buffer = data.to_vec();
  let plain = LessSafeKey::new(key)
    .open_in_place(nonce, Aad::empty(), &mut buffer)
    .map_err(|_| Unreadable::new("unreadable", "Local State's key does not open it"))?;
  String::from_utf8(plain.to_vec()).map_err(|_| Unreadable::new("unreadable", "not text"))
}

/// os_crypt's AES key: Local State's os_crypt.encrypted_key, "DPAPI" and the key under DPAPI.
fn electron_key(root: &Path) -> Result<Vec<u8>, Unreadable> {
  let text = fs::read_to_string(root.join("Local State")).map_err(|err| Unreadable::new("unreadable", format!("Local State: {err}")))?;
  let state: serde_json::Value = serde_json::from_str(&text).map_err(|_| Unreadable::new("unreadable", "Local State is no JSON"))?;
  let encoded = state
    .pointer("/os_crypt/encrypted_key")
    .and_then(serde_json::Value::as_str)
    .ok_or_else(|| Unreadable::new("unreadable", "Local State has no os_crypt key"))?;
  let raw = B64.decode(encoded).map_err(|_| Unreadable::new("unreadable", "os_crypt key is no base64"))?;
  let blob = raw.strip_prefix(b"DPAPI").ok_or_else(|| Unreadable::new("unreadable", "os_crypt key is not DPAPI's"))?;
  let key = unprotect(blob, None).map_err(|err| Unreadable::new("unreadable", format!("os_crypt key does not open: {err}")))?;
  if key.len() != 32 {
    return Err(Unreadable::new("unreadable", "os_crypt key is no AES-256 key"));
  }
  Ok(key)
}

fn blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
  CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr().cast_mut() }
}

/// DPAPI's output, copied out; its buffer is wiped and given back.
///
/// # Safety
/// `out` must be a blob DPAPI filled, not yet freed.
unsafe fn taken(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
  if out.pbData.is_null() {
    return Vec::new();
  }
  // SAFETY: DPAPI allocated cbData bytes at pbData with LocalAlloc; they are
  // read, wiped and freed once, here.
  unsafe {
    let bytes = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
    std::ptr::write_bytes(out.pbData, 0, out.cbData as usize);
    let _ = LocalFree(Some(HLOCAL(out.pbData.cast())));
    bytes
  }
}

/// Seals `plain` for this user account, never asking anything on screen.
pub(super) fn protect(plain: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
  let (input, entropy) = (blob(plain), blob(entropy));
  let mut out = CRYPT_INTEGER_BLOB::default();
  // SAFETY: input and entropy point into slices alive for the call, which only
  // reads them; DPAPI fills `out`, freed in taken().
  unsafe {
    CryptProtectData(&input, w!("Girovo"), Some(&raw const entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out).map_err(|err| err.message())?;
    Ok(taken(out))
  }
}

/// Opens what DPAPI sealed for this user account (with `entropy` if it was sealed with some).
pub(super) fn unprotect(sealed: &[u8], entropy: Option<&[u8]>) -> Result<Vec<u8>, String> {
  let input = blob(sealed);
  let entropy = entropy.map(blob);
  let mut out = CRYPT_INTEGER_BLOB::default();
  // SAFETY: as in protect().
  unsafe {
    CryptUnprotectData(&input, None, entropy.as_ref().map(|e| e as *const _), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
      .map_err(|err| err.message())?;
    Ok(taken(out))
  }
}

/// A temp file renamed over `file`, so a crash leaves the old file, never half
/// a new one; Windows refuses the rename while a scanner holds the target, so
/// a few short retries (as prefs.json).
fn replace(file: &Path, bytes: &[u8]) -> Result<(), String> {
  let mut tmp = file.as_os_str().to_owned();
  tmp.push(format!(".{}.tmp", std::process::id()));
  let tmp = std::path::PathBuf::from(tmp);
  fs::write(&tmp, bytes).map_err(|err| format!("{}: {err}", tmp.display()))?;
  for attempt in 0..4u64 {
    match fs::rename(&tmp, file) {
      Ok(()) => return Ok(()),
      Err(_) if attempt < 3 => std::thread::sleep(Duration::from_millis(20 * (attempt + 1))),
      Err(err) => {
        let _ = fs::remove_file(&tmp);
        return Err(format!("{}: {err}", file.display()));
      }
    }
  }
  Ok(())
}

#[cfg(test)]
pub(super) mod tests {
  use aws_lc_rs::aead::{AES_256_GCM, Aad, LessSafeKey, Nonce, UnboundKey};

  use super::*;

  /// A user data folder as Electron leaves it: Local State with os_crypt's
  /// key under DPAPI, and linked-unlock.key sealed with it the v10 way.
  pub fn electron_folder(root: &Path, secret: &str) {
    let mut key = [0u8; 32];
    let mut nonce = [0u8; NONCE_LEN];
    aws_lc_rs::rand::fill(&mut key).unwrap();
    aws_lc_rs::rand::fill(&mut nonce).unwrap();
    let mut encrypted_key = b"DPAPI".to_vec();
    encrypted_key.extend(chromium_protect(&key));
    let state = serde_json::json!({ "os_crypt": { "audit_enabled": true, "encrypted_key": B64.encode(encrypted_key) } });
    fs::write(root.join("Local State"), state.to_string()).unwrap();
    let mut data = secret.as_bytes().to_vec();
    LessSafeKey::new(UnboundKey::new(&AES_256_GCM, &key).unwrap())
      .seal_in_place_append_tag(Nonce::assume_unique_for_key(nonce), Aad::empty(), &mut data)
      .unwrap();
    let mut sealed = b"v10".to_vec();
    sealed.extend(nonce);
    sealed.extend(data);
    fs::write(root.join(super::super::ELECTRON_FILE), sealed).unwrap();
  }

  /// DPAPI without entropy, as Chromium seals its key.
  fn chromium_protect(plain: &[u8]) -> Vec<u8> {
    let input = blob(plain);
    let mut out = CRYPT_INTEGER_BLOB::default();
    unsafe {
      CryptProtectData(&input, w!("Chromium"), None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out).unwrap();
      taken(out)
    }
  }

  #[test]
  fn dpapi_round_trip_needs_the_entropy() {
    let sealed = protect(b"secret text", ENTROPY).unwrap();
    assert_ne!(sealed, b"secret text");
    assert_eq!(unprotect(&sealed, Some(ENTROPY)).unwrap(), b"secret text");
    assert!(unprotect(&sealed, None).is_err());
    assert!(unprotect(&sealed, Some(b"other")).is_err());
    assert!(unprotect(b"not dpapi", Some(ENTROPY)).is_err());
  }

  #[test]
  fn refuses_what_is_not_v10() {
    let root = std::env::temp_dir();
    assert_eq!(electron(&root, b"v20abcdefghijklmnopqrstuvwxyz0123").unwrap_err().reason, "unreadable");
    assert_eq!(electron(&root, b"v10short").unwrap_err().reason, "unreadable");
  }

  /// What Electron 45's own safeStorage.encryptStringAsync sealed. Run with
  /// GIROVO_ELECTRON_SEALED=<its user data folder> and
  /// GIROVO_ELECTRON_SECRET=<the text sealed>, after sealing it with Electron
  /// (see this file's head); skipped otherwise.
  #[test]
  #[ignore]
  fn opens_what_electron_sealed() {
    let root = std::path::PathBuf::from(std::env::var("GIROVO_ELECTRON_SEALED").expect("GIROVO_ELECTRON_SEALED"));
    let expected = std::env::var("GIROVO_ELECTRON_SECRET").expect("GIROVO_ELECTRON_SECRET");
    let sealed = fs::read(root.join(super::super::ELECTRON_FILE)).unwrap();
    assert_eq!(electron(&root, &sealed).unwrap(), expected);
  }
}
