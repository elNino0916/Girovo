'use client';

// Changing one of the bank's Daueraufträge or Terminüberweisungen (HKCDN,
// HKCSA — lib/fints-orders.ts): its amount, its purpose, its date or rhythm.
// The payee stays; another payee is another order.
//
// It goes out through the transfer's own way (submitTransfer with the
// order's handle as `change`), so it gets the same Namensabgleich, the same
// approval wait and the same outcomes as placing an order: "geändert", the
// bank's refusal in its own words, or "Status unklar" — never sent again by
// itself. While the approval wait owns the screen this dialog steps aside.

import { useMemo, useRef, useState } from 'react';
import type { SerializedAccount, SerializedBankOrder, SerializedVop } from '@/lib/fints-types';
import { fmtAmountInput, fmtDate, fmtIban, toLocalDate } from '@/lib/format';
import { useT } from '@/lib/i18n/react';
import { scheduleSentence } from '@/lib/order-schedule';
import { SEPA_PURPOSE_MAX, sepaLength, sepaSanitize } from '@/lib/sepa-text';
import { BankAnswerAlert } from '../BankAnswer';
import { useFints, type TransferHandlers } from '../FintsProvider';
import { currencyMark } from '../Money';
import { Alert, Button, Dialog, Field, Input, Tag } from '../ui';
import { VopReport } from '../VopResult';
import { checkAmount, wireAmount } from './model';
import { ScheduleFields, useScheduleForm } from './Schedule';
import { RefusedMark, SuccessMark, UnsureMark } from './parts';

type Step = 'form' | 'sending' | 'vop' | 'done' | 'refused' | 'unclear';

/** What a schedule says beyond its first run: a change of a Dauerauftrag starts from a later one by nature. */
const rhythmKey = (s: SerializedBankOrder['schedule']) =>
  !s ? '' : s.kind === 'dated' ? s.date : `${s.unit}${s.interval}:${s.day}:${s.last ?? ''}`;

export function ChangeOrderDialog({
  account, order, onClose,
}: { account: SerializedAccount; order: SerializedBankOrder; onClose: () => void }) {
  const { submitTransfer, confirmVop, abandonVop, toast, wait } = useFints();
  const t = useT();
  const words = t.orders.change;
  const kind = order.kind;
  const sched = useScheduleForm(account, order.schedule);
  const [amount, setAmount] = useState(() => fmtAmountInput(order.amount));
  const [purpose, setPurpose] = useState(order.purpose);
  const [step, setStep] = useState<Step>('form');
  const [answers, setAnswers] = useState<string | undefined>();
  const [vop, setVop] = useState<SerializedVop | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const amountRef = useRef<HTMLInputElement | null>(null);
  const dateRef = useRef<HTMLInputElement | null>(null);

  const amountCheck = checkAmount(amount);
  const purposeLong = sepaLength(purpose) > SEPA_PURPOSE_MAX;
  const scheduleOk = !!sched.schedule && Object.keys(sched.problems).length === 0;
  const unchanged = amountCheck.cents === Math.round(order.amount * 100)
    && sepaSanitize(purpose) === sepaSanitize(order.purpose)
    && rhythmKey(sched.schedule) === rhythmKey(order.schedule);
  // A malformed amount says so at once; an empty one only once "Änderung senden" was pressed.
  const amountError = amountCheck.error ?? (tried && amountCheck.cents == null ? t.transfer.amount.invalid : undefined);

  const handlers: TransferHandlers = useMemo(() => ({
    onTanStarted: () => {},
    onExecuted: (a) => {
      setAnswers(a);
      setStep('done');
      toast(words.done[kind], 'success');
    },
    onRefused: (a) => { setAnswers(a); setStep('refused'); },
    onUnknown: (a) => { setAnswers(a); setStep('unclear'); },
    onError: (m) => { setError(m); setStep('form'); },
    onVop: (v) => { setVop(v); setStep('vop'); },
  }), [toast, words, kind]);

  const send = () => {
    setTried(true);
    setError(null);
    if (amountCheck.cents == null) {
      amountRef.current?.focus();
      return;
    }
    if (purposeLong || !scheduleOk || unchanged) return;
    setStep('sending');
    void submitTransfer({
      accountNumber: account.accountNumber,
      recipientName: order.name,
      iban: order.iban,
      amount: wireAmount(amountCheck.cents),
      purpose: sepaSanitize(purpose),
      instant: false,
      schedule: sched.schedule!,
      change: order.ref,
    }, handlers);
  };

  // The approval wait owns the screen while it is open: this dialog steps aside and comes back after.
  if (step === 'sending' && wait.open) return null;

  const title = words.title[kind];
  const payee = order.name || fmtIban(order.iban);

  if (step === 'done' || step === 'refused' || step === 'unclear') {
    return (
      <Dialog
        open
        onClose={onClose}
        title={step === 'done' ? words.done[kind] : step === 'refused' ? title : t.common.statusUnclear}
        actions={<Button variant="primary" data-autofocus onClick={onClose}>{t.common.done}</Button>}
      >
        <div className="mb-4">{step === 'done' ? <SuccessMark /> : step === 'refused' ? <RefusedMark /> : <UnsureMark />}</div>
        {step === 'done' && <p className="text-[15px] leading-normal text-ink-2">{words.doneText}</p>}
        {step === 'refused' && (answers
          ? <BankAnswerAlert message={answers}><p className="mt-1 font-semibold">{words.refused}</p></BankAnswerAlert>
          : <Alert tone="error">{words.refusedPlain}</Alert>)}
        {step === 'unclear' && (
          <>
            <Tag tone="emphasis" size="sm" className="mb-3">{t.common.statusUnclear}</Tag>
            <Alert tone="warn">{words.unclearText}</Alert>
          </>
        )}
      </Dialog>
    );
  }

  if (step === 'vop' && vop) {
    return (
      <Dialog
        open
        onClose={() => { void abandonVop(); onClose(); }}
        onBackdrop={() => {}}
        title={title}
        description={words.vopIntro}
        actions={(
          <>
            <Button variant="secondary" onClick={() => { setStep('sending'); void confirmVop(handlers); }}>{words.vopSend}</Button>
            {/* The safe answer is the filled one: nothing goes out. */}
            <Button variant="primary" data-autofocus onClick={() => { void abandonVop(); onClose(); }}>{words.vopStop}</Button>
          </>
        )}
      >
        <VopReport vop={vop} iban={order.iban} />
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={step === 'sending' ? undefined : onClose}
      onBackdrop={() => {}}
      title={title}
      description={words.intro}
      size="md"
      initialFocus={amountRef}
      actions={(
        <>
          <Button variant="secondary" disabled={step === 'sending'} onClick={onClose}>{t.common.cancel}</Button>
          <Button variant="primary" busy={step === 'sending'} onClick={send}>{words.send}</Button>
        </>
      )}
    >
      <div className="mb-4 rounded-[8px] bg-inset px-4 py-3">
        <p className="text-[13px] leading-snug font-semibold text-ink-3">{words.payee}</p>
        <p className="mt-0.5 text-[15px] leading-snug font-semibold break-words text-ink">{payee}</p>
        <p className="iban mt-0.5 overflow-x-auto text-[14px] text-ink-2 [scrollbar-width:none]">{fmtIban(order.iban)}</p>
        {order.schedule && <p className="tnum mt-1.5 text-[13px] leading-snug text-ink-3">{scheduleSentence(order.schedule)}</p>}
      </div>

      <Field label={words.amount} error={amountError}>
        <Input
          ref={amountRef}
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          invalid={!!amountError}
          onChange={(e) => setAmount(e.target.value)}
          onBlur={() => { if (amountCheck.cents != null) setAmount(fmtAmountInput(amountCheck.cents / 100)); }}
          className="amount text-right text-[20px] font-semibold"
          trailing={<span aria-hidden className="pr-2.5 text-[17px] font-semibold text-ink-3">{currencyMark(order.currency)}</span>}
        />
      </Field>

      <Field label={words.purpose} error={purposeLong ? words.purposeTooLong(SEPA_PURPOSE_MAX) : undefined}>
        <Input value={purpose} autoComplete="off" maxLength={SEPA_PURPOSE_MAX * 2} invalid={purposeLong} onChange={(e) => setPurpose(e.target.value)} />
      </Field>

      <ScheduleFields form={sched} showErrors={tried} dateRef={dateRef} />
      {kind === 'standing' && sched.schedule?.kind === 'standing' && sched.first && (
        <p className="tnum -mt-1 mb-2 text-[13px] leading-snug text-ink-3">{words.from(fmtDate(toLocalDate(sched.first)))}</p>
      )}

      {tried && unchanged && <p className="mt-2 text-[13.5px] font-semibold text-ink-2">{words.unchanged}</p>}
      {error && <Alert tone="error" className="mt-3">{error}</Alert>}
      <p className="mt-3 text-[13px] leading-snug text-ink-3">{words.approval}</p>
    </Dialog>
  );
}
