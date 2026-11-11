'use client';

// Girovo Next: whether the places that ask (the thread, Analyse's month recap,
// a booking's asking bar, the hint in a transfer) show at all. On Android that
// needs Gemini Nano v4 and, in the Play build, Plus; the desktop asks its own
// model. Switched off in Einstellungen (vault.askOff), none of them shows.

import { IS_ANDROID } from '@/lib/platform';
import { askAllowed } from '@/lib/plus';
import { useFints } from '../FintsProvider';
import { useAskable } from './Ask';

/** True when asking is on and possible here; false while that is unknown. */
export function useCanAsk(): boolean {
  const askable = useAskable();
  const { plus, vault } = useFints();
  if (vault?.askOff) return false;
  if (!askable) return false;
  return IS_ANDROID ? askAllowed(plus.state) : true;
}
