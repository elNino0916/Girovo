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
import { TRY_AGAIN_LATER, formatBankAnswer, isBankOutage, isCredentialAnswer } from '@/lib/bank-answer';
import { APPROVAL_APP } from '@/lib/brands';
import type { MetaResponse } from '@/lib/fints-types';
import { BankAnswerAlert } from '../BankAnswer';
import { BankLogo } from '../BankLogo';
import type { ChosenBank } from '../FintsProvider';
import { AlertTriangleIcon, EyeIcon, EyeOffIcon, PhoneIcon, ShieldIcon } from '../icons';
import { Alert, Button, Field, IconButton, Input } from '../ui';
import { PrivacyNote } from './AuthShell';
import { LoginHelp } from './LoginHelp';
import { fmtBlz } from './format';

/**
 * What the bank calls the login name, where we know it for certain. Everyone
 * else gets the generic wording — a wrong specific label is worse than a
 * plain one.
 */
const LOGIN_LABEL: Record<string, string> = {
  vrbank: 'VR-NetKey oder Alias',
  gls: 'VR-NetKey oder Alias',
  sparkasse: 'Anmeldename oder Legitimations-ID',
  ing: 'Zugangsnummer',
  comdirect: 'Zugangsnummer',
  commerzbank: 'Teilnehmernummer',
  postbank: 'Postbank ID',
};
const GENERIC_LOGIN_LABEL = 'Anmeldename oder Legitimations-ID';

type Secret = {
  label: string;
  /** For "… anzeigen" on the reveal button. */
  short: string;
  /** "Mit deiner PIN …" — the secret with its article, as German needs it. */
  withIt: string;
  hint?: string;
  missing: string;
};

/**
 * What the bank calls the secret, by the same rule. "PIN" alone invites the
 * four digits of the bank card, so the default says which PIN it is.
 */
const SECRET: Record<string, Secret> = {
  postbank: {
    label: 'Passwort', short: 'Passwort', withIt: 'Mit deinem Passwort',
    hint: 'Das Passwort zu deiner Postbank ID.', missing: 'Bitte gib dein Passwort ein.',
  },
};
const GENERIC_SECRET: Secret = {
  label: 'Online-Banking-PIN', short: 'PIN', withIt: 'Mit deiner PIN',
  hint: 'Nicht die PIN deiner Bankkarte.', missing: 'Bitte gib deine PIN ein.',
};

/** After this long without an answer, the login can be called off. */
const CANCEL_AFTER_MS = 8000;

/**
 * The one hard requirement, said before the PIN goes anywhere: approval in
 * the bank's app. Named by brand where one app holds for the whole brand
 * (lib/brands.ts), so it holds for banks found by search too.
 */
function approvalHint(brand: string): string {
  const app = APPROVAL_APP[brand];
  return `Freigabe danach in deiner Banking-App${app ? `, z.\u00a0B. ${app}` : ''}. chipTAN, smsTAN und TAN-Generator gehen hier nicht.`;
}

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
  const [login, setLogin] = useState(() => store.get(`fints.userId.${bank.blz}`) || '');
  const [pin, setPin] = useState('');
  const [reveal, setReveal] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ login?: string; pin?: string }>({});
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

  const secret = SECRET[bank.brand] ?? GENERIC_SECRET;

  const submit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!login.trim()) {
      setFieldErrors({ login: 'Bitte gib deinen Anmeldenamen ein.' });
      loginRef.current?.focus();
      return;
    }
    if (!pin.trim()) {
      // Enter in the name field moves on to the PIN; only "Anmelden" with
      // the PIN still empty is something to point out.
      setFieldErrors(document.activeElement === loginRef.current ? {} : { pin: secret.missing });
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
      const message = (err as Error).message || 'Die Anmeldung ist fehlgeschlagen.';
      setError(message);
      // A locked access is not one more wrong try: no lockout warning, and
      // no PIN selected for another attempt — only the bank can help now.
      if (formatBankAnswer(message).locked) return;
      if (isCredentialAnswer(message)) setLockoutRisk(true);
      setFailures((n) => n + 1);
    } finally {
      setSubmitting(false);
    }
  }, [bank, login, pin, onSubmit, submitting, secret.missing]);

  const trackCapsLock = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    // getModifierState is the only way to know without a keypress of the
    // key itself; it is accurate on every key event once the field has focus.
    if (typeof e.getModifierState === 'function') setCapsLock(e.getModifierState('CapsLock'));
  };

  const loginLabel = LOGIN_LABEL[bank.brand] ?? GENERIC_LOGIN_LABEL;
  const locked = error ? formatBankAnswer(error).locked : false;
  const capsId = `pin${uid}-caps`;

  return (
    <>
      <h1 className="text-[28px] leading-tight font-bold text-headline sm:text-[32px]">Anmelden</h1>
      <p className="mt-1.5 text-[15px] leading-snug text-ink-2">Mit den Zugangsdaten deines Online-Bankings.</p>

      {meta && !meta.productRegistered && (
        <Alert tone="warn" className="mt-5">
          Es ist keine registrierte FinTS-Produkt-ID hinterlegt. Banken lehnen die Anmeldung damit meist ab
          (Code 9078). Trage die ID in <span className="num">config.json</span> ein.
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
          Ändern<span className="sr-only">: andere Bank statt {bank.name} wählen</span>
        </Button>
      </div>

      <form onSubmit={submit} noValidate className="mt-6">
        <Field
          label={loginLabel}
          htmlFor={`login${uid}`}
          hint={bank.brand in LOGIN_LABEL ? undefined : 'So wie beim Online-Banking deiner Bank.'}
          error={fieldErrors.login}
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

        <Field label={secret.label} htmlFor={`pin${uid}`} hint={secret.hint} error={fieldErrors.pin} className="mb-0">
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
                aria-label={`${secret.short} anzeigen`}
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
        <span id={capsId} aria-live="polite" className="sr-only">{capsLock ? 'Feststelltaste ist aktiv' : ''}</span>
        {capsLock && (
          <p aria-hidden className="mt-2 flex items-center gap-1.5 text-[13px] leading-snug font-semibold text-ink-2">
            <AlertTriangleIcon size={15} className="text-emphasis" />
            Feststelltaste ist aktiv
          </p>
        )}

        <p className="mt-3 flex items-start gap-2 text-[13px] leading-snug text-ink-3">
          <PhoneIcon size={16} className="mt-px shrink-0" />
          <span>{approvalHint(bank.brand)}</span>
        </p>

        {remembered && !error && (
          <Alert tone="info" title="Dieses Gerät ist gemerkt" icon={<ShieldIcon size={18} check />} className="mt-4" role="status">
            {secret.withIt} klappt die Anmeldung hier meist ohne neue Freigabe.
          </Alert>
        )}

        {error && (
          <BankAnswerAlert message={error} className="mt-4">
            {isBankOutage(error) && <p>{TRY_AGAIN_LATER}</p>}
            {locked ? (
              <p className="mt-1.5 font-semibold">Entsperren kann nur deine Bank.</p>
            ) : lockoutRisk && (
              <p className="mt-1.5 font-semibold">Mehrere Fehlversuche können deinen Online-Zugang sperren.</p>
            )}
          </BankAnswerAlert>
        )}

        <Button type="submit" variant="primary" size="lg" block busy={submitting} className="mt-6">
          {submitting ? 'Verbinde mit der Bank …' : 'Anmelden'}
        </Button>

        {/* A bank that does not answer must not hold the form — or the PIN
            on the server — for minutes: after a while the login can be
            called off. */}
        <p aria-live="polite" className="sr-only">
          {submitting && slow ? 'Deine Bank antwortet noch nicht. Du kannst die Anmeldung abbrechen.' : cancelled ? 'Anmeldung abgebrochen.' : ''}
        </p>
        {submitting && slow && (
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-1 text-[13px] leading-snug text-ink-3">
            <span aria-hidden>Deine Bank antwortet noch nicht.</span>
            <Button variant="tertiary" size="sm" onClick={onCancel}>
              Abbrechen
            </Button>
          </div>
        )}
        {cancelled && !submitting && (
          <p aria-hidden className="mt-3 text-center text-[13px] leading-snug text-ink-3">Anmeldung abgebrochen.</p>
        )}
      </form>

      <LoginHelp step="credentials" />

      <PrivacyNote />
    </>
  );
}
