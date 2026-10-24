'use client';

// The profile chip and its "Sitzung" panel — the session, nothing else:
//
//   who and since when — the holder's picture (initials, or one they chose),
//     the holder, the bank, and one line with the login time and the
//     countdown to the automatic logout;
//   Banken — with more than one bank in the view, each of them and where it
//     stands (a linked one can be removed); with one, only the way to log in
//     to another ("Weitere Bank anmelden", lib/linked-banks.ts);
//   Mitteilungen — on a phone, where the top bar has no bell: the bank's
//     messages and this session's activity (components/Inbox.tsx), with the
//     unread count; the chip carries their dot;
//   Einstellungen — the way to the settings page (components/settings), with
//     a mark while the saved data cannot be read: the one thing there that
//     needs a look.
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
import { IS_ANDROID } from '@/lib/platform';
import { BankLogo } from '../BankLogo';
import { useFints, type BankEntry } from '../FintsProvider';
import { Money } from '../Money';
import { MachineRow, ROW } from '../settings/rows';
import {
  AvatarGlyph, BellIcon, ChevronIcon, GearIcon, LandmarkIcon, LogoutIcon, PencilIcon, PlusIcon, ShieldIcon,
} from '../icons';
import { unseenUpdate, useUpdates } from '../updates/store';
import { usePhone } from './usePhone';
import { Button, Checkbox, Dialog, Dot, IconButton, Overlay, Popover, Segmented, Sheet, cx, type TriggerProps } from '../ui';
import { fmtCountdown, fmtSince, holderName, nameInitials, sessionHolder, useCountdown } from './session';
import { useLookAtUnclear } from './actions';
import { AvatarImageError, avatarFromFile } from './avatar-image';

/**
 * Where the Sitzung panel opens: a popover off the chip on the desktop and the
 * website. In the Android app, Material's modal bottom sheet: it takes the
 * phone's width and goes with the back gesture.
 */
function SessionLayer({ label, trigger, footer, children }: {
  label: string;
  trigger: (props: TriggerProps, state: { open: boolean }) => ReactNode;
  footer: (close: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!IS_ANDROID) {
    return (
      <Popover label={label} placement="bottom-end" className="w-[min(352px,calc(100vw-16px))]" footer={footer} trigger={trigger}>
        {children}
      </Popover>
    );
  }
  const close = () => setOpen(false);
  return (
    <>
      {trigger(
        {
          ref: () => {}, id, 'aria-haspopup': 'dialog', 'aria-expanded': open, 'aria-controls': undefined,
          onClick: () => setOpen(true), onKeyDown: () => {},
        },
        { open },
      )}
      <Overlay open={open} onClose={close} label={label} align="bottom">
        <Sheet onClose={close} footer={footer(close)}>{children(close)}</Sheet>
      </Overlay>
    </>
  );
}

export function ProfileMenu() {
  const t = useT();
  const {
    accounts, vault, vaultStatus, requestLogout, forgetDeviceOpen, setForgetDeviceOpen, openAddBank, openSettings,
    unreadCount, setInboxOpen, tab,
  } = useFints();
  const [removing, setRemoving] = useState<BankEntry | null>(null);
  // Where the top bar has no bell — a phone, and the Übersicht, whose head is
  // the search bar — the Mitteilungen are a row in here, and what is unread
  // there (the bank's messages, a new app version) marks the chip.
  const phone = usePhone();
  const noBell = phone || tab === 'overview';
  const updateUnseen = unseenUpdate(useUpdates());
  const news = noBell && (unreadCount > 0 || updateUnseen);
  // The session's holder, as in the greeting — not the active account's.
  const holder = sessionHolder(accounts);
  const full = holderName(holder);
  const initials = nameInitials(holder);
  // An unreadable store is the one thing in here worth a mark on the chip:
  // until it is reset, nothing the user changes is kept. The dot is only a
  // mark — the name says it too.
  const vaultBroken = vaultStatus === 'error';
  const name = [t.session.chip(full, vaultBroken), noBell && unreadCount > 0 ? t.shell.unread(unreadCount) : ''].filter(Boolean).join(', ');

  return (
    <>
      <SessionLayer
        label={t.session.panel}
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
          // The account's avatar alone, as Material's top app bar ends; its name is the tooltip.
          <IconButton {...props} tone="bar" size="md" aria-label={name}>
            <span className="relative inline-flex shrink-0">
              <Avatar initials={initials} picture={vault?.avatar} image={vault?.avatarImage} tone="bar" />
              {/* Inside the avatar's corner: the icon button clips to its circle, and a
                  dot on the corner itself would lose its top. Its ring is the
                  ground it sits on (the bar's, or the search bar's). */}
              {(vaultBroken || news) && <Dot className="absolute top-px right-px ring-2 ring-[var(--dot-ring,var(--bar))]" />}
            </span>
          </IconButton>
        )}
      >
        {(close) => (
          <SessionPanel
            holder={full}
            initials={initials}
            onSettings={() => {
              close();
              openSettings();
            }}
            onInbox={noBell ? () => {
              close();
              setInboxOpen(true);
            } : undefined}
            unread={unreadCount}
            news={news}
            onAddBank={() => {
              close();
              openAddBank();
            }}
            onRemoveBank={(entry) => {
              close();
              setRemoving(entry);
            }}
          />
        )}
      </SessionLayer>
      {/* Opened from the settings page and by the "Gerät gemerkt" toast's
          action: one confirmation, whatever the way in — so it lives here,
          where the masthead keeps it mounted on every page. */}
      <ForgetDeviceDialog open={forgetDeviceOpen} onClose={() => setForgetDeviceOpen(false)} />
      <RemoveBankDialog entry={removing} onClose={() => setRemoving(null)} />
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

function SessionPanel({
  holder, initials, onSettings, onInbox, unread, news, onAddBank, onRemoveBank,
}: {
  holder: string;
  initials: string;
  onSettings: () => void;
  /** A phone: the Mitteilungen, which have no bell of their own there. */
  onInbox?: () => void;
  unread: number;
  /** Something unread waits in the Mitteilungen. */
  news: boolean;
  onAddBank: () => void;
  onRemoveBank: (entry: BankEntry) => void;
}) {
  const t = useT();
  const {
    bank, sessionStartedAt, idleDeadline, vaultStatus, vault, updateVault, banks, logoFiles,
  } = useFints();
  const left = useCountdown(idleDeadline);
  const [picking, setPicking] = useState(false);
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

      {banks.length > 1 ? (
        <Group title={t.banks.group}>
          {banks.map((b) => (
            <MachineRow
              key={b.key}
              // One column for every mark, a wordmark scaled into it, so the names line up (as in the bank picker).
              icon={(
                <span className="grid w-[52px] shrink-0 place-items-center [&>span]:max-w-full">
                  <BankLogo brand={b.bank.brand} size="sm" file={logoFiles[b.bank.brand]} />
                </span>
              )}
              title={b.bank.name}
              hint={bankHint(b, t)}
              action={b.state !== 'primary' && (
                <Button
                  variant="tertiary"
                  size="xs"
                  className="-mr-2 shrink-0"
                  aria-haspopup="dialog"
                  aria-label={t.banks.removeNamed(b.bank.name)}
                  onClick={() => onRemoveBank(b)}
                >
                  {t.banks.remove}
                </Button>
              )}
            />
          ))}
          <Button variant="tertiary" size="xs" className="mt-2 -ml-3" iconLeft={<PlusIcon size={15} />} onClick={onAddBank}>
            {t.banks.add}
          </Button>
        </Group>
      ) : (
        // One bank: nothing to list — only the way to another.
        <Button variant="tertiary" size="xs" className="mt-1.5 -ml-3" iconLeft={<PlusIcon size={15} />} onClick={onAddBank}>
          {t.banks.add}
        </Button>
      )}

      {/* Everything that is set once lives on its own page; the panel says
          where, and marks it while the saved data needs a look. */}
      <div className="mt-4 border-t border-line pt-2">
        {onInbox && (
          <button type="button" aria-haspopup="dialog" onClick={onInbox} className={cx(ROW, 'flex w-full')}>
            <BellIcon className="text-ink-2" />
            <span className="min-w-0 flex-1">
              <span className="block">{t.common.nav.messages}</span>
              {unread > 0 && <span className="block text-[13px] leading-snug text-ink-3">{t.shell.unread(unread)}</span>}
            </span>
            {news && <Dot />}
            <ChevronIcon dir="right" className="text-ink-3" />
          </button>
        )}
        <button type="button" onClick={onSettings} className={cx(ROW, 'flex w-full')}>
          <GearIcon className="text-ink-2" />
          <span className="min-w-0 flex-1">
            <span className="block">{t.settings.open}</span>
            {vaultStatus === 'error' && <span className="block text-[13px] leading-snug text-ink-3">{t.session.vaultUnreadable}</span>}
          </span>
          {vaultStatus === 'error' && <Dot />}
          <ChevronIcon dir="right" className="text-ink-3" />
        </button>
      </div>
    </>
  );
}

/** Where a bank of the view stands, in the panel's one-line hint. */
function bankHint(b: BankEntry, t: ReturnType<typeof useT>): string {
  if (b.state === 'primary') return t.banks.state.primary;
  if (b.state === 'loggedOut') return t.banks.state.loggedOut;
  if (b.state === 'remembered') return t.banks.state.remembered;
  return b.deviceRemembered ? `${t.banks.state.active} · ${t.session.deviceRemembered}` : t.banks.state.active;
}

/**
 * "Umsätze auf diesem Rechner behalten": a switch with one line under it —
 * what it does while off, since when Umsätze are kept while on, and why
 * nothing is added while the kept file does not open with this PIN (with the
 * way to start over). Switching off asks first (KeepOffDialog): it deletes.
 */
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
 * "Bank entfernen": a linked bank leaves the view and is forgotten by the
 * primary login's store (BLZ, name, login name) — logged out first, if it is
 * logged in. Nothing changes at the bank, and its remembered device stays.
 */
function RemoveBankDialog({ entry, onClose }: { entry: BankEntry | null; onClose: () => void }) {
  const t = useT();
  const { removeBank } = useFints();
  const words = t.banks.removeDialog;
  return (
    <Dialog
      open={!!entry}
      onClose={onClose}
      title={words.title}
      icon={<LandmarkIcon size={20} />}
      description={entry ? words.description(entry.bank.name) : undefined}
      actions={
        <>
          <Button variant="secondary" data-autofocus onClick={onClose}>{t.common.cancel}</Button>
          <Button
            variant="danger"
            onClick={() => {
              if (entry) removeBank(entry);
              onClose();
            }}
          >
            {words.confirm}
          </Button>
        </>
      }
    >
      {/* Indented to the title's edge, under the header's pictogram. */}
      <p className="pl-[54px] text-[14px] leading-relaxed text-ink-2">{words.body}</p>
    </Dialog>
  );
}

