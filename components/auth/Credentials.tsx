'use client';

// Step two: the online-banking credentials for the chosen bank.
//
// The PIN only ever exists in this component's state and in the one request
// that carries it; it is cleared after a successful login and never written
// anywhere. The login name is remembered per BLZ (it is not a secret, and
// typing it every time is what makes people paste it from a notes file).

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { post, store } from '@/lib/client-api';
import { formatBankAnswer, isBankOutage, isCredentialAnswer } from '@/lib/bank-answer';
import { APPROVAL_APP } from '@/lib/brands';
import type { MetaResponse } from '@/lib/fints-types';
import type { Messages } from '@/lib/i18n';
import { rich, useT } from '@/lib/i18n/react';
import { BankAnswerAlert } from '../BankAnswer';
import { BankLogo } from '../BankLogo';
import type { ChosenBank } from '../FintsProvider';
import { AlertTriangleIcon, EyeIcon, EyeOffIcon, PhoneIcon, ShieldIcon } from '../icons';
import { Alert, Button, Field, IconButton, Input } from '../ui';
import { PrivacyNote } from './AuthShell';
import { LoginHelp } from './LoginHelp';
import { fmtBlz } from './format';

type CredentialWords = Messages['auth']['credentials'];

/**
 * What the bank calls the login name, where we know it for certain. Everyone
 * else gets the generic wording — a wrong specific label is worse than a
 * plain one.
 */
const LOGIN_LABEL: Record<string, keyof CredentialWords['loginLabels']> = {
  vrbank: 'vrNetKey',
  gls: 'vrNetKey',
  sparkasse: 'loginName',
  ing: 'accessNumber',
  comdirect: 'accessNumber',
  commerzbank: 'participantNumber',
  postbank: 'postbankId',
};
const GENERIC_LOGIN_LABEL = 'loginName';

/**
 * What the bank calls the secret, by the same rule. "PIN" alone invites the
 * four digits of the bank card, so the default says which PIN it is.
 */
const SECRET: Record<string, keyof CredentialWords['secrets']> = {
  postbank: 'postbank',
};
const GENERIC_SECRET = 'pin';

/** After this long without an answer, the login can be called off. */
const CANCEL_AFTER_MS = 8000;

export function Credentials({
  bank, logoFile, meta, onChange, onSubmit, onCancel,
}: {
  bank: ChosenBank;
  logoFile?: string;
  meta: MetaResponse | null;
  onChange: () => void;
  onSubmit: (bank: ChosenBank, userId: string, pin: string) => Promise<void>;
  /** Calls off the login while the bank is being asked. */
  onCancel: () => void;
}) {
  const uid = useId();
  const tr = useT();
  const words = tr.auth.credentials;
  const [login, setLogin] = useState(() => store.get(`fints.userId.${bank.blz}`) || '');
  const [pin, setPin] = useState('');
  const [reveal, setReveal] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  // The answer as it came from the server or the bank; '' for a failure that
  // came without words, which is said in the language on screen (words.failed).
  const [error, setError] = useState<string | null>(null);
  // Which field is missing; what it says is the language's.
  const [fieldErrors, setFieldErrors] = useState<{ login?: boolean; pin?: boolean }>({});
  // Sticky for the visit: once the bank has turned the credentials down,
  // every further try is one closer to a locked access.
  const [lockoutRisk, setLockoutRisk] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // The bank has not answered for a while: "Abbrechen" shows.
  const [slow, setSlow] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  // Bumped per failed attempt, so the same error twice still refocuses.
  const [failures, setFailures] = useState(0);
  // Bumped per cancelled attempt: focus goes back to the form.
  const [cancels, setCancels] = useState(0);
  const [remembered, setRemembered] = useState(false);
  const pinRef = useRef<HTMLInputElement>(null);
  const loginRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (login ? pinRef : loginRef).current?.focus();
    // Focus once, on mount, for whichever field still needs filling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show a hint when this (bank, login name) has a remembered device, so the
  // user knows the PIN they type will unlock it (fewer TAN prompts).
  useEffect(() => {
    const name = login.trim();
    if (!bank.blz || !name) { setRemembered(false); return; }
    // The login name travels in a POST body, never the URL — a query string
    // lands in request logs and history. An answer for a name the user has
    // since typed past is dropped, so a slow reply cannot flip the hint back.
    let current = true;
    const t = setTimeout(() => {
      post<{ remembered: boolean }>('/api/device-status', { blz: bank.blz, userId: name })
        .then((r) => { if (current) setRemembered(!!r.remembered); })
        .catch(() => { if (current) setRemembered(false); });
    }, 250);
    return () => {
      current = false;
      clearTimeout(t);
    };
  }, [bank.blz, login]);

  // Straight back to the PIN once the fields are editable again (an effect
  // rather than a call in the catch). Selected, so the next keystroke replaces
  // it, only when the bank turned the credentials down: after an outage the
  // PIN was never wrong, and a retry is one Enter.
  useEffect(() => {
    if (!failures) return;
    pinRef.current?.focus();
    if (isCredentialAnswer(error)) pinRef.current?.select();
    // `error` is set in the same update as `failures`; only a new failure re-runs this.
  }, [failures]);

  // Called off: the "Abbrechen" that had focus is gone; back to the PIN,
  // as typed, so Enter tries again.
  useEffect(() => {
    if (cancels) pinRef.current?.focus();
  }, [cancels]);

  useEffect(() => {
    if (!submitting) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), CANCEL_AFTER_MS);
    return () => clearTimeout(t);
  }, [submitting]);

  const secret = words.secrets[SECRET[bank.brand] ?? GENERIC_SECRET];

  const submit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!login.trim()) {
      setFieldErrors({ login: true });
      loginRef.current?.focus();
      return;
    }
    if (!pin.trim()) {
      // Enter in the name field moves on to the PIN; only "Anmelden" with
      // the PIN still empty is something to point out.
      setFieldErrors(document.activeElement === loginRef.current ? {} : { pin: true });
      pinRef.current?.focus();
      return;
    }
    setFieldErrors({});
    setError(null);
    setCancelled(false);
    setSubmitting(true);
    // A PIN left readable on screen while the bank is being asked is a PIN
    // left readable for whoever walks past during the wait.
    setReveal(false);
    try {
      await onSubmit(bank, login.trim(), pin);
      setPin('');
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        setCancelled(true);
        setCancels((n) => n + 1);
        return;
      }
      const message = (err as Error).message || '';
      setError(message);
      // A locked access is not one more wrong try: no lockout warning, and
      // no PIN selected for another attempt — only the bank can help now.
      if (formatBankAnswer(message).locked) return;
      if (isCredentialAnswer(message)) setLockoutRisk(true);
      setFailures((n) => n + 1);
    } finally {
      setSubmitting(false);
    }
  }, [bank, login, pin, onSubmit, submitting]);

  const trackCapsLock = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    // getModifierState is the only way to know without a keypress of the
    // key itself; it is accurate on every key event once the field has focus.
    if (typeof e.getModifierState === 'function') setCapsLock(e.getModifierState('CapsLock'));
  };

  const loginLabel = words.loginLabels[LOGIN_LABEL[bank.brand] ?? GENERIC_LOGIN_LABEL];
  const shownError = error === null ? null : error || words.failed;
  const locked = shownError ? formatBankAnswer(shownError).locked : false;
  const capsId = `pin${uid}-caps`;

  return (
    <>
      <h1 className="text-[28px] leading-tight font-bold text-headline sm:text-[32px]">{words.title}</h1>
      <p className="mt-1.5 text-[15px] leading-snug text-ink-2">{words.intro}</p>

      {meta && !meta.productRegistered && (
        <Alert tone="warn" className="mt-5">
          {rich(words.noProductId(<span className="num">config.json</span>))}
        </Alert>
      )}

      {/* The chosen bank: a filled row, not a card inside the card.
          Beside the privacy tile (lg) the card is wide enough for one line —
          logo, name, Ändern. Narrower, a wide wordmark plus the button would
          leave the name a sliver to break in mid-word, so there the logo and
          Ändern share the top line and the name gets the whole width beneath
          them. One grid, one DOM order (logo, name, button), so the reading
          order is the same either way. */}
      <div className="mt-6 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-[var(--radius-chip)] bg-inset py-3 pr-2 pl-3 sm:pl-4 lg:gap-x-3.5">
        {/* A phone gets the small mark: the md plate is up to 100px wide. */}
        <span className="col-start-1 row-start-1 flex sm:hidden">
          <BankLogo brand={bank.brand} size="sm" file={logoFile} />
        </span>
        <span className="col-start-1 row-start-1 hidden sm:flex">
          <BankLogo brand={bank.brand} size="md" file={logoFile} />
        </span>
        <div className="col-span-3 row-start-2 min-w-0 pr-1 sm:pr-2 lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:pr-0">
          {/* Wraps rather than truncates: a bank's full name is often the only
              thing that tells two institutes in one town apart. It breaks
              between words, balanced so "eG" is not left alone on a line;
              break-words is only the last resort for a single word longer
              than the whole line. */}
          <p className="text-[15px] leading-snug font-semibold text-balance break-words text-ink">{bank.name}</p>
          <p className="mt-0.5 text-[13px] leading-snug text-ink-3">
            {/* The BLZ never splits; the town may go to the next line, and the
                no-break space keeps the dot at the end of the first. */}
            <span className="whitespace-nowrap">BLZ <span className="num">{fmtBlz(bank.blz)}</span></span>
            {bank.location && <>&nbsp;· {bank.location}</>}
          </p>
        </div>
        {/* Stacked (below lg), the word ends near the name's right edge
            rather than a pill's padding inside it: a slimmer pill pulled
            into the row's padding, its hover fill still inside the row. */}
        <Button
          variant="tertiary"
          size="sm"
          className="col-start-3 row-start-1 justify-self-end max-lg:-mr-2 max-lg:px-3"
          onClick={onChange}
          disabled={submitting}
        >
          {words.change}<span className="sr-only">: {words.changeBank(bank.name)}</span>
        </Button>
      </div>

      <form onSubmit={submit} noValidate className="mt-6">
        <Field
          label={loginLabel}
          htmlFor={`login${uid}`}
          hint={bank.brand in LOGIN_LABEL ? undefined : words.loginHint}
          error={fieldErrors.login ? words.loginMissing : undefined}
        >
          <Input
            id={`login${uid}`}
            ref={loginRef}
            value={login}
            onChange={(e) => {
              setLogin(e.target.value);
              if (fieldErrors.login) setFieldErrors({});
            }}
            autoComplete="username"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
            // Read-only, not disabled, while the bank is asked: a disabled
            // field drops out of the tab order and loses focus mid-wait.
            readOnly={submitting}
          />
        </Field>

        <Field
          label={secret.label}
          htmlFor={`pin${uid}`}
          hint={secret.hint}
          error={fieldErrors.pin ? secret.missing : undefined}
          className="mb-0"
        >
          <Input
            id={`pin${uid}`}
            ref={pinRef}
            type={reveal ? 'text' : 'password'}
            value={pin}
            onChange={(e) => {
              setPin(e.target.value);
              if (fieldErrors.pin) setFieldErrors({});
            }}
            onKeyDown={trackCapsLock}
            onKeyUp={trackCapsLock}
            onBlur={() => setCapsLock(false)}
            autoComplete="current-password"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
            readOnly={submitting}
            aria-describedby={capsLock ? capsId : undefined}
            trailing={
              <IconButton
                aria-label={words.reveal(secret.short)}
                aria-pressed={reveal}
                aria-controls={`pin${uid}`}
                onClick={() => setReveal((r) => !r)}
                disabled={submitting}
              >
                {reveal ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
              </IconButton>
            }
          />
        </Field>
        {/* The live region is always there (one that appears together with
            its text is often not heard); the visible line comes and goes. */}
        <span id={capsId} aria-live="polite" className="sr-only">{capsLock ? words.capsLock : ''}</span>
        {capsLock && (
          <p aria-hidden className="mt-2 flex items-center gap-1.5 text-[13px] leading-snug font-semibold text-ink-2">
            <AlertTriangleIcon size={15} className="text-emphasis" />
            {words.capsLock}
          </p>
        )}

        {/* The one hard requirement, said before the PIN goes anywhere:
            approval in the bank's app. Named by brand where one app holds for
            the whole brand (lib/brands.ts), so it holds for banks found by
            search too. */}
        <p className="mt-3 flex items-start gap-2 text-[13px] leading-snug text-ink-3">
          <PhoneIcon size={16} className="mt-px shrink-0" />
          <span>{words.approvalHint(APPROVAL_APP[bank.brand])}</span>
        </p>

        {remembered && !shownError && (
          <Alert tone="info" title={words.rememberedTitle} icon={<ShieldIcon size={18} check />} className="mt-4" role="status">
            {words.rememberedText(secret.withIt)}
          </Alert>
        )}

        {shownError && (
          <BankAnswerAlert message={shownError} className="mt-4">
            {isBankOutage(shownError) && <p>{tr.provider.bank.tryAgainLater}</p>}
            {locked ? (
              <p className="mt-1.5 font-semibold">{words.locked}</p>
            ) : lockoutRisk && (
              <p className="mt-1.5 font-semibold">{words.lockoutRisk}</p>
            )}
          </BankAnswerAlert>
        )}

        <Button type="submit" variant="primary" size="lg" block busy={submitting} className="mt-6">
          {submitting ? tr.auth.connecting : words.title}
        </Button>

        {/* A bank that does not answer must not hold the form — or the PIN
            on the server — for minutes: after a while the login can be
            called off. */}
        <p aria-live="polite" className="sr-only">
          {submitting && slow ? words.slowCanCancel : cancelled ? words.cancelled : ''}
        </p>
        {submitting && slow && (
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-1 text-[13px] leading-snug text-ink-3">
            <span aria-hidden>{words.slow}</span>
            <Button variant="tertiary" size="sm" onClick={onCancel}>
              {tr.common.cancel}
            </Button>
          </div>
        )}
        {cancelled && !submitting && (
          <p aria-hidden className="mt-3 text-center text-[13px] leading-snug text-ink-3">{words.cancelled}</p>
        )}
      </form>

      <LoginHelp step="credentials" />

      <PrivacyNote />
    </>
  );
}
