// The Monatsbilanz's yardstick: what part of last month a partial month is
// set against.
//
// A month is nearly always unfinished when it is looked at. Rent leaves on the
// 1st and the salary arrives on the 30th, so the first four days of October
// against all of September say "much worse than last month" when nothing has
// changed. Like is compared with like: the same days of the month before.
//
// Pure and dependency-free apart from sibling lib modules, so the
// `node --test` suite can run it under Node's own type stripping.

import { isoDate } from './format.ts';

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days in the month `m` (0-based) of year `y`. */
const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

/**
 * `key` moved one month back. With `end`, the last day of a month stays the
 * last day ("bis 31.03." is all of March, so it is all of February); any other
 * day keeps its number, cut to the length of the earlier month (30 March →
 * 28 February). '' for anything that is not a yyyy-mm-dd.
 */
export function dayOneMonthBack(key: string, { end = false }: { end?: boolean } = {}): string {
  const m = DAY.exec(key);
  if (!m) return '';
  const y = +m[1];
  const month = +m[2] - 1;
  const d = +m[3];
  const prevLength = daysIn(y, month - 1);
  const day = end && d === daysIn(y, month) ? prevLength : Math.min(d, prevLength);
  return isoDate(new Date(y, month - 1, day));
}

export type ComparisonSpan = {
  from: string;
  to: string;
  /** The span is a whole calendar month: say "Im September", not "bis 30.09.". */
  wholeMonth: boolean;
};

/**
 * The same days one month earlier, for a span inside one calendar month:
 * 01.10.–04.10. is set against 01.09.–04.09., a whole month against the whole
 * month before. Null when the span is not a span inside one month.
 */
export function comparisonSpan(span: { from: string; to: string }): ComparisonSpan | null {
  if (!DAY.test(span.from) || !DAY.test(span.to) || span.from > span.to) return null;
  if (span.from.slice(0, 7) !== span.to.slice(0, 7)) return null;
  const from = dayOneMonthBack(span.from);
  const to = dayOneMonthBack(span.to, { end: true });
  const [y, m] = to.split('-').map(Number);
  const wholeMonth = from.endsWith('-01') && Number(to.slice(8)) === daysIn(y, m - 1);
  return { from, to, wholeMonth };
}
