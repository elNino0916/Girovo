// The phone's integrity check (DeviceIntegrity.java), once per start: it
// makes a key in the secure hardware, which takes a moment on a StrongBox
// phone, and its answer does not change while the app runs.

import { integrityOf, type Integrity } from '../../lib/device-integrity.ts';
import { GirovoDevice } from '../native';

let once: Promise<Integrity | null> | null = null;

export function integrity(): Promise<Integrity | null> {
  once ??= GirovoDevice.integrity().then(integrityOf, () => null);
  return once;
}
