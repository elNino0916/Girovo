//! Which Girovo this build is, by the rule lib/edition.ts has: a version with
//! a pre-release part (the nightlies, 6.0.0-nightly.<time>.g<commit>, the
//! bridge named preview.<time>, a preview, a development build) is Girovo
//! Nightly — that name in the window titles, the tray and the start window,
//! whose plate turns amber — and a release is plain Girovo. The version is
//! package.json's, put here by build.rs (tauri.conf.json takes its version
//! from there too), so the install window, which runs without the app's
//! context, knows it as well. The app icon follows at build time
//! (scripts/dist-desktop.mjs swaps in src-tauri/icons-nightly/).

/// The app's version as package.json has it.
pub const VERSION: &str = env!("GIROVO_VERSION");

const NIGHTLY_NAME: &str = "Girovo Nightly";

/// Whether `version` has a pre-release part ("6.0.0-nightly.…" yes, "6.0.0" and "6.0.0+meta" no).
pub fn is_nightly_version(version: &str) -> bool {
  let core = version.trim().trim_start_matches('v');
  core.split('+').next().unwrap_or("").contains('-')
}

/// This build is a Girovo Nightly.
pub fn nightly() -> bool {
  is_nightly_version(VERSION)
}

/// The app's name as this build shows it.
pub fn name() -> &'static str {
  if nightly() { NIGHTLY_NAME } else { "Girovo" }
}

fn named_as(nightly: bool, text: &str) -> String {
  if nightly { text.replacen("Girovo", NIGHTLY_NAME, 1) } else { text.to_string() }
}

/// `text` with its first "Girovo" as this build's name: "Girovo wird gestartet" → "Girovo Nightly wird gestartet".
pub fn named(text: &str) -> String {
  named_as(nightly(), text)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn every_pre_release_is_a_nightly_and_a_release_is_not() {
    assert!(!is_nightly_version("6.0.0"));
    assert!(!is_nightly_version("v6.0.1"));
    assert!(!is_nightly_version("6.0.0+build.5"));
    assert!(is_nightly_version("6.0.0-nightly.202611071230.gef82cf6"));
    assert!(is_nightly_version("6.0.0-preview.202611071208.gef82cf6"));
    assert!(is_nightly_version("6.0.0-preview.1"));
    assert!(is_nightly_version("6.0.0-dev.57"));
  }

  #[test]
  fn the_name_goes_into_the_first_girovo_only_on_a_nightly() {
    assert_eq!(named_as(true, "Girovo wird gestartet"), "Girovo Nightly wird gestartet");
    assert_eq!(named_as(true, "Open Girovo"), "Open Girovo Nightly");
    assert_eq!(named_as(true, "Girovo – Girovo"), "Girovo Nightly – Girovo");
    assert_eq!(named_as(false, "Girovo öffnen"), "Girovo öffnen");
  }

  #[test]
  fn the_version_is_package_json_s() {
    let pkg = include_str!("../../package.json");
    assert!(pkg.contains(&format!("\"version\": \"{VERSION}\"")), "{VERSION}");
  }
}
