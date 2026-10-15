// A touch of haptic feedback, in the Android app only: the system's own
// effects (DevicePlugin.haptic), so they follow the phone's touch-feedback
// setting. "confirm" when a transfer went through, "reject" when it did not,
// "threshold" when a pull has gone far enough to refresh.

import { IS_ANDROID } from '@/lib/platform';

export function haptic(kind: 'confirm' | 'reject' | 'threshold'): void {
  if (IS_ANDROID) window.girovoMobile?.haptic(kind);
}
