// The MT-Media code-signing certificate Girovo knows (docs/mt-media-code-signing.md):
// its public part, compiled in, and the checks every use of it goes through.
//
// Shared by girovo-cert.exe (this crate, which puts it into or takes it out
// of the machine's trust stores) and by the app (src-tauri/src/publisher_cert.rs,
// which only reads the stores), through `#[path]`. Nothing here ever reads a
// certificate from a file: the bytes below are the only ones either side
// will install, and they must pass `check` first.

#![allow(dead_code)]

/// The public certificate (DER). The private key never leaves the owner's machine
/// and GitHub's signing environment; it is in no repository and no build.
pub const CER: &[u8] = include_bytes!("../MT-Media-CodeSigning.cer");

/// SHA-1 of CER: the thumbprint Windows shows and finds it by.
pub const THUMBPRINT: [u8; 20] = [
  0x07, 0x99, 0x5B, 0x74, 0x08, 0xF1, 0x48, 0x20, 0x85, 0xF8, 0xDC, 0x23, 0x9D, 0xEC, 0x42, 0x94, 0xF0, 0xCA, 0xF1, 0x49,
];
pub const THUMBPRINT_HEX: &str = "07995B7408F1482085F8DC239DEC4294F0CAF149";
/// SHA-256 of CER, for the fingerprint the confirmation dialog shows.
pub const SHA256_HEX: &str = "0F12F14D595982FF1B017F860169A51EBD464CEAA60230E04192B7E2E0895AB5";

/// The subject as CertNameToStrW writes it (X.500, most specific first).
pub const SUBJECT: &str = "CN=MT-Media, O=MT-Media, OU=Software Development, L=Mömlingen, S=Bayern, C=DE";
/// The common name a certificate must carry to count as an MT-Media one (another
/// one in the stores is a "mismatch": an older or a foreign certificate).
pub const COMMON_NAME: &str = "MT-Media";
/// Code Signing, the one extended key usage it may have.
pub const CODE_SIGNING_OID: &str = "1.3.6.1.5.5.7.3.3";

/// Thumbprints of earlier MT-Media certificates this build may replace or
/// remove (renewal, docs/mt-media-code-signing.md). Only these and THUMBPRINT
/// are ever deleted from a store.
pub const EARLIER: &[[u8; 20]] = &[];

/// The stores the certificate goes into, both in the machine's part of the
/// registry: Root makes the chain end in a trusted root; TrustedPublisher
/// marks it a publisher Windows trusts without asking.
pub const STORES: [&str; 2] = ["Root", "TrustedPublisher"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
  /// Windows could not read the bytes as a certificate.
  Unreadable,
  Thumbprint,
  Subject,
  /// Not exactly Code Signing.
  Usage,
  /// A CA, or no basic constraints: it could vouch for other certificates.
  NotEndEntity,
}

#[cfg(windows)]
pub use win::*;

#[cfg(windows)]
mod win {
  use super::*;
  use std::ffi::c_void;
  use windows::Win32::Foundation::FILETIME;
  use windows::Win32::Security::Cryptography::*;
  use windows::core::PCSTR;

  /// A certificate context, freed when dropped.
  pub struct Cert(pub *mut CERT_CONTEXT);

  impl Drop for Cert {
    fn drop(&mut self) {
      if !self.0.is_null() {
        unsafe {
          let _ = CertFreeCertificateContext(Some(self.0));
        }
      }
    }
  }

  impl Cert {
    pub fn from_der(der: &[u8]) -> Option<Cert> {
      let ctx = unsafe { CertCreateCertificateContext(X509_ASN_ENCODING | PKCS_7_ASN_ENCODING, der) };
      if ctx.is_null() { None } else { Some(Cert(ctx)) }
    }

    pub fn ctx(&self) -> *const CERT_CONTEXT {
      self.0
    }

    pub fn thumbprint(&self) -> Option<[u8; 20]> {
      thumbprint_of(self.0)
    }

    pub fn subject(&self) -> String {
      subject_of(self.0)
    }

    /// The end of its validity, as a FILETIME's 100 ns ticks since 1601.
    pub fn not_after(&self) -> u64 {
      let ft = unsafe { (*(*self.0).pCertInfo).NotAfter };
      ((ft.dwHighDateTime as u64) << 32) | ft.dwLowDateTime as u64
    }

    /// -1 not yet valid, 0 valid, 1 expired (CertVerifyTimeValidity), now.
    pub fn time_validity(&self) -> i32 {
      unsafe { CertVerifyTimeValidity(None::<*const FILETIME>, (*self.0).pCertInfo) }
    }
  }

  pub fn thumbprint_of(ctx: *const CERT_CONTEXT) -> Option<[u8; 20]> {
    let mut out = [0u8; 20];
    let mut len = out.len() as u32;
    let ok = unsafe { CertGetCertificateContextProperty(ctx, CERT_SHA1_HASH_PROP_ID, Some(out.as_mut_ptr() as *mut c_void), &mut len) };
    (ok.is_ok() && len == 20).then_some(out)
  }

  pub fn subject_of(ctx: *const CERT_CONTEXT) -> String {
    unsafe {
      let name = &(*(*ctx).pCertInfo).Subject;
      let flags = CERT_STRING_TYPE(CERT_X500_NAME_STR.0 | CERT_NAME_STR_REVERSE_FLAG);
      let n = CertNameToStrW(X509_ASN_ENCODING, name, flags, None);
      if n <= 1 {
        return String::new();
      }
      let mut buf = vec![0u16; n as usize];
      let n = CertNameToStrW(X509_ASN_ENCODING, name, flags, Some(&mut buf));
      String::from_utf16_lossy(&buf[..(n as usize).saturating_sub(1)])
    }
  }

  /// The common name alone (CN), for spotting other MT-Media certificates.
  pub fn common_name_of(ctx: *const CERT_CONTEXT) -> String {
    unsafe {
      let n = CertGetNameStringW(ctx, CERT_NAME_ATTR_TYPE, 0, Some(szOID_COMMON_NAME.as_ptr() as *const c_void), None);
      if n <= 1 {
        return String::new();
      }
      let mut buf = vec![0u16; n as usize];
      let n = CertGetNameStringW(ctx, CERT_NAME_ATTR_TYPE, 0, Some(szOID_COMMON_NAME.as_ptr() as *const c_void), Some(&mut buf));
      String::from_utf16_lossy(&buf[..(n as usize).saturating_sub(1)])
    }
  }

  fn extension(ctx: *const CERT_CONTEXT, oid: PCSTR) -> Option<&'static CERT_EXTENSION> {
    unsafe {
      let info = &*(*ctx).pCertInfo;
      let all = std::slice::from_raw_parts(info.rgExtension, info.cExtension as usize);
      let found = CertFindExtension(oid, all);
      if found.is_null() { None } else { Some(&*found) }
    }
  }

  /// Decodes an extension's value into a buffer CryptDecodeObjectEx sized
  /// itself. The decoded struct sits at the buffer's start and points into
  /// the buffer, so it is read only while the buffer lives.
  fn decode(ext: &CERT_EXTENSION, kind: PCSTR) -> Option<Vec<u64>> {
    unsafe {
      let bytes = std::slice::from_raw_parts(ext.Value.pbData, ext.Value.cbData as usize);
      let mut len = 0u32;
      CryptDecodeObjectEx(X509_ASN_ENCODING, kind, bytes, 0, None, None, &mut len).ok()?;
      // u64 items: the struct holds pointers and must be aligned for them.
      let mut buf = vec![0u64; (len as usize).div_ceil(8)];
      CryptDecodeObjectEx(X509_ASN_ENCODING, kind, bytes, 0, None, Some(buf.as_mut_ptr() as *mut c_void), &mut len).ok()?;
      Some(buf)
    }
  }

  /// The extended key usages written into the certificate itself.
  pub fn usages_of(ctx: *const CERT_CONTEXT) -> Option<Vec<String>> {
    let ext = extension(ctx, szOID_ENHANCED_KEY_USAGE)?;
    let buf = decode(ext, X509_ENHANCED_KEY_USAGE)?;
    unsafe {
      let usage = &*(buf.as_ptr() as *const CTL_USAGE);
      let ids = std::slice::from_raw_parts(usage.rgpszUsageIdentifier, usage.cUsageIdentifier as usize);
      Some(ids.iter().map(|p| p.to_string().unwrap_or_default()).collect())
    }
  }

  /// Basic constraints say "end entity", not a CA.
  pub fn is_end_entity(ctx: *const CERT_CONTEXT) -> bool {
    let Some(ext) = extension(ctx, szOID_BASIC_CONSTRAINTS2) else { return false };
    let Some(buf) = decode(ext, X509_BASIC_CONSTRAINTS2) else { return false };
    let info = unsafe { &*(buf.as_ptr() as *const CERT_BASIC_CONSTRAINTS2_INFO) };
    !info.fCA.as_bool()
  }

  /// Is `der` exactly the MT-Media certificate this build knows?
  pub fn check(der: &[u8]) -> Result<Cert, Refusal> {
    let cert = Cert::from_der(der).ok_or(Refusal::Unreadable)?;
    if cert.thumbprint() != Some(THUMBPRINT) {
      return Err(Refusal::Thumbprint);
    }
    if cert.subject() != SUBJECT {
      return Err(Refusal::Subject);
    }
    if usages_of(cert.ctx()).as_deref() != Some(&[CODE_SIGNING_OID.to_string()][..]) {
      return Err(Refusal::Usage);
    }
    if !is_end_entity(cert.ctx()) {
      return Err(Refusal::NotEndEntity);
    }
    Ok(cert)
  }

  /// A system store of the local machine (`name`: Root, TrustedPublisher, Disallowed).
  pub struct Store(pub HCERTSTORE);

  impl Drop for Store {
    fn drop(&mut self) {
      unsafe {
        let _ = CertCloseStore(Some(self.0), 0);
      }
    }
  }

  impl Store {
    /// `write`: open for changes (needs an administrator); else read-only.
    pub fn machine(name: &str, write: bool) -> Option<Store> {
      Self::open(name, CERT_SYSTEM_STORE_LOCAL_MACHINE_ID << CERT_SYSTEM_STORE_LOCATION_SHIFT, write)
    }

    pub fn user(name: &str) -> Option<Store> {
      Self::open(name, CERT_SYSTEM_STORE_CURRENT_USER_ID << CERT_SYSTEM_STORE_LOCATION_SHIFT, false)
    }

    fn open(name: &str, location: u32, write: bool) -> Option<Store> {
      let wide: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
      let mut flags = location | CERT_STORE_OPEN_EXISTING_FLAG.0;
      if !write {
        flags |= CERT_STORE_READONLY_FLAG.0;
      }
      unsafe {
        CertOpenStore(CERT_STORE_PROV_SYSTEM_W, CERT_QUERY_ENCODING_TYPE(0), None, CERT_OPEN_STORE_FLAGS(flags), Some(wide.as_ptr() as *const c_void))
          .ok()
          .map(Store)
      }
    }

    /// The certificate with this SHA-1 thumbprint, if the store holds it.
    pub fn find(&self, thumbprint: &[u8; 20]) -> Option<Cert> {
      let blob = CRYPT_INTEGER_BLOB { cbData: 20, pbData: thumbprint.as_ptr() as *mut u8 };
      let ctx = unsafe {
        CertFindCertificateInStore(self.0, X509_ASN_ENCODING | PKCS_7_ASN_ENCODING, 0, CERT_FIND_SHA1_HASH, Some(&blob as *const _ as *const c_void), None)
      };
      if ctx.is_null() { None } else { Some(Cert(ctx)) }
    }

    /// Thumbprints of every certificate whose common name is MT-Media.
    pub fn mt_media(&self) -> Vec<[u8; 20]> {
      let mut found = Vec::new();
      let mut prev: Option<*const CERT_CONTEXT> = None;
      loop {
        let ctx = unsafe { CertEnumCertificatesInStore(self.0, prev) };
        if ctx.is_null() {
          break;
        }
        if common_name_of(ctx) == COMMON_NAME {
          if let Some(t) = thumbprint_of(ctx) {
            found.push(t);
          }
        }
        // CertEnumCertificatesInStore frees the previous context itself.
        prev = Some(ctx);
      }
      found
    }
  }

  pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02X}")).collect()
  }
}

#[cfg(all(test, windows))]
mod tests {
  use super::*;

  #[test]
  fn the_compiled_in_certificate_passes() {
    let cert = check(CER).expect("the bundled certificate passes its own checks");
    assert_eq!(hex(&cert.thumbprint().unwrap()), THUMBPRINT_HEX);
    assert!(is_end_entity(cert.ctx()));
    assert_eq!(common_name_of(cert.ctx()), COMMON_NAME);
  }

  #[test]
  fn the_sha256_constant_is_the_certificates() {
    use sha2::{Digest, Sha256};
    assert_eq!(hex(&Sha256::digest(CER)), SHA256_HEX);
  }

  #[test]
  fn a_changed_certificate_is_refused() {
    // One bit in the signature: still a readable certificate, another thumbprint.
    let mut der = CER.to_vec();
    let last = der.len() - 1;
    der[last] ^= 1;
    assert_eq!(check(&der).err(), Some(Refusal::Thumbprint));
    assert_eq!(check(b"not a certificate").err(), Some(Refusal::Unreadable));
  }
}
