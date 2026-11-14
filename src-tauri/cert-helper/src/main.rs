// girovo-cert.exe: see src/lib.rs. Its manifest (app.manifest) makes it run
// as administrator, so its tests live in the library, which runs without.

#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() {
  let args: Vec<String> = std::env::args().skip(1).collect();
  std::process::exit(girovo_cert::main_with(&args));
}
