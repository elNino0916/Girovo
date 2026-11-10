// The name a login goes by behind the fingerprint (BiometricPlugin.java): a
// hash of BLZ and login name, like the device profile's file
// (lib/state-store.ts), so what is stored says nothing about whose it is.
//
// In a file of its own because two runtimes need the very same name: the
// page's bridge, which seals and opens the PINs (mobile/bridges/biometric.ts),
// and the background check (./entry.ts), which has no Capacitor and tells
// BackgroundJob.java by this name whose kept PIN the bank turned down.

import { createHash } from '../shims/crypto.ts';

export const fingerprintIdOf = (blz: string, userId: string): string =>
  createHash('sha256').update(`${blz}|${userId}|biometric`).digest('hex').slice(0, 32);
