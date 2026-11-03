'use client';

// "Neue Umsätze melden" (6.0, lib/background-check.ts): the switch in
// Sicherheit and the dialog that turns it on. The PINs it keeps are opened by
// the shell's secret alone — no finger, no gesture — so the dialog says that
// first, and "Nicht jetzt" is focused (The Safe Choice Rule). Mounted by
// Dashboard, at every width, like LinkedUnlockDialog.

import { useState } from 'react';
import { useT } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import { useFints } from '../FintsProvider';
import { BellIcon } from '../icons';
import { Button, Checkbox, Dialog } from '../ui';
import { SwitchItem } from './rows';

/** The row, where the shell can keep the PINs (backgroundChecks is null elsewhere). Off deletes them at once. */
export function BackgroundSwitch() {
  const t = useT();
  const { bank, backgroundChecks, setBackgroundChecks, openBackgroundAsk } = useFints();
  const [working, setWorking] = useState(false);
  if (backgroundChecks === null || !bank) return null;
  const words = t.background;
  const change = async (next: boolean) => {
    // Turning it on keeps PINs: the dialog says so first.
    if (next) {
      openBackgroundAsk();
      return;
    }
    setWorking(true);
    try {
      await setBackgroundChecks(false);
    } finally {
      setWorking(false);
    }
  };
  return (
    <SwitchItem
      icon={<BellIcon />}
      checked={backgroundChecks}
      onChange={(next) => void change(next)}
      disabled={working}
      title={words.title}
      summary={words.hint}
    />
  );
}

export function BackgroundDialog() {
  const t = useT();
  const { bank, backgroundChecks, backgroundAsk, closeBackgroundAsk, setBackgroundChecks } = useFints();
  const [busy, setBusy] = useState(false);
  const [amounts, setAmounts] = useState(true);
  if (!bank || backgroundChecks === null) return null;
  const words = t.background;
  const run = async () => {
    setBusy(true);
    try {
      // Reports its own outcome as a toast, success or failure.
      await setBackgroundChecks(true, amounts);
    } finally {
      setBusy(false);
      closeBackgroundAsk();
    }
  };
  return (
    <Dialog
      open={backgroundAsk}
      onClose={busy ? undefined : closeBackgroundAsk}
      title={words.askTitle}
      icon={<BellIcon size={20} />}
      description={words.askText}
      actions={
        <>
          <Button variant="secondary" data-autofocus onClick={closeBackgroundAsk} disabled={busy}>{words.notNow}</Button>
          <Button variant="primary" busy={busy} onClick={() => void run()}>{words.turnOn}</Button>
        </>
      }
    >
      {!IS_ANDROID && <p className="text-[14px] leading-relaxed text-ink-2">{words.askDesktop}</p>}
      <Checkbox
        className="mt-3"
        label={words.amounts}
        checked={amounts}
        disabled={busy}
        onChange={(e) => setAmounts(e.target.checked)}
      />
    </Dialog>
  );
}
