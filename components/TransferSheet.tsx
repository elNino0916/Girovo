'use client';

import { useEffect, useMemo, useState } from 'react';
import { fmtIban, fmtMoney, ibanValid, translateType } from '@/lib/format';
import { useFints } from './FintsProvider';
import { Alert, Button, CloseIcon, Field, IconButton, Input, Overlay, Select, Sheet, cx } from './ui';

/** `awaiting` = the TAN overlay owns the screen; this sheet steps aside. */
type Step = 'form' | 'review' | 'awaiting' | 'done' | 'unknown';

type Draft = {
  accountNumber: string;
  name: string;
  iban: string;
  amount: string;
  amountNum: number;
  purpose: string;
  instant: boolean;
};

export function TransferSheet({ preselect, onClose }: { preselect: string | null; onClose: () => void }) {
  const { accounts, submitTransfer, selectAccount, toast } = useFints();
  const eligible = useMemo(() => accounts.filter((a) => a.canTransfer), [accounts]);

  const [accountNumber, setAccountNumber] = useState(
    () => (preselect && eligible.some((a) => a.accountNumber === preselect) ? preselect : eligible[0]?.accountNumber) ?? '',
  );
  const [instant, setInstant] = useState(false);
  const [name, setName] = useState('');
  const [iban, setIban] = useState('');
  const [amount, setAmount] = useState('');
  const [purpose, setPurpose] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('form');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [bankAnswers, setBankAnswers] = useState<string>();

  const account = eligible.find((a) => a.accountNumber === accountNumber);
  const canInstant = !!account?.canInstant;
  const useInstant = instant && canInstant;

  const empty = eligible.length === 0;
  useEffect(() => {
    if (!empty) return;
    toast('Kein Konto unterstützt Überweisungen über FinTS.', 'error');
    onClose();
  }, [empty, toast, onClose]);

  const rawIban = iban.replace(/\s+/g, '').toUpperCase();
  const ibanState = rawIban.length < 15 ? 'idle' : ibanValid(rawIban) ? 'ok' : 'bad';

  const review = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!account) return setError('Bitte ein Konto wählen.');
    if (!name.trim()) return setError('Bitte den Empfänger angeben.');
    if (!ibanValid(rawIban)) return setError('Die IBAN ist ungültig.');
    const norm = amount.trim().replace(/\./g, '').replace(',', '.');
    const amountNum = parseFloat(norm);
    if (!/^\d+(\.\d{1,2})?$/.test(norm) || !(amountNum > 0)) {
      return setError('Bitte einen gültigen Betrag angeben, z. B. 25,00.');
    }
    if (rawIban === (account.iban || '').toUpperCase()) {
      return setError('Empfänger-IBAN und eigenes Konto sind identisch.');
    }
    setDraft({
      accountNumber: account.accountNumber,
      name: name.trim(), iban: rawIban, amount: amount.trim(), amountNum,
      purpose: purpose.trim(), instant: useInstant,
    });
    setStep('review');
  };

  const send = () => {
    if (!draft) return;
    setError(null);
    setSubmitting(true);
    void submitTransfer(
      {
        accountNumber: draft.accountNumber,
        recipientName: draft.name,
        iban: draft.iban,
        amount: draft.amount,
        purpose: draft.purpose,
        instant: draft.instant,
      },
      {
        onTanStarted: () => { setSubmitting(false); setStep('awaiting'); },
        onExecuted: (answers) => { setSubmitting(false); setBankAnswers(answers); setStep('done'); },
        onUnknown: () => { setSubmitting(false); setStep('unknown'); },
        onError: (message) => { setSubmitting(false); setError(message); },
      },
    );
  };

  const finish = () => {
    const acct = accounts.find((a) => a.accountNumber === draft?.accountNumber);
    onClose();
    // A fresh statement fetch shows the new booking.
    if (acct) selectAccount(acct);
  };

  // While the bank waits for approval the TAN overlay owns the screen. The
  // sheet stays mounted (the draft must survive) but renders nothing, then
  // comes back with the result.
  if (empty || step === 'awaiting') return null;

  return (
    <Overlay open onClose={step === 'form' ? onClose : undefined} labelledBy="transfer-title">
      <Sheet wide>
        <div className="mb-4 flex items-center justify-between">
          <h2 id="transfer-title" className="font-display text-[20px] font-semibold tracking-tight">
            {step === 'done' ? 'Überweisung ausgeführt' : step === 'unknown' ? 'Status unklar' : 'Überweisung'}
          </h2>
          <IconButton onClick={onClose} aria-label="Schließen"><CloseIcon /></IconButton>
        </div>

        {step === 'form' && (
          <form onSubmit={review} noValidate>
            <Field label="Von Konto" htmlFor="tf-account">
              <Select id="tf-account" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)}>
                {eligible.map((a) => (
                  <option key={a.accountNumber} value={a.accountNumber}>
                    {translateType(a.accountType)} · {fmtIban(a.iban)}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="mb-4">
              <div className="flex gap-1 rounded-[9px] border border-line bg-inset p-1" role="radiogroup" aria-label="Überweisungsart">
                <ModeButton on={!useInstant} onClick={() => setInstant(false)}>Überweisung</ModeButton>
                <ModeButton on={useInstant} disabled={!canInstant} onClick={() => setInstant(true)}>⚡ Echtzeit</ModeButton>
              </div>
              {!canInstant ? (
                <p className="mt-1.5 text-[12px] text-ink-3">Echtzeitüberweisung wird für dieses Konto nicht über FinTS angeboten.</p>
              ) : useInstant ? (
                <p className="mt-1.5 text-[12px] text-ink-3">Der Betrag ist in Sekunden beim Empfänger. Ausführung rund um die Uhr.</p>
              ) : null}
            </div>

            <Field label="Empfänger" htmlFor="tf-name">
              <Input id="tf-name" maxLength={70} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name des Empfängers" required />
            </Field>

            <Field
              label="IBAN"
              htmlFor="tf-iban"
              hint={
                ibanState === 'idle' ? undefined : (
                  <span className={cx('text-[12.5px]', ibanState === 'ok' ? 'text-green' : 'text-red')}>
                    {ibanState === 'ok' ? 'IBAN geprüft ✓' : 'IBAN ist ungültig'}
                  </span>
                )
              }
            >
              <Input
                id="tf-iban"
                className="num text-sm"
                invalid={ibanState === 'bad'}
                value={iban}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                  setIban(raw.replace(/(.{4})/g, '$1 ').trim());
                }}
                placeholder="DE00 0000 0000 0000 0000 00"
                autoComplete="off"
                spellCheck={false}
                required
              />
            </Field>

            <Field label="Betrag" htmlFor="tf-amount">
              <div className="relative">
                <Input
                  id="tf-amount"
                  className="num pr-10 text-right text-[17px] font-semibold"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0,00"
                  required
                />
                <span className="num pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-[15px] text-ink-3">€</span>
              </div>
            </Field>

            <Field
              label="Verwendungszweck"
              htmlFor="tf-purpose"
              trailing={<span className="num ml-auto text-[11px] text-ink-3">{purpose.length}/140</span>}
            >
              <Input id="tf-purpose" maxLength={140} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="optional" />
            </Field>

            <Button type="submit" variant="primary" block>Weiter zur Prüfung</Button>
            {error && <Alert>{error}</Alert>}
          </form>
        )}

        {step === 'review' && draft && (
          <>
            <p className="mb-3 text-sm text-ink-2">
              Prüfe den Auftrag. Nach der Freigabe in deiner Banking-App wird die Überweisung ausgeführt.
            </p>
            <dl className="mb-4 overflow-hidden rounded-[9px] border border-line">
              <ReviewRow label="Von">
                {translateType(account!.accountType)} · <span className="num">{fmtIban(account!.iban)}</span>
              </ReviewRow>
              <ReviewRow label="An">{draft.name}</ReviewRow>
              <ReviewRow label="IBAN"><span className="num">{fmtIban(draft.iban)}</span></ReviewRow>
              {draft.purpose && <ReviewRow label="Verwendungszweck">{draft.purpose}</ReviewRow>}
              <ReviewRow label="Art">{draft.instant ? '⚡ Echtzeitüberweisung' : 'SEPA-Überweisung'}</ReviewRow>
              <ReviewRow label="Betrag" hero><span className="num">{fmtMoney(draft.amountNum)}</span></ReviewRow>
            </dl>
            <div className="flex gap-2.5">
              <Button className="flex-1" onClick={() => setStep('form')}>Zurück</Button>
              <Button className="flex-[2]" variant="primary" busy={submitting} onClick={send}>Jetzt überweisen</Button>
            </div>
            {error && <Alert>{error}</Alert>}
          </>
        )}

        {step === 'done' && draft && (
          <div className="text-center">
            <ResultIcon ok />
            <p className="mt-1 text-sm text-ink-2">
              {fmtMoney(draft.amountNum)} an {draft.name}{draft.instant ? ' · in Echtzeit' : ''}.
            </p>
            {bankAnswers && <p className="mt-2 mb-3.5 text-[12.5px] text-ink-3">{bankAnswers}</p>}
            <Button variant="primary" block className="mt-4" onClick={finish}>Fertig</Button>
          </div>
        )}

        {step === 'unknown' && (
          <div className="text-center">
            <ResultIcon />
            <p className="mt-1 text-sm text-ink-2">
              Die Bank hat die Verbindung beendet, bevor die Freigabe bestätigt wurde. Die Überweisung
              wurde möglicherweise trotzdem ausgeführt — prüfe die Umsätze, bevor du sie erneut sendest.
            </p>
            <Button variant="primary" block className="mt-4" onClick={finish}>Umsätze prüfen</Button>
          </div>
        )}
      </Sheet>
    </Overlay>
  );
}

function ModeButton({
  on, disabled, onClick, children,
}: {
  on: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'flex-1 rounded-[6px] px-2.5 py-2 text-[13px] font-semibold transition-colors duration-150',
        on ? 'bg-surface text-ink shadow-[var(--shadow-card)]' : 'text-ink-3',
        disabled && 'cursor-not-allowed opacity-45',
      )}
    >
      {children}
    </button>
  );
}

function ReviewRow({ label, hero, children }: { label: string; hero?: boolean; children: React.ReactNode }) {
  return (
    <div className={cx('flex justify-between gap-3.5 border-b border-line px-3.5 py-2.5 last:border-b-0', hero && 'bg-inset')}>
      <dt className="eyebrow shrink-0 pt-0.5">{label}</dt>
      <dd className={cx('text-right break-words', hero ? 'text-[19px] font-semibold' : 'text-[13.5px]')}>{children}</dd>
    </div>
  );
}

function ResultIcon({ ok }: { ok?: boolean }) {
  return (
    <span className={cx('mx-auto grid size-13 place-items-center rounded-full', ok ? 'bg-green-soft text-green' : 'bg-amber-soft text-amber')}>
      {ok ? (
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
          <path d="M4.5 12.5l5 5L19.5 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
          <path d="M12 5v8m0 4.2v.3" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}
