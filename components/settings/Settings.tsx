'use client';

// Einstellungen: a page of its own, as Analyse and Verträge are — reached from
// the gear at the foot of the navigation rail, from the Sitzung panel and from
// the search, which can bring the user straight to one setting. On a phone it
// is a page under the one it was opened from, as Android's settings screens
// are: the top app bar's way back, no navigation bar and no Überweisen.
//
// Since 6.0 the settings are sorted into pages (lib/settings-pages.ts), one
// shown at a time. On a phone Einstellungen opens on their list — each with
// its glyph on a disc, its name and what is on it or how it is set — and a
// page opens as a screen of its own, its name in the top app bar; back leads
// to the list. On the desktop the sidebar lists them (components/shell/Sidebar.tsx)
// and the sheet shows the one picked, the first to begin with.
//
//   Girovo AI (Girovo Next) — asking on or off, what answers (./AskSettings.tsx);
//   Girovo API — nothing yet, a line that it comes later;
//   Sicherheit & Datenschutz — unlocking (fingerprint, Windows Hello, security
//     keys, further banks with the first) and the automatic logout; what the
//     phone's check found and the bank's registration of the device; the two
//     things that can leave the machine besides the bank's traffic: the shop
//     names for company logos, and usage data;
//   Benachrichtigungen — "Neue Umsätze melden" and what it says;
//   Umsätze & Kategorien — the balances and Umsätze read at the login, those
//     kept here, the import, the categories (on Android first the guess with
//     Gemini Nano);
//   Daten & Sicherung — the sync, the backup, what is kept here, the reset;
//   Sprache & Darstellung — the language, the appearance (not on Android: the
//     phone's light and dark), "Schwarzer Hintergrund" and the shortcuts;
//   Updates — Google Play's update, the channel, staged releases at once, an
//     update from a file (only in a build with one of them);
//   Über Girovo — the version and the update's state, the licence and the links.
//
// Each page is Material 3 Expressive's grouped list (./rows.tsx), the one place
// in the app whose rows stand on a ground of their own (DESIGN.md). A row says
// what a setting is in a line, two at most; what an action does in full is
// said by the dialog it opens, right before it is done. The session itself —
// who, since when, which banks, Abmelden — stays in the Sitzung panel
// (components/shell/ProfileMenu.tsx).

import { createElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LOCALE_NAMES } from '@/lib/i18n/locale';
import { rich, useLocale, useT } from '@/lib/i18n/react';
import { CONTACT_MAIL, WEBSITE_URL, imprintUrl, privacyUrl, termsUrl } from '@/lib/links';
import { IS_ANDROID, IS_DESKTOP_APP } from '@/lib/platform';
import { PAGE_CLUSTERS, PAGE_ORDER, hasUpdateRows, type SettingsPage } from '@/lib/settings-pages';
import { setBlack, setThemePref } from '@/lib/theme';
import { FingerprintSwitch, IntegrityRow, NanoRow, PlayUpdateRow, usePlayUpdate } from '../android/AndroidSettings';
import { PlusRow } from '../android/Plus';
import { IDLE_MINUTE_CHOICES, useFints, type IdleMinutes } from '../FintsProvider';
import { LanguageSegmented } from '../LanguageToggle';
import { useBlackBackground, useThemePref } from '../ThemeToggle';
import { channelInfo, channelName } from '../updates/channels';
import { hasNewer, isReady, updates, useUpdates } from '../updates/store';
import { usageComesWithChannel } from '../telemetry/NightlyUsage';
import { setUsageConsent, useUsageConsent } from '../telemetry/usage';
import {
  BellIcon, BuildingIcon, ChartIcon, CheckCircleIcon, ClockIcon, CodeIcon, DownloadIcon, FileIcon, AiMarkIcon, GlobeIcon, ImageIcon, InfoIcon, KeyboardIcon,
  LockIcon, MailIcon, MonitorIcon, MoonIcon, PhoneIcon, RefreshIcon, ShieldIcon, SunIcon, WalletIcon,
} from '../icons';
import { BrandName, BrandPlate } from '../shell/BrandMark';
import { PAGE_TITLE_ID } from '../shell/ids';
import { useDesktopFrame } from '../shell/frame';
import { Button, Dot, Kbd, Segmented, Spinner, cx } from '../ui';
import { KeepRow, KeepOffDialog, ResetDocsDialog, ResetHistoryDialog, ResetVaultDialog, WipeVaultDialog } from './data-dialogs';
import { ResetAppRow } from './ResetApp';
import { AskPage, useAskPage } from './AskSettings';
import { BackupRows } from './BackupDialogs';
import { ImportRow } from './ImportDialog';
import { CategorySettings } from './CategorySettings';
import { LinkedUnlockSwitch } from './LinkedUnlock';
import { SecurityKeysRow } from './SecurityKeys';
import { WindowsHelloSwitch } from './WindowsHello';
import { BackgroundSwitch } from './BackgroundChecks';
import { BackgroundAlertsRow } from './BackgroundAlerts';
import { SyncRow } from './Sync';
import { EarlyUpdatesRow, FromFileRow, UpdateChannelRow } from './UpdateChannel';
import {
  ActionItem, ChoiceItem, GroupHeading, LinkItem, PageItem, SegmentedItem, SettingItem, SettingsGroup, SwitchItem,
} from './rows';

// i18n-data-start — addresses, not words
const SOURCE_URL = 'https://github.com/elNino0916/Girovo';
const AUTHOR_URL = 'https://elnino0916.de';
const PUBLISHER_URL = 'https://mt-media.eu';
// i18n-data-end
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '';

type DataDialog = 'reset' | 'wipe' | 'keepOff' | 'historyReset' | 'docsReset';
type IconComponent = (props: { size?: number; filled?: boolean; className?: string }) => ReactNode;

/**
 * Girovo API's glyph, for now: the owner picks its own from mocks. Material's
 * "api" is not in the font's subset yet (a new subset means fetching one with
 * every old name plus the new, DESIGN.md), so this borrows "code".
 */
const ApiIcon: IconComponent = CodeIcon;

/** Each page's glyph: the list's disc, the sidebar's place. */
const ICONS: Record<SettingsPage, IconComponent> = {
  // Girovo's AI mark is a picture, drawn: no symbol, so no new glyph in the font's subset.
  ask: AiMarkIcon,
  api: ApiIcon,
  security: LockIcon,
  notifications: BellIcon,
  accounts: WalletIcon,
  devices: IS_ANDROID ? PhoneIcon : MonitorIcon,
  appearance: GlobeIcon,
  updates: DownloadIcon,
  about: InfoIcon,
};

export type PageEntry = {
  id: SettingsPage;
  title: string;
  /** A word for the desktop's folded rail. */
  short: string;
  /** What is on the page, or how it is set, for the list. */
  summary: string;
  /** Something on it needs a look: the saved data cannot be read. */
  alert: boolean;
  Icon: IconComponent;
};

/** A list of parts as a line: "Fingerabdruck, gemerktes Gerät, automatisches Abmelden". */
const line = (parts: (string | false | null | undefined)[]) => {
  const text = parts.filter(Boolean).join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/**
 * The pages this app has right now, in their order: a page whose every row
 * would be missing is left out (Benachrichtigungen where the checks are not
 * offered, Updates in a build without the updater and without Google Play's
 * newer version).
 */
export function useSettingsPages(): PageEntry[] {
  const t = useT();
  const { locale } = useLocale();
  const {
    bank, backgroundChecks, windowsHello, sync, vaultStatus, vault,
  } = useFints();
  const theme = useThemePref();
  const askPage = useAskPage();
  const askOff = !!vault?.askOff;
  const { state: update } = useUpdates();
  const playUpdate = !!usePlayUpdate()?.available;
  const words = t.settings;
  return useMemo(() => {
    const kept = vaultStatus === 'ready' || vaultStatus === 'error' || vaultStatus === 'unavailable';
    const shown: Record<SettingsPage, boolean> = {
      ask: askPage,
      api: true,
      security: true,
      notifications: backgroundChecks !== null && !!bank,
      accounts: true,
      devices: kept || !!sync || IS_DESKTOP_APP,
      appearance: true,
      updates: hasUpdateRows({ updater: !!update, playUpdate }),
      about: true,
    };
    const newer = update && hasNewer(update) ? update.release : null;
    const summary: Record<SettingsPage, string> = {
      ask: askOff ? words.summary.askOff : words.summary.askOn,
      api: words.summary.apiSoon,
      security: line([
        IS_ANDROID ? words.summary.fingerprint : windowsHello !== null && words.summary.windowsHello,
        words.summary.idle,
      ]),
      notifications: backgroundChecks ? words.summary.alertsOn : words.summary.alertsOff,
      accounts: words.summary.accounts,
      devices: vaultStatus === 'error'
        ? t.session.vaultUnreadable
        : line([sync && words.summary.sync, vaultStatus === 'ready' && words.summary.backup, words.summary.kept]),
      appearance: IS_ANDROID ? LOCALE_NAMES[locale] : `${LOCALE_NAMES[locale]} · ${t.common.theme[theme]}`,
      updates: newer
        ? t.shell.updates.available(newer.version)
        : update
          ? `${words.channel.title}: ${channelName(channelInfo(update, update.channel), update.channel, words.channel, locale)}`
          : t.android.updates.playUpdate,
      about: APP_VERSION ? t.shell.version(APP_VERSION) : words.licence,
    };
    return PAGE_ORDER.filter((id) => shown[id]).map((id) => ({
      id,
      title: words.pages[id],
      short: words.pagesShort[id],
      summary: summary[id],
      alert: id === 'devices' && vaultStatus === 'error',
      Icon: ICONS[id],
    }));
  }, [t, locale, bank, backgroundChecks, windowsHello, sync, vaultStatus, theme, askPage, askOff, update, playUpdate, words]);
}

export function Settings() {
  const { settingsPage, setSettingsPage, settingsTarget, clearSettingsTarget } = useFints();
  const frame = useDesktopFrame();
  const pages = useSettingsPages();
  // Google Play asked again each time Einstellungen opens: a newer version brings the Updates page.
  usePlayUpdate(true);
  // A page that is not offered (any more) falls back: the list on a phone, the first on the desktop.
  const page = pages.find((p) => p.id === settingsPage) ?? (frame ? pages[0] : null);
  const [dialog, setDialog] = useState<DataDialog | null>(null);
  const closeDialog = () => setDialog(null);

  // Another page, or back to the list: from its top. On a phone the screen's
  // name takes focus, as a new screen's does; on the desktop focus stays in
  // the sidebar, where the next page is picked.
  const shown = page?.id ?? null;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    document.querySelector<HTMLElement>('[data-scroll-root]')?.scrollTo({ top: 0 });
    if (!frame) document.getElementById(PAGE_TITLE_ID)?.focus({ preventScroll: true });
  }, [shown, frame]);

  // The search asked for one setting: its page is open (openSettings), the
  // row centred, its control focused.
  useEffect(() => {
    if (!settingsTarget) return;
    clearSettingsTarget();
    const row = document.querySelector<HTMLElement>(`[data-setting="${settingsTarget}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'center' });
    // The row itself when it is what is pressed, else the control in it.
    (row.matches('button, a[href]') ? row : row.querySelector<HTMLElement>(
      'button:not(:disabled), [role="button"]:not(:disabled), [role="switch"]:not(:disabled), [role="combobox"], select, input, a[href]',
    ))?.focus({ preventScroll: true });
  }, [settingsTarget, clearSettingsTarget]);

  return (
    // Every page of Einstellungen stands in the middle of the sheet, as Über
    // Girovo did first: at the left of a wide sheet they looked shifted (owner,
    // 2026-11-11 for Über Girovo, 2026-11-13 for all).
    <div className={cx('flex w-full max-w-[720px] flex-col gap-7 pt-2 pb-2', frame && 'mx-auto')}>
      {page ? (
        <>
          {/* The desktop names the page on the sheet; a phone in its top app bar. */}
          {/* Über Girovo's head names the app itself: its title is there only for a screen reader. */}
          {frame && (
            <h2 className={page.id === 'about' ? 'sr-only' : '-mb-2 px-4 text-[22px] leading-7 font-medium text-ink'}>{page.title}</h2>
          )}
          <GroupHeading.Provider value={frame ? 'h3' : 'h2'}>
            <PageContent page={page.id} onDialog={setDialog} />
          </GroupHeading.Provider>
        </>
      ) : (
        <SettingsHome pages={pages} onOpen={setSettingsPage} />
      )}

      <ResetVaultDialog open={dialog === 'reset'} onClose={closeDialog} />
      <WipeVaultDialog open={dialog === 'wipe'} onClose={closeDialog} />
      <KeepOffDialog open={dialog === 'keepOff'} onClose={closeDialog} />
      <ResetHistoryDialog open={dialog === 'historyReset'} onClose={closeDialog} />
      <ResetDocsDialog open={dialog === 'docsReset'} onClose={closeDialog} />
    </div>
  );
}

/** A phone's Einstellungen: Plus where the Play build has it, then the pages in their clusters. */
function SettingsHome({ pages, onOpen }: { pages: PageEntry[]; onOpen: (page: SettingsPage) => void }) {
  const clusters = PAGE_CLUSTERS
    .map((ids) => pages.filter((p) => ids.includes(p.id)))
    .filter((c) => c.length);
  return (
    <>
      {/* The Google Play build's supporter subscription (components/android/Plus.tsx); nothing elsewhere. */}
      <PlusGroup />
      {clusters.map((cluster) => (
        <div key={cluster[0].id} data-settings-group>
          {cluster.map((p) => (
            <PageItem
              key={p.id}
              icon={createElement(p.Icon, { size: 22 })}
              title={p.title}
              summary={p.summary}
              alert={p.alert}
              onClick={() => onOpen(p.id)}
            />
          ))}
        </div>
      ))}
    </>
  );
}

function PlusGroup() {
  const { plus } = useFints();
  if (plus.state === 'free') return null;
  return (
    <div data-settings-group>
      <PlusRow />
    </div>
  );
}

function PageContent({ page, onDialog }: { page: SettingsPage; onDialog: (d: DataDialog) => void }) {
  switch (page) {
    case 'ask': return <AskPage />;
    case 'api': return <ApiPage />;
    case 'security': return <SecurityPage />;
    case 'notifications': return <NotificationsPage />;
    case 'accounts': return <AccountsPage onDialog={onDialog} />;
    case 'devices': return <DevicesPage onDialog={onDialog} />;
    case 'appearance': return <AppearancePage />;
    case 'updates': return <UpdatesPage />;
    case 'about': return <AboutPage />;
  }
}

/** Girovo API: nothing to set yet, only when it comes. */
function ApiPage() {
  const t = useT();
  return (
    <SettingsGroup>
      <SettingItem icon={<InfoIcon />} title={t.settings.ask.later} />
    </SettingsGroup>
  );
}

function SecurityPage() {
  const t = useT();
  const { idleMinutes, setIdleMinutes, deviceRemembered, setForgetDeviceOpen } = useFints();
  return (
    <>
      <SettingsGroup title={t.settings.groups.signIn}>
        {/* The Android app only: fingerprint login. */}
        <FingerprintSwitch />
        {/* The desktop app only: Windows Hello in place of the first login's PIN
            (lib/windows-hello.ts), and the further banks log in with the first
            (lib/linked-unlock.ts). */}
        <WindowsHelloSwitch />
        <SecurityKeysRow />
        <LinkedUnlockSwitch />
        <ChoiceItem
          icon={<ClockIcon />}
          // The short name: the value at the row's end says "nach 10 Min".
          title={t.settings.find.idle}
          summary={t.settings.idleHint}
          setting="idle"
          value={idleMinutes}
          choices={IDLE_MINUTE_CHOICES.map((n) => ({ value: n, label: t.session.idleOption(n) }))}
          onChange={(n) => setIdleMinutes(n as IdleMinutes)}
        />
      </SettingsGroup>

      <SettingsGroup title={t.settings.groups.thisDevice}>
        {/* The Android app only: what the integrity check found. */}
        <IntegrityRow />
        {deviceRemembered ? (
          // The provider's dialog: the "Gerät gemerkt" toast opens the same one.
          <ActionItem
            setting="device"
            icon={<ShieldIcon check />}
            title={t.session.deviceRemembered}
            summary={t.session.deviceRememberedHint}
            action={t.session.forget}
            onClick={() => setForgetDeviceOpen(true)}
          />
        ) : (
          <SettingItem
            setting="device"
            icon={<ShieldIcon />}
            title={t.session.deviceNotRemembered}
            summary={t.session.deviceNotRememberedHint}
          />
        )}
      </SettingsGroup>

      <LeavesDeviceGroup />
    </>
  );
}

function NotificationsPage() {
  return (
    <SettingsGroup>
      {/* Both apps: new Umsätze reported, with PINs kept for it (lib/background-check.ts)… */}
      <BackgroundSwitch />
      {/* …and, while it is on, what it reports (lib/payment-alerts.ts). */}
      <BackgroundAlertsRow />
    </SettingsGroup>
  );
}

function AccountsPage({ onDialog }: { onDialog: (d: DataDialog) => void }) {
  const t = useT();
  const { balancesAtLogin, setBalancesAtLogin, bookingsAtLogin, setBookingsAtLogin, vault, vaultStatus, setKeepBalances, toast, keepBookings } = useFints();
  const ready = vaultStatus === 'ready';
  return (
    <>
      <SettingsGroup title={t.settings.groups.atLogin}>
        {/* 6.0: every balance after the login, as "Alle Salden abrufen" reads them. Off unless switched on. */}
        <SwitchItem
          icon={<RefreshIcon />}
          setting="loginBalances"
          checked={balancesAtLogin}
          onChange={setBalancesAtLogin}
          title={t.settings.balances.atLogin}
          summary={t.settings.balances.atLoginHint}
        />
        {/* 6.0: every shown account's Umsätze after the login's own, as the Übersicht's "Umsätze abrufen" reads them. On unless switched off. */}
        <SwitchItem
          icon={<RefreshIcon />}
          setting="loginBookings"
          checked={bookingsAtLogin}
          onChange={setBookingsAtLogin}
          title={t.settings.bookingsAtLogin.title}
          summary={t.settings.bookingsAtLogin.hint}
        />
      </SettingsGroup>

      {/* What is kept lives in the vault, so it is offered only while the vault can be written. */}
      {ready && (
        <SettingsGroup title={t.settings.groups.keepHere}>
          {/* 6.0: the last balances, for the overview's first look (lib/kept-balances.ts). On unless switched off; off deletes them. */}
          <SwitchItem
            icon={<WalletIcon />}
            setting="keepBalances"
            checked={vault?.keepBalances !== false}
            onChange={(on) => {
              setKeepBalances(on);
              if (!on) toast(t.settings.balances.deleted, 'info');
            }}
            title={t.settings.balances.keep}
            summary={t.settings.balances.keepHint}
          />
          {/* The Umsätze. Off is the default (owner to confirm). */}
          <KeepRow onOff={() => onDialog('keepOff')} onReset={() => onDialog('historyReset')} />
          {/* Older Umsätze from the online banking's export, into the kept ones. */}
          {keepBookings && <ImportRow />}
        </SettingsGroup>
      )}

      {/* The guess with Gemini Nano (Android), then the user's own categories:
          made from a booking's menu, kept here. */}
      <SettingsGroup title={t.settings.groups.categories} setting="categories">
        <NanoRow />
        <CategorySettings />
      </SettingsGroup>
    </>
  );
}

function DevicesPage({ onDialog }: { onDialog: (d: DataDialog) => void }) {
  const t = useT();
  const { vaultStatus, sync, docsLocked, docsResettable, loadDocs } = useFints();
  const kept = vaultStatus === 'ready' || vaultStatus === 'error' || vaultStatus === 'unavailable';
  // Documents this PIN cannot open, listed before the bank had its word on
  // the PIN: asked again, so "Neu beginnen" shows once it has taken it.
  useEffect(() => {
    if (docsLocked && !docsResettable) void loadDocs();
  }, [docsLocked, docsResettable, loadDocs]);
  return (
    <>
      {/* Sync between devices (lib/sync.ts): once the first login's vault is loaded. */}
      {sync && (
        <SettingsGroup title={t.settings.groups.sync}>
          <SyncRow />
        </SettingsGroup>
      )}

      {/* What it keeps, as one file to take elsewhere, and back. */}
      {vaultStatus === 'ready' && (
        <SettingsGroup title={t.settings.groups.backup}>
          <BackupRows />
        </SettingsGroup>
      )}

      {/* What is kept here: once the saved data's state is known. */}
      {(kept || IS_DESKTOP_APP) && (
        <SettingsGroup title={t.settings.groups.stored}>
          {vaultStatus === 'error' && (
            <SettingItem
              setting="data"
              alert
              icon={(
                <span className="relative inline-flex">
                  <LockIcon />
                  <Dot className="absolute -top-px -right-px ring-2 ring-[var(--md-surface-container)]" />
                </span>
              )}
              title={t.session.vaultUnreadable}
              summary={t.session.vaultUnreadableHint}
              below={(
                <span className="mt-1 -ml-3 flex flex-wrap">
                  <Button variant="tertiary" size="xs" aria-haspopup="dialog" onClick={() => onDialog('reset')}>
                    {t.session.vaultReset}
                  </Button>
                  {/* Unreadable with this PIN, but not with the old one: it can
                      still be tried against PINs, so it can be deleted too. */}
                  <Button variant="tertiary" size="xs" aria-haspopup="dialog" onClick={() => onDialog('wipe')}>
                    {t.session.vaultDelete}
                  </Button>
                </span>
              )}
            />
          )}

          {/* Receipts and statements this PIN cannot open, any bank's of the
              view: the way out, as for the saved data above (lib/doc-store.ts). */}
          {docsLocked && (
            <SettingItem
              alert
              icon={(
                <span className="relative inline-flex">
                  <LockIcon />
                  <Dot className="absolute -top-px -right-px ring-2 ring-[var(--md-surface-container)]" />
                </span>
              )}
              title={t.docs.unreadable.title}
              summary={t.docs.unreadable.hint}
              below={docsResettable ? (
                <Button variant="tertiary" size="xs" className="mt-1 -ml-3" aria-haspopup="dialog" onClick={() => onDialog('docsReset')}>
                  {t.docs.unreadable.startOver}
                </Button>
              ) : (
                // Not under a PIN the bank has not taken: a typo would set the real store aside.
                <span className="mt-1 block text-[14px] leading-5 text-ink-2">{t.docs.server.notYet}</span>
              )}
            />
          )}

          {/* Whether or not the device is remembered: someone handing the
              computer on needs a way to take their data with them. */}
          {vaultStatus === 'ready' && (
            <ActionItem
              setting="data"
              icon={<LockIcon />}
              title={t.session.vault}
              summary={t.session.vaultHint}
              action={t.session.vaultDelete}
              onClick={() => onDialog('wipe')}
            />
          )}

          {/* Said once, quietly: there is nothing the user can do about it here. */}
          {vaultStatus === 'unavailable' && (
            <SettingItem icon={<InfoIcon />} title={t.session.vaultUnavailable} />
          )}

          {/* Last: everything on this computer, every bank's included (the desktop app only). */}
          <ResetAppRow />
        </SettingsGroup>
      )}
    </>
  );
}

function AppearancePage() {
  const t = useT();
  const { singleKeyShortcuts, setShortcutsOpen } = useFints();
  const pref = useThemePref();
  const black = useBlackBackground();
  return (
    <SettingsGroup>
      <SegmentedItem icon={<GlobeIcon />} title={t.session.language} setting="language">
        <LanguageSegmented label={t.session.language} />
      </SegmentedItem>

      {/* The Android app has none: it follows the phone's light and dark. */}
      {!IS_ANDROID && (
        <SegmentedItem icon={pref === 'dark' ? <MoonIcon /> : pref === 'light' ? <SunIcon /> : <MonitorIcon />} title={t.common.theme.label} setting="theme" wide>
          <Segmented
            aria-label={t.common.theme.label}
            size="sm"
            value={pref}
            onChange={setThemePref}
            options={[
              { value: 'light', label: t.common.theme.light, icon: <SunIcon size={15} /> },
              { value: 'dark', label: t.common.theme.dark, icon: <MoonIcon size={15} /> },
              { value: 'system', label: t.common.theme.system, icon: <MonitorIcon size={15} /> },
            ]}
          />
        </SegmentedItem>
      )}

      {/* The dark theme's page on true black. Nothing to switch while the choice is Hell. */}
      <SwitchItem
        icon={<MoonIcon filled />}
        setting="black"
        checked={black}
        onChange={setBlack}
        disabled={pref === 'light'}
        title={t.common.theme.black}
        summary={t.common.theme.blackHint}
      />

      {/* Shortcuts need a keyboard; a phone has none worth listing them for. */}
      {!IS_ANDROID && (
        <ActionItem
          icon={<KeyboardIcon />}
          title={t.common.shortcuts}
          onClick={() => setShortcutsOpen(true)}
          // With the single keys off, "?" would promise a key that does nothing.
          trailing={singleKeyShortcuts ? <Kbd>?</Kbd> : <span className="text-[14px] text-ink-2">{t.session.singleKeysOff}</span>}
        />
      )}
    </SettingsGroup>
  );
}

/**
 * Sicherheit & Datenschutz → Was das Gerät verlässt: what can leave the
 * machine besides the bank's own traffic (the Datenschutz page until
 * 2026-11-14). Each off until the user agreed, and absent in a build that
 * does not offer it; with neither, no group.
 */
function LeavesDeviceGroup() {
  const t = useT();
  const { meta, logoConsent, setLogoConsent } = useFints();
  const usage = useUsageConsent();
  // On the Nightly channel usage data is part of it (components/telemetry/NightlyUsage.tsx).
  const { state: update } = useUpdates();
  const withChannel = usageComesWithChannel(update?.channel, usage);
  if (!meta?.merchantLogos && !usage) return null;
  return (
    <SettingsGroup title={t.settings.groups.leavesDevice}>
      {meta?.merchantLogos && (
        <SwitchItem
          icon={<ImageIcon />}
          setting="logos"
          checked={logoConsent === 'on'}
          onChange={setLogoConsent}
          title={t.session.logos}
          summary={t.session.logosHint}
        />
      )}
      {usage && (
        <SwitchItem
          icon={<ChartIcon />}
          setting="usage"
          checked={usage === 'on'}
          onChange={(on) => void setUsageConsent(on)}
          disabled={withChannel}
          title={t.session.usage}
          summary={withChannel ? t.session.usageNightly : t.session.usageHint}
        />
      )}
    </SettingsGroup>
  );
}

/**
 * Updates: how they come. Listed only where one of its rows shows
 * (lib/settings-pages.ts hasUpdateRows); the update's state and the button
 * to look for one stay in Über Girovo's head.
 */
function UpdatesPage() {
  return (
    <SettingsGroup>
      {/* The Google Play build, when Play has a newer version. */}
      <PlayUpdateRow />
      {/* Stable or Nightly: with the updater only. */}
      <UpdateChannelRow />
      {/* Staged releases at once, like Windows Update's switch. */}
      <EarlyUpdatesRow />
      {/* A Setup.exe downloaded by hand, checked against the signed releases. */}
      <FromFileRow />
    </SettingsGroup>
  );
}

/**
 * Über Girovo: the app's name and version at its head, with the update's
 * state and the one button to look for a newer version; then where to write,
 * the legal pages as plain links, and who makes it (owner's pick, 2026-11-11:
 * mock A in .impeccable/mocks/about). How updates come is on Updates.
 */
function AboutPage() {
  const t = useT();
  const { locale } = useLocale();
  return (
    <>
      <AboutHead />

      {/* Girovo's own site, and the way to write to its maker (owner, 2026-10-23). */}
      <SettingsGroup title={t.settings.contact}>
        <LinkItem icon={<GlobeIcon />} title={t.settings.website} summary="girovo.de" href={WEBSITE_URL} opensExternally={t.shell.opensExternally} />
        <LinkItem icon={<MailIcon />} title={t.settings.contact} summary={CONTACT_MAIL} href={`mailto:${CONTACT_MAIL}`} opensExternally={t.settings.opensMail} />
        <LinkItem icon={<CodeIcon />} title={t.settings.source} href={SOURCE_URL} opensExternally={t.shell.opensExternally} />
      </SettingsGroup>

      <AboutFooter
        legal={[
          { label: t.settings.terms, href: termsUrl(locale) },
          { label: t.settings.privacyPolicy, short: t.settings.privacyShort, href: privacyUrl(locale) },
          { label: t.settings.imprint, href: imprintUrl(locale) },
        ]}
      />
    </>
  );
}

/**
 * The page's head: the plate, the name (amber "Nightly", violet "Next" or the release's
 * numeral), the version, and with the updater (the desktop app, the GitHub
 * build on Android) what it knows about a newer one. Play and F-Droid bring
 * their own updates: there the head stops at the version.
 */
function AboutHead() {
  const t = useT();
  const u = t.shell.updates;
  const { state } = useUpdates();
  const version = state?.current || APP_VERSION;
  const newer = state && hasNewer(state) ? state.release : null;
  const pct = state && state.total > 0 ? Math.min(100, Math.floor((state.received / state.total) * 100)) : 0;
  let status: ReactNode = null;
  if (state?.phase === 'checking') {
    // The spinner is here, by the words; the button below only waits (owner, 2026-11-11).
    status = <><Spinner size={16} />{u.checking}</>;
  } else if (state && newer) {
    status = (
      <span className="tnum font-medium text-accent">
        {state.phase === 'downloading' ? u.loadingPct(pct) : isReady(state) ? u.ready(newer.version) : u.available(newer.version)}
      </span>
    );
  } else if (state?.phase === 'current') {
    status = <><CheckCircleIcon size={18} className="text-green" strokeWidth={2} />{t.shell.about.upToDate}</>;
  }
  return (
    <header data-setting="updates" className="flex flex-col items-center px-4 pt-4 pb-2 text-center">
      <BrandPlate size={80} />
      <h2 className="mt-4 max-w-full text-[32px] leading-10 font-semibold tracking-[-0.2px] text-ink">
        <BrandName />
      </h2>
      {version && <p className="tnum mt-1 text-[14px] leading-5 text-ink-2">{t.shell.version(version)}</p>}
      {state && (
        <>
          {status && (
            <p role="status" className="mt-4 flex items-center justify-center gap-2 text-[14px] leading-5 text-ink">{status}</p>
          )}
          {newer ? (
            <Button variant="secondary" className="mt-3" aria-haspopup="dialog" onClick={() => updates.openDialog()}>
              {u.details}
            </Button>
          ) : (
            <Button
              variant="secondary"
              className="mt-3"
              iconLeft={<RefreshIcon size={16} />}
              disabled={state.phase === 'checking'}
              onClick={() => void updates.check()}
            >
              {t.shell.checkForUpdates}
            </Button>
          )}
        </>
      )}
    </header>
  );
}

/**
 * The legal pages as one line of links, then who makes Girovo and who
 * publishes it (owner, 2026-11-11), and the licence, small.
 */
function AboutFooter({ legal }: { legal: { label: string; short?: string; href: string }[] }) {
  const t = useT();
  const link = 'rounded-sm text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--md-primary)]';
  const external = <span className="sr-only">{` ${t.shell.opensExternally}`}</span>;
  return (
    <footer className="flex flex-col items-center gap-3 px-1 pt-2 pb-6 text-center sm:px-4">
      <ul className="flex flex-wrap items-center justify-center text-[14px] leading-5 font-medium">
        {legal.map((l) => (
          <li key={l.href}>
            <a href={l.href} target="_blank" rel="noopener noreferrer" className={cx(link, 'block rounded-full px-2 py-1.5 hover:bg-[color-mix(in_srgb,var(--md-primary)_8%,transparent)] hover:no-underline sm:px-3')}>
              {/* A phone's line has room for the three only with the short name. */}
              {l.short ? <><span className="sm:hidden">{l.short}</span><span className="max-sm:hidden">{l.label}</span></> : l.label}
              {external}
            </a>
          </li>
        ))}
      </ul>
      <p className="text-[14px] leading-5 text-ink-2">
        <span className="whitespace-nowrap">
          {'© 2026 '}
          <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer" className={link}>elNino0916{external}</a>
        </span>
        <span aria-hidden className="mx-2 max-sm:hidden">·</span>
        <br className="sm:hidden" />
        <span className="whitespace-nowrap">
          {rich(t.shell.about.publishedBy(
            <a key="pub" href={PUBLISHER_URL} target="_blank" rel="noopener noreferrer" className={link}>MT-Media{external}</a>,
          ))}
        </span>
      </p>
      <p className="max-w-[40ch] text-[12px] leading-4 text-ink-2 sm:max-w-none">{t.settings.licence}</p>
    </footer>
  );
}
