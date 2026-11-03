'use client';

// The ends of a transfer that did not go plainly through: the bank's own
// words under a refusal, and what "Jetzt nachsehen" found for a transfer or an
// order for later whose answer never came (TransferSheet's "unknown" step).

import type { findPlacedOrder, findSentTransfer } from '@/lib/transfer-checks';
import { fmtDate } from '@/lib/format';
import { scheduleSentence } from '@/lib/order-schedule';
import { rich, useT } from '@/lib/i18n/react';
import { Money } from '../Money';
import { Alert, cx } from '../ui';
import { fmtTime } from './model';

/**
 * The bank's own words, codes stripped; under a refusal its code once, small, for a call to the bank.
 * `label`: left out, the usual caption; null, none.
 */
export function BankAnswer({
  lines, label, reference, className,
}: { lines: string[]; label?: string | null; reference?: string; className?: string }) {
  const tr = useT();
  const caption = label === undefined ? tr.transfer.bankAnswer.label : label;
  return (
    <figure className={cx('w-full text-left', className)}>
      {caption && <figcaption className="mb-1.5 text-[13px] font-semibold text-ink-2">{caption}</figcaption>}
      <ul className="rounded-[var(--radius-chip)] bg-inset px-4 py-3 text-[14px] leading-relaxed break-words text-ink">
        {lines.map((l) => <li key={l}>{l}</li>)}
      </ul>
      {reference && (
        <p className="mt-1.5 text-[12.5px] text-ink-3">
          {rich(tr.transfer.bankAnswer.reference(<span className="tnum">{reference}</span>))}
        </p>
      )}
    </figure>
  );
}

/**
 * What "Jetzt nachsehen" found. Found means: do not send it again. Not found
 * is no reason to send it again either — a transfer can take a while to
 * appear — so the answer never invites it.
 */
export function CheckResult({
  sighting, statements, pending, at, name,
}: {
  sighting: ReturnType<typeof findSentTransfer>;
  /** null: the account has no Umsätze over FinTS to read. */
  statements: boolean | null;
  /** null: the account has no Vorgemerkt list to read. */
  pending: boolean | null;
  at: number;
  name: string;
}) {
  const tr = useT();
  const words = tr.transfer.unknown;
  const checked = fmtTime(tr, new Date(at));
  if (sighting) {
    const tx = sighting.tx;
    return (
      <Alert tone="success" title={sighting.where === 'booked' ? words.foundBooked : words.foundPending} className="mt-5">
        {rich(words.found(
          <Money value={-tx.amount} className="font-semibold text-ink" />,
          name,
          sighting.where === 'booked' ? <span className="tnum">{fmtDate(tx.entryDate || tx.valueDate)}</span> : null,
        ))}
      </Alert>
    );
  }
  const failed = [
    statements === false && words.failedBooked,
    pending === false && words.failedPending,
  ].filter(Boolean) as string[];
  // Only what was actually read is named as searched.
  const searched = statements === true || pending === true;
  return (
    <Alert
      tone="warn"
      title={searched ? words.notVisible : words.notChecked}
      className="mt-5"
    >
      {failed.map((f) => <span key={f} className="block">{f}</span>)}
      {searched ? (
        <span className="block">
          {rich(words.notYet(words.searched(statements === true, pending === true), <span className="tnum">{checked}</span>))}
        </span>
      ) : statements === null && pending === null ? (
        // Nothing this app could read for the account — trying again would not change that.
        <span className="block">{words.nothingToRead}</span>
      ) : (
        <span className="block">{words.tryAgain}</span>
      )}
    </Alert>
  );
}

/**
 * What "Jetzt nachsehen" found for an order for later, in the bank's list of
 * its kind. Found: do not place it again. Not found is no reason to place it
 * again either — the answer never invites it.
 */
export function PlacedCheckResult({
  kind, placed, read, at, name,
}: {
  kind: 'standing' | 'dated';
  placed: ReturnType<typeof findPlacedOrder>;
  /** Whether the list was read; null: the account has no list to read. */
  read: boolean | null;
  at: number;
  name: string;
}) {
  const tr = useT();
  const words = tr.orders.sheet.unknown;
  const checked = fmtTime(tr, new Date(at));
  if (placed) {
    return (
      <Alert tone="success" title={words.found} className="mt-5">
        {rich(words.foundText(
          <Money value={placed.amount} currency={placed.currency} className="font-semibold text-ink" />,
          name,
          placed.schedule ? scheduleSentence(placed.schedule) : tr.orders.list.noSchedule,
        ))}
      </Alert>
    );
  }
  return (
    <Alert tone="warn" title={read ? words.notVisible : words.notChecked} className="mt-5">
      {read === false && <span className="block">{words.failed}</span>}
      {read ? (
        <span className="block">{rich(words.notYet(words.listDative[kind], <span className="tnum">{checked}</span>))}</span>
      ) : read === null ? (
        <span className="block">{words.nothingToRead}</span>
      ) : (
        <span className="block">{words.tryAgain}</span>
      )}
    </Alert>
  );
}
