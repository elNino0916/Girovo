'use client';

import { FintsProvider, useFints } from '@/components/FintsProvider';
import { Login } from '@/components/Login';
import { TanMethodPicker } from '@/components/TanMethodPicker';
import { TanWaitOverlay } from '@/components/TanWaitOverlay';
import { Dashboard } from '@/components/Dashboard';
import { Toasts } from '@/components/Toasts';
import { Statement } from '@/components/Statement';
import { UpdateLayer } from '@/components/updates/UpdateNotices';

export default function Page() {
  return (
    <FintsProvider>
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
      </div>
      <Statement />
    </FintsProvider>
  );
}

function App() {
  const { view } = useFints();
  if (view === 'dashboard') return <Dashboard />;
  if (view === 'tanmethod') return <TanMethodPicker />;
  return <Login />;
}
