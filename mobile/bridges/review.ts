// Google Play's rating card (In-App Review) for the page: the page says what
// just happened (components/android/review.ts), this keeps count on the phone
// and, after a good moment, asks Play through ReviewPlugin. lib/play-review.ts
// has the rule. The Google Play build only — the GitHub build has no Play
// library, and nothing is kept there — and only on a phone whose integrity
// check found nothing to warn about.

import { integrityWarning, keepsNothing } from '../../lib/device-integrity.ts';
import { asked, mayAsk, noted, readState, type GoodMoment, type ReviewMoment, type ReviewState } from '../../lib/play-review.ts';
import { GirovoDevice, GirovoReview } from '../native';
import { integrity } from './integrity';

const KEY = 'girovo.review';
/** The good moment's own screen first ("Überweisung ausgeführt", the new Umsätze), then Play's card. */
const ASK_DELAY_MS = 2000;
/** A transfer approved in the bank's app goes through while that app is in front: this long to come back. */
const BACK_MS = 60_000;

/** This version where Play may be asked here, null where it may not. Found once per start. */
let where: Promise<string | null> | null = null;
const askable = (): Promise<string | null> => (where ??= Promise.all([GirovoDevice.info().catch(() => null), integrity()]).then(
  ([info, i]) => (info?.flavor === 'play' && i && !integrityWarning(i) && !keepsNothing(i) ? info.versionName : null),
));

function load(now: number): ReviewState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // No storage: a fresh state, and a week of use counted from now.
  }
  return readState(raw, now);
}

function save(state: ReviewState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Kept nowhere: nothing is asked until it can be.
  }
}

/** Resolves true once the app is in front (at once if it is), false after `ms`. */
function inFront(ms: number): Promise<boolean> {
  if (document.visibilityState === 'visible') return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (front: boolean) => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', seen);
      resolve(front);
    };
    const seen = () => {
      if (document.visibilityState === 'visible') done(true);
    };
    const timer = setTimeout(() => done(false), ms);
    document.addEventListener('visibilitychange', seen);
  });
}

/** One request at a time: the next good moment waits for the last one's outcome. */
let asking = false;

async function ask(good: GoodMoment, version: string): Promise<void> {
  try {
    if (!(await inFront(BACK_MS))) return;
    await new Promise((r) => setTimeout(r, ASK_DELAY_MS));
    if (document.visibilityState !== 'visible' || !mayAsk(load(Date.now()), good, Date.now(), version)) return;
    const { result } = await GirovoReview.request().catch(() => ({ result: 'failed' as const }));
    // Play not reached (no Play account, no network): the next good moment tries again.
    if (result === 'done') save(asked(load(Date.now()), version));
  } finally {
    asking = false;
  }
}

/** At the start: the first start is when the week of use begins. */
export function startReview(): void {
  void askable().then((version) => {
    if (version) save(load(Date.now()));
  });
}

export function note(moment: ReviewMoment): void {
  void askable().then((version) => {
    if (!version) return;
    const now = Date.now();
    const state = noted(load(now), moment, now);
    save(state);
    if (moment !== 'refresh' && moment !== 'transfer') return;
    const good: GoodMoment = { kind: moment, at: now };
    if (asking || !mayAsk(state, good, now, version)) return;
    asking = true;
    void ask(good, version);
  });
}
