// Fingerprint login seals only PINs the bank has taken (mobile/bridges/biometric.ts).
// A login opened on its remembered device has not been to the bank yet: its
// first balance or Umsätze answer comes a moment later (Session.pinAccepted),
// and a PIN sealed before then is one the bank may still refuse. So sealing
// waits for that answer a while. Only a checked copy settles a note that the
// bank refused that login's kept PIN (BiometricPlugin.java settleNotes); an
// unchecked one is dropped again at every lookup while the note stands.
//
// No Capacitor in here, so `node --test` runs it (sealing-wait.test.ts).

import type { LiveLogin } from '../server/logins';

/** How long turning it on and sealing a further bank wait for the bank's first answer, and how often they look. */
export const VERIFY_WAIT_MS = { enroll: 15_000, seal: 60_000, every: 1_000 };

/**
 * The logins of `sessionIds`, asked with `ask`, once every live one is
 * verified — or as they stand after `ms`. A session that ends meanwhile
 * (logged out) ends the wait.
 */
export async function loginsVerified(
  sessionIds: readonly string[],
  ms: number,
  ask: (ids: readonly string[]) => Promise<(LiveLogin | null)[]>,
  sleep: (ms: number) => Promise<void> = (t) => new Promise((resolve) => setTimeout(resolve, t)),
): Promise<(LiveLogin | null)[]> {
  let logins = await ask(sessionIds);
  for (let waited = 0; waited < ms; waited += VERIFY_WAIT_MS.every) {
    if (logins.every((l) => !l || l.verified)) return logins;
    await sleep(VERIFY_WAIT_MS.every);
    const next = await ask(sessionIds);
    if (next.some((l, i) => !l && logins[i])) return next;
    logins = next;
  }
  return logins;
}
