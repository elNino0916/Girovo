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
//   Anmeldung & Sicherheit — unlocking (fingerprint, Windows Hello, further
//     banks with the first) and the automatic logout; what the phone's check
//     found and the bank's registration of the device;
//   Benachrichtigungen — "Neue Umsätze melden" and what it says;
//   Konten & Umsätze — the balances and Umsätze kept and read, the import, the
//     categories (on Android first the guess with Gemini Nano);
//   Daten & Geräte — the sync, what is kept here, the backup, the reset;
//   Sprache & Darstellung — the language, the appearance (not on Android: the
//     phone's light and dark) and the shortcuts;
//   Datenschutz — the two things that can leave the machine besides the bank's
//     traffic: the shop names for company logos, and usage data;
//   Über Girovo — updates and their channel, the version, the licence and the links.
//
// Each page is Material 3 Expressive's grouped list (./rows.tsx), the one place
// in the app whose rows stand on a ground of their own (DESIGN.md). A row says
// what a setting is in a line, two at most; what an action does in full is
// said by the dialog it opens, right before it is done. The session itself —
// who, since when, which banks, Abmelden — stays in the Sitzung panel
// (components/shell/ProfileMenu.tsx).

import { createElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LOCALE_NAMES } from '@/lib/i18n/locale';
import { useLocale, useT } from '@/lib/i18n/react';
import { IS_ANDROID, IS_DESKTOP_APP } from '@/lib/platform';
import { PAGE_CLUSTERS, PAGE_ORDER, type SettingsPage } from '@/lib/settings-pages';
import { setThemePref } from '@/lib/theme';
import { FingerprintSwitch, IntegrityRow, NanoRow, PlayUpdateRow } from '../android/AndroidSettings';
import { PlusRow } from '../android/Plus';
import { IDLE_MINUTE_CHOICES, useFints, type IdleMinutes } from '../FintsProvider';
import { LanguageSegmented } from '../LanguageToggle';
import { useThemePref } from '../ThemeToggle';
import { updates, useUpdates } from '../updates/store';
import { UpdateSessionRow } from '../updates/UpdateNotices';
import { setUsageConsent, useUsageConsent } from '../telemetry/usage';
import {
  BellIcon, BuildingIcon, ChartIcon, ClockIcon, CodeIcon, EyeOffIcon, FileIcon, GlobeIcon, ImageIcon, InfoIcon, KeyboardIcon,
  LockIcon, MailIcon, MonitorIcon, MoonIcon, PhoneIcon, RefreshIcon, ShieldIcon, StarIcon, SunIcon, WalletIcon,
} from '../icons';
import { PAGE_TITLE_ID } from '../shell/ids';
import { useDesktopFrame } from '../shell/frame';
import { Button, Dot, Kbd, Segmented } from '../ui';
import { KeepRow, KeepOffDialog, ResetHistoryDialog, ResetVaultDialog, WipeVaultDialog } from './data-dialogs';
import { ResetAppRow } from './ResetApp';
import { BackupRows } from './BackupDialogs';
import { ImportRow } from './ImportDialog';
import { CategorySettings } from './CategorySettings';
import { LinkedUnlockSwitch } from './LinkedUnlock';
import { WindowsHelloSwitch } from './WindowsHello';
import { BackgroundSwitch } from './BackgroundChecks';
import { BackgroundAlertsRow } from './BackgroundAlerts';
import { SyncRow } from './Sync';
import { UpdateChannelRow } from './UpdateChannel';
import {
  ActionItem, ChoiceItem, GroupHeading, LinkItem, PageItem, SegmentedItem, SettingItem, SettingsGroup, SwitchItem,
} from './rows';

// i18n-data-start — addresses, not words
const WEBSITE_URL = 'https://girovo.de';
const CONTACT_MAIL = 'contact@girovo.de';
const SOURCE_URL = 'https://github.com/elNino0916/Girovo';
const PRIVACY_URL = 'https://elnino0916.de/girovo/privacy';
const IMPRINT_URL = 'https://elnino0916.de/girovo/impressum';
// i18n-data-end
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '';

type DataDialog = 'reset' | 'wipe' | 'keepOff' | 'historyReset';
type IconComponent = (props: { size?: number; filled?: boolean; className?: string }) => ReactNode;

/** Each page's glyph: the list's disc, the sidebar's place. */
const ICONS: Record<SettingsPage, IconComponent> = {
  security: LockIcon,
  notifications: BellIcon,
  accounts: WalletIcon,
  devices: IS_ANDROID ? PhoneIcon : MonitorIcon,
  appearance: GlobeIcon,
  privacy: EyeOffIcon,
  about: InfoIcon,
};

export type PageEntry = {
  id: SettingsPage;
  title: string;
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
 * offered, Datenschutz in a build without logos and usage data).
 */
export function useSettingsPages(): PageEntry[] {
  const t = useT();
  const { locale } = useLocale();
  const {
    bank, backgroundChecks, windowsHello, sync, vaultStatus, meta,
  } = useFints();
  const usage = useUsageConsent();
  const theme = useThemePref();
  const words = t.settings;
  return useMemo(() => {
    const kept = vaultStatus === 'ready' || vaultStatus === 'error' || vaultStatus === 'unavailable';
    const shown: Record<SettingsPage, boolean> = {
      security: true,
      notifications: backgroundChecks !== null && !!bank,
      accounts: true,
      devices: kept || !!sync || IS_DESKTOP_APP,
      appearance: true,
      privacy: !!meta?.merchantLogos || !!usage,
      about: true,
    };
    const summary: Record<SettingsPage, string> = {
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
      privacy: line([meta?.merchantLogos && words.summary.logos, usage && words.summary.usage]),
      about: APP_VERSION ? t.shell.version(APP_VERSION) : words.licence,
    };
    return PAGE_ORDER.filter((id) => shown[id]).map((id) => ({
      id,
      title: id === 'appearance' && IS_ANDROID ? words.pages.language : words.pages[id],
      summary: summary[id],
      alert: id === 'devices' && vaultStatus === 'error',
      Icon: ICONS[id],
    }));
  }, [t, locale, bank, backgroundChecks, windowsHello, sync, vaultStatus, meta?.merchantLogos, usage, theme, words]);
}

export function Settings() {
  const { settingsPage, setSettingsPage, settingsTarget, clearSettingsTarget } = useFints();
  const frame = useDesktopFrame();
  const pages = useSettingsPages();
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
    <div className="flex w-full max-w-[720px] flex-col gap-7 pt-2 pb-2">
      {page ? (
        <>
          {/* The desktop names the page on the sheet; a phone in its top app bar. */}
          {frame && <h2 className="-mb-2 px-4 text-[22px] leading-7 font-medium text-ink">{page.title}</h2>}
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
    case 'security': return <SecurityPage />;
    case 'notifications': return <NotificationsPage />;
    case 'accounts': return <AccountsPage onDialog={onDialog} />;
    case 'devices': return <DevicesPage onDialog={onDialog} />;
    case 'appearance': return <AppearancePage />;
    case 'privacy': return <PrivacyPage />;
    case 'about': return <AboutPage />;
  }
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
  const { balancesAtLogin, setBalancesAtLogin, vault, vaultStatus, setKeepBalances, toast, keepBookings } = useFints();
  const ready = vaultStatus === 'ready';
  return (
    <>
      <SettingsGroup title={t.settings.groups.balances}>
        {/* 6.0: every balance after the login, as "Alle Salden abrufen" reads them. Off unless switched on. */}
        <SwitchItem
          icon={<RefreshIcon />}
          setting="loginBalances"
          checked={balancesAtLogin}
          onChange={setBalancesAtLogin}
          title={t.settings.balances.atLogin}
          summary={t.settings.balances.atLoginHint}
        />
        {/* 6.0: the last balances, for the overview's first look (lib/kept-balances.ts). On unless switched off; off deletes them. */}
        {ready && (
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
        )}
      </SettingsGroup>

      {/* The choice lives in the vault, so it is offered only while the vault
          can be written. Off is the default (owner to confirm). */}
      {ready && (
        <SettingsGroup title={t.settings.groups.bookings}>
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
  const { vaultStatus, sync } = useFints();
  const kept = vaultStatus === 'ready' || vaultStatus === 'error' || vaultStatus === 'unavailable';
  return (
    <>
      {/* Sync between devices (lib/sync.ts): once the first login's vault is loaded. */}
      {sync && (
        <SettingsGroup title={t.sync.section}>
          <SyncRow />
        </SettingsGroup>
      )}

      {/* What is kept here, and the ways to take it elsewhere — once the saved data's state is known. */}
      {(kept || IS_DESKTOP_APP) && (
        <SettingsGroup title={t.session.thisComputer}>
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

          {/* What it keeps, as one file to take elsewhere — and back. */}
          {vaultStatus === 'ready' && <BackupRows />}

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

function PrivacyPage() {
  const t = useT();
  const { meta, logoConsent, setLogoConsent } = useFints();
  const usage = useUsageConsent();
  return (
    // What can leave the machine besides the bank's own traffic — each off
    // until the user agreed, and absent in a build that does not offer it.
    <SettingsGroup>
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
          title={t.session.usage}
          summary={t.session.usageHint}
        />
      )}
    </SettingsGroup>
  );
}

function AboutPage() {
  const t = useT();
  const { openNewInSix } = useFints();
  const { state: update } = useUpdates();
  return (
    <>
      <SettingsGroup>
        {/* The Google Play build, when Play has a newer version. */}
        <PlayUpdateRow />
        {/* With the updater (the desktop app, the GitHub build on Android) the version is on its row. */}
        <UpdateSessionRow setting="updates" onOpen={() => updates.openDialog()} />
        {/* Stable or the 6.0 previews too: with the updater only, like the row above. */}
        <UpdateChannelRow />
        {/* What 6 brought, and its switches together (components/NewInSix.tsx). */}
        <ActionItem icon={<StarIcon />} title={t.shell.newInSix.row} summary={t.shell.newInSix.rowHint} onClick={openNewInSix} />
        <SettingItem
          icon={<InfoIcon />}
          title={!update && APP_VERSION ? t.shell.version(APP_VERSION) : t.settings.licence}
          summary={!update && APP_VERSION ? t.settings.licence : undefined}
        />
      </SettingsGroup>

      {/* Girovo's own site, and the way to write to its maker (owner, 2026-10-23). */}
      <SettingsGroup title={t.settings.groups.links}>
        <LinkItem icon={<GlobeIcon />} title={t.settings.website} summary="girovo.de" href={WEBSITE_URL} opensExternally={t.shell.opensExternally} />
        <LinkItem icon={<MailIcon />} title={t.settings.contact} summary={CONTACT_MAIL} href={`mailto:${CONTACT_MAIL}`} opensExternally={t.settings.opensMail} />
        <LinkItem icon={<CodeIcon />} title={t.settings.source} href={SOURCE_URL} opensExternally={t.shell.opensExternally} />
        <LinkItem icon={<FileIcon />} title={t.settings.privacyPolicy} href={PRIVACY_URL} opensExternally={t.shell.opensExternally} />
        <LinkItem icon={<BuildingIcon />} title={t.settings.imprint} href={IMPRINT_URL} opensExternally={t.shell.opensExternally} />
      </SettingsGroup>
    </>
  );
}
