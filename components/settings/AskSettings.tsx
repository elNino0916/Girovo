'use client';

// Girovo Next: Einstellungen' page "Frag deine Umsätze" (lib/settings-pages.ts
// 'ask'), after Datenschutz. The switch turns asking on or off everywhere
// (vault.askOff, read by components/insights/ask-gate.ts), on Gemini's wash
// with its spark. Under it, what answers: on a phone with Gemini Nano, Nano
// and the state AICore reports; elsewhere (a phone without it, the desktop)
// Girovo's own language model, whose download is not built yet: its "Laden"
// stays disabled and says so in one line. No progress, no download. Last, the
// answers' language, which is the app's: a press opens Sprache & Darstellung.
//
// The page shows on the desktop always, and on Android wherever the runtime
// can ask at all (window.girovoMobile.ask), Nano or not: a phone without Nano
// still sees the switch and the honest model row.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { LOCALE_NAMES } from '@/lib/i18n/locale';
import { useLocale, useT } from '@/lib/i18n/react';
import { asksWith } from '@/lib/nano-ask';
import { IS_ANDROID } from '@/lib/platform';
import { useFints } from '../FintsProvider';
import { CheckCircleIcon, DownloadIcon, GeminiSparkIcon, GlobeIcon } from '../icons';
import { Button } from '../ui';
import { ActionItem, SettingItem, SettingsGroup, SwitchItem } from './rows';

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
  const { locale } = useLocale();
  const { vault, updateVault, openSettings } = useFints();
  // On unless switched off: the field is there only while it is off.
  const on = !vault?.askOff;
  const setOn = (next: boolean) => updateVault((v) => {
    if (!next) return v.askOff ? v : { ...v, askOff: true };
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
          icon={<GeminiSparkIcon />}
          setting="ask"
          checked={on}
          onChange={setOn}
          title={words.title}
          summary={words.hint}
        />
      </SettingsGroup>

      <SettingsGroup title={words.group}>
        <ModelRow />
        <ActionItem
          icon={<GlobeIcon />}
          title={words.language}
          summary={words.languageValue(LOCALE_NAMES[locale])}
          haspopup={false}
          onClick={() => openSettings('language')}
        />
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
  // No Nano that can answer (or the desktop): the model Girovo will bring. Its download is not built yet.
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
