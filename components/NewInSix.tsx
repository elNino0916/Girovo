'use client';

// "Neu in Girovo 6": once, on the first Übersicht after the update from an
// older Girovo (FintsProvider's newInSix: a device that knew a bank before
// this start), and again from Einstellungen → Über Girovo.
//
// 6.0's biggest features wait to be switched on — they keep a PIN or reach
// past this device, so none is on by default — and live deep in
// Einstellungen. The sheet offers them where they are: the very rows of
// Einstellungen, each with its own dialog and its own safe default, so
// nothing here turns anything on by itself. Each row shows only where it can
// work (Windows Hello on a PC that has it, the further banks with two or
// more). Under them, in a sentence each, what changed without a switch.

import { useEffect, type ReactNode } from 'react';
import { useT } from '@/lib/i18n/react';
import { IS_ANDROID, IS_DESKTOP_APP } from '@/lib/platform';
import { useFints } from './FintsProvider';
import { CalendarIcon, CardIcon, CodeIcon, DownloadIcon, HistoryIcon, HomeIcon, MonitorIcon, StarIcon, WalletIcon } from './icons';
import { BackgroundSwitch } from './settings/BackgroundChecks';
import { LinkedUnlockSwitch } from './settings/LinkedUnlock';
import { SettingItem } from './settings/rows';
import { SyncRow } from './settings/Sync';
import { WindowsHelloSwitch } from './settings/WindowsHello';
import { Button, Dialog } from './ui';
import { updatesAtStart, useUpdates } from './updates/store';

/** How long the Übersicht stands before the sheet comes up over it, so it never lands on a half-drawn page. */
const SETTLE_MS = 1500;

export function NewInSix() {
  const t = useT();
  const f = useFints();
  const {
    newInSix, openNewInSix, closeNewInSix, view, busy, vaultStatus, bank, banks,
    windowsHello, linkedUnlock, backgroundChecks, sync,
    backgroundAsk, linkedUnlockAsk, syncOpen, transferOpen,
  } = f;
  const { state: updateState } = useUpdates();

  // Due: up once the Übersicht has settled and nothing else is asking.
  const quiet = view === 'dashboard' && !busy && vaultStatus !== 'idle' && vaultStatus !== 'loading'
    && !backgroundAsk && !linkedUnlockAsk && !syncOpen && !transferOpen;
  useEffect(() => {
    if (newInSix !== 'due' || !quiet) return;
    const timer = setTimeout(openNewInSix, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [newInSix, quiet, openNewInSix]);

  if (newInSix !== 'open' || !bank) return null;
  const words = t.shell.newInSix;
  // The rows' own rules for showing (components/settings): the group only when one of them will.
  const offers = windowsHello !== null || (linkedUnlock !== null && (linkedUnlock || banks.length > 1))
    || backgroundChecks !== null || !!sync;
  const more: Array<{ icon: ReactNode; title: string; text: string }> = [
    { icon: <WalletIcon />, ...words.overview },
    IS_ANDROID ? { icon: <HomeIcon />, ...words.widget } : { icon: <MonitorIcon />, ...words.frame },
    // The desktop app's shell (src-tauri); the browser and the phone have none of it.
    ...(IS_DESKTOP_APP ? [{ icon: <CodeIcon />, ...words.rust }] : []),
    { icon: <CalendarIcon />, ...words.orders },
    { icon: <HistoryIcon />, ...words.kept },
    { icon: <CardIcon />, ...words.cards },
    // Only the installed Windows app installs in its start window (src-tauri/src/updater/start.rs).
    ...(updatesAtStart(updateState) ? [{ icon: <DownloadIcon />, ...words.updates }] : []),
  ];

  return (
    <Dialog
      open
      onClose={closeNewInSix}
      size="md"
      title={words.title}
      icon={<StarIcon size={20} />}
      description={offers ? words.intro : words.introPlain}
      actions={<Button variant="primary" data-autofocus onClick={closeNewInSix}>{words.done}</Button>}
    >
      {offers && (
        <section aria-labelledby="new-in-six-on" className="mt-1">
          <h3 id="new-in-six-on" className="px-4 pb-2 text-[14px] leading-5 font-medium tracking-[0.1px] text-accent">{words.toTurnOn}</h3>
          <div data-settings-group>
            <WindowsHelloSwitch />
            <LinkedUnlockSwitch />
            <BackgroundSwitch />
            <SyncRow />
          </div>
        </section>
      )}
      <section aria-labelledby="new-in-six-more" className={offers ? 'mt-5' : 'mt-1'}>
        <h3 id="new-in-six-more" className="px-4 pb-2 text-[14px] leading-5 font-medium tracking-[0.1px] text-accent">{words.alsoNew}</h3>
        <div data-settings-group>
          {more.map((m) => <SettingItem key={m.title} icon={m.icon} title={m.title} summary={m.text} />)}
        </div>
      </section>
    </Dialog>
  );
}
