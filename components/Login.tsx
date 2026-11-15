'use client';

import { AuthCard, PrivacyAside } from './auth/AuthShell';
import { BankPicker } from './auth/BankPicker';
import { Credentials } from './auth/Credentials';
import { Unlock } from './auth/Unlock';
import { TermsStep } from './auth/TermsStep';
import { useFints } from './FintsProvider';
import { store } from '@/lib/client-api';
import { IS_ANDROID } from '@/lib/platform';
import { useTermsAccepted } from '@/lib/terms';
import { useDemo } from './demo/demo-mode';
import { Button, Skeleton } from './ui';
import { useT } from '@/lib/i18n/react';

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
    profile, profileSigningIn, lockProfile,
  } = useFints();
  const t = useT();
  const termsAccepted = useTermsAccepted();
  const demo = useDemo();
  // Back for the daily login: a login with this bank reached the Übersicht
  // here before (FintsProvider afterAccountsReady) and its name is kept. The
  // short form then: no steps, no first-time help, no privacy tile (issue #22).
  const returning = !!bank && !demo && !!store.get(`fints.userId.${bank.blz}`) && store.get(`fints.loginDone.${bank.blz}`) === '1';
  // Not agreed to yet: nothing of the login is mounted, so nothing asks for a
  // PIN, Windows Hello or a fingerprint behind it.
  if (termsAccepted === false) return <AuthCard><TermsStep /></AuthCard>;
  // Girovo 7 on the desktop: the profile above all banks opens first
  // (lib/profile.ts), and says which bank logs in after it. Until the app
  // knows whether there is one, neither form shows: the bank's would ask for
  // Windows Hello behind the profile's back.
  const asksProfile = !IS_ANDROID && !demo && typeof window !== 'undefined' && !!window.electronLinkedUnlock;
  if (asksProfile && !profile.served && !profile.checked) return <AuthCard compact><LoginSkeleton /></AuthCard>;
  if (profile.exists && (!profile.open || profileSigningIn)) return <AuthCard compact><Unlock /></AuthCard>;
  return (
    <AuthCard
      step={bank ? 'credentials' : 'bank'}
      compact={returning && !bankChecking}
      aside={returning ? undefined : <PrivacyAside merchantLogos={meta?.merchantLogos} />}
    >
      {bankChecking || termsAccepted === null ? (
        // The bank from last time is being checked against the list — a
        // moment, so neither form flashes up only to be replaced.
        <LoginSkeleton />
      ) : bank && profile.open ? (
        // Girovo 7: the profile opened, but no bank logged in with a PIN it
        // keeps (none kept, or refused). This bank's PIN is asked for and goes
        // into the profile; or the profile is locked again.
        <>
          <p className="mb-4 text-[14px] leading-5 text-ink-2">{t.profile.unlock.typePin(bank.name)}</p>
          <Credentials
            key={bank.blz}
            bank={bank}
            logoFile={logoFiles[bank.brand]}
            meta={meta}
            onChange={() => setBank(null)}
            onSubmit={connect}
            onCancel={cancelConnect}
            returning={returning}
          />
          <Button variant="tertiary" size="sm" className="mt-4 -ml-3" onClick={lockProfile}>{t.profile.unlock.lock}</Button>
        </>
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
          returning={returning}
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

/** A moment's placeholder for the form that is about to show. */
function LoginSkeleton() {
  return (
    <div aria-busy className="flex flex-col gap-3">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-4 w-64 max-w-full" />
      <Skeleton className="mt-5 h-12 w-full" />
    </div>
  );
}
