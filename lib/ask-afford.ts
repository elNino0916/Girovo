// Girovo AI: "Kann ich mir 800 € leisten?" answered from the month-end
// forecast (lib/forecast.ts), never guessed (components/insights/ask/
// FactAnswers.tsx says it):
//
// - afford   "Kann ich mir 800 € leisten?", "Reicht mein Geld für einen Urlaub
//            für 600 €?", "Kann ich diesen Monat noch 200 € ausgeben?", "Geht
//            sich eine 1.200 € Reparatur im Dezember aus?", "Can I afford €800?"
//
// The answer: the forecast's lowest balance until the month's end, less the
// amount, as if it were paid today. Three outcomes (affordOutcome): it fits,
// it fits tightly (less than AFFORD_TIGHT left at the lowest point), or it
// does not fit, by how much below zero or past the Dispo. The forecast only
// looks to the end of this month: a month after it is said, not worked out.
// Without an amount ("Kann ich mir das leisten?") the answer asks for one.
//
// A budget question stays one ("Reicht mein Budget für Essen?",
// lib/ask-budgets.ts): factOf asks the budgets first, and a question with the
// word budget is never read here.
//
// Pure: no path aliases, `.ts` on sibling imports.

import { amountOf, futureDayOf } from './ask-actions.ts';

/**
 * cents: the amount asked about, null when the question names none.
 * month: the yyyy-mm a month's name or "nächsten Monat" points to; null for
 * this month ("diesen Monat", "bis Monatsende", or no month at all).
 */
export type AffordIntent = { kind: 'afford'; cents: number | null; month: string | null };

/**
 * Tight: less than this is left at the lowest point, in cents. 100 € at least,
 * or a tenth of the month's usual spending (the regular payments a month plus
 * the forecast's usual spending besides them over 30 days), whichever is
 * more: 100 € is a few days' shopping, and for an account that spends 3.000 €
 * a month 300 € is the same few days.
 */
export const AFFORD_TIGHT_CENTS = 10000;
export const AFFORD_TIGHT_SHARE = 0.1;

/** Amounts and dates kept whole: "1.200 €", "€800", "15.12." (lib/ask-actions.ts reads them this way). */
const foldKeep = (s: string) => ` ${s.toLocaleLowerCase('de')
  .replace(/€/g, ' € ')
  // "€1,200" in English is 1.200 € (a German decimal has one or two digits); "1,5k" is "1,5 k".
  .replace(/(?<=\d),(?=\d{3}(?!\d))/g, '.')
  .replace(/(?<=\d)k(?=\s|$)/g, ' k')
  .replace(/[?!;:„“"'()]/g, ' ')
  .replace(/(?<!\d),|,(?!\d)/g, ' ')
  .replace(/\.(?=\s|$)/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()} `;

const pad = (n: number) => String(n).padStart(2, '0');

// i18n-data-start — the words people use, German and English
/** "leisten", "gönnen", "afford": asked even without an amount. */
const AFFORD = / (?:leisten|leistbar|gönnen|goennen|afford|affordable) /;
/** "Reicht mein Geld für …", "Langt das Konto für …". */
const REACH_FOR = / (?:reicht|reichen|reichts|langt|langen) (?:\S+ ){0,4}(?:für|fuer|fürs|fuers) /;
/** "Geht sich das aus?" (Austrian): with "sich" and "aus" last. */
const GOES = / geht (?:\S+ ){0,8}aus $/;
/** "Kann ich noch 200 € ausgeben", "Can I spend €200". */
const SPEND_CAN = / (?:kann|könnte|koennte|darf) ich (?:\S+ ){0,6}(?:ausgeben|kaufen|bezahlen|zahlen) | (?:can|could|may) i (?:still )?(?:\S+ ){0,4}(?:spend|buy|pay for) /;
/** "Hab ich genug Geld für …", "enough money for …". */
const ENOUGH = / (?:genug|genügend|genuegend|enough) (?:\S+ ){0,2}(?:für|fuer|fürs|fuers|for|to) /;
/** "Ist ein Fernseher für 800 € drin?" */
const ROOM = / (?:drin|drinnen|room for) /;
/** Words that make it the month-end forecast or the budgets, not one amount: "für den Rest des Monats". */
const NOT_A_THING = / (?:für|fuer|for) (?:den |the )?(?:rest|monat|monatsende|month|end of the month) /;
const BUDGET = /budget/;
/** "Reicht mein Geld für einen Urlaub?": something to pay for, named after "für ein…". */
const FOR_A_THING = / (?:für|fuer|fürs|fuers|for) (?:eine?[nmrs]?|neue[nmrs]?|a|an|new) /;
const MONEY_WORD = / (?:geld|konto|money|account|es|das) /;
const THIS_MONTH = / (?:diese[nm]? monat|monatsende|ende des monats|ende diese[ns] monats|this month|end of (?:the |this )?month) /;
const NEXT_MONTH = / (?:nächste[nm]?|naechste[nm]?|kommende[nm]?|next|coming) (?:monat|month) /;
const NEXT_YEAR = / (?:nächste[ns]? jahr|naechste[ns]? jahr|kommende[ns]? jahr|next year) /;
const CHRISTMAS = / (?:weihnachten|christmas|silvester|jahresende|ende des jahres|end of the year) /;
const MONTHS: Record<string, number> = {
  januar: 1, jänner: 1, january: 1, februar: 2, february: 2, märz: 3, maerz: 3, march: 3, april: 4, mai: 5, may: 5,
  juni: 6, june: 6, juli: 7, july: 7, august: 8, september: 9, oktober: 10, october: 10, november: 11, dezember: 12, december: 12,
};
/** English "may" is a month only after these: "Can I afford it in May?", never "May I spend …". */
const BEFORE_MAY = / (?:in|im|of|until|till|by|bis|end of|ende) $/;
// i18n-data-end

const MONTH_RE = new RegExp(` (${Object.keys(MONTHS).join('|')})(?: (\\d{4}))?(?= )`, 'g');

/** "2026-11" moved by `n` months. */
function monthFrom(today: string, n: number): string {
  const [y, m] = today.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/**
 * A day still to come the question names ("am 15.12."), and the question
 * without it; none for "1.200 €", which reads as 1.2.(20)00 and so lies in
 * the past or too far ahead.
 */
function dayAsked(q: string, today: string): { day: string | null; rest: string } {
  const { by, rest } = futureDayOf(q, today);
  const ty = Number(today.slice(0, 4));
  return by && by >= today && Number(by.slice(0, 4)) <= ty + 1 ? { day: by, rest } : { day: null, rest: q };
}

/** The month a question names, as a month still to come (this one included); null for this month or none. */
function monthAsked(q: string, today: string): string | null {
  const [ty, tm] = today.split('-').map(Number);
  const { day } = dayAsked(q, today);
  if (day) return day.slice(0, 7);
  for (const m of q.matchAll(MONTH_RE)) {
    if (m[1] === 'may' && !m[2] && !BEFORE_MAY.test(q.slice(0, (m.index ?? 0) + 1))) continue;
    const month = MONTHS[m[1]];
    const year = m[2] ? Number(m[2]) : month >= tm ? ty : ty + 1;
    return `${year}-${pad(month)}`;
  }
  if (NEXT_MONTH.test(q)) return monthFrom(today, 1);
  if (NEXT_YEAR.test(q)) return `${ty + 1}-01`;
  if (CHRISTMAS.test(q)) return `${ty}-12`;
  if (THIS_MONTH.test(q)) return null;
  return null;
}

/** What a question asks of the forecast about one amount; null for anything else. `today`: yyyy-mm-dd. */
export function affordIntentOf(question: string, today: string): AffordIntent | null {
  const q = foldKeep(question);
  if (BUDGET.test(q)) return null;
  // A day named ("am 15.12.") is read for its month, then left out, so it is no amount.
  const { rest } = dayAsked(q, today);
  const cents = amountOf(rest);
  const afford = AFFORD.test(q);
  const asks = REACH_FOR.test(q) || GOES.test(q) && / sich /.test(q) || SPEND_CAN.test(q) || ENOUGH.test(q) || ROOM.test(q);
  if (!afford && !asks) return null;
  // "Reichen 400 € noch für den Monat?" asks whether the month can be lived on, not about paying for something.
  if (!afford && NOT_A_THING.test(q)) return null;
  if (cents == null) {
    // "Kann ich mir das leisten?" and "Reicht mein Geld für einen Urlaub?" want an amount; "Reicht es für den Rest des Monats?" is the forecast.
    const wantsAmount = afford || (REACH_FOR.test(q) || ENOUGH.test(q)) && FOR_A_THING.test(q) && MONEY_WORD.test(q);
    if (!wantsAmount) return null;
  }
  return { kind: 'afford', cents, month: monthAsked(q, today) };
}

// ---------------------------------------------------------------------------
// The figures
// ---------------------------------------------------------------------------

/** The cents below which what is left counts as tight: AFFORD_TIGHT_CENTS, or AFFORD_TIGHT_SHARE of a month's usual spending. */
export function tightLine(monthlySpendingCents: number): number {
  return Math.max(AFFORD_TIGHT_CENTS, Math.round(Math.abs(monthlySpendingCents) * AFFORD_TIGHT_SHARE));
}

/**
 * A month's usual spending, in cents: the account's regular payments a month
 * (their monthly amounts, negative) and the forecast's usual spending besides
 * them (per day, negative) over 30 days.
 */
export function monthlySpending(regularMonthly: readonly number[], usualPerDay: number | null): number {
  const regular = regularMonthly.reduce((s, v) => s + Math.round(Math.abs(v) * 100), 0);
  return regular + Math.round(Math.abs(usualPerDay ?? 0) * 100 * 30);
}

export type AffordOutcome =
  /** left: cents left at the lowest point, at least `tight`. */
  | { state: 'fits'; left: number; day: string }
  /** left: cents left at the lowest point, 0 up to below `tight`. */
  | { state: 'tight'; left: number; day: string }
  /** under: cents below zero at the lowest point, within the Dispo where there is one (dispo). */
  | { state: 'short'; under: number; day: string; dispo: boolean; already: boolean }
  /** over: cents past the Dispo at the lowest point. */
  | { state: 'overDispo'; over: number; day: string; already: boolean };

/**
 * Whether `cents` fit into the forecast: its lowest expected balance
 * (`low`, euros, and its day) less them, as if paid today. `creditLimit`: the
 * Dispositionsrahmen in euros (positive), where the bank reports one.
 * `tight`: the line below which what is left is tight (tightLine).
 * `already`: the balance dips below zero without the amount too.
 */
export function affordOutcome(opts: {
  low: { date: string; balance: number };
  cents: number;
  creditLimit?: number | null;
  tight: number;
}): AffordOutcome {
  const low = Math.round(opts.low.balance * 100);
  const left = low - Math.abs(opts.cents);
  const day = opts.low.date;
  if (left >= opts.tight) return { state: 'fits', left, day };
  if (left >= 0) return { state: 'tight', left, day };
  const limit = Math.round(Math.max(0, opts.creditLimit ?? 0) * 100);
  const already = low < 0;
  if (limit > 0 && left < -limit) return { state: 'overDispo', over: -limit - left, day, already };
  return { state: 'short', under: -left, day, dispo: limit > 0, already };
}

/** Whether the forecast, which ends with `until`'s month, reaches the month asked (null: this month). */
export function forecastReaches(month: string | null, until: string): boolean {
  return month == null || month === until.slice(0, 7);
}
