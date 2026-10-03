'use client';

// "Verträge & Abos" — the payments that come back on a rhythm, recognised in
// the bookings already loaded for every account of this session (salary,
// rent, energy, insurance, subscriptions). And "Demnächst fällig", the short
// list of what the next 30 days are expected to bring, for the overview.
//
// All of it is a guess drawn from history (lib/recurring.ts) and says so:
// amounts are "ca.", dates "voraussichtlich", totals a "Schätzung". The basis
// — which days, how many accounts — is always on screen, and the user can
// overrule the guess ("Kein Vertrag"), which is remembered in the vault.

import { useCallback, useId } from 'react';
import { useFints } from './FintsProvider';
import { ArrowRightIcon, ChevronIcon } from './icons';
import { Money } from './Money';
import { Button, Disclosure, DotList, EmptyState, Skeleton, Tile, cx } from './ui';
import { fmtRange, displayName } from '@/lib/format';
import type { RecurringSeries } from '@/lib/recurring';
import { ContractGroup, ContractRow, DismissedRow } from './insights/ContractRow';
import { useRecurringModel, useUpcoming, type RecurringModel } from './insights/recurring-model';
import { LoadHistoryButton, YEAR_SPAN, daysUntil, fmtWeekdayShort } from './insights/shared';

/** "103 Umsätze" — joined by a no-break space, so a count never wraps away from its noun. */
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('de-DE')}\u00a0${n === 1 ? one : many}`;

function useDismiss() {
  const { dismissRecurring, restoreRecurring, toast } = useFints();
  const dismiss = useCallback((s: RecurringSeries) => {
    dismissRecurring(s.id);
    toast(`„${displayName(s.name)}“ wird nicht mehr als Vertrag geführt.`, 'info', 6500, {
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
  const { vaultStatus } = useFints();
  const { dismiss, restore } = useDismiss();

  if (model.loading) return <ContractsSkeleton />;

  const { basis, income, expense, ended, dismissed, totals } = model;
  const live = income.length + expense.length;
  const shortHistory = !basis || basis.longestSpan < YEAR_SPAN;

  if (!basis) {
    return (
      <section className="panel" aria-label="Verträge und Abos">
        <EmptyState illustration="contracts" title="Noch keine Umsätze geladen">
          Sobald die Umsätze eines Kontos geladen sind, erscheinen hier die regelmäßigen Zahlungen, die darin
          erkannt werden.
        </EmptyState>
      </section>
    );
  }

  return (
    <div className="min-w-0 space-y-4 sm:space-y-6">
      <SummaryTile model={model} shortHistory={shortHistory} />

      {live === 0 && (
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
          title="Regelmäßige Einnahmen"
          subtitle={<>ca. <Money value={totals.monthlyIncome} currency={totals.currency} tone="plain" /> pro Monat</>}
          headerNext="Nächster Eingang"
        >
          {income.map((s) => <ContractRow key={s.id} s={s} onDismiss={dismiss} />)}
        </ContractGroup>
      )}

      {expense.length > 0 && (
        <ContractGroup
          title="Fixkosten & Abos"
          subtitle={<>ca. <Money value={totals.monthlyExpense} currency={totals.currency} tone="plain" /> pro Monat · {plural(expense.length, 'Vertrag', 'Verträge')}</>}
        >
          {expense.map((s) => <ContractRow key={s.id} s={s} onDismiss={dismiss} />)}
        </ContractGroup>
      )}

      {/* On phones the "load a year" notice follows the list instead of
          pushing it below the first screen (see SummaryTile). */}
      {shortHistory && (
        <section className="panel overflow-hidden sm:hidden" aria-label="Längerer Verlauf">
          <HistoryNotice days={basis.longestSpan} />
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
              <ul>{ended.map((s) => <ContractRow key={s.id} s={s} onDismiss={dismiss} />)}</ul>
            </Disclosure>
          )}
          {dismissed.length > 0 && (
            <Disclosure
              title={<span className="text-[15px] font-semibold text-ink">Ausgeblendet ({dismissed.length})</span>}
              trailing={<span className="hidden text-[13px] text-ink-3 sm:inline">Als „Kein Vertrag“ markiert</span>}
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

function SummaryTile({ model, shortHistory }: { model: RecurringModel; shortHistory: boolean }) {
  const { basis, totals, income, expense, otherCurrency } = model;
  const headingId = useId();
  if (!basis) return null;
  return (
    <section className="panel overflow-hidden" aria-labelledby={headingId}>
      {/* Where focus lands when the row that held it goes away (focusAfterRemoval). */}
      <h2 id={headingId} className="sr-only" data-focus-fallback>Zusammenfassung</h2>
      {/* With nothing recognised there is nothing to add up — "ca. 0,00 €"
          would read as a finding. The basis and the notice still show.
          Phones get the two monthly figures side by side and the yearly one as
          a single line under them: three stacked tiles would fill the first
          screen before a single contract is in sight. Three columns only from
          `md`, where "ca. 16.869,02 €" still fits a third of the tile. */}
      {income.length + expense.length > 0 && (
        <dl className="grid grid-cols-2 gap-px border-b border-line bg-line md:grid-cols-3">
          <SummaryFigure
            label="Fixkosten pro Monat"
            labelShort="Fixkosten/Monat"
            sub={`aus ${plural(expense.length, 'Vertrag', 'Verträgen')} und Abos`}
            subShort={plural(expense.length, 'Vertrag', 'Verträge')}
          >
            <Money value={totals.monthlyExpense} currency={totals.currency} tone="plain" />
          </SummaryFigure>
          <SummaryFigure
            label="Einnahmen pro Monat"
            labelShort="Einnahmen/Monat"
            sub={plural(income.length, 'regelmäßiger Eingang', 'regelmäßige Eingänge')}
            subShort={plural(income.length, 'Eingang', 'Eingänge')}
          >
            <Money value={totals.monthlyIncome} currency={totals.currency} tone="plain" />
          </SummaryFigure>
          <SummaryFigure label="Fixkosten pro Jahr" sub="hochgerechnet aus dem Rhythmus" line>
            <Money value={totals.yearlyExpense} currency={totals.currency} tone="plain" />
          </SummaryFigure>
        </dl>
      )}
      {/* "Schätzung" only once there is something estimated. */}
      {/* The range never splits at its dash, and no dot is left hanging at
          a line's end where the facts wrap. */}
      <p className="tnum px-4 py-3 text-[13px] leading-relaxed text-ink-3 sm:px-6">
        <DotList
          items={[
            income.length + expense.length > 0 && 'Schätzung',
            <>
              {income.length + expense.length > 0 ? 'erkannt aus ' : 'Basis: '}
              <span className="whitespace-nowrap">{fmtRange(basis.from, basis.to)}</span>
            </>,
            plural(basis.accounts, 'Konto', 'Konten'),
            plural(basis.bookings, 'Umsatz', 'Umsätze'),
            'Umbuchungen und Bargeld ausgenommen',
            otherCurrency > 0 && `${plural(otherCurrency, 'Vertrag', 'Verträge')} in anderer Währung nicht summiert`,
          ]}
        />
      </p>
      {shortHistory && <HistoryNotice days={basis.longestSpan} className="hidden border-t border-line sm:block" />}
    </section>
  );
}

/** Too little history for the slower rhythms — and the one button that fetches more. */
function HistoryNotice({ days, className }: { days: number; className?: string }) {
  return (
    <div className={cx('bg-info-soft px-4 py-3.5 sm:px-6', className)}>
      <p className="text-[14px] leading-snug text-ink">
        Erkannt aus {plural(days, 'Tag', 'Tagen')} Verlauf. Für vierteljährliche und jährliche Verträge 12 Monate
        laden.
      </p>
      <LoadHistoryButton className="mt-2.5" />
    </div>
  );
}

function SummaryFigure({
  label, labelShort, sub, subShort, line, children,
}: {
  label: string;
  sub: string;
  /** What fits half a phone's width; the full `label` / `sub` from `sm` up. */
  labelShort?: string;
  subShort?: string;
  /** Below `md`: one full-width line, label left and figure right, without the sub. */
  line?: boolean;
  children: React.ReactNode;
}) {
  if (line) {
    return (
      <div className="col-span-2 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 bg-surface px-4 py-3 sm:px-6 md:col-span-1 md:block md:py-5">
        <dt className="text-[13px] leading-snug font-semibold text-ink-2">{label}</dt>
        <dd className="flex items-baseline gap-1.5 text-[17px] leading-tight font-semibold text-ink sm:text-[18px] md:mt-1 md:text-[24px]">
          <span className="text-[13px] font-normal text-ink-3 md:text-[14px]">ca.</span>
          {children}
        </dd>
        <dd className="mt-1 hidden text-[13px] leading-snug text-ink-3 md:block">{sub}</dd>
      </div>
    );
  }
  return (
    <div className="min-w-0 bg-surface px-4 py-3.5 sm:px-6 sm:py-5">
      <dt className="text-[13px] leading-snug font-semibold text-ink-2">
        {labelShort ? (
          <>
            {/* Assistive tech always gets the words, not the slash. */}
            <span aria-hidden className="sm:hidden">{labelShort}</span>
            <span className="sr-only sm:not-sr-only">{label}</span>
          </>
        ) : label}
      </dt>
      <dd className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-[19px] leading-tight font-semibold text-ink sm:text-[24px]">
        <span className="text-[13px] font-normal text-ink-3 sm:text-[14px]">ca.</span>
        {children}
      </dd>
      <dd className="mt-1 text-[13px] leading-snug text-ink-3">
        {subShort ? (
          <>
            <span className="sm:hidden">{subShort}</span>
            <span className="hidden sm:inline">{sub}</span>
          </>
        ) : sub}
      </dd>
    </div>
  );
}

function ContractsSkeleton() {
  return (
    <div aria-hidden className="space-y-4 sm:space-y-6">
      <div className="panel grid grid-cols-2 gap-px overflow-hidden bg-line md:grid-cols-3">
        {[0, 1].map((i) => (
          <div key={i} className="bg-surface px-4 py-3.5 sm:px-6 sm:py-5">
            <Skeleton className="h-3 w-28 max-w-full" />
            <Skeleton className="mt-3 h-6 w-32 max-w-full" />
            <Skeleton className="mt-2 h-3 w-24 max-w-full" />
          </div>
        ))}
        <div className="col-span-2 flex items-center justify-between bg-surface px-4 py-3.5 sm:px-6 md:col-span-1 md:block md:py-5">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-5 w-28 md:mt-3 md:h-6 md:w-32" />
          <div className="hidden md:block"><Skeleton className="mt-2 h-3 w-24" /></div>
        </div>
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

export function UpcomingPayments() {
  const { setTab } = useFints();
  const model = useRecurringModel();
  const items = useUpcoming(model, 30);
  const shown = items.slice(0, UPCOMING_MAX);
  const more = items.length - shown.length;
  const any = model.income.length + model.expense.length > 0;

  return (
    <Tile
      // A grid track sizes to its widest unbreakable line unless told otherwise;
      // the truncated names below must be allowed to give way instead.
      className="min-w-0"
      title="Demnächst fällig"
      // On a narrow tile the two facts take a line each, rather than leave
      // the dot hanging — "voraussichtlich" stays: these are expectations.
      subtitle={<DotList items={['Nächste 30 Tage', 'voraussichtlich']} />}
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
          {!model.basis
            ? 'Sobald Umsätze geladen sind, stehen hier die nächsten erwarteten Buchungen.'
            : any
              ? 'In den nächsten 30 Tagen ist keine regelmäßige Buchung zu erwarten.'
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
                    {s.variable && <span className="mr-1 text-[12.5px] font-normal text-ink-3">ca.</span>}
                    <Money value={s.amount} currency={s.currency} signed tone="credit" />
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
        </>
      )}
    </Tile>
  );
}
