// The handover to girovo-update.exe (src-tauri/update-helper, docs/updater-v2.md
// step 4): a small program without WebView2 that waits for this app to end,
// checks the installer against its signed hash once more, runs it and starts
// the new version. It ships beside Girovo.exe (tauri.windows.conf.json
// externalBin) and runs as a copy in the temp folder, since the installer
// replaces the installation it came from.
//
// Without it (a debug build, Linux, a file that went missing) the app starts
// the installer itself, with the install window, as before.

use std::path::{Path, PathBuf};

use super::engine::InstallPlan;

/// Its name beside Girovo.exe and in the temp folder.
pub const NAME: &str = "girovo-update.exe";

/// What the helper needs besides the plan.
pub struct Handover<'a> {
  pub plan: &'a InstallPlan,
  /// This process, which must have ended before the installer runs.
  pub pid: u32,
  /// The app being replaced, started again if the installer doesn't.
  pub app_exe: &'a Path,
  pub releases_url: &'a str,
  pub english: bool,
  pub name: &'a str,
}

/// The helper's arguments (update-helper/src/main.rs Plan::parse reads them);
/// None without the installer's signed hash, which the helper checks.
pub fn args(h: &Handover) -> Option<Vec<String>> {
  let sha256 = h.plan.sha256.clone().filter(|s| s.len() == 64)?;
  let mut a: Vec<String> = [
    ("--installer", h.plan.file.display().to_string()),
    ("--sha256", sha256),
    ("--version", h.plan.version.clone()),
    ("--wait-pid", h.pid.to_string()),
    ("--app-exe", h.app_exe.display().to_string()),
    ("--releases-url", h.releases_url.to_string()),
    ("--lang", if h.english { "en".into() } else { "de".into() }),
    ("--name", h.name.to_string()),
  ]
  .into_iter()
  .flat_map(|(k, v)| [k.to_string(), v])
  .collect();
  a.push("--".into());
  a.extend(h.plan.args.iter().cloned());
  Some(a)
}

/// The helper beside `app_exe`, copied to the temp folder: the copy to start.
pub fn stage(app_exe: &Path) -> std::io::Result<PathBuf> {
  let source = app_exe.parent().map(|d| d.join(NAME)).filter(|p| p.is_file());
  let Some(source) = source else { return Err(std::io::Error::new(std::io::ErrorKind::NotFound, "no girovo-update.exe beside the app")) };
  let dir = std::env::temp_dir().join("girovo-update");
  std::fs::create_dir_all(&dir)?;
  let copy = dir.join(NAME);
  std::fs::copy(&source, &copy)?;
  Ok(copy)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn plan(sha256: Option<&str>) -> InstallPlan {
    InstallPlan {
      file: PathBuf::from("C:\\Users\\me\\AppData\\Local\\sooskasse-fints-updater\\Girovo-6.0.3-Setup.exe"),
      args: vec!["/S".into(), "/UPDATE".into(), "/R".into(), "/ARGS".into(), "--updated".into(), "--force-run".into()],
      version: "6.0.3".into(),
      sha256: sha256.map(str::to_string),
    }
  }

  #[test]
  fn the_helper_gets_the_installer_its_hash_and_the_installers_arguments_last() {
    let p = plan(Some(&"ab".repeat(32)));
    let exe = PathBuf::from("C:\\Users\\me\\AppData\\Local\\Programs\\Girovo\\Girovo.exe");
    let a = args(&Handover { plan: &p, pid: 4711, app_exe: &exe, releases_url: "https://github.com/elNino0916/Girovo/releases", english: false, name: "Girovo" }).unwrap();
    let at = |k: &str| a.iter().position(|x| x == k).map(|i| a[i + 1].as_str());
    assert_eq!(at("--installer"), Some(p.file.to_str().unwrap()));
    assert_eq!(at("--sha256"), Some("ab".repeat(32).as_str()));
    assert_eq!(at("--wait-pid"), Some("4711"));
    assert_eq!(at("--lang"), Some("de"));
    let sep = a.iter().position(|x| x == "--").unwrap();
    assert_eq!(&a[sep + 1..], p.args.as_slice());
  }

  #[test]
  fn without_a_signed_hash_there_is_no_handover() {
    let exe = PathBuf::from("C:\\Girovo.exe");
    for p in [plan(None), plan(Some("short"))] {
      assert!(args(&Handover { plan: &p, pid: 1, app_exe: &exe, releases_url: "", english: true, name: "Girovo" }).is_none());
    }
  }

  #[test]
  fn no_helper_beside_the_app_no_copy() {
    assert!(stage(Path::new("C:\\nowhere\\Girovo.exe")).is_err());
  }
}
