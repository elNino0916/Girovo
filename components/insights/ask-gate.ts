'use client';

// Girovo Next: whether the places that ask (the thread, Analyse's month recap,
// a booking's asking bar, the hint in a transfer) show at all. Girovo AI needs
// its model on the device: Gemini Nano v4 on Android (and, in the Play build,
// Plus), the downloaded model on the desktop. Until it is there, and when
// switched off in Einstellungen (vault.askOff), none of them shows.

import { IS_ANDROID } from '@/lib/platform';
import { askAllowed } from '@/lib/plus';
import { useFints } from '../FintsProvider';
import { useAskable } from './Ask';
import { useGemma } from './gemma';

/**
 * Whether the model that answers is on this device: Gemini Nano v4 on a phone,
 * the downloaded model on the desktop; undefined while that is unknown. The web
 * preview has no model to load and asks with the rules alone.
 */
export function useModelReady(): boolean | undefined {
  const askable = useAskable();
  const model = useGemma();
  if (IS_ANDROID) return askable;
  if (typeof window === 'undefined' || !window.electronGemma) return true;
  if (!model) return undefined;
  return model.supported && model.state === 'ready';
}

/** True when asking is on and possible here; false while that is unknown. */
export function useCanAsk(): boolean {
  const ready = useModelReady();
  const { plus, vault } = useFints();
  if (vault?.askOff) return false;
  if (!ready) return false;
  return IS_ANDROID ? askAllowed(plus.state) : true;
}
