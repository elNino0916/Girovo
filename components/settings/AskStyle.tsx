'use client';

// Einstellungen → Girovo AI → Antworten (docs/plan-girovo-ai-style-and-name.md):
// the tone and the length as segmented buttons, the first name Girovo AI may
// call the user by, and an example that answers as the choices say, from the
// user's own bookings (components/insights/AskThread.tsx StyleExample).
// Each choice is kept in the vault only while it is not the default, and
// follows the user to their other devices (lib/sync-entries.ts).

import { useEffect, useState } from 'react';
import { cleanAskName, DEFAULT_LENGTH, DEFAULT_TONE, type AskLength, type AskTone } from '@/lib/ask-style';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { ExpandIcon, NoteIcon, PencilIcon, UserIcon } from '../icons';
import { StyleExample } from '../insights/AskThread';
import { useAskStyle, useSuggestedName } from '../insights/ask/useAskStyle';
import { Input, Segmented } from '../ui';
import { SegmentedItem, SettingItem, SettingsGroup, SwitchItem } from './rows';

export function AskStyleGroup() {
  const t = useT();
  const words = t.settings.ask.style;
  const { vault, updateVault } = useFints();
  const style = useAskStyle();
  const suggested = useSuggestedName();
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

  // The field keeps what is typed; the vault gets it once the field is left (or Enter), cleaned.
  const [draft, setDraft] = useState(vault?.askName ?? '');
  useEffect(() => setDraft(vault?.askName ?? ''), [vault?.askName]);
  const saveName = () => {
    const clean = cleanAskName(draft);
    setDraft(clean ?? '');
    if ((clean ?? '') === (vault?.askName ?? '')) return;
    updateVault((v) => {
      const next = { ...v };
      if (clean) next.askName = clean;
      else delete next.askName;
      return next;
    });
  };

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
      {nameOn && (
        <SettingItem
          icon={<PencilIcon />}
          title={words.nameLabel}
          below={(
            <div className="mt-2 flex flex-col gap-1.5">
              <Input
                value={draft}
                aria-label={words.nameLabel}
                placeholder={suggested || undefined}
                maxLength={30}
                autoComplete="given-name"
                spellCheck={false}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              />
              <span className="text-[14px] leading-5 text-ink-2">{suggested ? words.fromBank(suggested) : words.fromNobody}</span>
            </div>
          )}
        />
      )}
      <StyleExample style={style} />
    </SettingsGroup>
  );
}
