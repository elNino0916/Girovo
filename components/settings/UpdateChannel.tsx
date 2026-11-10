'use client';

// Einstellungen → Über Girovo → Update-Kanal: whether the updater offers
// GitHub's pre-releases (the 6.0 previews) besides the finished versions.
// Only builds with an updater of their own have it — the desktop app
// (src-tauri/src/updater) and the GitHub APK (mobile/bridges/updates.ts).
// Google Play has its testing tracks and the F-Droid repository serves
// stable releases only: neither build has the bridge, so neither shows the
// row. The choice is kept per device, beside the automatic check.

import { useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useT } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import { BoltIcon, FileIcon, SplitIcon } from '../icons';
import { Button, Dialog, cx } from '../ui';
import { setUsageConsent, useUsageConsent } from '../telemetry/usage';
import { updates, useUpdates } from '../updates/store';
import { ActionItem, SwitchItem } from './rows';

const CHANNELS: readonly UpdateChannel[] = ['stable', 'preview'];

export function UpdateChannelRow() {
  const t = useT();
  const { state } = useUpdates();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<UpdateChannel>('stable');
  const usage = useUsageConsent();
  if (!state) return null;
  const c = t.settings.channel;
  // Nightly shares usage data, where this build can (components/telemetry/NightlyUsage.tsx).
  const withUsage = choice === 'preview' && usage !== null;
  const apply = () => {
    setOpen(false);
    void (async () => {
      // The dialog said so: the yes is set with the channel, and before it.
      if (withUsage) await setUsageConsent(true);
      // The updater asks again in the new channel at once; its rows follow the state.
      if (choice !== state.channel) await updates.setChannel(choice);
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
        trailing={<span className="text-[14px] leading-snug text-ink-2">{c[state.channel]}</span>}
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
        <ChannelChoice value={choice} onChange={setChoice} />
        <p className="mt-4 text-[14px] leading-relaxed text-ink-2">{IS_ANDROID ? c.noteAndroid : c.note}</p>
        {/* What the yes shares, in full: it is given with "Übernehmen". */}
        {withUsage && <p data-channel-usage className="mt-2 text-[14px] leading-relaxed text-ink-2">{c.usage} {t.auth.usage.disclosure}</p>}
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
 * The two channels as radios with one tab stop: the arrows move and choose
 * at once, as in the avatar picker (components/shell/ProfileMenu.tsx). The
 * chosen one takes the focus when the dialog opens.
 */
function ChannelChoice({ value, onChange }: { value: UpdateChannel; onChange: (next: UpdateChannel) => void }) {
  const c = useT().settings.channel;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (CHANNELS.indexOf(value) + step + CHANNELS.length) % CHANNELS.length;
    onChange(CHANNELS[next]);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={c.title} onKeyDown={onKeyDown} className="-mx-2 flex flex-col gap-1">
      {CHANNELS.map((channel, i) => {
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
              <span className="block text-[15px] leading-snug text-ink">{c[channel]}</span>
              <span id={hintId} className="mt-0.5 block text-[13px] leading-snug text-ink-2">
                {channel === 'preview' ? c.previewHint : c.stableHint}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
