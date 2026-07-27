'use client';

import { useMemo, useState } from 'react';
import { fmtDate, fmtIban, fmtMoney, groupLabel, initials, isFutureDate, txTime } from '@/lib/format';
import type { Merchant, SerializedTransaction } from '@/lib/fints-types';
import { useFints, useMerchant } from './FintsProvider';
import {
  ArrowDownIcon, Button, ClockIcon, CloseIcon, Disclosure, IconButton, Overlay,
  RefreshIcon, SearchIcon, SkeletonRow, cx,
} from './ui';

/** One day of bookings — the unit the statement is already grouped into. */
type DayGroup = {
  label: string;
  future: boolean;
  txs: SerializedTransaction[];
};

export function Transactions() {
  const { activeAccount, transactions, loadingAccount, txError } = useFints();
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<{ tx: SerializedTransaction; pending: boolean } | null>(null);
  // Collapsed rather than expanded: a day the user has never touched is open,
  // which is what someone scanning a statement wants.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const loading = !!activeAccount && loadingAccount === activeAccount.accountNumber;

  const groups = useMemo<DayGroup[]>(() => {
    const list = transactions ?? [];
    const q = query.trim().toLowerCase();
    const matched = q
      ? list.filter((t) => `${t.remoteName} ${t.purpose} ${t.bookingText} ${t.remoteIban}`.toLowerCase().includes(q))
      : list.slice();
    matched.sort((a, b) => txTime(b) - txTime(a));

    const out: DayGroup[] = [];
    for (const t of matched) {
      const date = t.entryDate || t.valueDate;
      const label = groupLabel(date);
      const last = out[out.length - 1];
      if (last && last.label === label) last.txs.push(t);
      else out.push({ label, future: isFutureDate(date), txs: [t] });
    }
    return out;
  }, [transactions, query]);

  if (!activeAccount) return null;

  const empty = groups.length === 0;

  return (
    <>
      <PendingPanel />

      <div className="relative mb-3.5">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3">
          <SearchIcon size={15} />
        </span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Umsätze durchsuchen …"
          aria-label="Umsätze durchsuchen"
          className="w-full rounded-[9px] border border-line bg-surface py-2.5 pr-3 pl-10 outline-none focus:border-accent"
        />
      </div>

      <div className="panel overflow-clip">
        {loading && Array.from({ length: 7 }, (_, i) => <SkeletonRow key={i} width={40 + ((i * 37) % 45)} />)}

        {!loading && txError && (
          <EmptyState>{txError}</EmptyState>
        )}

        {!loading && !txError && empty && (
          <EmptyState icon>
            {query
              ? 'Kein Umsatz passt zu dieser Suche.'
              : 'Keine Umsätze im gewählten Zeitraum. Weite den Zeitraum oben aus, um weiter zurückzublicken.'}
          </EmptyState>
        )}

        {!loading && !txError && groups.map((g) => (
          <Disclosure
            key={g.label}
            sticky
            tone="inset"
            open={!collapsed[g.label]}
            onToggle={() => setCollapsed((c) => ({ ...c, [g.label]: !c[g.label] }))}
            title={
              <span className="eyebrow flex items-center gap-2">
                {g.label}
                {g.future && (
                  <span
                    className="rounded-full bg-[color-mix(in_srgb,var(--ink-3)_16%,transparent)] px-1.5 py-px text-ink-2"
                    title="Diese Buchungen tragen einen Buchungstag in der Zukunft — die Bank verbucht sie erst an diesem Tag."
                  >
                    noch nicht gebucht
                  </span>
                )}
              </span>
            }
          >
            {g.txs.map((t, i) => (
              <TxRow
                key={`${t.bankReference}-${t.e2eReference}-${i}`}
                tx={t}
                onOpen={() => setDetail({ tx: t, pending: false })}
              />
            ))}
          </Disclosure>
        ))}
      </div>

      {detail && (
        <TransactionDetail tx={detail.tx} pending={detail.pending} onClose={() => setDetail(null)} />
      )}
    </>
  );
}

function TxRow({
  tx, onOpen, tone = 'booked',
}: {
  tx: SerializedTransaction;
  onOpen: () => void;
  tone?: 'booked' | 'pending';
}) {
  const credit = tx.amount >= 0;
  const name = tx.remoteName || tx.bookingText || 'Buchung';
  const desc = tx.purpose || (tx.remoteName ? tx.bookingText : '') || '';
  const merchant = useMerchant(tx);
  // A Buchungstag the bank has stamped ahead of today — the entry is real and
  // value-dated, but it hasn't been booked yet.
  const futureBooking = tone === 'booked' && isFutureDate(tx.entryDate);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3.5 border-b border-line px-4 py-3 text-left transition-colors duration-100 last:border-b-0 hover:bg-inset"
    >
      <TxAvatar merchant={merchant} name={name} credit={credit} tone={tone} />

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{name}</span>
        {desc && <span className="mt-0.5 block truncate text-[12.5px] text-ink-3">{desc}</span>}
      </span>

      <span className="shrink-0 text-right">
        <span className={cx('num block text-[14.5px] font-semibold', credit && 'text-green')}>
          {credit ? '+' : '−'}{fmtMoney(Math.abs(tx.amount), tx.currency)}
        </span>
        <span
          className={cx('num mt-0.5 block text-[11px]', tone === 'pending' ? 'text-amber' : 'text-ink-3')}
          title={futureBooking ? `Buchungstag ${fmtDate(tx.entryDate)} · Wertstellung ${fmtDate(tx.valueDate)}` : undefined}
        >
          {tone === 'pending'
            ? (tx.valueDate ? `Wert ${fmtDate(tx.valueDate)}` : 'vorgemerkt')
            // Naming the field stops a forward-dated Buchungstag from reading
            // like the day the money actually moved.
            : futureBooking
              ? `Buchung ${fmtDate(tx.entryDate)}`
              : fmtDate(tx.entryDate || tx.valueDate)}
        </span>
      </span>
    </button>
  );
}

/**
 * The payment provider a purchase went through, notched into the corner of the
 * shop's mark.
 *
 * It exists to answer a question the row otherwise raises: the statement names
 * PayPal, the row shows G2A. Small and secondary on purpose — the shop is what
 * the row is about, and the provider is only how the money got there. It
 * disappears rather than falling back to a monogram, since a badge nobody can
 * read is worse than no badge.
 */
function ViaBadge({ via }: { via: NonNullable<Merchant['via']> }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    <span
      aria-hidden
      className="absolute -right-1 -bottom-1 flex size-[15px] items-center justify-center overflow-hidden rounded-full border-2 border-surface bg-white"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/merchant-logo?id=${via.logo}`}
        alt=""
        onError={() => setBroken(true)}
        className="max-h-full max-w-full object-contain"
      />
    </span>
  );
}

/**
 * The company mark when the counterparty was recognised, otherwise the plain
 * avatar. A logo that fails to load falls back too, so a broken image can never
 * replace a transaction's identity with an empty box.
 */
function TxAvatar({
  merchant, name, credit, tone,
}: {
  merchant: Merchant | null | undefined;
  name: string;
  credit: boolean;
  tone: 'booked' | 'pending';
}) {
  const [broken, setBroken] = useState(false);

  if (merchant && !broken) {
    return (
      // The badge has to sit outside the tile: the tile clips its overflow so a
      // wordmark can't escape it, and the provider mark deliberately does.
      <span
        title={merchant.via ? `${merchant.label} · über ${merchant.via.label}` : merchant.label}
        className="relative shrink-0"
      >
        {/* A rounded tile rather than the circle used for initials: some
            Brandfetch marks are horizontal wordmarks, which a circle would crop
            to nothing. It matches the pill the bank's own logo sits in
            elsewhere in the app. The chip stays light in both themes — company
            marks are drawn for white backgrounds, and a navy wordmark would
            vanish on paper ink. */}
        <span className="flex size-9 items-center justify-center overflow-hidden rounded-[10px] border border-line bg-white p-[3px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/merchant-logo?id=${merchant.logo}`}
            alt=""
            onError={() => setBroken(true)}
            // Bounded on both axes so a tall mark letterboxes instead of being
            // cropped by the tile. Deliberately not `loading="lazy"`: an <img>
            // that is 0×0 until it loads gets skipped by the lazy loader and then
            // never loads at all.
            className="max-h-full max-w-full object-contain"
          />
        </span>

        {merchant.via && <ViaBadge via={merchant.via} />}
      </span>
    );
  }

  return (
    <span
      className={cx(
        'grid size-9 shrink-0 place-items-center rounded-full border text-[12.5px] font-semibold',
        tone === 'pending'
          ? 'border-transparent bg-amber-soft text-amber'
          : credit
            ? 'border-transparent bg-green-soft text-green'
            : 'border-line bg-inset text-ink-2',
      )}
    >
      {credit ? initials(name) : <ArrowDownIcon />}
    </span>
  );
}

function EmptyState({ children, icon }: { children: React.ReactNode; icon?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-6 py-12 text-center text-sm text-ink-3">
      {icon && (
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
          <path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )}
      <p className="max-w-[46ch]">{children}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vorgemerkte Umsätze (HKVMK) — loaded on demand so it never adds a TAN prompt
// to a normal account view.
// ---------------------------------------------------------------------------
function PendingPanel() {
  const { activeAccount: a, pendingCache, pendingLoading, loadPending } = useFints();
  const [detail, setDetail] = useState<SerializedTransaction | null>(null);
  const [open, setOpen] = useState(true);

  if (!a?.canPending) return null;

  const loading = pendingLoading === a.accountNumber;
  const cached = pendingCache[a.accountNumber];

  if (loading) {
    return (
      <div className="panel mb-4 overflow-clip">
        <div className="bg-amber-soft px-4 py-2.5">
          <span className="eyebrow text-amber">Vorgemerkt</span>
        </div>
        <SkeletonRow width={52} />
      </div>
    );
  }

  if (!cached) {
    return (
      <div className="panel mb-4 flex items-center gap-3 px-4 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-amber-soft text-amber">
          <ClockIcon />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-semibold">Vorgemerkte Umsätze</span>
          <span className="block text-[12px] text-ink-3">
            Noch nicht gebuchte Buchungen, z. B. anstehende Lastschriften. Kann eine TAN-Freigabe erfordern.
          </span>
        </span>
        <Button size="sm" onClick={() => void loadPending(a)}>Anzeigen</Button>
      </div>
    );
  }

  const txs = cached.slice().sort((x, y) => txTime(y) - txTime(x));

  return (
    <>
      <Disclosure
        className="panel mb-4 overflow-clip"
        tone="amber"
        open={open}
        onToggle={() => setOpen(!open)}
        title={<span className="eyebrow text-amber">Vorgemerkt</span>}
        trailing={
          <IconButton
            className="size-7 text-amber hover:bg-[color-mix(in_srgb,var(--amber)_14%,transparent)] hover:text-amber"
            onClick={() => void loadPending(a)}
            title="Aktualisieren"
            aria-label="Vorgemerkte Umsätze aktualisieren"
          >
            <RefreshIcon />
          </IconButton>
        }
      >
        {txs.length ? (
          txs.map((t, i) => (
            <TxRow key={`${t.e2eReference}-${i}`} tx={t} tone="pending" onOpen={() => setDetail(t)} />
          ))
        ) : (
          <p className="px-4 py-5 text-center text-[13px] text-ink-3">Keine vorgemerkten Umsätze.</p>
        )}
      </Disclosure>

      {detail && <TransactionDetail tx={detail} pending onClose={() => setDetail(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Detail drawer
// ---------------------------------------------------------------------------
function TransactionDetail({
  tx, pending, onClose,
}: {
  tx: SerializedTransaction;
  pending: boolean;
  onClose: () => void;
}) {
  const { toast, printTransaction } = useFints();
  const credit = tx.amount >= 0;
  const merchant = useMerchant(tx);

  const rows: [string, string, boolean?][] = [
    ['Empfänger / Auftraggeber', tx.remoteName],
    ['IBAN / Konto', tx.remoteIban ? fmtIban(tx.remoteIban) : '', true],
    ['BIC', tx.remoteBic, true],
    ['Verwendungszweck', tx.purpose, true],
    ['Buchungstag', fmtDate(tx.entryDate)],
    ['Wertstellung', fmtDate(tx.valueDate)],
    ['Buchungstext', tx.bookingText],
    ['End-to-End-Referenz', tx.e2eReference, true],
    ['Mandatsreferenz', tx.mandateReference, true],
    ['Kundenreferenz', tx.customerReference !== 'NONREF' ? tx.customerReference : ''],
    ['Bankreferenz', tx.bankReference],
    ['Geschäftsvorfallcode', tx.transactionCode],
    ['Primanota', tx.primeNotesNr],
    ['Auszug Nr.', tx.statementNumber],
    ['Zusatzinformation', tx.additionalInformation],
  ];

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value.replace(/\s+/g, ' '));
      toast('Kopiert');
    } catch {
      toast('Kopieren nicht möglich', 'error');
    }
  };

  return (
    <Overlay open align="right" onClose={onClose}>
      <div className="anim-drawer h-dvh w-full max-w-[430px] overflow-y-auto bg-surface px-6 pt-5 pb-10 shadow-[var(--shadow-pop)]">
        <div className="mb-4 flex items-center justify-between">
          <span className="eyebrow">Umsatzdetails</span>
          <span className="flex items-center gap-1">
            <Button size="sm" onClick={() => printTransaction(tx, pending)} title="Diesen Umsatz als PDF speichern">
              Als PDF
            </Button>
            <IconButton onClick={onClose} aria-label="Schließen"><CloseIcon /></IconButton>
          </span>
        </div>

        {pending && (
          <span className="mb-2.5 inline-flex items-center gap-1.5 rounded-full bg-amber-soft px-2.5 py-1 text-[12px] font-semibold text-amber">
            <ClockIcon size={14} /> Vorgemerkt · noch nicht gebucht
          </span>
        )}

        <p className={cx('num text-[34px] font-semibold tracking-tight', credit && 'text-green')}>
          {credit ? '+' : '−'}{fmtMoney(Math.abs(tx.amount), tx.currency)}
        </p>
        <div className="flex items-center gap-2">
          {merchant && (
            <TxAvatar merchant={merchant} name={tx.remoteName} credit={credit} tone="booked" />
          )}
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">{tx.remoteName || tx.bookingText || 'Buchung'}</p>
            {tx.bookingText && <p className="text-[12.5px] text-ink-3">{tx.bookingText}</p>}
          </div>
        </div>

        <dl className="mt-5 border-t border-line">
          {rows.filter(([, v]) => v).map(([label, value, copyable]) => (
            <div key={label} className="border-b border-line py-2.5">
              <dt className="eyebrow mb-1">{label}</dt>
              <dd className="flex items-baseline gap-2 text-[13.5px] break-words">
                <span className="min-w-0">{value}</span>
                {copyable && (
                  <button
                    type="button"
                    onClick={() => void copy(value)}
                    aria-label={`${label} kopieren`}
                    title="Kopieren"
                    className="shrink-0 rounded p-0.5 text-ink-3 hover:text-accent"
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
                      <rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M5 15V6a2 2 0 0 1 2-2h9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Overlay>
  );
}
