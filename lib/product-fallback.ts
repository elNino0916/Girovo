// Girovo's own FinTS product ID, and the one before it while the banks learn it.
//
// A new registration reaches the banks' systems only after several working
// days, each institute on its own schedule (the DK's letter). Until a bank
// has it, its dialog opens with "9078 Banking-Programm ist nicht registriert"
// — before any approval — and 5.15.2, which sent the new ID alone, could not
// log in there. So a login tries the new ID and, on that answer only, once
// more with the previous one; the session then keeps whichever the bank took.
//
// A Kundensystem-ID belongs to the product ID it was issued under: sent
// beside another, the bank refuses it (9391). A remembered device therefore
// opens under the ID it was set up with, and is synchronised afresh — new ID
// first — when that ID is no longer one Girovo sends.

/** "Banking-Programm ist nicht registriert": the bank does not know the product ID (yet). */
export const UNREGISTERED = 9078;

/**
 * Runs `run` (a synchronisation) under the config's product ID and, where the
 * bank answers that it does not know it, once more under `fallback`. Never on
 * any other refusal — a wrong PIN stays a wrong PIN, sent once.
 */
export async function withProductFallback<T>(
  config: { productId: string },
  fallback: string | null | undefined,
  codesOf: (resp: T) => ReadonlySet<number>,
  run: () => Promise<T>,
): Promise<T> {
  const first = await run();
  if (!fallback || config.productId === fallback || !codesOf(first).has(UNREGISTERED)) return first;
  console.log('[product] the bank does not know the product ID yet (9078) — once more with the previous one');
  config.productId = fallback;
  return run();
}

type Remembered = { bankingInformation?: { systemId?: string | null } | null; productId?: string };

/**
 * The product ID a remembered device opens under, or null where it must be
 * synchronised afresh: one with a real Kundensystem-ID, under the ID it was
 * set up with as long as Girovo still sends that one. A profile that names
 * none dates from before 5.15.2, when every one was made under the previous ID.
 */
export function restoreProductId(profile: Remembered | null | undefined, current: string, fallback: string | null | undefined): string | null {
  const systemId = profile?.bankingInformation?.systemId;
  if (!systemId || systemId === '0') return null;
  const made = profile?.productId ?? fallback ?? undefined;
  return made && (made === current || made === fallback) ? made : null;
}
