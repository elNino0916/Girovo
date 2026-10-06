'use client';

// Hand-rolled charts for the analysis views. No chart library: what is drawn
// here is a handful of bars, and a library would bring its own colours,
// fonts, tooltips and focus behaviour that all have to be argued back into
// the app's language. These follow the house rules instead:
//
// - Marks are thin and quiet. Bars are at most 24px thick, grow from one
//   baseline, carry a 4px rounded end where the value is and stay square at
//   the base; neighbours are kept apart by a 2px gap, never by an outline.
//   Grid lines are solid hairlines one step off the tile.
// - Colour is a token, never a literal: --chart-1 … --chart-6 by rank, then
//   --chart-rest; --chart-in / --chart-out for money in and out. Text never
//   wears a series colour — a short key stroke beside it carries identity.
// - Every figure goes through a formatter the caller hands in, which is how
//   "Beträge ausblenden" reaches axis labels and tooltips. Pass `formatTick`
//   as null and the axis drops its labels instead of printing dots.
// - A tooltip only ever repeats what is reachable without it (direct labels,
//   the bars' accessible names, a table view the caller offers). It shows on
//   keyboard focus exactly as on hover.
//
// Everything is sized from the container (ResizeObserver), so a chart is
// crisp at any width — the phone, the 900px desktop window, a wide screen —
// without a viewBox stretching strokes and text.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { intlLocale, type Messages } from '@/lib/i18n';
import { useT } from '@/lib/i18n/react';
import { currencyMark } from './Money';
import { cx } from './ui';

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/** Categorical slots in their validated order (see the chart tokens in globals.css). */
export const CHART_SLOTS = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)',
] as const;
export const CHART_REST = 'var(--chart-rest)';
export const CHART_IN = 'var(--chart-in)';
export const CHART_OUT = 'var(--chart-out)';

/**
 * The colour of the `rank`-th entry (0-based) of a ranked breakdown: the six
 * slots in order, then the neutral grey for everything after — a seventh
 * category is "Weitere", never a generated hue.
 */
export const rankColor = (rank: number): string => CHART_SLOTS[rank] ?? CHART_REST;

// ---------------------------------------------------------------------------
// Measuring
// ---------------------------------------------------------------------------

/** The content width of an element, kept current. 0 until it has been measured. */
export function useElementWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [node, setNode] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!node) return;
    const measure = () => setWidth(Math.floor(node.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [node]);
  return [setNode, width];
}

/**
 * Clean axis steps for a value range from 0 to `max`: 1, 2, 2.5 or 5 times a
 * power of ten, so ticks read 0 / 500 / 1.000 / 1.500 rather than 0 / 437 / 874.
 */
export function niceTicks(max: number, target = 4): { ticks: number[]; top: number } {
  if (!(max > 0) || !Number.isFinite(max)) return { ticks: [0], top: 1 };
  const raw = max / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  const top = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return { ticks, top };
}

/**
 * A money axis tick in the chart's currency: "1.500 €", "1.500 $" ("€1,500",
 * "$1,500") — the currency where the language speaking now puts it. Whole
 * units — the axis gives scale, the tooltip gives cents. Made per call, so a
 * caller that keeps it keys it on the language too.
 */
export const fmtAxisMoney = (currency = 'EUR') => {
  try {
    const money = new Intl.NumberFormat(intlLocale(), {
      style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0,
    });
    return (v: number) => money.format(v);
  } catch {
    // A currency Intl does not know: the figure, then the code.
    const figure = new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 0 });
    const mark = currencyMark(currency);
    return (v: number) => `${figure.format(v)} ${mark}`;
  }
};

/** A path for a bar with rounded data-end corners and a square base, growing up from `base`. */
function columnPath(x: number, top: number, w: number, base: number, r = 4): string {
  const h = base - top;
  if (h <= 0 || w <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return (
    `M${x},${base}V${top + rr}` +
    `A${rr},${rr} 0 0 1 ${x + rr},${top}` +
    `H${x + w - rr}` +
    `A${rr},${rr} 0 0 1 ${x + w},${top + rr}` +
    `V${base}Z`
  );
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

export type TooltipRow = { key: string; color?: string; label: ReactNode; value: ReactNode; ghost?: boolean };

/**
 * Where a readout goes, decided once its real size is known (a title like
 * "September 2025 · nur 01.09.–30.09." is wider than any fixed guess).
 */
export type TipPlace = {
  /** The edge of the mark the readout belongs to (or its centre), in container px. */
  x: number;
  /** The container's width; the readout never leaves it. */
  width: number;
  /**
   * Beside the mark, preferably after or before it; centred on it where CSS
   * puts the box ('center'); or centred above the container ('above').
   */
  side: 'after' | 'before' | 'center' | 'above';
  /** Space between mark and readout. */
  gap?: number;
  /** Top when beside the mark. Left alone (CSS decides) when not given. */
  y?: number;
};

/**
 * The floating readout. Values lead and labels follow — the reader already
 * knows which series they pointed at and wants the number. A short stroke of
 * the series colour keys each row; text stays in ink.
 *
 * With `place` it positions itself: on the preferred side of the mark, else
 * the other side, and when neither has room (a month in the middle of a
 * phone-wide chart) above the chart, centred on the mark — never on top of
 * the bars it is describing.
 */
export function ChartTooltip({
  title, rows, footer, style, className, place,
}: {
  title: ReactNode;
  rows: TooltipRow[];
  footer?: ReactNode;
  style?: CSSProperties;
  className?: string;
  place?: TipPlace;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Every render: the content and the anchor change together, and measuring
  // one small box is cheap. Runs before paint, so it never shows misplaced.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !place) return;
    const { x, width, side, gap = 10, y } = place;
    // Measured from the left edge: an absolute box shrinks to the room left
    // of wherever the previous render put it.
    el.style.left = '0px';
    el.style.maxWidth = `${width}px`;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const after = x + gap + w <= width ? x + gap : null;
    const before = x - gap - w >= 0 ? x - gap - w : null;
    let left: number;
    let top = y;
    if (side === 'center') left = x - w / 2;
    else if (side === 'above') {
      left = x - w / 2;
      top = -(h + 8);
    } else if (side === 'after' && after != null) left = after;
    else if (before != null) left = before;
    else if (after != null) left = after;
    else {
      left = x - w / 2;
      top = -(h + 8);
    }
    el.style.left = `${Math.round(Math.max(0, Math.min(left, width - w)))}px`;
    if (top != null) el.style.top = `${Math.round(top)}px`;
  });
  return (
    <div
      ref={ref}
      aria-hidden
      style={style}
      className={cx(
        'anim-fade pointer-events-none absolute z-10 min-w-[168px] rounded-[var(--radius-card)] bg-raised px-3 py-2.5 text-[13px] leading-snug text-ink shadow-[var(--shadow-pop)]',
        className,
      )}
    >
      <div className="mb-1.5 text-[12.5px] font-semibold text-ink-2">{title}</div>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-2">
            {r.color && (
              <span
                className="h-[3px] w-3 shrink-0 rounded-full"
                style={{ background: r.color, opacity: r.ghost ? 0.45 : 1 }}
              />
            )}
            <span className="amount font-semibold text-ink">{r.value}</span>
            <span className="text-ink-3">{r.label}</span>
          </div>
        ))}
      </div>
      {footer && <div className="mt-1.5 border-t border-line pt-1.5 text-ink-2">{footer}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

/** Mirrors the mark: a small rounded rect for bars. `ghost` is the outlined, partial-month swatch. */
export function ChartLegend({
  items, className,
}: { items: { key: string; label: ReactNode; color: string; ghost?: boolean }[]; className?: string }) {
  return (
    <ul className={cx('flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-2', className)}>
      {items.map((it) => (
        <li key={it.key} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block size-2.5 shrink-0 rounded-[3px]"
            style={
              it.ghost
                ? { boxShadow: `inset 0 0 0 1.5px ${it.color}`, background: `color-mix(in srgb, ${it.color} 22%, transparent)` }
                : { background: it.color }
            }
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// PairedBars — two series side by side per group (Einnahmen vs Ausgaben per month)
// ---------------------------------------------------------------------------

export type PairedDatum = {
  key: string;
  /** Short, for the axis: "Okt". */
  label: string;
  /** Long, for the tooltip and the accessible name: "Oktober 2026". */
  title: string;
  values: [number, number];
  /**
   * Set for a group whose figures cover only part of its period — the days
   * they do cover, "05.07.–31.07.".
   * Drawn as an outlined ghost so it is never compared as if it were whole.
   */
  partial?: string | null;
  /**
   * What the short label leaves out, e.g. the year of "Sep". When the data
   * spans more than one group, the axis names it under the first label of
   * each — otherwise a 13-month range would read "Sep … Sep".
   */
  group?: string;
};

export type PairedSeries = { label: string; color: string };

export function PairedBars({
  data, series, height = 200, formatValue, formatTick, selectedKey, onSelect, footer, ariaLabel, describe, className,
}: {
  data: PairedDatum[];
  series: [PairedSeries, PairedSeries];
  /** Height of the plot area; the x-axis band comes on top of it. */
  height?: number;
  /** For tooltips and accessible names — must honour "Beträge ausblenden". */
  formatValue: (v: number) => string;
  /** Y-axis labels; null hides them (privacy) while the grid stays. */
  formatTick: ((v: number) => string) | null;
  /** The emphasised group; the others recede. */
  selectedKey?: string | null;
  /** Makes every group a button. */
  onSelect?: (key: string) => void;
  /** An extra line under the tooltip rows (e.g. the difference). */
  footer?: (d: PairedDatum) => ReactNode;
  /** The chart's summary for assistive tech. */
  ariaLabel: string;
  /** Accessible name of one group (defaults to title + both values). */
  describe?: (d: PairedDatum) => string;
  className?: string;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const tr = useT();
  const [hover, setHover] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [cursor, setCursor] = useState(() => Math.max(0, data.length - 1));
  const hitRefs = useRef<Array<SVGRectElement | null>>([]);

  useEffect(() => {
    if (cursor > data.length - 1) setCursor(Math.max(0, data.length - 1));
  }, [data.length, cursor]);

  const max = useMemo(() => Math.max(0, ...data.flatMap((d) => d.values)), [data]);
  const { ticks, top } = useMemo(() => niceTicks(max), [max]);

  // Left margin from the widest tick label (12px UI face ≈ 6.6px per glyph),
  // so a "12.500 €" axis never collides with its first bar.
  const labelW = formatTick ? Math.max(...ticks.map((t) => formatTick(t).length)) * 6.6 + 10 : 0;
  // A second axis line for the groups (years) when there is more than one.
  const grouped = new Set(data.map((d) => d.group ?? '')).size > 1;
  const AXIS_BAND = grouped ? 42 : 26;
  const TOP_PAD = 8;
  const plotX = Math.ceil(labelW);
  const plotW = Math.max(0, width - plotX);
  const base = TOP_PAD + height;
  const y = (v: number) => base - (v / top) * height;
  const n = data.length || 1;
  const band = plotW / n;
  const GAP = 2;
  const barW = Math.max(3, Math.min(24, (band * 0.68 - GAP) / 2));
  const pairW = barW * 2 + GAP;
  // Every other label when the bands get narrower than a month name, always
  // keeping the newest.
  const labelEvery = band < 30 ? 2 : 1;
  const labelled = (i: number) => i % labelEvery === (data.length - 1) % labelEvery;
  // The group goes under the first labelled datum of each, so a skipped
  // January never takes its year with it.
  const groupAt: Array<string | null> = [];
  let lastGroup: string | undefined;
  data.forEach((d, i) => {
    groupAt[i] = null;
    if (!grouped || !labelled(i)) return;
    if (d.group !== lastGroup) groupAt[i] = d.group ?? null;
    lastGroup = d.group;
  });

  const active = hover ?? focus;
  const activeDatum = active != null ? data[active] : null;

  const moveFocus = useCallback((i: number) => {
    setCursor(i);
    hitRefs.current[i]?.focus();
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent<SVGRectElement>, i: number) => {
    const last = data.length - 1;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = Math.min(last, i + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(0, i - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else if ((e.key === 'Enter' || e.key === ' ') && onSelect) {
      e.preventDefault();
      onSelect(data[i].key);
      return;
    }
    if (next != null) {
      e.preventDefault();
      moveFocus(next);
    }
  };

  const name = (d: PairedDatum) =>
    describe?.(d) ??
    `${d.title}${d.partial ? ` (${tr.insights.month.incomplete(d.partial)})` : ''}: ${series[0].label} ${formatValue(d.values[0])}, ${series[1].label} ${formatValue(d.values[1])}`;

  // The tooltip sits beside the hovered pair, on the side with more room, at
  // the top of the plot — never on top of the bars it is describing (see
  // ChartTooltip for where it goes when neither side has room). A phone-wide
  // chart has no "beside" that doesn't bury half the other months, so there
  // it goes above the plot, over the legend it repeats anyway.
  let tipPlace: TipPlace | undefined;
  if (active != null && width) {
    const cx0 = plotX + band * active + band / 2;
    const after = cx0 < width / 2;
    tipPlace = width < 480
      ? { x: cx0, width, side: 'above' }
      : { x: after ? cx0 + pairW / 2 : cx0 - pairW / 2, width, side: after ? 'after' : 'before', gap: 10, y: 0 };
  }

  return (
    <div className={cx('relative', className)}>
      <div ref={ref} className="relative w-full" style={{ height: base + AXIS_BAND }}>
        {width > 0 && (
          <svg
            width={width}
            height={base + AXIS_BAND}
            role="group"
            aria-label={ariaLabel}
            className="block overflow-visible"
            onPointerLeave={() => setHover(null)}
          >
            {/* Grid and axis labels */}
            <g aria-hidden>
              {ticks.map((t) => (
                <g key={t}>
                  <line
                    x1={plotX}
                    x2={width}
                    y1={Math.round(y(t)) + 0.5}
                    y2={Math.round(y(t)) + 0.5}
                    stroke={t === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'}
                    strokeWidth={1}
                    shapeRendering="crispEdges"
                  />
                  {formatTick && (
                    <text
                      x={plotX - 10}
                      y={y(t)}
                      dy="0.35em"
                      textAnchor="end"
                      className="tnum"
                      style={{ fontSize: 12, fill: 'var(--ink-3)' }}
                    >
                      {formatTick(t)}
                    </text>
                  )}
                </g>
              ))}
            </g>

            {/* Bars */}
            <g aria-hidden>
              {data.map((d, i) => {
                const x0 = plotX + band * i + (band - pairW) / 2;
                // What the reader points at wins over the selection, so moving
                // through the months never leaves the one in focus greyed out.
                const dim = active != null ? active !== i : !!selectedKey && selectedKey !== d.key;
                return (
                  <g
                    key={d.key}
                    style={{ opacity: dim ? 0.38 : 1, transition: 'opacity 150ms ease-out' }}
                  >
                    {d.values.map((v, s) => {
                      const path = columnPath(x0 + s * (barW + GAP), y(v), barW, base);
                      if (!path) return null;
                      const color = series[s].color;
                      return d.partial ? (
                        <path
                          key={s}
                          d={path}
                          fill={`color-mix(in srgb, ${color} 22%, transparent)`}
                          stroke={color}
                          strokeWidth={1.5}
                          strokeLinejoin="round"
                        />
                      ) : (
                        <path key={s} d={path} fill={color} />
                      );
                    })}
                  </g>
                );
              })}
            </g>

            {/* X labels */}
            <g aria-hidden>
              {data.map((d, i) =>
                labelled(i) ? (
                  <g key={d.key}>
                    <text
                      x={plotX + band * i + band / 2}
                      y={base + 18}
                      textAnchor="middle"
                      style={{
                        fontSize: 12,
                        fill: selectedKey === d.key ? 'var(--ink)' : 'var(--ink-3)',
                        fontWeight: selectedKey === d.key ? 600 : 400,
                      }}
                    >
                      {d.label}
                    </text>
                    {groupAt[i] && (
                      <text
                        x={plotX + band * i + band / 2}
                        y={base + 34}
                        textAnchor="middle"
                        className="tnum"
                        style={{ fontSize: 11.5, fill: 'var(--ink-3)' }}
                      >
                        {groupAt[i]}
                      </text>
                    )}
                  </g>
                ) : null,
              )}
            </g>

            {/* Focus ring for the keyboard-selected group */}
            {focus != null && (
              <rect
                aria-hidden
                x={plotX + band * focus + 1}
                y={1}
                width={Math.max(0, band - 2)}
                height={base + AXIS_BAND - 2}
                rx={8}
                fill="none"
                stroke="var(--focus)"
                strokeWidth={2}
              />
            )}

            {/* Hit areas: the whole band, taller than the bars, so the pointer
                only has to be over the month, not on a 12px bar. */}
            <g>
              {data.map((d, i) => (
                <rect
                  key={d.key}
                  ref={(el) => { hitRefs.current[i] = el; }}
                  x={plotX + band * i}
                  y={0}
                  width={band}
                  height={base + AXIS_BAND}
                  fill="transparent"
                  role={onSelect ? 'button' : 'img'}
                  aria-label={name(d)}
                  aria-pressed={onSelect ? selectedKey === d.key : undefined}
                  tabIndex={i === cursor ? 0 : -1}
                  style={{ outline: 'none', cursor: onSelect ? 'pointer' : 'default' }}
                  onPointerEnter={() => setHover(i)}
                  onFocus={(e) => {
                    setCursor(i);
                    // A click focuses the bar too; only keyboard focus draws the ring
                    // (the pointer already has the hover readout).
                    if (e.currentTarget.matches(':focus-visible')) setFocus(i);
                  }}
                  onBlur={() => setFocus((f) => (f === i ? null : f))}
                  onClick={onSelect ? () => onSelect(d.key) : undefined}
                  onKeyDown={(e) => onKeyDown(e, i)}
                />
              ))}
            </g>
          </svg>
        )}
      </div>

      {activeDatum && tipPlace && (
        <ChartTooltip
          place={tipPlace}
          title={
            <>
              {activeDatum.title}
              {activeDatum.partial && <span className="font-normal text-ink-3"> · {tr.insights.month.only(activeDatum.partial)}</span>}
            </>
          }
          rows={series.map((s, k) => ({
            key: s.label,
            color: s.color,
            ghost: !!activeDatum.partial,
            label: s.label,
            value: formatValue(activeDatum.values[k]),
          }))}
          footer={footer?.(activeDatum)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ShareBar — one 100 % bar, part-to-whole
// ---------------------------------------------------------------------------

/** "24 %", "<1 %" ("24%", "<1%") — never "0 %" for a part that is there. */
const shareText = (part: number, whole: number, t: Messages) => {
  const pct = whole > 0 ? (part / whole) * 100 : 0;
  return t.insights.percent(pct > 0 && pct < 0.5 ? '<1' : String(Math.round(pct)));
};

export type ShareSegment = { key: string; label: string; value: number; color: string; detail?: string };

/**
 * The whole split into its parts, largest first, with a 2px surface gap
 * between neighbours. Decorative for assistive tech — the caller lists the
 * same parts with their figures right beside it; the hover readout is a
 * convenience for the pointer.
 */
export function ShareBar({
  segments, formatValue, className, onSelect,
}: {
  segments: ShareSegment[];
  formatValue: (v: number) => string;
  className?: string;
  onSelect?: (key: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const t = useT();
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (!(total > 0)) return null;

  // Where the hovered segment's centre is, for the readout.
  let acc = 0;
  let tip: { seg: ShareSegment; center: number } | null = null;
  for (const seg of segments) {
    const w = Math.max(0, seg.value) / total;
    if (seg.key === hover) tip = { seg, center: (acc + w / 2) * width };
    acc += w;
  }

  return (
    <div className={cx('relative', className)}>
      <div
        ref={ref}
        aria-hidden
        className="flex h-3 w-full gap-[2px] overflow-hidden rounded-[6px]"
        onPointerLeave={() => setHover(null)}
      >
        {segments.map((seg) => (
          <span
            key={seg.key}
            onPointerEnter={() => setHover(seg.key)}
            onClick={onSelect ? () => onSelect(seg.key) : undefined}
            className={cx('block h-full min-w-[3px] transition-opacity duration-150', onSelect && 'cursor-pointer')}
            style={{
              flex: `${Math.max(0, seg.value)} 1 0px`,
              background: seg.color,
              opacity: hover && hover !== seg.key ? 0.4 : 1,
            }}
          />
        ))}
      </div>
      {tip && width > 0 && (
        <ChartTooltip
          className="top-full mt-2"
          place={{ x: tip.center, width, side: 'center' }}
          title={tip.seg.label}
          rows={[
            {
              key: 'v',
              color: tip.seg.color,
              value: formatValue(tip.seg.value),
              label: shareText(tip.seg.value, total, t),
            },
          ]}
          footer={tip.seg.detail}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BarTrack — one horizontal bar inside a list row
// ---------------------------------------------------------------------------

/**
 * A single bar in a ranked list, its length relative to the list's largest
 * value. Grows from the left; the rounded end is where the value is.
 * Decorative: the row it sits in states the figure in words.
 *
 * The bar is always the track's full width and slides in from the left
 * behind the track's clip, so a change of value moves it on the compositor
 * (a transform, no layout) and the rounded end keeps its shape — a scaleX
 * would squash it.
 */
export function BarTrack({
  value, max, color, className, thickness = 8,
}: { value: number; max: number; color: string; className?: string; thickness?: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) * 100 : 0;
  const end = Math.min(4, thickness / 2);
  return (
    <span aria-hidden className={cx('relative block min-w-0 overflow-hidden', className)} style={{ height: thickness }}>
      <span
        className="absolute inset-0 block transition-transform duration-200 ease-[var(--ease-out-soft)] motion-reduce:transition-none"
        style={{
          // Never shorter than its rounded end, so a tiny share still shows.
          transform: `translateX(calc(max(${pct}%, ${thickness / 2}px) - 100%))`,
          background: color,
          borderRadius: `0 ${end}px ${end}px 0`,
        }}
      />
    </span>
  );
}
