'use client';

// Einstellungen → Über Girovo → Update-Kanal: which releases the updater
// offers. Stabil and Nightly are the app's own; girovo.de can list more
// (docs/update-channels.md, components/updates/channels.ts).
// Only builds with an updater of their own have it — the desktop app
// (src-tauri/src/updater) and the GitHub APK (mobile/bridges/updates.ts).
// Google Play has its testing tracks and the F-Droid repository serves
// stable releases only: neither build has the bridge, so neither shows the
// row. The choice is kept per device, beside the automatic check.

import { useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useLocale, useT } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import { BoltIcon, FileIcon, SplitIcon } from '../icons';
import { PrivacyPolicyLink } from '../PrivacyPolicyLink';
import { Button, Dialog, cx } from '../ui';
import { setUsageConsent, usageCameWithChannel, useUsageConsent } from '../telemetry/usage';
import { channelHint, channelInfo, channelName, channelsOf, needsUsage } from '../updates/channels';
import { updates, useUpdates } from '../updates/store';
import { ActionItem, SwitchItem } from './rows';

export function UpdateChannelRow() {
  const t = useT();
  const { locale } = useLocale();
  const { state } = useUpdates();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<UpdateChannel>('stable');
  const usage = useUsageConsent();
  if (!state) return null;
  const c = t.settings.channel;
  // Nightly shares usage data, where this build can (components/telemetry/NightlyUsage.tsx).
  const withUsage = needsUsage(state, choice) && usage !== null;
  const nameOf = (id: UpdateChannel) => channelName(channelInfo(state, id), id, c, locale);
  const apply = () => {
    setOpen(false);
    void (async () => {
      // The dialog said so: the yes is set with the channel, and before it.
      // One given earlier by the switch stays the user's own.
      if (withUsage && usage !== 'on') await setUsageConsent(true, true);
      // The updater asks again in the new channel at once; its rows follow the state.
      if (choice !== state.channel) await updates.setChannel(choice);
      // To a channel without usage data ("Stabil"): a yes that came with Nightly ends with it.
      if (!needsUsage(state, choice) && usageCameWithChannel()) await setUsageConsent(false);
    })();
  };
  return (
    <>
      <ActionItem
        setting="channel"
        icon={<SplitIcon />}
        title={c.title}
        onClick={() => {
          setChoice(state.channel);
          setOpen(true);
        }}
        trailing={<span className="text-[14px] leading-snug text-ink-2">{nameOf(state.channel)}</span>}
      />
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={c.title}
        description={c.intro}
        actions={(
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
            <Button variant="primary" onClick={apply}>{c.apply}</Button>
          </>
        )}
      >
        <ChannelChoice channels={channelsOf(state)} value={choice} onChange={setChoice} />
        <p className="mt-4 text-[14px] leading-relaxed text-ink-2">{IS_ANDROID ? c.noteAndroid : c.note}</p>
        {/* One line (owner, 2026-11-10: the full text was a wall); what is shared is the policy's to say. */}
        {withUsage && <p data-channel-usage className="mt-2 text-[14px] leading-relaxed text-ink-2">{c.usage(nameOf(choice))} <PrivacyPolicyLink /></p>}
      </Dialog>
    </>
  );
}

/**
 * "Neueste Updates sofort erhalten", like Windows Update's "get the latest
 * updates as soon as they're available" (owner, 2026-11-07): a release offered
 * to part of the copies first (staged, docs/updater-v2.md) reaches this one at
 * once. Only with an updater that knows it.
 */
export function EarlyUpdatesRow() {
  const e = useT().settings.early;
  const { state } = useUpdates();
  if (!state || state.early === undefined) return null;
  return (
    <SwitchItem
      setting="early"
      icon={<BoltIcon />}
      title={e.title}
      summary={e.hint}
      checked={state.early}
      onChange={(on) => void updates.setEarly(on)}
    />
  );
}

/**
 * "Update aus Datei installieren …" (docs/updater-v2.md, step 5): a Setup.exe
 * downloaded by hand — an older version too — checked against Girovo's signed
 * releases before anything runs (components/updates/FileUpdateDialog.tsx).
 * The installed Windows app only: it is the one that installs a Setup.exe.
 */
export function FromFileRow() {
  const r = useT().settings.fromFile;
  const { state } = useUpdates();
  if (state?.kind !== 'nsis' || typeof window === 'undefined' || !window.electronUpdater?.chooseFile) return null;
  return (
    <ActionItem
      setting="fromFile"
      icon={<FileIcon />}
      title={r.title}
      summary={r.hint}
      onClick={() => void updates.chooseFile()}
    />
  );
}

/**
 * The channels as radios with one tab stop: the arrows move and choose at
 * once, as in the avatar picker (components/shell/ProfileMenu.tsx). The
 * chosen one takes the focus when the dialog opens.
 */
function ChannelChoice({ channels, value, onChange }: {
  channels: readonly UpdateChannelInfo[];
  value: UpdateChannel;
  onChange: (next: UpdateChannel) => void;
}) {
  const c = useT().settings.channel;
  const { locale } = useLocale();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const ids = channels.map((info) => info.id);
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (ids.indexOf(value) + step + ids.length) % ids.length;
    onChange(ids[next]);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={c.title} onKeyDown={onKeyDown} className="-mx-2 flex flex-col gap-1">
      {channels.map((info, i) => {
        const channel = info.id;
        const checked = channel === value;
        const hintId = `channel-${channel}-hint`;
        return (
          <button
            key={channel}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-describedby={hintId}
            tabIndex={checked ? 0 : -1}
            data-autofocus={checked ? '' : undefined}
            onClick={() => onChange(channel)}
            className={cx(
              'flex w-full items-start gap-4 rounded-[12px] px-3 py-3 text-left transition-colors duration-150',
              checked ? 'bg-accent-soft' : 'hover:bg-inset',
            )}
          >
            <span
              aria-hidden
              className={cx(
                'mt-px grid size-5 shrink-0 place-items-center rounded-full border-2',
                checked ? 'border-accent' : 'border-ink-2',
              )}
            >
              {checked && <span className="size-2.5 rounded-full bg-accent" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] leading-snug text-ink">{channelName(info, channel, c, locale)}</span>
              <span id={hintId} className="mt-0.5 block text-[13px] leading-snug text-ink-2">
                {channelHint(info, channel, c, locale)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
