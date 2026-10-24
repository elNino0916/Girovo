// Girovo Plus (docs/plus-plan.md): a supporter subscription in the Google
// Play build only. It unlocks more than one bank, the month-end forecast and
// "Frag deine Umsätze";
// everything else — login, Umsätze, transfers, security, export — stays free.
// The GitHub APK, the desktop app and the design preview are open source and
// complete: there the status is 'free' and nothing is locked.
//
// Pure, so the tests run it on the desktop.

/**
 *   free         no Plus here: every feature is open (desktop, GitHub APK)
 *   active       Plus subscribed (or in its trial)
 *   inactive     Play build without Plus: the extras are locked
 *   unavailable  Play build on a phone without Google Play billing: locked,
 *                and the Plus screen points to the GitHub version
 */
export type PlusState = 'free' | 'active' | 'inactive' | 'unavailable';

export type PlusPlan = 'monthly' | 'yearly';

/** One way to subscribe, as Google Play offers it right now. */
export type PlusOffer = {
  plan: PlusPlan;
  /** Play's own price in the user's currency and language ("0,99 €"). */
  price: string;
  /** Days free before the first payment, when Play offers this user a trial. */
  trialDays: number | null;
};

/** The app icon a Plus subscriber chose. Back to 'standard' when Plus ends. */
export type PlusIcon = 'standard' | 'plus';

export type PlusStatus = {
  state: PlusState;
  /** The plan subscribed to, while active. */
  plan?: PlusPlan | null;
  offers?: PlusOffer[];
  icon?: PlusIcon;
  /**
   * Plus opened by the owner key on this installation (scripts/owner-key.mjs:
   * the developer's own phone), not by a purchase. Only ever true.
   */
  owner?: true;
};

/** Whether this state opens what Plus unlocks. */
export const unlocked = (state: PlusState | null | undefined): boolean => state !== 'inactive' && state !== 'unavailable';

/**
 * Whether a bank may be logged in to: the one the app opens with always;
 * the others with Plus (or wherever Plus does not apply).
 */
export const bankAllowed = (state: PlusState | null | undefined, primary: boolean): boolean => primary || unlocked(state);

/** Whether the month-end forecast shows its figure, or the Plus teaser instead. */
export const forecastAllowed = (state: PlusState | null | undefined): boolean => unlocked(state);

/** Whether "Frag deine Umsätze" takes questions, or the Plus teaser instead. */
export const askAllowed = (state: PlusState | null | undefined): boolean => unlocked(state);

/** Whether a booking can be split and its shares asked for (lib/bill-split.ts), or the Plus door instead. */
export const splitAllowed = (state: PlusState | null | undefined): boolean => unlocked(state);

/** Whether a savings account takes a Sparziel (lib/savings-goal.ts), or the Plus door instead. */
export const goalsAllowed = (state: PlusState | null | undefined): boolean => unlocked(state);

/** Whether the Plus icon may be chosen — only while Plus is active. */
export const iconChoosable = (state: PlusState | null | undefined): boolean => state === 'active';

/** How often the reminder may come back: once a week at most. */
export const REMINDER_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The weekly Plus reminder, given when it was last shown (or its clock
 * started) and now:
 *   none   not for this state — Plus active, not sold here, or can't be bought
 *   start  the first look without Plus: the clock starts, nothing is shown
 *   show   a week or more has passed: show it, and the clock starts again
 *   wait   not yet
 */
export function reminderDue(state: PlusState | null | undefined, last: number | null, now: number): 'none' | 'start' | 'show' | 'wait' {
  if (state !== 'inactive') return 'none';
  // Unset, unreadable, or in the future (a clock set back): start over.
  if (last == null || !Number.isFinite(last) || last > now) return 'start';
  return now - last >= REMINDER_EVERY_MS ? 'show' : 'wait';
}

/** "P3D" / "P1W" → days; Play names a trial's length in ISO 8601. Null for anything else. */
export function trialDaysOf(period: string | null | undefined): number | null {
  const m = /^P(\d+)([DW])$/.exec(String(period ?? ''));
  if (!m) return null;
  return +m[1] * (m[2] === 'W' ? 7 : 1);
}

/** The status the bridge answered, read safely: anything unknown is 'free' off Play and locked on it. */
export function readStatus(raw: unknown, playBuild: boolean): PlusStatus {
  const r = (raw ?? {}) as Record<string, unknown>;
  const states: PlusState[] = ['free', 'active', 'inactive', 'unavailable'];
  const state = states.includes(r.state as PlusState) ? (r.state as PlusState) : playBuild ? 'unavailable' : 'free';
  const offers = Array.isArray(r.offers)
    ? r.offers.flatMap((o): PlusOffer[] => {
      const x = o as Record<string, unknown>;
      const plan: PlusPlan | null = x.plan === 'monthly' || x.plan === 'yearly' ? x.plan : null;
      const price = typeof x.price === 'string' && x.price ? x.price : null;
      return plan && price ? [{ plan, price, trialDays: typeof x.trialDays === 'number' && x.trialDays > 0 ? x.trialDays : null }] : [];
    })
    : [];
  return {
    state,
    plan: r.plan === 'monthly' || r.plan === 'yearly' ? r.plan : null,
    offers: offers.sort((a, b) => (a.plan === b.plan ? 0 : a.plan === 'monthly' ? -1 : 1)),
    icon: r.icon === 'plus' && state === 'active' ? 'plus' : 'standard',
    ...(r.owner === true && state === 'active' ? { owner: true as const } : {}),
  };
}
