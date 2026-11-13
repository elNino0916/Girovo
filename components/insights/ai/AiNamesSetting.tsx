'use client';

// Einstellungen → Girovo AI on the desktop (components/settings/AskSettings.tsx):
// the switch "Namen mit Girovo AI aufräumen" (vault.aiNamesOn), off unless
// switched on, usable once the model is downloaded. While names are cleaned
// (components/insights/ai/useAiNames.ts), its line says how far.

import { useT } from '@/lib/i18n/react';
import { useFints } from '../../FintsProvider';
import { TagIcon } from '../../icons';
import { SwitchItem } from '../../settings/rows';
import { useModelReady } from '../ask-gate';
import { useAiNamesProgress } from './useAiNames';

export function AiNamesRow() {
  const words = useT().settings.aiNames;
  const { vault, updateVault } = useFints();
  const ready = useModelReady() === true;
  const on = ready && !!vault?.aiNamesOn;
  const progress = useAiNamesProgress();
  const setOn = (next: boolean) => updateVault((v) => {
    if (next) return v.aiNamesOn ? v : { ...v, aiNamesOn: true };
    if (!v.aiNamesOn) return v;
    const rest = { ...v };
    delete rest.aiNamesOn;
    return rest;
  });
  const summary = !ready
    ? words.needsModel
    : on && progress?.total ? words.progress(progress.done, progress.total) : words.hint;
  return (
    <SwitchItem
      tone="ai"
      icon={<TagIcon />}
      checked={on}
      onChange={setOn}
      disabled={!ready}
      title={words.title}
      summary={summary}
    />
  );
}
