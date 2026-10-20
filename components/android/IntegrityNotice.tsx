'use client';

// The phone's integrity check (lib/device-integrity.ts) at the login: before
// a PIN is typed, a warning when the phone has been modified (an unlocked
// bootloader, an unverified system) or this copy of Girovo was signed by
// someone else. A phone that cannot prove its state, or a custom system with
// a locked bootloader, is said in Einstellungen and not warned about here.
// Nothing is blocked: it is the user's phone. Renders nothing off Android.

import { useEffect, useState } from 'react';
import { integrityWarning } from '@/lib/device-integrity';
import { useT } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import { Alert } from '../ui';

/** The check's answer: undefined while it runs, null when it failed. Off Android, always undefined. */
export function useIntegrity(): GirovoIntegrity | null | undefined {
  const [state, setState] = useState<GirovoIntegrity | null | undefined>(undefined);
  useEffect(() => {
    const mobile = window.girovoMobile;
    if (!IS_ANDROID || !mobile) return;
    let live = true;
    void mobile.integrity().then((i) => live && setState(i));
    return () => {
      live = false;
    };
  }, []);
  return state;
}

export function IntegrityNotice({ className }: { className?: string }) {
  const t = useT();
  const m = t.android.integrity;
  const warning = integrityWarning(useIntegrity() ?? null);
  if (!warning) return null;
  return (
    <Alert tone="warn" title={warning === 'foreign' ? m.foreignTitle : m.modifiedTitle} className={className} role="status">
      {warning === 'foreign' ? m.foreignLogin : m.modifiedLogin}
    </Alert>
  );
}
