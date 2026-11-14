'use client';

// Einstellungen → Girovo AI → Antworten (docs/plan-girovo-ai-style-and-name.md):
// the tone and the length as segmented buttons, whether Girovo AI calls the
// user by the first name their bank gives (no field to type one, owner
// 2026-11-15), and an example that answers as the choices say, from the
// user's own bookings (components/insights/AskThread.tsx StyleExample).
// Each choice is kept in the vault only while it is not the default, and
// follows the user to their other devices (lib/sync-entries.ts).

import { DEFAULT_LENGTH, DEFAULT_TONE, type AskLength, type AskTone } from '@/lib/ask-style';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { ExpandIcon, NoteIcon, UserIcon } from '../icons';
import { StyleExample } from '../insights/AskThread';
import { useAskStyle } from '../insights/ask/useAskStyle';
import { Segmented } from '../ui';
import { SegmentedItem, SettingsGroup, SwitchItem } from './rows';

/** `off`: Girovo AI is switched off (or can't answer yet): the choices dim and wait, as the Funktionen rows do. */
export function AskStyleGroup({ off = false }: { off?: boolean }) {
  const t = useT();
  const words = t.settings.ask.style;
  const isOff = off ? t.settings.aiCategorize.isOff : undefined;
  const { vault, updateVault } = useFints();
  const style = useAskStyle();
  const nameOn = !vault?.askNameOff;

  const setTone = (tone: AskTone) => updateVault((v) => {
    const next = { ...v };
    if (tone === DEFAULT_TONE) delete next.askTone;
    else next.askTone = tone;
    return next;
  });
  const setLength = (length: AskLength) => updateVault((v) => {
    const next = { ...v };
    if (length === DEFAULT_LENGTH) delete next.askLength;
    else next.askLength = length;
    return next;
  });
  const setNameOn = (on: boolean) => updateVault((v) => {
    const next = { ...v };
    if (on) delete next.askNameOff;
    else next.askNameOff = true;
    return next;
  });

  return (
    <SettingsGroup title={words.group}>
      <SegmentedItem icon={<NoteIcon />} title={words.tone} summary={isOff} setting="askTone" wide disabled={off}>
        <Segmented
          aria-label={words.tone}
          size="sm"
          value={style.tone}
          onChange={setTone}
          options={[{ value: 'friendly', label: words.friendly, disabled: off }, { value: 'plain', label: words.plain, disabled: off }]}
        />
      </SegmentedItem>
      <SegmentedItem icon={<ExpandIcon />} title={words.length} summary={isOff} setting="askLength" wide disabled={off}>
        <Segmented
          aria-label={words.length}
          size="sm"
          value={style.length}
          onChange={setLength}
          options={[{ value: 'short', label: words.short, disabled: off }, { value: 'long', label: words.long, disabled: off }]}
        />
      </SegmentedItem>
      <SwitchItem
        icon={<UserIcon />}
        setting="askName"
        title={words.useName}
        summary={off ? isOff : nameOn ? (style.name ? words.calls(style.name) : words.noName) : undefined}
        checked={nameOn}
        onChange={setNameOn}
        disabled={off}
      />
      {/* An example of answers that won't come while it is off would only confuse. */}
      {!off && <StyleExample style={style} />}
    </SettingsGroup>
  );
}
