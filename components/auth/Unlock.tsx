'use client';

// Girovo 7 on the desktop: the unlock screen of the profile above all banks
// (lib/profile.ts). The profile's name, its password (or Windows Hello), and
// nothing else: once it opens, every bank logs in with the PIN the profile
// keeps (FintsProvider startProfileLogins), and this screen says which bank
// is being asked until the Übersicht or the bank's approval comes up.
//
// "Passwort vergessen?" cannot help with the password, and says so: it sets
// the profile aside (kept as a copy, never deleted here) and the bank's own
// login comes back, after which a new profile can begin.

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useT } from '@/lib/i18n/react';
import { startDemo } from '../demo/demo-mode';
import { useFints } from '../FintsProvider';
import { FingerprintIcon } from '../icons';
import { useIntroPlaying } from '../shell/Intro';
import { useWindowInFront } from '../shell/useWindowInFront';
import { Alert, Button, Dialog, Field, PasswordInput, Spinner } from '../ui';

/** Windows Hello asks by itself once per start of the app, never again after a logout. */
let helloAskedThisStart = false;

/** Up to two letters for the circle: the first of the first and of the last word. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const first = Array.from(words[0])[0] ?? '';
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] ?? '' : '';
  return (first + last).toLocaleUpperCase('de');
}

export function Unlock() {
  const t = useT();
  const words = t.profile.unlock;
  const { profile, profileSigningIn, unlockProfile, forgetProfile, autoLoggedOut } = useFints();
  const uid = useId();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const inFront = useWindowInFront();
  const intro = useIntroPlaying();
  const busy = working || !!profileSigningIn;
  // A profile whose file does not read has no name to show: only the way out.
  const damaged = profile.exists && profile.damaged === true;

  useEffect(() => {
    field.current?.focus();
  }, []);

  const run = async (typed: string | null) => {
    if (busy) return;
    if (typed !== null && !typed) {
      field.current?.focus();
      return;
    }
    setWorking(true);
    setError(null);
    const problem = await unlockProfile(typed);
    setWorking(false);
    if (problem === null) {
      setPassword('');
      return;
    }
    // '' : Windows Hello called off, nothing to say; the password waits.
    if (problem) setError(problem);
    field.current?.focus();
    if (typed !== null) field.current?.select();
  };

  useEffect(() => {
    if (!profile.hello || damaged || !inFront || intro || autoLoggedOut || helloAskedThisStart) return;
    helloAskedThisStart = true;
    void run(null);
    // Once, when everything it needs is there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.hello, damaged, inFront, intro, autoLoggedOut]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(password);
  };

  const forget = async () => {
    setForgetting(true);
    await forgetProfile();
    setForgetting(false);
    setForgotOpen(false);
  };

  const name = profile.name || words.fallbackName;

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-4">
        <span
          aria-hidden
          className="grid size-14 shrink-0 place-items-center rounded-full bg-accent-soft text-[20px] font-semibold text-accent-ink"
        >
          {initials(profile.name) || <FingerprintIcon size={24} />}
        </span>
        <h1 className="min-w-0 text-[22px] leading-7 font-semibold text-balance break-words text-ink">{name}</h1>
      </div>

      {damaged ? (
        <Alert tone="error" className="mt-6">{t.profile.forgot.damaged}</Alert>
      ) : (
        <form onSubmit={submit} noValidate className="mt-6">
          <Field label={words.password} htmlFor={`pw${uid}`} error={error ?? undefined} className="mb-0">
            <PasswordInput
              id={`pw${uid}`}
              ref={field}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
              autoComplete="current-password"
              readOnly={busy}
              concealed={busy}
            />
          </Field>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" busy={working && !profileSigningIn} disabled={busy}>{words.submit}</Button>
            {profile.hello && (
              <Button variant="secondary" onClick={() => void run(null)} disabled={busy}>
                <FingerprintIcon />
                {words.hello}
              </Button>
            )}
          </div>
        </form>
      )}

      {profileSigningIn && (
        <p role="status" className="mt-5 flex items-center gap-2 text-[14px] text-ink-2">
          <Spinner size={15} />
          {words.signingIn(profileSigningIn)}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Button variant="tertiary" size="sm" className="-ml-3" onClick={() => setForgotOpen(true)} disabled={busy}>
          {damaged ? t.profile.forgot.action : words.forgot}
        </Button>
        {/* The demo (components/demo) as the bank picker offers it: with a profile, that picker never shows. */}
        <Button variant="tertiary" size="sm" onClick={startDemo} disabled={busy}>{t.auth.demo.start}</Button>
      </div>

      <Dialog
        open={forgotOpen}
        onClose={forgetting ? undefined : () => setForgotOpen(false)}
        title={t.profile.forgot.title}
        description={damaged ? t.profile.forgot.damaged : t.profile.forgot.text}
        actions={(
          <>
            <Button variant="secondary" data-autofocus disabled={forgetting} onClick={() => setForgotOpen(false)}>{t.common.cancel}</Button>
            <Button variant="danger" busy={forgetting} onClick={() => void forget()}>{t.profile.forgot.action}</Button>
          </>
        )}
      >
        <p className="text-[14px] leading-5 text-ink-2">{t.profile.forgot.loss}</p>
      </Dialog>
    </div>
  );
}
