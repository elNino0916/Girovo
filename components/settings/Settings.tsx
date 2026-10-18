'use client';

// Einstellungen: a page of its own, as Analyse and Verträge are — reached from
// the gear at the foot of the navigation rail, from the Sitzung panel and from
// the search, which can bring the user straight to one setting.
//
// One calm column of sections on the page itself (no cards, DESIGN.md):
//
//   Allgemein — the language, the appearance (not on Android: the phone's
//     light and dark), how soon the automatic logout comes, the shortcuts;
//   Datenschutz — the two things that can leave the machine besides the
//     bank's traffic: the shop names for company logos, and usage data;
//   Auf diesem Rechner ("Telefon" on Android) — what is kept here: the
//     bank's registration of the device, the encrypted personal data and the
//     kept Umsätze, each with its one action; on Android also fingerprint
//     login and the category model;
//   Über Girovo — updates (desktop), the version, the licence and the links.
//
// A row says what a setting is, in a line or two; what an action does in full
// is said by the dialog it opens ("Gerät vergessen?", "Gespeicherte Daten
// löschen?"), right before it is done. The session itself — who, since when,
// which banks, Abmelden — stays in the Sitzung panel (components/shell/ProfileMenu.tsx).

import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { useT } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import { setThemePref } from '@/lib/theme';
import { AndroidSettings } from '../android/AndroidSettings';
import { IDLE_MINUTE_CHOICES, useFints, type IdleMinutes } from '../FintsProvider';
import { LanguageSegmented } from '../LanguageToggle';
import { useThemePref } from '../ThemeToggle';
import { updates, useUpdates } from '../updates/store';
import { UpdateSessionRow } from '../updates/UpdateNotices';
import { setUsageConsent, useUsageConsent } from '../telemetry/usage';
import {
  ExternalIcon, InfoIcon, KeyboardIcon, LockIcon, MonitorIcon, MoonIcon, ShieldIcon, SunIcon,
} from '../icons';
import { Button, Dot, Kbd, Segmented, Select, Switch, cx } from '../ui';
import { KeepRow, KeepOffDialog, ResetHistoryDialog, ResetVaultDialog, WipeVaultDialog } from './data-dialogs';
import { MachineIcon, MachineRow, ROW, SettingRow } from './rows';

// i18n-data-start — addresses, not words
const SOURCE_URL = 'https://github.com/elNino0916/Girovo';
const PRIVACY_URL = 'https://elnino0916.de/girovo/privacy';
// i18n-data-end
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '';

type DataDialog = 'reset' | 'wipe' | 'keepOff' | 'historyReset';

export function Settings() {
  const t = useT();
  const {
    idleMinutes, setIdleMinutes, deviceRemembered, setForgetDeviceOpen, vaultStatus,
    meta, logoConsent, setLogoConsent, singleKeyShortcuts, setShortcutsOpen,
    settingsTarget, clearSettingsTarget,
  } = useFints();
  const pref = useThemePref();
  const usage = useUsageConsent();
  const { state: update } = useUpdates();
  const idleId = useId();
  const [dialog, setDialog] = useState<DataDialog | null>(null);
  const closeDialog = () => setDialog(null);

  // The search asked for one setting: there, centred, with its control focused.
  useEffect(() => {
    if (!settingsTarget) return;
    clearSettingsTarget();
    const row = document.querySelector<HTMLElement>(`[data-setting="${settingsTarget}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'center' });
    row.querySelector<HTMLElement>('button:not(:disabled), select, input, a[href]')?.focus({ preventScroll: true });
  }, [settingsTarget, clearSettingsTarget]);

  return (
    <div className="flex w-full max-w-[720px] flex-col gap-10 pt-2">
      <Section title={t.settings.sections.general}>
        <SettingRow label={t.session.language} setting="language" wide>
          <LanguageSegmented label={t.session.language} />
        </SettingRow>

        {/* The Android app has none: it follows the phone's light and dark. */}
        {!IS_ANDROID && (
          <SettingRow label={t.common.theme.label} setting="theme" wide>
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
          </SettingRow>
        )}

        <SettingRow label={t.session.idle} hint={t.settings.idleHint} htmlFor={idleId} setting="idle">
          <Select
            id={idleId}
            value={String(idleMinutes)}
            onChange={(e) => setIdleMinutes(Number(e.target.value) as IdleMinutes)}
            containerClassName="w-auto shrink-0"
            // A row's control, not a form's field: the row's size, not the form's 56px.
            className="h-10! w-auto! pr-9! pl-3! text-[14px]!"
          >
            {IDLE_MINUTE_CHOICES.map((n) => (
              <option key={n} value={String(n)}>{t.session.idleOption(n)}</option>
            ))}
          </Select>
        </SettingRow>

        {/* Shortcuts need a keyboard; a phone has none worth listing them for. */}
        {!IS_ANDROID && (
          <button type="button" onClick={() => setShortcutsOpen(true)} className={cx(ROW, 'mt-1 -mx-3! hidden w-[calc(100%+24px)] sm:flex')}>
            <KeyboardIcon className="text-ink-2" />
            <span className="flex-1">{t.common.shortcuts}</span>
            {/* With the single keys off, "?" would promise a key that does nothing. */}
            {singleKeyShortcuts ? <Kbd>?</Kbd> : <span className="text-[13px] text-ink-3">{t.session.singleKeysOff}</span>}
          </button>
        )}
      </Section>

      {/* What can leave the machine besides the bank's own traffic — each off
          until the user agreed, and absent in a build that does not offer it. */}
      {(meta?.merchantLogos || usage) && (
        <Section title={t.settings.sections.privacy}>
          {meta?.merchantLogos && (
            <div data-setting="logos" className="py-2">
              <Switch
                checked={logoConsent === 'on'}
                onChange={setLogoConsent}
                label={t.session.logos}
                description={t.session.logosHint}
              />
            </div>
          )}
          {usage && (
            <div data-setting="usage" className="py-2">
              <Switch
                checked={usage === 'on'}
                onChange={(on) => void setUsageConsent(on)}
                label={t.session.usage}
                description={t.session.usageHint}
              />
            </div>
          )}
        </Section>
      )}

      <Section title={t.session.thisComputer}>
        {/* The Android app only: fingerprint login, the category model, Play's updates. */}
        <AndroidSettings />

        <MachineRow
          setting="device"
          icon={(
            <MachineIcon tone={deviceRemembered ? 'info' : 'quiet'}>
              <ShieldIcon size={16} check={deviceRemembered} />
            </MachineIcon>
          )}
          title={deviceRemembered ? t.session.deviceRemembered : t.session.deviceNotRemembered}
          hint={deviceRemembered ? t.session.deviceRememberedHint : t.session.deviceNotRememberedHint}
          action={deviceRemembered && (
            // The provider's dialog: the "Gerät gemerkt" toast opens the same one.
            <Button variant="tertiary" size="xs" className="-mr-2 shrink-0" aria-haspopup="dialog" onClick={() => setForgetDeviceOpen(true)}>
              {t.session.forget}
            </Button>
          )}
        />

        {vaultStatus === 'error' && (
          <div data-setting="data" className="mt-3 flex items-start gap-3">
            <MachineIcon>
              <LockIcon size={16} />
              <Dot className="absolute -top-px -right-px ring-2 ring-[var(--paper)]" />
            </MachineIcon>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] leading-snug font-semibold text-ink">{t.session.vaultUnreadable}</p>
              <p className="mt-0.5 text-[13px] leading-snug text-ink-3">{t.session.vaultUnreadableHint}</p>
              <div className="mt-1 -ml-3.5 flex flex-wrap">
                <Button variant="tertiary" size="xs" aria-haspopup="dialog" onClick={() => setDialog('reset')}>
                  {t.session.vaultReset}
                </Button>
                {/* Unreadable with this PIN, but not with the old one: it can
                    still be tried against PINs, so it can be deleted too. */}
                <Button variant="tertiary" size="xs" aria-haspopup="dialog" onClick={() => setDialog('wipe')}>
                  {t.session.vaultDelete}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Whether or not the device is remembered: someone handing the
            computer on needs a way to take their data with them. */}
        {vaultStatus === 'ready' && (
          <MachineRow
            setting="data"
            icon={<MachineIcon><LockIcon size={16} /></MachineIcon>}
            title={t.session.vault}
            hint={t.session.vaultHint}
            action={(
              <Button variant="tertiary" size="xs" className="-mr-2 shrink-0" aria-haspopup="dialog" onClick={() => setDialog('wipe')}>
                {t.session.vaultDelete}
              </Button>
            )}
          />
        )}

        {/* The choice lives in the vault, so it is offered only while the
            vault can be written. Off is the default (owner to confirm). */}
        {vaultStatus === 'ready' && (
          <div data-setting="keep">
            <KeepRow onOff={() => setDialog('keepOff')} onReset={() => setDialog('historyReset')} />
          </div>
        )}

        {/* Said once, quietly: there is nothing the user can do about it here. */}
        {vaultStatus === 'unavailable' && (
          <p className="mt-3 flex items-start gap-2.5 text-[13px] leading-snug text-ink-3">
            <InfoIcon size={16} className="mt-px shrink-0" />
            <span>{t.session.vaultUnavailable}</span>
          </p>
        )}
      </Section>

      <Section title={t.settings.sections.about}>
        {/* Desktop app only: with it, the version is on its row. */}
        <div data-setting="updates">
          <UpdateSessionRow onOpen={() => updates.openDialog()} className={cx(ROW, '-mx-3! flex w-[calc(100%+24px)]')} />
        </div>
        <p className="mt-2 text-[13px] leading-snug text-ink-3">
          {[!update && APP_VERSION ? t.shell.version(APP_VERSION) : '', t.settings.licence].filter(Boolean).join(' · ')}
        </p>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          <ExternalLink href={SOURCE_URL}>{t.settings.source}</ExternalLink>
          <ExternalLink href={PRIVACY_URL}>{t.settings.privacyPolicy}</ExternalLink>
        </div>
      </Section>

      <ResetVaultDialog open={dialog === 'reset'} onClose={closeDialog} />
      <WipeVaultDialog open={dialog === 'wipe'} onClose={closeDialog} />
      <KeepOffDialog open={dialog === 'keepOff'} onClose={closeDialog} />
      <ResetHistoryDialog open={dialog === 'historyReset'} onClose={closeDialog} />
    </div>
  );
}

/** A part of the page: its title, then its rows, standing on the page itself. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="section-head">{title}</h2>
      <div className="mt-2 flex flex-col">{children}</div>
    </section>
  );
}

/** A page outside the app, opened in the browser (electron/main.cjs sends it there). */
function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  const t = useT();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-10 items-center gap-1 rounded-sm text-[14px] font-semibold text-accent underline-offset-4 hover:underline"
    >
      {children}
      <ExternalIcon size={13} />
      <span className="sr-only">{` ${t.shell.opensExternally}`}</span>
    </a>
  );
}
