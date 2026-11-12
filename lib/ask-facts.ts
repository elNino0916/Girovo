// Girovo AI: questions answered from figures the app already has, not from a
// sum of bookings (components/insights/ask/FactAnswers.tsx says them):
//
// - balance       "Wie viel Geld habe ich?", "Kontostand": every account's balance and the total
// - monthEnd      "Reicht es bis Monatsende?": the month-end forecast (lib/forecast.ts)
// - contractCost  "Was kostet mich Netflix im Jahr?": one contract a year, or all of them
// - priceRises    "Welche Abos sind teurer geworden?": the price changes of Verträge & Abos
// - salary        "Wann kommt das Gehalt?": the next expected salary of the regular payments
// - owed          "Wie viel schuldet mir Lea noch?": Aufteilen keeps no record, so what came from her
// - goal          "Wie weit bin ich beim Urlaubsziel?": Sparziele and their progress
//
// factOf reads the question by rules (lib/ask-intents.ts intentOf asks it
// before the bookings); the pickers below choose the figures from what the
// app holds. A question about the bookings ("Wie viel ging an Netflix?",
// "Netflix pro Monat", "Wann kam das letzte Gehalt?") is none of these.
//
// Pure: no path aliases, `.ts` on sibling imports.

import { groupKindOf } from './account-overview.ts';
import type { SerializedAccount } from './fints-types';
import { categoryFromQuestion } from './nano-ask.ts';
import { seriesTitle, type RecurringSeries } from './recurring.ts';
import type { SavingsGoal } from './savings-goal.ts';

export type FactIntent =
  | { kind: 'balance' }
  | { kind: 'monthEnd' }
  /** name: the contract asked about, folded; null for all of them. */
  | { kind: 'contractCost'; name: string | null }
  | { kind: 'priceRises' }
  | { kind: 'salary' }
  /** name: the person, folded; null for "Wer schuldet mir noch Geld?". */
  | { kind: 'owed'; name: string | null }
  /** name: the goal, folded ("urlaub" for "Urlaubsziel"); null for every goal. */
  | { kind: 'goal'; name: string | null };

export const FACT_KINDS = ['balance', 'monthEnd', 'contractCost', 'priceRises', 'salary', 'owed', 'goal'] as const;

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

/**
 * What a message asks of the app's own figures; null for anything else (a
 * question about the bookings, mostly). `contracts`: the names of the live
 * contracts (Verträge & Abos, as shown and as booked). "Was kostet mich
 * Netflix im Jahr?" is a contract's year only when Netflix is one of them;
 * "Was zahle ich im Jahr bei Rewe?" is a sum of the bookings.
 */
export function factOf(question: string, contracts: readonly string[] = []): FactIntent | null {
  const q = fold(question);

  if (OWE.test(q)) return { kind: 'owed', name: personOf(q) };
  // "Wie viel habe ich für mein Reiseziel ausgegeben?", "Wo war ich am Reiseziel essen?" ask about the bookings.
  if (GOAL.test(q) && !SPENT.test(q) && !SPENT_AT.test(q) && (GOAL_ASK.test(q) || / (?:sparziel\w*|savings goals?) /.test(q))) return { kind: 'goal', name: goalOf(q) };

  // "Wann kommt das Gehalt?", never "Wann kam das letzte Gehalt?" or "Gehalt im Oktober".
  if (GET_PAID.test(q) || SALARY.test(q) && SALARY_NEXT.test(q) && WHEN.test(q) && !SALARY_PAST.test(q)) return { kind: 'salary' };

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

/** A folded name as it is said: "lea" as „Lea“'s first letter up. */
export const nameCase = (name: string): string => name.replace(/(^|\s)(\p{Ll})/gu, (_m, space: string, c: string) => space + c.toLocaleUpperCase('de'));
