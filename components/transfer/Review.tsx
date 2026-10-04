'use client';

// The "Prüfen" step: exactly what will be sent, the figures around it — and,
// first of all, anything worth a second look before the approval: a payment
// that looks like one already made, more than the account can spend, a
// Kontostand that ends in the Dispo. Those sit at the top of the step, above
// the order, so no window is too short to show them before "überweisen".

import type { Ref } from 'react';
import { isCardAccount } from '@/lib/balances';
import { bankAnswerLines } from '@/lib/bank-answer';
import type { SerializedAccount } from '@/lib/fints-types';
import { expectedCreditDate, fmtDate, fmtIban } from '@/lib/format';
import { sepaSanitize } from '@/lib/sepa-text';
import type { FundsWarning, spendable } from '@/lib/transfer-checks';
import { BoltIcon, LandmarkIcon } from '../icons';
import { Money } from '../Money';
import { Alert, Spinner, Tag } from '../ui';
import { fmtLongDate, shortIbanText, type TransferDraft } from './model';
import { SummaryList, SummaryRow } from './parts';

/** Another bank operation (a statement, Vormerkposten) still holds the line. */
export function BusyNote() {
  return (
    <p className="mt-3 flex items-center gap-2 text-[13.5px] text-ink-2" role="status">
      <Spinner size={14} />
      Bitte warten – ein anderer Vorgang läuft noch.
    </p>
  );
}

/** "Gutschrift voraussichtlich Montag, 05.10.2026" — an estimate, and it says so. */
export function CreditDate({ short }: { short?: boolean }) {
  // Computed at render: a sheet left open past the cut-off moves the date.
  const d = expectedCreditDate(new Date(), false);
  if (!d) return null;
  const when = short
    ? new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(d)
    : fmtLongDate(d);
  return <>Gutschrift voraussichtlich <span className="tnum">{when}</span></>;
}

/** The id the primary button points its aria-describedby at. */
export const REVIEW_WARNINGS_ID = 'tf-review-warnings';

/**
 * "Mehr als verfügbar – …" and "Kontostand danach ca. −177,10 € – …": one
 * wording for the hint under Betrag and the warning on Prüfen.
 */
export function FundsWarningText({ warning, currency }: { warning: FundsWarning; currency?: string | null }) {
  if (warning.kind === 'over') {
    return (
      <>
        Mehr als {warning.basis === 'available' ? 'verfügbar' : 'dein Kontostand'} – die Bank kann den Auftrag ablehnen.
      </>
    );
  }
  return (
    <>
      Kontostand danach ca.{' '}
      <Money value={warning.balanceAfter} currency={currency || 'EUR'} tone="plain" className="font-semibold" />{' '}
      – du nutzt deinen Dispositionsrahmen.
    </>
  );
}

/** A message on the step — the app's own, or a bank answer — as lines, codes stripped. */
export function StepError({ message, errorRef }: { message: string; errorRef?: Ref<HTMLDivElement> }) {
  const lines = bankAnswerLines(message);
  return (
    <div ref={errorRef} className="scroll-mt-4">
      <Alert className="mb-4">
        {lines.length > 1 ? <ul className="space-y-0.5">{lines.map((l) => <li key={l}>{l}</li>)}</ul> : (lines[0] ?? message)}
      </Alert>
    </div>
  );
}

export function ReviewStep({
  draft, account, accountName, bank, funds, warning, duplicate, primaryLabel, busyElsewhere, error, errorRef,
}: {
  draft: TransferDraft;
  account: SerializedAccount;
  accountName: string;
  bank: { name: string; bic: string } | null;
  funds: ReturnType<typeof spendable>;
  warning: FundsWarning | null;
  duplicate: string | null;
  /** The footer's primary label, which the closing note names. */
  primaryLabel: string;
  busyElsewhere: boolean;
  error: string | null;
  errorRef: Ref<HTMLDivElement>;
}) {
  const amount = draft.cents / 100;
  // A SEPA order is always in euros (the pain.001 says Ccy="EUR"), whatever
  // the account keeps — so the order shows €, and "danach" is only worked out
  // where the balance is in euros too; across currencies it would be a guess.
  const euroAccount = (account.currency || 'EUR') === 'EUR';
  const after = funds && euroAccount ? funds.value - amount : null;
  const credit = expectedCreditDate(new Date(), false);
  // Name and purpose as the bank will receive them — the server rewrites
  // both to the SEPA character set (lib/sepa-text.ts), and "exactly what will
  // be sent" has to mean that text, not the one typed.
  const sentName = sepaSanitize(draft.name);
  const sentPurpose = sepaSanitize(draft.purpose);
  const rewritten = sentName !== draft.name || sentPurpose !== draft.purpose;
  const warned = !!duplicate || !!warning;
  return (
    <div className="pt-1">
      {error && <StepError message={error} errorRef={errorRef} />}

      {warned && (
        <div id={REVIEW_WARNINGS_ID} className="mb-4 flex flex-col gap-3">
          {duplicate && (
            <Alert tone="warn" title="Schon einmal überwiesen?" className="mt-0">
              {duplicate} Prüfe, ob du diese Zahlung wirklich noch einmal senden möchtest.
            </Alert>
          )}
          {warning && (
            <Alert tone="warn" className="mt-0">
              <FundsWarningText warning={warning} currency={account.currency} />
            </Alert>
          )}
        </div>
      )}

      <div className="rounded-[12px] bg-inset px-4 py-4 sm:px-5">
        <p className="text-[13px] font-semibold text-ink-3">Betrag</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {/* The order's own figures are shown whatever "Beträge ausblenden"
              says — they are what is being checked. */}
          <Money
            value={amount}
            currency="EUR"
            masked={false}
            split
            className="text-[34px] leading-tight font-bold text-headline"
          />
          {draft.instant && <Tag tone="info" icon={<BoltIcon size={13} />}>Echtzeit</Tag>}
        </div>
        <p className="mt-3 text-[13px] font-semibold text-ink-3">An</p>
        <p className="mt-0.5 text-[17px] leading-snug font-semibold break-words text-ink">{sentName}</p>
        <p className="iban mt-1 overflow-x-auto text-[14.5px] text-ink-2 [scrollbar-width:none]">{fmtIban(draft.iban)}</p>
        {bank && (
          <p className="mt-1 flex items-center gap-1.5 text-[13.5px] text-ink-3">
            <LandmarkIcon size={14} className="shrink-0" />
            <span className="min-w-0 truncate">{bank.name}</span>
          </p>
        )}
      </div>

      <SummaryList className="mt-2">
        <SummaryRow label="Von">
          {accountName} · <span className="tnum">{shortIbanText(account.iban)}</span>
        </SummaryRow>
        <SummaryRow label="Verwendungszweck">
          {sentPurpose || <span className="text-ink-3">ohne</span>}
        </SummaryRow>
        <SummaryRow label="Ausführung">{draft.instant ? 'Echtzeitüberweisung' : 'Standardüberweisung'}</SummaryRow>
        <SummaryRow label="Gutschrift">
          {draft.instant || !credit ? 'in Sekunden' : <span className="tnum">voraussichtlich {fmtLongDate(credit)}</span>}
        </SummaryRow>
        {funds && after != null && (
          // The balance is not part of the order, so it keeps following
          // "Beträge ausblenden".
          // A card's Kontostand is negative by nature: ink, not alarm red.
          <SummaryRow label={funds.kind === 'available' ? 'Verfügbar danach' : 'Kontostand danach'}>
            ca.{' '}
            <Money
              value={after}
              currency={account.currency}
              tone={funds.kind !== 'available' && isCardAccount(account) ? 'plain' : 'auto'}
              className="font-semibold"
            />
            {funds.date && <span className="text-ink-3"> (Stand {fmtDate(funds.date)})</span>}
          </SummaryRow>
        )}
        {warning?.kind === 'overdraft' && (
          <SummaryRow label="Kontostand danach">
            ca. <Money value={warning.balanceAfter} currency={account.currency} className="font-semibold" />
          </SummaryRow>
        )}
      </SummaryList>
      {rewritten && (
        <p className="mt-2 text-[13px] leading-snug text-ink-3">
          So übermittelt an die Bank: Umlaute ausgeschrieben (ä → ae), nicht übertragbare Zeichen weggelassen.
        </p>
      )}

      <p className="mt-5 text-[13.5px] leading-relaxed text-ink-3">
        Nach „{primaryLabel}“ gleicht die Bank den Empfängernamen ab und bittet dich um die Freigabe in deiner Banking-App.
      </p>
      {busyElsewhere && <BusyNote />}
    </div>
  );
}
