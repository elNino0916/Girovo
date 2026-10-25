// What just happened, for Google Play's rating card, in the Android app only:
// mobile/bridges/review.ts decides whether Play is asked (lib/play-review.ts
// has the rule), in the Google Play build. The page never asks anything itself.

import { IS_ANDROID } from '@/lib/platform';
import type { ReviewMoment } from '@/lib/play-review';

export function reviewMoment(moment: ReviewMoment): void {
  if (IS_ANDROID) window.girovoMobile?.review?.note(moment);
}
