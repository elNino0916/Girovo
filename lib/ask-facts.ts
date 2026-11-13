// Girovo AI: questions answered from figures the app already has, not from a
// sum of bookings (components/insights/ask/FactAnswers.tsx says them):
//
// - balance       "Wie viel Geld habe ich?", "Kontostand": every account's balance and the total
// - balanceAt     "Kontostand am 1. Oktober", "im August": the balance then, today's less the bookings since
// - monthEnd      "Reicht es bis Monatsende?": the month-end forecast (lib/forecast.ts)
// - contractCost  "Was kostet mich Netflix im Jahr?": one contract a year, or all of them
// - priceRises    "Welche Abos sind teurer geworden?": the price changes of Verträge & Abos
// - salary        "Wann kommt das Gehalt?": the next expected salary of the regular payments
// - owed          "Wie viel schuldet mir Lea noch?": Aufteilen's open requests (lib/split-requests.ts)
// - goal          "Wie weit bin ich beim Urlaubsziel?": Sparziele and their progress
// - budgetLeft, budgetsOver   the Monatsbudgets this month (lib/ask-budgets.ts)
// - cancelBy, renewal     the days to cancel contracts by (lib/ask-contracts.ts)
//
// factOf reads the question by rules (lib/ask-intents.ts intentOf asks it
// before the bookings); the pickers below choose the figures from what the
// app holds. A question about the bookings ("Wie viel ging an Netflix?",
// "Netflix pro Monat", "Wann kam das letzte Gehalt?") is none of these.
//
// Pure: no path aliases, `.ts` on sibling imports.

import { groupKindOf } from './account-overview.ts';
import { budgetIntentOf, type BudgetIntent } from './ask-budgets.ts';
import { contractIntentOf, type ContractIntent } from './ask-contracts.ts';
import type { SerializedAccount } from './fints-types';
import { categoryFromQuestion } from './nano-ask.ts';
import { seriesTitle, type RecurringSeries } from './recurring.ts';
import type { SavingsGoal } from './savings-goal.ts';

export type FactIntent =
  | { kind: 'balance' }
  /** day: the yyyy-mm-dd whose balance at its end is asked for, before today; a month's last day for a month. */
  | { kind: 'balanceAt'; day: string }
  | { kind: 'monthEnd' }
  /** name: the contract asked about, folded; null for all of them. */
  | { kind: 'contractCost'; name: string | null }
  | { kind: 'priceRises' }
  | { kind: 'salary' }
  /** name: the person, folded; null for "Wer schuldet mir noch Geld?". */
  | { kind: 'owed'; name: string | null }
  /** name: the goal, folded ("urlaub" for "Urlaubsziel"); null for every goal. */
  | { kind: 'goal'; name: string | null }
  | BudgetIntent
  | ContractIntent;

export const FACT_KINDS = [
  'balance', 'balanceAt', 'monthEnd', 'contractCost', 'priceRises', 'salary', 'owed', 'goal', 'budgetLeft', 'budgetsOver', 'cancelBy', 'renewal',
] as const;

/** Whether an intent is one of these (and FactAnswers says it). */
export function isFact<I extends { kind: string }>(intent: I): intent is Extract<I, FactIntent> {
  return (FACT_KINDS as readonly string[]).includes(intent.kind);
}

const fold = (s: string) => ` ${s.toLocaleLowerCase('de').replace(/[?!.,;:„“"'()]/g, ' ').replace(/\s+/g, ' ').trim()} `;

// i18n-data-start — the words people use, German and English
const MONTH_END = / (?:monatsende|monatsletzten|ende (?:des|diese[ns]) monats|end of (?:the |this )?month|month end|months end) /;
const MONTH_END_ASK = / (?:reicht|reichts|reicht's|bleibt|übrig|uebrig|kontostand|stand|ha(?:b|be|ben) ich|komme? ich|left|enough|last|make it|have|balance|be) /;
const REACHES = / (?:reicht|reichts|reicht's) (?:\S+ ){0,4}(?:bis|noch|zum|aus) | bis zum (?:nächsten |naechsten )?(?:gehalt|lohn) | (?:prognose|vorhersage|forecast) /;
const SPENT = / (?:ausgegeben|bezahlt|gezahlt|überwiesen|ueberwiesen|bekommen|spent|paid|received) /;
/** Spending or eating out at a place: "Wo war ich am Reiseziel essen?" is about the bookings there. */
const SPENT_AT = / (?:ausgeben|gekostet|spend|essen|gegessen|eat|ate|eaten) /;
const BALANCE_WORD = / (?:kontostand|kontostände|kontostaende|gesamtsaldo|saldo|salden|guthaben|vermögen|vermoegen|balances?|net worth) /;
const ON_ACCOUNT = /(?:auf|in|on) (?:dem|meinem|meinen|den|allen|alle|my|all my|the) (?:konto|konten|girokonto|sparkonto|accounts?)/;
const HAVE_MONEY = new RegExp(
  '(?:^| )(?:wie ?viel|was) (?:geld )?(?:ha(?:b|be) ich|liegt|ist)(?: (?:noch|gerade|jetzt|aktuell|insgesamt|überhaupt|eigentlich|denn|so|zurzeit|zur zeit|im moment|'
  + ON_ACCOUNT.source + '))* $'
  + '|(?:^| )how much (?:money )?(?:do i have|have i got|is (?:in|on) my accounts?)(?: (?:left|now|right now|in total|altogether|on my accounts?|in my accounts?))* $',
);
const NEEDS_MONEY_WORD = / (?:geld|money|konto|konten|accounts?) /;
const PRICE_UP = / (?:teurer|preiserh(?:ö|oe)hung\w*|preis\w* (?:\S+ ){0,2}(?:gestiegen|erh(?:ö|oe)ht|hoch(?:gegangen)?)|(?:erh(?:ö|oe)ht|gestiegen) (?:\S+ ){0,2}preis\w*|more expensive|price (?:increase|rise|hike|change)s?|prices? (?:went|gone|go|have gone) up|got dearer) /;
const PRICE_ASK = /^ (?:welche\w*|was|wo|wer|hat|haben|hatte|gibt es|gab es|sind|ist|which|what|did|have|has|had|any|are|is|show|zeig\w*|list\w*) /;
const CONTRACT_WORD = / (?:abos?|abonnements?|vertr(?:ä|ae)ge?n?|vertrag|fixkosten|subscriptions?|contracts?) /;
const SALARY = / (?:gehalt|gehalts|lohn|gehaltseingang|rente|salary|paycheck|payday|pay day|wages) /;
const SALARY_NEXT = / (?:kommt|kommen|nächste[snmr]?|naechste[snmr]?|gibt'?s|gibt es|wann ist|kriege?|krieg ich|bekomme? ich|überwiesen wird|next|come|comes|coming|due|arrive|arrives) /;
const GET_PAID = / (?:when do i get paid|when will i get paid|wann werde ich bezahlt) /;
const SALARY_PAST = / (?:kam|kamen|letzte[snmr]?|zuletzt|vorige[snmr]?|bekommen|gekommen|gezahlt|last|came|did|was|got|paid|im (?:januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|jahr)|in (?:january|february|march|april|may|june|july|august|september|october|november|december)|diese[nms]? jahr|this year) /;
const WHEN = /^ (?:wann|when|und wann|an welchem tag|which day|what day) | wann | when /;
const OWE = / (?:schuldet|schulden|owes?|owing) /;
const GOAL = /(?: \S*ziel(?:e|s|en)? | (?:savings? )?goals? )/;
const GOAL_ASK = / (?:wie weit|wie viel|wie nah|was fehlt|fehlt|stand|stehe? ich|bin ich|erreicht|geschafft|how far|how close|how much|progress|left|reached|am i|where|wo) /;
const YEAR_RATE = / (?:im|pro|per|a|each|every|in einem|in a) (?:jahr|year)(?! \d)| j(?:ä|ae)hrlich | yearly | annually | per annum /;
const COST_VERB = / (?:kostet|kosten|zahle|zahl|bezahle|zahlen|gebe? ich (?:\S+ ){0,4}aus|cost|costs|pay|spend) /;
/** Words around a name that are no part of it. */
const FILLER = new Set((
  'was wie viel viele kostet kosten zahle zahl bezahle zahlen gebe geb ich aus mich mir uns im pro per a an each every jahr jahre year years '
  + 'jährlich jaehrlich yearly annually annum in einem für fuer das die der den dem des ein eine einen mein meine meinen meinem meiner my the '
  + 'how much does do did cost costs me i pay spend for what insgesamt eigentlich gerade aktuell so denn total is it bei beim von '
  + 'noch geld money mal überhaupt ueberhaupt zurzeit derzeit on to at').split(' '));
const NO_PERSON = new Set('wer who mir me jemand anyone someone somebody anybody noch irgendwer niemand'.split(' '));
/** A balance in the past: "Kontostand", "Guthaben", "Wie viel Geld hatte ich" ("Saldo" may be a month's net, left to the bookings). */
const BALANCE_AT_WORD = / (?:kontostand|kontostände|kontostaende|guthaben|balances?) /;
const HAD_MONEY = / (?:wie ?viel|was) (?:geld )?(?:hatte ich|war (?:auf|in) (?:dem|meinem|meinen|den|allen) (?:konto|konten|girokonto)|lag (?:auf|in) )| how much (?:money )?(?:did i have|had i|was (?:in|on) my accounts?) /;
const MONTH_WORDS: Record<string, number> = {
  januar: 1, jänner: 1, january: 1, februar: 2, february: 2, märz: 3, maerz: 3, march: 3, april: 4, mai: 5, may: 5, juni: 6, june: 6,
  juli: 7, july: 7, august: 8, september: 9, oktober: 10, october: 10, november: 11, dezember: 12, december: 12,
};
/** Written short, only next to a day: "1. Okt", "Oct 1st". */
const MONTH_SHORT: Record<string, number> = { jan: 1, feb: 2, mär: 3, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, okt: 10, oct: 10, nov: 11, dez: 12, dec: 12 };
const MONTH_ALT = Object.keys(MONTH_WORDS).join('|');
const MONTH_ANY = `${MONTH_ALT}|${Object.keys(MONTH_SHORT).join('|')}`;
const AT_NUMERIC = / (\d{1,2})\.(\d{1,2})(?:\.(\d{4}|\d{2})?)?(?=[ .])| (\d{4})-(\d{2})-(\d{2}) /;
const AT_DAY_MONTH = new RegExp(` (\\d{1,2})(?:\\.|st|nd|rd|th)? (?:of )?(${MONTH_ANY})\\.?(?: (\\d{4}))?(?= )`);
const AT_MONTH_DAY = new RegExp(` (${MONTH_ANY})\\.? (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?(?= )`);
const AT_START = new RegExp(` (?:anfang|beginning of|start of|the start of)(?: des| dem)? (${MONTH_ALT})(?: (\\d{4}))? `);
const AT_END = new RegExp(` (?:ende|end of|the end of)(?: des| dem)? (${MONTH_ALT})(?: (\\d{4}))? `);
const AT_MONTH = new RegExp(` (${MONTH_ALT})(?: (\\d{4}))?(?= )`, 'g');
/** English "may" is a month only after these ("in May", "end of May"), or with a day or a year: "May I see my balance?" names none. */
const BEFORE_MAY = / (?:in|im|of|during|until|bis|since|seit|anfang|ende|beginning of|end of|start of) $/;
/** A month of the year before: "im November letzten Jahres", "November last year", "letztes Jahr im November". */
const MONTH_LAST_YEAR = new RegExp(
  ` (?:${MONTH_ANY}|\\d{1,2}\\.\\d{1,2})\\.? (?:des )?(?:letzten|vorigen|vergangenen) jahres `
  + `| (?:${MONTH_ANY}|\\d{1,2}\\.\\d{1,2})\\.? (?:letztes jahr|im vorjahr|vorjahr|(?:of )?last year) `
  + `| (?:letztes jahr|letzten jahres|im vorjahr|last year) (?:in|im|am|on|ende|anfang|end of|beginning of|start of) `,
);
const AT_LAST_MONTH = / (?:(?:ende )?(?:des )?(?:letzten|vorigen|vergangenen) monats|(?:letzten|vorigen|vergangenen) monat|vormonat|(?:the )?end of last month|last month) /;
const AT_LAST_YEAR = / (?:(?:ende )?(?:des )?(?:letzten|vorigen|vergangenen) jahres|letztes jahr|vorjahr|jahresende|silvester|(?:the )?end of last year|last year) /;
const AT_YEAR_END = / (?:ende|end of) ((?:19|20)\d{2}) /;
const AT_YESTERDAY = / (?:vorgestern|day before yesterday) | (?:gestern|yesterday) /;
const AT_AGO = / vor (\d+|einer|einem|zwei|drei|vier) (tag|tagen|woche|wochen|monat|monaten) | (\d+|a|one|two|three|four) (days?|weeks?|months?) ago /;
const COUNT_WORDS: Record<string, number> = { einer: 1, einem: 1, a: 1, one: 1, zwei: 2, two: 2, drei: 3, three: 3, vier: 4, four: 4 };
const GOAL_FILLER = new Set('spar spare sparen gespart mein meine meinem meinen dem den das die der beim bei mit zum zur für fuer my the a savings saving with for on to of our'.split(' '));
// i18n-data-end

/** The words of a folded question that name something, the filler taken out. */
function nameWords(q: string, filler: Set<string> = FILLER): string | null {
  const words = q.trim().split(' ').filter((w) => w && !filler.has(w) && !/^\d+$/.test(w));
  return words.length && words.length <= 3 ? words.join(' ') : null;
}

/** The person "schuldet mir" is about, folded; null for none or "wer". */
function personOf(q: string): string | null {
  const m = / schulde(?:t|n) mir (\S+)/.exec(q) ?? / schulde(?:t|n) (\S+) mir /.exec(q)
    ?? / (?:does|do|will) (\S+) (?:still )?owe me/.exec(q) ?? / (\S+) (?:still )?owes me/.exec(q);
  const name = m?.[1] ?? null;
  return name && !NO_PERSON.has(name) && !FILLER.has(name) ? name : null;
}

/** The goal a question names: "urlaub" for "Urlaubsziel", "japan" for "das Ziel Japan"; null for Sparziele as a whole. */
function goalOf(q: string): string | null {
  const compound = / (\S+?)ziel(?:e|s|en)? /.exec(q);
  // "Urlaubsziel": the goal is "urlaub", without the joining s.
  if (compound && compound[1] && !GOAL_FILLER.has(compound[1])) return compound[1].length > 4 ? compound[1].replace(/s$/, '') : compound[1];
  const after = / ziel(?:e|s)? (?:für |fuer |fürs )?(?:den |das |die |meinen |mein )?(\S+)/.exec(q);
  if (after && !GOAL_FILLER.has(after[1]) && !FILLER.has(after[1]) && !GOAL_ASK.test(` ${after[1]} `)) return after[1];
  const before = / (\S+) goal /.exec(q);
  if (before && !GOAL_FILLER.has(before[1]) && !FILLER.has(before[1])) return before[1];
  return null;
}

const pad = (n: number) => String(n).padStart(2, '0');
const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** `day` moved by `n` days (yyyy-mm-dd). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Today on this device, yyyy-mm-dd. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The day a question about a past balance names, and whether it named the
 * end of a month: "am 1. Oktober", "1.10.", "October 1st", "Anfang Oktober"
 * (the day before), "Ende September", "im August" (its last day), "letzten
 * Monat", "Ende letzten Jahres", "im November letzten Jahres", "gestern",
 * "vor zwei Wochen". A day or month without its year is the last one up to
 * today. Null for none; day null for a day that does not exist ("29.2." in
 * 2026, "31. November").
 */
export function balanceDayOf(question: string, today: string): { day: string; end: boolean } | { day: null; end: false } | null {
  const s = ` ${question.toLocaleLowerCase('de').replace(/[?!,;:„“"'()]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const [ty, tm] = today.split('-').map(Number);
  const monthOf = (w: string) => MONTH_WORDS[w] ?? MONTH_SHORT[w];
  const yearOf = (y: string | undefined) => (!y ? null : y.length === 2 ? 2000 + Number(y) : Number(y));
  const dayIn = (d: number, m: number, y: number | null): string | null => {
    if (m < 1 || m > 12) return null;
    const year = y ?? (`${ty}-${pad(m)}-${pad(d)}` > today ? ty - 1 : ty);
    return d >= 1 && d <= lastDayOf(year, m) ? `${year}-${pad(m)}-${pad(d)}` : null;
  };
  const monthEnd = (m: number, y: number | null) => {
    const year = y ?? (m > tm ? ty - 1 : ty);
    return `${year}-${pad(m)}-${pad(lastDayOf(year, m))}`;
  };
  // "im November letzten Jahres": that month of the year before, not the last day of last year.
  const ly = MONTH_LAST_YEAR.test(s) ? ty - 1 : null;
  const none = { day: null, end: false } as const;
  let m: RegExpExecArray | null;
  if ((m = AT_NUMERIC.exec(s))) {
    const day = m[1] ? dayIn(Number(m[1]), Number(m[2]), yearOf(m[3]) ?? ly) : dayIn(Number(m[6]), Number(m[5]), Number(m[4]));
    return day ? { day, end: false } : none;
  }
  if ((m = AT_DAY_MONTH.exec(s))) {
    const day = dayIn(Number(m[1]), monthOf(m[2]), yearOf(m[3]) ?? ly);
    return day ? { day, end: false } : none;
  }
  if ((m = AT_MONTH_DAY.exec(s))) {
    const day = dayIn(Number(m[2]), monthOf(m[1]), yearOf(m[3]) ?? ly);
    return day ? { day, end: false } : none;
  }
  if ((m = AT_START.exec(s))) {
    const month = MONTH_WORDS[m[1]];
    const y = yearOf(m[2]) ?? ly ?? (month > tm ? ty - 1 : ty);
    return { day: addDays(`${y}-${pad(month)}-01`, -1), end: false };
  }
  if ((m = AT_END.exec(s))) return { day: monthEnd(MONTH_WORDS[m[1]], yearOf(m[2]) ?? ly), end: true };
  const month = [...s.matchAll(AT_MONTH)].find((x) => x[1] !== 'may' || x[2] || BEFORE_MAY.test(s.slice(0, (x.index ?? 0) + 1)));
  if (month && ly) return { day: monthEnd(MONTH_WORDS[month[1]], ly), end: false };
  if (AT_LAST_MONTH.test(s)) return { day: addDays(`${ty}-${pad(tm)}-01`, -1), end: true };
  if ((m = AT_YEAR_END.exec(s))) return { day: `${m[1]}-12-31`, end: true };
  if (AT_LAST_YEAR.test(s)) return { day: `${ty - 1}-12-31`, end: true };
  if ((m = AT_YESTERDAY.exec(s))) return { day: addDays(today, / (?:vorgestern|day before yesterday) /.test(m[0]) ? -2 : -1), end: false };
  if ((m = AT_AGO.exec(s))) {
    const n = Number(m[1] ?? m[3]) || COUNT_WORDS[m[1] ?? m[3]] || 1;
    const unit = (m[2] ?? m[4]).replace(/s$/, '');
    if (/^(?:tag|tagen|day)$/.test(unit)) return { day: addDays(today, -n), end: false };
    if (/^(?:woche|wochen|week)$/.test(unit)) return { day: addDays(today, -7 * n), end: false };
    const total = ty * 12 + (tm - 1) - n;
    const y = Math.floor(total / 12);
    const mo = (total % 12) + 1;
    return { day: `${y}-${pad(mo)}-${pad(Math.min(Number(today.slice(8)), lastDayOf(y, mo)))}`, end: false };
  }
  // "im November" of this November is the balance now, not its forecast.
  if (month) return { day: monthEnd(MONTH_WORDS[month[1]], yearOf(month[2])), end: false };
  return null;
}

/**
 * What a message asks of the app's own figures; null for anything else (a
 * question about the bookings, mostly). `contracts`: the names of the live
 * contracts (Verträge & Abos, as shown and as booked). "Was kostet mich
 * Netflix im Jahr?" is a contract's year only when Netflix is one of them;
 * "Was zahle ich im Jahr bei Rewe?" is a sum of the bookings. `today`: for
 * a past balance's day ("Kontostand im August").
 */
export function factOf(question: string, contracts: readonly string[] = [], today: string = localToday()): FactIntent | null {
  const q = fold(question);

  if (OWE.test(q)) return { kind: 'owed', name: personOf(q) };
  // "Wie viel habe ich für mein Reiseziel ausgegeben?", "Wo war ich am Reiseziel essen?" ask about the bookings.
  if (GOAL.test(q) && !SPENT.test(q) && !SPENT_AT.test(q) && (GOAL_ASK.test(q) || / (?:sparziel\w*|savings goals?) /.test(q))) return { kind: 'goal', name: goalOf(q) };

  // "Was ist noch im Lebensmittel-Budget?", "Wo bin ich über dem Budget?"
  const budget = budgetIntentOf(question);
  if (budget) return budget;
  // "Was kann ich bis Ende des Monats noch kündigen?", "Wann verlängert sich mein Handyvertrag?"
  const contract = contractIntentOf(question, today, contracts);
  if (contract) return contract;

  // "Wann kommt das Gehalt?", never "Wann kam das letzte Gehalt?" or "Gehalt im Oktober".
  if (GET_PAID.test(q) || SALARY.test(q) && SALARY_NEXT.test(q) && WHEN.test(q) && !SALARY_PAST.test(q)) return { kind: 'salary' };

  // "Kontostand am 1. Oktober", "Wie viel Geld hatte ich im August?": a past day's balance. Today's or
  // a day to come is the balance as it is, or the month-end forecast for this month's end.
  if ((BALANCE_AT_WORD.test(q) || HAD_MONEY.test(q)) && !SPENT.test(q)) {
    const at = balanceDayOf(question, today);
    // A day that does not exist ("am 29.2." in 2026) is no balance of today's: the bookings or a plain line answer.
    if (at && at.day === null) return null;
    if (at && at.day < today) return { kind: 'balanceAt', day: at.day };
    if (at) return at.end && at.day > today ? { kind: 'monthEnd' } : { kind: 'balance' };
  }

  if (!SPENT.test(q) && (MONTH_END.test(q) && (MONTH_END_ASK.test(q) || BALANCE_WORD.test(q)) || REACHES.test(q))) return { kind: 'monthEnd' };

  if (PRICE_UP.test(q) && (CONTRACT_WORD.test(q) || PRICE_ASK.test(q) || / preiserh(?:ö|oe)hung/.test(q))) return { kind: 'priceRises' };

  // "Was kostet mich Netflix im Jahr?": a contract's year. "Was kostet mich Wohnen im Jahr?" names a category: the bookings answer it.
  if (YEAR_RATE.test(q) && COST_VERB.test(q)) {
    if (CONTRACT_WORD.test(q)) return { kind: 'contractCost', name: null };
    const name = nameWords(q);
    if (name && !categoryFromQuestion(question) && contracts.some((c) => sameName(c, name))) return { kind: 'contractCost', name };
  }

  if (!SPENT.test(q) && (BALANCE_WORD.test(q) || HAVE_MONEY.test(q) && NEEDS_MONEY_WORD.test(q))) return { kind: 'balance' };
  return null;
}

// ---------------------------------------------------------------------------
// The figures
// ---------------------------------------------------------------------------

/** A name as letters and digits only, for comparing: "Netflix.com" and "netflix" are one. */
const squash = (s: string) => s.toLocaleLowerCase('de').normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');

/** Whether a name the user typed is the one the app shows (either holds the other). */
export function sameName(shown: string, asked: string): boolean {
  const a = squash(shown);
  const b = squash(asked);
  if (!a || b.length < 2) return false;
  return a.includes(b) || (a.length >= 4 && b.includes(a));
}

/** The live contracts with this name, the dearest a year first. */
export function contractsNamed(series: readonly RecurringSeries[], name: string): RecurringSeries[] {
  return series
    .filter((s) => s.kind === 'expense' && !s.ended && (sameName(seriesTitle(s), name) || sameName(s.name, name)))
    .sort((a, b) => Math.abs(b.yearlyAmount) - Math.abs(a.yearlyAmount));
}

/** The live contracts whose price went up within the last year, the newest change first. */
export function priceRises(series: readonly RecurringSeries[], today: string): RecurringSeries[] {
  return series
    .filter((s) => s.kind === 'expense' && !s.ended && s.priceChange && s.priceChange.delta > 0 && s.priceChange.since <= today)
    .sort((a, b) => (a.priceChange!.since < b.priceChange!.since ? 1 : a.priceChange!.since > b.priceChange!.since ? -1 : 0));
}

/** The salary to come: a live regular income, one Girovo files as Einnahmen first, then the largest a month. */
export function nextSalary(series: readonly RecurringSeries[]): RecurringSeries | null {
  const live = series.filter((s) => s.kind === 'income' && !s.ended && !!s.nextDate);
  live.sort((a, b) => Number(b.category === 'income') - Number(a.category === 'income') || Math.abs(b.monthlyAmount) - Math.abs(a.monthlyAmount));
  return live[0] ?? null;
}

/**
 * How the salary's next day is said: late (Verträge & Abos count it overdue),
 * due (its day has passed, still within the few days' grace, so it comes soon),
 * today, or ahead.
 */
export function salaryWhen(s: Pick<RecurringSeries, 'nextDate' | 'overdue'>, today: string): 'late' | 'due' | 'today' | 'ahead' {
  if (s.overdue) return 'late';
  if (s.nextDate < today) return 'due';
  return s.nextDate === today ? 'today' : 'ahead';
}

/** How many contracts the yearly total of Verträge & Abos adds up: the live expenses in its currency. */
export function contractsYearCount(expense: readonly Pick<RecurringSeries, 'kind' | 'ended' | 'currency'>[], currency: string): number {
  return expense.filter((s) => s.kind === 'expense' && !s.ended && s.currency === currency).length;
}

/** The goals a question is about: the ones with that name, else all; `matched` says whether the name found one. */
export function goalsNamed(goals: readonly SavingsGoal[], name: string | null): { goals: SavingsGoal[]; matched: boolean } {
  if (!name) return { goals: [...goals], matched: true };
  const hit = goals.filter((g) => sameName(g.name, name));
  return hit.length ? { goals: hit, matched: true } : { goals: [...goals], matched: false };
}

/** The account a month-end forecast is about: the open one where it is a Girokonto, else the first Girokonto. */
export function forecastAccount<A extends Pick<SerializedAccount, 'accountType' | 'canStatements' | 'canPortfolio'>>(
  accounts: readonly A[], active: A | null,
): A | null {
  if (active && groupKindOf(active) === 'giro') return active;
  return accounts.find((a) => groupKindOf(a) === 'giro') ?? null;
}

/** The newest money in from someone, by the name the lists show; null when none came. */
export function lastFrom<T>(
  txs: readonly T[], name: string, of: (tx: T) => { amount: number; day: string; payee: string },
): T | null {
  let best: T | null = null;
  let bestDay = '';
  for (const tx of txs) {
    const { amount, day, payee } = of(tx);
    if (amount <= 0 || !sameName(payee, name)) continue;
    if (day > bestDay) {
      best = tx;
      bestDay = day;
    }
  }
  return best;
}

/**
 * One account's figure for balanceOn: its balance in cents and the day it
 * stands for, how far its loaded Umsätze reach (first and last day), and
 * those Umsätze (booked, by the bank's day, in cents).
 */
export type BalanceBase = {
  cents: number;
  asOf: string;
  from: string | null;
  to: string | null;
  bookings: readonly { day: string; cents: number }[];
};

/**
 * The balance at the end of `day`: the one given, less every booking after
 * that day up to the day it stands for. tooEarly when the loaded Umsätze do
 * not reach back to the day after; unknown when they stop before the
 * balance's day (the bookings between are not known). For a day after the
 * balance's own (an older kept balance), the bookings up to that day are
 * added, and it is unknown when the Umsätze do not reach that day.
 */
export function balanceOn(base: BalanceBase, day: string): { state: 'known'; cents: number } | { state: 'tooEarly' | 'unknown' } {
  if (day === base.asOf) return { state: 'known', cents: base.cents };
  if (day > base.asOf) {
    if (!base.to || base.to < day) return { state: 'unknown' };
    let cents = base.cents;
    for (const b of base.bookings) if (b.day > base.asOf && b.day <= day) cents += b.cents;
    return { state: 'known', cents };
  }
  if (!base.from || addDays(day, 1) < base.from) return { state: 'tooEarly' };
  if (base.to && base.to < base.asOf) return { state: 'unknown' };
  let cents = base.cents;
  for (const b of base.bookings) if (b.day > day && b.day <= base.asOf) cents -= b.cents;
  return { state: 'known', cents };
}

/** A folded name as it is said: "lea" as „Lea“'s first letter up. */
export const nameCase = (name: string): string => name.replace(/(^|\s)(\p{Ll})/gu, (_m, space: string, c: string) => space + c.toLocaleUpperCase('de'));
