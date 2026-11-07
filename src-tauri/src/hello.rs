// Windows Hello in place of typing the first login's PIN — the desktop's
// counterpart of Android's fingerprint login (mobile/bridges/biometric.ts).
// The Electron shell did this with its windows-hello.cjs and a helper program
// (WindowsHello.cs, gone with it); this shell makes the same WinRT calls
// itself, through the windows crate, and keeps the same windows-hello.json in
// the same data folder, so a Windows Hello set up under Electron opens here:
//
// - One Windows Hello key per user account for Girovo (a KeyCredential, in the
//   TPM where there is one), named in windows-hello.json and made on the first
//   enroll. Signing with it asks for the face, the fingerprint or the Windows
//   Hello PIN.
// - The key handed to the page is sha256("girovo/windows-hello/key/v1" ‖
//   signature), the signature being the Windows Hello key's over
//   sha256("girovo/windows-hello/challenge/v1" ‖ salt). A KeyCredential signs
//   RSA PKCS#1 v1.5, the same every time, so the same gesture brings the same
//   key back — checked at enroll against the key's public half, so a key that
//   signs otherwise is never used. The tests hold vectors that
//   the Electron shell's windows-hello.cjs made itself: the bytes are Electron's.
// - A signature that no longer checks out against the public half kept here
//   (the key was replaced, by another copy of Girovo for one) or a key Windows
//   no longer has: 'invalidated', and what was sealed under it is gone.
//
// The answers keep windows-hello.cjs's shapes for lib/windows-hello-client.ts,
// with the HRESULT Windows threw ("0x80090011") where it threw: the page names
// a damaged Windows Hello store, since trying again does not help then.
//
// WinRT's operations are waited for on a blocking thread, never the window's,
// and one at a time: two prompts at once would confuse everyone. An unlock
// asked for while another still waits for its gesture (the button, clicked
// with the prompt hidden behind Girovo) opens no prompt of its own, not even
// after the first: it brings the open one to the front and answers 'busy'.
// Windows opens
// its prompt on its own, often behind Girovo; it is brought to the front by its
// window class, as the helper did and Chromium does
// (crypto/user_verifying_key_win.cc).

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use sha2::{Digest, Sha256};

use crate::paths::data_root;

const CHALLENGE_DOMAIN: &[u8] = b"girovo/windows-hello/challenge/v1";
const KEY_DOMAIN: &[u8] = b"girovo/windows-hello/key/v1";
const SALT_BYTES: usize = 32;
/// Electron's file, kept on: the key's name, the salt and the public half.
const STATE_FILE: &str = "windows-hello.json";

/// KeyCredentialStatus values that mean the user said no.
const CANCELED: [&str; 2] = ["UserCanceled", "UserPrefersPassword"];

/// What the page gets: windows-hello.cjs's answers, field for field.
#[derive(serde::Serialize, Debug, Clone, PartialEq)]
pub struct Answer {
  result: &'static str,
  #[serde(skip_serializing_if = "Option::is_none")]
  key: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  fresh: Option<bool>,
  #[serde(skip_serializing_if = "Option::is_none")]
  code: Option<String>,
}

impl Answer {
  fn just(result: &'static str) -> Self {
    Answer { result, key: None, fresh: None, code: None }
  }

  /// A failure, with what Windows threw where it did.
  fn failed(code: Option<String>) -> Self {
    Answer { code, ..Answer::just("failed") }
  }
}

/// What Windows threw instead of answering: its HRESULT where there is one.
#[derive(Debug)]
pub struct Threw {
  code: Option<String>,
  message: String,
}

impl Threw {
  fn plain(message: &str) -> Self {
    Threw { code: None, message: message.to_string() }
  }
}

/// What one of Windows' calls came to: a KeyCredentialStatus other than
/// Success, by its name as the helper reported it, or the signature.
#[derive(Debug)]
pub enum Outcome {
  Status(&'static str),
  Signed { signature: Vec<u8>, public_key: Option<String> },
}

/// The four things Windows does here; WinRt is the real one, the tests bring their own.
pub trait Platform: Send + Sync {
  /// Whether this Windows has Windows Hello set up for this user.
  fn probe(&self) -> Result<bool, Threw>;
  /// Makes the key `name`, replacing one of that name, and signs `challenge`
  /// with it; a signature comes with the key's public half (SPKI, base64).
  fn create(&self, name: &str, challenge: &[u8]) -> Result<Outcome, Threw>;
  /// Signs `challenge` with the existing key `name`.
  fn sign(&self, name: &str, challenge: &[u8]) -> Result<Outcome, Threw>;
  /// Deletes the key `name`, if there is one.
  fn delete(&self, name: &str);
  /// Brings Windows' prompt to the front, if one is open.
  fn raise(&self);
}

struct State {
  name: String,
  salt: Vec<u8>,
  public_key: String,
}

/// windows-hello.json as Electron wrote it.
#[derive(serde::Serialize)]
struct StateFile<'a> {
  v: u8,
  name: &'a str,
  salt: String,
  #[serde(rename = "publicKey")]
  public_key: &'a str,
}

/// A signature's meaning for the page.
enum Signed {
  Unlocked(String),
  Canceled,
  Invalidated,
  Failed { why: String, code: Option<String> },
}

pub struct Hello<P: Platform> {
  platform: P,
  file: PathBuf,
  supported: Mutex<Option<bool>>,
  queue: Mutex<()>,
  /// An unlock is waiting for its gesture.
  unlocking: AtomicBool,
}

/// Lowers the flag it holds when it goes, however the unlock ended.
struct Lowers<'a>(&'a AtomicBool);

impl Drop for Lowers<'_> {
  fn drop(&mut self) {
    self.0.store(false, Ordering::SeqCst);
  }
}

impl<P: Platform> Hello<P> {
  pub fn new(platform: P, file: PathBuf) -> Self {
    Hello { platform, file, supported: Mutex::new(None), queue: Mutex::new(()), unlocking: AtomicBool::new(false) }
  }

  /// One request at a time: a second waits for the first's prompt to close.
  fn serial<T>(&self, f: impl FnOnce() -> T) -> T {
    let _turn = self.queue.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    f()
  }

  /// Asked once per run, as Electron did.
  fn supported(&self) -> bool {
    let mut known = self.supported.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(on) = *known {
      return on;
    }
    let on = self.platform.probe().unwrap_or_else(|threw| {
      eprintln!("[windows-hello] probe failed: {}", threw.message);
      false
    });
    *known = Some(on);
    on
  }

  /// Whether this Windows has Windows Hello set up for this user.
  pub fn available(&self) -> bool {
    self.serial(|| self.supported())
  }

  /// The key for sealing a PIN: the existing Windows Hello key's (one
  /// gesture), or a new key's (Windows asks to set it up, then to use it). A
  /// key Windows lost or replaced is made anew — whatever was sealed under it
  /// is gone anyway.
  pub fn enroll(&self) -> Answer {
    self.serial(|| {
      if !self.supported() {
        return Answer::just("unavailable");
      }
      let prior = self.read_state();
      if let Some(prior) = &prior {
        match self.sign(prior) {
          Signed::Unlocked(key) => return Answer { key: Some(key), fresh: Some(false), ..Answer::just("enrolled") },
          Signed::Canceled => return Answer::just("canceled"),
          Signed::Failed { code, .. } => return Answer::failed(code),
          Signed::Invalidated => {}
        }
      }
      let (Some(salt), Some(id)) = (random::<SALT_BYTES>(), random::<6>()) else {
        return Answer::failed(None);
      };
      let name = prior.map(|p| p.name).unwrap_or_else(|| format!("Girovo-{}", hex(&id)));
      let challenge = challenge_of(&salt);
      let (signature, public_key) = match self.platform.create(&name, &challenge) {
        Ok(Outcome::Signed { signature, public_key: Some(public_key) }) => (signature, public_key),
        Ok(Outcome::Status(status)) if CANCELED.contains(&status) => return Answer::just("canceled"),
        Ok(Outcome::Status(status)) => {
          eprintln!("[windows-hello] create failed: {status}");
          return Answer::failed(None);
        }
        Ok(Outcome::Signed { public_key: None, .. }) => return Answer::failed(None),
        Err(threw) => {
          eprintln!("[windows-hello] create failed: {} {}", threw.message, threw.code.as_deref().unwrap_or(""));
          return Answer::failed(threw.code);
        }
      };
      if !verifies(&public_key, &challenge, &signature) {
        // A key that signs differently each time could never open again.
        eprintln!("[windows-hello] the key does not sign with PKCS#1 v1.5");
        self.platform.delete(&name);
        self.drop_state();
        return Answer::failed(None);
      }
      if let Err(err) = self.write_state(&name, &salt, &public_key) {
        eprintln!("[windows-hello] enroll failed: {err}");
        return Answer::failed(None);
      }
      Answer { key: Some(key_of(&signature)), fresh: Some(true), ..Answer::just("enrolled") }
    })
  }

  /// The key, after the gesture. While another unlock waits for one, only
  /// its prompt comes to the front: 'busy'.
  pub fn unlock(&self) -> Answer {
    if self.unlocking.swap(true, Ordering::SeqCst) {
      self.platform.raise();
      return Answer::just("busy");
    }
    let _lowers = Lowers(&self.unlocking);
    self.serial(|| {
      let Some(state) = self.read_state() else {
        return Answer::just("missing");
      };
      match self.sign(&state) {
        Signed::Unlocked(key) => Answer { key: Some(key), ..Answer::just("unlocked") },
        Signed::Canceled => Answer::just("canceled"),
        Signed::Invalidated => {
          self.drop_state();
          Answer::just("invalidated")
        }
        Signed::Failed { why, code } => {
          eprintln!("[windows-hello] sign failed: {why} {}", code.as_deref().unwrap_or(""));
          Answer::failed(code)
        }
      }
    })
  }

  /// Signs with the key named in `state`: the key, or why there is none.
  fn sign(&self, state: &State) -> Signed {
    let challenge = challenge_of(&state.salt);
    match self.platform.sign(&state.name, &challenge) {
      Ok(Outcome::Signed { signature, .. }) => {
        if verifies(&state.public_key, &challenge, &signature) {
          Signed::Unlocked(key_of(&signature))
        } else {
          Signed::Invalidated
        }
      }
      Ok(Outcome::Status(status)) if CANCELED.contains(&status) => Signed::Canceled,
      Ok(Outcome::Status("NotFound")) => Signed::Invalidated,
      Ok(Outcome::Status(status)) => Signed::Failed { why: status.to_string(), code: None },
      Err(threw) => Signed::Failed { why: threw.message, code: threw.code },
    }
  }

  fn read_state(&self) -> Option<State> {
    let raw: serde_json::Value = serde_json::from_str(&fs::read_to_string(&self.file).ok()?).ok()?;
    if raw.get("v").and_then(serde_json::Value::as_f64) != Some(1.0) {
      return None;
    }
    let name = raw.get("name")?.as_str()?;
    let salt = B64.decode(raw.get("salt")?.as_str()?).ok()?;
    let public_key = raw.get("publicKey")?.as_str()?;
    if !valid_name(name) || salt.len() != SALT_BYTES || public_key.is_empty() {
      return None;
    }
    Some(State { name: name.to_string(), salt, public_key: public_key.to_string() })
  }

  /// A temp file renamed over the state, so a crash leaves the old one, never half a new one.
  fn write_state(&self, name: &str, salt: &[u8], public_key: &str) -> std::io::Result<()> {
    let body = serde_json::to_string(&StateFile { v: 1, name, salt: B64.encode(salt), public_key }).map_err(std::io::Error::other)?;
    let suffix = random::<6>().map(|r| hex(&r)).unwrap_or_else(|| std::process::id().to_string());
    let mut tmp = self.file.clone().into_os_string();
    tmp.push(format!(".{suffix}.tmp"));
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, body)?;
    fs::rename(&tmp, &self.file).inspect_err(|_| {
      let _ = fs::remove_file(&tmp);
    })
  }

  /// "Girovo zurücksetzen" (reset.rs): the key goes from Windows, its file from the data folder.
  pub fn forget(&self) {
    self.serial(|| {
      if let Some(state) = self.read_state() {
        self.platform.delete(&state.name);
      }
      self.drop_state();
    });
  }

  fn drop_state(&self) {
    let _ = fs::remove_file(&self.file);
  }
}

fn challenge_of(salt: &[u8]) -> [u8; 32] {
  Sha256::new().chain_update(CHALLENGE_DOMAIN).chain_update(salt).finalize().into()
}

fn key_of(signature: &[u8]) -> String {
  B64.encode(Sha256::new().chain_update(KEY_DOMAIN).chain_update(signature).finalize())
}

/// Whether `signature` is the key's RSA PKCS#1 v1.5 signature (SHA-256) of
/// `challenge` — the kind that is the same each time. `public_key`: SPKI, base64.
fn verifies(public_key: &str, challenge: &[u8], signature: &[u8]) -> bool {
  use aws_lc_rs::signature::{RSA_PKCS1_2048_8192_SHA256, UnparsedPublicKey};
  let Ok(spki) = B64.decode(public_key) else { return false };
  UnparsedPublicKey::new(&RSA_PKCS1_2048_8192_SHA256, spki).verify(challenge, signature).is_ok()
}

/// Only Girovo's own keys, as Electron named them: nothing else this user account holds.
fn valid_name(name: &str) -> bool {
  name.strip_prefix("Girovo-").is_some_and(|id| id.len() == 12 && id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
}

fn random<const N: usize>() -> Option<[u8; N]> {
  let mut bytes = [0u8; N];
  aws_lc_rs::rand::fill(&mut bytes).ok()?;
  Some(bytes)
}

fn hex(bytes: &[u8]) -> String {
  bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// ---------------------------------------------------------------------------
// Windows

/// Windows' own KeyCredentialManager.
pub struct WinRt;

#[cfg(windows)]
impl Platform for WinRt {
  fn probe(&self) -> Result<bool, Threw> {
    winrt::probe()
  }
  fn create(&self, name: &str, challenge: &[u8]) -> Result<Outcome, Threw> {
    winrt::create(name, challenge)
  }
  fn sign(&self, name: &str, challenge: &[u8]) -> Result<Outcome, Threw> {
    winrt::sign(name, challenge)
  }
  fn delete(&self, name: &str) {
    winrt::delete(name)
  }
  fn raise(&self) {
    winrt::raise_prompt();
  }
}

/// Elsewhere there is no Windows Hello: available() says false, and the page offers nothing.
#[cfg(not(windows))]
impl Platform for WinRt {
  fn probe(&self) -> Result<bool, Threw> {
    Ok(false)
  }
  fn create(&self, _name: &str, _challenge: &[u8]) -> Result<Outcome, Threw> {
    Err(Threw::plain("no Windows Hello here"))
  }
  fn sign(&self, _name: &str, _challenge: &[u8]) -> Result<Outcome, Threw> {
    Err(Threw::plain("no Windows Hello here"))
  }
  fn delete(&self, _name: &str) {}
  fn raise(&self) {}
}

#[cfg(windows)]
mod winrt {
  use std::sync::mpsc::{self, RecvTimeoutError};
  use std::time::{Duration, Instant};

  use base64::Engine;
  use base64::engine::general_purpose::STANDARD as B64;
  use windows::Security::Credentials::{KeyCredential, KeyCredentialCreationOption, KeyCredentialManager, KeyCredentialStatus};
  use windows::Security::Cryptography::Core::CryptographicPublicKeyBlobType;
  use windows::Security::Cryptography::CryptographicBuffer;
  use windows::Storage::Streams::IBuffer;
  use windows::Win32::UI::WindowsAndMessaging::{FindWindowW, SetForegroundWindow};
  use windows::core::{Array, HSTRING, PCWSTR, RuntimeType, w};
  use windows_future::IAsyncOperation;

  use super::{Outcome, Threw};

  /// How often the prompt is looked for while Windows has not answered.
  const POLL: Duration = Duration::from_millis(100);
  /// A gesture can take a while; a prompt left open must not hold the queue for ever.
  const LIMIT: Duration = Duration::from_secs(3 * 60);

  impl From<windows::core::Error> for Threw {
    fn from(err: windows::core::Error) -> Self {
      Threw { code: Some(format!("0x{:08X}", err.code().0 as u32)), message: err.message() }
    }
  }

  pub fn probe() -> Result<bool, Threw> {
    wait(KeyCredentialManager::IsSupportedAsync()?, false)
  }

  pub fn create(name: &str, challenge: &[u8]) -> Result<Outcome, Threw> {
    let created = wait(KeyCredentialManager::RequestCreateAsync(&HSTRING::from(name), KeyCredentialCreationOption::ReplaceExisting)?, true)?;
    let status = created.Status()?;
    if status != KeyCredentialStatus::Success {
      return Ok(Outcome::Status(status_name(status)));
    }
    let credential = created.Credential()?;
    match sign_with(&credential, challenge)? {
      Outcome::Signed { signature, .. } => {
        let spki = bytes(&credential.RetrievePublicKeyWithBlobType(CryptographicPublicKeyBlobType::X509SubjectPublicKeyInfo)?)?;
        Ok(Outcome::Signed { signature, public_key: Some(B64.encode(spki)) })
      }
      status => Ok(status),
    }
  }

  pub fn sign(name: &str, challenge: &[u8]) -> Result<Outcome, Threw> {
    let opened = wait(KeyCredentialManager::OpenAsync(&HSTRING::from(name))?, false)?;
    let status = opened.Status()?;
    if status != KeyCredentialStatus::Success {
      return Ok(Outcome::Status(status_name(status)));
    }
    sign_with(&opened.Credential()?, challenge)
  }

  pub fn delete(name: &str) {
    // Already gone, or never made: the same either way.
    let _ = KeyCredentialManager::DeleteAsync(&HSTRING::from(name)).and_then(|action| action.join());
  }

  fn sign_with(credential: &KeyCredential, challenge: &[u8]) -> Result<Outcome, Threw> {
    let data = CryptographicBuffer::CreateFromByteArray(challenge)?;
    let signed = wait(credential.RequestSignAsync(&data)?, true)?;
    let status = signed.Status()?;
    if status != KeyCredentialStatus::Success {
      return Ok(Outcome::Status(status_name(status)));
    }
    Ok(Outcome::Signed { signature: bytes(&signed.Result()?)?, public_key: None })
  }

  /// The operation's result. One that shows a prompt has it brought to the
  /// front once it appears; one still unanswered after LIMIT is cancelled.
  fn wait<T: RuntimeType + Send + 'static>(operation: IAsyncOperation<T>, prompts: bool) -> Result<T, Threw> {
    let (done, answer) = mpsc::channel();
    operation.when(move |result| {
      let _ = done.send(result);
    })?;
    let started = Instant::now();
    let mut raised = !prompts;
    loop {
      match answer.recv_timeout(POLL) {
        Ok(result) => return result.map_err(Threw::from),
        Err(RecvTimeoutError::Timeout) if started.elapsed() < LIMIT => {
          if !raised {
            raised = raise_prompt();
          }
        }
        Err(_) => {
          let _ = operation.Cancel();
          return Err(Threw::plain("Windows Hello did not answer"));
        }
      }
    }
  }

  /// Brings Windows' Windows Hello prompt to the front, if it is there yet: whether it was.
  pub fn raise_prompt() -> bool {
    // SAFETY: FindWindowW reads a constant, NUL-terminated class name; the
    // window it finds is only handed back to Windows.
    unsafe {
      match FindWindowW(w!("Credential Dialog Xaml Host"), PCWSTR::null()) {
        Ok(prompt) if !prompt.is_invalid() => {
          let _ = SetForegroundWindow(prompt);
          true
        }
        _ => false,
      }
    }
  }

  fn bytes(buffer: &IBuffer) -> windows::core::Result<Vec<u8>> {
    let mut out = Array::<u8>::new();
    CryptographicBuffer::CopyToByteArray(buffer, &mut out)?;
    Ok(out.to_vec())
  }

  /// The status's name, as the helper's C# gave it (KeyCredentialStatus.ToString()).
  fn status_name(status: KeyCredentialStatus) -> &'static str {
    match status {
      KeyCredentialStatus::Success => "Success",
      KeyCredentialStatus::NotFound => "NotFound",
      KeyCredentialStatus::UserCanceled => "UserCanceled",
      KeyCredentialStatus::UserPrefersPassword => "UserPrefersPassword",
      KeyCredentialStatus::CredentialAlreadyExists => "CredentialAlreadyExists",
      KeyCredentialStatus::SecurityDeviceLocked => "SecurityDeviceLocked",
      _ => "UnknownError",
    }
  }
}

// ---------------------------------------------------------------------------
// The page's bridge: window.electronHello (src/bridge.js)

fn hello() -> &'static Hello<WinRt> {
  static HELLO: OnceLock<Hello<WinRt>> = OnceLock::new();
  HELLO.get_or_init(|| Hello::new(WinRt, data_root().join(STATE_FILE)))
}

/// The key and its file, gone ("Girovo zurücksetzen", reset.rs).
pub fn forget() {
  hello().forget();
}

#[tauri::command]
pub async fn hello_available() -> bool {
  tauri::async_runtime::spawn_blocking(|| hello().available()).await.unwrap_or(false)
}

#[tauri::command]
pub async fn hello_enroll() -> Answer {
  tauri::async_runtime::spawn_blocking(|| hello().enroll()).await.unwrap_or_else(|_| Answer::failed(None))
}

#[tauri::command]
pub async fn hello_unlock() -> Answer {
  tauri::async_runtime::spawn_blocking(|| hello().unlock()).await.unwrap_or_else(|_| Answer::failed(None))
}

#[cfg(test)]
mod tests {
  use std::collections::{HashMap, VecDeque};
  use std::sync::atomic::AtomicUsize;
  use std::sync::mpsc;

  use aws_lc_rs::encoding::AsDer;
  use aws_lc_rs::rsa::KeySize;
  use aws_lc_rs::signature::{KeyPair, RSA_PKCS1_SHA256, RSA_PSS_SHA256, RsaKeyPair};

  use super::*;

  // Made by the Electron shell's windows-hello.cjs itself: its enroll against a helper
  // signing with a Node RSA-2048 key (PKCS#1 v1.5, SHA-256), as a
  // KeyCredential does. The state is the windows-hello.json it wrote.
  const SALT: &str = "EORjgIA5dq0aenN85S9wP4EdRsV+fbfZj8dOe7GYdDM=";
  const PUBLIC_KEY: &str = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxmAeoeHGcQm3JPstfeGEZLcb2IeQtnl+pYQjHhovLFFYIbUyFKX16qTx6Hk7WiLDniXi5mKeoXvAVvmSBBUWGEyjCiHBY5nafL2neLzjqfeMHKlZIqOzE4NAIhPpQe/CvhW+w6gY4Q/jXyG/RpAyqmJDrrlFonf6W0fVWv+POJzkFNn+V1n8O9BVjKfjQctkiPyZGqFL6ox5B+36UMTAbrvw6S8LoMOYa5wRDju6gCgksCBIbzAzSumNIimCwpSz19B2CRYjK1FBs5O06gjPP+FqbxCRRWbO/glAOEoxhLXa78kNSNQjtFqi/NIWUvQyrjuckpXWEfLj146AuCht8QIDAQAB";
  const CHALLENGE: &str = "Dqvk4mPKFkSM835N9THEQDbTkhV3NNhMqHILK98/hYg=";
  const SIGNATURE: &str = "l/3rYWnxhYXurCjSdKqpHsNbDONolMv8/4V5bv7pY+mSY/BK8iYRmThbBoZGdQOxCMFMy0kxQOsffxiejlXkBtnrfLauPdgKeypvGWwdNiGoXxo6mytD9UyAAk7+c/Gc/uIjNuMABuycOrt4EjWAURJRaQw/L9RyQXtoZ9cnkeN7k1y1+FFDaM8WsvmBY3ZgWo/aeEx2FYMcAKEOQPmzML0UGZpqEjytjgv8BdGlaHviyRcKE3abW8fL8PReYp1WsTUcQBzhS3QejNsVacJyEmRBrd7cW0sPq6sgyn4Xnxjn+LdpViwhTvk03oCMc0ZNgiykmK2cVmwnvGSDpRbk7A==";
  const KEY: &str = "0spqOa6Aqq45e/AYXVlvomxomE4Qb4a9fBVkv4MBpJ8=";
  const ELECTRON_STATE: &str = r#"{"v":1,"name":"Girovo-c6d113257492","salt":"EORjgIA5dq0aenN85S9wP4EdRsV+fbfZj8dOe7GYdDM=","publicKey":"MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxmAeoeHGcQm3JPstfeGEZLcb2IeQtnl+pYQjHhovLFFYIbUyFKX16qTx6Hk7WiLDniXi5mKeoXvAVvmSBBUWGEyjCiHBY5nafL2neLzjqfeMHKlZIqOzE4NAIhPpQe/CvhW+w6gY4Q/jXyG/RpAyqmJDrrlFonf6W0fVWv+POJzkFNn+V1n8O9BVjKfjQctkiPyZGqFL6ox5B+36UMTAbrvw6S8LoMOYa5wRDju6gCgksCBIbzAzSumNIimCwpSz19B2CRYjK1FBs5O06gjPP+FqbxCRRWbO/glAOEoxhLXa78kNSNQjtFqi/NIWUvQyrjuckpXWEfLj146AuCht8QIDAQAB"}"#;

  #[test]
  fn derives_electrons_challenge_and_key() {
    let challenge = challenge_of(&B64.decode(SALT).unwrap());
    assert_eq!(B64.encode(challenge), CHALLENGE);
    let signature = B64.decode(SIGNATURE).unwrap();
    assert!(verifies(PUBLIC_KEY, &challenge, &signature));
    assert_eq!(key_of(&signature), KEY);
    let mut other = signature.clone();
    other[10] ^= 1;
    assert!(!verifies(PUBLIC_KEY, &challenge, &other));
    assert!(!verifies("not base64!", &challenge, &signature));
  }

  /// A Windows that signs with keys made here, or answers what a test queued.
  struct Fake {
    supported: bool,
    probes: AtomicUsize,
    keys: Mutex<HashMap<String, RsaKeyPair>>,
    queued: Mutex<VecDeque<Result<Outcome, Threw>>>,
    /// Signs with PSS, which is different each time.
    random_signatures: bool,
    /// The next signing says it started, then waits to be let go: a prompt left open.
    held: Mutex<Option<(mpsc::Sender<()>, mpsc::Receiver<()>)>>,
    raises: AtomicUsize,
  }

  impl Fake {
    fn new(supported: bool) -> Self {
      Fake {
        supported,
        probes: AtomicUsize::new(0),
        keys: Mutex::default(),
        queued: Mutex::default(),
        random_signatures: false,
        held: Mutex::default(),
        raises: AtomicUsize::new(0),
      }
    }
    fn queue(&self, answer: Result<Outcome, Threw>) {
      self.queued.lock().unwrap().push_back(answer);
    }
    fn signed(&self, key: &RsaKeyPair, challenge: &[u8]) -> Vec<u8> {
      let mut signature = vec![0; key.public_modulus_len()];
      let padding = if self.random_signatures { &RSA_PSS_SHA256 as &'static dyn aws_lc_rs::signature::RsaEncoding } else { &RSA_PKCS1_SHA256 };
      key.sign(padding, &aws_lc_rs::rand::SystemRandom::new(), challenge, &mut signature).unwrap();
      signature
    }
  }

  impl Platform for Fake {
    fn probe(&self) -> Result<bool, Threw> {
      self.probes.fetch_add(1, Ordering::SeqCst);
      Ok(self.supported)
    }
    fn create(&self, name: &str, challenge: &[u8]) -> Result<Outcome, Threw> {
      if let Some(answer) = self.queued.lock().unwrap().pop_front() {
        return answer;
      }
      let key = RsaKeyPair::generate(KeySize::Rsa2048).unwrap();
      let public_key = B64.encode(key.public_key().as_der().unwrap().as_ref());
      let signature = self.signed(&key, challenge);
      self.keys.lock().unwrap().insert(name.to_string(), key);
      Ok(Outcome::Signed { signature, public_key: Some(public_key) })
    }
    fn sign(&self, name: &str, challenge: &[u8]) -> Result<Outcome, Threw> {
      let held = self.held.lock().unwrap().take();
      if let Some((started, release)) = held {
        started.send(()).unwrap();
        release.recv().unwrap();
      }
      if let Some(answer) = self.queued.lock().unwrap().pop_front() {
        return answer;
      }
      match self.keys.lock().unwrap().get(name) {
        Some(key) => Ok(Outcome::Signed { signature: self.signed(key, challenge), public_key: None }),
        None => Ok(Outcome::Status("NotFound")),
      }
    }
    fn delete(&self, name: &str) {
      self.keys.lock().unwrap().remove(name);
    }
    fn raise(&self) {
      self.raises.fetch_add(1, Ordering::SeqCst);
    }
  }

  /// A Hello over the fake, its state file in a folder of its own that goes with it.
  struct Rig(Hello<Fake>);

  impl std::ops::Deref for Rig {
    type Target = Hello<Fake>;
    fn deref(&self) -> &Hello<Fake> {
      &self.0
    }
  }

  impl Drop for Rig {
    fn drop(&mut self) {
      if let Some(dir) = self.0.file.parent() {
        let _ = fs::remove_dir_all(dir);
      }
    }
  }

  fn rig(fake: Fake) -> Rig {
    let dir = std::env::temp_dir().join(format!("girovo-hello-test-{}", hex(&random::<8>().unwrap())));
    fs::create_dir_all(&dir).unwrap();
    Rig(Hello::new(fake, dir.join(STATE_FILE)))
  }

  fn threw(code: &str) -> Threw {
    Threw { code: Some(code.to_string()), message: "Das Objekt wurde nicht gefunden.".to_string() }
  }

  #[test]
  fn reads_electrons_state_file() {
    let hello = rig(Fake::new(true));
    fs::write(&hello.file, ELECTRON_STATE).unwrap();
    let state = hello.read_state().expect("Electron's windows-hello.json");
    assert_eq!(state.name, "Girovo-c6d113257492");
    assert_eq!(B64.encode(&state.salt), SALT);
    assert_eq!(state.public_key, PUBLIC_KEY);
    // What it writes back reads like Electron's.
    hello.write_state(&state.name, &state.salt, &state.public_key).unwrap();
    assert_eq!(fs::read_to_string(&hello.file).unwrap(), ELECTRON_STATE);
  }

  #[test]
  fn available_is_asked_once_per_run() {
    let hello = rig(Fake::new(true));
    assert!(hello.available());
    assert!(hello.available());
    assert_eq!(hello.platform.probes.load(Ordering::SeqCst), 1);
    let off = rig(Fake::new(false));
    assert!(!off.available());
    assert_eq!(off.enroll(), Answer::just("unavailable"));
  }

  #[test]
  fn enroll_then_unlock_brings_the_same_key_and_a_second_enroll_reuses_it() {
    let hello = rig(Fake::new(true));
    assert_eq!(hello.unlock(), Answer::just("missing"));
    let first = hello.enroll();
    assert_eq!((first.result, first.fresh), ("enrolled", Some(true)));
    let key = first.key.clone().unwrap();
    assert_eq!(B64.decode(&key).unwrap().len(), 32);
    assert_eq!(hello.unlock(), Answer { key: Some(key.clone()), ..Answer::just("unlocked") });
    let again = hello.enroll();
    assert_eq!((again.result, again.fresh, again.key), ("enrolled", Some(false), Some(key)));
    assert_eq!(hello.platform.keys.lock().unwrap().len(), 1);
  }

  #[test]
  fn a_second_unlock_while_the_prompt_is_open_only_brings_it_to_the_front() {
    let hello = rig(Fake::new(true));
    let key = hello.enroll().key;
    let (started_tx, started) = mpsc::channel();
    let (release, release_rx) = mpsc::channel();
    *hello.platform.held.lock().unwrap() = Some((started_tx, release_rx));
    std::thread::scope(|scope| {
      let first = scope.spawn(|| hello.unlock());
      started.recv().unwrap();
      // The button, clicked with the prompt behind Girovo: no second prompt, now or later.
      assert_eq!(hello.unlock(), Answer::just("busy"));
      assert_eq!(hello.platform.raises.load(Ordering::SeqCst), 1);
      release.send(()).unwrap();
      assert_eq!(first.join().unwrap().key, key);
    });
    // Answered, canceled or not: the next unlock asks again.
    hello.platform.queue(Ok(Outcome::Status("UserCanceled")));
    assert_eq!(hello.unlock(), Answer::just("canceled"));
    assert_eq!(hello.unlock().key, key);
    assert_eq!(hello.platform.raises.load(Ordering::SeqCst), 1);
  }

  #[test]
  fn a_key_that_signs_differently_each_time_is_never_used() {
    let mut fake = Fake::new(true);
    fake.random_signatures = true;
    let hello = rig(fake);
    assert_eq!(hello.enroll(), Answer::failed(None));
    assert!(hello.read_state().is_none());
    assert!(hello.platform.keys.lock().unwrap().is_empty());
  }

  #[test]
  fn canceled_at_the_prompt_changes_nothing() {
    let hello = rig(Fake::new(true));
    hello.platform.queue(Ok(Outcome::Status("UserCanceled")));
    assert_eq!(hello.enroll(), Answer::just("canceled"));
    assert!(hello.read_state().is_none());
    let key = hello.enroll().key;
    hello.platform.queue(Ok(Outcome::Status("UserPrefersPassword")));
    assert_eq!(hello.unlock(), Answer::just("canceled"));
    assert_eq!(hello.unlock().key, key);
  }

  #[test]
  fn a_lost_or_replaced_key_is_invalidated_at_unlock() {
    let hello = rig(Fake::new(true));
    hello.enroll();
    hello.platform.keys.lock().unwrap().clear();
    assert_eq!(hello.unlock(), Answer::just("invalidated"));
    assert!(hello.read_state().is_none());
    hello.enroll();
    // Replaced by another copy of Girovo: it signs, but not as the kept public half says.
    let name = hello.read_state().unwrap().name;
    hello.platform.keys.lock().unwrap().insert(name, RsaKeyPair::generate(KeySize::Rsa2048).unwrap());
    assert_eq!(hello.unlock(), Answer::just("invalidated"));
    assert!(hello.read_state().is_none());
  }

  #[test]
  fn enroll_after_the_key_was_lost_makes_a_new_one_under_the_same_name() {
    let hello = rig(Fake::new(true));
    let first = hello.enroll().key;
    let name = hello.read_state().unwrap().name;
    hello.platform.keys.lock().unwrap().clear();
    let again = hello.enroll();
    assert_eq!((again.result, again.fresh), ("enrolled", Some(true)));
    assert_ne!(again.key, first);
    assert_eq!(hello.read_state().unwrap().name, name);
  }

  #[test]
  fn what_windows_threw_comes_back_with_its_code() {
    let hello = rig(Fake::new(true));
    // Windows Hello's key storage gone (NTE_NOT_FOUND): the create throws.
    hello.platform.queue(Err(threw("0x80090011")));
    assert_eq!(hello.enroll(), Answer::failed(Some("0x80090011".into())));
    assert!(hello.read_state().is_none());
    hello.platform.queue(Ok(Outcome::Status("SecurityDeviceLocked")));
    assert_eq!(hello.enroll(), Answer::failed(None));
    // An enrolled key whose signing throws: the code too, and the state stays.
    hello.enroll();
    hello.platform.queue(Err(threw("0x80090016")));
    assert_eq!(hello.unlock(), Answer::failed(Some("0x80090016".into())));
    hello.platform.queue(Err(threw("0x80090011")));
    assert_eq!(hello.enroll(), Answer::failed(Some("0x80090011".into())));
    assert!(hello.read_state().is_some());
    hello.platform.queue(Err(Threw::plain("gone")));
    assert_eq!(hello.unlock(), Answer::failed(None));
  }

  #[test]
  fn answers_serialise_like_electrons() {
    assert_eq!(serde_json::to_string(&Answer::just("missing")).unwrap(), r#"{"result":"missing"}"#);
    assert_eq!(serde_json::to_string(&Answer::failed(Some("0x80090011".into()))).unwrap(), r#"{"result":"failed","code":"0x80090011"}"#);
    let enrolled = Answer { key: Some("k".into()), fresh: Some(true), ..Answer::just("enrolled") };
    assert_eq!(serde_json::to_string(&enrolled).unwrap(), r#"{"result":"enrolled","key":"k","fresh":true}"#);
  }

  #[test]
  fn refuses_state_that_is_not_electrons() {
    let hello = rig(Fake::new(true));
    for bad in [
      r#"{"v":2,"name":"Girovo-c6d113257492","salt":"EORjgIA5dq0aenN85S9wP4EdRsV+fbfZj8dOe7GYdDM=","publicKey":"x"}"#,
      r#"{"v":1,"name":"Other-c6d113257492","salt":"EORjgIA5dq0aenN85S9wP4EdRsV+fbfZj8dOe7GYdDM=","publicKey":"x"}"#,
      r#"{"v":1,"name":"Girovo-c6d113257492","salt":"AAAA","publicKey":"x"}"#,
      r#"{"v":1,"name":"Girovo-c6d113257492","salt":"EORjgIA5dq0aenN85S9wP4EdRsV+fbfZj8dOe7GYdDM=","publicKey":""}"#,
      "not json",
    ] {
      fs::write(&hello.file, bad).unwrap();
      assert!(hello.read_state().is_none(), "{bad}");
    }
  }
}
