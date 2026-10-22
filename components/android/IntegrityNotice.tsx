'use client';

// The phone's integrity check (lib/device-integrity.ts) at the login: before
// a PIN is typed, a warning when the phone has been modified (runtime
// findings, an unlocked bootloader, an unverified system) or this copy was signed by
// someone else; on a phone that cannot prove its state, a note that Girovo
// keeps nothing on it (no remembered device: an approval at every login). A
// custom system with a locked bootloader is said in Einstellungen only. The
// login itself is never blocked: it is the user's phone. Renders nothing off
// Android.

import { useEffect, useState } from 'react';
import { integrityWarning, keepsNothing } from '@/lib/device-integrity';
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
  const integrity = useIntegrity();
  const warning = integrityWarning(integrity ?? null);
  if (warning) {
    return (
      <Alert tone="warn" title={warning === 'foreign' ? m.foreignTitle : m.modifiedTitle} className={className} role="status">
        {warning === 'foreign' ? m.foreignLogin : m.modifiedLogin}
      </Alert>
    );
  }
  // Still being checked: nothing to say yet.
  if (integrity === undefined || !keepsNothing(integrity)) return null;
  return (
    <Alert tone="info" title={m.keepsNothingTitle} className={className} role="status">
      {m.keepsNothingLogin}
    </Alert>
  );
}
