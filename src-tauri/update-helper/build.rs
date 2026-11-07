fn main() {
  // app.manifest, embedded: Windows' own look for the controls (Common
  // Controls 6: the progress bar's marquee, themed buttons) and per-monitor
  // DPI. Handed to the linker as a file — its attributes have spaces.
  println!("cargo:rerun-if-changed=app.manifest");
  if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
    let manifest = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("app.manifest");
    println!("cargo:rustc-link-arg-bins=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg-bins=/MANIFESTINPUT:{}", manifest.display());
  }
}
