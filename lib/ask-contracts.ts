// Girovo AI and cancelling contracts: questions about the notice dates of
// Verträge & Abos and the figures they are answered from
// (components/insights/ask/FactAnswers.tsx says them):
//
// - cancelBy  "Was kann ich bis Ende des Monats noch kündigen?", "Welche
//             Verträge kann ich bald kündigen?": the contracts whose last day
//             to cancel falls between today and a day (the end of this month
//             unless the question names one), each with that day
// - renewal   "Wann verlängert sich mein Handyvertrag?", "Bis wann muss ich
//             Spotify kündigen?": that contract's last day to cancel and its
//             next payment
//
// The app knows a contract's last day to cancel only where the user set it
// ("Kündbar bis", vault contractReminders, lib/contract-watch.ts); it reads
// no terms or notice periods from the bank. Where none is set, it says so.
//
// Pure: no path aliases, `.ts` on sibling imports.

import type { ContractReminder } from './contract-watch.ts';
import { categoryFromQuestion } from './nano-ask.ts';
import { seriesTitle, type RecurringSeries } from './recurring.ts';

export type ContractIntent =
  /** until: the last yyyy-mm-dd a deadline may fall on; null for every one to come ("Wann kann ich kündigen?"). */
  | { kind: 'cancelBy'; until: string | null }
  /** name: the contract asked about, folded ("spotify", "handyvertrag"). */
  | { kind: 'renewal'; name: string };

/** "Bald": this many days ahead. */
export const SOON_DAYS = 30;

const fold = (s: string) => ` ${s.toLocaleLowerCase('de').replace(/[?!.,;:„“"'()]/g, ' ').replace(/\s+/g, ' ').trim()} `;

// i18n-data-start — the words people use, German and English
const CANCEL = /k(?:ü|ue)ndig|k(?:ü|ue)ndbar|cancel/;
const RENEW = / (?:verlängert|verlaengert|verlängern|verlaengern|verlängerung|verlaengerung|renew\w*|auto-?renew\w*|(?:läuft|laeuft|laufen) (?:\S+ ){0,3}aus|ausläuft|auslaeuft|endet|enden|ends|end|expires?|expiry) /;
const CONTRACT_WORD = /vertr(?:a|ä|ae)g|abos?\b|abonnement|mitgliedschaft|tarif|subscription|contract|membership|plan\b/;
const LIST_ASK = /^ (?:was|welche\w*|wo|gibt es|which|what|any|is there|are there|show|zeig\w*|list\w*) | (?:was|welche\w*|which|what) /;
const WHEN = / (?:wann|bis wann|when|by when|until when) /;
const SOON = / (?:bald|demnächst|demnaechst|in nächster zeit|in naechster zeit|nächsten wochen|naechsten wochen|kommenden wochen|soon|coming weeks|next few weeks) /;
const END_MONTH = / (?:ende (?:des|diese[ns]) monats|monatsende|ende monat|ende vom monat|end of (?:the |this )?month|this month|diesen monat|in diesem monat) /;
const NEXT_MONTH = / (?:nächste[nr]? monats?|naechste[nr]? monats?|kommende[nr]? monats?|next month) /;
const END_YEAR = / (?:jahresende|ende (?:des|diese[ns]) jahres|dieses jahr|bis silvester|end of (?:the |this )?year|this year|year end) /;
const NEXT_WEEK = / (?:nächste woche|naechste woche|kommende woche|next week) /;
const MONTHS: Record<string, number> = {
  januar: 1, jänner: 1, january: 1, jan: 1, februar: 2, february: 2, feb: 2, märz: 3, maerz: 3, march: 3, april: 4, apr: 4,
  mai: 5, may: 5, juni: 6, june: 6, juli: 7, july: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9, oktober: 10, october: 10, okt: 10, oct: 10,
  november: 11, nov: 11, dezember: 12, december: 12, dez: 12, dec: 12,
};
const MONTH_ALT = Object.keys(MONTHS).join('|');
/** Words around a contract's name that are no part of it. */
const FILLER = new Set((
  'wann bis muss ich kann könnte koennte sollte darf meinen meine mein meinem meiner den die das der dem des sich er es sie noch denn eigentlich '
  + 'spätestens spaetestens kündigen kuendigen kündige kuendige kündbar kuendbar kündigung kuendigung kündigungsfrist kuendigungsfrist frist '
  + 'verlängert verlaengert verlängern verlaengern verlängerung verlaengerung läuft laeuft aus ausläuft auslaeuft endet enden automatisch '
  + 'vertrag verträge vertraege abo abos abonnement tarif mitgliedschaft bei beim von vom für fuer im in am zum zur ende monats monat jahres jahr '
  + 'wie lange ist sind wird werden um at with from was welche welchen welcher welches bald demnächst demnaechst nächsten naechsten '
  + 'when does do did will is my the a an i can must need have to has by until renew renews renewal renewed auto cancel cancelled canceled '
  + 'cancellation contract subscription membership plan of end ends expire expires get it last day deadline notice period soon before what which '
  + 'next month year week this dieses diesen diesem dieser subscriptions contracts memberships plans abonnements verträgen vertraegen laufen etwas anything something').split(' '));
/** What a contract is, said as a kind: the names it goes by. */
const KINDS: Array<[RegExp, RegExp]> = [
  [/^(?:handy|mobilfunk|smartphone|phone|mobile|cell|sim)/, /telekom|vodafone|\bo2\b|telef[oó]nica|congstar|1\s?(?:und|&)\s?1|freenet|mobilcom|drillisch|klarmobil|fraenk|aldi ?talk|lidl connect|winsim|simyo|ay yildiz|ortel|netzclub|otelo|callya|magenta|blau/],
  [/^(?:internet|dsl|glasfaser|kabel|wlan|wifi|broadband|fiber|fibre)/, /telekom|vodafone|\bo2\b|telef[oó]nica|1\s?(?:und|&)\s?1|pyur|unitymedia|netcologne|m-?net|deutsche glasfaser|ewe|congstar|kabel/],
  [/^(?:strom|gas|energie|electricity|power|energy)/, /stadtwerke|vattenfall|e\.?on|enbw|rwe|innogy|eprimo|yello|lichtblick|tibber|octopus|ostrom|naturstrom|polarstern|mainova|swm|strom|energie/],
  [/^(?:fitness|gym|studio)/, /mcfit|fitx|clever ?fit|urban ?sports|john reed|fitness|holmes place|kieser|easyfitness|injoy|wellpass|egym|gym/],
];
// i18n-data-end

const pad = (n: number) => String(n).padStart(2, '0');
const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The last day a "bis …" question names, from today on: "bis Ende des
 * Monats" (also the default), "bald" (SOON_DAYS), "nächsten Monat" (its last
 * day), "bis Ende des Jahres", "nächste Woche", "im Dezember" (its last day),
 * "bis zum 15.12.", "15. Dezember". A day or month without its year is the
 * next one from today.
 */
export function untilOf(question: string, today: string): string {
  const s = ` ${question.toLocaleLowerCase('de').replace(/[?!,;:„“"'()]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const q = fold(question);
  const [ty, tm] = today.split('-').map(Number);
  const forward = (y: number | null, m: number, d: number | null): string | null => {
    if (m < 1 || m > 12) return null;
    const make = (yr: number) => {
      const day = d ?? lastDayOf(yr, m);
      return day >= 1 && day <= lastDayOf(yr, m) ? `${yr}-${pad(m)}-${pad(day)}` : null;
    };
    if (y != null) return make(y);
    const thisYear = make(ty);
    return thisYear && thisYear >= today ? thisYear : make(ty + 1);
  };
  const yearOf = (v: string | undefined) => (!v ? null : v.length === 2 ? 2000 + Number(v) : Number(v));
  let m: RegExpExecArray | null;
  if ((m = / (\d{1,2})\.(\d{1,2})\.?(\d{4}|\d{2})?(?= )/.exec(s))) {
    const day = forward(yearOf(m[3]), Number(m[2]), Number(m[1]));
    if (day) return day;
  }
  if ((m = new RegExp(` (\\d{1,2})(?:\\.|st|nd|rd|th)? (?:of )?(${MONTH_ALT})\\.?(?: (\\d{4}))?(?= )`).exec(s))) {
    const day = forward(yearOf(m[3]), MONTHS[m[2]], Number(m[1]));
    if (day) return day;
  }
  if ((m = new RegExp(` (${MONTH_ALT})\\.? (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?(?= )`).exec(s))) {
    const day = forward(yearOf(m[3]), MONTHS[m[1]], Number(m[2]));
    if (day) return day;
  }
  if (NEXT_MONTH.test(q)) {
    const y = tm === 12 ? ty + 1 : ty;
    const mo = tm === 12 ? 1 : tm + 1;
    return `${y}-${pad(mo)}-${pad(lastDayOf(y, mo))}`;
  }
  if (END_YEAR.test(q)) return `${ty}-12-31`;
  if (NEXT_WEEK.test(q)) return addDays(today, 7);
  if (SOON.test(q)) return addDays(today, SOON_DAYS);
  if (!END_MONTH.test(q)) {
    // "im Dezember", "bis Ende Januar", "by March": a month's last day. English "may" only after a word for when.
    const month = [...q.matchAll(new RegExp(` (${MONTH_ALT})(?: ((?:19|20)\\d{2}))?(?= )`, 'g'))]
      .find((x) => x[1] !== 'may' || / (?:in|by|until|before|of|end of) may /.test(q));
    if (month && month[1].length > 3) {
      const day = forward(yearOf(month[2]), MONTHS[month[1]], null);
      if (day) return day;
    }
  }
  return `${ty}-${pad(tm)}-${pad(lastDayOf(ty, tm))}`;
}

/** The words of a folded question that name a contract, the filler and the dates taken out. */
function contractName(q: string): string | null {
  const words = q.trim().split(' ').filter((w) => w && !FILLER.has(w) && !/^\d+$/.test(w) && !(w in MONTHS));
  return words.length && words.length <= 3 ? words.join(' ') : null;
}

/** What a question asks about cancelling; null for anything else. */
export function contractIntentOf(question: string, today: string, contracts: readonly string[] = []): ContractIntent | null {
  const q = fold(question);
  const cancel = CANCEL.test(q);
  const renew = RENEW.test(q);
  if (!cancel && !renew) return null;
  // "Hab ich die Überweisung storniert?" or "Wann endet der Monat?" is no contract.
  const name = contractName(q);
  const known = !!name && name.split(' ').some((w) => contracts.some((c) => sameName(c, w)) || KINDS.some(([word]) => word.test(w)));
  if (renew && !cancel && !CONTRACT_WORD.test(q) && !known) return null;
  if (name) return { kind: 'renewal', name };
  if (cancel && WHEN.test(q) && !SOON.test(q) && !END_MONTH.test(q) && !LIST_ASK.test(q)) return { kind: 'cancelBy', until: null };
  if (cancel || LIST_ASK.test(q)) return { kind: 'cancelBy', until: untilOf(question, today) };
  return null;
}

// ---------------------------------------------------------------------------
// The figures
// ---------------------------------------------------------------------------

/** A name as letters and digits only, for comparing. */
const squash = (s: string) => s.toLocaleLowerCase('de').normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');

/** Whether a name the user typed is the one the app shows (either holds the other). */
function sameName(shown: string, asked: string): boolean {
  const a = squash(shown);
  const b = squash(asked);
  if (!a || b.length < 2) return false;
  return a.includes(b) || (a.length >= 4 && b.includes(a));
}

export type Deadline = {
  /** The series id the reminder is kept by. */
  id: string;
  name: string;
  /** The last day to cancel, yyyy-mm-dd. */
  by: string;
  /** The contract itself, where Verträge & Abos lists it. */
  series: RecurringSeries | null;
};

/**
 * The days by which contracts can be cancelled, from `today` up to `until`
 * (every one to come for null), the nearest first. `live`: Verträge & Abos'
 * live contracts; `gone`: the ended and hidden ones, whose reminders say
 * nothing any more. A reminder for a contract the loaded bookings do not
 * show keeps the name it was set with.
 */
export function deadlines(
  reminders: Readonly<Record<string, ContractReminder>> | undefined,
  live: readonly RecurringSeries[],
  gone: readonly RecurringSeries[],
  today: string,
  until: string | null,
): Deadline[] {
  const byId = new Map(live.map((s) => [s.id, s]));
  const goneIds = new Set(gone.map((s) => s.id));
  const out: Deadline[] = [];
  for (const [id, r] of Object.entries(reminders ?? {})) {
    if (goneIds.has(id) || r.by < today || (until && r.by > until)) continue;
    const s = byId.get(id) ?? null;
    const name = s ? seriesTitle(s) : r.name;
    if (!name) continue;
    out.push({ id, name, by: r.by, series: s });
  }
  return out.sort((a, b) => (a.by < b.by ? -1 : a.by > b.by ? 1 : a.name.localeCompare(b.name)));
}

export type ContractMatch = {
  id: string;
  name: string;
  series: RecurringSeries | null;
  /** Its last day to cancel, where the user set one and it is still to come. */
  by: string | null;
};

/**
 * The contracts a question names: by their name (as Verträge & Abos shows it,
 * as booked, or as the reminder keeps it), else by what they are
 * ("Handyvertrag": a mobile network's; "Versicherung": the insurance
 * category). The ones with a day to cancel first, the dearest after.
 */
export function contractsAsked(
  name: string,
  reminders: Readonly<Record<string, ContractReminder>> | undefined,
  live: readonly RecurringSeries[],
  today: string,
): ContractMatch[] {
  const expense = live.filter((s) => s.kind === 'expense' && !s.ended);
  const rem = reminders ?? {};
  const byOf = (id: string) => (rem[id] && rem[id].by >= today ? rem[id].by : null);
  const words = name.split(' ');
  let hits = expense.filter((s) => words.some((w) => sameName(seriesTitle(s), w) || sameName(s.name, w)));
  if (!hits.length) {
    const kind = KINDS.find(([word]) => words.some((w) => word.test(w)));
    if (kind) hits = expense.filter((s) => kind[1].test(`${seriesTitle(s)} ${s.name}`.toLocaleLowerCase('de')));
  }
  if (!hits.length) {
    const category = categoryFromQuestion(name);
    if (category && category !== 'media') hits = expense.filter((s) => s.category === category);
  }
  const out: ContractMatch[] = hits.map((s) => ({ id: s.id, name: seriesTitle(s), series: s, by: byOf(s.id) }));
  // A reminder for a contract the bookings do not show, by the name it was set with.
  for (const [id, r] of Object.entries(rem)) {
    if (out.some((o) => o.id === id) || expense.some((s) => s.id === id)) continue;
    if (r.name && words.some((w) => sameName(r.name, w)) && r.by >= today) out.push({ id, name: r.name, series: null, by: r.by });
  }
  return out.sort((a, b) => Number(!!b.by) - Number(!!a.by)
    || Math.abs(b.series?.yearlyAmount ?? 0) - Math.abs(a.series?.yearlyAmount ?? 0));
}
