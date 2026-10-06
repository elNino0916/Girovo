'use client';

// The profile chip and its "Sitzung" panel, in three parts:
//
//   who and since when — the holder's picture (initials, or one they chose),
//     the holder, the bank, and one line with the login time and the
//     countdown to the automatic logout;
//   Einstellungen — one row each: how soon that logout comes, the language,
//     the appearance (phones), company logos, usage data, the app's updates
//     (desktop) and the keyboard shortcuts;
//   Auf diesem Rechner — whether the bank remembers this machine, and the
//     encrypted store of personal data, each with its one action.
//
// Kept short on purpose: a row says what a setting is, in a line or two;
// what an action does in full is said by the dialog it opens ("Gerät
// vergessen?", "Gespeicherte Daten löschen?"), right before it is done.
//
// "Abmelden" is the panel's footer and never scrolls away: on a short window
// (the desktop app's 600px minimum, a laptop at 150 %) the body scrolls
// under it. It asks first only while the session log holds a transfer whose
// status is unclear (requestLogout).
//
// A non-modal Popover rather than a role=menu: most of it is information to
// read (a countdown, a status) with a few real controls in between, and a
// menu would announce every line as something to press.

import { useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { AVATAR_IDS, OWN_PICTURE, type AvatarChoice } from '@/lib/avatars';
import type { VaultData } from '@/lib/app-types';
import { rich, useT } from '@/lib/i18n/react';
import { setThemePref } from '@/lib/theme';
import { IDLE_MINUTE_CHOICES, useFints, type IdleMinutes } from '../FintsProvider';
import { useThemePref } from '../ThemeToggle';
import { LanguageSegmented } from '../LanguageToggle';
import { Money } from '../Money';
import { updates } from '../updates/store';
import { UpdateSessionRow } from '../updates/UpdateNotices';
import {
  AvatarGlyph, ChevronIcon, InfoIcon, KeyboardIcon, LockIcon, LogoutIcon, MonitorIcon, MoonIcon, PencilIcon, ShieldIcon, SunIcon,
} from '../icons';
import { Button, Checkbox, Dialog, Dot, Kbd, Popover, Segmented, Select, Switch, cx } from '../ui';
import { setUsageConsent, useUsageConsent } from '../telemetry/usage';
import { fmtCountdown, fmtSince, holderName, nameInitials, firstName, sessionHolder, useCountdown } from './session';
import { useLookAtUnclear } from './actions';
import { AvatarImageError, avatarFromFile } from './avatar-image';

export function ProfileMenu() {
  const t = useT();
  const { accounts, vault, vaultStatus, requestLogout, forgetDeviceOpen, setForgetDeviceOpen } = useFints();
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  // The session's holder, as in the greeting — not the active account's.
  const holder = sessionHolder(accounts);
  const full = holderName(holder);
  const first = firstName(holder);
  const initials = nameInitials(holder);
  // An unreadable store is the one thing in here worth a mark on the chip:
  // until it is reset, nothing the user changes is kept. The dot is only a
  // mark — the name says it too.
  const vaultBroken = vaultStatus === 'error';
  const name = t.session.chip(full, vaultBroken);

  return (
    <>
      <Popover
        label={t.session.panel}
        placement="bottom-end"
        className="w-[min(352px,calc(100vw-16px))]"
        // The session's last word, always in view: the body scrolls, this does not.
        footer={(close) => (
          <Button
            block
            size="sm"
            iconLeft={<LogoutIcon size={16} />}
            onClick={() => {
              // As below: a "Trotzdem abmelden?" hands focus back to the chip.
              close();
              requestLogout();
            }}
          >
            {t.common.logout}
          </Button>
        )}
        trigger={(props) => (
          <button
            {...props}
            type="button"
            aria-label={name}
            title={name}
            className="navlink inline-flex pr-2.5! pl-1.5! sm:@max-[899.98px]/mast:pr-1.5! max-sm:px-1!"
          >
            <span className="relative shrink-0">
              <Avatar initials={initials} picture={vault?.avatar} image={vault?.avatarImage} tone="bar" />
              {vaultBroken && <Dot className="absolute -top-px -right-px ring-2 ring-bar" />}
            </span>
            {first && <span className="hidden max-w-[12ch] truncate @min-[900px]/mast:inline">{first}</span>}
            <ChevronIcon size={14} className="max-sm:hidden" />
          </button>
        )}
      >
        {(close) => (
          <SessionPanel
            holder={full}
            initials={initials}
            onForget={() => {
              // Focus goes back to the chip first, so the confirmation returns
              // it there too — the panel it was opened from is gone by then.
              close();
              setForgetDeviceOpen(true);
            }}
            onReset={() => {
              close();
              setConfirmReset(true);
            }}
            onWipe={() => {
              close();
              setConfirmWipe(true);
            }}
            onShortcuts={close}
            onUpdates={() => {
              close();
              updates.openDialog();
            }}
          />
        )}
      </Popover>
      {/* Also opened by the "Gerät gemerkt" toast's action: one confirmation, whatever the way in. */}
      <ForgetDeviceDialog open={forgetDeviceOpen} onClose={() => setForgetDeviceOpen(false)} />
      <ResetVaultDialog open={confirmReset} onClose={() => setConfirmReset(false)} />
      <WipeVaultDialog open={confirmWipe} onClose={() => setConfirmWipe(false)} />
      <LogoutConfirmDialog />
    </>
  );
}

/** The holder's picture: their own, a line icon they chose (lib/avatars.ts), else their initials. */
function Avatar({
  initials, picture, image, tone,
}: { initials: string; picture?: AvatarChoice; image?: string; tone: 'bar' | 'page' }) {
  return (
    <span
      aria-hidden
      className={cx(
        'grid shrink-0 place-items-center overflow-hidden rounded-full font-bold',
        tone === 'bar'
          ? 'size-7 bg-[color-mix(in_srgb,var(--bar-ink)_16%,transparent)] text-[12px] text-bar-ink'
          // Navy on the inset, not Signal Blue: the picture itself is not the control.
          : 'size-11 bg-inset text-[15px] text-headline',
      )}
    >
      {picture === OWN_PICTURE && image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" draggable={false} className="size-full object-cover" />
      ) : picture && picture !== OWN_PICTURE ? (
        <AvatarGlyph id={picture} size={tone === 'bar' ? 16 : 22} />
      ) : (
        initials || '•'
      )}
    </span>
  );
}

/** A labelled part of the panel, under a hairline. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mt-4 border-t border-line pt-4">
      <h3 id={id} className="text-[13px] font-semibold text-ink-3">{title}</h3>
      {children}
    </section>
  );
}

/** A setting: its name on the left, its control on the right, one row. */
function SettingRow({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  const Label = htmlFor ? 'label' : 'span';
  return (
    <div className="flex min-h-10 items-center justify-between gap-3">
      <Label htmlFor={htmlFor} className="min-w-0 text-[14px] leading-snug text-ink">{label}</Label>
      {children}
    </div>
  );
}

/** A row that opens something: Updates, Tastenkürzel. */
const ROW = '-mx-1.5 min-h-10 items-center gap-3 rounded-[8px] px-3 text-left text-[14px] text-ink hover:bg-inset';

/** A fact about this machine with its one action: the device registration, the saved data. */
function MachineRow({
  icon, title, hint, action,
}: { icon: ReactNode; title: string; hint: string; action?: ReactNode }) {
  return (
    <div className="mt-3 flex items-center gap-3">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-[14px] leading-snug font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-ink-3">{hint}</p>
      </div>
      {action}
    </div>
  );
}

/** The round mark at the start of a MachineRow. */
function MachineIcon({ children, tone = 'quiet' }: { children: ReactNode; tone?: 'quiet' | 'info' }) {
  return (
    <span
      aria-hidden
      className={cx(
        'relative grid size-8 shrink-0 place-items-center rounded-full',
        tone === 'info' ? 'bg-info-soft text-info' : 'bg-inset text-ink-3',
      )}
    >
      {children}
    </span>
  );
}

function SessionPanel({
  holder, initials, onForget, onReset, onWipe, onShortcuts, onUpdates,
}: {
  holder: string;
  initials: string;
  onForget: () => void;
  onReset: () => void;
  onWipe: () => void;
  onShortcuts: () => void;
  onUpdates: () => void;
}) {
  const t = useT();
  const {
    bank, sessionStartedAt, idleDeadline, idleMinutes, setIdleMinutes, deviceRemembered, setShortcutsOpen, vaultStatus,
    singleKeyShortcuts, vault, updateVault,
    meta, logoConsent, setLogoConsent,
  } = useFints();
  const left = useCountdown(idleDeadline);
  const pref = useThemePref();
  const usage = useUsageConsent();
  const [picking, setPicking] = useState(false);
  const idleId = useId();
  const pickerId = useId();

  // Kept with the rest of the personal data (lib/vault.ts): it belongs to
  // this login on this machine, and goes when that data is deleted.
  const setPicture = (choice: AvatarChoice | null) =>
    updateVault((v) => {
      if ((v.avatar ?? null) === choice) return v;
      if (choice) return { ...v, avatar: choice };
      const { avatar: _gone, ...rest } = v;
      return rest as VaultData;
    });
  // An own picture is shown as soon as it is chosen, and kept while an icon
  // is shown instead — until it is removed.
  const setOwnImage = (image: string) => updateVault((v) => ({ ...v, avatar: OWN_PICTURE, avatarImage: image }));
  const removeOwnImage = () =>
    updateVault((v) => {
      if (!v.avatarImage && v.avatar !== OWN_PICTURE) return v;
      const { avatarImage: _gone, ...rest } = v;
      if (rest.avatar === OWN_PICTURE) delete rest.avatar;
      return rest as VaultData;
    });

  // The Popover scrolls this under its pinned "Abmelden" (ProfileMenu above).
  return (
    <>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={t.session.avatar.change}
          title={t.session.avatar.change}
          aria-expanded={picking}
          aria-controls={pickerId}
          onClick={() => setPicking((p) => !p)}
          className="group relative shrink-0 rounded-full"
        >
          <Avatar initials={initials} picture={vault?.avatar} image={vault?.avatarImage} tone="page" />
          <span
            aria-hidden
            className="absolute -right-0.5 -bottom-0.5 grid size-5 place-items-center rounded-full bg-raised text-ink-2 shadow-[0_0_0_1px_var(--line)] group-hover:text-accent"
          >
            <PencilIcon size={11} />
          </span>
        </button>
        <div className="min-w-0">
          <p className="truncate text-[17px] leading-snug font-bold text-headline">{holder || t.session.panel}</p>
          <p className="truncate text-[13px] leading-snug text-ink-3">{bank?.name ?? t.session.loggedIn}</p>
        </div>
      </div>

      {picking && (
        <AvatarPicker
          id={pickerId}
          initials={initials}
          image={vault?.avatarImage ?? null}
          value={vault?.avatar ?? null}
          onChange={setPicture}
          onImage={setOwnImage}
          onRemoveImage={removeOwnImage}
        />
      )}

      <p className="tnum mt-3 text-[13px] leading-snug text-ink-2">
        {rich(t.session.sinceAndLogout(
          fmtSince(sessionStartedAt),
          // A timer, deliberately not live: a screen reader reading every
          // second aloud would make the panel unusable.
          <span role="timer" className="font-semibold text-ink">{left != null ? fmtCountdown(left) : '–'}</span>,
        ))}
      </p>

      <Group title={t.session.settings}>
        <div className="mt-1.5">
          <SettingRow label={t.session.idle} htmlFor={idleId}>
            <Select
              id={idleId}
              value={String(idleMinutes)}
              onChange={(e) => setIdleMinutes(Number(e.target.value) as IdleMinutes)}
              containerClassName="w-auto shrink-0"
              // A row's control, not a form's field: the panel's size, not the form's 48px.
              className="h-9! w-auto! pr-9! pl-3! text-[14px]!"
            >
              {IDLE_MINUTE_CHOICES.map((n) => (
                <option key={n} value={String(n)}>{t.session.idleOption(n)}</option>
              ))}
            </Select>
          </SettingRow>

          <SettingRow label={t.session.language}>
            <LanguageSegmented label={t.session.language} className="shrink-0" />
          </SettingRow>
        </div>

        {/* On a phone the masthead has no room for Darstellung; it lives here. */}
        <div className="mt-2 sm:hidden">
          <p aria-hidden className="mb-2 text-[14px] leading-snug text-ink">{t.common.theme.label}</p>
          <Segmented
            aria-label={t.common.theme.label}
            size="sm"
            block
            value={pref}
            onChange={setThemePref}
            options={[
              { value: 'light', label: t.common.theme.light, icon: <SunIcon size={15} /> },
              { value: 'dark', label: t.common.theme.dark, icon: <MoonIcon size={15} /> },
              { value: 'system', label: t.common.theme.system, icon: <MonitorIcon size={15} /> },
            ]}
          />
        </div>

        {/* The one lookup that carries anything from the bookings off this
            machine, so its switch says what goes out — in one line; the
            consent it was switched on with said it in full. Off until the
            user agreed; absent in a build that does not offer it. */}
        {meta?.merchantLogos && (
          <Switch
            checked={logoConsent === 'on'}
            onChange={setLogoConsent}
            label={t.session.logos}
            description={t.session.logosHint}
            className="mt-3"
          />
        )}

        {/* Desktop app only. Usage goes to the developer only with this on;
            error reports go always, and the description says so — briefly:
            the full account is the Übersicht tile's. */}
        {usage && (
          <Switch
            checked={usage === 'on'}
            onChange={(on) => void setUsageConsent(on)}
            label={t.session.usage}
            description={t.session.usageHint}
            className="mt-3"
          />
        )}

        <div className="mt-2 -mb-1 flex flex-col">
          {/* Desktop app only. */}
          <UpdateSessionRow onOpen={onUpdates} className={cx(ROW, 'flex')} />

          {/* Shortcuts need a keyboard; a phone has none worth listing them for. */}
          <button
            type="button"
            onClick={() => {
              onShortcuts();
              setShortcutsOpen(true);
            }}
            className={cx(ROW, 'hidden sm:flex')}
          >
            <KeyboardIcon className="text-ink-2" />
            <span className="flex-1">{t.common.shortcuts}</span>
            {/* With the single keys off, "?" would promise a key that does nothing. */}
            {singleKeyShortcuts ? <Kbd>?</Kbd> : <span className="text-[13px] text-ink-3">{t.session.singleKeysOff}</span>}
          </button>
        </div>
      </Group>

      <Group title={t.session.thisComputer}>
        <MachineRow
          icon={(
            <MachineIcon tone={deviceRemembered ? 'info' : 'quiet'}>
              <ShieldIcon size={16} check={deviceRemembered} />
            </MachineIcon>
          )}
          title={deviceRemembered ? t.session.deviceRemembered : t.session.deviceNotRemembered}
          hint={deviceRemembered ? t.session.deviceRememberedHint : t.session.deviceNotRememberedHint}
          action={deviceRemembered && (
            <Button variant="tertiary" size="xs" className="-mr-2 shrink-0" aria-haspopup="dialog" onClick={onForget}>
              {t.session.forget}
            </Button>
          )}
        />

        {vaultStatus === 'error' && (
          <div className="mt-3 flex items-start gap-3">
            <MachineIcon>
              <LockIcon size={16} />
              <Dot className="absolute -top-px -right-px ring-2 ring-[var(--raised)]" />
            </MachineIcon>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] leading-snug font-semibold text-ink">{t.session.vaultUnreadable}</p>
              <p className="mt-0.5 text-[13px] leading-snug text-ink-3">{t.session.vaultUnreadableHint}</p>
              <div className="mt-1 -ml-3.5 flex flex-wrap">
                <Button variant="tertiary" size="xs" aria-haspopup="dialog" onClick={onReset}>
                  {t.session.vaultReset}
                </Button>
                {/* Unreadable with this PIN, but not with the old one: it can
                    still be tried against PINs, so it can be deleted too. */}
                <Button variant="tertiary" size="xs" aria-haspopup="dialog" onClick={onWipe}>
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
            icon={<MachineIcon><LockIcon size={16} /></MachineIcon>}
            title={t.session.vault}
            hint={t.session.vaultHint}
            action={(
              <Button variant="tertiary" size="xs" className="-mr-2 shrink-0" aria-haspopup="dialog" onClick={onWipe}>
                {t.session.vaultDelete}
              </Button>
            )}
          />
        )}

        {/* Said once, quietly: there is nothing the user can do about it here. */}
        {vaultStatus === 'unavailable' && (
          <p className="mt-3 flex items-start gap-2.5 text-[13px] leading-snug text-ink-3">
            <InfoIcon size={16} className="mt-px shrink-0" />
            <span>{t.session.vaultUnavailable}</span>
          </p>
        )}
      </Group>
    </>
  );
}

/** Columns of the picture grid; the arrows move by one, up and down by a row. */
const PICKER_COLUMNS = 6;
/** What a file dialog offers: what the page can open. */
const PICTURE_FILES = 'image/png,image/jpeg,image/webp,image/gif,image/bmp';

/**
 * The pictures to choose from: the initials, the user's own picture while
 * there is one, the line icons. A radio group with one tab stop: the arrows
 * move and choose at once, as in a Segmented control, and the choice shows on
 * the chip straight away. Under it, the way to an own picture — read and made
 * small in the page (avatar-image.ts), so the file itself goes nowhere.
 */
function AvatarPicker({
  id, initials, image, value, onChange, onImage, onRemoveImage,
}: {
  id: string;
  initials: string;
  image: string | null;
  value: AvatarChoice | null;
  onChange: (next: AvatarChoice | null) => void;
  onImage: (image: string) => void;
  onRemoveImage: () => void;
}) {
  const t = useT();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<AvatarImageError['reason'] | null>(null);
  const pictures: (AvatarChoice | null)[] = image ? [null, OWN_PICTURE, ...AVATAR_IDS] : [null, ...AVATAR_IDS];
  const current = Math.max(0, pictures.indexOf(value));

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const last = pictures.length - 1;
    const step: Record<string, number> = {
      ArrowRight: 1, ArrowLeft: -1, ArrowDown: PICKER_COLUMNS, ArrowUp: -PICKER_COLUMNS,
    };
    let next: number | null = null;
    if (e.key in step) next = Math.min(Math.max(current + step[e.key], 0), last);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next == null) return;
    e.preventDefault();
    onChange(pictures[next]);
    refs.current[next]?.focus();
  };

  const read = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    setReading(true);
    try {
      onImage(await avatarFromFile(file));
    } catch (err) {
      setProblem(err instanceof AvatarImageError ? err.reason : 'unreadable');
    } finally {
      setReading(false);
      // The same file again is a choice again.
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div id={id} className="mt-3 rounded-[8px] bg-inset p-2">
      <div
        role="radiogroup"
        aria-label={t.session.avatar.choose}
        onKeyDown={onKeyDown}
        className="grid grid-cols-6 justify-items-center gap-y-2"
      >
        {pictures.map((picture, i) => {
          const checked = picture === value;
          const label = picture === OWN_PICTURE
            ? t.session.avatar.own
            : picture
              ? t.session.avatar.names[picture]
              : t.session.avatar.initials;
          return (
            <button
              key={picture ?? 'initials'}
              ref={(el) => { refs.current[i] = el; }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={label}
              title={label}
              tabIndex={checked ? 0 : -1}
              onClick={() => onChange(picture)}
              className={cx(
                'grid size-10 place-items-center overflow-hidden rounded-full bg-raised text-headline transition-shadow duration-150',
                // The chosen one: the selected-segment edge (DESIGN.md), not a fill.
                checked ? 'text-accent shadow-[inset_0_0_0_1.5px_var(--accent)]' : 'hover:shadow-[inset_0_0_0_1px_var(--line)]',
              )}
            >
              {picture === OWN_PICTURE && image ? (
                // The edge is drawn over the picture: a ring of the inset first, then the blue.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={image}
                  alt=""
                  draggable={false}
                  className={cx('size-full rounded-full object-cover', checked && 'p-[3px]')}
                />
              ) : picture && picture !== OWN_PICTURE ? (
                <AvatarGlyph id={picture} size={20} />
              ) : (
                <span className="text-[13px] font-bold">{initials || '•'}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center">
        <input
          ref={fileRef}
          type="file"
          accept={PICTURE_FILES}
          tabIndex={-1}
          aria-hidden
          className="sr-only"
          onChange={(e) => void read(e.target.files?.[0])}
        />
        <Button variant="tertiary" size="xs" busy={reading} onClick={() => fileRef.current?.click()}>
          {t.session.avatar.chooseFile}
        </Button>
        {image && (
          <Button variant="tertiary" size="xs" onClick={() => { setProblem(null); onRemoveImage(); }}>
            {t.session.avatar.removeFile}
          </Button>
        )}
      </div>
      {problem ? (
        <p role="alert" className="px-3 pb-1 text-[12.5px] leading-snug text-red">
          {problem === 'too-large' ? t.session.avatar.tooLarge : t.session.avatar.unreadable}
        </p>
      ) : (
        <p className="px-3 pb-1 text-[12.5px] leading-snug text-ink-3">{t.session.avatar.stays}</p>
      )}
    </div>
  );
}

/**
 * "Trotzdem abmelden?" — asked only while this session's log holds a
 * transfer whose outcome is unclear (requestLogout, from the panel or the
 * palette). The logout clears that log, the one record in the app of an
 * order that may have moved money, so the safe answer comes first: look.
 */
function LogoutConfirmDialog() {
  const t = useT();
  const { logoutConfirmOpen, closeLogoutConfirm, logout } = useFints();
  // One order: its payee's bookings, on its own account — never a bank read
  // from here; a list that cannot show that account says so. Several:
  // Mitteilungen, where each has its own way to look.
  const { unclear, one, look: lookAt, lookLabel } = useLookAtUnclear();
  const look = () => {
    closeLogoutConfirm();
    lookAt();
  };

  return (
    <Dialog
      open={logoutConfirmOpen && unclear.length > 0}
      onClose={closeLogoutConfirm}
      title={t.session.logoutConfirm.title}
      icon={<LogoutIcon size={20} />}
      description={one
        ? rich(t.session.logoutConfirm.one(one.name, <Money value={one.amount} className="font-semibold text-ink" />))
        : t.session.logoutConfirm.several(unclear.length)}
      actions={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              closeLogoutConfirm();
              void logout('user');
            }}
          >
            {t.common.logout}
          </Button>
          <Button variant="primary" data-autofocus onClick={look}>{lookLabel}</Button>
        </>
      }
    >
      {/* Indented to the title's edge, under the header's pictogram. */}
      <p className="pl-[54px] text-[14px] leading-relaxed text-ink-2">
        {one ? t.session.logoutConfirm.afterOne : t.session.logoutConfirm.afterSeveral}
      </p>
    </Dialog>
  );
}

/**
 * "Gerät vergessen" deletes the stored device registration for this bank
 * login. Worth a confirmation: the consequence only shows at the next login,
 * when the bank treats this machine as new and asks for an approval again.
 *
 * On its own it is also simply the way to have the bank register this
 * machine afresh, so it keeps the Vorlagen. Handing the computer on is what
 * the box is for: the saved data is sealed under the PIN like the device
 * registration, and left behind it could be tried against PINs offline. The
 * box takes the login name and the bank the login screen fills in too
 * (wipeVaultWith in the provider).
 */
function ForgetDeviceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { bank, forgetDevice } = useFints();
  const [busy, setBusy] = useState(false);
  const [wipe, setWipe] = useState(false);
  const close = () => {
    setWipe(false);
    onClose();
  };
  const run = async () => {
    setBusy(true);
    try {
      await forgetDevice({ wipeData: wipe });
    } finally {
      setBusy(false);
      close();
    }
  };
  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : close}
      title={t.session.forgetDialog.title}
      icon={<ShieldIcon size={20} />}
      description={t.session.forgetDialog.description(bank?.name ?? null)}
      actions={
        <>
          {/* Focus starts here, not on the box: Space must never arm the deletion. */}
          <Button variant="secondary" data-autofocus onClick={close} disabled={busy}>{t.common.cancel}</Button>
          <Button variant={wipe ? 'danger' : 'primary'} busy={busy} onClick={() => void run()}>
            {wipe ? t.session.forgetDialog.confirmWipe : t.session.forgetDialog.confirm}
          </Button>
        </>
      }
    >
      {/* Indented to the title's edge, under the header's pictogram. */}
      <div className="pl-[54px]">
        <p className="text-[14px] leading-relaxed text-ink-2">{t.session.forgetDialog.body}</p>
        <Checkbox
          className="mt-3"
          label={t.session.forgetDialog.wipe}
          description={t.session.forgetDialog.wipeHint}
          checked={wipe}
          disabled={busy}
          onChange={(e) => setWipe(e.target.checked)}
        />
      </div>
    </Dialog>
  );
}

/**
 * The way out of an unreadable store. Nothing is deleted: the server sets the
 * old file aside and starts an empty one, and what was changed in memory
 * during this session is kept and saved from then on.
 */
function ResetVaultDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { resetVault } = useFints();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      // Reports its own outcome as a toast, success or failure.
      await resetVault();
    } finally {
      setBusy(false);
      onClose();
    }
  };
  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      title={t.session.resetDialog.title}
      icon={<LockIcon size={20} />}
      description={t.session.resetDialog.description}
      actions={
        <>
          <Button variant="secondary" data-autofocus onClick={onClose} disabled={busy}>{t.common.cancel}</Button>
          <Button variant="primary" busy={busy} onClick={() => void run()}>{t.session.resetDialog.confirm}</Button>
        </>
      }
    >
      {/* Indented to the title's edge, under the header's pictogram. */}
      <p className="pl-[54px] text-[14px] leading-relaxed text-ink-2">{t.session.resetDialog.body}</p>
    </Dialog>
  );
}

/**
 * Deletes the saved personal data from this machine for good — the file and
 * every backup a reset left behind, and the login name and bank the login
 * screen fills in — without touching the device registration. The session
 * goes on; what changes until the logout is kept in memory only, so nothing
 * writes the file again.
 */
function WipeVaultDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { wipeVault } = useFints();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      // Reports its own outcome as a toast, success or failure.
      await wipeVault();
    } finally {
      setBusy(false);
      onClose();
    }
  };
  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      title={t.session.wipeDialog.title}
      icon={<LockIcon size={20} />}
      description={t.session.wipeDialog.description}
      actions={
        <>
          <Button variant="secondary" data-autofocus onClick={onClose} disabled={busy}>{t.common.cancel}</Button>
          <Button variant="danger" busy={busy} onClick={() => void run()}>{t.common.delete}</Button>
        </>
      }
    >
      {/* Indented to the title's edge, under the header's pictogram. */}
      <p className="pl-[54px] text-[14px] leading-relaxed text-ink-2">{t.session.wipeDialog.body}</p>
    </Dialog>
  );
}
