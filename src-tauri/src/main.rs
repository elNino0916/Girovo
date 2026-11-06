// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  // Started again from a copy, to stand in for the app while an update installs.
  if girovo_lib::install_window::requested() {
    girovo_lib::install_window::run();
    return;
  }
  girovo_lib::run();
}
