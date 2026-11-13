// Girovo Next: the three questions "Girovo AI ist bereit" offers
// (components/insights/ai/AiReady.tsx), made from the user's own bookings so
// the first tap already answers something about their money:
//
//   1. the payee paid most often last month: "Wie viel ging im Oktober an Rewe?"
//   2. Verträge & Abos, when it has contracts: "Was kann ich bis Ende des
//      Monats kündigen?" when one has a day to cancel by, else "Welche Abos
//      habe ich?"
//   3. Essen & Trinken, when there are such bookings: "Wo war ich im Oktober
//      essen?"
//
// Where the bookings say too little, the fallbacks fill up (welcome.q.fallbacks),
// so there are always exactly three, none twice. Each reads as the rules read
// it (lib/ask-read.ts), with or without a model.
//
// Pure: no path aliases, `.ts` on sibling imports.

import { intlLocale, msgs } from './i18n/index.ts';

/** A booking as the questions need it: its day, its signed amount, its payee as the list shows it, its category. */
export type WelcomeBooking = { day: string; amount: number; payee: string; category: string };

export type WelcomeInput = {
  bookings: readonly WelcomeBooking[];
  /** yyyy-mm-dd. */
  today: string;
  /** Live contracts and subscriptions in Verträge & Abos (money going out). */
  contracts: number;
  /** One of them has a day to cancel by ("Kündbar bis", vault contractReminders). */
  cancelDate: boolean;
};

/** Categories that are no spending at a payee: money moved between own accounts, put aside, coming in. */
const NOT_SPENDING = new Set(['transfer', 'savings', 'income', 'otherIn']);
/** Longer payee names make a question nobody would type. */
const NAME_MAX = 28;

const monthOf = (day: string) => day.slice(0, 7);

function monthBefore(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** The month's name alone, in the app's language: "Oktober", "October". */
export function monthName(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number);
  return new Intl.DateTimeFormat(intlLocale(), { month: 'long' }).format(new Date(y, m - 1, 1));
}

const spending = (b: WelcomeBooking) => b.amount < 0 && !NOT_SPENDING.has(b.category);

/**
 * The payee paid most often in a month (on a tie, the one paid more), as the
 * list names it; null when the month has no spending at a payee with a usable name.
 */
export function topPayee(bookings: readonly WelcomeBooking[], month: string): string | null {
  const byName = new Map<string, { name: string; count: number; sum: number }>();
  for (const b of bookings) {
    if (monthOf(b.day) !== month || !spending(b)) continue;
    const name = b.payee.replace(/\s+/g, ' ').trim();
    if (!name || name.length > NAME_MAX || !/\p{L}/u.test(name)) continue;
    const key = name.toLocaleLowerCase('de');
    const row = byName.get(key) ?? { name, count: 0, sum: 0 };
    row.count += 1;
    row.sum += -b.amount;
    byName.set(key, row);
  }
  let best: { name: string; count: number; sum: number } | null = null;
  for (const row of byName.values()) {
    if (!best || row.count > best.count || (row.count === best.count && row.sum > best.sum)) best = row;
  }
  return best?.name ?? null;
}

/** The month to ask about: last month, else this one when last month had no spending yet. */
function askedMonth(bookings: readonly WelcomeBooking[], today: string, fits: (b: WelcomeBooking) => boolean): string | null {
  const now = monthOf(today);
  const last = monthBefore(now);
  if (bookings.some((b) => monthOf(b.day) === last && fits(b))) return last;
  if (bookings.some((b) => monthOf(b.day) === now && fits(b))) return now;
  return null;
}

/** The newest month with Essen & Trinken, last month first. */
function diningMonth(bookings: readonly WelcomeBooking[], today: string): string | null {
  const dining = (b: WelcomeBooking) => b.amount < 0 && b.category === 'dining' && b.day <= today;
  const recent = askedMonth(bookings, today, dining);
  if (recent) return recent;
  let newest = '';
  for (const b of bookings) if (dining(b) && b.day > newest) newest = b.day;
  return newest ? monthOf(newest) : null;
}

/** Exactly three questions to start from, in the app's language. */
export function welcomeQuestions(input: WelcomeInput): string[] {
  const q = msgs().ask.welcome.q;
  const { bookings, today } = input;
  const out: string[] = [];
  const add = (text: string | null) => {
    if (text && out.length < 3 && !out.includes(text)) out.push(text);
  };

  const payeeMonth = askedMonth(bookings, today, spending);
  const payee = payeeMonth ? topPayee(bookings, payeeMonth) : null;
  if (payeeMonth && payee) add(q.payee(monthName(payeeMonth), payee));

  if (input.contracts > 0) add(input.cancelDate ? q.cancelSoon : q.subscriptions);

  const dining = diningMonth(bookings, today);
  if (dining) add(q.dining(monthName(dining)));

  for (const f of q.fallbacks) add(f);
  return out;
}
