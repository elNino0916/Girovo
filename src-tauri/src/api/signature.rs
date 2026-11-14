// A program's Authenticode signature (Windows), for the Girovo API's dialog:
// who published it, and whether Windows trusts that. WinVerifyTrust checks
// the file's embedded signature; a program without one (much of Windows
// itself) is looked up in the system's catalogs, as Explorer's "Digital
// Signatures" and UAC do.
//
// Revocation is asked of the whole chain, but only from what Windows has
// cached (WTD_CACHE_ONLY_URL_RETRIEVAL): a dialog must not wait on a
// certificate authority's server. A revocation Windows knows of makes the
// publisher unknown; one it can't look up offline counts as not revoked, as
// Windows itself treats it when offline.

use std::ffi::c_void;
use std::path::Path;

use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, INVALID_HANDLE_VALUE};
use windows::Win32::Security::Cryptography::Catalog::{
  CATALOG_INFO, CryptCATAdminAcquireContext2, CryptCATAdminCalcHashFromFileHandle2, CryptCATAdminEnumCatalogFromHash,
  CryptCATAdminReleaseCatalogContext, CryptCATAdminReleaseContext, CryptCATCatalogInfoFromContext,
};
use windows::Win32::Security::Cryptography::{
  CERT_CONTEXT, CERT_NAME_ATTR_TYPE, CERT_NAME_SIMPLE_DISPLAY_TYPE, CRYPT_ATTRIBUTE, CertGetNameStringW, CryptDecodeObjectEx,
  PKCS_7_ASN_ENCODING, X509_ASN_ENCODING, szOID_ORGANIZATION_NAME,
};
use windows::Win32::Security::WinTrust::*;
use windows::Win32::Storage::FileSystem::{
  CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_GENERIC_READ, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, GetFileVersionInfoSizeW,
  GetFileVersionInfoW, OPEN_EXISTING, VerQueryValueW,
};
use windows::core::{GUID, PCWSTR, w};

use super::identify::{Kind, Publisher};
use crate::publisher_cert::identity;

// WinVerifyTrust's answers that matter here (winerror.h).
const S_OK: i32 = 0;
const TRUST_E_NOSIGNATURE: i32 = 0x800B_0100_u32 as i32;
const TRUST_E_SUBJECT_FORM_UNKNOWN: i32 = 0x800B_0003_u32 as i32;
const CERT_E_UNTRUSTEDROOT: i32 = 0x800B_0109_u32 as i32;
const CERT_E_CHAINING: i32 = 0x800B_010A_u32 as i32;
const CERT_E_REVOCATION_FAILURE: i32 = 0x800B_010E_u32 as i32;
const CRYPT_E_NO_REVOCATION_CHECK: i32 = 0x8009_2012_u32 as i32;
const CRYPT_E_REVOCATION_OFFLINE: i32 = 0x8009_2013_u32 as i32;

/// The signature passed every check, or every one but revocation that can't be looked up offline.
fn trusted(status: i32) -> bool {
  matches!(status, S_OK | CERT_E_REVOCATION_FAILURE | CRYPT_E_NO_REVOCATION_CHECK | CRYPT_E_REVOCATION_OFFLINE)
}

/// The signature itself is sound (the file is what was signed); only the
/// chain did not end in a root this machine trusts. That is how a file
/// signed with MT-Media's own certificate looks where it isn't installed.
fn sound(status: i32) -> bool {
  trusted(status) || matches!(status, CERT_E_UNTRUSTEDROOT | CERT_E_CHAINING)
}

/// The publisher's kind from WinVerifyTrust's answer and the signer's thumbprint.
/// MT-Media by its pinned thumbprint whatever the stores say, but never on
/// a broken digest, a revoked or an explicitly distrusted certificate.
pub(crate) fn classify(status: i32, thumbprint: Option<[u8; 20]>) -> Kind {
  if sound(status) && thumbprint == Some(identity::THUMBPRINT) {
    Kind::Mtmedia
  } else if trusted(status) && thumbprint.is_some() {
    Kind::Verified
  } else {
    Kind::Unknown
  }
}

/// What a check found out about the signer.
#[derive(Debug, Default)]
struct Signer {
  thumbprint: Option<[u8; 20]>,
  organisation: String,
  common_name: String,
  /// The program's name the signature carries (SpcSpOpusInfo), if any.
  program: Option<String>,
}

struct Outcome {
  status: i32,
  signer: Signer,
}

/// The publisher, and the name the dialog should use where the signature gives one.
pub fn publisher_and_name(exe: &Path) -> (Publisher, Option<String>) {
  let wide: Vec<u16> = exe.as_os_str().encode_wide_z();
  let outcome = match verify_file(&wide) {
    Some(o) if o.status == TRUST_E_NOSIGNATURE || o.status == TRUST_E_SUBJECT_FORM_UNKNOWN => verify_catalog(&wide).unwrap_or(o),
    Some(o) => o,
    None => return (Publisher::unknown(), file_description(&wide)),
  };
  let kind = classify(outcome.status, outcome.signer.thumbprint);
  let publisher = match kind {
    Kind::Unknown => Publisher::unknown(),
    _ => {
      let s = &outcome.signer;
      let name = [&s.organisation, &s.common_name].into_iter().find(|n| !n.trim().is_empty()).map(|n| n.trim().to_string());
      Publisher { kind, name, thumbprint: s.thumbprint.map(|t| identity::hex(&t)) }
    }
  };
  // The signature's program name only from a signature that holds; an
  // unknown publisher's file says what it likes about itself anyway.
  let program = if kind == Kind::Unknown { None } else { outcome.signer.program.clone() };
  let name = program.filter(|p| !p.trim().is_empty()).or_else(|| file_description(&wide));
  (publisher, name)
}

trait WideZ {
  fn encode_wide_z(&self) -> Vec<u16>;
}

impl WideZ for std::ffi::OsStr {
  fn encode_wide_z(&self) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    self.encode_wide().chain(Some(0)).collect()
  }
}

fn base_data() -> WINTRUST_DATA {
  WINTRUST_DATA {
    cbStruct: std::mem::size_of::<WINTRUST_DATA>() as u32,
    dwUIChoice: WTD_UI_NONE,
    fdwRevocationChecks: WTD_REVOKE_WHOLECHAIN,
    dwStateAction: WTD_STATEACTION_VERIFY,
    dwProvFlags: WTD_CACHE_ONLY_URL_RETRIEVAL | WTD_REVOCATION_CHECK_CHAIN_EXCLUDE_ROOT,
    ..Default::default()
  }
}

/// Runs WinVerifyTrust with `data` (state kept), reads the signer, closes the state.
fn run(data: &mut WINTRUST_DATA, read_program: bool) -> Outcome {
  let mut action: GUID = WINTRUST_ACTION_GENERIC_VERIFY_V2;
  // No window: INVALID_HANDLE_VALUE says there is no user to ask (and WTD_UI_NONE shows nothing).
  let no_window = HWND(INVALID_HANDLE_VALUE.0);
  let status = unsafe { WinVerifyTrust(no_window, &mut action, data as *mut WINTRUST_DATA as *mut c_void) };
  let signer = unsafe { signer_of(data.hWVTStateData, read_program) };
  data.dwStateAction = WTD_STATEACTION_CLOSE;
  unsafe {
    WinVerifyTrust(no_window, &mut action, data as *mut WINTRUST_DATA as *mut c_void);
  }
  Outcome { status, signer }
}

fn verify_file(path: &[u16]) -> Option<Outcome> {
  let mut file = WINTRUST_FILE_INFO {
    cbStruct: std::mem::size_of::<WINTRUST_FILE_INFO>() as u32,
    pcwszFilePath: PCWSTR(path.as_ptr()),
    ..Default::default()
  };
  let mut data = base_data();
  data.dwUnionChoice = WTD_CHOICE_FILE;
  data.Anonymous = WINTRUST_DATA_0 { pFile: &mut file };
  Some(run(&mut data, true))
}

struct File(HANDLE);
impl Drop for File {
  fn drop(&mut self) {
    unsafe {
      let _ = CloseHandle(self.0);
    }
  }
}

/// A file signed through a catalog: its hash looked up among the system's
/// catalogs (SHA-256 ones first, then the older SHA-1 ones), and the catalog's
/// signature checked for it.
fn verify_catalog(path: &[u16]) -> Option<Outcome> {
  let file = unsafe {
    CreateFileW(
      PCWSTR(path.as_ptr()),
      FILE_GENERIC_READ.0,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
      None,
      OPEN_EXISTING,
      FILE_ATTRIBUTE_NORMAL,
      None,
    )
    .ok()
    .map(File)?
  };
  for algorithm in [w!("SHA256"), PCWSTR::null()] {
    if let Some(outcome) = verify_in_catalogs(path, &file, algorithm) {
      return Some(outcome);
    }
  }
  None
}

fn verify_in_catalogs(path: &[u16], file: &File, algorithm: PCWSTR) -> Option<Outcome> {
  const DRIVER_ACTION_VERIFY: GUID = GUID::from_u128(0xf750e6c3_38ee_11d1_85e5_00c04fc295ee);
  let mut admin: isize = 0;
  unsafe { CryptCATAdminAcquireContext2(&mut admin, Some(&DRIVER_ACTION_VERIFY), algorithm, None, None).ok()? };
  let result = (|| {
    let mut len = 0u32;
    unsafe { CryptCATAdminCalcHashFromFileHandle2(admin, file.0, &mut len, None, None).ok()? };
    let mut hash = vec![0u8; len as usize];
    unsafe { CryptCATAdminCalcHashFromFileHandle2(admin, file.0, &mut len, Some(hash.as_mut_ptr()), None).ok()? };
    hash.truncate(len as usize);
    let catalog = unsafe { CryptCATAdminEnumCatalogFromHash(admin, &hash, None, None) };
    if catalog == 0 {
      return None;
    }
    let mut info = CATALOG_INFO { cbStruct: std::mem::size_of::<CATALOG_INFO>() as u32, ..Default::default() };
    let found = unsafe { CryptCATCatalogInfoFromContext(catalog, &mut info, 0) };
    let outcome = found.ok().map(|_| {
      // The member tag is the hash in hex, as the catalog lists it.
      let tag: Vec<u16> = identity::hex(&hash).encode_utf16().chain(Some(0)).collect();
      let mut member = WINTRUST_CATALOG_INFO {
        cbStruct: std::mem::size_of::<WINTRUST_CATALOG_INFO>() as u32,
        pcwszCatalogFilePath: PCWSTR(info.wszCatalogFile.as_ptr()),
        pcwszMemberTag: PCWSTR(tag.as_ptr()),
        pcwszMemberFilePath: PCWSTR(path.as_ptr()),
        hMemberFile: file.0,
        pbCalculatedFileHash: hash.as_mut_ptr(),
        cbCalculatedFileHash: hash.len() as u32,
        hCatAdmin: admin,
        ..Default::default()
      };
      let mut data = base_data();
      data.dwUnionChoice = WTD_CHOICE_CATALOG;
      data.Anonymous = WINTRUST_DATA_0 { pCatalog: &mut member };
      // The catalog's own program name would name the catalog, not this file.
      run(&mut data, false)
    });
    unsafe {
      let _ = CryptCATAdminReleaseCatalogContext(admin, catalog, 0);
    }
    outcome
  })();
  unsafe {
    let _ = CryptCATAdminReleaseContext(admin, 0);
  }
  result
}

/// The first signer and its certificate, from WinVerifyTrust's kept state.
/// Read even when the chain is not trusted: an MT-Media signature on a
/// machine without the certificate looks just like that.
unsafe fn signer_of(state: HANDLE, read_program: bool) -> Signer {
  unsafe {
    if state.is_invalid() || state.0.is_null() {
      return Signer::default();
    }
    let provider = WTHelperProvDataFromStateData(state);
    if provider.is_null() {
      return Signer::default();
    }
    let sgnr = WTHelperGetProvSignerFromChain(provider, 0, false, 0);
    if sgnr.is_null() {
      return Signer::default();
    }
    let cert = WTHelperGetProvCertFromChain(sgnr, 0);
    if cert.is_null() || (*cert).pCert.is_null() {
      return Signer::default();
    }
    let ctx = (*cert).pCert;
    let program = if read_program { program_of(&*sgnr) } else { None };
    Signer {
      thumbprint: identity::thumbprint_of(ctx),
      organisation: name_attr(ctx, szOID_ORGANIZATION_NAME),
      common_name: {
        let cn = identity::common_name_of(ctx);
        if cn.is_empty() { simple_name(ctx) } else { cn }
      },
      program,
    }
  }
}

unsafe fn name_attr(ctx: *const CERT_CONTEXT, oid: windows::core::PCSTR) -> String {
  unsafe {
    let n = CertGetNameStringW(ctx, CERT_NAME_ATTR_TYPE, 0, Some(oid.as_ptr() as *const c_void), None);
    if n <= 1 {
      return String::new();
    }
    let mut buf = vec![0u16; n as usize];
    let n = CertGetNameStringW(ctx, CERT_NAME_ATTR_TYPE, 0, Some(oid.as_ptr() as *const c_void), Some(&mut buf));
    String::from_utf16_lossy(&buf[..(n as usize).saturating_sub(1)])
  }
}

unsafe fn simple_name(ctx: *const CERT_CONTEXT) -> String {
  unsafe {
    let n = CertGetNameStringW(ctx, CERT_NAME_SIMPLE_DISPLAY_TYPE, 0, None, None);
    if n <= 1 {
      return String::new();
    }
    let mut buf = vec![0u16; n as usize];
    let n = CertGetNameStringW(ctx, CERT_NAME_SIMPLE_DISPLAY_TYPE, 0, None, Some(&mut buf));
    String::from_utf16_lossy(&buf[..(n as usize).saturating_sub(1)])
  }
}

/// The program name a signer put into the signature's authenticated
/// attributes (signtool /d): SpcSpOpusInfo's programName.
unsafe fn program_of(sgnr: &CRYPT_PROVIDER_SGNR) -> Option<String> {
  unsafe {
    if sgnr.psSigner.is_null() {
      return None;
    }
    let attrs = &(*sgnr.psSigner).AuthAttrs;
    if attrs.rgAttr.is_null() {
      return None;
    }
    let all: &[CRYPT_ATTRIBUTE] = std::slice::from_raw_parts(attrs.rgAttr, attrs.cAttr as usize);
    let wanted = SPC_SP_OPUS_INFO_OBJID.to_string().ok()?;
    let attr = all.iter().find(|a| a.pszObjId.to_string().ok().as_deref() == Some(wanted.as_str()))?;
    if attr.cValue == 0 || attr.rgValue.is_null() {
      return None;
    }
    let blob = &*attr.rgValue;
    let bytes = std::slice::from_raw_parts(blob.pbData, blob.cbData as usize);
    let encoding = X509_ASN_ENCODING | PKCS_7_ASN_ENCODING;
    let mut len = 0u32;
    CryptDecodeObjectEx(encoding, SPC_SP_OPUS_INFO_STRUCT, bytes, 0, None, None, &mut len).ok()?;
    // u64 items: the decoded struct holds pointers into the same buffer and must be aligned for them.
    let mut buf = vec![0u64; (len as usize).div_ceil(8)];
    CryptDecodeObjectEx(encoding, SPC_SP_OPUS_INFO_STRUCT, bytes, 0, None, Some(buf.as_mut_ptr() as *mut c_void), &mut len).ok()?;
    let opus = &*(buf.as_ptr() as *const SPC_SP_OPUS_INFO);
    if opus.pwszProgramName.is_null() {
      return None;
    }
    opus.pwszProgramName.to_string().ok()
  }
}

/// The FileDescription of the executable's version resource, in the first
/// language the file lists (then US English, then neutral).
pub fn file_description(path: &[u16]) -> Option<String> {
  unsafe {
    let size = GetFileVersionInfoSizeW(PCWSTR(path.as_ptr()), None);
    if size == 0 {
      return None;
    }
    let mut block = vec![0u8; size as usize];
    GetFileVersionInfoW(PCWSTR(path.as_ptr()), None, size, block.as_mut_ptr() as *mut c_void).ok()?;
    let query = |key: &str| -> Option<(*const u8, u32)> {
      let wide: Vec<u16> = key.encode_utf16().chain(Some(0)).collect();
      let mut ptr: *mut c_void = std::ptr::null_mut();
      let mut len = 0u32;
      let ok = VerQueryValueW(block.as_ptr() as *const c_void, PCWSTR(wide.as_ptr()), &mut ptr, &mut len).as_bool();
      (ok && !ptr.is_null() && len > 0).then_some((ptr as *const u8, len))
    };
    let mut languages: Vec<(u16, u16)> = Vec::new();
    if let Some((ptr, len)) = query("\\VarFileInfo\\Translation") {
      let pairs = std::slice::from_raw_parts(ptr as *const u16, (len as usize / 4) * 2);
      languages.extend(pairs.chunks_exact(2).map(|p| (p[0], p[1])));
    }
    languages.extend([(0x0409, 0x04B0), (0x0409, 0x04E4), (0x0000, 0x04B0)]);
    for (lang, codepage) in languages {
      // len counts characters, the closing NUL among them.
      if let Some((ptr, len)) = query(&format!("\\StringFileInfo\\{lang:04x}{codepage:04x}\\FileDescription")) {
        let chars = std::slice::from_raw_parts(ptr as *const u16, len as usize);
        let end = chars.iter().position(|&c| c == 0).unwrap_or(chars.len());
        let text = String::from_utf16_lossy(&chars[..end]);
        if !text.trim().is_empty() {
          return Some(text);
        }
      }
    }
    None
  }
}
