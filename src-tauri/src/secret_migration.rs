// Taking over the Electron shell's secret (migrate.rs, step "secret"): read
// linked-unlock.key the way Electron's safeStorage wrote it and keep it in
// the Tauri shell's own form (secret.rs). The old file stays. When it fails,
// the migration screen says to switch Windows Hello, the further banks and the
// background checks on again.

use crate::secret::{Migration, migrate};

/// True once the secret is kept the Tauri shell's way, or when there was nothing to take over.
pub fn take_over() -> bool {
  match migrate() {
    Migration::Migrated | Migration::Done | Migration::Nothing => true,
    Migration::Failed { reason, detail } => {
      eprintln!("[shell-secret] Electron's secret not taken over: {reason} ({detail})");
      false
    }
  }
}
