'use client';

// "Weitere Banken mit anmelden" on the desktop: the switch in Sicherheit and
// the dialog that turns it on — the switch's, and the one a further bank's
// login offers in a toast (FintsProvider offerLinkedUnlock). The PINs are kept
// by lib/linked-unlock.ts; Android does the same with the fingerprint
// (FingerprintSwitch). The dialog is mounted by Dashboard, at every width.

import { useState } from 'react';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { LockIcon } from '../icons';
import { Button, Dialog } from '../ui';
import { SwitchItem } from './rows';

/**
 * The row, where the desktop shell can keep the PINs (linkedUnlock is null
 * elsewhere) and there is a further bank to log in — or it is on, to turn it
 * off. Off deletes the PINs at once.
 */
export function LinkedUnlockSwitch() {
  const t = useT();
  const { bank, banks, linkedUnlock, setLinkedUnlock, openLinkedUnlockAsk } = useFints();
  const [working, setWorking] = useState(false);
  if (linkedUnlock === null || !bank || (!linkedUnlock && banks.length < 2)) return null;
  const words = t.settings.linkedUnlock;
  const change = async (next: boolean) => {
    // Turning it on keeps PINs: the dialog says so first.
    if (next) {
      openLinkedUnlockAsk();
      return;
    }
    setWorking(true);
    try {
      await setLinkedUnlock(false);
    } finally {
      setWorking(false);
    }
  };
  return (
    <SwitchItem
      icon={<LockIcon />}
      checked={linkedUnlock}
      onChange={(next) => void change(next)}
      disabled={working}
      title={words.title}
      summary={words.hint(bank.name)}
    />
  );
}

/**
 * What turning it on means, said before it is done — the further banks log
 * in with the first, their PINs encrypted on this computer, opened only by
 * the first bank's PIN — as the dialog's description, which a screen reader
 * reads with the title. "Nicht jetzt" is focused (The Safe Choice Rule), and
 * the offer does not come again after it.
 */
export function LinkedUnlockDialog() {
  const t = useT();
  const { bank, linkedUnlock, linkedUnlockAsk, closeLinkedUnlockAsk, declineLinkedUnlock, setLinkedUnlock } = useFints();
  const [busy, setBusy] = useState(false);
  // Only while the shell can keep the PINs: after a wipe nothing is kept this session.
  if (!bank || linkedUnlock === null) return null;
  const words = t.settings.linkedUnlock;
  const run = async () => {
    setBusy(true);
    try {
      // Reports its own outcome as a toast, success or failure.
      await setLinkedUnlock(true);
    } finally {
      setBusy(false);
      closeLinkedUnlockAsk();
    }
  };
  return (
    <Dialog
      open={linkedUnlockAsk}
      onClose={busy ? undefined : closeLinkedUnlockAsk}
      title={words.askTitle}
      icon={<LockIcon size={20} />}
      description={words.askText(bank.name)}
      actions={
        <>
          <Button variant="secondary" data-autofocus onClick={declineLinkedUnlock} disabled={busy}>{words.notNow}</Button>
          <Button variant="primary" busy={busy} onClick={() => void run()}>{words.turnOn}</Button>
        </>
      }
    />
  );
}
