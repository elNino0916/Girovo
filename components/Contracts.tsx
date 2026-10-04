'use client';

// "Verträge & Abos" — the payments that come back on a rhythm, recognised in
// the bookings already loaded for every account of this session (salary,
// rent, energy, insurance, subscriptions). And "Demnächst fällig", the short
// list of what the next 30 days are expected to bring, for the overview.
//
// All of it is a guess drawn from history (lib/recurring.ts) and says so:
// amounts are "ca." and in whole euros, dates "voraussichtlich", totals a
// "Schätzung". The basis — which accounts, each with its period, which are
// missing — is always on screen; a history too short for the slower rhythms
// says what it cannot show; and the user can overrule the guess ("Nicht als
// Vertrag zählen"), which is remembered in the vault.

import { useCallback, useId, useMemo } from 'react';
import { useFints } from './FintsProvider';
import { ArrowRightIcon, ChevronIcon } from './icons';
import { Money } from './Money';
import { Alert, Button, Disclosure, DotList, EmptyState, ErrorState, Skeleton, Spinner, Tile, cx } from './ui';
import { fmtRange, displayName, presetRange } from '@/lib/format';
import type { Cadence, RecurringSeries } from '@/lib/recurring';
import { ContractGroup, ContractRow, DismissedRow } from './insights/ContractRow';
import { useRecurringModel, useUpcoming, type AccountBasis, type RecurringModel } from './insights/recurring-model';
import { LoadHistoryButton, RoundMoney, YEAR_SPAN, daysUntil, fmtWeekdayShort } from './insights/shared';

/** "103 Umsätze" — joined by a no-break space, so a count never wraps away from its noun. */
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('de-DE')} ${n === 1 ? one : many}`;

const MAY_NEED_TAN = 'Kann eine Freigabe erfordern.';

const CADENCE_ADJECTIVE: Partial<Record<Cadence, string>> = {
  quarterly: 'vierteljährliche',
  halfyearly: 'halbjährliche',
  yearly: 'jährliche',
};

/** "Vierteljährliche und jährliche" — the rhythms a short history cannot show, as one phrase. */
function unseenPhrase(unseen: readonly Cadence[]): string {
  const words = unseen.map((c) => CADENCE_ADJECTIVE[c]).filter((w): w is string => !!w);
  const text = words.length > 1 ? `${words.slice(0, -1).join(', ')} und ${words[words.length - 1]}` : words[0] ?? '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function useDismiss() {
  const { dismissRecurring, restoreRecurring, toast } = useFints();
  const dismiss = useCallback((s: RecurringSeries) => {
    dismissRecurring(s.id);
    toast(`„${displayName(s.name)}“ zählt nicht mehr als Vertrag.`, 'info', 6500, {
      label: 'Rückgängig',
      run: () => restoreRecurring(s.id),
    });
  }, [dismissRecurring, restoreRecurring, toast]);
  const restore = useCallback((s: RecurringSeries) => restoreRecurring(s.id), [restoreRecurring]);
  return { dismiss, restore };
}

// ---------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------

export function Contracts() {
  const model = useRecurringModel();
  const { vaultStatus, accountLabel } = useFints();
  const { dismiss, restore } = useDismiss();

  if (model.loading) return <ContractsSkeleton />;

  const { basis, income, groups, ended, dismissed, totals, accountOf } = model;
  const live = income.length + model.expense.length;
  const several = model.accounts.filter((b) => b.status === 'included').length > 1;
  // The account a contract is paid from, named on its row when there are several.
  const accountName = (s: RecurringSeries) => {
    if (!several) return null;
    const acct = accountOf(s);
    const b = model.accounts.find((x) => x.account.accountNumber === acct);
    return b ? accountLabel(b.account) : null;
  };

  if (!basis) return <NoBasis model={model} />;
  const shortHistory = basis.shortestSpan < YEAR_SPAN;

  return (
    <div className="min-w-0 space-y-4 sm:space-y-6">
      <SummaryTile model={model} shortHistory={shortHistory} />

      {live === 0 && !model.incomplete && (
        <section className="panel" aria-label="Keine Verträge erkannt">
          {/* No bookings at all is a different finding from bookings without
              a rhythm — "wiederholt sich keine Zahlung" would be a stretch. */}
          {basis.bookings === 0 ? (
            <EmptyState illustration="contracts" title="Keine Umsätze im geladenen Zeitraum">
              Für {fmtRange(basis.from, basis.to)} liegen keine Buchungen vor, in denen sich regelmäßige Zahlungen
              erkennen ließen.
            </EmptyState>
          ) : (
            <EmptyState illustration="contracts" title="Keine regelmäßigen Zahlungen erkannt">
              Im Zeitraum {fmtRange(basis.from, basis.to)} wiederholt sich keine Zahlung oft und gleichmäßig genug,
              um sie als Vertrag zu erkennen.
              {shortHistory && ' Mit einem längeren Verlauf klappt das oft besser.'}
            </EmptyState>
          )}
        </section>
      )}

      {income.length > 0 && (
        <ContractGroup
          title="Regelmäßige Eingänge"
          subtitle={<>ca. <RoundMoney value={totals.monthlyIncome} currency={totals.currency} /> pro Monat</>}
          headerNext="Nächster Eingang"
        >
          {income.map((s) => <ContractRow key={s.id} s={s} account={accountName(s)} onDismiss={dismiss} />)}
        </ContractGroup>
      )}

      {/* The regular payments out, grouped as a household reads them — the
          rent apart from the subscriptions — each group with its own sums. */}
      {groups.map((g) => (
        <ContractGroup
          key={g.id}
          title={g.label}
          subtitle={
            <DotList
              items={[
                <>ca. <RoundMoney value={g.monthly} currency={g.currency} /> pro Monat</>,
                <>ca. <RoundMoney value={g.yearly} currency={g.currency} /> im Jahr</>,
                plural(g.series.length, 'Vertrag', 'Verträge'),
              ]}
            />
          }
        >
          {g.series.map((s) => <ContractRow key={s.id} s={s} account={accountName(s)} onDismiss={dismiss} />)}
        </ContractGroup>
      ))}

      {/* On phones the "load a year" notice follows the list instead of
          pushing it below the first screen (see SummaryTile). */}
      {shortHistory && (
        <section className="panel overflow-hidden sm:hidden" aria-label="Längerer Verlauf">
          <HistoryNotice model={model} />
        </section>
      )}

      {(ended.length > 0 || dismissed.length > 0) && (
        <section className="panel overflow-hidden" aria-label="Weitere erkannte Zahlungen">
          {ended.length > 0 && (
            <Disclosure
              title={<span className="text-[15px] font-semibold text-ink">Beendet ({ended.length})</span>}
              trailing={<span className="hidden text-[13px] text-ink-3 sm:inline">Nicht in den Summen</span>}
              headerClassName="min-h-14 sm:px-6"
            >
              <p className="border-t border-line px-4 pt-3 pb-1 text-[13px] text-ink-3 sm:px-6">
                Zweimal ausgeblieben — vermutlich gekündigt oder umgestellt.
              </p>
              <ul>{ended.map((s) => <ContractRow key={s.id} s={s} account={accountName(s)} onDismiss={dismiss} />)}</ul>
            </Disclosure>
          )}
          {dismissed.length > 0 && (
            <Disclosure
              title={<span className="text-[15px] font-semibold text-ink">Ausgeblendet ({dismissed.length})</span>}
              trailing={<span className="hidden text-[13px] text-ink-3 sm:inline">Nicht als Vertrag gezählt</span>}
              headerClassName="min-h-14 sm:px-6"
              className={ended.length > 0 ? 'border-t border-line' : undefined}
            >
              {vaultStatus === 'error' || vaultStatus === 'unavailable' ? (
                <p className="border-t border-line px-4 pt-3 pb-1 text-[13px] text-ink-3 sm:px-6">
                  Deine persönlichen Daten sind gerade nicht verfügbar — diese Auswahl gilt nur bis zur Abmeldung.
                </p>
              ) : null}
              <ul className="border-t border-line">{dismissed.map((s) => <DismissedRow key={s.id} s={s} onRestore={restore} />)}</ul>
            </Disclosure>
          )}
        </section>
      )}
    </div>
  );
}

/** Nothing loaded at all: why, and the way to change it. */
function NoBasis({ model }: { model: RecurringModel }) {
  const { activeAccount, busy, refreshAccount, accountLabel } = useFints();
  const own = model.accounts.find((b) => b.account.accountNumber === activeAccount?.accountNumber);
  if (own?.status === 'failed' && activeAccount) {
    return (
      <section className="panel" aria-label="Verträge und Abos">
        <ErrorState title="Umsätze konnten nicht abgerufen werden" onRetry={() => refreshAccount(activeAccount)} busy={busy}>
          {own.error} Ohne Umsätze lassen sich keine Verträge erkennen.
        </ErrorState>
      </section>
    );
  }
  const canLoad = !!activeAccount?.canStatements;
  return (
    <section className="panel" aria-label="Verträge und Abos">
      <EmptyState
        illustration="contracts"
        title="Noch keine Umsätze abgerufen"
        action={canLoad && activeAccount ? (
          <Button variant="primary" size="sm" disabled={busy} onClick={() => refreshAccount(activeAccount)}>
            Umsätze abrufen
          </Button>
        ) : undefined}
      >
        Regelmäßige Zahlungen erkennt die App auf diesem Rechner in den Umsätzen deiner Konten
        {canLoad && activeAccount ? <> — zuerst {accountLabel(activeAccount)}. {MAY_NEED_TAN}</> : '.'}
      </EmptyState>
    </section>
  );
}

function SummaryTile({ model, shortHistory }: { model: RecurringModel; shortHistory: boolean }) {
  const { basis, totals, income, expense, groups, otherCurrency, unseen } = model;
  const headingId = useId();
  if (!basis) return null;
  const live = income.length + expense.length;
  const housing = groups.find((g) => g.id === 'housing');
  const rest = groups.filter((g) => g.id !== 'housing');
  const restMonthly = Math.round(rest.reduce((sum, g) => sum + g.monthly * 100, 0)) / 100;
  const restCount = rest.reduce((n, g) => n + g.series.length, 0);
  const failed = model.accounts.filter((b) => b.status === 'failed');

  return (
    <section className="panel overflow-hidden" aria-labelledby={headingId}>
      {/* Where focus lands when the row that held it goes away (focusAfterRemoval). */}
      <h2 id={headingId} className="sr-only" data-focus-fallback>Zusammenfassung</h2>
      {failed.length > 0 ? (
        // A sum without a failed account would look complete and is not.
        <FailedNotice failed={failed} />
      ) : live > 0 && (
        // With nothing recognised there is nothing to add up — "ca. 0 €"
        // would read as a finding. The basis and the notice still show.
        <dl className="grid grid-cols-2 gap-px border-b border-line bg-line desk:grid-cols-4">
          {housing && rest.length > 0 ? (
            <>
              <SummaryFigure label={housing.label} sub={`pro Monat · ${plural(housing.series.length, 'Vertrag', 'Verträge')}`}>
                <RoundMoney value={housing.monthly} currency={totals.currency} />
              </SummaryFigure>
              <SummaryFigure label="Abos & Verträge" sub={`pro Monat · ${plural(restCount, 'Vertrag', 'Verträge')}`}>
                <RoundMoney value={restMonthly} currency={totals.currency} />
              </SummaryFigure>
            </>
          ) : (
            <SummaryFigure label="Fixkosten" sub={`pro Monat · ${plural(expense.length, 'Vertrag', 'Verträge')}`}>
              <RoundMoney value={totals.monthlyExpense} currency={totals.currency} />
            </SummaryFigure>
          )}
          <SummaryFigure
            label="Eingänge"
            sub={income.length ? `pro Monat · ${plural(income.length, 'regelmäßiger Eingang', 'regelmäßige Eingänge')}` : 'im geladenen Verlauf'}
          >
            {income.length
              ? <RoundMoney value={totals.monthlyIncome} currency={totals.currency} />
              : null}
          </SummaryFigure>
          <SummaryFigure
            label="Fixkosten pro Jahr"
            prefix={unseen.length ? 'mind.' : 'ca.'}
            sub={unseen.length ? `${unseenPhrase(unseen)} Zahlungen zeigt erst ein längerer Verlauf` : 'hochgerechnet aus dem Rhythmus'}
            wide={!(housing && rest.length > 0)}
          >
            <RoundMoney value={totals.yearlyExpense} currency={totals.currency} />
          </SummaryFigure>
        </dl>
      )}
      {/* "Schätzung" only once there is something estimated. */}
      <div className="px-4 py-3 sm:px-6">
        <p className="tnum text-[13px] leading-relaxed text-ink-3">
          <DotList
            items={[
              live > 0 && !failed.length && 'Schätzung',
              'berechnet auf diesem Rechner aus den geladenen Umsätzen',
              basis.bookings > 0 && 'Umbuchungen und Bargeld ausgenommen',
              otherCurrency > 0 && `${plural(otherCurrency, 'Vertrag', 'Verträge')} in anderer Währung nicht summiert`,
            ]}
          />
        </p>
        <AccountList accounts={model.accounts} />
      </div>
      {shortHistory && <HistoryNotice model={model} className="hidden border-t border-line sm:block" />}
    </section>
  );
}

/** One account in scope failed: the totals are held back, and it says which and why. */
function FailedNotice({ failed }: { failed: AccountBasis[] }) {
  const { busy, refreshAccount, accountLabel } = useFints();
  const names = failed.map((b) => accountLabel(b.account));
  return (
    <div className="border-b border-line px-4 py-4 sm:px-6">
      <Alert
        tone="error"
        className="mt-0"
        title={`${names.join(' und ')} ${failed.length === 1 ? 'konnte' : 'konnten'} nicht abgerufen werden`}
        action={failed.map((b) => (
          <Button key={b.account.accountNumber} size="xs" variant="secondary" disabled={busy} onClick={() => refreshAccount(b.account)}>
            {failed.length === 1 ? 'Erneut versuchen' : `${accountLabel(b.account)} erneut abrufen`}
          </Button>
        ))}
      >
        {failed[0].error} Ohne {failed.length === 1 ? 'dieses Konto' : 'diese Konten'} wären die Summen unvollständig —
        sie erscheinen, sobald die Umsätze da sind.
      </Alert>
    </div>
  );
}

/**
 * Which accounts the detection read, each with its own period — and which it
 * did not, with the way to add them. Fetching another account here does not
 * switch to it: it only adds its bookings.
 */
function AccountList({ accounts }: { accounts: AccountBasis[] }) {
  const { busy, loadTransactions, refreshAccount, accountLabel, activeAccount } = useFints();
  const listed = accounts.filter((b) => b.status !== 'unsupported' || accounts.length > 1);
  if (!listed.length) return null;
  const needsHint = listed.some((b) => b.status === 'missing' || b.status === 'failed');
  return (
    <div className="mt-2">
      <h3 className="text-[13px] font-semibold text-ink-2">Konten</h3>
      <ul className="mt-1">
        {listed.map((b) => {
          const name = accountLabel(b.account);
          const active = b.account.accountNumber === activeAccount?.accountNumber;
          return (
            <li key={b.account.accountNumber} className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-0.5 py-1 text-[13.5px]">
              <span className="min-w-0 font-semibold text-ink">{name}</span>
              <span className="tnum min-w-0 flex-1 text-ink-3">
                {b.status === 'included' && (
                  <>
                    {fmtRange(b.from, b.to)} · {plural(b.bookings ?? 0, 'Umsatz', 'Umsätze')}
                    {(b.span ?? 0) < YEAR_SPAN && ` · ${plural(b.span ?? 0, 'Tag', 'Tage')} Verlauf`}
                  </>
                )}
                {b.status === 'loading' && <span className="inline-flex items-center gap-1.5"><Spinner size={12} /> wird abgerufen …</span>}
                {b.status === 'failed' && 'konnte nicht abgerufen werden'}
                {b.status === 'missing' && 'nicht enthalten'}
                {b.status === 'unsupported' && 'keine Umsätze über FinTS'}
              </span>
              {b.status === 'missing' && (
                <Button size="xs" variant="tertiary" className="-mr-3" disabled={busy} onClick={() => void loadTransactions(b.account)}>
                  Umsätze abrufen<span className="sr-only"> für {name}</span>
                </Button>
              )}
              {b.status === 'failed' && (
                <Button size="xs" variant="tertiary" className="-mr-3" disabled={busy} onClick={() => refreshAccount(b.account)}>
                  Erneut versuchen<span className="sr-only"> für {name}</span>
                </Button>
              )}
              {b.status === 'included' && !active && (b.span ?? 0) < YEAR_SPAN && (
                <Button
                  size="xs"
                  variant="tertiary"
                  className="-mr-3"
                  disabled={busy}
                  onClick={() => {
                    const r = presetRange('365d');
                    void loadTransactions(b.account, r.from, r.to, { force: true });
                  }}
                >
                  12 Monate abrufen<span className="sr-only"> für {name}</span>
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {needsHint && <p className="text-[12.5px] text-ink-3">{MAY_NEED_TAN} Das Konto wird dafür nicht gewechselt.</p>}
    </div>
  );
}

/** Too little history for the slower rhythms — which account, and the one button that fetches more. */
function HistoryNotice({ model, className }: { model: RecurringModel; className?: string }) {
  const { activeAccount, accountLabel } = useFints();
  const short = model.accounts.filter((b) => b.status === 'included' && (b.span ?? 0) < YEAR_SPAN);
  const activeShort = short.some((b) => b.account.accountNumber === activeAccount?.accountNumber);
  if (!short.length) return null;
  const phrase = unseenPhrase(model.unseen);
  return (
    <div className={cx('bg-info-soft px-4 py-3.5 sm:px-6', className)}>
      <p className="text-[14px] leading-snug text-ink">
        {short.map((b) => `${accountLabel(b.account)} reicht ${plural(b.span ?? 0, 'Tag', 'Tage')} zurück`).join(', ')}.
        {phrase ? ` ${phrase} Verträge zeigen sich erst in einem längeren Verlauf.` : ' Für jährliche Verträge 12 Monate abrufen.'}
      </p>
      {activeShort && <LoadHistoryButton className="mt-2.5" />}
    </div>
  );
}

function SummaryFigure({
  label, sub, prefix = 'ca.', wide, children,
}: {
  label: string;
  sub: string;
  /** "ca." for an estimate, "mind." for a sum the history may be short of. */
  prefix?: string;
  /** Spans both columns on a phone (a lone third figure). */
  wide?: boolean;
  /** The figure; null for "none recognised". */
  children: React.ReactNode;
}) {
  return (
    <div className={cx('min-w-0 bg-surface px-4 py-3.5 sm:px-6 sm:py-5', wide && 'col-span-2 desk:col-span-1')}>
      <dt className="text-[13px] leading-snug font-semibold text-ink-2">{label}</dt>
      <dd className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-[19px] leading-tight font-bold text-ink sm:text-[24px]">
        {children ? (
          <>
            <span className="text-[13px] font-normal text-ink-3 sm:text-[14px]">{prefix}</span>
            {children}
          </>
        ) : (
          <span className="text-[16px] font-semibold text-ink-3">Keine erkannt</span>
        )}
      </dd>
      <dd className="mt-1 text-[13px] leading-snug text-ink-3">{sub}</dd>
    </div>
  );
}

function ContractsSkeleton() {
  return (
    <div aria-hidden className="space-y-4 sm:space-y-6">
      <div className="panel grid grid-cols-2 gap-px overflow-hidden bg-line desk:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-surface px-4 py-3.5 sm:px-6 sm:py-5">
            <Skeleton className="h-3 w-28 max-w-full" />
            <Skeleton className="mt-3 h-6 w-32 max-w-full" />
            <Skeleton className="mt-2 h-3 w-24 max-w-full" />
          </div>
        ))}
      </div>
      <div className="panel py-4">
        <Skeleton className="mx-4 h-4 w-40 sm:mx-6" />
        {[60, 48, 54, 40].map((w) => (
          <div key={w} className="flex items-center gap-3 px-4 py-3 sm:px-6">
            <Skeleton circle className="size-10 shrink-0" />
            <div className="flex-1">
              <Skeleton className="h-3" style={{ width: `${w}%` }} />
              <Skeleton className="mt-2 h-3" style={{ width: `${w - 20}%` }} />
            </div>
            <Skeleton className="h-3.5 w-16" />
          </div>
        ))}
      </div>
      <span role="status" className="sr-only">Verträge werden erkannt …</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Demnächst fällig — the overview's sidebar tile
// ---------------------------------------------------------------------------

const UPCOMING_MAX = 5;

/**
 * What the next 30 days are expected to bring on the active account — the
 * account the Monatsbilanz beside it shows — with what that adds up to.
 */
export function UpcomingPayments() {
  const { setTab, activeAccount, accountLabel } = useFints();
  const model = useRecurringModel();
  const acct = activeAccount?.accountNumber ?? null;
  const items = useUpcoming(model, 30, acct);
  const shown = items.slice(0, UPCOMING_MAX);
  const more = items.length - shown.length;
  const any = model.income.length + model.expense.length > 0;
  const own = model.accounts.find((b) => b.account.accountNumber === acct);
  const currency = activeAccount?.currency || 'EUR';
  // What the 30 days add up to, each way, in the account's currency only.
  const sums = useMemo(() => {
    let out = 0;
    let inc = 0;
    for (const { series: s } of items) {
      if (s.currency !== currency) continue;
      if (s.amount < 0) out += Math.round(s.amount * 100);
      else inc += Math.round(s.amount * 100);
    }
    return { out: out / 100, in: inc / 100 };
  }, [items, currency]);
  const name = activeAccount ? accountLabel(activeAccount) : '';

  return (
    <Tile
      // A grid track sizes to its widest unbreakable line unless told otherwise;
      // the truncated names below must be allowed to give way instead.
      className="min-w-0"
      title="Demnächst fällig"
      // On a narrow tile the facts take a line each, rather than leave the
      // dot hanging — "voraussichtlich" stays: these are expectations.
      subtitle={<DotList items={[name, 'nächste 30 Tage', 'voraussichtlich']} />}
      actions={
        // -mr-2.5: the label's text, not the pill's padding, ends on the
        // tile's content edge, like the figures below it.
        <Button variant="tertiary" size="xs" iconRight={<ArrowRightIcon size={15} />} className="-mr-2.5" onClick={() => setTab('contracts')}>
          Alle Verträge
        </Button>
      }
    >
      {model.loading ? (
        <ul aria-hidden className="pb-3">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
              <Skeleton className="h-8 w-11 rounded-[8px]" />
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="h-3 w-14" />
            </li>
          ))}
        </ul>
      ) : shown.length === 0 ? (
        <p className="px-4 pb-4 text-[14px] leading-relaxed text-ink-2 sm:px-5 sm:pb-5">
          {own?.status === 'failed'
            ? `Die Umsätze von ${name} konnten nicht abgerufen werden.`
            : own?.status !== 'included'
              ? `Sobald die Umsätze von ${name || 'diesem Konto'} abgerufen sind, stehen hier die nächsten erwarteten Buchungen.`
              : any
                ? `Für ${name} ist in den nächsten 30 Tagen keine regelmäßige Buchung zu erwarten.`
                : 'In den geladenen Umsätzen sind noch keine regelmäßigen Zahlungen erkannt.'}
        </p>
      ) : (
        <>
          <ul className="pb-1">
            {shown.map(({ series: s, date }) => {
              const n = displayName(s.name) || 'Unbekannt';
              const [wd, dm] = fmtWeekdayShort(date).split(' ');
              const soon = daysUntil(date) <= 1;
              return (
                <li key={s.id} className="flex items-center gap-3 px-4 py-2 sm:px-5">
                  <span
                    className="tnum grid w-14 shrink-0 place-items-center rounded-[8px] bg-inset py-1 leading-tight"
                    aria-hidden
                  >
                    <span className="text-[11.5px] font-semibold text-ink-3">{wd}</span>
                    <span className="text-[13px] font-semibold text-ink">{dm}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-ink">{n}</span>
                    <span className="block truncate text-[12.5px] text-ink-3">
                      <span className="sr-only">am {dm}, </span>
                      {soon ? (daysUntil(date) === 0 ? 'heute · ' : 'morgen · ') : ''}
                      {s.cadenceLabel}
                    </span>
                  </span>
                  <span className="shrink-0 text-[14px] font-semibold">
                    {s.variable ? (
                      <>
                        <span className="mr-1 text-[12.5px] font-normal text-ink-3">ca.</span>
                        <RoundMoney value={s.amount} currency={s.currency} signed className={s.amount > 0 ? 'text-green' : undefined} />
                      </>
                    ) : (
                      <Money value={s.amount} currency={s.currency} signed tone="credit" />
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {more > 0 && (
            <button
              type="button"
              onClick={() => setTab('contracts')}
              className="row-focus flex w-full items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-left text-[13.5px] font-semibold text-accent hover:bg-accent-soft sm:px-5"
            >
              {plural(more, 'weitere Buchung', 'weitere Buchungen')} in 30 Tagen
              <ChevronIcon dir="right" size={15} />
            </button>
          )}
          {/* What the 30 days add up to — every expected booking, not only the five shown. */}
          <dl className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t border-line bg-inset px-4 py-2.5 text-[13px] sm:px-5">
            <dt className="text-ink-2">In 30 Tagen, ca.</dt>
            <dd className="flex items-baseline gap-2.5 font-semibold">
              {sums.out !== 0 && (
                <span>
                  <span className="sr-only">Ausgänge </span>
                  <RoundMoney value={sums.out} currency={currency} className="text-ink" />
                </span>
              )}
              {sums.in !== 0 && (
                <span>
                  <span className="sr-only">Eingänge </span>
                  <RoundMoney value={sums.in} currency={currency} signed className="text-green" />
                </span>
              )}
            </dd>
          </dl>
        </>
      )}
    </Tile>
  );
}
