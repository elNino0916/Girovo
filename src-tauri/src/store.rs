// The Microsoft Store's copy of Girovo (scripts/dist-store.mjs, docs/microsoft-store.md):
// the same program as the Setup.exe's, packaged as an MSIX. Windows runs it
// with a package identity, which is how it is told apart: the Store brings
// its updates, so the updater (updater/) asks nobody and the page shows none.

/// Whether this copy runs from an MSIX package, as the Microsoft Store installs it.
#[cfg(windows)]
pub fn installed_from_store() -> bool {
  use std::sync::OnceLock;
  static PACKAGED: OnceLock<bool> = OnceLock::new();
  *PACKAGED.get_or_init(|| {
    use windows::Win32::Storage::Packaging::Appx::GetCurrentPackageFullName;
    // Without a package Windows answers APPMODEL_ERROR_NO_PACKAGE; with one, a
    // buffer of length 0 is too small (ERROR_INSUFFICIENT_BUFFER).
    const APPMODEL_ERROR_NO_PACKAGE: u32 = 15700;
    let mut len = 0u32;
    let answer = unsafe { GetCurrentPackageFullName(&mut len, None) };
    answer.0 != APPMODEL_ERROR_NO_PACKAGE
  })
}

/// Only Windows has the Store.
#[cfg(not(windows))]
pub fn installed_from_store() -> bool {
  false
}
