// Girovo Next, "Fragen": a follow-up in a conversation keeps what it does not
// say again (components/insights/AskThread.tsx). "Und Lieferando?" after a
// question about October asks about Lieferando in October; "Und im September?"
// after one about Lieferando asks about Lieferando in September. What the
// follow-up names itself wins; the rest comes from the question before it.
//
// Until the on-device model plans follow-ups itself, this is the rule.
//
// Pure: no path aliases, `.ts` on sibling imports.

import {
  categoryFromQuestion, compareFromQuestion, dirFromQuestion, kindFromQuestion, periodDays, periodFromQuestion, rankFromQuestion,
  searchFromQuestion,
  type AskPeriod, type AskQuery,
} from './nano-ask.ts';

// i18n-data-next-line
const MONTH_BEFORE = /\b(?:monat davor|monat vorher|month before|previous month)\b/i;

/** The question read on its own (lib/nano-ask.ts readQuestion), completed from the one before it. */
export function followUp(prev: AskQuery | null, question: string, read: AskQuery, today: string): AskQuery {
  if (!prev) return read;
  // "Und im Monat davor?", "And the month before?": the month before the one asked about, not last month.
  const before = MONTH_BEFORE.test(question) ? monthBefore(prev.period, today) : null;
  const namedPeriod = !!(before || compareFromQuestion(question, today) || periodFromQuestion(question, today));
  const namedKind = !!(rankFromQuestion(question) || compareFromQuestion(question, today) || kindFromQuestion(question));
  // A topic the question names in its own words (a model's guess at "Und im Monat davor?" is none),
  // or any topic when the question before had none to keep.
  const ownWords = !!(categoryFromQuestion(question) || searchFromQuestion(question)
    || (read.search && question.toLocaleLowerCase('de').includes(read.search.toLocaleLowerCase('de'))));
  const namedTopic = ownWords || (!prev.category && !prev.search && !!(read.search || read.category));
  // Income makes a question "in" by its topic alone: a new topic takes its own direction, not income's.
  const namedDir = !!dirFromQuestion(question) || read.category === 'income' || (namedTopic && prev.category === 'income');
  // A comparison or a ranking does not carry over to a new topic: "Und Lieferando?" asks for a sum.
  const carriedKind = prev.kind === 'compare' || prev.kind === 'rank' ? (namedTopic ? 'sum' : prev.kind) : prev.kind;
  // A question about the month before names no kind of its own, whatever the rules read in "Monat".
  const kind = namedKind && !before ? read.kind : carriedKind;
  const next: AskQuery = {
    kind,
    dir: namedDir ? read.dir : prev.dir,
    category: namedTopic ? read.category : prev.category,
    search: namedTopic ? read.search : prev.search,
    hint: namedTopic ? read.hint : prev.hint,
    period: before ? { kind: 'month', month: before } : namedPeriod ? read.period : prev.period,
  };
  const rank = namedKind ? read.rank : kind === 'rank' ? prev.rank : undefined;
  const against = namedPeriod ? read.against : kind === 'compare' ? prev.against : undefined;
  return { ...next, ...(rank ? { rank } : {}), ...(against ? { against } : {}) };
}

/** The month before a query's period, when it is one month: what "Und im Monat davor?" asks about. Null otherwise. */
export function monthBefore(period: AskPeriod, today: string): string | null {
  const days = periodDays(period, today);
  if (!days) return null;
  const isMonth = period.kind === 'month' || period.kind === 'lastMonth' || period.kind === 'thisMonth';
  if (!isMonth) return null;
  const [y, m] = days.from.slice(0, 7).split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  return prev;
}
