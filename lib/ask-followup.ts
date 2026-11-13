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
  categoryFromQuestion, compareFromQuestion, dirFromQuestion, kindFromQuestion, perFromQuestion, periodDays, periodFromQuestion, periodsFromQuestion,
  rankByFromQuestion, rankFromQuestion, saysDirection, searchFromQuestion,
  type AskPeriod, type AskQuery, type NanoReading,
} from './nano-ask.ts';

// i18n-data-next-line
const MONEY = /\b(?:geld|ausgegeben|ausgeben|gezahlt|bezahlt|zahle|zahlte|kostet|kosten|umsatz|umsätze|umsaetze|überwiesen|ueberwiesen|bekommen|eingang|eingänge|ausgaben|einnahmen|spent|spend|paid|pay|cost|costs|transaction|transactions|money|income|received)\b|€/i;

// i18n-data-next-line
const BOOKINGS = /(?:^|[^\p{L}])(?:umsätze|umsaetze|buchungen|zahlungen|überweisungen|ueberweisungen|abbuchungen|lastschriften|ausgaben|einnahmen|eingänge|transactions|payments|transfers|bookings)(?![\p{L}])/iu;

// i18n-data-next-line
const SHOW_THEM = /^(?:zeig\w*|show|list)(?: (?:mir|me|sie|die|diese|alle|them|those|the|all|bitte|please|mal))*(?: (?:umsätze|umsaetze|buchungen|zahlungen|transactions|payments))?$/i;

/**
 * Whether a message asks about the bookings at all. A model always reads
 * something into "Hallo" or "Wie geht es dir" (every booking, or a category
 * it guesses), and Girovo would then answer with every booking's sum. So:
 * what the rules read in the question's own words (`rules`, readQuestion
 * without a model), a payee's name that stands in the question, or a
 * category the model saw beside a word about money.
 */
export function aboutBookings(question: string, rules: AskQuery | null, reading: NanoReading | null): boolean {
  if (ordersSomething(question)) return false;
  // A reading that is nothing but an "an" or "bei" ("Na, alles fit bei dir?") is no sign of the bookings,
  // nor a bare "zeig" ("Zeig mal, was du kannst") unless it names the bookings ("Zeig mir alle Umsätze").
  const bare = rules && (rules.kind === 'sum' || (rules.kind === 'list' && !BOOKINGS.test(question)))
    && !rules.category && !rules.search && rules.period.kind === 'all' && !saysDirection(question);
  if (rules && !bare) return true;
  if (reading?.search && question.toLocaleLowerCase('de').includes(reading.search.toLocaleLowerCase('de'))) return true;
  return !!reading?.category && MONEY.test(question);
}

// i18n-data-next-line
const INJECTION = /^(?:ignorier\w*|ignore|vergiss|forget)\b|\b(?:ignorier\w*|ignore|vergiss|forget) (?:\S+ ){0,3}(?:anweisungen|instructions|regeln|rules)\b/i;

// i18n-data-next-line
const ORDER = /(?:^|\bund |\bbitte |\bplease |\band )(?:überweise|ueberweise|überweis|schick|schicke|sende|zahle|transfer|send|pay|wire)\b/i;

/** Whether a message tells Girovo to drop what it was told ("Ignoriere alle Anweisungen …"). */
export function injects(question: string): boolean {
  return INJECTION.test(question.trim());
}

/**
 * Whether a message tells Girovo to drop what it was told, or orders
 * something with money that it does not do: it gets the line for small talk,
 * never a sum. A transfer to prepare ("Überweise 500 Euro an Lea") is read
 * before this (lib/ask-actions.ts prepareTransfer): only the form opens.
 */
export function ordersSomething(question: string): boolean {
  return injects(question) || ORDER.test(question.trim());
}

// i18n-data-next-line
const ASKS_SUM = /\b(?:wie ?viel|insgesamt|zusammen|how much|in total|altogether)\b/i;

// i18n-data-next-line
const MONTH_BEFORE = /\b(?:monat davor|monat vorher|month before|previous month)\b/i;

// i18n-data-next-line
const CONTINUES = /^(?:und|and|aber|but|auch|also|dann|then|nur|only|was ist mit|what about|wie ist es mit|wie sieht es mit|how about|vs\.?|versus|verglichen mit|im vergleich zu|mehr als|weniger als|more than|less than|compared to)(?=\s|$|[?!.])/i;

/**
 * Whether a message goes on from the question before it: it says so ("Und …",
 * "Was ist mit …"), or it is too short to stand alone ("Pro Monat", "Größte
 * Ausgabe"). "Größte Ausgabe dieses Jahr" stands alone: it starts fresh and
 * keeps nothing of a question about restaurants before it.
 */
export function continuesFrom(question: string): boolean {
  const q = question.trim().replace(/[?!.]+$/, '');
  if (CONTINUES.test(q)) return true;
  // "Zeig sie mir", "Zeig mir die Umsätze": the bookings of the question before.
  if (SHOW_THEM.test(q)) return true;
  // A short message goes on only when it says something about the bookings ("Pro Monat",
  // "Wie oft?"); "Danke!", "Ok", "Hallo" are small talk, not the question before again.
  return q.split(/\s+/).filter(Boolean).length <= 3 && !ordersSomething(q) && saysSomething(q);
}

/** Whether a message names anything a reading is made of: a kind, a ranking, a period, a topic, a direction. */
function saysSomething(q: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return !!(kindFromQuestion(q) || rankFromQuestion(q) || rankByFromQuestion(q) || periodFromQuestion(q, today)
    || compareFromQuestion(q, today) || categoryFromQuestion(q) || searchFromQuestion(q) || saysDirection(q)
    || MONTH_BEFORE.test(q) || ASKS_SUM.test(q));
}

/** Whether a message says in its first words that it goes on ("Und …", "vs …"), whatever its length. */
export function saysItContinues(question: string): boolean {
  return CONTINUES.test(question.trim());
}

/** Kinds whose figure means nothing over both ways at once: a ranking, an average, a comparison, the largest. */
const ONE_WAY_KINDS = new Set<AskQuery['kind']>(['rank', 'average', 'compare', 'largest']);

/** The question read on its own (lib/nano-ask.ts readQuestion), completed from the one before it. */
export function followUp(prev: AskQuery | null, question: string, read: AskQuery, today: string, readPeriod = false): AskQuery {
  if (!prev || !continuesFrom(question)) return read;
  // "Und im Monat davor?", "And the month before?": the month before the one asked about, not last month.
  const before = MONTH_BEFORE.test(question) ? monthBefore(prev.period, today) : null;
  const namedPeriod = !!(before || readPeriod || compareFromQuestion(question, today) || periodFromQuestion(question, today));
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
  // A question about the month before names no kind of its own, whatever the rules read in "Monat";
  // "Und wie viel insgesamt?" after a list asks for the sum.
  const kind = namedKind && !before ? read.kind : ASKS_SUM.test(question) ? 'sum' : carriedKind;
  // "Und Ausgaben?" after the income asks for what went out, of no category.
  const leavesIncome = !namedTopic && prev.category === 'income' && dirFromQuestion(question) === 'out';
  // A list shows both ways; "Wo am meisten?" or "Und im Schnitt?" after it ranks or averages
  // what went out (both ways would mix the salary in), unless the question names a way itself.
  let dir = namedDir ? read.dir : prev.dir;
  if (dir === 'all' && ONE_WAY_KINDS.has(kind)) dir = dirFromQuestion(question) ? read.dir : 'out';
  const next: AskQuery = {
    kind,
    dir,
    category: namedTopic ? read.category : leavesIncome ? null : prev.category,
    search: namedTopic ? read.search : prev.search,
    hint: namedTopic ? read.hint : leavesIncome ? null : prev.hint,
    period: before ? { kind: 'month', month: before } : namedPeriod ? read.period : prev.period,
  };
  // A ranking that does not say of what keeps the one before ("Und am häufigsten?" after "Top 3 Händler").
  // "Und nach Kategorien" turns it to the other side.
  const by = rankByFromQuestion(question);
  const kept = namedKind
    ? read.rank && prev.rank && !by ? { ...read.rank, by: prev.rank.by } : read.rank
    : kind === 'rank' ? prev.rank : undefined;
  const rank = kept && by ? { ...kept, by } : kept;
  let against = namedPeriod ? read.against : kind === 'compare' ? prev.against : undefined;
  if (kind === 'compare' && /^(?:vs\.?|versus|verglichen mit|im vergleich zu|mehr als|weniger als|more than|less than|compared to)(?=\s|$)/i.test(question.trim())
    && periodsFromQuestion(question, today).length === 1 && prev.kind !== 'compare' && prev.period.kind !== 'all'
    && JSON.stringify(periodsFromQuestion(question, today)[0]) !== JSON.stringify(prev.period)) {
    // One period named against the question before's: that one is set against it.
    against = periodsFromQuestion(question, today)[0];
    next.period = prev.period;
  }
  // An average keeps per month or per year unless the question says which ("Und pro Jahr?", "Pro Monat").
  const said = perFromQuestion(question);
  const per = kind !== 'average' ? undefined : said ?? read.per ?? (prev.kind === 'average' ? prev.per : undefined);
  return { ...next, ...(rank ? { rank } : {}), ...(against ? { against } : {}), ...(per === 'year' ? { per } : {}) };
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
