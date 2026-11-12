'use client';

// Girovo Next, Girovo AI: "Was ist das für eine Zahlung?" answered in the
// conversation (the turn carries the booking: ask-thread-store.ts `booking`).
//
// One to three short lines worked out by the rules (lib/ask-explain.ts): who
// it is, as the lists name it, and what kind of booking; what the purpose
// says; and whether it comes again (a contract in Verträge & Abos). A SEPA
// direct debit lists its mandate reference and creditor ID under the lines.
// Then the way to the booking itself, and to Verträge & Abos where a contract
// holds it. Asked with no booking to go by, one line says to open one first.

import { useMemo } from 'react';
import { explainBooking, explainLines } from '@/lib/ask-explain';
import { txKey } from '@/lib/categories';
import type { SerializedTransaction } from '@/lib/fints-types';
import { useT } from '@/lib/i18n/react';
import type { RecurringSeries } from '@/lib/recurring';
import { useFints } from '../../FintsProvider';
import { openTxDetail } from '../../transactions/detail-host';
import { txText } from '../../transactions/model';
import { Button } from '../../ui';
import type { Turn } from '../ask-thread-store';
import { useRecurringModel } from '../recurring-model';

const TEXT = 'text-[16px] leading-6 text-ink sm:text-[14px] sm:leading-[22px] [text-wrap:pretty]';

/**
 * The booking as it is loaded now: the very one, or the same booking read
 * again since (a refresh makes new objects), booked or vorgemerkt, with the
 * account it is on. As asked when it is no longer loaded.
 */
function useLoaded(booking: SerializedTransaction | undefined) {
  const { txByAccount, pendingCache } = useFints();
  return useMemo(() => {
    if (!booking) return null;
    for (const [owner, list] of Object.entries(txByAccount)) if (list?.includes(booking)) return { tx: booking, owner, pending: false };
    for (const [owner, list] of Object.entries(pendingCache)) if (list?.includes(booking)) return { tx: booking, owner, pending: true };
    const key = txKey(booking);
    for (const [owner, list] of Object.entries(txByAccount)) {
      const again = list?.find((tx) => txKey(tx) === key);
      if (again) return { tx: again, owner, pending: false };
    }
    return { tx: booking, owner: null, pending: false };
  }, [booking, txByAccount, pendingCache]);
}

export function ExplainAnswer({ turn, onShown }: { turn: Turn; onShown: () => void }) {
  const t = useT();
  const words = t.ask.explain;
  const { accounts, setTab } = useFints();
  const model = useRecurringModel();
  const loaded = useLoaded(turn.booking);
  const tx = loaded?.tx;
  // The live contract in Verträge & Abos that holds it, if one does.
  const series: RecurringSeries | null = useMemo(
    () => (tx ? [...model.expense, ...model.income].find((s) => s.transactions.includes(tx)) ?? null : null),
    [tx, model.expense, model.income],
  );
  if (!loaded || !tx) return <p className={TEXT}>{words.noBooking}</p>;

  const explained = explainBooking(tx, { name: txText(tx).name, contract: series ? { cadence: series.cadenceLabel } : null });
  const lines = explainLines(explained, words);
  const ids = explained.directDebit
    ? [{ label: words.mandate, value: explained.mandate }, { label: words.creditorId, value: explained.creditorId }].filter((r) => r.value)
    : [];

  const openBooking = () => {
    const account = accounts.find((a) => a.accountNumber === loaded.owner);
    // The Übersicht hosts the drawer: forward first, then the drawer on the next tick, once it is there.
    setTab('overview');
    setTimeout(() => openTxDetail(tx, loaded.pending, account), 0);
    onShown();
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        {lines.map((line) => <p key={line} className={TEXT}>{line}</p>)}
      </div>
      {ids.length > 0 && (
        <dl className="mt-3 -mx-2 flex flex-col gap-1.5 rounded-[12px] bg-[color-mix(in_srgb,var(--paper)_72%,transparent)] px-3 py-2.5">
          {ids.map((row) => (
            <div key={row.label}>
              <dt className="text-[12px] leading-4 text-ink-2">{row.label}</dt>
              <dd className="tnum text-[14px] leading-5 text-ink [overflow-wrap:anywhere]">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={openBooking}>{words.open}</Button>
        {series && (
          <Button
            variant="tertiary"
            size="sm"
            onClick={() => {
              setTab('contracts');
              onShown();
            }}
          >
            {t.ask.actions.openContracts}
          </Button>
        )}
      </div>
    </>
  );
}
