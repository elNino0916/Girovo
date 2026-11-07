fn main() {
  // The app's version as package.json has it (tauri.conf.json's comes from
  // there too), for src/edition.rs: Girovo or Girovo Nightly.
  println!("cargo:rerun-if-changed=../package.json");
  let pkg = std::fs::read_to_string("../package.json").expect("package.json");
  let version = pkg.split("\"version\"").nth(1).and_then(|rest| rest.split('"').nth(1)).unwrap_or("0.0.0").to_string();
  println!("cargo:rustc-env=GIROVO_VERSION={version}");
  // The icons the program, its windows and tray carry: scripts/dist-desktop.mjs
  // swaps in src-tauri/icons-nightly for a nightly, and tauri-build doesn't
  // watch them itself, so a build with the other set must recompile.
  println!("cargo:rerun-if-changed=icons");
  // Girovo's own manifest: Tauri's plus the supported Windows versions (windows-app-manifest.xml).
  let windows = tauri_build::WindowsAttributes::new().app_manifest(include_str!("windows-app-manifest.xml"));
  tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows)).expect("failed to run tauri-build");
}
