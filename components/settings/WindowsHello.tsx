'use client';

// "Mit Windows Hello anmelden" on the desktop: the switch in Sicherheit. On
// keeps the first login's PIN under a Windows Hello gesture (lib/windows-hello.ts)
// — Windows' own prompt is the confirmation, as the fingerprint's is on
// Android (FingerprintSwitch); off deletes it at once.

import { useState } from 'react';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { FingerprintIcon } from '../icons';
import { SwitchItem } from './rows';

/** The row, where Windows has Windows Hello set up (windowsHello is null elsewhere). */
export function WindowsHelloSwitch() {
  const t = useT();
  const { bank, windowsHello, setWindowsHello } = useFints();
  const [working, setWorking] = useState(false);
  if (windowsHello === null || !bank) return null;
  const words = t.settings.windowsHello;
  const change = async (next: boolean) => {
    setWorking(true);
    try {
      await setWindowsHello(next);
    } finally {
      setWorking(false);
    }
  };
  return (
    <SwitchItem
      icon={<FingerprintIcon />}
      checked={windowsHello}
      onChange={(next) => void change(next)}
      disabled={working}
      title={words.title}
      summary={words.hint(bank.name)}
    />
  );
}
