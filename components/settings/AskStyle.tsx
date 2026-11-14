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

export function AskStyleGroup() {
  const t = useT();
  const words = t.settings.ask.style;
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
      <SegmentedItem icon={<NoteIcon />} title={words.tone} setting="askTone" wide>
        <Segmented
          aria-label={words.tone}
          size="sm"
          value={style.tone}
          onChange={setTone}
          options={[{ value: 'friendly', label: words.friendly }, { value: 'plain', label: words.plain }]}
        />
      </SegmentedItem>
      <SegmentedItem icon={<ExpandIcon />} title={words.length} setting="askLength" wide>
        <Segmented
          aria-label={words.length}
          size="sm"
          value={style.length}
          onChange={setLength}
          options={[{ value: 'short', label: words.short }, { value: 'long', label: words.long }]}
        />
      </SegmentedItem>
      <SwitchItem
        icon={<UserIcon />}
        setting="askName"
        title={words.useName}
        summary={nameOn ? (style.name ? words.calls(style.name) : words.noName) : undefined}
        checked={nameOn}
        onChange={setNameOn}
      />
      <StyleExample style={style} />
    </SettingsGroup>
  );
}
