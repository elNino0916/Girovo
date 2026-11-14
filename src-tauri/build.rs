fn main() {
  // The app's version as package.json has it (tauri.conf.json's comes from
  // there too), for src/edition.rs: Girovo, Girovo Nightly or Girovo Next.
  println!("cargo:rerun-if-changed=../package.json");
  let pkg = std::fs::read_to_string("../package.json").expect("package.json");
  let version = pkg.split("\"version\"").nth(1).and_then(|rest| rest.split('"').nth(1)).unwrap_or("0.0.0").to_string();
  println!("cargo:rustc-env=GIROVO_VERSION={version}");
  // The icons the program, its windows and tray carry: scripts/dist-desktop.mjs
  // swaps in src-tauri/icons-nightly for a nightly and src-tauri/icons-next for
  // a Next build, and tauri-build doesn't watch them itself, so a build with the other set must recompile.
  println!("cargo:rerun-if-changed=icons");
  // girovo-update.exe (update-helper/, docs/updater-v2.md step 4): built here
  // so it is there before tauri-build looks for it (tauri.windows.conf.json
  // externalBin), into binaries/ under the name Tauri expects.
  // girovo-cert.exe (cert-helper/, docs/mt-media-code-signing.md) likewise:
  // the MT-Media certificate in and out of the machine's trust stores.
  // girovo-mcp (mcp-helper/, docs/girovo-api.md phase 3), on Windows and
  // Linux: the MCP server an AI assistant starts, a client of the Girovo API.
  let os = std::env::var("CARGO_CFG_TARGET_OS");
  if os.as_deref() == Ok("windows") {
    build_helper("update-helper", "girovo-update");
    build_helper("cert-helper", "girovo-cert");
  }
  if os.as_deref() == Ok("windows") || os.as_deref() == Ok("linux") {
    build_helper("mcp-helper", "girovo-mcp");
  }
  // Girovo's own manifest: Tauri's plus the supported Windows versions (windows-app-manifest.xml).
  let windows = tauri_build::WindowsAttributes::new().app_manifest(include_str!("windows-app-manifest.xml"));
  tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows)).expect("failed to run tauri-build");
}

/// Builds one of the small helper crates (update-helper/, cert-helper/,
/// mcp-helper/) in release (its own target folder, so this build's lock is not
/// in the way) and copies it to binaries/<exe>-<target>(.exe), the name Tauri expects.
fn build_helper(dir: &str, exe: &str) {
  for watched in ["src", "Cargo.toml", "app.manifest", "build.rs"] {
    println!("cargo:rerun-if-changed={dir}/{watched}");
  }
  if dir == "cert-helper" {
    println!("cargo:rerun-if-changed=cert-helper/MT-Media-CodeSigning.cer");
  }
  let root = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
  let helper = root.join(dir);
  let target = std::env::var("TARGET").unwrap();
  let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".into());
  let status = std::process::Command::new(cargo)
    .args(["build", "--release", "--target", &target, "--manifest-path"])
    .arg(helper.join("Cargo.toml"))
    .arg("--target-dir")
    .arg(helper.join("target"))
    // The outer build's flags are for the app, not for this.
    .env_remove("CARGO_ENCODED_RUSTFLAGS")
    .env_remove("RUSTFLAGS")
    .env_remove("CARGO_TARGET_DIR")
    .status()
    .unwrap_or_else(|e| panic!("cargo for {dir}: {e}"));
  assert!(status.success(), "{dir} did not build");
  let suffix = if target.contains("windows") { ".exe" } else { "" };
  let built = helper.join("target").join(&target).join("release").join(format!("{exe}{suffix}"));
  let out = root.join("binaries");
  std::fs::create_dir_all(&out).unwrap();
  let to = out.join(format!("{exe}-{target}{suffix}"));
  // Only when it changed: an unchanged copy keeps tauri-build from rebuilding the app.
  let same = std::fs::read(&built).ok() == std::fs::read(&to).ok();
  if !same {
    std::fs::copy(&built, &to).unwrap_or_else(|e| panic!("copy {exe}{suffix}: {e}"));
  }
}
