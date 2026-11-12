// Girovo AI: Gemma plans the question, the checks keep it honest
// (components/insights/AskThread.tsx, scripts/eval-fragen).
//
// Gemma reads the whole message (and, for a follow-up, the question before it
// and how it was read) and answers one small JSON object: what kind of answer,
// money out or in, a category, a payee as the message writes it, a period, a
// period to compare with. checkPlan turns that into an AskQuery the way a
// phone treats Gemini Nano's reading: what the message says in so many words
// is the rules' (the kind of answer, a category word, a period, which the
// rules work out exactly), Gemma fills in what they cannot read (a category in
// other words, a payee, a period said loosely), and what cannot be true goes
// (a category the app does not have, a payee the message does not name). A
// follow-up keeps what it leaves out, as without Gemma (lib/ask-followup.ts).
// The question set (scripts/eval-fragen) showed why: Gemma alone read
// "Netflix pro Monat" as a sum and "Wofür geb ich am meisten aus" as the
// largest booking.
//
// Pure: no path aliases, `.ts` on sibling imports.

import { aboutBookings, continuesFrom, followUp, ordersSomething } from './ask-followup.ts';
import type { CategoryId } from './categories.ts';
import {
  ASKABLE, compareFromQuestion, kindFromQuestion, nameFromPayees, periodFromQuestion, rankByFromQuestion, readQuestion,
  type AskPeriod, type AskQuery, type NanoReading,
} from './nano-ask.ts';

export type PlanContext = {
  question: string;
  today: string;
  /** The user's own categories. */
  own: readonly { id: string; name: string }[];
  /** The payees of the loaded bookings, as the lists name them. */
  payees: readonly string[];
  /** The question before this one in the conversation, and what it was read as. */
  prev: { question: string; query: AskQuery } | null;
};

export type PlanResult = { plan: AskQuery } | { offTopic: true } | null;

// i18n-data-start — the model's instructions; German and English questions alike
const CATEGORY_HELP: Record<string, string> = {
  income: 'Gehalt, Lohn, Einnahmen, Rente, Erstattungen',
  housing: 'Miete, Nebenkosten, Strom, Gas, Wohnen & Energie',
  groceries: 'Supermarkt, Lebensmittel, Drogerie (Rewe, Edeka, Aldi, Lidl, dm)',
  mobility: 'Tanken, Bahn, ÖPNV, Auto, Taxi, Parken',
  shopping: 'Einkaufen online und im Laden, Kleidung, Elektronik (Amazon, Zalando)',
  dining: 'Essen gehen, Restaurants, Cafés, Imbiss, Lieferdienste, Bars',
  leisure: 'Freizeit, Sport, Kino, Spiele, Hobbys, Reisen',
  media: 'Abos und Medien, Streaming, Handy, Internet (Netflix, Spotify, Telekom)',
  health: 'Arzt, Apotheke, Gesundheit',
  insurance: 'Versicherungen',
  taxes: 'Steuern, Abgaben, Rundfunkbeitrag',
  cash: 'Bargeld, Geldautomat',
  fees: 'Bankgebühren, Kontoführung, Zinsen',
  savings: 'Sparen, Anlegen, Depot, Umbuchungen aufs Sparkonto',
};

/** The planner's instructions: the JSON it answers, with the date it counts from. */
export function plannerSystem(today: string, own: readonly { id: string; name: string }[] = []): string {
  const cats = [...ASKABLE.map((id) => `${id}: ${CATEGORY_HELP[id] ?? id}`), ...own.map((c) => `${c.id}: ${c.name}`)].join('\n');
  return [
    'Du liest Fragen zu den eigenen Kontoumsätzen und antwortest NUR mit einem JSON-Objekt, ohne Text davor oder danach.',
    `Heute ist ${today}.`,
    'Felder:',
    '"about": "bookings" wenn es um Umsätze, Ausgaben, Einnahmen, Händler oder Zeiträume geht, sonst "other" (Begrüßung, Smalltalk, anderes).',
    '"kind": "sum" (wie viel), "count" (wie oft), "average" (im Schnitt, pro Monat), "largest" (größte Ausgabe oder größter Eingang), "last" (wann zuletzt), "places" (wo, bei wem, welche Läden oder Restaurants: eine Liste der Empfänger), "categories" (wofür, welche Kategorien), "compare" (mehr oder weniger als ein anderer Zeitraum).',
    '"direction": "out" (ausgegeben, bezahlt), "in" (bekommen, Einnahmen, Gehalt), "both".',
    '"category": eine der Kategorien unten, oder null.',
    '"payee": ein Händler oder eine Person genau so, wie die Frage sie schreibt, oder null. Eine Kategorie ist kein payee.',
    '"period": {"type": "all"|"today"|"yesterday"|"this_week"|"last_week"|"this_month"|"last_month"|"this_year"|"last_year"|"month"|"year"|"since"|"last_days"|"last_months", "month": "YYYY-MM" bei month oder since, "year": Jahr bei year, "n": Anzahl bei last_days oder last_months}.',
    '"compare_to": ein period-Objekt bei compare, sonst null.',
    'Steht eine vorherige Frage dabei und die neue führt sie fort ("Und …", "Pro Monat", "Und wo?"), übernimm, was die neue nicht selbst sagt.',
    'Kategorien:',
    cats,
    'Beispiele:',
    'Frage: Wo war ich im August essen? -> {"about":"bookings","kind":"places","direction":"out","category":"dining","payee":null,"period":{"type":"month","month":"2026-08"},"compare_to":null}',
    'Frage: Wie viel ging letzten Monat an Rewe? -> {"about":"bookings","kind":"sum","direction":"out","category":null,"payee":"Rewe","period":{"type":"last_month"},"compare_to":null}',
    'Frage: Größte Ausgabe dieses Jahr -> {"about":"bookings","kind":"largest","direction":"out","category":null,"payee":null,"period":{"type":"this_year"},"compare_to":null}',
    'Frage: Hallo -> {"about":"other"}',
  ].join('\n');
}
// i18n-data-end

const describe = (q: AskQuery) => JSON.stringify({
  kind: q.kind === 'rank' ? (q.rank?.by === 'payee' ? 'places' : 'categories') : q.kind,
  direction: q.dir === 'all' ? 'both' : q.dir, category: q.category, payee: q.search, period: q.period,
});

/** What Gemma reads: the question, and for a follow-up the one before it and how it was read. */
export function plannerInput(ctx: PlanContext): string {
  const lines: string[] = [];
  if (ctx.prev && continuesFrom(ctx.question)) {
    lines.push(`Vorherige Frage: ${ctx.prev.question}`); // i18n-data
    lines.push(`Verstanden als: ${describe(ctx.prev.query)}`); // i18n-data
  }
  lines.push(`Frage: ${ctx.question.trim()}`); // i18n-data
  return lines.join('\n');
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const dayOf = (today: string, add: number) => {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + add);
  return isoDay(d);
};

/** Gemma's period object as an AskPeriod; null when it does not parse. */
export function periodOf(raw: unknown, today: string): AskPeriod | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as { type?: unknown; month?: unknown; year?: unknown; n?: unknown };
  const month = typeof p.month === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(p.month) ? p.month : null;
  const n = typeof p.n === 'number' && Number.isInteger(p.n) && p.n > 0 && p.n <= 3650 ? p.n : null;
  const year = typeof p.year === 'number' && p.year >= 1990 && p.year <= 2100 ? p.year : null;
  // Monday as a week's first day, as in Germany.
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  switch (p.type) {
    case 'all': return { kind: 'all' };
    case 'today': return { kind: 'today' };
    case 'yesterday': { const y = dayOf(today, -1); return { kind: 'range', from: y, to: y }; }
    case 'this_week': return { kind: 'range', from: dayOf(today, -weekday), to: today };
    case 'last_week': return { kind: 'range', from: dayOf(today, -weekday - 7), to: dayOf(today, -weekday - 1) };
    case 'this_month': return { kind: 'thisMonth' };
    case 'last_month': return { kind: 'lastMonth' };
    case 'this_year': return { kind: 'thisYear' };
    case 'last_year': return { kind: 'lastYear' };
    case 'month': return month && month <= today.slice(0, 7) ? { kind: 'month', month } : null;
    case 'since': return month && month <= today.slice(0, 7) ? { kind: 'since', month } : null;
    case 'year': return year && year <= Number(today.slice(0, 4)) ? { kind: 'year', year } : null;
    case 'last_days': return n ? { kind: 'days', days: n } : null;
    case 'last_months': return n && n <= 120 ? { kind: 'months', months: n } : null;
    default: return null;
  }
}

const fold = (s: string) => s.toLocaleLowerCase('de').normalize('NFKD').replace(/\p{M}/gu, '');
// i18n-data-next-line
const TIME_WORD = /\b(?:diese[nmrs]?|letzte[nmrs]?|vorige[nmrs]?|ganze[nms]?|jahr|monat|woche|heute|gestern|this|last|whole|year|month|week|today|yesterday)\b/;

/**
 * Gemma's answer, checked: an AskQuery, a note that the message is not about
 * the bookings, or null (no JSON, nothing usable: the rules read it instead).
 */
export function checkPlan(raw: string | null, ctx: PlanContext): PlanResult {
  if (!raw) return null;
  const json = /\{[\s\S]*\}/.exec(raw)?.[0];
  if (!json) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
  const { question, today, own, payees, prev } = ctx;
  const continues = !!prev && continuesFrom(question);
  const q = fold(question);

  const known = new Set<string>([...ASKABLE, ...own.map((c) => c.id)]);
  const category = typeof o.category === 'string' && known.has(o.category) ? o.category as CategoryId : null;
  // A payee stands in the message (or, for a follow-up, was the question before's); else it goes.
  let search: string | null = null;
  if (typeof o.payee === 'string' && o.payee.trim()) {
    const p = o.payee.trim().slice(0, 60);
    if (q.includes(fold(p))) search = nameFromPayees(question, payees) ?? p;
    else if (continues && prev!.query.search && fold(prev!.query.search) === fold(p)) search = prev!.query.search;
  }
  // Gemma's "both" is mostly a guess: the rules' direction or money out unless the message says both.
  const dir = o.direction === 'in' ? 'in' as const : o.direction === 'out' ? 'out' as const : null;
  const reading: NanoReading = { dir, category, search };

  // An order ("Überweise 500 Euro an Lea") is never read as a question.
  if (ordersSomething(question)) return { offTopic: true };
  // "Not about the bookings" only where the rules find nothing either and the message
  // does not go on from a question before; else the rules read it (null).
  // Gemma's fields stay of use when the rules see the bookings in it ("wann hat mir Oma … überwiesen").
  if (o.about === 'other') {
    if (!continues && !aboutBookings(question, readQuestion(question, null, today, own), null)) return { offTopic: true };
    if (!o.kind) return null;
  }

  // The rules over Gemma's reading, as on a phone; the period Gemma read where the rules found none.
  let read = readQuestion(question, reading, today, own);
  if (!read) return null;
  // A word the rules took for a name ("für restaurnats", "on takeout") that is no payee of
  // the bookings and not Gemma's payee, where Gemma read a category: the category.
  if (read.search && !search && category && category !== 'income' && !nameFromPayees(question, payees)) {
    read = { ...read, search: null, hint: null, category };
  }
  const stated = !!(compareFromQuestion(question, today) || periodFromQuestion(question, today));
  // Gemma's period where the rules found none; for a follow-up only when it has a word for one ("Und dieses").
  const planned = stated || (continues && !TIME_WORD.test(q)) ? null : periodOf(o.period, today);
  let merged: AskQuery = planned ? { ...read, period: planned } : read;
  // A comparison the rules did not see, with both periods: Gemma's ("Sprit 2026 gegen 2025" said loosely).
  const against = periodOf(o.compare_to, today);
  if (o.kind === 'compare' && merged.kind === 'sum' && !kindFromQuestion(question) && planned && against && JSON.stringify(planned) !== JSON.stringify(against)) {
    merged = { ...merged, kind: 'compare', against };
  }
  // A ranking of categories the rules did not see ("Wofür die meisten Buchungen" said otherwise).
  if (o.kind === 'categories' && merged.kind === 'sum' && !kindFromQuestion(question) && /\b(?:wofur|wofuer|kategorie\w*|categor\w*)\b/.test(q)) {
    merged = { ...merged, kind: 'rank', category: null, rank: { by: 'category', metric: 'sum' } };
  }
  // A list of places keeps the category Gemma read ("Wo tanke ich am meisten" ranks the petrol
  // stations); readQuestion drops a model's category from rankings, where Nano misread it.
  if (merged.kind === 'rank' && merged.rank?.by === 'payee' && !merged.category && !merged.search && category && category !== 'income') {
    merged = { ...merged, category };
  }
  // A ranking whose words name no side: Gemma's places or categories decide it.
  if (merged.kind === 'rank' && merged.rank && !rankByFromQuestion(question) && (o.kind === 'places' || o.kind === 'categories')) {
    merged = { ...merged, rank: { ...merged.rank, by: o.kind === 'places' ? 'payee' : 'category' } };
  }
  return { plan: followUp(prev?.query ?? null, question, merged, today, !!planned) };
}
