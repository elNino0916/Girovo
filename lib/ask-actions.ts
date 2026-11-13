// Girovo AI: five things it does for you, each only after "Ja, bitte" in the
// thread (components/insights/ask/ActionAnswers.tsx asks and makes them):
//
// - fileUnder        "Ordne alle Shell-Buchungen Mobilität zu": a category rule for a payee,
//                    as "für alle" in a booking's details sets it
// - createGoal       "Leg ein Sparziel über 500 € bis Juni an": a Sparziel on a savings account
// - budget           "Leg für Essen ein Budget von 300 € an", "Budget für Essen löschen": a monthly budget
// - remindContract   "Erinner mich vor der Verlängerung von Spotify": the contract's cancellation reminder
// - prepareTransfer  "Überweis Mama 50 Euro für Pizza": the transfer form, filled in; never sent from here
//
// Here the pure part: reading the message by rules (lib/ask-intents.ts
// intentOf asks actionOf first), and the matching the answers need (a payee
// among the bookings, a person among the earlier transfers, a contract).
// A message that only asks about these ("Wie viel ist vom Budget übrig?")
// is none of them.
//
// Pure: no path aliases, `.ts` on sibling imports.

import { injects } from './ask-followup.ts';
import type { CategoryId } from './categories';
import { categoryFromQuestion } from './nano-ask.ts';

export type ActionIntent =
  /** name: the payee as written ("Shell"); null or a category null when the message does not say. */
  | { kind: 'fileUnder'; name: string | null; category: CategoryId | null }
  /** cents: the target; by: "2027-06"; name: as written ("Urlaub"), null for none. */
  | { kind: 'createGoal'; name: string | null; cents: number | null; by: string | null }
  /** A monthly budget set (cents) or removed (remove). */
  | { kind: 'budget'; category: CategoryId | null; cents: number | null; remove?: true }
  /** name: the contract, folded ("spotify", "handyvertrag"); by: the day it can be cancelled by; lead: days before. */
  | { kind: 'remindContract'; name: string | null; by: string | null; lead: number | null }
  /** name: the person as written ("Lea"); purpose: the Verwendungszweck as written. */
  | { kind: 'prepareTransfer'; name: string | null; cents: number | null; purpose: string | null };

export const ACTION_KINDS = ['fileUnder', 'createGoal', 'budget', 'remindContract', 'prepareTransfer'] as const;

/** Whether an intent is one of these (and ActionAnswers says it). */
export function isAction<I extends { kind: string }>(intent: I): intent is Extract<I, ActionIntent> {
  return (ACTION_KINDS as readonly string[]).includes(intent.kind);
}

/** The user's own categories: a name of theirs wins over the app's words. */
export type OwnCategory = { id: string; name: string };

// i18n-data-start — the words people use, German and English
const MONTHS: Record<string, number> = {
  januar: 1, jänner: 1, january: 1, februar: 2, february: 2, märz: 3, maerz: 3, march: 3, april: 4, mai: 5, may: 5,
  juni: 6, june: 6, juli: 7, july: 7, august: 8, september: 9, oktober: 10, october: 10, november: 11, dezember: 12, december: 12,
};
/** Written short, only next to a day: "31. Okt", "Oct 31". */
const MONTHS_SHORT: Record<string, number> = {
  jan: 1, feb: 2, mär: 3, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, okt: 10, oct: 10, nov: 11, dez: 12, dec: 12,
};
const COUNTS: Record<string, number> = {
  ein: 1, eine: 1, einem: 1, einen: 1, a: 1, an: 1, one: 1, zwei: 2, two: 2, drei: 3, three: 3, vier: 4, four: 4, fünf: 5, fuenf: 5, five: 5,
  sechs: 6, six: 6, sieben: 7, seven: 7, acht: 8, eight: 8, neun: 9, nine: 9, zehn: 10, ten: 10, elf: 11, eleven: 11, zwölf: 12, zwoelf: 12, twelve: 12,
};
/** A question about these things, not a wish: "Wie viel ist vom Budget übrig?", "Was gehört zu Mobilität?". */
const QUESTION = /^ (?:was|wie|welche[nmrs]?|wo|wann|warum|wieso|weshalb|wer|wem|wen|ist|sind|hab|habe|hat|gibt|what|how|which|where|when|why|who|is|are|do|does|did|have|has) /;
const ASKS_ABOUT = / (?:wie ?viel|wie hoch|übrig|uebrig|how much|left) /;

// fileUnder
/** Verbs that say it outright; with them a missing category is asked for. */
const FILE_VERB = / (?:ordne\w*|zuordnen|zuordnet|sortier\w*|einsortier\w*|einordnen|kategorisier\w*|verschieb\w*) |^ (?:please )?(?:file|categori[sz]e|classify|move|recategori[sz]e) /;
/** Ways of saying it that need a category beside them. */
const FILE_SAY = / (?:pack\w*|steck\w*|tu|tue) | soll(?:en)? (?:\S+ ){1,5}sein | (?:ist|sind) (?:ab jetzt |künftig |kuenftig |ab sofort )?immer | geh(?:ö|oe)r(?:t|en) (?:\S+ ){0,2}(?:zu|in|unter|nach) | immer (?:unter|zu|in|als|nach) | (?:kommt|kommen) (?:\S+ ){0,2}(?:zu|in|unter|nach) | als (?:\S+ ){1,3}(?:einsortieren|einordnen|kategorisieren|markieren|ablegen)|^ (?:please )?(?:put|mark|tag|sort) | (?:should|must) (?:always )?be | (?:is|are) always | always (?:goes|go|belongs?|counts?|is|are) | belongs? (?:to|in|under) /;
/** Words around a payee that are no part of its name. */
const FILE_FILLER = new Set((
  'ordne ordnet ordnen zuordnen zuordnet zu sortier sortiere sortieren einsortieren einsortiere einordnen ordne kategorisiere kategorisier kategorisieren '
  + 'verschieb verschiebe verschieben pack packe packen steck stecke stecken tu tue mach mache bitte alle allen alles meine meinen meiner mein '
  + 'die der den das dem des ein eine einen buchungen buchung umsätze umsaetze umsatz zahlungen zahlung abbuchungen ausgaben '
  + 'von vom bei beim mit unter in ins als nach immer künftig kuenftig ab jetzt sofort auch soll sollen sein ist sind gehört gehören gehoert '
  + 'gehoeren kommt kommen und kategorie markieren ablegen ein immer bitte '
  + 'file put move categorize categorise classify recategorize recategorise mark tag sort all my the transactions transaction payments payment '
  + 'from at to as under into in should must always be is are belongs belong goes go counts count please category also future now on of for with'
).split(' '));

// createGoal
const GOAL_WORD = / (?:spar)?ziel\w* | (?:savings )?goal /;
const GOAL_MAKE = / (?:leg|lege|legen|anlegen|erstell\w*|setz\w*|mach|mache|machen|einricht\w*|richte|start\w*|neu\w*|hinzufüg\w*|eröffne\w*|create|set|add|make|start|new|open) /;
const WANT_SAVE = / (?:will|möchte|moechte|würde gern|wuerde gern|würde gerne|wuerde gerne|plane|muss|want to|would like to|'d like to|need to|plan to) (?:\S+ ){0,6}(?:sparen|ansparen|zurücklegen|zuruecklegen|beiseitelegen|save|put aside|set aside)(?: |$)|^ (?:bitte |please )?(?:spar|spare|save up|save) /;
const GOAL_NAME_STOP = new Set((
  'für fuer fürs fuers for over über ueber von bis an mit sparen ansparen zurücklegen zuruecklegen legen anlegen lege leg zu im in ab und by until of to and on in at with save '
  + 'set aside put sparziel ziel goal euro eur euros € anlege bitte please will möchte moechte ich i want'
).split(' '));
const GOAL_NAME_SKIP = new Set('den die das dem der ein eine einen einem meinen meine mein unseren unser a an the my our'.split(' '));

// budget
const BUDGET = / (?:monats)?budget\w* /;
const REMOVE = / (?:lösch\w*|loesch\w*|entfern\w*|streich\w*|weg|aufheb\w*|delete|remove|clear|drop|get rid of) /;

// remindContract
const REMIND = / (?:erinner\w*|remind\w*|reminder|sag mir (?:\S+ )?bescheid|sag bescheid|warn\w* mich|benachrichtig\w*) /;
const CONTRACT_THING = / (?:\S*kündig\w*|\S*kuendig\w*|verlänger\w*|verlaenger\w*|\S*frist\w*|\S*vertrag\w*|abo\w*|ablauf\w*|läuft|laeuft|cancel\w*|renew\w*|notice|contract|subscription|expires?|expiry|ends?) /;
const NOTICE_SET = / kündigungsfrist\w* | kuendigungsfrist\w* | notice period / ;
const NOTICE_SET_VERB = / (?:eintragen|trag|setz\w*|merk\w*|speicher\w*|set|save|add) /;
const REMIND_FILLER = new Set((
  'erinner erinnere erinnern erinnert erinnerung mich mir bitte an die der den dem des vor bevor rechtzeitig kündigungsfrist kündigung kündigen '
  + 'kuendigungsfrist kuendigung kuendigen frist verlängerung verlängert verlaengerung verlaengert ablauf abläuft ablaeuft läuft laeuft aus '
  + 'von vom meinem meines meiner mein meine meinen für fuer zum zur wenn sich ist wird endet ende vertrag vertrags verträge abo abos '
  + 'sag bescheid warn warne benachrichtige benachrichtigen eintragen trag ein setz setze setzen merk merke speicher speichere am um zu '
  + 'remind reminder me before the of my to cancel cancelling canceling cancellation renewal renews renew notice period contract subscription '
  + 'deadline when about please a an for on at it is ends end expires expiry set save add tell warn vorher davor early früh frueh'
).split(' '));
const LEAD_WEEK = / (?:eine|1) woche | a week | one week | 1 week | 7 tage | 7 days /;
const LEAD_TWO = / (?:zwei|2) wochen | two weeks | 2 weeks | 14 tage | 14 days /;
const LEAD_MONTH = / (?:einen|1) monat | a month | one month | 1 month | 30 tage | 30 days | (?:vier|4) wochen | four weeks | 4 weeks /;
/**
 * A word for a kind of contract, and the providers its bookings go to: "Handyvertrag" finds
 * Telekom or Vodafone among Verträge & Abos, whose names are the providers'.
 */
const CONTRACT_KINDS: Array<[RegExp, string[]]> = [
  [/^(?:handy\w*|mobilfunk\w*|smartphone\w*|phone|mobile|cell\w*|sim\w*)$/, ['telekom', 'vodafone', 'o2', 'telefonica', '1&1', '1und1', 'congstar', 'freenet', 'mobilcom', 'aldi talk', 'fraenk', 'drillisch', 'winsim', 'blau', 'klarmobil', 'lebara', 'lidl connect', 'otelo', 'ay yildiz', 'netzclub']],
  [/^(?:internet\w*|dsl\w*|wlan\w*|festnetz\w*|glasfaser\w*|broadband)$/, ['telekom', 'vodafone', 'o2', '1&1', '1und1', 'pyur', 'netcologne', 'm-net', 'ewe', 'deutsche glasfaser']],
  [/^(?:strom\w*|gas\w*|energie\w*|electricity|power)$/, ['eon', 'e.on', 'vattenfall', 'enbw', 'rwe', 'tibber', 'octopus', 'lichtblick', 'stadtwerke', 'naturstrom', 'yello', 'eprimo']],
  [/^(?:fitness\w*|gym\w*|studio\w*)$/, ['mcfit', 'fitx', 'clever fit', 'urban sports', 'john reed', 'fitness first', 'easyfit', 'kieser']],
  [/^(?:musik\w*|music)$/, ['spotify', 'apple music', 'deezer', 'tidal', 'youtube music', 'amazon music']],
  [/^(?:streaming\w*|tv)$/, ['netflix', 'disney', 'prime video', 'amazon prime', 'dazn', 'sky', 'wow', 'rtl', 'joyn', 'waipu', 'zattoo', 'paramount']],
];

// prepareTransfer
const LEAD = '(?:bitte |please |und |and |jetzt |mal |hey |kannst du |könntest du |koenntest du |can you |could you |would you |ich will |ich möchte |ich moechte |möchte |moechte |ich würde gern |ich wuerde gern |ich muss |i want to |i\'d like to |i would like to |i need to )*';
const SEND = '(?:überweis(?:e|en|t)?|ueberweis(?:e|en|t)?|schick(?:e|en)?|send(?:e|en)?|zahl(?:e|en)?|bezahl(?:e|en)?|transfer|pay|wire)';
const SEND_START = new RegExp(`^ ${LEAD}(${SEND}) (?!ich |i |wir |we |du |you |mir |me |uns |us |sie |they |mal (?:alle|meine|die) )`);
const SEND_END = new RegExp(`^ ${LEAD}(?:\\S+ ){1,8}(${SEND})(?: bitte| please)? $`);
const WANTS_START = /^ (?:bitte |please |hey )?(?:kannst du|könntest du|koenntest du|ich will|ich möchte|ich moechte|möchte|moechte|ich würde gern|ich wuerde gern|ich muss|can you|could you|would you|i want to|i'd like to|i would like to|i need to)(?: |$)/;
/** Verbs that send whatever the amount; the others ("schick", "zahl", "pay") only with one. */
const TRANSFER_VERB = /^(?:überweis|ueberweis|transfer|wire)/;
const PREPARE = / (?:bereite|bereit|vorbereiten|mach|mache|erstell\w*|starte?|öffne|oeffne|leg|lege|richte|prepare|set up|start|open|draft|create|make|fill in) (?:\S+ ){0,3}(?:überweisung|ueberweisung|transfer|payment|zahlung)(?: |$)|^ (?:bitte |please )?(?:neue |eine |new |a )?(?:überweisung|ueberweisung|transfer|payment) (?:an|für|fuer|to|for) /;
const NAME_STOP = new Set((
  'über ueber von vom mit für fuer for of with und and vor zu bitte please eine einen ein die das den der dem mir mal jetzt '
  + 'überweisung ueberweisung überweisen ueberweisen schicken senden zahlen bezahlen transfer payment send pay wire vorbereiten bereite '
  + 'euro eur euros € auf aufs on to from as heute morgen today tomorrow sofort now an a the my money geld wegen betreff verwendungszweck reference'
).split(' '));
/** The words of a wish before the person: "Kannst du", "Ich will", "I want to". */
const LEAD_WORDS = new Set('bitte please hey kannst könntest koenntest du ich will möchte moechte würde wuerde gern gerne muss can could would you i want to like need mal jetzt'.split(' '));
const PURPOSE_AT =/ (?:für|fuer|for|wegen|verwendungszweck|betreff|zweck|reference) /;
const PURPOSE_STOP = new Set('an to über ueber von bitte please und and überweisen ueberweisen schicken senden zahlen bezahlen vorbereiten vor'.split(' '));
// i18n-data-end

/**
 * The words and their categories for these actions: the names the app gives
 * its categories ("Mobilität", "Transport") and the words people use for them,
 * longer phrases first. Matched as the start of a word of the message.
 */
// i18n-data-start
const CATEGORY_NAMES: Array<[CategoryId, string[]]> = [
  ['otherIn', ['sonstige eingänge', 'sonstige eingaenge', 'other income']],
  ['transfer', ['umbuchung', 'internal transfer']],
  ['dining', ['essen & trinken', 'essen und trinken', 'eating out', 'essen gehen', 'essen', 'trinken', 'restaurant', 'dining', 'takeaway', 'lieferdienst', 'gastronomie']],
  ['groceries', ['lebensmittel', 'drogerie', 'supermarkt', 'groceries', 'grocery', 'toiletries', 'einkäufe', 'einkaeufe']],
  ['mobility', ['mobilität', 'mobilitaet', 'transport', 'verkehr', 'tanken', 'sprit', 'auto', 'fuel', 'travel']],
  ['housing', ['wohnen', 'energie', 'miete', 'strom', 'housing', 'energy', 'rent', 'utilities']],
  ['shopping', ['shopping', 'kleidung', 'klamotten', 'clothes', 'clothing']],
  ['leisure', ['freizeit', 'hobby', 'hobbys', 'leisure', 'hobbies']],
  ['media', ['abos & medien', 'abos und medien', 'abos', 'medien', 'streaming', 'subscriptions', 'media']],
  ['health', ['gesundheit', 'apotheke', 'health', 'pharmacy']],
  ['insurance', ['versicherung', 'insurance']],
  ['taxes', ['steuern', 'abgaben', 'taxes']],
  ['cash', ['bargeld', 'cash']],
  ['fees', ['bankentgelte', 'gebühren', 'gebuehren', 'zinsen', 'bank fees', 'fees']],
  ['savings', ['sparen & anlegen', 'sparen und anlegen', 'sparen', 'anlegen', 'savings', 'saving', 'investing']],
  ['income', ['einkommen', 'gehalt', 'income', 'salary']],
  ['other', ['sonstiges', 'sonstige', 'other', 'misc']],
];
// i18n-data-end

const fold = (s: string) => ` ${s.toLocaleLowerCase('de')
  .replace(/€/g, ' € ')
  .replace(/[?!;:„“"'()]/g, ' ')
  .replace(/(?<!\d),|,(?!\d)/g, ' ')
  .replace(/\.(?=\s|$)/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()} `;

/** Letters and digits only, for comparing names. */
const squash = (s: string) => s.toLocaleLowerCase('de').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}&]+/gu, ' ').trim();

const pad = (n: number) => String(n).padStart(2, '0');

// ---------------------------------------------------------------------------
// Amounts, months and days
// ---------------------------------------------------------------------------

const AMOUNT = /(?<= )(€ )?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2})|\.(\d{2})(?!\d))?(?: (tausend|thousand|k))?(?: (€|euro|euros|eur))?(?= )/g;
const NOT_MONEY_AFTER = /^ (?:monat\w*|jahr\w*|tag\w*|woche\w*|month\w*|year\w*|day\w*|week\w*|%|prozent|percent|uhr|mal|x|times)(?= )/;

/** The amount a folded message names, in cents: one with € or "Euro" first, else the only number. Null for none. */
export function amountOf(q: string): number | null {
  const found: { cents: number; money: boolean }[] = [];
  for (const m of q.matchAll(AMOUNT)) {
    const after = q.slice((m.index ?? 0) + m[0].length);
    const money = !!(m[1] || m[6]);
    if (!money && NOT_MONEY_AFTER.test(after)) continue;
    const whole = Number(m[2].replace(/\./g, ''));
    // A year standing alone ("bis 2027") is no amount.
    if (!money && !m[5] && /^(?:19|20)\d\d$/.test(m[2])) continue;
    const cents = Math.round((whole * (m[5] ? 1000 : 1) + Number(m[3] ?? m[4] ?? 0) / ((m[3] ?? m[4] ?? '').length === 1 ? 10 : 100)) * 100);
    if (cents > 0) found.push({ cents, money });
  }
  const money = found.find((f) => f.money);
  if (money) return money.cents;
  return found.length === 1 ? found[0].cents : null;
}

/** "2026-11" for today's month moved by `n` months. */
function monthFrom(today: string, n: number): string {
  const [y, m] = today.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** The month a month's name means: this year's while it is still to come (this month included), else next year's. */
function monthAhead(month: number, year: number | null, today: string): string {
  const [ty, tm] = today.split('-').map(Number);
  return `${year ?? (month >= tm ? ty : ty + 1)}-${pad(month)}`;
}

const MONTH_ALT = Object.keys(MONTHS).join('|');
const SHORT_ALT = `${MONTH_ALT}|${Object.keys(MONTHS_SHORT).join('|')}`;
const COUNT_ALT = `\\d{1,2}|${Object.keys(COUNTS).join('|')}`;

/**
 * The month a goal should be reached by, and the message without those words:
 * "bis Juni", "bis Ende 2027", "bis 30.6.2027", "in einem Jahr", "by June", "within 6 months".
 */
export function goalMonthOf(q: string, today: string): { by: string | null; rest: string } {
  // i18n-data-start: the words of a month to come
  const rules: Array<[RegExp, (m: RegExpExecArray) => string | null]> = [
    [new RegExp(` (?:bis|by|until|till|before) (?:(?:spätestens|ende|anfang|zum|the end of|end of|the) )*(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4}|\\d{2})?(?= )`), (m) => {
      const month = Number(m[2]);
      if (month < 1 || month > 12) return null;
      return monthAhead(month, m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null, today);
    }],
    [/ (?:bis|by|until|till|before) (?:(?:spätestens|ende|anfang|zum|the end of|end of|the) )*(\d{1,2})\/(\d{4})(?= )/, (m) => {
      const month = Number(m[1]);
      return month >= 1 && month <= 12 ? `${m[2]}-${pad(month)}` : null;
    }],
    [new RegExp(` (?:bis|by|until|till|before|im|in) (?:(?:spätestens|ende|anfang|zum|the end of|end of|the) )*(${MONTH_ALT})(?: (\\d{4}))?(?= )`), (m) => monthAhead(MONTHS[m[1]], m[2] ? Number(m[2]) : null, today)],
    [/ (?:bis|by|until|till|before) (?:(?:spätestens|ende|zum|the end of|end of) )*((?:19|20)\d\d)(?= )/, (m) => `${m[1]}-12`],
    [/ (?:bis|by|until|till|before) (?:(?:zum|zu) )?(?:weihnachten|christmas|silvester|jahresende|year end|the end of the year|end of the year|ende des jahres)(?= )/, () => monthAhead(12, null, today)],
    [/ (?:bis|by) (?:(?:zum|the) )?(?:nächsten|naechsten|nächstes|naechstes|next) (?:sommer|summer)(?= )/, () => monthAhead(6, Number(today.slice(0, 4)) + 1, today)],
    [/ (?:bis|by) (?:(?:zum|the) )?(?:sommer|summer)(?= )/, () => monthAhead(6, null, today)],
    [new RegExp(` (?:in|within|binnen|innerhalb von) (${COUNT_ALT}) (monat|monaten|month|months|jahr|jahren|year|years)(?= )`), (m) => {
      const n = /^\d+$/.test(m[1]) ? Number(m[1]) : COUNTS[m[1]] ?? 0;
      if (!n) return null;
      return monthFrom(today, /^(?:jahr|year)/.test(m[2]) ? 12 * n : n);
    }],
  ];
  // i18n-data-end
  for (const [re, at] of rules) {
    const m = re.exec(q);
    if (!m) continue;
    const by = at(m);
    if (by) return { by, rest: `${q.slice(0, m.index)} ${q.slice(m.index + m[0].length)}`.replace(/\s+/g, ' ') };
  }
  return { by: null, rest: q };
}

/** A day still to come: "31.3.", "31. März 2027", "March 31st", "2027-03-31"; this year's while ahead, else next year's. */
export function futureDayOf(q: string, today: string): { by: string | null; rest: string } {
  const [ty] = today.split('-').map(Number);
  const dayOf = (d: number, mo: number, y: number | null): string | null => {
    if (mo < 1 || mo > 12 || d < 1) return null;
    const make = (year: number) => (d <= new Date(Date.UTC(year, mo, 0)).getUTCDate() ? `${year}-${pad(mo)}-${pad(d)}` : null);
    if (y) return make(y);
    const now = make(ty);
    return now && now >= today ? now : make(ty + 1);
  };
  const yearOf = (y: string | undefined) => (!y ? null : y.length === 2 ? 2000 + Number(y) : Number(y));
  const rules: Array<[RegExp, (m: RegExpExecArray) => string | null]> = [
    [/ (\d{4})-(\d{2})-(\d{2})(?= )/, (m) => dayOf(Number(m[3]), Number(m[2]), Number(m[1]))],
    [/ (\d{1,2})\.(\d{1,2})\.?(\d{4}|\d{2})?(?= )/, (m) => dayOf(Number(m[1]), Number(m[2]), yearOf(m[3]))],
    [new RegExp(` (\\d{1,2})(?:\\.|st|nd|rd|th)? (?:of )?(${SHORT_ALT})\\.?(?: (\\d{4}))?(?= )`), (m) => dayOf(Number(m[1]), MONTHS[m[2]] ?? MONTHS_SHORT[m[2]], yearOf(m[3]))],
    [new RegExp(` (${SHORT_ALT})\\.? (\\d{1,2})(?:st|nd|rd|th)?(?: (\\d{4}))?(?= )`), (m) => dayOf(Number(m[2]), MONTHS[m[1]] ?? MONTHS_SHORT[m[1]], yearOf(m[3]))],
  ];
  for (const [re, at] of rules) {
    const m = re.exec(q);
    if (!m) continue;
    const by = at(m);
    if (by) return { by, rest: `${q.slice(0, m.index)} ${q.slice(m.index + m[0].length)}`.replace(/\s+/g, ' ') };
  }
  return { by: null, rest: q };
}

// ---------------------------------------------------------------------------
// Categories and names
// ---------------------------------------------------------------------------

/**
 * The category a message names: one of the user's own by its name first,
 * then the app's by its name or a word for it ("Mobilität", "transport",
 * "Lebensmittel", "Essen"), then the words the questions use (lib/nano-ask.ts).
 * `words`: what in the message named it, folded, to leave out of a name.
 */
export function categoryIn(question: string, own: readonly OwnCategory[] = []): { id: CategoryId; words: string[] } | null {
  const q = fold(question);
  const mine = [...own].filter((c) => fold(c.name).trim().length >= 2).sort((a, b) => b.name.length - a.name.length)
    .find((c) => q.includes(fold(c.name)));
  if (mine) return { id: mine.id as CategoryId, words: fold(mine.name).trim().split(' ') };
  // The last one named: "Ordne Essenza Mobilität zu" files under Mobilität, the payee's word is its name.
  let best: { id: CategoryId; at: number; hit: string } | null = null;
  for (const [id, names] of CATEGORY_NAMES) {
    for (const n of names) {
      const at = q.lastIndexOf(` ${n}`);
      if (at >= 0 && (!best || at > best.at || (at === best.at && n.length > best.hit.length))) best = { id, at: at + 1, hit: n };
    }
  }
  if (best) {
    // The whole word it begins ("Mobilitätskosten"), so the name keeps none of it.
    const end = q.indexOf(' ', best.at + best.hit.length);
    return { id: best.id, words: q.slice(best.at, end < 0 ? undefined : end).split(' ') };
  }
  const id = categoryFromQuestion(question);
  return id ? { id, words: [] } : null;
}

/** The message's words as typed, punctuation off, a hyphen splitting a word ("Shell-Buchungen"). */
function wordsOf(question: string): { raw: string; low: string }[] {
  return question.replace(/€/g, ' € ').split(/[\s\-–]+/)
    .map((w) => w.replace(/^[„“"'(]+|[?!.,;:„“"')]+$/g, ''))
    .filter(Boolean)
    .map((raw) => ({ raw, low: raw.toLocaleLowerCase('de') }));
}

/** Whether a word can be part of a name: no number, no amount, no lone letter. */
const nameLike = (w: string) => w.length >= 2 && !/^[\d.,€]+$/.test(w) && !/^(?:euro|eur|euros)$/.test(w);

/** The first letter up where it was typed in lowercase: "mama" as "Mama". */
const upFirst = (s: string) => s.replace(/^(\p{Ll})/u, (c) => c.toLocaleUpperCase('de'));

/**
 * Whether a name the user typed is a payee's the lists show: every word of it
 * begins a word of the payee's ("Shell" in "SHELL 1234 HAMBURG", "Lea" in
 * "Lea Müller"), three letters only as a whole word ("Lea" is not "Leasing").
 */
export function namesPayee(shown: string, asked: string): boolean {
  const have = squash(shown).split(' ').filter(Boolean);
  const want = squash(asked).split(' ').filter(Boolean);
  if (!have.length || !want.length) return false;
  return want.every((w) => have.some((h) => h === w || (w.length >= 4 && h.startsWith(w))));
}

// ---------------------------------------------------------------------------
// Reading a message
// ---------------------------------------------------------------------------

function fileOf(question: string, q: string, own: readonly OwnCategory[]): ActionIntent | null {
  const verb = FILE_VERB.test(q);
  if (!verb && !FILE_SAY.test(q)) return null;
  const category = categoryIn(question, own);
  if (!verb && !category) return null;
  const skip = new Set(category?.words ?? []);
  const name = wordsOf(question)
    .filter((w) => !FILE_FILLER.has(w.low) && !skip.has(w.low) && nameLike(w.low) && !(category && category.words.length === 0 && categoryIn(w.raw)?.id === category.id))
    .slice(0, 3).map((w) => w.raw).join(' ');
  return { kind: 'fileUnder', name: name || null, category: category?.id ?? null };
}

function goalOf(question: string, q: string, today: string): ActionIntent | null {
  const { by, rest } = goalMonthOf(q, today);
  const cents = amountOf(rest);
  const making = GOAL_WORD.test(q) && GOAL_MAKE.test(q);
  const naming = GOAL_WORD.test(q) && cents != null;
  const wanting = WANT_SAVE.test(q) && cents != null;
  if (!making && !naming && !wanting) return null;
  return { kind: 'createGoal', name: goalName(question, rest), cents, by };
}

/** A goal's name: after "für", "for", "namens", "called" or "Sparziel" itself, up to three words. */
function goalName(question: string, rest: string): string | null {
  const words = wordsOf(question);
  const restWords = new Set(rest.trim().split(' '));
  const starts = words.map((w, i) => (/^(?:für|fuer|fürs|fuers|for|namens|called|named|sparziel|ziel|goal)$/.test(w.low) ? i + 1 : -1)).filter((i) => i > 0);
  for (const start of starts) {
    const out: string[] = [];
    for (let i = start; i < words.length && out.length < 3; i++) {
      const w = words[i];
      if (!out.length && GOAL_NAME_SKIP.has(w.low)) continue;
      if (GOAL_NAME_STOP.has(w.low) || !nameLike(w.low) || !restWords.has(w.low)) break;
      out.push(w.raw);
    }
    if (out.length) return upFirst(out.join(' ')).slice(0, 40);
  }
  return null;
}

function budgetOf(question: string, q: string, own: readonly OwnCategory[]): ActionIntent | null {
  if (!BUDGET.test(q)) return null;
  const remove = REMOVE.test(q);
  const cents = remove ? null : amountOf(q);
  if (!remove && cents == null) return null;
  if (QUESTION.test(q) && !remove) return null;
  const category = categoryIn(question, own);
  return remove ? { kind: 'budget', category: category?.id ?? null, cents: null, remove: true } : { kind: 'budget', category: category?.id ?? null, cents };
}

function remindOf(q: string, today: string): ActionIntent | null {
  const reminding = REMIND.test(q) && CONTRACT_THING.test(q);
  const setting = NOTICE_SET.test(q) && NOTICE_SET_VERB.test(q);
  if (!reminding && !setting) return null;
  const { by, rest } = futureDayOf(q, today);
  const lead = LEAD_WEEK.test(rest) ? 7 : LEAD_TWO.test(rest) ? 14 : LEAD_MONTH.test(rest) ? 30 : null;
  const plain = rest.replace(LEAD_WEEK, ' ').replace(LEAD_TWO, ' ').replace(LEAD_MONTH, ' ');
  const words = plain.trim().split(/[\s\-–]+/).filter((w) => w && !REMIND_FILLER.has(w) && nameLike(w));
  return { kind: 'remindContract', name: words.slice(0, 3).join(' ') || null, by, lead };
}

function transferOf(question: string, q: string): ActionIntent | null {
  if (QUESTION.test(q) && !WANTS_START.test(q)) return null;
  const start = SEND_START.exec(q);
  const end = !start && WANTS_START.test(q) ? SEND_END.exec(q) : null;
  const prepare = PREPARE.test(q);
  const verb = (start ?? end)?.[1] ?? null;
  if (!verb && !prepare) return null;
  const cents = amountOf(q);
  if (!prepare && verb && !TRANSFER_VERB.test(verb) && cents == null) return null;
  return { kind: 'prepareTransfer', name: transferName(question), cents, purpose: purposeOf(question) };
}

/** Who the money goes to: after "an" or "to", else the word after the verb ("Überweis Mama 50 Euro"). */
function transferName(question: string): string | null {
  const words = wordsOf(question);
  const take = (from: number): string | null => {
    const first = words[from];
    if (!first || NAME_STOP.has(first.low) || !nameLike(first.low)) return null;
    const second = words[from + 1];
    // A second word only when typed as a name ("an Lea Müller", not "an Lea für Pizza").
    const two = second && !NAME_STOP.has(second.low) && nameLike(second.low) && /^\p{Lu}/u.test(second.raw) && /^\p{Lu}/u.test(first.raw);
    return upFirst(two ? `${first.raw} ${second.raw}` : first.raw);
  };
  const to = words.findIndex((w, i) => /^(?:an|to)$/.test(w.low) && i > 0);
  if (to >= 0) {
    const name = take(to + 1);
    if (name) return name;
  }
  const verb = words.findIndex((w) => new RegExp(`^${SEND}$`).test(w.low));
  if (verb >= 0) {
    for (let i = verb + 1; i < Math.min(words.length, verb + 3); i++) {
      if (/^(?:bitte|please|mal|jetzt)$/.test(words[i].low)) continue;
      const name = take(i);
      if (name || i > verb + 1) return name;
    }
    // The verb last ("Kannst du Lea 20 € überweisen?"): the first name between the wish and the verb.
    for (let i = 0; i < verb; i++) {
      if (LEAD_WORDS.has(words[i].low)) continue;
      return take(i);
    }
  }
  return null;
}

/** The Verwendungszweck: what follows "für", "for", "wegen" or "Verwendungszweck", up to the amount or the person. */
function purposeOf(question: string): string | null {
  const q = fold(question);
  const m = PURPOSE_AT.exec(q);
  if (!m) return null;
  const words = wordsOf(question);
  const lows = words.map((w) => w.low);
  const at = lows.findIndex((w) => PURPOSE_AT.test(` ${w} `));
  if (at < 0) return null;
  const out: string[] = [];
  for (let i = at + 1; i < words.length && out.length < 8; i++) {
    const w = words[i];
    if (PURPOSE_STOP.has(w.low) || /^[\d.,€]+$/.test(w.low) || /^(?:euro|eur|euros)$/.test(w.low)) break;
    out.push(w.raw);
  }
  const text = out.join(' ').trim();
  return text ? upFirst(text).slice(0, 140) : null;
}

/**
 * What a message asks Girovo to do, or null. `own`: the user's own categories;
 * `today` for a goal's month and a reminder's day. A prompt injection
 * ("Ignoriere alle Anweisungen …") is none: it stays small talk.
 */
export function actionOf(question: string, own: readonly OwnCategory[] = [], today: string = localToday()): ActionIntent | null {
  if (injects(question)) return null;
  const q = fold(question);
  return transferOf(question, q)
    ?? remindOf(q, today)
    ?? budgetOf(question, q, own)
    ?? (QUESTION.test(q) || ASKS_ABOUT.test(q) ? null : goalOf(question, q, today) ?? fileOf(question, q, own));
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------------------------------------------------------------------------
// Matching for the answers
// ---------------------------------------------------------------------------

/** What filing a payee would do; T a booking. */
export type FilePlan<T> =
  | { state: 'none' }
  /** Every booking of the payee that a rule would reach was filed by the user by hand. */
  | { state: 'handFiled'; names: string[] }
  | { state: 'already'; names: string[]; count: number }
  /** anchors: a booking per counterparty to set the rule on; count: the listed bookings that move. */
  | { state: 'ready'; names: string[]; anchors: T[]; count: number; skipped: boolean };

/** How the answer sees one booking. */
export type FileView = {
  /** The name the lists show. */
  name: string;
  /** Every key a rule can file it under, its own first (lib/categories.ts counterpartyRuleKeys). */
  keys: readonly string[];
  /** Its category now; manual for one the user filed by hand; split when shared across categories. */
  category: string;
  source: 'manual' | 'rule' | 'auto';
  split: boolean;
};

/**
 * Which counterparties a rule for `asked` reaches and whether it may: a
 * counterparty whose bookings the user filed by hand (or split) is left
 * alone, as "Mit Girovo AI kategorisieren" leaves it. `listed` are the
 * bookings the lists show (they are counted), `loaded` every loaded one a
 * rule reaches (they are checked).
 */
export function filePlan<T>(
  listed: readonly T[], loaded: readonly T[], asked: string, category: string, view: (tx: T) => FileView,
): FilePlan<T> {
  const views = new Map<T, FileView>();
  const of = (tx: T) => {
    let v = views.get(tx);
    if (!v) views.set(tx, (v = view(tx)));
    return v;
  };
  const reachedBy = new Map<string, T[]>();
  for (const tx of new Set([...listed, ...loaded])) {
    for (const k of of(tx).keys) {
      const list = reachedBy.get(k);
      if (list) list.push(tx);
      else reachedBy.set(k, [tx]);
    }
  }
  const groups = new Map<string, T[]>();
  for (const tx of new Set(listed)) {
    const v = of(tx);
    const key = v.keys[0];
    if (!key || key === 'name:?' || !namesPayee(v.name, asked)) continue;
    const list = groups.get(key);
    if (list) list.push(tx);
    else groups.set(key, [tx]);
  }
  if (!groups.size) return { state: 'none' };
  const names = (keys: Iterable<string>) => [...new Set([...keys].map((k) => of(groups.get(k)![0]).name.trim()))];
  const free: string[] = [];
  const hand: string[] = [];
  for (const [key] of groups) {
    const reached = reachedBy.get(key) ?? [];
    (reached.some((t) => of(t).source === 'manual' || of(t).split) ? hand : free).push(key);
  }
  if (!free.length) return { state: 'handFiled', names: names(hand) };
  const moved = new Set<T>();
  for (const key of free) for (const t of reachedBy.get(key) ?? []) if (listed.includes(t)) moved.add(t);
  const count = moved.size;
  if ([...moved].every((t) => of(t).category === category)) return { state: 'already', names: names(free), count };
  return { state: 'ready', names: names(free), anchors: free.map((k) => groups.get(k)![0]), count, skipped: hand.length > 0 };
}

/** One earlier payee of a transfer (components/transfer/model.ts recentPayees: the newest first). */
export type PastPayee = { name: string; iban: string; day: string };

/**
 * Whom a transfer to `asked` goes to: the one payee of that name, with the
 * IBAN of the newest transfer to them; several when the name fits more than
 * one person; none when no earlier transfer went to anyone of that name.
 */
export function transferPayee(payees: readonly PastPayee[], asked: string):
  { state: 'one'; payee: PastPayee } | { state: 'several'; names: string[] } | { state: 'none' } {
  const hits = payees.filter((p) => namesPayee(p.name, asked));
  if (!hits.length) return { state: 'none' };
  const byName = new Map<string, PastPayee>();
  for (const p of [...hits].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))) {
    const k = squash(p.name);
    if (!byName.has(k)) byName.set(k, p);
  }
  if (byName.size === 1) return { state: 'one', payee: [...byName.values()][0] };
  return { state: 'several', names: [...byName.values()].map((p) => p.name) };
}

/**
 * The contracts a reminder is about: those whose name holds what was asked
 * ("spotify"), else, for a kind of contract ("Handyvertrag"), those of its
 * providers. `titles` are each contract's names as shown and as booked.
 */
export function contractsFor<T>(items: readonly T[], asked: string, titles: (item: T) => string[]): T[] {
  const want = squash(asked);
  if (!want) return [];
  const has = (item: T, name: string) => titles(item).some((t) => {
    const a = squash(t);
    return !!a && (` ${a} `.includes(` ${name} `) || (name.length >= 4 && a.includes(name)) || (a.length >= 4 && name.includes(a)));
  });
  const direct = items.filter((item) => has(item, want));
  if (direct.length) return direct;
  const kind = CONTRACT_KINDS.find(([re]) => want.split(' ').some((w) => re.test(w)));
  if (!kind) return [];
  return items.filter((item) => kind[1].some((p) => has(item, squash(p))));
}
