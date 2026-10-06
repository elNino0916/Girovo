'use client';

// The tiles of the Umsatzanalyse. Each takes figures already computed by
// analysis-model.ts and a callback for "show me those bookings"; none of them
// reads the provider for data, so what one tile shows can never disagree with
// the period the toolbar says.

import { useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { CategoryAmount, Counterparty, MonthBucket } from '@/lib/analytics';
import { daysLabel, fmtDaySpan, monthPartNote } from '@/lib/analytics';
import type { CategoryId } from '@/lib/categories';
import { categoryLabel } from '@/lib/categories';
import type { SerializedTransaction } from '@/lib/fints-types';
import { dayKey, displayName, fmtMonth } from '@/lib/format';
import { msgs, type Messages } from '@/lib/i18n';
import { rich, useLocale, useT } from '@/lib/i18n/react';
import {
  BarTrack, CHART_IN, CHART_OUT, ChartLegend, PairedBars, ShareBar, fmtAxisMoney, rankColor, type ShareSegment,
} from '../charts';
import { CalendarIcon, CategoryIcon, ChevronIcon } from '../icons';
import { maskedLabel, Money, useMoneyText, usePrivacy } from '../Money';
import {
  Button, EmptyState, FilterChip, IconButton, Menu, MenuItemRadio, MenuSeparator, Skeleton,
} from '../ui';
import { serviceName, txText } from '../transactions/model';
import { WHOLE_RANGE, type AnalysisMonth, type AnalysisPeriod, type BigExpense } from './analysis-model';
import { CounterpartyAvatar, InsightTile, fmtDayKey } from './shared';

/**
 * "24 %", "<1 %" ("24%", "<1%") — the language's own spacing, and never a
 * "0 %" for something that is there.
 */
export function fmtShare(part: number, whole: number): string {
  const percent = msgs().insights.percent;
  if (!(whole > 0) || !(part > 0)) return percent('0');
  const pct = (part / whole) * 100;
  return pct < 0.5 ? percent('<1') : percent(String(Math.round(pct)));
}

/**
 * Which part of a partial month the figures cover: "bis 03.10." for the
 * running month, "ab 05.07." for the one the range starts in, '' for a
 * whole month.
 */
export const partialNote = (m: MonthBucket): string => monthPartNote(m.from, m.to);

/**
 * "Oktober 2026" — a month's name from its yyyy-mm rather than its `title`:
 * the months are kept in a memo, and the name must follow the language.
 */
const monthTitle = (m: Pick<MonthBucket, 'month'>) => fmtMonth(m.month);

/** "Oktober 2026 · bis 03.10." or the whole range in words. */
export function periodLabel(period: AnalysisPeriod, months: readonly MonthBucket[], range: string): string {
  if (period === WHOLE_RANGE) return range;
  const m = months.find((x) => x.month === period);
  if (!m) return range;
  return m.complete ? monthTitle(m) : daysLabel(m.from, m.to);
}

/** What a month that is not complete lacks: "Unvollständig, 06.07.–31.07." or "Keine Umsätze". */
const incompleteNote = (m: AnalysisMonth, t: Messages) =>
  m.noData ? t.insights.bookings.none : t.insights.month.incompleteLabel(fmtDaySpan(m.from, m.to));

// ---------------------------------------------------------------------------
// Period picker: ‹ [Gesamter Zeitraum ▾] ›
// ---------------------------------------------------------------------------

export function PeriodPicker({
  period, months, rangeText, onChange, disabled,
}: {
  period: AnalysisPeriod;
  months: readonly AnalysisMonth[];
  rangeText: string;
  onChange: (p: AnalysisPeriod) => void;
  disabled?: boolean;
}) {
  const idx = period === WHOLE_RANGE ? -1 : months.findIndex((m) => m.month === period);
  const current = idx >= 0 ? months[idx] : null;
  // From the whole range, "back" lands on the newest complete month — the
  // one people usually want first, rather than a running month of four
  // days; from a month it walks one month at a time.
  const newestComplete = [...months].reverse().find((m) => m.complete) ?? months[months.length - 1];
  const prev = idx === -1 ? newestComplete ?? null : idx > 0 ? months[idx - 1] : null;
  const next = idx >= 0 && idx < months.length - 1 ? months[idx + 1] : null;
  const newestFirst = useMemo(() => [...months].reverse(), [months]);
  const t = useT();
  const words = t.insights.month;

  // Phones: a full-width stepper, the chip between its two arrows, so the
  // row below the account switch reads as one control rather than a stray chip.
  return (
    <div className="flex w-full min-w-0 items-center gap-1 sm:w-auto">
      {/* 40px on a phone, where a thumb has to find it; 32px beside a mouse. */}
      <IconButton
        size="md"
        aria-label={prev ? words.previousNamed(monthTitle(prev)) : words.previous}
        disabled={disabled || !prev}
        onClick={() => prev && onChange(prev.month)}
        className="sm:size-8"
      >
        <ChevronIcon dir="left" size={16} />
      </IconButton>
      <Menu
        label={t.insights.analysis.periodMenu}
        minWidth={260}
        trigger={(p) => (
          <FilterChip {...p} menu disabled={disabled} icon={<CalendarIcon size={16} />} className="min-w-0 grow justify-center sm:grow-0">
            {current ? monthTitle(current) : t.insights.analysis.wholeRange}
            {current && !current.complete && (current.noData || partialNote(current)) && (
              <span className="font-normal text-ink-2"> · {current.noData ? t.insights.bookings.noneInline : partialNote(current)}</span>
            )}
          </FilterChip>
        )}
      >
        <MenuItemRadio checked={period === WHOLE_RANGE} description={rangeText} onSelect={() => onChange(WHOLE_RANGE)}>
          {t.insights.analysis.wholeRange}
        </MenuItemRadio>
        {newestFirst.length > 0 && <MenuSeparator />}
        {newestFirst.map((m) => (
          <MenuItemRadio
            key={m.month}
            checked={period === m.month}
            description={m.complete ? undefined : incompleteNote(m, t)}
            onSelect={() => onChange(m.month)}
          >
            {monthTitle(m)}
          </MenuItemRadio>
        ))}
      </Menu>
      <IconButton
        size="md"
        aria-label={next ? words.nextNamed(monthTitle(next)) : words.next}
        disabled={disabled || !next}
        onClick={() => next && onChange(next.month)}
        className="sm:size-8"
      >
        <ChevronIcon dir="right" size={16} />
      </IconButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI strip — one row of figures, hairlines between them
// ---------------------------------------------------------------------------

export function Kpi({
  label, children, sub,
}: { label: ReactNode; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 bg-surface px-4 py-4 sm:px-6 sm:py-5">
      <dt className="text-[13px] leading-snug font-semibold text-ink-2">{label}</dt>
      <dd className="mt-1 text-[20px] leading-tight font-bold text-ink sm:text-[24px]">{children}</dd>
      {sub && <dd className="mt-1 text-[13px] leading-snug text-ink-3">{sub}</dd>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ausgaben nach Kategorie
// ---------------------------------------------------------------------------

export function CategoryBreakdown({
  rows, total, currency, subtitle, onShow,
}: {
  rows: CategoryAmount[];
  total: number;
  /** The scope's currency — every figure here is a sum in it. */
  currency: string;
  subtitle: ReactNode;
  onShow: (id: CategoryId) => void;
}) {
  const money = useMoneyText();
  const t = useT();
  const max = rows[0]?.amount ?? 0;

  // The share bar folds everything after the sixth category into "Weitere":
  // a seventh hue would be a guess nobody can tell apart.
  const segments = useMemo(() => {
    const head: ShareSegment[] = rows.slice(0, 6).map((r, i) => ({
      key: r.id, label: categoryLabel(r.id), value: r.amount, color: rankColor(i),
      detail: t.insights.count.bookings(r.count),
    }));
    const tail = rows.slice(6);
    if (tail.length) {
      head.push({
        key: 'rest',
        label: t.insights.analysis.categories.rest(tail.length),
        value: tail.reduce((s, r) => s + r.amount, 0),
        color: rankColor(6),
        detail: tail.map((r) => categoryLabel(r.id)).join(', '),
      });
    }
    return head;
  }, [rows, t]);

  return (
    <InsightTile title={t.insights.analysis.categories.title} subtitle={subtitle}>
      {rows.length === 0 ? (
        <EmptyState compact illustration="chart" title={t.insights.analysis.noSpending}>
          {t.insights.analysis.categories.empty}
        </EmptyState>
      ) : (
        <>
          <div className="px-4 pb-2 sm:px-6">
            <ShareBar segments={segments} formatValue={(v) => money(v, currency)} onSelect={(k) => k !== 'rest' && onShow(k as CategoryId)} />
          </div>
          <ul className="pb-2">
            {rows.map((r, i) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onShow(r.id)}
                  className="row-focus group flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-inset sm:gap-3 sm:px-6"
                >
                  {/* Phones give the icon's column to the name, so "Lebensmittel &
                      Drogerie" stays on one line beside its amount down to 360px;
                      the name says what the glyph would. */}
                  <span className="hidden size-9 shrink-0 place-items-center rounded-full bg-inset text-ink-2 transition-colors duration-150 group-hover:bg-surface sm:grid">
                    <CategoryIcon id={r.id} size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2 sm:gap-3">
                      <span className="min-w-0 flex-1 text-[15px] leading-snug font-semibold text-ink">
                        {categoryLabel(r.id)}
                      </span>
                      <Money value={r.amount} currency={currency} tone="plain" className="text-[15px] font-semibold text-ink" />
                    </span>
                    <span className="mt-1.5 flex items-center gap-3">
                      <BarTrack value={r.amount} max={max} color={rankColor(i)} className="flex-1" />
                      {/* One fixed width per breakpoint, so every bar has the same
                          track and their lengths stay comparable. */}
                      <span className="tnum w-11 shrink-0 text-right text-[13px] leading-none whitespace-nowrap text-ink-3 sm:w-[9.5rem]">
                        {fmtShare(r.amount, total)}
                        <span aria-hidden className="hidden sm:inline"> · </span>
                        <span className="sr-only">, </span>
                        <span className="sr-only sm:not-sr-only">{t.insights.count.bookings(r.count)}</span>
                      </span>
                    </span>
                  </span>
                  {/* Says the row leads somewhere, at every width. */}
                  <ChevronIcon dir="right" size={16} className="shrink-0 text-ink-3" />
                  <span className="sr-only">. {t.insights.bookings.show}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </InsightTile>
  );
}

// ---------------------------------------------------------------------------
// Monatsvergleich
// ---------------------------------------------------------------------------

export function MonthlyComparison({
  months, currency, selected, onSelect,
}: {
  months: readonly AnalysisMonth[];
  currency: string;
  selected: AnalysisPeriod;
  onSelect: (p: AnalysisPeriod) => void;
}) {
  const privacy = usePrivacy();
  const money = useMoneyText();
  const tr = useT();
  const { locale } = useLocale();
  const words = tr.insights.analysis.monthly;
  const [table, setTable] = useState(false);
  const tableId = useId();
  const hasPartial = months.some((m) => !m.complete);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- locale is read through fmtAxisMoney
  const axisTick = useMemo(() => fmtAxisMoney(currency), [currency, locale]);

  // Names from each month's yyyy-mm, in the language on screen (the months
  // themselves are kept in a memo).
  const noData = tr.insights.bookings.noneInline;
  const data = useMemo(
    () => months.map((m) => ({
      key: m.month,
      label: tr.insights.monthsShort[+m.month.slice(5, 7) - 1] ?? '',
      title: monthTitle(m),
      values: [m.income, m.expense] as [number, number],
      partial: m.complete ? null : m.noData ? tr.insights.bookings.noneInline : fmtDaySpan(m.from, m.to),
      group: m.month.slice(0, 4),
    })),
    [months, tr],
  );

  const complete = months.filter((m) => m.complete);
  const chart = words.summary(months.length);
  const summary = privacy
    ? `${chart}. ${tr.insights.amountsHidden}.`
    : chart +
      (complete.length
        ? `. ${words.peaks(monthTitle(maxBy(complete, (m) => m.expense)), monthTitle(maxBy(complete, (m) => m.income)))}`
        : '.');

  return (
    <InsightTile
      title={words.title}
      subtitle={words.subtitle}
      actions={
        // An action, not a toggle: its label says what it switches to, so an
        // aria-pressed beside it would announce "Als Diagramm, gedrückt" while
        // the table is the one showing.
        <Button
          variant="tertiary"
          size="xs"
          aria-controls={tableId}
          onClick={() => setTable((t) => !t)}
        >
          {table ? words.asChart : words.asTable}
        </Button>
      }
    >
      <div id={tableId} className="px-4 pb-4 sm:px-6 sm:pb-5">
        {table ? (
          <MonthTable months={months} currency={currency} />
        ) : (
          <>
            <ChartLegend
              className="mb-3"
              items={[
                { key: 'in', label: tr.insights.income, color: CHART_IN },
                { key: 'out', label: tr.common.booking.spending, color: CHART_OUT },
                ...(hasPartial ? [{ key: 'partial', label: words.partial, color: CHART_OUT, ghost: true }] : []),
              ]}
            />
            <PairedBars
              data={data}
              series={[{ label: tr.insights.income, color: CHART_IN }, { label: tr.common.booking.spending, color: CHART_OUT }]}
              height={196}
              formatValue={(v) => money(v, currency)}
              formatTick={privacy ? null : axisTick}
              selectedKey={selected === WHOLE_RANGE ? null : selected}
              onSelect={(k) => onSelect(k === selected ? WHOLE_RANGE : k)}
              ariaLabel={summary}
              // The bar is a toggle button (aria-pressed says whether it is
              // chosen); the name says only what it shows.
              describe={(d) =>
                `${d.title}${d.partial === noData ? ` (${noData})` : d.partial ? ` (${tr.insights.month.incomplete(d.partial)})` : ''}: ` +
                (privacy
                  ? maskedLabel()
                  : words.values(money(d.values[0], currency), money(d.values[1], currency)))}
              footer={(d) => {
                const net = d.values[0] - d.values[1];
                return (
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-ink-3">{tr.common.booking.difference}</span>
                    <span className="amount font-semibold text-ink">{money(net, currency, { signed: true })}</span>
                  </span>
                );
              }}
            />
            <p className="mt-2 text-[13px] text-ink-3">
              {words.hint}
            </p>
          </>
        )}
      </div>
    </InsightTile>
  );
}

function maxBy<T>(xs: T[], f: (x: T) => number): T {
  return xs.reduce((a, b) => (f(b) > f(a) ? b : a));
}

function MonthTable({ months, currency }: { months: readonly AnalysisMonth[]; currency: string }) {
  const t = useT();
  const words = t.insights.analysis.monthly;
  return (
    <div className="-mx-4 overflow-x-auto sm:-mx-6">
      <table className="w-full min-w-[420px] border-collapse text-[14px]">
        <caption className="sr-only">{words.caption}</caption>
        <thead>
          <tr className="border-b border-line text-left text-[13px] text-ink-3">
            <th scope="col" className="px-4 py-2 font-semibold sm:px-6">{words.month}</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">{t.insights.income}</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">{t.common.booking.spending}</th>
            <th scope="col" className="px-4 py-2 text-right font-semibold sm:px-6">{t.common.booking.difference}</th>
          </tr>
        </thead>
        <tbody>
          {[...months].reverse().map((m) => (
            <tr key={m.month} className="border-b border-line last:border-b-0">
              <th scope="row" className="px-4 py-2.5 text-left font-semibold text-ink sm:px-6">
                {monthTitle(m)}
                {!m.complete && (
                  <span className="block text-[12.5px] font-normal text-ink-3">
                    {m.noData ? t.insights.bookings.noneInline : t.insights.month.incomplete(fmtDaySpan(m.from, m.to))}
                  </span>
                )}
              </th>
              <td className="px-3 py-2.5 text-right"><Money value={m.income} currency={currency} tone="plain" /></td>
              <td className="px-3 py-2.5 text-right"><Money value={m.expense} currency={currency} tone="plain" /></td>
              <td className="px-4 py-2.5 text-right sm:px-6"><Money value={m.net} currency={currency} signed tone="plain" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-Empfänger and Größte Ausgaben
// ---------------------------------------------------------------------------

function ListRow({
  avatar, title, sub, amount, onClick, label,
}: {
  avatar: ReactNode;
  title: ReactNode;
  sub: ReactNode;
  amount: ReactNode;
  onClick: () => void;
  /** What the click does, for assistive tech. */
  label: string;
}) {
  // Name and amount share the first line; the second line gets the full
  // width under both, so a phone keeps the facts and only loses the tail of
  // a long company name.
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="row-focus flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-inset sm:px-6"
      >
        {avatar}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-3">
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">{title}</span>
            <span className="shrink-0 text-right text-[15px] font-semibold text-ink">{amount}</span>
          </span>
          <span className="block truncate text-[13px] text-ink-3">{sub}</span>
        </span>
        {/* Every one of these rows opens the Umsätze list: it says so. */}
        <ChevronIcon dir="right" size={16} className="shrink-0 text-ink-3" />
        <span className="sr-only">. {label}</span>
      </button>
    </li>
  );
}

export function TopPayees({
  payees, expense, currency, subtitle, categoryName, onShow,
}: {
  /** From topCounterparties(): refunds netted, on the basis of `expense`. */
  payees: Counterparty[];
  expense: number;
  currency: string;
  subtitle: ReactNode;
  categoryName: (tx: SerializedTransaction) => string;
  onShow: (p: Counterparty) => void;
}) {
  const t = useT();
  const words = t.insights.analysis.payees;
  return (
    <InsightTile title={words.title} subtitle={subtitle}>
      {payees.length === 0 ? (
        <EmptyState compact illustration="transactions" title={t.insights.analysis.noSpending}>
          {words.empty}
        </EmptyState>
      ) : (
        <ol className="pb-2">
          {payees.map((p) => {
            const name = displayName(p.name) || t.insights.noName;
            return (
              <ListRow
                key={p.key}
                avatar={
                  p.cash ? (
                    // Cash has no payee to show a face for — its category's glyph.
                    <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full border border-line bg-inset text-ink-2">
                      <CategoryIcon id="cash" size={18} />
                    </span>
                  ) : <CounterpartyAvatar tx={p.sample} name={name} />
                }
                title={name}
                sub={
                  <>
                    {p.cash ? t.insights.count.withdrawals(p.count) : t.insights.count.bookings(p.count)}
                    {/* Netting per payee can still leave one above the whole
                        (a refund booked under another name) — no share then,
                        rather than "112 % der Ausgaben". */}
                    {Math.round(p.amount * 100) <= Math.round(expense * 100) && <> · {words.share(fmtShare(p.amount, expense))}</>}
                    {p.via
                      ? <span className="hidden sm:inline"> · {words.via(serviceName(p.via))}</span>
                      : !p.cash && <span className="hidden sm:inline"> · {categoryName(p.sample)}</span>}
                  </>
                }
                amount={<Money value={p.amount} currency={currency} tone="plain" />}
                onClick={() => onShow(p)}
                label={p.cash ? words.showCash : words.showAll(name)}
              />
            );
          })}
        </ol>
      )}
    </InsightTile>
  );
}

export function LargestExpenses({
  items, subtitle, categoryName, onShow,
}: {
  items: BigExpense[];
  subtitle: ReactNode;
  categoryName: (tx: SerializedTransaction) => string;
  onShow: (tx: SerializedTransaction) => void;
}) {
  const t = useT();
  const words = t.insights.analysis.largest;
  return (
    <InsightTile title={words.title} subtitle={subtitle}>
      {items.length === 0 ? (
        <EmptyState compact illustration="transactions" title={words.emptyTitle}>
          {words.empty}
        </EmptyState>
      ) : (
        <ol className="pb-2">
          {items.map(({ tx, repeats }, i) => {
            // The name the Umsätze list shows — the shop behind PayPal included.
            const name = txText(tx).name || t.insights.noName;
            const day = fmtDayKey(dayKey(tx.entryDate || tx.valueDate));
            return (
              <ListRow
                key={`${dayKey(tx.entryDate)}|${tx.amount}|${i}`}
                avatar={<CounterpartyAvatar tx={tx} name={name} />}
                title={name}
                sub={
                  repeats > 1 ? (
                    <>
                      {/* Phones keep the count and the date and leave the
                          words around them — and the category, as the
                          Top-Empfänger rows do — to the wider screens. */}
                      {rich(words.repeats(repeats, (s) => <span className="hidden sm:inline">{s}</span>, day))}
                      <span className="hidden sm:inline"> · {categoryName(tx)}</span>
                    </>
                  ) : `${day} · ${categoryName(tx)}`
                }
                amount={
                  <>
                    <span className="sr-only">{t.common.booking.debit} </span>
                    <Money value={tx.amount} currency={tx.currency || 'EUR'} signed tone="credit" />
                  </>
                }
                onClick={() => onShow(tx)}
                label={repeats > 1 ? words.showThese : words.showOne}
              />
            );
          })}
        </ol>
      )}
    </InsightTile>
  );
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export function AnalysisSkeleton() {
  return (
    <div aria-hidden className="space-y-4 sm:space-y-6">
      <div className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 pt-4 sm:px-6 sm:pt-5">
          <Skeleton className="h-9 w-56 rounded-full" />
          <Skeleton className="h-9 w-44 rounded-[8px]" />
        </div>
        <Skeleton className="mx-4 mt-3 h-3 w-72 sm:mx-6" />
        <div className="mt-4 grid grid-cols-2 gap-px border-t border-line bg-line desk:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-surface px-4 py-4 sm:px-6 sm:py-5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-3 h-6 w-28" />
              <Skeleton className="mt-2 h-3 w-24" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-4 sm:gap-6 desk:grid-cols-2">
        {[0, 1].map((k) => (
          <div key={k} className="panel px-4 py-5 sm:px-6">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="mt-5 h-3 w-full rounded-[6px]" />
            {[70, 52, 40, 28, 18].map((w) => (
              <div key={w} className="mt-5 flex items-center gap-3">
                <Skeleton circle className="size-9 shrink-0" />
                <div className="flex-1">
                  <Skeleton className="h-3" style={{ width: `${w + 20}%` }} />
                  <Skeleton className="mt-2 h-2" style={{ width: `${w}%` }} />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

