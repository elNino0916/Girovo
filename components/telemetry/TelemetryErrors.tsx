'use client';

// The page's uncaught errors and unhandled rejections, reported (scrubbed by
// the desktop shell) — always, like every error report. Renders nothing.

import { useEffect } from 'react';
import { reportClientError } from './usage';

// Chromium's notice that a ResizeObserver's callback changed the layout again
// within the same frame. Nothing failed: the browser delivers the rest in the
// next frame. It arrives as an error event without an error object — the
// shape no real failure has — and is no report.
const RESIZE_NOTICE = /^ResizeObserver loop (completed with undelivered notifications|limit exceeded)/;

export function TelemetryErrors() {
  useEffect(() => {
    if (!window.electronTelemetry) return;
    const onError = (event: ErrorEvent) => {
      if (!event.error && RESIZE_NOTICE.test(event.message ?? '')) return;
      reportClientError(event.error ?? { name: 'Error', message: event.message });
    };
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
