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

/// The kept secret's text; None when there is none, or when it will never
/// open (damaged, not DPAPI's, sealed for another use): then a new one takes
/// its place (secret.rs load). Any other failure is an error — the file held
/// by a scanner, DPAPI not answering for a moment, a domain account's key not
/// at hand yet: no secret this time, and the file stays for the next ask. Replacing it would lose every PIN kept
/// under it for good (linked unlock, Windows Hello, the background box).
pub fn read(root: &Path) -> Result<Option<String>, String> {
  let sealed = match read_riding_out_locks(&root.join(FILE)) {
    Ok(sealed) => sealed,
    Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
    Err(err) => return Err(format!("{FILE}: {err}")),
  };
  opened(unprotect(&sealed, Some(ENTROPY)))
}

/// What DPAPI made of the kept blob: its text, None when it never will open
/// (or is no text), an error when it may yet.
fn opened(result: windows::core::Result<Vec<u8>>) -> Result<Option<String>, String> {
  match result {
    Ok(plain) => Ok(String::from_utf8(plain).ok()),
    Err(err) if never_opens(err.code()) => {
      eprintln!("[shell-secret] {FILE} does not open, for good: {}", err.message());
      Ok(None)
    }
    Err(err) => Err(format!("{FILE} does not open now: {}", err.message())),
  }
}

/// DPAPI's answers that say a blob will never open for this user: damaged or
/// not DPAPI's at all (ERROR_INVALID_DATA, E_INVALIDARG, NTE_BAD_DATA — sealed
/// with other entropy too). Anything else may pass — the service not
/// answering, too little memory, access refused for a moment — and so may
/// NTE_BAD_KEY_STATE: on a domain-joined PC after a password change made
/// offline it clears once the domain controller is reachable again. Should it
/// mean another account for good, the features that need the secret are just
/// not offered, which is better than losing every PIN kept under it.
fn never_opens(code: windows::core::HRESULT) -> bool {
  const FOR_GOOD: [u32; 3] = [0x8007_000D, 0x8007_0057, 0x8009_0005];
  FOR_GOOD.contains(&(code.0 as u32))
}

/// The file's bytes, riding out the brief locks a virus scanner holds on
/// Windows (files.rs locked), as every other read of the data folder does.
fn read_riding_out_locks(file: &Path) -> std::io::Result<Vec<u8>> {
  let mut attempt = 0;
  loop {
    match fs::read(file) {
      Err(err) if attempt < 5 && crate::files::locked(&err) => {
        std::thread::sleep(Duration::from_millis(15 << attempt));
        attempt += 1;
      }
      other => return other,
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
  let key = unprotect(blob, None).map_err(|err| Unreadable::new("unreadable", format!("os_crypt key does not open: {}", err.message())))?;
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

/// Opens what DPAPI sealed for this user account (with `entropy` if it was
/// sealed with some). The error keeps DPAPI's code: read() decides by it.
pub(super) fn unprotect(sealed: &[u8], entropy: Option<&[u8]>) -> windows::core::Result<Vec<u8>> {
  let input = blob(sealed);
  let entropy = entropy.map(blob);
  let mut out = CRYPT_INTEGER_BLOB::default();
  // SAFETY: as in protect().
  unsafe {
    CryptUnprotectData(&input, None, entropy.as_ref().map(|e| e as *const _), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)?;
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

  /// A data folder of its own, gone with the test.
  struct Folder(std::path::PathBuf);

  impl Folder {
    fn new(name: &str) -> Self {
      let dir = std::env::temp_dir().join(format!("girovo-dpapi-{name}-{}", std::process::id()));
      let _ = fs::remove_dir_all(&dir);
      fs::create_dir_all(&dir).unwrap();
      Folder(dir)
    }
  }

  impl Drop for Folder {
    fn drop(&mut self) {
      let _ = fs::remove_dir_all(&self.0);
    }
  }

  #[test]
  fn a_kept_secret_reads_back() {
    let root = Folder::new("ok");
    write(&root.0, "c2VjcmV0").unwrap();
    assert_eq!(read(&root.0).unwrap().as_deref(), Some("c2VjcmV0"));
  }

  /// What DPAPI really answers for a blob that can never open counts as for
  /// good, so a new secret may take its place: not DPAPI's, cut short,
  /// sealed with other entropy (another program's).
  #[test]
  fn a_blob_that_never_opens_reads_as_none() {
    let root = Folder::new("gone");
    let file = root.0.join(FILE);
    let sealed = protect(b"c2VjcmV0", ENTROPY).unwrap();
    for (what, bytes) in [
      ("not dpapi", b"not dpapi at all".to_vec()),
      ("cut short", sealed[..sealed.len() / 2].to_vec()),
      ("other entropy", protect(b"c2VjcmV0", b"another program").unwrap()),
    ] {
      fs::write(&file, &bytes).unwrap();
      let code = unprotect(&bytes, Some(ENTROPY)).unwrap_err().code();
      assert!(never_opens(code), "{what}: {:#010x} should count as for good", code.0 as u32);
      assert_eq!(read(&root.0), Ok(None), "{what}");
    }
  }

  /// DPAPI failing for a moment is no reason to throw the secret away.
  #[test]
  fn a_failure_that_may_pass_is_an_error_not_a_missing_secret() {
    use windows::core::{Error, HRESULT};
    for code in [
      0x8007_06BA_u32, // RPC server unavailable
      0x8007_000E,     // out of memory
      0x8007_0005,     // access denied
      0x8007_05AA,     // no system resources
      0x8009_000B,     // NTE_BAD_KEY_STATE: a domain account's key, out of reach until the domain controller is
    ] {
      let answer = opened(Err(Error::from_hresult(HRESULT(code as i32))));
      assert!(answer.is_err(), "{code:#010x}: {answer:?}");
    }
    for code in [0x8009_0005_u32, 0x8007_000D, 0x8007_0057] {
      assert_eq!(opened(Err(Error::from_hresult(HRESULT(code as i32)))), Ok(None), "{code:#010x}");
    }
    // Opened, but no text: never of use either.
    assert_eq!(opened(Ok(vec![0xff, 0xfe])), Ok(None));
  }

  /// A file that cannot be read now (here: a folder where it belongs) is an
  /// error too, never "none" — which would make a new secret.
  #[test]
  fn a_file_that_cannot_be_read_is_an_error() {
    let root = Folder::new("busy");
    fs::create_dir_all(root.0.join(FILE)).unwrap();
    assert!(read(&root.0).is_err());
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
