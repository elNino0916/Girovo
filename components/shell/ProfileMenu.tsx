'use client';

// The profile chip and its "Sitzung" panel, in three parts:
//
//   who and since when — the holder, the bank, the login time and the
//     countdown to the automatic logout;
//   Einstellungen — how soon that logout comes, the appearance (phones),
//     company logos, the app's updates (desktop) and the keyboard shortcuts;
//   Auf diesem Rechner — whether the bank remembers this machine, and the
//     encrypted store of personal data (Vorlagen, Kontonamen, Kategorien, the
//     transfers of the last 14 days that the duplicate warning reads): the way
//     out when it cannot be opened, and the way to delete it.
//
// "Abmelden" is the panel's footer and never scrolls away: on a short window
// (the desktop app's 600px minimum, a laptop at 150 %) the body scrolls
// under it. It asks first only while the session log holds a transfer whose
// status is unclear (requestLogout).
//
// A non-modal Popover rather than a role=menu: most of it is information to
// read (a countdown, a status) with a few real controls in between, and a
// menu would announce every line as something to press.

import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { setThemePref } from '@/lib/theme';
import { unclearTransfers } from '@/lib/session-log';
import { IDLE_MINUTE_CHOICES, useFints, type IdleMinutes } from '../FintsProvider';
import { useThemePref } from '../ThemeToggle';
import { Money } from '../Money';
import { updates } from '../updates/store';
import { UpdateSessionRow } from '../updates/UpdateNotices';
import { ChevronIcon, InfoIcon, KeyboardIcon, LockIcon, LogoutIcon, MonitorIcon, MoonIcon, ShieldIcon, SunIcon } from '../icons';
import { Button, Checkbox, Dialog, Dot, Kbd, Popover, Segmented, Switch, cx } from '../ui';
import { LOGO_DISCLOSURE } from '../MerchantLogoConsent';
import { fmtCountdown, fmtSince, holderName, nameInitials, firstName, sessionHolder, useCountdown } from './session';

export function ProfileMenu() {
  const { accounts, vaultStatus, requestLogout } = useFints();
  const [confirmForget, setConfirmForget] = useState(false);
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
  const name = (full ? `Sitzung von ${full}` : 'Sitzung') + (vaultBroken ? ' – gespeicherte Daten nicht lesbar' : '');

  return (
    <>
      <Popover
        label="Sitzung"
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
            Abmelden
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
              <Avatar initials={initials} tone="bar" />
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
              setConfirmForget(true);
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
      <ForgetDeviceDialog open={confirmForget} onClose={() => setConfirmForget(false)} />
      <ResetVaultDialog open={confirmReset} onClose={() => setConfirmReset(false)} />
      <WipeVaultDialog open={confirmWipe} onClose={() => setConfirmWipe(false)} />
      <LogoutConfirmDialog />
    </>
  );
}

function Avatar({ initials, tone }: { initials: string; tone: 'bar' | 'page' }) {
  return (
    <span
      aria-hidden
      className={cx(
        'grid shrink-0 place-items-center rounded-full font-bold',
        tone === 'bar'
          ? 'size-7 bg-[color-mix(in_srgb,var(--bar-ink)_16%,transparent)] text-[12px] text-bar-ink'
          // Navy on the inset, not Signal Blue: the initials cannot be pressed.
          : 'size-11 bg-inset text-[15px] text-headline',
      )}
    >
      {initials || '•'}
    </span>
  );
}

const IDLE_OPTIONS = IDLE_MINUTE_CHOICES.map((n) => ({ value: String(n), label: `${n} Min` }));

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

/** A row that opens something: Updates, Tastenkürzel. */
const ROW = '-mx-1.5 min-h-10 items-center gap-3 rounded-[8px] px-3 text-left text-[14px] text-ink hover:bg-inset';

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
  const {
    bank, sessionStartedAt, idleDeadline, idleMinutes, setIdleMinutes, deviceRemembered, setShortcutsOpen, vaultStatus,
    singleKeyShortcuts,
    meta, logoConsent, setLogoConsent,
  } = useFints();
  const left = useCountdown(idleDeadline);
  const pref = useThemePref();

  // The Popover scrolls this under its pinned "Abmelden" (ProfileMenu above).
  return (
    <>
      <div className="flex items-center gap-3">
        <Avatar initials={initials} tone="page" />
        <div className="min-w-0">
          <p className="truncate text-[17px] leading-snug font-bold text-headline">{holder || 'Sitzung'}</p>
          <p className="truncate text-[13px] leading-snug text-ink-3">{bank?.name ?? 'Angemeldet'}</p>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[14px] leading-snug">
        <dt className="text-ink-2">Angemeldet seit</dt>
        <dd className="tnum text-right font-semibold text-ink">{fmtSince(sessionStartedAt)}</dd>
        <dt className="text-ink-2">Automatische Abmeldung in</dt>
        <dd className="tnum text-right font-semibold text-ink">
          {/* A timer, deliberately not live: a screen reader reading every
              second aloud would make the panel unusable. */}
          <span role="timer">
            {left != null ? fmtCountdown(left) : '–'}
          </span>
        </dd>
      </dl>

      <Group title="Einstellungen">
        <p aria-hidden className="mt-2.5 mb-2 text-[14px] leading-snug text-ink">Automatisch abmelden nach</p>
        <Segmented
          aria-label="Automatisch abmelden nach"
          size="sm"
          block
          options={IDLE_OPTIONS}
          value={String(idleMinutes)}
          onChange={(v) => setIdleMinutes(Number(v) as IdleMinutes)}
        />

        {/* On a phone the masthead has no room for Darstellung; it lives here. */}
        <div className="mt-4 sm:hidden">
          <p aria-hidden className="mb-2 text-[14px] leading-snug text-ink">Darstellung</p>
          <Segmented
            aria-label="Darstellung"
            size="sm"
            block
            value={pref}
            onChange={setThemePref}
            options={[
              { value: 'light', label: 'Hell', icon: <SunIcon size={15} /> },
              { value: 'dark', label: 'Dunkel', icon: <MoonIcon size={15} /> },
              { value: 'system', label: 'System', icon: <MonitorIcon size={15} /> },
            ]}
          />
        </div>

        {/* The one lookup that carries anything from the bookings off this
            machine, so its switch says exactly what goes out. Off until the
            user agreed; absent in a build that does not offer it. */}
        {meta?.merchantLogos && (
          <Switch
            checked={logoConsent === 'on'}
            onChange={setLogoConsent}
            label="Firmenlogos"
            description={LOGO_DISCLOSURE}
            className="mt-4"
          />
        )}

        <div className="mt-2.5 -mb-1 flex flex-col">
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
            <span className="flex-1">Tastenkürzel</span>
            {/* With the single keys off, "?" would promise a key that does nothing. */}
            {singleKeyShortcuts ? <Kbd>?</Kbd> : <span className="text-[13px] text-ink-3">Einzeltasten aus</span>}
          </button>
        </div>
      </Group>

      <Group title="Auf diesem Rechner">
        <div className="mt-3 flex items-start gap-3">
          <span
            aria-hidden
            className={cx(
              'mt-0.5 grid size-8 shrink-0 place-items-center rounded-full',
              deviceRemembered ? 'bg-info-soft text-info' : 'bg-inset text-ink-3',
            )}
          >
            <ShieldIcon size={16} check={deviceRemembered} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] leading-snug font-semibold text-ink">
              {deviceRemembered ? 'Dieses Gerät ist gemerkt' : 'Dieses Gerät ist nicht gemerkt'}
            </p>
            <p className="mt-0.5 text-[13px] leading-snug text-ink-3">
              {deviceRemembered
                ? 'Deine Bank fragt bei der Anmeldung seltener nach einer Freigabe.'
                : 'Bei der nächsten Anmeldung fragt deine Bank nach einer Freigabe.'}
            </p>
            {deviceRemembered && (
              <Button variant="tertiary" size="xs" className="mt-1.5 -ml-3.5" aria-haspopup="dialog" onClick={onForget}>
                Gerät vergessen …
              </Button>
            )}
          </div>
        </div>

        {vaultStatus === 'error' && (
          <div className="mt-4 flex items-start gap-3">
            <span aria-hidden className="relative mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-inset text-ink-2">
              <LockIcon size={16} />
              <Dot className="absolute -top-px -right-px ring-2 ring-[var(--raised)]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] leading-snug font-semibold text-ink">Gespeicherte Daten nicht lesbar</p>
              <p className="mt-0.5 text-[13px] leading-snug text-ink-3">
                Deine gespeicherten Vorlagen, Kontonamen und Kategorien konnten nicht geöffnet werden – meist, weil sich
                deine PIN geändert hat. Was du jetzt änderst, wird nicht gespeichert.
              </p>
              <div className="mt-1.5 -ml-3.5 flex flex-wrap">
                <Button variant="tertiary" size="xs" aria-haspopup="dialog" onClick={onReset}>
                  Gespeicherte Daten zurücksetzen …
                </Button>
                {/* Unreadable with this PIN, but not with the old one: it can
                    still be tried against PINs, so it can be deleted too. */}
                <Button variant="tertiary" size="xs" aria-haspopup="dialog" onClick={onWipe}>
                  Löschen …
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Whether or not the device is remembered: someone handing the
            computer on needs a way to take their data with them. */}
        {vaultStatus === 'ready' && (
          <div className="mt-4 flex items-start gap-3">
            <span aria-hidden className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-inset text-ink-3">
              <LockIcon size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] leading-snug font-semibold text-ink">Gespeicherte Daten</p>
              <p className="mt-0.5 text-[13px] leading-snug text-ink-3">
                Vorlagen, Kontonamen, Kategorien und deine Überweisungen der letzten 14 Tage (für die Warnung vor
                doppelten Zahlungen) liegen verschlüsselt auf diesem Rechner.
              </p>
              <Button variant="tertiary" size="xs" className="mt-1.5 -ml-3.5" aria-haspopup="dialog" onClick={onWipe}>
                Von diesem Rechner löschen …
              </Button>
            </div>
          </div>
        )}

        {/* Said once, quietly: there is nothing the user can do about it here. */}
        {vaultStatus === 'unavailable' && (
          <p className="mt-4 flex items-start gap-2.5 text-[13px] leading-snug text-ink-3">
            <InfoIcon size={16} className="mt-px shrink-0" />
            <span>
              Vorlagen, Kontonamen und Kategorien können in dieser Sitzung nicht gespeichert werden. Was du änderst, gilt
              bis zum Abmelden.
            </span>
          </p>
        )}
      </Group>
    </>
  );
}

/**
 * "Trotzdem abmelden?" — asked only while this session's log holds a
 * transfer whose outcome is unclear (requestLogout, from the panel or the
 * palette). The logout clears that log, the one record in the app of an
 * order that may have moved money, so the safe answer comes first: look.
 */
function LogoutConfirmDialog() {
  const {
    logoutConfirmOpen, closeLogoutConfirm, logout, activity, activeAccount, accounts,
    isLoadedForAppliedRange, selectAccount, showTransactions, setInboxOpen,
  } = useFints();
  const unclear = unclearTransfers(activity);
  const one = unclear.length === 1 ? unclear[0] : null;

  // One order: its payee's bookings, on its account when that is answered
  // from the cache — never a bank read from here. Several: Mitteilungen,
  // where each has its own way to look.
  const look = () => {
    closeLogoutConfirm();
    if (!one) {
      setInboxOpen(true);
      return;
    }
    const account = accounts.find((a) => a.accountNumber === one.accountNumber);
    if (account && account.accountNumber !== activeAccount?.accountNumber && isLoadedForAppliedRange(account.accountNumber)) {
      selectAccount(account);
    }
    showTransactions({ query: one.iban });
  };

  return (
    <Dialog
      open={logoutConfirmOpen && unclear.length > 0}
      onClose={closeLogoutConfirm}
      title="Trotzdem abmelden?"
      icon={<LogoutIcon size={20} />}
      description={one ? (
        <>
          Ob deine Überweisung an {one.name || 'den Empfänger'} über{' '}
          <Money value={one.amount} className="font-semibold text-ink" /> ausgeführt wurde, ist unklar.
        </>
      ) : (
        <>Bei {unclear.length} Überweisungen dieser Sitzung ist unklar, ob sie ausgeführt wurden.</>
      )}
      actions={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              closeLogoutConfirm();
              void logout('user');
            }}
          >
            Abmelden
          </Button>
          <Button variant="primary" data-autofocus onClick={look}>
            {one ? 'Umsätze prüfen' : 'In Mitteilungen ansehen'}
          </Button>
        </>
      }
    >
      {/* Indented to the title's edge, under the header's pictogram. */}
      <p className="pl-[54px] text-[14px] leading-relaxed text-ink-2">
        {one
          ? 'Nach dem Abmelden steht sie nicht mehr in den Mitteilungen. Sende sie nicht noch einmal, bevor du in deinen Umsätzen nachgesehen hast.'
          : 'Nach dem Abmelden stehen sie nicht mehr in den Mitteilungen. Sende keine davon noch einmal, bevor du in deinen Umsätzen nachgesehen hast.'}
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
      title="Gerät vergessen?"
      icon={<ShieldIcon size={20} />}
      description={
        <>
          Die App löscht die Geräte-Kennung, unter der {bank?.name ?? 'deine Bank'} diesen Rechner kennt. Bei der
          nächsten Anmeldung gilt er als neues Gerät: Deine Bank fragt dann wieder nach einer Freigabe.
        </>
      }
      actions={
        <>
          {/* Focus starts here, not on the box: Space must never arm the deletion. */}
          <Button variant="secondary" data-autofocus onClick={close} disabled={busy}>Abbrechen</Button>
          <Button variant={wipe ? 'danger' : 'primary'} busy={busy} onClick={() => void run()}>
            {wipe ? 'Vergessen und löschen' : 'Gerät vergessen'}
          </Button>
        </>
      }
    >
      {/* Indented to the title's edge, under the header's pictogram. */}
      <div className="pl-[54px]">
        <p className="text-[14px] leading-relaxed text-ink-2">
          Deine aktuelle Sitzung bleibt bestehen. Gibst du den Rechner weiter, lösche auch deine gespeicherten Daten.
        </p>
        <Checkbox
          className="mt-3"
          label="Auch gespeicherte Daten von diesem Rechner löschen"
          description="Vorlagen, Kontonamen, Kategorien und die Überweisungen der letzten 14 Tage samt früherer Sicherungen, dazu der Anmeldename und die Bank, die die Anmeldung vorausfüllt – endgültig."
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
      title="Gespeicherte Daten zurücksetzen?"
      icon={<LockIcon size={20} />}
      description="Es wird eine neue, leere Ablage angelegt. Die alte Datei bleibt als Sicherung auf diesem Rechner."
      actions={
        <>
          <Button variant="secondary" data-autofocus onClick={onClose} disabled={busy}>Abbrechen</Button>
          <Button variant="primary" busy={busy} onClick={() => void run()}>Zurücksetzen</Button>
        </>
      }
    >
      {/* Indented to the title's edge, under the header's pictogram. */}
      <p className="pl-[54px] text-[14px] leading-relaxed text-ink-2">
        Vorlagen, Kontonamen und Kategorien beginnen dann neu. Was du in dieser Sitzung schon geändert hast, wird
        übernommen und ab jetzt wieder gespeichert.
      </p>
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
      title="Gespeicherte Daten löschen?"
      icon={<LockIcon size={20} />}
      description="Vorlagen, Kontonamen, Kategorien und die Überweisungen der letzten 14 Tage werden von diesem Rechner gelöscht, frühere Sicherungen eingeschlossen – dazu der Anmeldename und die Bank, die die Anmeldung vorausfüllt. Das lässt sich nicht rückgängig machen."
      actions={
        <>
          <Button variant="secondary" data-autofocus onClick={onClose} disabled={busy}>Abbrechen</Button>
          <Button variant="danger" busy={busy} onClick={() => void run()}>Löschen</Button>
        </>
      }
    >
      {/* Indented to the title's edge, under the header's pictogram. */}
      <p className="pl-[54px] text-[14px] leading-relaxed text-ink-2">
        Deine aktuelle Sitzung bleibt bestehen. Was du bis zum Abmelden änderst, wird nicht mehr gespeichert; bei der
        nächsten Anmeldung beginnst du mit leeren Vorlagen.
      </p>
    </Dialog>
  );
}
