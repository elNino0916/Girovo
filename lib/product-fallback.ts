// Girovo's own FinTS product ID, and the one before it while the banks learn it.
//
// A new registration reaches the banks' systems only after several working
// days, each institute on its own schedule (the DK's letter), and some banks
// still did not know Girovo's own ID when 5.15.4 sent it alone. Until a bank
// has it, its dialog opens with "9078 Banking-Programm ist nicht registriert"
// — before any approval. So a login tries the own ID and, on that answer
// only, once more with the previous one; the session keeps whichever the
// bank took.
//
// A Kundensystem-ID belongs to the product ID it was issued under: sent
// beside another, the bank refuses it (9391). A remembered device set up
// under the previous ID therefore asks the bank first whether it knows the
// own ID by now. Not yet: the device opens as it is, under the previous ID,
// with no approval. Yes: that login becomes a full one — the
// Sicherheitsverfahren and one approval — and the device is remembered
// afresh, under the own ID.

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
  console.log('[product] the bank does not know the own product ID yet (9078) — once more with the previous one');
  config.productId = fallback;
  return run();
}

type Remembered = { bankingInformation?: { systemId?: string | null } | null; productId?: string };

/**
 * What a login does with a remembered device:
 * - `restore`: open it as it is, under `productId` — the own ID it was set up with.
 * - `ask`: it was set up under the previous ID. Ask the bank with the own ID
 *   first; only where it answers 9078, open the device under `productId`.
 * - `fresh`: synchronise afresh — no real Kundensystem-ID, or one issued
 *   under an ID Girovo no longer sends.
 */
export type RestorePlan = { kind: 'restore' | 'ask'; productId: string } | { kind: 'fresh' };

/**
 * The plan for a remembered device. A profile that names no product ID dates
 * from before 5.15.2, when every one was made under the previous ID.
 */
export function restorePlan(profile: Remembered | null | undefined, current: string, fallback: string | null | undefined): RestorePlan {
  const systemId = profile?.bankingInformation?.systemId;
  if (!systemId || systemId === '0') return { kind: 'fresh' };
  const made = profile?.productId ?? fallback ?? undefined;
  if (made === current) return { kind: 'restore', productId: current };
  if (fallback && made === fallback) return { kind: 'ask', productId: fallback };
  return { kind: 'fresh' };
}
