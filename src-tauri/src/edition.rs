//! Which Girovo this build is, by the rule lib/edition.ts has: a version whose
//! pre-release part starts with "next." (7.0.0-next.<time>.g<commit>, the Next
//! channel's builds) is Girovo Next, with a violet plate; any other version
//! with a pre-release part (the nightlies, 6.0.0-nightly.<time>.g<commit>, the
//! bridge named preview.<time>, a preview, a development build) is Girovo
//! Nightly, with an amber one; a release is plain Girovo. The name goes into
//! the window titles, the tray and the start window, whose plate takes the
//! edition's colour. The version is package.json's, put here by build.rs
//! (tauri.conf.json takes its version from there too), so the install window,
//! which runs without the app's context, knows it as well. The app icon
//! follows at build time (scripts/dist-desktop.mjs swaps in
//! src-tauri/icons-nightly/ or src-tauri/icons-next/).

/// The app's version as package.json has it.
pub const VERSION: &str = env!("GIROVO_VERSION");

/// The three editions: Girovo, Girovo Nightly, Girovo Next.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Edition {
  Release,
  Nightly,
  Next,
}

impl Edition {
  /// The app's name in this edition.
  pub fn name(self) -> &'static str {
    match self {
      Edition::Release => "Girovo",
      Edition::Nightly => "Girovo Nightly",
      Edition::Next => "Girovo Next",
    }
  }

  /// The edition as the start and install windows' page reads it (shell/splash.html): "release", "nightly" or "next".
  pub fn id(self) -> &'static str {
    match self {
      Edition::Release => "release",
      Edition::Nightly => "nightly",
      Edition::Next => "next",
    }
  }
}

/// The edition of `version`: "7.0.0-next.…" Next, any other pre-release ("6.0.0-nightly.…") Nightly, "6.0.0" and "6.0.0+meta" a release.
pub fn edition_of(version: &str) -> Edition {
  let core = version.trim().trim_start_matches('v');
  let without_meta = core.split('+').next().unwrap_or("");
  match without_meta.split_once('-') {
    None => Edition::Release,
    Some((_, pre)) if pre.starts_with("next.") => Edition::Next,
    Some(_) => Edition::Nightly,
  }
}

/// This build's edition.
pub fn edition() -> Edition {
  edition_of(VERSION)
}

/// The app's name as this build shows it.
pub fn name() -> &'static str {
  edition().name()
}

fn named_as(edition: Edition, text: &str) -> String {
  match edition {
    Edition::Release => text.to_string(),
    _ => text.replacen("Girovo", edition.name(), 1),
  }
}

/// `text` with its first "Girovo" as this build's name: "Girovo wird gestartet" → "Girovo Nightly wird gestartet".
pub fn named(text: &str) -> String {
  named_as(edition(), text)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn a_next_pre_release_is_next_every_other_pre_release_a_nightly_and_a_release_neither() {
    assert_eq!(edition_of("6.0.0"), Edition::Release);
    assert_eq!(edition_of("v6.0.1"), Edition::Release);
    assert_eq!(edition_of("6.0.0+build.5"), Edition::Release);
    assert_eq!(edition_of(""), Edition::Release);
    assert_eq!(edition_of("6.0.0-nightly.202611071230.gef82cf6"), Edition::Nightly);
    assert_eq!(edition_of("6.0.0-preview.202611071208.gef82cf6"), Edition::Nightly);
    assert_eq!(edition_of("6.0.0-preview.1"), Edition::Nightly);
    assert_eq!(edition_of("6.0.0-dev.57"), Edition::Nightly);
    assert_eq!(edition_of("7.0.0-next.202611111200.gabcdef0"), Edition::Next);
    assert_eq!(edition_of(" v7.0.0-next.202611111200.gabcdef0+meta "), Edition::Next);
    assert_eq!(edition_of("7.0.0-nextgen.1"), Edition::Nightly, "only the word next and its dot");
    assert_eq!(edition_of("7.0.0-dev.3-next.1"), Edition::Nightly, "next only at the start of the pre-release");
    assert_eq!(edition_of("7.0.0+next.1"), Edition::Release, "build metadata is no pre-release");
  }

  #[test]
  fn each_edition_has_its_name() {
    assert_eq!(Edition::Release.name(), "Girovo");
    assert_eq!(Edition::Nightly.name(), "Girovo Nightly");
    assert_eq!(Edition::Next.name(), "Girovo Next");
    assert_eq!([Edition::Release.id(), Edition::Nightly.id(), Edition::Next.id()], ["release", "nightly", "next"]);
  }

  #[test]
  fn the_name_goes_into_the_first_girovo_only_on_a_pre_release() {
    assert_eq!(named_as(Edition::Nightly, "Girovo wird gestartet"), "Girovo Nightly wird gestartet");
    assert_eq!(named_as(Edition::Nightly, "Open Girovo"), "Open Girovo Nightly");
    assert_eq!(named_as(Edition::Nightly, "Girovo – Girovo"), "Girovo Nightly – Girovo");
    assert_eq!(named_as(Edition::Next, "Girovo wird gestartet"), "Girovo Next wird gestartet");
    assert_eq!(named_as(Edition::Next, "Girovo – Girovo"), "Girovo Next – Girovo");
    assert_eq!(named_as(Edition::Release, "Girovo öffnen"), "Girovo öffnen");
  }

  #[test]
  fn the_version_is_package_json_s() {
    let pkg = include_str!("../../package.json");
    assert!(pkg.contains(&format!("\"version\": \"{VERSION}\"")), "{VERSION}");
  }
}
