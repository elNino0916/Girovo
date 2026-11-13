'use client';

// Einstellungen → Girovo AI on the desktop (components/settings/AskSettings.tsx):
// the switch "Namen mit Girovo AI aufräumen" (vault.aiNamesOn), off unless
// switched on, usable once the model is downloaded and while Girovo AI is on,
// shown only where the shell has Gemma. While names are cleaned
// (components/insights/ai/useAiNames.ts), its line says how far.

import { useT } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import { useFints } from '../../FintsProvider';
import { TagIcon } from '../../icons';
import { SwitchItem } from '../../settings/rows';
import { useModelReady } from '../ask-gate';
import { useGemma } from '../gemma';
import { useAiNamesProgress } from './useAiNames';

export function AiNamesRow() {
  const words = useT().settings.aiNames;
  const { vault, updateVault } = useFints();
  const gemma = useGemma();
  const ready = useModelReady() === true;
  const off = !!vault?.askOff;
  const on = ready && !off && !!vault?.aiNamesOn;
  const progress = useAiNamesProgress();
  // Only where the shell has Gemma for this system, as the categorize row: elsewhere nothing would clean the names.
  if (IS_ANDROID || !gemma?.supported) return null;
  const setOn = (next: boolean) => updateVault((v) => {
    if (next) return v.aiNamesOn ? v : { ...v, aiNamesOn: true };
    if (!v.aiNamesOn) return v;
    const rest = { ...v };
    delete rest.aiNamesOn;
    return rest;
  });
  const summary = !ready
    ? words.needsModel
    : off ? words.isOff
      : on && progress?.total ? words.progress(progress.done, progress.total) : words.hint;
  return (
    <SwitchItem
      tone="ai"
      icon={<TagIcon />}
      checked={on}
      onChange={setOn}
      disabled={!ready || off}
      title={words.title}
      summary={summary}
    />
  );
}
