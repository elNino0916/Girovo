'use client';

// The settings a search can open, each by its name (components/settings/Settings.tsx
// opens its page and focuses its control): the title bar's search
// (components/CommandPalette.tsx) and the desktop sidebar's "In Einstellungen
// suchen" (components/shell/Sidebar.tsx) list the same ones. A setting is here
// only where its page shows it.

import { useMemo } from 'react';
import type { ReactNode } from 'react';
import type { SettingsTarget } from '@/lib/app-types';
import { MESSAGES, type Messages } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n/locale';
import { useFints } from '../FintsProvider';
import {
  ArchiveIcon, BellIcon, BoltIcon, CalendarIcon, ChartIcon, ClockIcon, FileIcon, GlobeIcon, ImageIcon, LockIcon, MoonIcon,
  NoteIcon, ExpandIcon, UserIcon, RefreshIcon, ShieldIcon, SplitIcon, TagIcon, WalletIcon,
} from '../icons';
import { useAskPage } from './AskSettings';
import { useUsageConsent } from '../telemetry/usage';
import { useUpdates } from '../updates/store';

/** A command's own search words in lib/i18n/messages/shell.ts. */
export type WordsId = keyof Messages['shell']['palette']['words'];

type GlyphProps = { size?: number; className?: string };

export type SettingFind = {
  target: SettingsTarget;
  words: WordsId;
  name: (m: Messages) => string;
  icon: (p: GlyphProps) => ReactNode;
};

/**
 * A name and the words that find it: its own in the language on screen, and,
 * when that is not German, its German name and words as well, so a German
 * query finds it whatever the app speaks. `extra`: words of this one entry.
 */
export function findWords(tr: Messages, locale: Locale, name: (m: Messages) => string, words: WordsId, extra: string[] = []) {
  const de = MESSAGES.de;
  const own = tr.shell.palette.words[words];
  return {
    label: name(tr),
    keywords: locale === 'de' ? [...own, ...extra] : [...own, ...extra, name(de), ...de.shell.palette.words[words]],
  };
}

export function useSettingFinds(): SettingFind[] {
  const { meta, vaultStatus, backgroundChecks } = useFints();
  const usage = useUsageConsent();
  const { state: update } = useUpdates();
  const logos = !!meta?.merchantLogos;
  const publisher = typeof window !== 'undefined' && !!window.electronPublisherCert;
  // Girovo AI's answer style, where its page is shown.
  const askPage = useAskPage();
  const fromFile = update?.kind === 'nsis' && typeof window !== 'undefined' && !!window.electronUpdater?.chooseFile;
  return useMemo(() => {
    const s = (target: SettingsTarget, words: WordsId, name: (m: Messages) => string, icon: SettingFind['icon']): SettingFind =>
      ({ target, words, name, icon });
    const ready = vaultStatus === 'ready';
    const list: (SettingFind | false)[] = [
      s('language', 'language', (m) => m.session.language, (p) => <GlobeIcon {...p} />),
      s('black', 'black', (m) => m.common.theme.black, (p) => <MoonIcon filled {...p} />),
      s('idle', 'idle', (m) => m.settings.find.idle, (p) => <ClockIcon {...p} />),
      s('loginBalances', 'loginBalances', (m) => m.settings.balances.atLogin, (p) => <RefreshIcon {...p} />),
      s('loginBookings', 'loginBookings', (m) => m.settings.bookingsAtLogin.title, (p) => <RefreshIcon {...p} />),
      s('categories', 'categories', (m) => m.transactions.custom.section, (p) => <TagIcon {...p} />),
      logos && s('logos', 'logos', (m) => m.session.logos, (p) => <ImageIcon {...p} />),
      !!usage && s('usage', 'usage', (m) => m.session.usage, (p) => <ChartIcon {...p} />),
      s('device', 'device', (m) => m.settings.find.device, (p) => <ShieldIcon {...p} />),
      askPage && s('askTone', 'askTone', (m) => `${m.settings.ask.title}: ${m.settings.ask.style.tone}`, (p) => <NoteIcon {...p} />),
      askPage && s('askLength', 'askLength', (m) => `${m.settings.ask.title}: ${m.settings.ask.style.length}`, (p) => <ExpandIcon {...p} />),
      askPage && s('askName', 'askName', (m) => m.settings.ask.style.useName, (p) => <UserIcon {...p} />),
      // Windows desktop only, as on the page (components/settings/PublisherCert.tsx).
      publisher && s('publisher', 'publisher', (m) => m.settings.publisherCert.row, (p) => <ShieldIcon check {...p} />),
      (ready || vaultStatus === 'error') && s('data', 'data', (m) => m.session.vault, (p) => <LockIcon {...p} />),
      ready && s('keep', 'keep', (m) => m.history.keep, (p) => <CalendarIcon {...p} />),
      ready && s('backup', 'backup', (m) => m.backup.row.title, (p) => <ArchiveIcon {...p} />),
      ready && s('keepBalances', 'keepBalances', (m) => m.settings.balances.keep, (p) => <WalletIcon {...p} />),
      // What "Neue Umsätze melden" reports: only while it is on, as on the page.
      backgroundChecks === true && s('alerts', 'alerts', (m) => m.background.alerts.title, (p) => <BellIcon {...p} />),
      // With the updater only (the desktop app, the GitHub APK), as on the page.
      !!update && s('channel', 'channel', (m) => m.settings.channel.title, (p) => <SplitIcon {...p} />),
      update?.early !== undefined && s('early', 'early', (m) => m.settings.early.title, (p) => <BoltIcon {...p} />),
      fromFile && s('fromFile', 'fromFile', (m) => m.settings.fromFile.title, (p) => <FileIcon {...p} />),
    ];
    return list.filter((x): x is SettingFind => !!x);
  }, [logos, usage, vaultStatus, backgroundChecks, update, fromFile, publisher, askPage]);
}
