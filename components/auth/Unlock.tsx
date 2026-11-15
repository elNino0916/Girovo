'use client';

// Girovo 7 on the desktop: the unlock screen of the profile above all banks
// (lib/profile.ts). One counter in the middle of the sheet: the profile's
// picture and name, the password, "Entsperren", and under a quiet "oder" the
// ways that need no typing (Windows Hello, a security key). Once it opens,
// every bank logs in with the PIN the profile keeps (FintsProvider
// startProfileLogins), and the counter says which bank is being asked until
// the Übersicht or the bank's approval comes up.
//
// "Passwort vergessen?" cannot help with the password, and says so: it sets
// the profile aside (kept as a copy, never deleted here) and the bank's own
// login comes back, after which a new profile can begin. The demo stands at
// the foot of the sheet, away from the lock.

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { isAvatarId, OWN_PICTURE } from '@/lib/avatars';
import { useT } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import type { UnlockWay } from '@/lib/profile-client';
import { securityKeyAvailable } from '@/lib/security-key-client';
import { startDemo } from '../demo/demo-mode';
import { useFints } from '../FintsProvider';
import { AvatarGlyph, FingerprintIcon, ShieldIcon } from '../icons';
import { useIntroPlaying } from '../shell/Intro';
import { useWindowInFront } from '../shell/useWindowInFront';
import { Alert, Button, Dialog, Field, PasswordInput, Spinner, cx } from '../ui';

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

/** The profile's picture: the own one, a glyph, else the initials on the brand's tone. */
function Face({ name, face }: { name: string; face?: { avatar: string; image?: string } }) {
  return (
    <span
      aria-hidden
      className="grid size-[88px] shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--md-primary-container)] text-[30px] leading-none font-medium text-[var(--md-on-primary-container)] shadow-[0_0_0_1px_var(--md-outline-variant)]"
    >
      {face?.avatar === OWN_PICTURE && face.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={face.image} alt="" draggable={false} className="size-full object-cover" />
      ) : face && isAvatarId(face.avatar) ? (
        <AvatarGlyph id={face.avatar} size={36} />
      ) : (
        initials(name) || <FingerprintIcon size={32} />
      )}
    </span>
  );
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
  const [keyReady, setKeyReady] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const inFront = useWindowInFront();
  const intro = useIntroPlaying();
  const busy = working || !!profileSigningIn;
  // A profile whose file does not read has no name to show: only the way out.
  const damaged = profile.exists && profile.damaged === true;
  const hasKeys = !!profile.keys?.length;
  const quick = !damaged && (profile.hello || (hasKeys && keyReady));

  useEffect(() => {
    field.current?.focus();
  }, []);

  // A security key only where this Windows can use one (and the profile has one).
  useEffect(() => {
    if (!hasKeys) return;
    let live = true;
    void securityKeyAvailable().then((v) => { if (live) setKeyReady(v); });
    return () => { live = false; };
  }, [hasKeys]);

  const run = async (way: UnlockWay) => {
    if (busy) return;
    if ('password' in way && !way.password) {
      field.current?.focus();
      return;
    }
    setWorking(true);
    setError(null);
    const problem = await unlockProfile(way);
    setWorking(false);
    if (problem === null) {
      setPassword('');
      return;
    }
    // '' : the prompt was called off, nothing to say; the password waits.
    if (problem) setError(problem);
    field.current?.focus();
    if ('password' in way) field.current?.select();
  };

  useEffect(() => {
    if (!profile.hello || damaged || !inFront || intro || autoLoggedOut || helloAskedThisStart) return;
    helloAskedThisStart = true;
    void run({ via: 'hello' });
    // Once, when everything it needs is there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.hello, damaged, inFront, intro, autoLoggedOut]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run({ password });
  };

  const forget = async () => {
    setForgetting(true);
    await forgetProfile();
    setForgetting(false);
    setForgotOpen(false);
  };

  const name = profile.name || words.fallbackName;

  return (
    // The sheet's height less its bar and the page's own padding: the counter
    // stands a little above the middle, the demo at the foot.
    <div className={cx('flex flex-col items-center', !IS_ANDROID && 'min-h-[calc(100dvh-var(--barbar-h)-8rem)]')}>
      <div className="my-auto flex w-full max-w-[360px] flex-col items-center pt-6 pb-[6vh]">
        <Face name={profile.name} face={profile.face} />
        <h1 className="mt-4 max-w-full text-center text-[22px] leading-7 font-medium text-balance break-words text-ink">{name}</h1>

        {damaged ? (
          <>
            <Alert tone="error" className="mt-8 w-full">{t.profile.forgot.damaged}</Alert>
            <Button variant="primary" block className="mt-4" onClick={() => setForgotOpen(true)}>{t.profile.forgot.action}</Button>
          </>
        ) : (
          <form onSubmit={submit} noValidate className="mt-8 w-full">
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
            <div className="mt-1 flex justify-end">
              <Button variant="tertiary" size="xs" className="-mr-3" onClick={() => setForgotOpen(true)} disabled={busy}>
                {words.forgot}
              </Button>
            </div>
            <Button type="submit" variant="primary" block className="mt-3" busy={working && !profileSigningIn} disabled={busy}>
              {words.submit}
            </Button>

            {quick && !profileSigningIn && (
              <>
                <div className="my-5 flex items-center gap-3 text-[13px] leading-5 text-ink-3" aria-hidden>
                  <span className="h-px flex-1 bg-[var(--md-outline-variant)]" />
                  {words.or}
                  <span className="h-px flex-1 bg-[var(--md-outline-variant)]" />
                </div>
                <div className="flex flex-col gap-2">
                  {profile.hello && (
                    <Button variant="secondary" block iconLeft={<FingerprintIcon size={18} />} onClick={() => void run({ via: 'hello' })} disabled={busy}>
                      {IS_ANDROID ? words.fingerprint : words.hello}
                    </Button>
                  )}
                  {hasKeys && keyReady && (
                    <Button variant="secondary" block iconLeft={<ShieldIcon size={18} />} onClick={() => void run({ via: 'key' })} disabled={busy}>
                      {words.key}
                    </Button>
                  )}
                </div>
              </>
            )}
          </form>
        )}

        {profileSigningIn && (
          <p role="status" className="mt-6 flex items-center justify-center gap-2 text-center text-[14px] leading-5 text-ink-2">
            <Spinner size={16} />
            {words.signingIn(profileSigningIn)}
          </p>
        )}
      </div>

      {/* The demo (components/demo) as the bank picker offers it: with a profile, that picker never shows. */}
      <Button variant="tertiary" size="sm" onClick={startDemo} disabled={busy}>{t.auth.demo.start}</Button>

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
