'use client';

// Einstellungen: a page of its own, as Analyse and Verträge are — reached from
// the gear at the foot of the navigation rail, from the Sitzung panel and from
// the search, which can bring the user straight to one setting. On a phone it
// is a page under the one it was opened from, as Android's settings screens
// are: the top app bar's way back, no navigation bar and no Überweisen.
//
// Material 3 Expressive's grouped list (./rows.tsx), the way Android's own
// settings draw it — the one page whose sections stand on a ground of their
// own (DESIGN.md):
//
//   Allgemein — the language, the appearance (not on Android: the phone's
//     light and dark), the shortcuts, how soon the automatic logout comes;
//   Sicherheit — on Android what the phone's integrity check found and
//     fingerprint login; the bank's registration of the device;
//   Kategorien — on Android the category guess with Gemini Nano (marked as
//     the AI feature it is), then the user's own categories;
//   Datenschutz — the two things that can leave the machine besides the
//     bank's traffic: the shop names for company logos, and usage data;
//   Auf diesem Rechner ("Telefon" on Android) — what is kept here: the
//     encrypted personal data and the kept Umsätze, the import into them and
//     the backup of all of it;
//   Über Girovo — updates, the version, the licence and the links.
//
// A row says what a setting is in a line, two at most; what an action does in full
// is said by the dialog it opens ("Gerät vergessen?", "Gespeicherte Daten
// löschen?"), right before it is done. The session itself — who, since when,
// which banks, Abmelden — stays in the Sitzung panel (components/shell/ProfileMenu.tsx).

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
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
  BuildingIcon, ChartIcon, ClockIcon, CodeIcon, FileIcon, GlobeIcon, ImageIcon, InfoIcon, KeyboardIcon, LockIcon, MailIcon, MonitorIcon,
  MoonIcon, ShieldIcon, SunIcon,
} from '../icons';
import { Button, Dot, Kbd, Segmented } from '../ui';
import { KeepRow, KeepOffDialog, ResetHistoryDialog, ResetVaultDialog, WipeVaultDialog } from './data-dialogs';
import { BackupRows } from './BackupDialogs';
import { ImportRow } from './ImportDialog';
import { CategorySettings } from './CategorySettings';
import { ActionItem, ChoiceItem, LinkItem, SegmentedItem, SettingItem, SettingsGroup, SwitchItem } from './rows';

// i18n-data-start — addresses, not words
const WEBSITE_URL = 'https://girovo.de';
const CONTACT_MAIL = 'contact@girovo.de';
const SOURCE_URL = 'https://github.com/elNino0916/Girovo';
const PRIVACY_URL = 'https://elnino0916.de/girovo/privacy';
const IMPRINT_URL = 'https://elnino0916.de/girovo/impressum';
// i18n-data-end
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '';

type DataDialog = 'reset' | 'wipe' | 'keepOff' | 'historyReset';

export function Settings() {
  const t = useT();
  const {
    idleMinutes, setIdleMinutes, deviceRemembered, setForgetDeviceOpen, vaultStatus,
    meta, logoConsent, setLogoConsent, singleKeyShortcuts, setShortcutsOpen,
    settingsTarget, clearSettingsTarget, keepBookings,
  } = useFints();
  const pref = useThemePref();
  const usage = useUsageConsent();
  const { state: update } = useUpdates();
  const [dialog, setDialog] = useState<DataDialog | null>(null);
  const closeDialog = () => setDialog(null);

  // The search asked for one setting: there, centred, with its control focused.
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
      <SettingsGroup title={t.settings.sections.general}>
        {/* The Google Play build's supporter subscription (components/android/Plus.tsx). */}
        <PlusRow />
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
            trailing={singleKeyShortcuts ? <Kbd>?</Kbd> : <span className="text-[13px] text-ink-2">{t.session.singleKeysOff}</span>}
          />
        )}

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

      <SettingsGroup title={t.settings.sections.security}>
        {/* The Android app only: what the integrity check found, and fingerprint login. */}
        <IntegrityRow />
        <FingerprintSwitch />
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

      {/* The guess with Gemini Nano (Android), then the user's own categories:
          made from a booking's menu, kept here. */}
      <SettingsGroup title={t.settings.sections.categories} setting="categories">
        <NanoRow />
        <CategorySettings />
      </SettingsGroup>

      {/* What can leave the machine besides the bank's own traffic — each off
          until the user agreed, and absent in a build that does not offer it. */}
      {(meta?.merchantLogos || usage) && (
        <SettingsGroup title={t.settings.sections.privacy}>
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
      )}

      {/* What is kept here, and the ways to take it elsewhere — once the saved data's state is known. */}
      {(vaultStatus === 'ready' || vaultStatus === 'error' || vaultStatus === 'unavailable') && (
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
                  <Button variant="tertiary" size="xs" aria-haspopup="dialog" onClick={() => setDialog('reset')}>
                    {t.session.vaultReset}
                  </Button>
                  {/* Unreadable with this PIN, but not with the old one: it can
                      still be tried against PINs, so it can be deleted too. */}
                  <Button variant="tertiary" size="xs" aria-haspopup="dialog" onClick={() => setDialog('wipe')}>
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
              onClick={() => setDialog('wipe')}
            />
          )}

          {/* The choice lives in the vault, so it is offered only while the
              vault can be written. Off is the default (owner to confirm). */}
          {vaultStatus === 'ready' && (
            <KeepRow onOff={() => setDialog('keepOff')} onReset={() => setDialog('historyReset')} />
          )}

          {/* Older Umsätze from the online banking's export, into the kept ones. */}
          {vaultStatus === 'ready' && keepBookings && <ImportRow />}

          {/* What all of the above keeps, as one file to take elsewhere — and back. */}
          {vaultStatus === 'ready' && <BackupRows />}

          {/* Said once, quietly: there is nothing the user can do about it here. */}
          {vaultStatus === 'unavailable' && (
            <SettingItem icon={<InfoIcon />} title={t.session.vaultUnavailable} />
          )}
        </SettingsGroup>
      )}

      <SettingsGroup title={t.settings.sections.about}>
        {/* The Google Play build, when Play has a newer version. */}
        <PlayUpdateRow />
        {/* With the updater (the desktop app, the GitHub build on Android) the version is on its row. */}
        <UpdateSessionRow setting="updates" onOpen={() => updates.openDialog()} />
        <SettingItem
          icon={<InfoIcon />}
          title={!update && APP_VERSION ? t.shell.version(APP_VERSION) : t.settings.licence}
          summary={!update && APP_VERSION ? t.settings.licence : undefined}
        />
        {/* Girovo's own site, and the way to write to its maker (owner, 2026-10-23). */}
        <LinkItem icon={<GlobeIcon />} title={t.settings.website} summary="girovo.de" href={WEBSITE_URL} opensExternally={t.shell.opensExternally} />
        <LinkItem icon={<MailIcon />} title={t.settings.contact} summary={CONTACT_MAIL} href={`mailto:${CONTACT_MAIL}`} opensExternally={t.settings.opensMail} />
        <LinkItem icon={<CodeIcon />} title={t.settings.source} href={SOURCE_URL} opensExternally={t.shell.opensExternally} />
        <LinkItem icon={<FileIcon />} title={t.settings.privacyPolicy} href={PRIVACY_URL} opensExternally={t.shell.opensExternally} />
        <LinkItem icon={<BuildingIcon />} title={t.settings.imprint} href={IMPRINT_URL} opensExternally={t.shell.opensExternally} />
      </SettingsGroup>

      <ResetVaultDialog open={dialog === 'reset'} onClose={closeDialog} />
      <WipeVaultDialog open={dialog === 'wipe'} onClose={closeDialog} />
      <KeepOffDialog open={dialog === 'keepOff'} onClose={closeDialog} />
      <ResetHistoryDialog open={dialog === 'historyReset'} onClose={closeDialog} />
    </div>
  );
}
