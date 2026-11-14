fn main() {
  // app.manifest, embedded: requireAdministrator, so UAC asks before it
  // starts. Handed to the linker as a file, as update-helper does.
  println!("cargo:rerun-if-changed=app.manifest");
  if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
    let manifest = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("app.manifest");
    println!("cargo:rustc-link-arg-bins=/MANIFEST:EMBED");
    // Our trustInfo only: the linker would add its own asInvoker beside it.
    println!("cargo:rustc-link-arg-bins=/MANIFESTUAC:NO");
    println!("cargo:rustc-link-arg-bins=/MANIFESTINPUT:{}", manifest.display());
  }
}
