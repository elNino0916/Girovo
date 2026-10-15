'use client';

// What the Android app was opened for, beyond its icon
// (android/…/LaunchPlugin.java): a shortcut on the icon — Überweisen,
// GiroCode scannen, Geld anfordern — or an invoice another app shared, whose
// GiroCode opens a transfer. Used by the dashboard, so a launch that came
// before the login waits for it: the app keeps a launch until the page listens.

import { useEffect, useRef } from 'react';
import { msgs } from '@/lib/i18n';
import { IS_ANDROID } from '@/lib/platform';
import { useFints } from '../FintsProvider';
import type { ShellActions } from '../shell/actions';

export function useLaunches(actions: ShellActions): void {
  const { openTransfer, toast } = useFints();
  const latest = useRef({ actions, openTransfer, toast });
  latest.current = { actions, openTransfer, toast };

  useEffect(() => {
    const mobile = IS_ANDROID ? window.girovoMobile : undefined;
    if (!mobile?.launch) return;
    return mobile.launch.on((launch) => {
      const { actions: a, openTransfer: open, toast: say } = latest.current;
      if (launch.kind === 'file') {
        void mobile.launch.readShared(launch.uri, launch.mime).then(
          (file) => open({ girocode: { file } }),
          () => say(msgs().android.launch.unreadable, 'error'),
        );
      } else if (launch.kind === 'transfer') a.transfer();
      else if (launch.kind === 'scan') open({ girocode: { scan: true } });
      else a.share();
    });
  }, []);
}
