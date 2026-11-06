// Taking over the Electron shell's secret (migrate.rs, step "secret"): read
// linked-unlock.key the way Electron's safeStorage wrote it and keep it in
// the Tauri shell's own form. The port of the secret is being written apart
// (the shell secret with DPAPI and Electron's os_crypt format); until it is in,
// nothing is taken over, the old file stays, and the migration screen says to
// switch Windows Hello, the further banks and the background checks on again.

/// True once the secret is kept the Tauri shell's way.
pub fn take_over() -> bool {
  false
}
