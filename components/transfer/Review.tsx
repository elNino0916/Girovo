'use client';

// The "Prüfen" step: exactly what will be sent, the figures around it, and
// the two things worth a second look before an approval — a payment that
// looks like one already made, and whether to keep this payee as a template.

import type { ReactNode, Ref } from 'react';
import type { SerializedAccount } from '@/lib/fints-types';
import { expectedCreditDate, fmtDate, fmtIban } from '@/lib/format';
import { sepaSanitize } from '@/lib/sepa-text';
import { BoltIcon, LandmarkIcon, StarIcon } from '../icons';
import { Money } from '../Money';
import { Alert, Checkbox, Field, Input, Spinner, Tag } from '../ui';
import { fmtLongDate, shortIbanText, type TransferDraft, type spendable } from './model';
import { SummaryList, SummaryRow } from './parts';
import { vaultNote } from './Templates';

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

/**
 * "Als Vorlage speichern" — only offered while the encrypted vault is
 * actually there to save into; otherwise it says why not.
 */
export function TemplateSaver({
  status, existing, checked, onChecked, label, onLabel,
}: {
  status: string;
  /** The label of a template that already says exactly this, if any. */
  existing: string | null;
  checked: boolean;
  onChecked: (b: boolean) => void;
  label: string;
  onLabel: (s: string) => void;
}) {
  if (existing) {
    return (
      <p className="flex items-center gap-2 text-[14px] text-ink-2">
        <StarIcon size={16} className="text-accent" />
        Gespeichert als Vorlage „{existing}“.
      </p>
    );
  }
  const note = vaultNote(status);
  return (
    <div>
      <Checkbox
        label="Als Vorlage speichern"
        description={note ?? 'Wird gespeichert, sobald die Überweisung ausgeführt ist.'}
        checked={checked && !note}
        disabled={!!note}
        onChange={(e) => onChecked(e.target.checked)}
      />
      {checked && !note && (
        <Field label="Name der Vorlage" htmlFor="tf-tpl" className="mt-3 mb-0 pl-8">
          <Input id="tf-tpl" value={label} maxLength={60} onChange={(e) => onLabel(e.target.value)} />
        </Field>
      )}
    </div>
  );
}

export function ReviewStep({
  draft, account, accountName, bank, funds, duplicate, saveSlot, busyElsewhere, error, errorRef,
}: {
  draft: TransferDraft;
  account: SerializedAccount;
  accountName: string;
  bank: { name: string; bic: string } | null;
  funds: ReturnType<typeof spendable>;
  duplicate: string | null;
  saveSlot: ReactNode;
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
  return (
    <div className="pt-1">
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
        <SummaryRow label="Ausführung">{draft.instant ? 'Echtzeitüberweisung' : 'SEPA-Überweisung'}</SummaryRow>
        <SummaryRow label="Gutschrift">
          {draft.instant || !credit ? 'in Sekunden' : <span className="tnum">voraussichtlich {fmtLongDate(credit)}</span>}
        </SummaryRow>
        {funds && after != null && (
          // The balance is not part of the order, so it keeps following
          // "Beträge ausblenden".
          <SummaryRow label={funds.kind === 'available' ? 'Verfügbar danach' : 'Kontostand danach'}>
            ca. <Money value={after} currency={account.currency} className="font-semibold" />
            {funds.date && <span className="text-ink-3"> (Stand {fmtDate(funds.date)})</span>}
          </SummaryRow>
        )}
      </SummaryList>
      {rewritten && (
        <p className="mt-2 text-[13px] leading-snug text-ink-3">
          So übermittelt an die Bank: Umlaute ausgeschrieben (ä → ae), nicht übertragbare Zeichen weggelassen.
        </p>
      )}

      {duplicate && (
        <Alert tone="warn" title="Schon einmal überwiesen?" className="mt-4">
          {duplicate} Prüfe, ob du diese Zahlung wirklich noch einmal senden möchtest.
        </Alert>
      )}

      <div className="mt-5">{saveSlot}</div>

      <p className="mt-5 text-[13.5px] leading-relaxed text-ink-3">
        Nach „Jetzt überweisen“ gleicht die Bank den Empfängernamen ab und bittet dich um die Freigabe in deiner Banking-App.
      </p>
      {busyElsewhere && <BusyNote />}
      {error && <div ref={errorRef} className="scroll-mb-6"><Alert>{error}</Alert></div>}
    </div>
  );
}
