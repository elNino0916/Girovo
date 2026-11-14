'use client';

// On the screens before the dashboard (components/auth/AuthShell.tsx): while
// an app's request to the Girovo API waits for the login, one calm line says
// which app asks and that logging in lets the user decide. The shell holds
// the request and brought the window forward for it (src-tauri/src/api/);
// the line goes once the request reaches the page after the login, its app
// hangs up, or two minutes pass. Nothing without the desktop shell's bridge.

import { useT } from '@/lib/i18n/react';
import { waitingNotice } from '@/lib/api/host-state';
import { ApiMarkIcon } from '../icons';
import { Alert } from '../ui';
import { useApiWaiting } from './bridge';

export function ApiWaitingNotice({ className }: { className?: string }) {
  const t = useT();
  const notice = waitingNotice(useApiWaiting());
  if (!notice) return null;
  return (
    <Alert tone="info" role="status" icon={<ApiMarkIcon size={18} />} className={className}>
      {t.api.waiting(notice.app, notice.publisher, notice.more)}
    </Alert>
  );
}
