'use client';

// "Daueraufträge und Terminüberweisungen" — what the bank itself holds for an
// account and will carry out later, as its Bestand lists it (HKCDB / HKCSB,
// lib/fints-orders.ts). The close of Verträge & Abos: the page above is what
// the app recognises in the bookings, this is what the bank says it will do.
//
// Read only on request, because a read can cost a Freigabe; one press reads
// every kind the account can list, one after the other. Each order can be
// deleted where the bank allows it: a dialog names exactly what goes, then the
// bank asks for its Freigabe. What became of a deletion stays on its row —
// gelöscht, abgelehnt (in the bank's words), or unclear, which is never sent
// again by itself: reading the list again says how it stands.
//
// Amounts go through <Money> and the Verwendungszweck through <BankText>, so
// "Beträge ausblenden" reaches them; the delete dialog shows the figure
// regardless, like the transfer review — it is what is being confirmed.

import { useCallback, useId, useMemo, useState } from 'react';
import { bankAnswerLines, formatBankAnswer, refusalReference } from '@/lib/bank-answer';
import type { BankOrderKind, SerializedAccount, SerializedBankOrder } from '@/lib/fints-types';
import { fmtDate, fmtIban, isoDate, toLocalDate } from '@/lib/format';
import { rich, useT } from '@/lib/i18n/react';
import { nextExecution, rhythmLine, scheduleSentence } from '@/lib/order-schedule';
import { BankText } from './BankText';
import { useFints, type BankOrdersInfo, type OrderDeletion } from './FintsProvider';
import { CalendarIcon, RepeatIcon } from './icons';
import { Money } from './Money';
import { Alert, Button, Dialog, DotList, Select, Skeleton, Tag, TileHeader, cx } from './ui';

/** The tile's id: "Aufträge ansehen" and the palette scroll it into view. */
export const BANK_ORDERS_ID = 'bank-orders';

const KINDS: readonly BankOrderKind[] = ['standing', 'dated'];

/** Accounts with a list of either kind to read. */
export const listsOrders = (a: SerializedAccount) => !!(a.standing?.list || a.dated?.list);

/**
 * Opens Verträge & Abos on the bank's list — the transfer sheet's "Aufträge
 * ansehen", the palette. Once the tab has rendered, the tile is scrolled into
 * view and its heading takes focus, so a screen reader lands there too.
 */
export function useShowBankOrders() {
  const { setTab } = useFints();
  return useCallback(() => {
    setTab('contracts');
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // Two frames: the tab's content mounts in the first.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const tile = document.getElementById(BANK_ORDERS_ID);
      tile?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
      tile?.querySelector<HTMLElement>('[data-focus-target]')?.focus({ preventScroll: true });
    }));
  }, [setTab]);
}

/** "13:12 Uhr" ("13:12"). */
const clock = (t: ReturnType<typeof useT>, at: number) => {
  const d = new Date(at);
  return t.transfer.clock(`${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`);
};

export function BankOrders() {
  const {
    accounts, activeAccount, accountLabel, bankOrders, bankOrdersLoading, bankOrderErrors, orderDeletions,
    loadBankOrders, busy,
  } = useFints();
  const t = useT();
  const words = t.orders.list;
  const headingId = useId();
  const eligible = useMemo(() => accounts.filter(listsOrders), [accounts]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [removing, setRemoving] = useState<SerializedBankOrder | null>(null);

  // The account on screen where it has a list, else the first that has one.
  const account = eligible.find((a) => a.accountNumber === chosen)
    ?? eligible.find((a) => a.accountNumber === activeAccount?.accountNumber)
    ?? eligible[0];
  if (!account) return null;

  const acct = account.accountNumber;
  const kinds = KINDS.filter((k) => account[k]?.list);
  const reads = bankOrders[acct] ?? {};
  const loadingKind = bankOrdersLoading?.accountNumber === acct ? bankOrdersLoading.kind : null;
  const anyRead = kinds.some((k) => reads[k] || bankOrderErrors[acct]?.[k]);
  const lastRead = Math.max(0, ...kinds.map((k) => reads[k]?.loadedAt ?? 0));

  return (
    <section id={BANK_ORDERS_ID} className="panel scroll-mt-4 overflow-hidden" aria-labelledby={headingId}>
      <TileHeader
        title={<span tabIndex={-1} data-focus-target className="outline-none">{words.title}</span>}
        titleId={headingId}
        subtitle={<DotList items={[words.atBank, eligible.length === 1 && accountLabel(account)]} />}
        actions={anyRead ? (
          <Button
            variant="tertiary"
            size="xs"
            className="-mr-2.5"
            busy={!!loadingKind}
            disabled={busy && !loadingKind}
            onClick={() => loadBankOrders(account)}
          >
            {words.reload}
          </Button>
        ) : undefined}
      />

      {eligible.length > 1 && (
        <div className="px-4 pb-3 sm:px-5">
          <label htmlFor={`${headingId}-acct`} className="mb-1.5 block text-[13px] font-semibold text-ink-2">{words.account}</label>
          <Select
            id={`${headingId}-acct`}
            value={acct}
            containerClassName="w-full sm:w-80"
            onChange={(e) => setChosen(e.target.value)}
          >
            {eligible.map((a) => <option key={a.accountNumber} value={a.accountNumber}>{accountLabel(a)}</option>)}
          </Select>
        </div>
      )}

      {!anyRead && !loadingKind ? (
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          {/* The tile's title and its button say it; the note says what the
              press may cost, once, beside the one control that asks the bank. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => loadBankOrders(account)}>{words.load}</Button>
            <span className="text-[13px] leading-snug text-ink-3">{words.mayNeedApproval}</span>
          </div>
        </div>
      ) : (
        <>
          {kinds.map((kind) => (
            <KindGroup
              key={kind}
              kind={kind}
              account={account}
              info={reads[kind]}
              error={bankOrderErrors[acct]?.[kind]?.message ?? null}
              loading={loadingKind === kind}
              deletions={orderDeletions}
              onRemove={setRemoving}
            />
          ))}
          <p className="px-4 py-2.5 text-[13px] leading-snug text-ink-3 sm:px-5">
            <DotList items={[lastRead > 0 && <span className="tnum">{words.asOf(clock(t, lastRead))}</span>, words.change]} />
          </p>
        </>
      )}

      {removing && (
        <RemoveDialog
          account={account}
          order={removing}
          onClose={() => setRemoving(null)}
        />
      )}
    </section>
  );
}

function KindGroup({
  kind, account, info, error, loading, deletions, onRemove,
}: {
  kind: BankOrderKind;
  account: SerializedAccount;
  info: BankOrdersInfo | undefined;
  error: string | null;
  loading: boolean;
  deletions: Record<string, OrderDeletion>;
  onRemove: (o: SerializedBankOrder) => void;
}) {
  const { loadBankOrders, busy } = useFints();
  const t = useT();
  const words = t.orders.list;
  const Glyph = kind === 'standing' ? RepeatIcon : CalendarIcon;
  return (
    <div className="border-t border-line">
      <h3 className="flex items-center gap-2 px-4 pt-3 pb-1 text-[13px] font-semibold text-ink-2 sm:px-5">
        {t.orders.kinds[kind]}
        {info && !loading && <span className="tnum font-normal text-ink-3">{info.orders.length}</span>}
      </h3>
      {loading ? (
        <ul aria-hidden className="pb-2">
          {[60, 45].map((w) => (
            <li key={w} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
              <Skeleton circle className="size-10 shrink-0" />
              <div className="flex-1">
                <Skeleton className="h-3" style={{ width: `${w}%` }} />
                <Skeleton className="mt-2 h-3" style={{ width: `${w - 15}%` }} />
              </div>
              <Skeleton className="h-3.5 w-16" />
            </li>
          ))}
          <li className="sr-only" role="status">{words.loading}</li>
        </ul>
      ) : error ? (
        <div className="px-4 pb-3 sm:px-5">
          <Alert
            className="mt-1"
            title={t.common.fetchFailed}
            action={<Button size="xs" disabled={busy} onClick={() => loadBankOrders(account, [kind])}>{t.common.retry}</Button>}
          >
            {bankAnswerLines(error).join(' ') || error}
          </Alert>
        </div>
      ) : !info ? (
        <p className="px-4 pb-3 text-[13.5px] text-ink-3 sm:px-5">{words.notLoaded[kind]}</p>
      ) : (
        <>
          {info.orders.length === 0 && <p className="px-4 pb-3 text-[14px] text-ink-2 sm:px-5">{words.none[kind]}</p>}
          {info.orders.length > 0 && (
            <ul>
              {info.orders.map((o) => (
                <OrderRow key={o.ref} order={o} glyph={<Glyph size={18} />} deletion={deletions[o.ref]} onRemove={onRemove} />
              ))}
            </ul>
          )}
          {(!info.complete || info.unreadable > 0) && (
            <div className="px-4 pb-3 sm:px-5">
              <Alert tone="warn" className="mt-1">
                {!info.complete && <span className="block">{words.incomplete}</span>}
                {info.unreadable > 0 && <span className="block">{words.unreadable(info.unreadable)}</span>}
              </Alert>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** When it runs, short: "monatlich am 1. · nächste am 01.11.2026" — "am 15.10.2026". */
function whenLine(t: ReturnType<typeof useT>, o: SerializedBankOrder): string {
  const words = t.orders.list;
  const s = o.schedule;
  if (!s) return words.noSchedule;
  if (s.kind === 'dated') return words.on(fmtDate(toLocalDate(s.date)));
  const next = nextExecution(s, isoDate(new Date()));
  return [
    rhythmLine(s),
    next ? words.next(fmtDate(toLocalDate(next))) : words.ended,
    s.last ? words.until(fmtDate(toLocalDate(s.last))) : null,
  ].filter(Boolean).join(' · ');
}

function OrderRow({
  order: o, glyph, deletion, onRemove,
}: {
  order: SerializedBankOrder;
  glyph: React.ReactNode;
  deletion: OrderDeletion | undefined;
  onRemove: (o: SerializedBankOrder) => void;
}) {
  const { busy } = useFints();
  const t = useT();
  const words = t.orders.list;
  const deleted = deletion?.status === 'deleted';
  // A deleted order stays in the list it was read in, struck through and
  // receded — the list is from before; "Aktualisieren" shows the bank's state.
  const gone = deleted && 'opacity-60';
  return (
    <li className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-b-0 sm:px-5">
      <span aria-hidden className={cx('mt-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-inset text-headline', gone)}>
        {glyph}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cx('truncate text-[15px] leading-snug font-semibold text-ink', deleted && 'line-through', gone)}>
          {o.name || fmtIban(o.iban)}
        </p>
        <p className={cx('tnum mt-0.5 text-[13px] leading-snug text-ink-3', gone)}>{whenLine(t, o)}</p>
        {o.purpose && (
          <p className={cx('mt-0.5 truncate text-[13px] leading-snug text-ink-3', gone)}><BankText text={o.purpose} /></p>
        )}
        {o.more > 0 && <p className="mt-0.5 text-[13px] text-ink-3">{words.more(o.more)}</p>}

        {deleted && <Tag tone="positive" size="sm" className="mt-2">{words.deleted}</Tag>}
        {deletion?.status === 'refused' && <RefusedNote answers={deletion.answers} />}
        {deletion?.status === 'unclear' && (
          <>
            <Tag tone="emphasis" size="sm" className="mt-2">{t.common.statusUnclear}</Tag>
            <Alert tone="warn" className="mt-2">{words.deleteUnclear}</Alert>
          </>
        )}
      </div>
      {/* The amount and its one action share a column, so every amount lines up. */}
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Money value={-o.amount} currency={o.currency} signed tone="credit" className={cx('text-[15px] font-semibold', gone)} />
        {o.deletable && !deletion && (
          <Button
            variant="tertiary"
            size="xs"
            className="-mr-3"
            disabled={busy}
            aria-label={words.removeLabel(o.kind, o.name || fmtIban(o.iban))}
            onClick={() => onRemove(o)}
          >
            {words.remove}
          </Button>
        )}
      </div>
    </li>
  );
}

/** A refused deletion: the bank's reason, verbatim, and its code once, small. */
function RefusedNote({ answers }: { answers?: string }) {
  const t = useT();
  const lines = formatBankAnswer(answers).lines;
  const reference = refusalReference(answers);
  return (
    <Alert className="mt-2" title={lines.length ? t.orders.remove.refused : t.orders.remove.refusedPlain}>
      {lines.length > 0 && <span className="block">{lines.join(' ')}</span>}
      {reference && (
        <span className="mt-1 block text-[12.5px] text-ink-3">
          {rich(t.transfer.bankAnswer.reference(<span className="tnum">{reference}</span>))}
        </span>
      )}
    </Alert>
  );
}

/**
 * "Dauerauftrag löschen?" — exactly what goes: the amount (shown whatever
 * "Beträge ausblenden" says: it is what is confirmed), the payee, the IBAN,
 * when it runs and its Verwendungszweck. The safe answer is focused; the red
 * one deletes, and the bank's Freigabe follows.
 */
function RemoveDialog({ account, order: o, onClose }: { account: SerializedAccount; order: SerializedBankOrder; onClose: () => void }) {
  const { deleteBankOrder } = useFints();
  const t = useT();
  const words = t.orders.remove;
  return (
    <Dialog
      open
      onClose={onClose}
      title={words.title[o.kind]}
      description={`${words.body[o.kind]} ${words.approval}`}
      actions={(
        <>
          <Button data-autofocus onClick={onClose}>{words.keep}</Button>
          <Button variant="danger" onClick={() => { onClose(); void deleteBankOrder(account, o); }}>{words.confirm[o.kind]}</Button>
        </>
      )}
    >
      <div className="rounded-[12px] bg-inset px-4 py-4">
        <Money value={o.amount} currency={o.currency} masked={false} className="text-[24px] leading-tight font-bold text-headline" />
        <p className="mt-1 text-[15px] leading-snug font-semibold break-words text-ink">{t.auth.tanWait.to(o.name || fmtIban(o.iban))}</p>
        <p className="iban mt-0.5 overflow-x-auto text-[14px] text-ink-2 [scrollbar-width:none]">{fmtIban(o.iban)}</p>
        {o.schedule && <p className="tnum mt-2 text-[14px] leading-snug text-ink-2">{scheduleSentence(o.schedule)}</p>}
        {o.purpose && <p className="mt-1 text-[14px] leading-snug break-words text-ink-2">{o.purpose}</p>}
      </div>
    </Dialog>
  );
}
