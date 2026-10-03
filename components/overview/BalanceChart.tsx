'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, RefObject } from 'react';
import type { BalancePoint } from '@/lib/balance-history';
import { fmtDate, toLocalDate } from '@/lib/format';
import { MASKED_LABEL, usePrivacy, useMoneyText } from '../Money';
import { cx } from '../ui';

// The Kontoverlauf, drawn by hand rather than through a chart library: one
// line, one flat area, a zero line, two guides — the whole picture fits in a
// screenful of SVG, and every pixel of it is decided here instead of being a
// library default that has to be argued with.
//
// The line is a staircase, not a slope. Each point is a day's closing
// balance, and that balance simply holds until the next Buchungstag moves it:
// every day gets its own slot of the width at its own level, and a booking
// shows as a vertical step at the start of the day it was booked. Joining
// the points with straight lines would invent a gradual decline between a
// Monday and a Friday that never happened, and turn a salary that arrived and
// was transferred away the next day into a pointed "spike" between three
// days that does not show how long the money was actually there.
//
// The area always grows from zero, never from the lowest balance: an area
// that starts at an arbitrary floor turns a 3 % dip into a cliff. The part of
// the line below zero is drawn in red and its area tinted red-soft — red is
// the colour of a negative balance everywhere in this app, and nowhere else.
// Both follow the steps exactly: they are cut at the zero line, not drawn as
// separate shapes.

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

/** Room for the max label above the plot and the month labels under it. */
const PAD_TOP = 26;
const PAD_BOTTOM = 26;
/** Half a dot, so the dot at the end of the line is not cut by the edge. */
const PAD_X = 4;

const dateOf = (key: string) => fmtDate(toLocalDate(key));
const shortDate = (key: string) => {
  const d = toLocalDate(key);
  return d ? `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.` : '';
};

/** Width of the element, kept current. 0 until measured (and on the server). */
function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w != null) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export function BalanceChart({
  points, currency = 'EUR', className,
}: {
  /** One per day, oldest first, no gaps — buildBalanceHistory's `points`. */
  points: readonly BalancePoint[];
  currency?: string;
  className?: string;
}) {
  const privacy = usePrivacy();
  const money = useMoneyText();
  const [boxRef, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  // Whether the active day was picked by keyboard: only then does it become
  // the slider's value (a pointer sweeping across a focused chart would
  // otherwise flood a screen reader with one announcement per day).
  const [viaKeys, setViaKeys] = useState(false);
  // A click focuses the chart too; that focus is the pointer's, not the keyboard's.
  const pointerFocus = useRef(false);
  const summaryId = useId();
  const hintId = useId();
  const clipId = useId().replace(/:/g, '');

  const n = points.length;
  const height = width && width < 480 ? 152 : 188;

  // Forget a selection that no longer exists (another account, a new range).
  useEffect(() => setActive(null), [points]);

  const geo = useMemo(() => {
    if (!width || n < 2) return null;
    let min = Infinity;
    let max = -Infinity;
    let minAt = 0;
    let maxAt = 0;
    points.forEach((p, i) => {
      if (p.balance < min) { min = p.balance; minAt = i; }
      if (p.balance > max) { max = p.balance; maxAt = i; }
    });
    // Zero is always inside the domain — see the note at the top.
    let lo = Math.min(0, min);
    let hi = Math.max(0, max);
    if (hi === lo) hi = lo + 1;
    const span = hi - lo;
    // Air above the highest and below the lowest point, but never past zero
    // on a side where zero is the edge.
    if (hi > 0) hi += span * 0.06;
    if (lo < 0) lo -= span * 0.06;

    const plotTop = PAD_TOP;
    const plotBottom = height - PAD_BOTTOM;
    const plotLeft = PAD_X;
    // Every day owns an equal slot: day i runs from left(i) to left(i + 1).
    const slot = (width - PAD_X * 2) / n;
    const left = (i: number) => plotLeft + i * slot;
    /** The middle of a day's slot — where its dot and its tooltip sit. */
    const x = (i: number) => left(i) + slot / 2;
    const y = (v: number) => plotTop + ((hi - v) / (hi - lo)) * (plotBottom - plotTop);
    const zeroY = y(0);

    // Step-after: across day i at that day's level, then straight up or down
    // at the boundary to the next day's. Days without a booking merge into
    // one flat run, so the path only has corners where the balance moved.
    const r = (v: number) => Math.round(v * 10) / 10;
    let line = `M${r(left(0))} ${r(y(points[0].balance))}`;
    for (let i = 1; i < n; i++) {
      if (points[i].balance === points[i - 1].balance) continue;
      line += `H${r(left(i))}V${r(y(points[i].balance))}`;
    }
    line += `H${r(left(n))}`;
    const area = `M${r(left(0))} ${r(zeroY)}V${line.slice(line.indexOf(' ') + 1)}V${r(zeroY)}Z`;

    // Month starts: a faint rule where the 1st begins and the month's short
    // name, thinned out so a year on a phone does not turn into a smear of
    // labels.
    const months: { x: number; label: string }[] = [];
    let lastX = -Infinity;
    points.forEach((p, i) => {
      if (i === 0 || !p.date.endsWith('-01')) return;
      const px = left(i);
      if (px - lastX < 34 || px < 18 || px > width - 18) return;
      lastX = px;
      months.push({ x: px, label: MONTHS[Number(p.date.slice(5, 7)) - 1] ?? '' });
    });

    return { min, max, minAt, maxAt, left, x, y, zeroY, line, area, months, plotTop, plotBottom };
  }, [width, height, n, points]);

  if (n < 2) return null;

  const last = points[n - 1];
  // A day, spoken: the slider's value text. In privacy mode the amount is
  // named as hidden rather than read out as a row of mask dots.
  const spoken = (i: number) =>
    `Kontostand am ${dateOf(points[i].date)}: ${privacy ? MASKED_LABEL : money(points[i].balance, currency)}`;

  // The picture, in words — what a sighted reader takes from it at a glance.
  // Read as the slider's description, after its name ("Kontoverlauf").
  const summary = (() => {
    const range = `Vom ${shortDate(points[0].date)} bis ${dateOf(last.date)}`;
    if (privacy) return `${range}. Beträge sind ausgeblendet.`;
    let min = 0;
    let max = 0;
    points.forEach((p, i) => {
      if (p.balance < points[min].balance) min = i;
      if (p.balance > points[max].balance) max = i;
    });
    return `${range}: niedrigster Stand ${money(points[min].balance, currency)} am ${shortDate(points[min].date)}, `
      + `höchster Stand ${money(points[max].balance, currency)} am ${shortDate(points[max].date)}, `
      + `zuletzt ${money(last.balance, currency)}.`;
  })();

  // The day the slider stands on: the one picked by keyboard, else the latest.
  const valueAt = viaKeys && active != null ? active : n - 1;

  // The day whose slot is under the pointer.
  const pick = (clientX: number, rect: DOMRect) => {
    if (!geo) return;
    const t = (clientX - rect.left - PAD_X) / (rect.width - PAD_X * 2);
    setActive(Math.max(0, Math.min(n - 1, Math.floor(t * n))));
  };

  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    setViaKeys(false);
    pick(e.clientX, e.currentTarget.getBoundingClientRect());
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = (d: number) => {
      e.preventDefault();
      setViaKeys(true);
      setActive((a) => Math.max(0, Math.min(n - 1, (a ?? n - 1) + d)));
    };
    switch (e.key) {
      case 'ArrowLeft': return step(e.shiftKey ? -7 : -1);
      case 'ArrowRight': return step(e.shiftKey ? 7 : 1);
      case 'PageUp': return step(-7);
      case 'PageDown': return step(7);
      case 'Home': e.preventDefault(); setViaKeys(true); return setActive(0);
      case 'End': e.preventDefault(); setViaKeys(true); return setActive(n - 1);
      case 'Escape': if (active != null) { e.preventDefault(); setActive(null); } return;
    }
  };

  // The "0 €" label only matters once the line dips below zero (otherwise the
  // zero line is simply the floor). It goes to whichever end the line is
  // farther from zero, and is left out when the line hugs zero at both ends.
  const zeroLabel = (() => {
    if (!geo || privacy || geo.zeroY >= geo.plotBottom - 2) return null;
    // Closest the line comes to the label's middle over the label's width
    // (~56px): every day whose slot reaches into that stretch counts.
    const gap = (fromX: number, toX: number) => {
      let g = Infinity;
      points.forEach((p, i) => {
        if (geo.left(i + 1) >= fromX && geo.left(i) <= toX) g = Math.min(g, Math.abs(geo.y(p.balance) - (geo.zeroY - 10)));
      });
      return g;
    };
    const startGap = gap(0, 56);
    const endGap = gap(width - 56, width);
    if (Math.max(startGap, endGap) < 16) return null;
    return { start: startGap >= endGap };
  })();

  const a = active != null && geo ? { i: active, x: geo.x(active), y: geo.y(points[active].balance) } : null;
  const negativeAt = (i: number) => Math.round(points[i].balance * 100) < 0;

  // Max/min guides. The min guide is dropped when it would sit on top of the
  // zero line or the max guide — two labels in one place read as neither.
  // Each label sits at the end of its guide AWAY from the extreme it names, so
  // it never covers the peak (or the trough) it is describing.
  const guides = geo && !privacy
    ? [
        { key: 'max', y: geo.y(geo.max), at: geo.maxAt, label: `Max. ${money(geo.max, currency)}` },
        ...(Math.abs(geo.y(geo.min) - geo.y(geo.max)) > 18 && Math.abs(geo.y(geo.min) - geo.zeroY) > 14
          ? [{ key: 'min', y: geo.y(geo.min), at: geo.minAt, label: `Min. ${money(geo.min, currency)}` }]
          : []),
      ].map((g) => {
        let start = g.at > (n - 1) / 2;
        // A maximum right at zero (an account that spent the range in the
        // red) would print its label over the "0 €" label: it moves to the
        // other end. Its text sits above its guide and the line never rises
        // past the maximum, so the line cannot run through it there either.
        if (zeroLabel && zeroLabel.start === start && Math.abs(g.y - geo.zeroY) < 16) start = !start;
        return { ...g, start };
      })
    : [];

  return (
    <div className={cx('relative', className)}>
      {/* A slider over the days, not an image: NVDA and JAWS only hand the
          arrow keys to a widget role, and switch to focus mode for it on
          their own — on role="img" the keys would move the virtual cursor and
          never reach onKey. The slider's value text is the day's readout, and
          screen readers announce it whenever it changes; the summary and the
          key hint follow as its description. */}
      <div
        ref={boxRef}
        role="slider"
        aria-label="Kontoverlauf"
        aria-describedby={`${summaryId} ${hintId}`}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={n - 1}
        aria-valuenow={valueAt}
        aria-valuetext={spoken(valueAt)}
        tabIndex={0}
        onPointerMove={onPointer}
        onPointerDown={(e) => { pointerFocus.current = true; onPointer(e); }}
        onPointerLeave={() => { if (!viaKeys) setActive(null); }}
        onFocus={() => {
          if (pointerFocus.current) { pointerFocus.current = false; return; }
          setViaKeys(true);
          setActive((x) => x ?? n - 1);
        }}
        onBlur={() => { pointerFocus.current = false; setActive(null); setViaKeys(false); }}
        onKeyDown={onKey}
        // Horizontal drags pick a day; vertical ones still scroll the page.
        className="relative rounded-[6px] outline-none [touch-action:pan-y] focus-visible:shadow-[var(--ring)]"
        style={{ height }}
      >
        {geo && (
          // Absolutely placed and filling the box: the drawing is sized FROM
          // the box, so it must not also give the box a minimum width, or the
          // chart could never shrink when the window does. The viewBox is the
          // last measured size, so normally one unit is one pixel; should a
          // measurement ever lag a resize, the picture stretches for a frame
          // instead of spilling out of its tile.
          <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            aria-hidden
            focusable="false"
            className="absolute inset-0 block h-full w-full overflow-visible"
          >
            <defs>
              <clipPath id={`${clipId}-above`}>
                <rect x={0} y={0} width={width} height={Math.max(0, geo.zeroY)} />
              </clipPath>
              <clipPath id={`${clipId}-below`}>
                <rect x={0} y={geo.zeroY} width={width} height={Math.max(0, height - geo.zeroY)} />
              </clipPath>
            </defs>

            {geo.months.map((m) => (
              <g key={m.x}>
                <line x1={m.x} x2={m.x} y1={geo.plotTop - 6} y2={geo.plotBottom} stroke="var(--chart-grid)" strokeWidth={1} />
                <text
                  x={m.x}
                  y={height - 8}
                  textAnchor="middle"
                  fontSize={12}
                  fill="var(--ink-3)"
                  className="tnum"
                >
                  {m.label}
                </text>
              </g>
            ))}

            {guides.map((g) => (
              <line key={g.key} x1={0} x2={width} y1={g.y} y2={g.y} stroke="var(--chart-axis)" strokeWidth={1} strokeDasharray="2 4" />
            ))}

            <path d={geo.area} fill="var(--chart-area)" clipPath={`url(#${clipId}-above)`} />
            <path d={geo.area} fill="var(--red-soft)" clipPath={`url(#${clipId}-below)`} />

            {/* Zero: the baseline when the account never dipped, the line that
                matters most when it did. */}
            <line x1={0} x2={width} y1={geo.zeroY} y2={geo.zeroY} stroke="var(--chart-axis)" strokeWidth={1} />

            <path
              d={geo.line}
              fill="none"
              stroke="var(--chart-line)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              clipPath={`url(#${clipId}-above)`}
            />
            <path
              d={geo.line}
              fill="none"
              stroke="var(--red)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              clipPath={`url(#${clipId}-below)`}
            />

            {guides.map((g) => (
              <text
                key={g.key}
                x={g.start ? 0 : width}
                y={g.y - 6}
                textAnchor={g.start ? 'start' : 'end'}
                fontSize={12}
                fontWeight={600}
                fill="var(--ink-2)"
                stroke="var(--surface)"
                strokeWidth={4}
                strokeLinejoin="round"
                paintOrder="stroke"
                className="amount"
              >
                {g.label}
              </text>
            ))}
            {zeroLabel && (
              <text
                x={zeroLabel.start ? 0 : width}
                y={geo.zeroY - 6}
                textAnchor={zeroLabel.start ? 'start' : 'end'}
                fontSize={12}
                fill="var(--ink-3)"
                stroke="var(--surface)"
                strokeWidth={4}
                strokeLinejoin="round"
                paintOrder="stroke"
                className="amount"
              >
                {money(0, currency)}
              </text>
            )}

            {a && (
              <g>
                <line x1={a.x} x2={a.x} y1={geo.plotTop - 6} y2={geo.plotBottom} stroke="var(--line-strong)" strokeWidth={1} />
                <circle
                  cx={a.x}
                  cy={a.y}
                  r={5}
                  fill="var(--surface)"
                  stroke={negativeAt(a.i) ? 'var(--red)' : 'var(--chart-line)'}
                  strokeWidth={2.5}
                />
              </g>
            )}
            {!a && (
              // Where the line ends: the latest closing balance.
              <circle cx={geo.left(n)} cy={geo.y(last.balance)} r={3.5} fill={negativeAt(n - 1) ? 'var(--red)' : 'var(--chart-line)'} />
            )}
          </svg>
        )}

        {a && geo && (
          <div
            aria-hidden
            className="pointer-events-none absolute z-10 rounded-[8px] bg-raised px-3 py-2 whitespace-nowrap shadow-[var(--shadow-pop)]"
            style={{
              // Centred over the day, kept inside the chart; above the point
              // unless that would leave the chart, then below it.
              left: Math.max(0, Math.min(width - 196, a.x - 98)),
              width: 196,
              top: a.y - 64 >= -8 ? a.y - 64 : a.y + 14,
            }}
          >
            <span className="tnum block text-[12.5px] leading-tight text-ink-3">
              Kontostand am {dateOf(points[a.i].date)}
            </span>
            <span
              className={cx(
                'amount mt-0.5 block text-[15px] leading-tight font-semibold',
                !privacy && negativeAt(a.i) ? 'text-red' : 'text-ink',
              )}
            >
              {money(points[a.i].balance, currency)}
            </span>
          </div>
        )}
      </div>

      <span id={summaryId} className="sr-only">{summary}</span>
      <span id={hintId} className="sr-only">
        Mit den Pfeiltasten wählst du einen Tag, mit Bild auf und Bild ab springst du eine Woche.
      </span>
    </div>
  );
}
