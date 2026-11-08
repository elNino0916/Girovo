// Security keys (FIDO2: a YubiKey, say) in place of typing the first login's
// PIN on Windows, beside Windows Hello (hello.rs) and through the same idea:
// a gesture brings about a key, and the server keeps the login's PIN under
// that key and the shell's secret (lib/security-key.ts).
//
// - A FIDO2 signature is different every time, so it cannot be turned into a
//   key the way Windows Hello's is. The key comes from the hmac-secret
//   extension instead (WebAuthn's PRF): the security key mixes a salt into a
//   secret that never leaves it and answers the same 32 bytes each time.
// - User verification is always required: the key's own PIN or fingerprint, as
//   Windows Hello asks for a gesture. hmac-secret answers differently with and
//   without it, so it can never be made optional later.
// - Nothing is kept here. A credential's id and the salt are not secret and
//   live beside the sealed PIN; the page hands them over. The credential itself
//   stays off the key's storage (not a resident key): any number of them fit.
// - Windows lets ordinary programs reach a security key only through its own
//   WebAuthn service, which also draws the dialogs. webauthn.dll is loaded when
//   first asked for, from System32, never linked: Windows versions without it
//   must still start Girovo, they only do without this.
//
// One request at a time: a second while the dialog is open answers 'busy'
// rather than queueing a dialog that would appear after the login.

use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use sha2::{Digest, Sha256};

const KEY_DOMAIN: &[u8] = b"girovo/security-key/key/v1";
const USER_DOMAIN: &[u8] = b"girovo/security-key/user/v1";
const SALT_BYTES: usize = 32;
const SECRET_BYTES: usize = 32;
/// lib/security-key.ts keeps at most five per login; a little room, no more.
const MAX_CREDENTIALS: usize = 8;
const CREDENTIAL_MAX_BYTES: usize = 1024;

/// What the page gets (lib/security-key-client.ts).
#[derive(serde::Serialize, Debug, Clone, PartialEq)]
pub struct Answer {
  result: &'static str,
  #[serde(skip_serializing_if = "Option::is_none")]
  credential: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  key: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  code: Option<String>,
}

impl Answer {
  fn just(result: &'static str) -> Self {
    Answer { result, credential: None, key: None, code: None }
  }

  fn with_key(result: &'static str, credential: &[u8], secret: &[u8]) -> Self {
    Answer { credential: Some(B64.encode(credential)), key: Some(key_of(secret)), ..Answer::just(result) }
  }
}

/// Why Windows did not answer with what was asked.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Failure {
  /// An HRESULT from webauthn.dll.
  Windows(u32),
  /// The key answered without hmac-secret: an older one, U2F only.
  NoSecret,
}

/// One assertion: which credential answered, and its hmac-secret output.
pub struct Asserted {
  credential: Vec<u8>,
  secret: Vec<u8>,
}

/// What Windows does here; WebAuthn is the real one, the tests bring their own.
pub trait Platform: Send + Sync {
  fn supported(&self) -> bool;
  /// A new credential on the key, not one of `exclude`: its id.
  fn make(&self, window: isize, user: &[u8], exclude: &[Vec<u8>]) -> Result<Vec<u8>, Failure>;
  /// The hmac-secret of `salt`, from whichever of `credentials` the key holds.
  fn assert(&self, window: isize, salt: &[u8], credentials: &[Vec<u8>]) -> Result<Asserted, Failure>;
}

fn key_of(secret: &[u8]) -> String {
  B64.encode(Sha256::new().chain_update(KEY_DOMAIN).chain_update(secret).finalize())
}

/// What an HRESULT means for the page. The numbers are webauthn.h's mapping to the W3C errors.
fn answer_for(failure: Failure) -> Answer {
  match failure {
    Failure::NoSecret => Answer::just("unsupported"),
    // NTE_EXISTS: this key is on the exclude list, so it is set up already.
    Failure::Windows(0x8009_000F) => Answer::just("exists"),
    // NTE_NOT_FOUND: the key holds none of the credentials asked for.
    Failure::Windows(0x8009_0011) => Answer::just("wrong"),
    // NTE_USER_CANCELLED, ERROR_CANCELLED, ERROR_TIMEOUT: the dialog closed or ran out.
    Failure::Windows(0x8009_0036 | 0x8007_04C7 | 0x8007_05B4) => Answer::just("canceled"),
    Failure::Windows(code) => Answer { code: Some(format!("0x{code:08X}")), ..Answer::just("failed") },
  }
}

fn parse_salt(salt: &str) -> Option<Vec<u8>> {
  B64.decode(salt).ok().filter(|s| s.len() == SALT_BYTES)
}

fn parse_credentials(list: &[String]) -> Option<Vec<Vec<u8>>> {
  if list.len() > MAX_CREDENTIALS {
    return None;
  }
  list.iter().map(|c| B64.decode(c).ok().filter(|b| !b.is_empty() && b.len() <= CREDENTIAL_MAX_BYTES)).collect()
}

/// Lowers the flag when it goes, however the request ended.
struct Lowers<'a>(&'a AtomicBool);

impl Drop for Lowers<'_> {
  fn drop(&mut self) {
    self.0.store(false, Ordering::SeqCst);
  }
}

pub struct SecurityKeys<P: Platform> {
  platform: P,
  asking: AtomicBool,
}

impl<P: Platform> SecurityKeys<P> {
  pub fn new(platform: P) -> Self {
    SecurityKeys { platform, asking: AtomicBool::new(false) }
  }

  pub fn available(&self) -> bool {
    self.platform.supported()
  }

  /// A new credential on the key in the reader, and the key it brings about.
  /// Two gestures: making the credential, then asking it for its secret.
  pub fn register(&self, window: isize, salt: &str, exclude: &[String]) -> Answer {
    if !self.platform.supported() {
      return Answer::just("unavailable");
    }
    if self.asking.swap(true, Ordering::SeqCst) {
      return Answer::just("busy");
    }
    let _lowers = Lowers(&self.asking);
    let (Some(salt), Some(exclude)) = (parse_salt(salt), parse_credentials(exclude)) else {
      return Answer::just("failed");
    };
    let user: [u8; 32] = Sha256::new().chain_update(USER_DOMAIN).chain_update(&salt).finalize().into();
    let credential = match self.platform.make(window, &user[..16], &exclude) {
      Ok(credential) => credential,
      Err(failure) => return answer_for(failure),
    };
    match self.platform.assert(window, &salt, std::slice::from_ref(&credential)) {
      Ok(asserted) if asserted.secret.len() == SECRET_BYTES => Answer::with_key("registered", &credential, &asserted.secret),
      Ok(_) => answer_for(Failure::NoSecret),
      Err(failure) => answer_for(failure),
    }
  }

  /// The key from whichever of `credentials` the security key holds.
  pub fn open(&self, window: isize, salt: &str, credentials: &[String]) -> Answer {
    if !self.platform.supported() {
      return Answer::just("unavailable");
    }
    if self.asking.swap(true, Ordering::SeqCst) {
      return Answer::just("busy");
    }
    let _lowers = Lowers(&self.asking);
    let (Some(salt), Some(credentials)) = (parse_salt(salt), parse_credentials(credentials).filter(|c| !c.is_empty())) else {
      return Answer::just("failed");
    };
    match self.platform.assert(window, &salt, &credentials) {
      Ok(asserted) if asserted.secret.len() == SECRET_BYTES => Answer::with_key("opened", &asserted.credential, &asserted.secret),
      Ok(_) => answer_for(Failure::NoSecret),
      Err(failure) => answer_for(failure),
    }
  }
}

// ---------------------------------------------------------------------------
// Windows

/// Windows' own WebAuthn service.
pub struct WebAuthn;

#[cfg(windows)]
impl Platform for WebAuthn {
  fn supported(&self) -> bool {
    winauthn::supported()
  }
  fn make(&self, window: isize, user: &[u8], exclude: &[Vec<u8>]) -> Result<Vec<u8>, Failure> {
    winauthn::make(window, user, exclude)
  }
  fn assert(&self, window: isize, salt: &[u8], credentials: &[Vec<u8>]) -> Result<Asserted, Failure> {
    winauthn::assert(window, salt, credentials)
  }
}

/// Elsewhere there is none: available() says false, and the page offers nothing.
#[cfg(not(windows))]
impl Platform for WebAuthn {
  fn supported(&self) -> bool {
    false
  }
  fn make(&self, _window: isize, _user: &[u8], _exclude: &[Vec<u8>]) -> Result<Vec<u8>, Failure> {
    Err(Failure::NoSecret)
  }
  fn assert(&self, _window: isize, _salt: &[u8], _credentials: &[Vec<u8>]) -> Result<Asserted, Failure> {
    Err(Failure::NoSecret)
  }
}

#[cfg(windows)]
mod winauthn {
  use std::ffi::c_void;
  use std::sync::OnceLock;

  use base64::Engine;
  use base64::engine::general_purpose::URL_SAFE_NO_PAD;
  use windows::Win32::Foundation::HWND;
  use windows::Win32::Networking::WindowsWebServices::*;
  use windows::Win32::System::LibraryLoader::{GetProcAddress, LOAD_LIBRARY_SEARCH_SYSTEM32, LoadLibraryExW};
  use windows::core::{BOOL, HRESULT, PCWSTR, s, w};

  use super::{Asserted, Failure};

  /// The relying party, as the dialog names it. Nothing on the web asks for it:
  /// the credentials are this app's, and the client data is never checked by anyone.
  const RP_ID: PCWSTR = w!("girovo.de");
  /// The gesture may take a moment, the key's PIN too.
  const TIMEOUT_MS: u32 = 120_000;
  /// The first version whose GetAssertion takes hmac-secret salts.
  const MIN_API: u32 = WEBAUTHN_API_VERSION_4;

  type Make = unsafe extern "system" fn(
    HWND,
    *const WEBAUTHN_RP_ENTITY_INFORMATION,
    *const WEBAUTHN_USER_ENTITY_INFORMATION,
    *const WEBAUTHN_COSE_CREDENTIAL_PARAMETERS,
    *const WEBAUTHN_CLIENT_DATA,
    *const WEBAUTHN_AUTHENTICATOR_MAKE_CREDENTIAL_OPTIONS,
    *mut *mut WEBAUTHN_CREDENTIAL_ATTESTATION,
  ) -> HRESULT;
  type Get = unsafe extern "system" fn(
    HWND,
    PCWSTR,
    *const WEBAUTHN_CLIENT_DATA,
    *const WEBAUTHN_AUTHENTICATOR_GET_ASSERTION_OPTIONS,
    *mut *mut WEBAUTHN_ASSERTION,
  ) -> HRESULT;

  struct Api {
    make: Make,
    get: Get,
    free_attestation: unsafe extern "system" fn(*const WEBAUTHN_CREDENTIAL_ATTESTATION),
    free_assertion: unsafe extern "system" fn(*const WEBAUTHN_ASSERTION),
  }

  /// webauthn.dll with a new enough version, loaded once; None where there is none.
  fn api() -> Option<&'static Api> {
    static API: OnceLock<Option<Api>> = OnceLock::new();
    API
      .get_or_init(|| {
        // SAFETY: the signatures are webauthn.h's, and the library stays loaded for the process.
        unsafe {
          let dll = LoadLibraryExW(w!("webauthn.dll"), None, LOAD_LIBRARY_SEARCH_SYSTEM32).ok()?;
          let version = GetProcAddress(dll, s!("WebAuthNGetApiVersionNumber"))?;
          let version: unsafe extern "system" fn() -> u32 = std::mem::transmute(version);
          if version() < MIN_API {
            return None;
          }
          Some(Api {
            make: std::mem::transmute::<_, Make>(GetProcAddress(dll, s!("WebAuthNAuthenticatorMakeCredential"))?),
            get: std::mem::transmute::<_, Get>(GetProcAddress(dll, s!("WebAuthNAuthenticatorGetAssertion"))?),
            free_attestation: std::mem::transmute(GetProcAddress(dll, s!("WebAuthNFreeCredentialAttestation"))?),
            free_assertion: std::mem::transmute(GetProcAddress(dll, s!("WebAuthNFreeAssertion"))?),
          })
        }
      })
      .as_ref()
  }

  pub fn supported() -> bool {
    api().is_some()
  }

  /// Client data as a browser would send it. Windows hashes it; nobody verifies it.
  fn client_json(kind: &str) -> Result<Vec<u8>, Failure> {
    let mut challenge = [0u8; 32];
    aws_lc_rs::rand::fill(&mut challenge).map_err(|_| Failure::Windows(0x8000_4005))?;
    let challenge = URL_SAFE_NO_PAD.encode(challenge);
    Ok(format!(r#"{{"type":"{kind}","challenge":"{challenge}","origin":"https://girovo.de","crossOrigin":false}}"#).into_bytes())
  }

  fn client_data(json: &mut [u8]) -> WEBAUTHN_CLIENT_DATA {
    WEBAUTHN_CLIENT_DATA {
      dwVersion: WEBAUTHN_CLIENT_DATA_CURRENT_VERSION,
      cbClientDataJSON: json.len() as u32,
      pbClientDataJSON: json.as_mut_ptr(),
      pwszHashAlgId: WEBAUTHN_HASH_ALGORITHM_SHA_256,
    }
  }

  fn failed(code: HRESULT) -> Failure {
    Failure::Windows(code.0 as u32)
  }

  pub fn make(window: isize, user: &[u8], exclude: &[Vec<u8>]) -> Result<Vec<u8>, Failure> {
    let api = api().ok_or(Failure::NoSecret)?;
    let mut json = client_json("webauthn.create")?;
    let client = client_data(&mut json);
    let rp = WEBAUTHN_RP_ENTITY_INFORMATION {
      dwVersion: WEBAUTHN_RP_ENTITY_INFORMATION_CURRENT_VERSION,
      pwszId: RP_ID,
      pwszName: w!("Girovo"),
      pwszIcon: PCWSTR::null(),
    };
    let mut user_id = user.to_vec();
    let user = WEBAUTHN_USER_ENTITY_INFORMATION {
      dwVersion: WEBAUTHN_USER_ENTITY_INFORMATION_CURRENT_VERSION,
      cbId: user_id.len() as u32,
      pbId: user_id.as_mut_ptr(),
      pwszName: w!("Girovo"),
      pwszIcon: PCWSTR::null(),
      pwszDisplayName: w!("Girovo"),
    };
    let mut parameter = WEBAUTHN_COSE_CREDENTIAL_PARAMETER {
      dwVersion: WEBAUTHN_COSE_CREDENTIAL_PARAMETER_CURRENT_VERSION,
      pwszCredentialType: WEBAUTHN_CREDENTIAL_TYPE_PUBLIC_KEY,
      lAlg: WEBAUTHN_COSE_ALGORITHM_ECDSA_P256_WITH_SHA256,
    };
    let parameters = WEBAUTHN_COSE_CREDENTIAL_PARAMETERS { cCredentialParameters: 1, pCredentialParameters: &mut parameter };

    let mut wanted = BOOL(1);
    let mut extension = WEBAUTHN_EXTENSION {
      pwszExtensionIdentifier: WEBAUTHN_EXTENSIONS_IDENTIFIER_HMAC_SECRET,
      cbExtension: size_of::<BOOL>() as u32,
      pvExtension: &mut wanted as *mut BOOL as *mut c_void,
    };

    let mut ids = exclude.to_vec();
    let mut excluded: Vec<WEBAUTHN_CREDENTIAL_EX> = ids
      .iter_mut()
      .map(|id| WEBAUTHN_CREDENTIAL_EX {
        dwVersion: WEBAUTHN_CREDENTIAL_EX_CURRENT_VERSION,
        cbId: id.len() as u32,
        pbId: id.as_mut_ptr(),
        pwszCredentialType: WEBAUTHN_CREDENTIAL_TYPE_PUBLIC_KEY,
        dwTransports: 0,
      })
      .collect();
    let mut pointers: Vec<*mut WEBAUTHN_CREDENTIAL_EX> = excluded.iter_mut().map(|e| e as *mut WEBAUTHN_CREDENTIAL_EX).collect();
    let mut list = WEBAUTHN_CREDENTIAL_LIST { cCredentials: pointers.len() as u32, ppCredentials: pointers.as_mut_ptr() };

    // SAFETY: all zeroes is valid for this plain C struct (null pointers, zero counts).
    let mut options: WEBAUTHN_AUTHENTICATOR_MAKE_CREDENTIAL_OPTIONS = unsafe { std::mem::zeroed() };
    options.dwVersion = WEBAUTHN_AUTHENTICATOR_MAKE_CREDENTIAL_OPTIONS_VERSION_3;
    options.dwTimeoutMilliseconds = TIMEOUT_MS;
    options.Extensions = WEBAUTHN_EXTENSIONS { cExtensions: 1, pExtensions: &mut extension };
    options.dwAuthenticatorAttachment = WEBAUTHN_AUTHENTICATOR_ATTACHMENT_CROSS_PLATFORM;
    options.bRequireResidentKey = BOOL(0);
    options.dwUserVerificationRequirement = WEBAUTHN_USER_VERIFICATION_REQUIREMENT_REQUIRED;
    options.dwAttestationConveyancePreference = WEBAUTHN_ATTESTATION_CONVEYANCE_PREFERENCE_NONE;
    if !exclude.is_empty() {
      options.pExcludeCredentialList = &mut list;
    }

    let mut made: *mut WEBAUTHN_CREDENTIAL_ATTESTATION = std::ptr::null_mut();
    // SAFETY: every pointer points at a local above, alive across this blocking call.
    let code = unsafe { (api.make)(HWND(window as *mut c_void), &rp, &user, &parameters, &client, &options, &mut made) };
    if code.is_err() {
      return Err(failed(code));
    }
    if made.is_null() {
      return Err(Failure::Windows(0x8000_4005));
    }
    // SAFETY: on success Windows hands back a valid attestation, freed once below.
    unsafe {
      let id = std::slice::from_raw_parts((*made).pbCredentialId, (*made).cbCredentialId as usize).to_vec();
      (api.free_attestation)(made);
      Ok(id)
    }
  }

  pub fn assert(window: isize, salt: &[u8], credentials: &[Vec<u8>]) -> Result<Asserted, Failure> {
    let api = api().ok_or(Failure::NoSecret)?;
    let mut json = client_json("webauthn.get")?;
    let client = client_data(&mut json);

    let mut salt = salt.to_vec();
    let mut first = WEBAUTHN_HMAC_SECRET_SALT { cbFirst: salt.len() as u32, pbFirst: salt.as_mut_ptr(), cbSecond: 0, pbSecond: std::ptr::null_mut() };
    let mut salts = WEBAUTHN_HMAC_SECRET_SALT_VALUES {
      pGlobalHmacSalt: &mut first,
      cCredWithHmacSecretSaltList: 0,
      pCredWithHmacSecretSaltList: std::ptr::null_mut(),
    };

    let mut ids = credentials.to_vec();
    let mut allowed: Vec<WEBAUTHN_CREDENTIAL> = ids
      .iter_mut()
      .map(|id| WEBAUTHN_CREDENTIAL {
        dwVersion: WEBAUTHN_CREDENTIAL_CURRENT_VERSION,
        cbId: id.len() as u32,
        pbId: id.as_mut_ptr(),
        pwszCredentialType: WEBAUTHN_CREDENTIAL_TYPE_PUBLIC_KEY,
      })
      .collect();

    // SAFETY: all zeroes is valid for this plain C struct (null pointers, zero counts).
    let mut options: WEBAUTHN_AUTHENTICATOR_GET_ASSERTION_OPTIONS = unsafe { std::mem::zeroed() };
    options.dwVersion = WEBAUTHN_AUTHENTICATOR_GET_ASSERTION_OPTIONS_VERSION_6;
    options.dwTimeoutMilliseconds = TIMEOUT_MS;
    options.CredentialList = WEBAUTHN_CREDENTIALS { cCredentials: allowed.len() as u32, pCredentials: allowed.as_mut_ptr() };
    options.dwAuthenticatorAttachment = WEBAUTHN_AUTHENTICATOR_ATTACHMENT_CROSS_PLATFORM;
    options.dwUserVerificationRequirement = WEBAUTHN_USER_VERIFICATION_REQUIREMENT_REQUIRED;
    options.pHmacSecretSaltValues = &mut salts;

    let mut got: *mut WEBAUTHN_ASSERTION = std::ptr::null_mut();
    // SAFETY: every pointer points at a local above, alive across this blocking call.
    let code = unsafe { (api.get)(HWND(window as *mut c_void), RP_ID, &client, &options, &mut got) };
    if code.is_err() {
      return Err(failed(code));
    }
    if got.is_null() {
      return Err(Failure::Windows(0x8000_4005));
    }
    // SAFETY: on success Windows hands back a valid assertion, freed once below.
    unsafe {
      let a = &*got;
      let credential = std::slice::from_raw_parts(a.Credential.pbId, a.Credential.cbId as usize).to_vec();
      let secret = if a.dwVersion >= WEBAUTHN_ASSERTION_VERSION_3 && !a.pHmacSecret.is_null() && !(*a.pHmacSecret).pbFirst.is_null() {
        std::slice::from_raw_parts((*a.pHmacSecret).pbFirst, (*a.pHmacSecret).cbFirst as usize).to_vec()
      } else {
        Vec::new()
      };
      (api.free_assertion)(got);
      Ok(Asserted { credential, secret })
    }
  }
}

// ---------------------------------------------------------------------------
// The page's bridge: window.electronSecurityKey (src/bridge.js)

fn keys() -> &'static SecurityKeys<WebAuthn> {
  static KEYS: OnceLock<SecurityKeys<WebAuthn>> = OnceLock::new();
  KEYS.get_or_init(|| SecurityKeys::new(WebAuthn))
}

/// The window Windows' dialog belongs to, so it opens in front of it.
#[cfg(windows)]
fn handle(window: &tauri::WebviewWindow) -> isize {
  window.hwnd().map(|h| h.0 as isize).unwrap_or(0)
}

#[cfg(not(windows))]
fn handle(_window: &tauri::WebviewWindow) -> isize {
  0
}

#[tauri::command]
pub async fn security_key_available() -> bool {
  tauri::async_runtime::spawn_blocking(|| keys().available()).await.unwrap_or(false)
}

#[tauri::command]
pub async fn security_key_register(window: tauri::WebviewWindow, salt: String, exclude: Vec<String>) -> Answer {
  let hwnd = handle(&window);
  tauri::async_runtime::spawn_blocking(move || keys().register(hwnd, &salt, &exclude)).await.unwrap_or_else(|_| Answer::just("failed"))
}

#[tauri::command]
pub async fn security_key_open(window: tauri::WebviewWindow, salt: String, credentials: Vec<String>) -> Answer {
  let hwnd = handle(&window);
  tauri::async_runtime::spawn_blocking(move || keys().open(hwnd, &salt, &credentials)).await.unwrap_or_else(|_| Answer::just("failed"))
}

#[cfg(test)]
mod tests {
  use std::collections::VecDeque;
  use std::sync::Mutex;
  use std::sync::atomic::AtomicUsize;
  use std::sync::mpsc;

  use super::*;

  /// A key that derives its secret from credential and salt, or answers what a test queued.
  #[derive(Default)]
  struct Fake {
    unsupported: bool,
    no_secret: bool,
    made: AtomicUsize,
    held_make: Mutex<VecDeque<Failure>>,
    held_assert: Mutex<VecDeque<Failure>>,
    /// The next assertion says it started, then waits to be let go: a dialog left open.
    pause: Mutex<Option<(mpsc::Sender<()>, mpsc::Receiver<()>)>>,
    seen_exclude: Mutex<Vec<Vec<u8>>>,
  }

  impl Platform for Fake {
    fn supported(&self) -> bool {
      !self.unsupported
    }
    fn make(&self, _window: isize, _user: &[u8], exclude: &[Vec<u8>]) -> Result<Vec<u8>, Failure> {
      *self.seen_exclude.lock().unwrap() = exclude.to_vec();
      if let Some(failure) = self.held_make.lock().unwrap().pop_front() {
        return Err(failure);
      }
      Ok(vec![self.made.fetch_add(1, Ordering::SeqCst) as u8 + 1; 16])
    }
    fn assert(&self, _window: isize, salt: &[u8], credentials: &[Vec<u8>]) -> Result<Asserted, Failure> {
      let held = self.pause.lock().unwrap().take();
      if let Some((started, release)) = held {
        started.send(()).unwrap();
        release.recv().unwrap();
      }
      if let Some(failure) = self.held_assert.lock().unwrap().pop_front() {
        return Err(failure);
      }
      let credential = credentials[0].clone();
      let secret = if self.no_secret { Vec::new() } else { Sha256::new().chain_update(&credential).chain_update(salt).finalize().to_vec() };
      Ok(Asserted { credential, secret })
    }
  }

  fn salt() -> String {
    B64.encode([7u8; 32])
  }

  fn keys_with(fake: Fake) -> SecurityKeys<Fake> {
    SecurityKeys::new(fake)
  }

  #[test]
  fn registering_and_opening_bring_the_same_key() {
    let k = keys_with(Fake::default());
    let made = k.register(1, &salt(), &[]);
    assert_eq!(made.result, "registered");
    assert_eq!(B64.decode(made.key.as_ref().unwrap()).unwrap().len(), 32);
    let opened = k.open(1, &salt(), &[made.credential.clone().unwrap()]);
    assert_eq!(opened.result, "opened");
    assert_eq!(opened.key, made.key);
    assert_eq!(opened.credential, made.credential);
  }

  #[test]
  fn another_salt_brings_another_key() {
    let k = keys_with(Fake::default());
    let made = k.register(1, &salt(), &[]);
    let other = k.open(1, &B64.encode([9u8; 32]), &[made.credential.clone().unwrap()]);
    assert_eq!(other.result, "opened");
    assert_ne!(other.key, made.key);
  }

  #[test]
  fn a_key_already_set_up_is_excluded_and_said() {
    let fake = Fake::default();
    fake.held_make.lock().unwrap().push_back(Failure::Windows(0x8009_000F));
    let k = keys_with(fake);
    let existing = B64.encode([3u8; 16]);
    assert_eq!(k.register(1, &salt(), &[existing]).result, "exists");
    assert_eq!(*k.platform.seen_exclude.lock().unwrap(), vec![vec![3u8; 16]]);
  }

  #[test]
  fn windows_errors_mean_what_the_page_needs() {
    for (code, result) in [(0x8009_0036, "canceled"), (0x8007_04C7, "canceled"), (0x8007_05B4, "canceled"), (0x8009_0011, "wrong")] {
      let fake = Fake::default();
      fake.held_assert.lock().unwrap().push_back(Failure::Windows(code));
      let k = keys_with(fake);
      assert_eq!(k.open(1, &salt(), &[B64.encode([1u8; 16])]).result, result, "{code:#x}");
    }
    let fake = Fake::default();
    fake.held_assert.lock().unwrap().push_back(Failure::Windows(0x8009_0030));
    let answer = keys_with(fake).open(1, &salt(), &[B64.encode([1u8; 16])]);
    assert_eq!((answer.result, answer.code.as_deref()), ("failed", Some("0x80090030")));
  }

  #[test]
  fn a_key_without_hmac_secret_is_unsupported() {
    let k = keys_with(Fake { no_secret: true, ..Fake::default() });
    assert_eq!(k.register(1, &salt(), &[]).result, "unsupported");
  }

  #[test]
  fn a_windows_without_it_offers_nothing() {
    let k = keys_with(Fake { unsupported: true, ..Fake::default() });
    assert!(!k.available());
    assert_eq!(k.open(1, &salt(), &[B64.encode([1u8; 16])]).result, "unavailable");
    assert_eq!(k.register(1, &salt(), &[]).result, "unavailable");
  }

  #[test]
  fn bad_input_is_refused_before_windows_is_asked() {
    let k = keys_with(Fake::default());
    assert_eq!(k.register(1, "not base64!", &[]).result, "failed");
    assert_eq!(k.register(1, &B64.encode([1u8; 8]), &[]).result, "failed", "a salt of the wrong length");
    assert_eq!(k.open(1, &salt(), &[]).result, "failed", "nothing to ask for");
    assert_eq!(k.open(1, &salt(), &vec![B64.encode([1u8; 8]); 9]).result, "failed", "too many");
    assert_eq!(k.open(1, &salt(), &[B64.encode(vec![1u8; 2000])]).result, "failed", "too long");
    assert_eq!(k.platform.made.load(Ordering::SeqCst), 0);
  }

  #[test]
  fn a_second_request_while_the_dialog_is_open_is_busy() {
    let k = keys_with(Fake::default());
    let made = k.register(1, &salt(), &[]);
    let credential = made.credential.clone().unwrap();
    let (started_tx, started) = mpsc::channel();
    let (release, release_rx) = mpsc::channel();
    *k.platform.pause.lock().unwrap() = Some((started_tx, release_rx));
    std::thread::scope(|scope| {
      let first = scope.spawn(|| k.open(1, &salt(), std::slice::from_ref(&credential)));
      started.recv().unwrap();
      assert_eq!(k.open(1, &salt(), std::slice::from_ref(&credential)).result, "busy");
      assert_eq!(k.register(1, &salt(), &[]).result, "busy");
      release.send(()).unwrap();
      assert_eq!(first.join().unwrap().result, "opened");
    });
    assert_eq!(k.open(1, &salt(), &[credential]).result, "opened", "free again afterwards");
  }

  #[test]
  fn answers_serialise_for_the_page() {
    assert_eq!(serde_json::to_string(&Answer::just("canceled")).unwrap(), r#"{"result":"canceled"}"#);
    let failed = answer_for(Failure::Windows(0x8009_0030));
    assert_eq!(serde_json::to_string(&failed).unwrap(), r#"{"result":"failed","code":"0x80090030"}"#);
  }
}
