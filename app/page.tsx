'use client';

import { FintsProvider, useFints } from '@/components/FintsProvider';
import { Login } from '@/components/Login';
import { TanMethodPicker } from '@/components/TanMethodPicker';
import { TanWaitOverlay } from '@/components/TanWaitOverlay';
import { Dashboard } from '@/components/Dashboard';
import { Toasts } from '@/components/Toasts';
import { Statement } from '@/components/Statement';

export default function Page() {
  return (
    <FintsProvider>
      {/* Only the printable Kontoauszug/receipt sheet should reach paper —
          everything else is app chrome that a PDF export shouldn't include. */}
      <div className="print:hidden">
        <App />
        <TanWaitOverlay />
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
