'use client';

// The data kept on this machine, on the settings page (./Settings.tsx): the
// switch that keeps the Umsätze here (lib/history.ts), and the dialogs that
// say what an action on the saved data does, right before it is done.

import { useMemo, useState } from 'react';
import { useT } from '@/lib/i18n/react';
import { fmtDate, toLocalDate } from '@/lib/format';
import { useFints } from '../FintsProvider';
import { HistoryIcon, LockIcon } from '../icons';
import { Button, Dialog } from '../ui';
import { SwitchItem } from './rows';

export function KeepRow({ onOff, onReset }: { onOff: () => void; onReset: () => void }) {
  const t = useT();
  const { keepBookings, historyStatus, historyCoverage, setKeepBookings } = useFints();
  const [busy, setBusy] = useState(false);
  // The oldest day kept for any account of this login.
  const oldest = useMemo(() => {
    let day = '';
    for (const spans of Object.values(historyCoverage)) {
      const first = spans[0]?.from;
      if (first && (!day || first < day)) day = first;
    }
    return day;
  }, [historyCoverage]);
  const hint = !keepBookings ? t.history.keepHint
    : historyStatus === 'error' ? t.history.unreadable
      : historyStatus === 'unavailable' ? t.history.unavailable
        : historyStatus === 'loading' ? t.history.loading
          : oldest ? t.history.keptSince(fmtDate(toLocalDate(oldest))) : t.history.keepHint;
  const turnOn = async () => {
    setBusy(true);
    try {
      await setKeepBookings(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <SwitchItem
      setting="keep"
      icon={<HistoryIcon />}
      checked={keepBookings}
      disabled={busy}
      onChange={(on) => (on ? void turnOn() : onOff())}
      title={t.history.keep}
      summary={hint}
      below={keepBookings && historyStatus === 'error' && (
        <Button variant="tertiary" size="xs" className="mt-1 -ml-3" aria-haspopup="dialog" onClick={onReset}>
          {t.history.startOver}
        </Button>
      )}
    />
  );
}

/**
 * Switching "Umsätze auf diesem Rechner behalten" off deletes what is kept,
 * every backup with it — said here, before it is done, with the safe button
 * focused and the deletion in red (The Safe Choice Rule).
 */
export function KeepOffDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { setKeepBookings } = useFints();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      // Reports its own outcome as a toast, success or failure.
      await setKeepBookings(false);
    } finally {
      setBusy(false);
      onClose();
    }
  };
  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      title={t.history.offDialog.title}
      icon={<LockIcon size={20} />}
      description={t.history.offDialog.description}
      actions={
        <>
          <Button variant="secondary" data-autofocus onClick={onClose} disabled={busy}>{t.common.cancel}</Button>
          <Button variant="danger" busy={busy} onClick={() => void run()}>{t.history.offDialog.confirm}</Button>
        </>
      }
    >
      {/* Indented to the title's edge, under the header's pictogram. */}
      <p className="pl-[54px] text-[14px] leading-relaxed text-ink-2">{t.history.offDialog.body}</p>
    </Dialog>
  );
}

/**
 * The way out of a kept file this PIN cannot open. Nothing is deleted: the
 * server sets the old file aside — its bookings may be gone at the bank — and
 * begins a new one.
 */
export function ResetHistoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { resetHistory } = useFints();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      // Reports its own outcome as a toast, success or failure.
      await resetHistory();
    } finally {
      setBusy(false);
      onClose();
    }
  };
  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      title={t.history.resetDialog.title}
      icon={<LockIcon size={20} />}
      description={t.history.resetDialog.description}
      actions={
        <>
          <Button variant="secondary" data-autofocus onClick={onClose} disabled={busy}>{t.common.cancel}</Button>
          <Button variant="primary" busy={busy} onClick={() => void run()}>{t.history.resetDialog.confirm}</Button>
        </>
      }
    />
  );
}

/**
 * The way out of an unreadable store. Nothing is deleted: the server sets the
 * old file aside and starts an empty one, and what was changed in memory
 * during this session is kept and saved from then on.
 */
export function ResetVaultDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
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
export function WipeVaultDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
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
