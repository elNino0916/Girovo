'use client';

// The profile chip and its "Sitzung" panel: who is signed in, since when, how
// long until the app signs them out on its own, how long that should be, and
// whether this machine is remembered by the bank — and the encrypted store of
// personal data (Vorlagen, Kontonamen, Kategorien, the transfers of the last
// 14 days that the duplicate warning reads): the way out when it cannot
// be opened, and the way to delete it from this machine. In the desktop app it
// also names the app's version and leads to its updates.
//
// A non-modal Popover rather than a role=menu: most of it is information to
// read (a countdown, a status) with two real controls in between, and a menu
// would announce every line as something to press.

import { useState } from 'react';
import { setThemePref } from '@/lib/theme';
import { IDLE_MINUTE_CHOICES, useFints, type IdleMinutes } from '../FintsProvider';
import { useThemePref } from '../ThemeToggle';
import { updates } from '../updates/store';
import { UpdateSessionRow } from '../updates/UpdateNotices';
import { ChevronIcon, InfoIcon, KeyboardIcon, LockIcon, LogoutIcon, MonitorIcon, MoonIcon, ShieldIcon, SunIcon } from '../icons';
import { Button, Checkbox, Dialog, Dot, Kbd, Popover, Segmented, Switch, cx } from '../ui';
import { LOGO_DISCLOSURE } from '../MerchantLogoConsent';
import { fmtCountdown, fmtSince, holderName, nameInitials, firstName, useCountdown } from './session';

export function ProfileMenu() {
  const { activeAccount, accounts, vaultStatus } = useFints();
  const [confirmForget, setConfirmForget] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const holder = activeAccount?.holder || accounts[0]?.holder || '';
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
        className="w-[min(340px,calc(100vw-16px))]"
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
          : 'size-11 bg-accent-soft text-[15px] text-accent',
      )}
    >
      {initials || '•'}
    </span>
  );
}

const IDLE_OPTIONS = IDLE_MINUTE_CHOICES.map((n) => ({ value: String(n), label: `${n} Min` }));

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
    singleKeyShortcuts, logout,
    meta, logoConsent, setLogoConsent,
  } = useFints();
  const left = useCountdown(idleDeadline);
  const pref = useThemePref();

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3">
        <Avatar initials={initials} tone="page" />
        <div className="min-w-0">
          <p className="truncate text-[16px] leading-snug font-bold text-ink">{holder || 'Sitzung'}</p>
          <p className="truncate text-[13px] leading-snug text-ink-3">{bank?.name ?? 'Angemeldet'}</p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 rounded-[10px] bg-inset px-3.5 py-3 text-[14px] leading-snug">
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

      <div className="mt-4">
        <p aria-hidden className="mb-2 text-[13px] font-semibold text-ink-2">Abmelden nach Inaktivität</p>
        <Segmented
          aria-label="Abmelden nach Inaktivität"
          size="sm"
          block
          options={IDLE_OPTIONS}
          value={String(idleMinutes)}
          onChange={(v) => setIdleMinutes(Number(v) as IdleMinutes)}
        />
      </div>

      {/* On a phone the masthead has no room for Darstellung; it lives here. */}
      <div className="mt-4 sm:hidden">
        <p aria-hidden className="mb-2 text-[13px] font-semibold text-ink-2">Darstellung</p>
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

      <div className="mt-4 flex items-start gap-3 border-t border-line pt-4">
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
              ? 'Die Bank fragt bei der Anmeldung seltener nach einer TAN.'
              : 'Bei der nächsten Anmeldung fragt die Bank nach einer TAN.'}
          </p>
          {deviceRemembered && (
            <Button variant="tertiary" size="xs" className="mt-1.5 -ml-3.5" aria-haspopup="dialog" onClick={onForget}>
              Gerät vergessen …
            </Button>
          )}
        </div>
      </div>

      {vaultStatus === 'error' && (
        <div className="mt-4 flex items-start gap-3 border-t border-line pt-4">
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
        <div className="mt-4 flex items-start gap-3 border-t border-line pt-4">
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
        <p className="mt-4 flex items-start gap-2.5 border-t border-line pt-4 text-[13px] leading-snug text-ink-3">
          <InfoIcon size={16} className="mt-px shrink-0" />
          <span>
            Vorlagen, Kontonamen und Kategorien können in dieser Sitzung nicht gespeichert werden. Was du änderst, gilt
            bis zum Abmelden.
          </span>
        </p>
      )}

      {/* The one lookup that carries anything from the bookings off this
          machine, so its switch says exactly what goes out. Off until the
          user agreed; absent in a build that does not offer it. */}
      {meta?.merchantLogos && (
        <div className="mt-4 border-t border-line pt-4">
          <Switch
            checked={logoConsent === 'on'}
            onChange={setLogoConsent}
            label="Firmenlogos"
            description={LOGO_DISCLOSURE}
          />
        </div>
      )}

      <div className="mt-3 -mb-1.5 flex flex-col">
        {/* Desktop app only. */}
        <UpdateSessionRow onOpen={onUpdates} />

        {/* Shortcuts need a keyboard; a phone has none worth listing them for. */}
        <button
          type="button"
          onClick={() => {
            onShortcuts();
            setShortcutsOpen(true);
          }}
          className="-mx-1.5 hidden min-h-10 items-center gap-3 rounded-[8px] px-3 text-left text-[14px] text-ink hover:bg-inset sm:flex"
        >
          <KeyboardIcon className="text-ink-2" />
          <span className="flex-1">Tastenkürzel</span>
          {/* With the single keys off, "?" would promise a key that does nothing. */}
          {singleKeyShortcuts ? <Kbd>?</Kbd> : <span className="text-[13px] text-ink-3">Einzeltasten aus</span>}
        </button>
      </div>

      {/* The session's last word, at the end of the panel about it. */}
      <div className="mt-3 border-t border-line pt-3">
        <Button block size="sm" iconLeft={<LogoutIcon size={16} />} onClick={() => void logout('user')}>
          Abmelden
        </Button>
      </div>
    </div>
  );
}

/**
 * "Gerät vergessen" deletes the stored device registration for this bank
 * login. Worth a confirmation: the consequence only shows at the next login,
 * when the bank treats this machine as new and asks for a TAN again.
 *
 * On its own it is also simply the way to have the bank register this
 * machine afresh, so it keeps the Vorlagen. Handing the computer on is what
 * the box is for: the saved data is sealed under the PIN like the device
 * registration, and left behind it could be tried against PINs offline.
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
          nächsten Anmeldung gilt er als neues Gerät: Die Bank fragt dann wieder nach einer TAN.
        </>
      }
      actions={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>Abbrechen</Button>
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
          description="Vorlagen, Kontonamen, Kategorien und die Überweisungen der letzten 14 Tage samt früherer Sicherungen – endgültig."
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
          <Button variant="secondary" onClick={onClose} disabled={busy}>Abbrechen</Button>
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
 * every backup a reset left behind — without touching the device
 * registration. The session goes on; what changes until the logout is kept
 * in memory only, so nothing writes the file again.
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
      description="Vorlagen, Kontonamen, Kategorien und die Überweisungen der letzten 14 Tage werden von diesem Rechner gelöscht, frühere Sicherungen eingeschlossen. Das lässt sich nicht rückgängig machen."
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
