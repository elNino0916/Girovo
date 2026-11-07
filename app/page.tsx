'use client';

import { FintsProvider, useFints } from '@/components/FintsProvider';
import { Login } from '@/components/Login';
import { TanMethodPicker } from '@/components/TanMethodPicker';
import { TanWaitOverlay } from '@/components/TanWaitOverlay';
import { Dashboard } from '@/components/Dashboard';
import { Toasts } from '@/components/Toasts';
import { Statement } from '@/components/Statement';
import { UpdateLayer } from '@/components/updates/UpdateNotices';
import { TelemetryErrors } from '@/components/telemetry/TelemetryErrors';
import { trackUsage } from '@/components/telemetry/usage';
import { useDemo } from '@/components/demo/demo-mode';
import { Intro } from '@/components/shell/Intro';
import { FloatingScrollbars } from '@/components/shell/FloatingScrollbars';
import { lazy, Suspense, useEffect, type ReactNode } from 'react';

// Girovo without a bank (components/demo): loaded only when the demo starts.
const DemoProvider = lazy(() => import('@/components/demo/DemoProvider'));

export default function Page() {
  const demo = useDemo();
  const app = <AppLayers />;
  // The demo is another session altogether: the real provider unmounts (it
  // sat at the login screen) and comes back fresh when the demo ends.
  return demo
    ? <Suspense fallback={null}><DemoProvider>{app}</DemoProvider></Suspense>
    : <FintsProvider>{app}</FintsProvider>;
}

function AppLayers(): ReactNode {
  return (
    <>
      {/* Only the printable Kontoauszug/receipt sheet should reach paper —
          everything else is app chrome that a PDF export shouldn't include.
          Every interactive layer therefore lives in here: the dashboard
          mounts its own (Überweisung, Geld anfordern, Mitteilungen, the
          palette, the session warning, Tastenkürzel), and the primitives
          render overlays in place rather than portalling them out. */}
      <div className="print:hidden">
        <App />
        <TanWaitOverlay />
        {/* Desktop app only: the update dialog, on every screen — before
            the login is the best time to update. */}
        <UpdateLayer />
        <Toasts />
        {/* Desktop app only: the page's uncaught errors, reported. */}
        <TelemetryErrors />
        {/* Once: the first start, and the first start of Girovo 6. */}
        <Intro />
        {/* The desktop's scrollbars, drawn over the content (not on Android). */}
        <FloatingScrollbars />
      </div>
      <Statement />
    </>
  );
}

function App() {
  const { view } = useFints();
  // Usage (with the user's yes): which screen is up. The dashboard reports its tabs itself.
  useEffect(() => {
    if (view !== 'dashboard') trackUsage('screen_viewed', { screen: view });
  }, [view]);
  if (view === 'dashboard') return <Dashboard />;
  if (view === 'tanmethod') return <TanMethodPicker />;
  return <Login />;
}
