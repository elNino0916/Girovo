'use client';

import { AuthCard, PrivacyAside } from './auth/AuthShell';
import { BankPicker } from './auth/BankPicker';
import { Credentials } from './auth/Credentials';
import { TermsStep } from './auth/TermsStep';
import { useFints } from './FintsProvider';
import { useTermsAccepted } from '@/lib/terms';
import { Skeleton } from './ui';

// The auth shell lives in components/auth/AuthShell.tsx; re-exported here
// because this is where the other auth screens have always imported it from.
export { AuthCard } from './auth/AuthShell';

/**
 * Bank, then credentials. The TAN method (step three) is its own view
 * (TanMethodPicker), reached once the bank has answered the login.
 *
 * Both steps share one frame, so moving between them changes the card's
 * content and the step on the stage — nothing else on the page jumps.
 *
 * Before either, once: the terms of use (TermsStep), on the same frame.
 */
export function Login() {
  const {
    bank, setBank, bankChecking, staleBank, popularBanks, logoFiles, meta, connect, cancelConnect,
  } = useFints();
  const termsAccepted = useTermsAccepted();
  // Not agreed to yet: nothing of the login is mounted, so nothing asks for a
  // PIN, Windows Hello or a fingerprint behind it.
  if (termsAccepted === false) return <AuthCard><TermsStep /></AuthCard>;
  return (
    <AuthCard step={bank ? 'credentials' : 'bank'} aside={<PrivacyAside merchantLogos={meta?.merchantLogos} />}>
      {bankChecking || termsAccepted === null ? (
        // The bank from last time is being checked against the list — a
        // moment, so neither form flashes up only to be replaced.
        <div aria-busy className="flex flex-col gap-3">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-64 max-w-full" />
          <Skeleton className="mt-5 h-12 w-full" />
        </div>
      ) : bank ? (
        <Credentials
          // A different bank is a different form: its own remembered login
          // name, its own device status, no PIN carried over.
          key={bank.blz}
          bank={bank}
          logoFile={logoFiles[bank.brand]}
          meta={meta}
          onChange={() => setBank(null)}
          onSubmit={connect}
          onCancel={cancelConnect}
        />
      ) : (
        <BankPicker
          banks={popularBanks}
          logoFiles={logoFiles}
          bankCount={meta?.bankCount}
          staleBank={staleBank}
          onPick={setBank}
        />
      )}
    </AuthCard>
  );
}
