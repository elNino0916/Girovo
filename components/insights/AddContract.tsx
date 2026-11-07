'use client';

// A contract Verträge & Abos did not recognise, added by the user from one of
// its bookings (lib/manual-contracts.ts): "Als Vertrag merken" in a booking's
// details, or "Vertrag hinzufügen" in Verträge & Abos, which first asks for
// the booking. The dialog then names it and sets its rhythm — read from the
// bookings that would belong where there are two or more — and says how many
// bookings that is. Every booking from the same payer at a similar amount
// belongs, earlier and later ones alike (lib/recurring.ts).

import { useMemo, useRef, useState } from 'react';
import type { SerializedTransaction } from '@/lib/fints-types';
import { dayKey, displayName } from '@/lib/format';
import { useT } from '@/lib/i18n/react';
import { MANUAL_CADENCES } from '@/lib/manual-contracts';
import { cadenceLabel, manualId, manualPreview, type Cadence, type RecurringSeries } from '@/lib/recurring';
import { useFints } from '../FintsProvider';
import { Money } from '../Money';
import { SearchIcon } from '../icons';
import { Alert, Button, Dialog, Field, Input, Select } from '../ui';
import { txText } from '../transactions/model';
import { useRecurringModel } from './recurring-model';
import { fmtDayKey } from './shared';

const LIST_MAX = 40;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const dayOf = (tx: SerializedTransaction) => dayKey(tx.entryDate || tx.valueDate);

/** The bookings already in a contract, recognised or added: nothing to add there. */
export function useInContract(): Set<SerializedTransaction> {
  const model = useRecurringModel();
  return useMemo(
    () => new Set([...model.income, ...model.expense, ...model.ended, ...model.dismissed].flatMap((s: RecurringSeries) => s.transactions)),
    [model.income, model.expense, model.ended, model.dismissed],
  );
}

/** `tx`: the booking it is made from; without one, the dialog asks for it first. */
export function AddContractDialog({ tx: given, onClose }: { tx?: SerializedTransaction | null; onClose: () => void }) {
  const [tx, setTx] = useState<SerializedTransaction | null>(given ?? null);
  return tx
    ? <DetailsStep tx={tx} onBack={given ? undefined : () => setTx(null)} onClose={onClose} />
    : <PickStep onPick={setTx} onClose={onClose} />;
}

function PickStep({ onPick, onClose }: { onPick: (tx: SerializedTransaction) => void; onClose: () => void }) {
  const t = useT();
  const words = t.insights.contracts.manual;
  const model = useRecurringModel();
  const inContract = useInContract();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...model.txs]
      .filter((tx) => Number(tx.amount) !== 0 && !inContract.has(tx))
      .filter((tx) => !q || `${txText(tx).name} ${tx.purpose ?? ''} ${Math.abs(Number(tx.amount)).toFixed(2).replace('.', ',')}`.toLowerCase().includes(q))
      .sort((a, b) => dayOf(b).localeCompare(dayOf(a)))
      .slice(0, LIST_MAX);
  }, [model.txs, inContract, query]);

  return (
    <Dialog
      open
      onClose={onClose}
      title={words.pickTitle}
      description={words.pickIntro}
      size="md"
      initialFocus={searchRef}
      actions={<Button variant="secondary" onClick={onClose}>{t.common.cancel}</Button>}
    >
      <Input
        ref={searchRef}
        type="search"
        aria-label={words.search}
        placeholder={words.search}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        leading={<SearchIcon size={18} />}
        autoComplete="off"
      />
      {candidates.length ? (
        <ul className="mt-3 -mx-2 max-h-[min(50vh,420px)] overflow-y-auto">
          {candidates.map((tx, i) => (
            <li key={`${dayOf(tx)}|${i}`}>
              <button
                type="button"
                onClick={() => onPick(tx)}
                className="row-focus flex w-full items-center gap-3 rounded-[12px] px-2 py-2.5 text-left transition-colors duration-150 hover:bg-inset"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] leading-6 text-ink">{displayName(txText(tx).name) || t.insights.noName}</span>
                  <span className="tnum block text-[14px] leading-5 text-ink-2">{fmtDayKey(dayOf(tx))}</span>
                </span>
                <Money value={Number(tx.amount)} currency={tx.currency} signed tone="credit" className="shrink-0 text-[16px] font-medium" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-[14px] leading-5 text-ink-2">{words.noMatches}</p>
      )}
    </Dialog>
  );
}

function DetailsStep({ tx, onBack, onClose }: { tx: SerializedTransaction; onBack?: () => void; onClose: () => void }) {
  const t = useT();
  const words = t.insights.contracts.manual;
  const model = useRecurringModel();
  const { setManualContract, toast } = useFints();
  const preview = useMemo(() => manualPreview(model.txs, tx), [model.txs, tx]);
  const bankName = displayName(txText(tx).name) || t.insights.noName;
  const [name, setName] = useState(bankName);
  const [cadence, setCadence] = useState<Cadence>(preview?.cadence ?? 'monthly');
  const nameRef = useRef<HTMLInputElement>(null);

  const save = () => {
    if (!preview) return;
    const typed = name.trim();
    setManualContract(manualId(preview.key, preview.shop, preview.cents), {
      key: preview.key,
      ...(preview.shop ? { shop: preview.shop } : {}),
      cents: preview.cents,
      cadence,
      // The bank's own name is kept as the bank's: it follows the bookings.
      name: typed && typed !== bankName ? typed : '',
      at: dayKey(new Date()),
    });
    toast(words.added(typed || bankName), 'info');
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={words.title}
      size="md"
      initialFocus={nameRef}
      actions={(
        <>
          {onBack && <Button variant="tertiary" className="mr-auto" onClick={onBack}>{words.other}</Button>}
          <Button variant="secondary" onClick={onClose}>{t.common.cancel}</Button>
          {preview && <Button variant="primary" onClick={save}>{words.save}</Button>}
        </>
      )}
    >
      {/* The booking it is made from. */}
      <div className="mb-5 flex items-baseline justify-between gap-3 rounded-[12px] bg-inset px-4 py-3">
        <span className="min-w-0">
          <span className="block truncate text-[16px] leading-6 text-ink">{bankName}</span>
          <span className="tnum block text-[14px] leading-5 text-ink-2">{fmtDayKey(dayOf(tx))}</span>
        </span>
        <Money value={Number(tx.amount)} currency={tx.currency} signed tone="credit" className="shrink-0 text-[16px] font-medium" />
      </div>

      {preview ? (
        <>
          <Field label={words.name} htmlFor="manual-name">
            <Input
              id="manual-name"
              ref={nameRef}
              value={name}
              maxLength={70}
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  save();
                }
              }}
            />
          </Field>
          <Field label={words.rhythm} htmlFor="manual-rhythm" hint={preview.cadence ? words.guessed : undefined}>
            <Select id="manual-rhythm" value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)}>
              {MANUAL_CADENCES.map((c) => <option key={c} value={c}>{capital(cadenceLabel(c))}</option>)}
            </Select>
          </Field>
          <p className="text-[14px] leading-5 text-ink-2">{words.found(preview.count, fmtDayKey(preview.firstDate))}</p>
        </>
      ) : (
        <Alert tone="info">{words.noPayer}</Alert>
      )}
    </Dialog>
  );
}
