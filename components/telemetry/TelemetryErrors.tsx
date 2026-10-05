'use client';

// The page's uncaught errors and unhandled rejections, reported (scrubbed by
// the desktop shell) — always, like every error report. Renders nothing.

import { useEffect } from 'react';
import { reportClientError } from './usage';

export function TelemetryErrors() {
  useEffect(() => {
    if (!window.electronTelemetry) return;
    const onError = (event: ErrorEvent) => reportClientError(event.error ?? { name: 'Error', message: event.message });
    const onRejection = (event: PromiseRejectionEvent) => reportClientError(event.reason);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}
