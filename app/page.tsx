'use client';

import { FintsProvider, useFints } from '@/components/FintsProvider';
import { Login } from '@/components/Login';
import { TanMethodPicker } from '@/components/TanMethodPicker';
import { TanWaitOverlay } from '@/components/TanWaitOverlay';
import { Dashboard } from '@/components/Dashboard';
import { Toasts } from '@/components/Toasts';

export default function Page() {
  return (
    <FintsProvider>
      <App />
      <TanWaitOverlay />
      <Toasts />
    </FintsProvider>
  );
}

function App() {
  const { view } = useFints();
  if (view === 'dashboard') return <Dashboard />;
  if (view === 'tanmethod') return <TanMethodPicker />;
  return <Login />;
}
