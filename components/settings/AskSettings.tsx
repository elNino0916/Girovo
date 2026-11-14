'use client';

// Girovo Next: Einstellungen' page "Girovo AI" (lib/settings-pages.ts
// 'ask'), the first. The switch turns asking on or off everywhere
// (vault.askOff, read by components/insights/ask-gate.ts), on the AI wash
// with its spark; it turns on only once the model that answers is here
// (ask-gate.ts useModelReady), so it never promises answers that cannot come.
// Under it, what answers: on a phone with Gemini Nano, Nano and the state
// AICore reports; on the desktop the model's download, its progress and its
// state; on a phone without Nano a row that says the model is not loadable yet.
// The answers come in the app's language (Sprache & Darstellung).
//
// The page shows on the desktop always, and on Android wherever the runtime
// can ask at all (window.girovoMobile.ask), Nano or not: a phone without Nano
// still sees the switch and the honest model row.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLocale, useT } from '@/lib/i18n/react';
import { asksWith } from '@/lib/nano-ask';
import { IS_ANDROID } from '@/lib/platform';
import { useFints } from '../FintsProvider';
import { CheckCircleIcon, DownloadIcon, AiMarkIcon } from '../icons';
import { AiWordmark } from '../shell/BrandMark';
import { AiCategorizeRow } from '../insights/ai/AiCategorize';
import { AiNamesRow } from '../insights/ai/AiNamesSetting';
import { useModelReady } from '../insights/ask-gate';
import { useGemma } from '../insights/gemma';
import { Button, Progress } from '../ui';
import { SettingItem, SettingsGroup, SwitchItem } from './rows';

const noSubscription = () => () => {};

/** Whether Einstellungen lists the page: off Android always, on Android where the runtime asks. */
export function useAskPage(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => !IS_ANDROID || !!window.girovoMobile?.ask,
    () => !IS_ANDROID,
  );
}

/**
 * What AICore says of Nano on this phone: undefined off Android, null until
 * it has answered, asked again on the return to Girovo (as the Analyse's
 * tile asks, components/insights/Ask.tsx).
 */
function useNanoStatus(): GirovoNanoStatus | null | undefined {
  const [status, setStatus] = useState<GirovoNanoStatus | null | undefined>(undefined);
  useEffect(() => {
    const mobile = IS_ANDROID ? window.girovoMobile : undefined;
    if (!mobile?.ask || !mobile.categories) return;
    const categories = mobile.categories;
    let live = true;
    setStatus(null);
    const check = () => void categories.status().then((s) => live && setStatus(s));
    check();
    const off = categories.onStatus((s) => live && setStatus(s));
    const back = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', back);
    return () => {
      live = false;
      off();
      document.removeEventListener('visibilitychange', back);
    };
  }, []);
  return status;
}

export function AskPage() {
  const t = useT();
  const words = t.settings.ask;
  const { vault, updateVault } = useFints();
  // On unless switched off (the field is there only while it is off), and only with the model here.
  const ready = useModelReady() === true;
  const on = ready && !vault?.askOff;
  // Off forgets that "Girovo AI ist bereit" was seen (components/insights/ai/AiReady.tsx): the next "on" shows it again.
  const setOn = (next: boolean) => updateVault((v) => {
    if (!next) {
      if (v.askOff && !v.askIntroSeen) return v;
      const off = { ...v, askOff: true as const };
      delete off.askIntroSeen;
      return off;
    }
    if (!v.askOff) return v;
    const rest = { ...v };
    delete rest.askOff;
    return rest;
  });
  return (
    <>
      <SettingsGroup>
        <SwitchItem
          tone="ai"
          icon={<AiMarkIcon />}
          setting="ask"
          checked={on}
          onChange={setOn}
          disabled={!ready}
          title={<AiWordmark />}
          summary={ready ? words.hint : words.needsModel(IS_ANDROID)}
        />
        {/* The desktop only: the phone shows Gemini Nano's brands as before. */}
        {!IS_ANDROID && <AiNamesRow />}
      </SettingsGroup>

      {/* The desktop with Gemma: the bookings in Sonstiges, read once the user asks (components/insights/ai/AiCategorize.tsx). */}
      <AiCategorizeRow />

      <SettingsGroup title={words.group}>
        <ModelRow />
      </SettingsGroup>
    </>
  );
}

/** What answers: Gemini Nano where the phone has it (or Android is fetching it), else Girovo's own model, not loadable yet. */
function ModelRow() {
  const t = useT();
  const words = t.settings.ask;
  const status = useNanoStatus();
  // AICore has not answered yet: a moment, not a wrong row.
  if (IS_ANDROID && status === null) return null;

  if (status && (status.state === 'downloading' || status.state === 'downloadable')) {
    return (
      <SettingItem
        icon={<DownloadIcon />}
        title={words.nano}
        summary={status.state === 'downloading' ? words.nanoDownloading : words.nanoDownloadable}
      />
    );
  }
  if (status?.state === 'available' && asksWith(status.askModel ?? status.model)) {
    return (
      <SettingItem
        icon={<CheckCircleIcon className="text-green" strokeWidth={2} />}
        title={words.nano}
        summary={words.nanoReady}
      />
    );
  }
  // The desktop with the shell's Gemma (src-tauri/src/gemma.rs): its download, for real.
  if (!IS_ANDROID && typeof window !== 'undefined' && window.electronGemma) return <ModelDownloadRow />;
  // No Nano that can answer (or a shell without Gemma): the model Girovo will bring, not loadable yet.
  return (
    <SettingItem
      icon={<DownloadIcon />}
      title={words.model}
      summary={words.modelSize(IS_ANDROID)}
      below={<span className="block text-[14px] leading-5 text-ink-2">{words.later}</span>}
      trailing={<Button variant="secondary" size="sm" disabled>{words.load}</Button>}
    />
  );
}

/** Gigabytes as the row says them: "1,1 GB". */
function gb(bytes: number, locale: string): string {
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(bytes / 1e9)} GB`;
}

/**
 * The desktop's model: where it comes from before it loads (a download leaves
 * the computer, so it is said), its progress while it loads (cancel keeps
 * what came, the next press goes on), "bereit" with Löschen once it is here.
 */
function ModelDownloadRow() {
  const t = useT();
  const words = t.settings.ask;
  const { locale } = useLocale();
  const gemma = useGemma();
  const { updateVault } = useFints();
  const g = typeof window === 'undefined' ? undefined : window.electronGemma;
  // The model gone, "Girovo AI ist bereit" shows again once it is back (components/insights/ai/AiReady.tsx).
  const removeReady = () => {
    updateVault((v) => {
      if (!v.askIntroSeen) return v;
      const rest = { ...v };
      delete rest.askIntroSeen;
      return rest;
    });
    void g?.remove();
  };
  // Nothing to show until the shell answers, and nothing where no runtime is pinned for this system (an odd architecture).
  if (!gemma || !g || !gemma.supported) return null;
  const intl = locale === 'en' ? 'en-GB' : 'de-DE';
  if (gemma.state === 'ready') {
    return (
      <SettingItem
        icon={<CheckCircleIcon className="text-green" strokeWidth={2} />}
        title={words.model}
        summary={words.aiReady}
        // Loaded, but it would not start on this computer (this run): the shell says so; the templates answer meanwhile.
        below={gemma.unavailable && gemma.error ? <span className="block text-[14px] leading-5 text-ink-2">{gemma.error}</span> : undefined}
        trailing={<Button variant="tertiary" size="sm" onClick={removeReady}>{words.remove}</Button>}
      />
    );
  }
  if (gemma.state === 'downloading') {
    const total = gemma.total || 3.4e9;
    return (
      <SettingItem
        icon={<DownloadIcon />}
        title={words.model}
        summary={words.aiLoading(gb(gemma.received, intl), gb(total, intl))}
        below={<Progress className="mt-2 block" value={(gemma.received / total) * 100} label={words.model} />}
        trailing={<Button variant="tertiary" size="sm" onClick={() => void g.cancel()}>{words.cancel}</Button>}
      />
    );
  }
  return (
    <SettingItem
      icon={<DownloadIcon />}
      title={words.model}
      summary={words.aiSize}
      // The shell says what went wrong (a full disk, a broken file), not only that it did.
      below={<span className="block text-[14px] leading-5 text-ink-2">{gemma.state === 'error' ? gemma.error || words.aiFailed : words.aiSource}</span>}
      trailing={(
        <span className="flex items-center gap-1">
          {/* What already came of a cancelled or failed download can go too. */}
          {(gemma.state === 'error' || gemma.partial > 0) && (
            <Button variant="tertiary" size="sm" onClick={() => void g.remove()}>{words.remove}</Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => void g.download()}>{gemma.state === 'error' ? words.retry : gemma.partial > 0 ? words.resume : words.load}</Button>
        </span>
      )}
    />
  );
}
