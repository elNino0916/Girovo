// When the Google Play build asks Play for its rating card (In-App Review,
// mobile/bridges/review.ts and ReviewPlugin.java): only after a good moment,
// at most once per app version. Play decides whether the card shows at all,
// with a quota of its own on top, and never says whether it did. Girovo asks
// no question of its own before or around it ("Gefällt dir Girovo?"):
// Google's guidelines forbid that.
//
// A good moment is a bank read that landed, once there have been a few, or a
// transfer that just went through — on a phone Girovo has been used on for a
// week. Never right after something failed, nor while or right after the
// user had to approve something in their bank's app for a read.
//
// Pure, so the tests run it on the desktop.

/**
 * What the page reports (components/android/review.ts):
 *   refresh   a bank read of an account's Umsätze landed
 *   transfer  a transfer went through
 *   approval  an approval (TAN) is waited for
 *   trouble   something failed: an error, an approval that ran out or was
 *             refused, an order whose fate is unclear
 */
export type ReviewMoment = 'refresh' | 'transfer' | 'approval' | 'trouble';

/** The moments Play may be asked after. */
export type GoodMoment = { kind: 'refresh' | 'transfer'; at: number };

/** What is kept on the phone, in the WebView's storage. Times in epoch ms. */
export type ReviewState = {
  /** The first start of a Play build that kept this. */
  firstSeen: number;
  /** Bank reads that landed since Play was last asked. */
  refreshes: number;
  /** The version Play was last asked in. */
  askedIn: string | null;
  troubleAt: number | null;
  approvalAt: number | null;
};

/** Bank reads before one may be the moment. */
export const MIN_REFRESHES = 5;
/** Days of use before Play is asked. */
export const MIN_DAYS = 7;
/** How long after a failure, or an approval before a read, Play is not asked. */
export const CALM_MS = 10 * 60_000;

const DAY_MS = 86_400_000;

const time = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/** The kept state, or a fresh one from `now` when there is none (or it is unreadable). */
export function readState(raw: string | null, now: number): ReviewState {
  let v: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') v = parsed as Record<string, unknown>;
  } catch {
    // Unreadable: started afresh.
  }
  const seen = time(v.firstSeen);
  return {
    // Never in the future: a clock set back would otherwise hold it off for good.
    firstSeen: seen !== null && seen <= now ? seen : now,
    refreshes: typeof v.refreshes === 'number' && Number.isInteger(v.refreshes) && v.refreshes > 0 ? v.refreshes : 0,
    askedIn: typeof v.askedIn === 'string' && v.askedIn ? v.askedIn : null,
    troubleAt: time(v.troubleAt),
    approvalAt: time(v.approvalAt),
  };
}

/** The state after `moment`, at `now`. */
export function noted(state: ReviewState, moment: ReviewMoment, now: number): ReviewState {
  switch (moment) {
    case 'refresh': return { ...state, refreshes: state.refreshes + 1 };
    case 'approval': return { ...state, approvalAt: now };
    case 'trouble': return { ...state, troubleAt: now };
    default: return state;
  }
}

/**
 * Whether Play may be asked now, after the good moment `good`. Asked when
 * the moment is noted and again just before Play is asked (a moment later):
 * what happened in between counts too.
 */
export function mayAsk(state: ReviewState, good: GoodMoment, now: number, version: string): boolean {
  if (state.askedIn === version) return false;
  if (now - state.firstSeen < MIN_DAYS * DAY_MS) return false;
  // A failure, before the moment or since.
  if (state.troubleAt !== null && now - state.troubleAt < CALM_MS) return false;
  // Since the moment, an approval is under way: something else has begun.
  if (state.approvalAt !== null && state.approvalAt > good.at) return false;
  if (good.kind === 'transfer') return true;
  // A read the user had to approve in their bank's app, or one right after
  // another approval, is not the moment either.
  if (state.approvalAt !== null && good.at - state.approvalAt < CALM_MS) return false;
  return state.refreshes >= MIN_REFRESHES;
}

/** The state once Play was asked in `version`: the next version needs a few reads again. */
export function asked(state: ReviewState, version: string): ReviewState {
  return { ...state, askedIn: version, refreshes: 0 };
}
