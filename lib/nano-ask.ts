// "Frag deine Umsätze" (Android, Gemini Nano v4): a question about the user's
// own bookings, answered on the phone.
//
// Nano does one thing here: it turns the question into a search — in or out,
// a category, a name to look for — as one line of JSON. It never computes or
// states a figure. Girovo reads that line into the same filter the
// Umsätze list applies (lib/analytics.ts filterTransactions), works the answer
// out from the bookings loaded on the phone, and says it in its own words;
// "Umsätze zeigen" opens the list on exactly those bookings, so the figure and
// the list can never disagree.
//
// What the question says in so many words is read here, by rule, and wins over
// Nano: its period (Nano named one for every question, mostly "this year"),
// the kind of answer ("wie oft", "pro Monat" — Nano guessed one even for a bare
// "Spotify"), the direction ("an Mama" goes out, Nano had it coming in), a
// category named in its own words. Nano's part is what rules read badly: which
// category "Essen gehen" or "Klamotten" is, which word is the name. A name it gives must stand in the
// question, and beats its category ("Amazon" is every Amazon booking, not the
// shopping ones); where the name finds nothing, its category is asked instead.
// Where Nano gives no readable line at all, the rules alone answer if they can.
//
// Pure, so the tests run it on the desktop.

import { bookingDay, categoryPieces, filterTransactions, type CategoryOf, type SearchContext } from './analytics.ts';
import type { TxFilter } from './app-types.ts';
import { CATEGORIES, counterpartyName, type BuiltinCategoryId, type CategoryId } from './categories.ts';
import { foldText } from './categorize.ts';
import type { SerializedTransaction } from './fints-types.ts';

/** 'list': the bookings themselves ("Zeig alle Zahlungen an Amazon"), the newest first. */
export type AskKind = 'sum' | 'count' | 'largest' | 'last' | 'average' | 'rank' | 'compare' | 'list';
export type AskDir = 'out' | 'in' | 'all';
export type AskPeriod =
  | { kind: 'all' }
  | { kind: 'today' }
  | { kind: 'thisMonth' }
  | { kind: 'lastMonth' }
  | { kind: 'thisYear' }
  | { kind: 'lastYear' }
  | { kind: 'month'; month: string }
  | { kind: 'since'; month: string }
  | { kind: 'year'; year: number }
  | { kind: 'days'; days: number }
  | { kind: 'months'; months: number }
  /** Exact days: the earlier side of a comparison, cut to as many days as the running one has. */
  | { kind: 'range'; from: string; to: string };

/** A ranking: of categories or payees, by the money or by how often. */
export type AskRank = { by: 'category' | 'payee'; metric: 'sum' | 'count' };

export type AskQuery = {
  kind: AskKind;
  dir: AskDir;
  category: CategoryId | null;
  /** A name or word to look for, as the Umsätze search reads it. */
  search: string | null;
  period: AskPeriod;
  /** Nano's category, set aside for the name: asked instead when the name finds nothing. */
  hint?: CategoryId | null;
  /** kind 'rank': what is ranked, and by what. */
  rank?: AskRank;
  /** kind 'compare': the period `period` is set against ("letzten Monat" in "mehr als letzten Monat?"). */
  against?: AskPeriod;
  /** kind 'average': per month (the default, also when left out) or per year ("pro Jahr", "jährlich"). */
  per?: 'month' | 'year';
};

/** The categories Nano may name: those a question can mean. */
export const ASKABLE: readonly BuiltinCategoryId[] = [
  'income', 'housing', 'groceries', 'mobility', 'shopping', 'dining', 'leisure', 'media', 'health', 'insurance', 'taxes',
  'cash', 'fees', 'savings',
];

/**
 * Gemini Nano's generation Girovo asks questions of: v4 and later read the
 * question into a search reliably (nano-v4-fast on a Galaxy S26, measured);
 * an older one, or a model AICore does not name, gets "Nicht unterstützt".
 */
export const ASK_MIN_NANO = 4;

/** The Nano generation in AICore's model name ("nano-v4-fast" → 4), or null. */
export function nanoGeneration(model: string | null | undefined): number | null {
  const m = /nano[-_ ]?v(\d+)/i.exec(String(model ?? ''));
  return m ? +m[1] : null;
}

export const asksWith = (model: string | null | undefined) => (nanoGeneration(model) ?? 0) >= ASK_MIN_NANO;

// i18n-data-start — the prompt is the model's input, written in German
/**
 * Nano's instruction: a search as one compact line of JSON, never a figure.
 * Listing the values as `"art": "summe" (…), "anzahl" (…)` made Nano take
 * each value for a field of its own, fenced and pretty-printed — 110 tokens
 * that ran past the limit and never closed. Values are named as words here.
 */
export const ASK_SYSTEM =
  'Du übersetzt eine Frage zu den eigenen Kontoumsätzen in eine Suche. Du rechnest nichts aus und nennst keine Beträge. '
  + 'Antworte mit genau einer Zeile JSON wie in den Beispielen – ohne ```, ohne Zeilenumbruch, ohne weitere Wörter – '
  + 'mit genau drei Schlüsseln: richtung, kategorie, suche. '
  + 'richtung ist aus (ausgegeben, bezahlt, an jemanden), ein (bekommen, Einnahmen, von jemandem) oder alle. '
  + 'kategorie ist eine ID aus der Liste oder null. Nennt die Frage einen Namen, ist kategorie null. '
  + 'suche ist ein Name aus der Frage (Firma, Shop, Person, Abo), so geschrieben wie dort, oder null – nie ein Wort für eine Kategorie oder eine Zeit.';

/** The categories in the words people use for them, and examples — the fixed head of every question. */
export const ASK_CATEGORY_LIST =
  'Kategorien:\n'
  + '- income: Gehalt, Lohn, Rente, Einnahmen\n'
  + '- housing: Miete, Wohnen, Strom, Gas, Nebenkosten\n'
  + '- groceries: Lebensmittel, Supermarkt, Einkauf, Bäcker, Drogerie\n'
  + '- mobility: Tanken, Benzin, Bahn, Bus, Parken, Auto, Werkstatt\n'
  + '- shopping: Shopping, Kleidung, Elektronik, Möbel, Online-Shop\n'
  + '- dining: Essen gehen, Restaurant, Café, Imbiss, Lieferdienst, Bar\n'
  + '- leisure: Freizeit, Kino, Konzert, Sport, Fitness, Videospiele, Hotel, Urlaub\n'
  + '- media: Abos, Streaming, Musik, Handy, Internet\n'
  + '- health: Apotheke, Arzt, Gesundheit\n'
  + '- insurance: Versicherung\n'
  + '- taxes: Steuern, Finanzamt, Rundfunkbeitrag\n'
  + '- cash: Bargeld, Geldautomat, abgehoben\n'
  + '- fees: Kontoführung, Bankgebühren, Entgelt\n'
  + '- savings: Sparen, Sparplan, Depot, ETF\n'
  + '\n'
  + 'Beispiele:\n'
  + 'Frage: Wie viel habe ich letzten Monat für Lebensmittel ausgegeben?\n'
  + '{"richtung":"aus","kategorie":"groceries","suche":null}\n'
  + 'Frage: Wie oft war ich dieses Jahr bei Rewe?\n'
  + '{"richtung":"aus","kategorie":null,"suche":"Rewe"}\n'
  + 'Frage: Was war meine größte Ausgabe?\n'
  + '{"richtung":"aus","kategorie":null,"suche":null}\n'
  + 'Frage: Wann habe ich zuletzt Miete gezahlt?\n'
  + '{"richtung":"aus","kategorie":"housing","suche":null}\n'
  + 'Frage: Wie viel Geld habe ich von Nadine bekommen?\n'
  + '{"richtung":"ein","kategorie":null,"suche":"Nadine"}\n'
  + 'Frage: Was ging an Papa?\n'
  + '{"richtung":"aus","kategorie":null,"suche":"Papa"}\n'
  + 'Frage: Was zahle ich für Spotify im Monat?\n'
  + '{"richtung":"aus","kategorie":null,"suche":"Spotify"}\n'
  + 'Frage: How much do I spend on eating out per month?\n'
  + '{"richtung":"aus","kategorie":"dining","suche":null}\n';
// i18n-data-end

/** Room for the line of JSON (about 30 tokens), with some to spare. */
export const ASK_MAX_TOKENS = 96;

/** The question's own part of the prompt, after the list: the user's own categories (their ids and names), the question. */
export function askText(question: string, own: readonly { id: string; name: string }[] = []): string {
  const mine = own.length ? `Eigene Kategorien: ${own.map((c) => `${c.id} (${c.name})`).join(', ')}\n` : ''; // i18n-data
  return `${ASK_CATEGORY_LIST}${mine}\nFrage: ${question.trim()}\n`; // i18n-data
}

// ---------------------------------------------------------------------------
// Reading Nano's line

/** What Nano read the question as: no period or kind of answer — the question's own words give those. */
export type NanoReading = { dir: AskDir | null; category: CategoryId | null; search: string | null };

const DIRS: Record<string, AskDir> = { aus: 'out', ein: 'in', alle: 'all' }; // i18n-data
const FIELDS = ['richtung', 'kategorie', 'suche'];

/** Nano's fields: its JSON, or — cut off, fenced, spread over lines — what can be read of it. */
function fieldsOf(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const raw = JSON.parse(text.slice(start, end + 1)) as unknown;
      if (raw && typeof raw === 'object' && FIELDS.some((f) => f in raw)) return raw as Record<string, unknown>;
    } catch {
      // Read it field by field below.
    }
  }
  const out: Record<string, unknown> = {};
  for (const m of text.matchAll(/"(richtung|kategorie|suche)"\s*:\s*(?:"([^"\n]*)"|null)/g)) {
    if (!(m[1] in out)) out[m[1]] = m[2] ?? null;
  }
  return Object.keys(out).length ? out : null;
}

/** Nano's line as a reading, or null when it holds none. */
export function parseAskAnswer(
  answer: string | null | undefined,
  own: readonly { id: string; name: string }[] = [],
): NanoReading | null {
  const raw = fieldsOf(String(answer ?? ''));
  if (!raw) return null;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const categoryRaw = str(raw.kategorie);
  const category: CategoryId | null = (ASKABLE as readonly string[]).includes(categoryRaw)
    ? (categoryRaw as CategoryId)
    : own.some((c) => c.id === categoryRaw) ? (categoryRaw as CategoryId) : null;
  const search = str(raw.suche).replace(/^["'„“]+|["'“”]+$/g, '').slice(0, 40);
  return {
    dir: DIRS[str(raw.richtung).toLowerCase()] ?? null,
    category,
    search: search && search.toLowerCase() !== 'null' ? search : null,
  };
}

// ---------------------------------------------------------------------------
// What the question says in so many words, by rule

// i18n-data-start — words people type, folded (lib/categorize.ts foldText)
/**
 * Each category's words, as they begin a word of the question (German and
 * English); the first category with a match is the question's. Income comes
 * before housing ("Rente" is no rent), mobility before taxes ("Taxi").
 */
const CATEGORY_WORDS: Array<[BuiltinCategoryId, string[]]> = [
  ['income', ['GEHALT', 'LOHN', 'RENTE', 'EINNAHME', 'EINKOMMEN', 'SALARY', 'INCOME', 'WAGES', 'PENSION']],
  ['cash', ['BARGELD', 'GELDAUTOMAT', 'ABGEHOBEN', 'ABHEBUNG', 'CASH', 'ATM', 'WITHDRAW']],
  ['housing', ['MIETE', 'WOHNEN', 'WOHNUNG', 'STROM', 'NEBENKOSTEN', 'HEIZ', 'RENT', 'ELECTRICITY', 'UTILIT']],
  ['groceries', ['LEBENSMITTEL', 'SUPERMARKT', 'EINKAEUFE', 'EINKAUF', 'BAECKER', 'DROGERIE', 'GROCER', 'SUPERMARKET']],
  ['mobility', ['TANKEN', 'GETANKT', 'TANKSTELLE', 'BENZIN', 'SPRIT', 'BAHN', 'PARKEN', 'WERKSTATT', 'TAXI', 'FUEL', 'PETROL', 'TRAIN', 'PARKING']],
  ['shopping', ['SHOPPING', 'KLEIDUNG', 'KLAMOTTEN', 'ELEKTRONIK', 'MOEBEL', 'ONLINE SHOP', 'CLOTHES', 'CLOTHING']],
  ['dining', [
    'RESTAURANT', 'ESSEN GEHEN', 'ESSEN BESTELL', 'AUSWAERTS', 'LIEFERDIENST', 'GASTRONOMIE', 'IMBISS', 'CAFES', 'KNEIPE',
    'DOENER', 'SUSHI', 'FAST FOOD', 'EATING OUT', 'DINING', 'TAKEAWAY', 'TAKE AWAY', 'FOOD DELIVERY',
    'GEGESSEN', 'EAT OUT', 'ATE OUT', 'TAKEOUT',
  ]],
  ['leisure', [
    'FREIZEIT', 'KINO', 'KONZERT', 'THEATER', 'URLAUB', 'HOTEL', 'FITNESS', 'VIDEOSPIEL', 'GAMES', 'GAMING', 'CINEMA',
    'CONCERT', 'HOLIDAY', 'VACATION', 'GYM',
  ]],
  ['media', ['ABOS', 'ABONNEMENT', 'STREAMING', 'MUSIK', 'MOBILFUNK', 'HANDYVERTRAG', 'SUBSCRIPTION', 'MUSIC']],
  ['health', ['APOTHEKE', 'ARZT', 'AERZT', 'GESUNDHEIT', 'MEDIKAMENT', 'PHARMACY', 'DOCTOR', 'HEALTH']],
  ['insurance', ['VERSICHERUNG', 'INSURANCE']],
  ['taxes', ['STEUER', 'FINANZAMT', 'RUNDFUNK', 'TAXES']],
  ['fees', ['GEBUEHR', 'KONTOFUEHRUNG', 'ENTGELT', 'BANK FEES']],
  ['savings', ['SPAREN', 'GESPART', 'SPARPLAN', 'DEPOT', 'ETF', 'SAVINGS']],
];

/** Words that are no name to look for: what Nano sometimes copies from the question, what follows "für" or "an". */
const NOT_A_SEARCH = new Set(
  ('GELD AUSGABE AUSGABEN AUSGEGEBEN EINNAHMEN UMSATZ UMSAETZE BUCHUNG BUCHUNGEN KONTO ZAHLUNG ZAHLUNGEN UEBERWEISUNG UEBERWEISUNGEN '
    + 'ALLES INSGESAMT MICH MIR MEIN MEINE MEINEN MEINEM MEINER DEN DIE DAS DEM DER EIN EINE EINEN SACHEN DINGE '
    + 'WEN WEM WER WAS WELCHE WELCHEN WELCHEM WELCHER WELCHES IHR IHM IHN IHNEN SIE ER ES UNS EUCH DIR DICH DU '
    + 'MONEY SPENDING SPENT PAYMENTS PAYMENT ALL TOTAL AVERAGE ME MY THE IT THAT THIS THINGS STUFF HER HIM THEM WHOM WHO WHICH YOU MOST OFTEN').split(' '),
);

const KIND_RULES: Array<[RegExp, AskKind]> = [
  [/\bZULETZT\b|\bLETZTE[SN]? MAL\b|^WANN\b|\bLAST TIME\b|^WHEN\b|\bMOST RECENT\b|\bLETZTE[NSR]? (?:BUCHUNG|UMSATZ|ZAHLUNG|UEBERWEISUNG|EINGANG|ABBUCHUNG)\b|\bLAST (?:PAYMENT|TRANSACTION|BOOKING|TRANSFER)\b/, 'last'],
  [/\b(?:GROESSTE[NMRS]?|TEUERSTE[NMRS]?|HOECHSTE[NMRS]?|LARGEST|BIGGEST|HIGHEST|MOST EXPENSIVE)\b/, 'largest'],
  [/\bWIE OFT\b|\bWIE HAEUFIG\b|\bWIE VIELE (?:MAL|BUCHUNGEN|UMSAETZE|ZAHLUNGEN)\b|\bANZAHL\b|\bHOW OFTEN\b|\bHOW MANY\b/, 'count'],
  [/\bPRO MONAT\b|\bIM MONAT\b|\bMONATLICH|\bIM SCHNITT\b|\bDURCHSCHNITT|\bPER MONTH\b|\bA MONTH\b|\bMONTHLY\b|\bAVERAGE\b/, 'average'],
];

/**
 * An average per year: "pro Jahr", "im Jahr", "jährlich", "a year". Not "im
 * Jahr 2025" (a period), not "half a year" or "a year ago".
 */
const PER_YEAR = /\bPRO JAHR\b|\bIM JAHRE?\b(?! (?:19|20)\d\d\b| DAVOR\b| ZUVOR\b| VORHER\b)|\bJAEHRLICH|\bJEDES JAHR\b|\bAUFS JAHR\b|\bAUF EIN JAHR\b|\bJAHRES(?:SCHNITT|DURCHSCHNITT)\b|\bPER YEAR\b|(?<!\bHALF )\bA YEAR\b(?! AGO\b)|\bEVERY YEAR\b|\bYEARLY\b|\bANNUAL(?:LY)?\b|\bPER ANNUM\b/;
/** An average said per month in so many words ("im Schnitt" alone says neither). */
const PER_MONTH = /\bPRO MONAT\b|\bIM MONAT\b|\bMONATLICH|\bPER MONTH\b|\bA MONTH\b|\bMONTHLY\b/;

/** The bookings themselves: "Zeig alle Zahlungen an Amazon", "Liste Rewe", "alle Umsätze bei Rewe", "Show me all …". */
const LIST = new RegExp(
  '^(?:BITTE |KANNST DU (?:MIR )?|PLEASE |CAN YOU )?(?:ZEIG|SHOW|LIST)\\b|\\bZEIG(?:E|ST)?\\b|\\bANZEIGEN\\b|\\bAUFLISTEN\\b|\\bLISTE\\b'
  + '|\\bSHOW ME\\b|\\bLIST (?:ALL|MY|EVERY)\\b'
  + '|\\bALLE (?:(?:MEINE[NR]? |DIE )?(?:ZAHLUNGEN|BUCHUNGEN|UMSAETZE|UEBERWEISUNGEN|ABBUCHUNGEN|LASTSCHRIFTEN|EINKAEUFE|AUSGABEN|EINGAENGE|BESTELLUNGEN) )?(?:AN|VON|VOM|BEI|BEIM|FUER)\\b'
  + '|\\bALL (?:(?:MY|THE) )?(?:PAYMENTS|TRANSACTIONS|TRANSFERS|PURCHASES|CHARGES|BOOKINGS)\\b',
);
/** A total asked for: "Zeig mir, wie viel …" is a sum, not a list. */
const ASKS_TOTAL = /\bWIE ?VIEL\b|\bINSGESAMT\b|\bZUSAMMEN\b|\bSUMME\b|\bHOW MUCH\b|\bIN TOTAL\b|\bTOTAL\b/;

/** A ranking: "am meisten", "am häufigsten", "Top 5" … — and of what, and by what. */
const RANK = /\bAM (?:MEISTEN|HAEUFIGSTEN|OEFTESTEN)\b|\bMEISTE[NS]? GELD\b|\bDIE MEISTEN\b|\b(?:TEUERSTEN|GROESSTEN|HOECHSTEN|BIGGEST|LARGEST|TOP) (?:KATEGORIEN|POSTEN|HAENDLER|LAEDEN|SHOPS|EMPFAENGER|CATEGORIES|MERCHANTS|STORES|PAYEES)\b|\bMOST\b|\bTOP(?: \d+)?\b|\bRANGLISTE\b|\bRANKING\b|\bHAUPTAUSGABEN\b|\bGROESSTEN (?:POSTEN|AUSGABEPOSTEN|KATEGORIEN)\b/;
const PLACES = '(?:LAEDEN|LADEN|HAENDLERN?|SHOPS?|GESCHAEFTEN?|FIRMEN|FIRMA|EMPFAENGERN?|RESTAURANTS?|CAFES?|SUPERMAERKTEN?|SUPERMARKT|TANKSTELLEN?|TANKEN?|STORES?|MERCHANTS?|PAYEES?)';
const RANK_PAYEE = new RegExp(`(?:^| )(?:WO|WER|BEI WEM|AN WEN|VON WEM|WELCHE[NMRS]? ${PLACES}|${PLACES}|WHERE|WHO|WHICH ${PLACES})(?= |$)`);
/** A question for the places themselves ("Wo war ich essen?", "Und wo?", "Where did I shop?"): a ranking by payee, without "am meisten". */
const WHERE = new RegExp(`^(?:UND )?WO(?= |$)|(?:^| )WO (?:WAR|WAREN|HABE|HAB|BIN|KAUFE|KAUFTE|GEHE|ESSE|TANKE|TANKTE)(?= |$)|(?:^| )BEI WEM(?= |$)|(?:^| )WHERE(?= |$)|(?:^| )(?:WELCHE[NMRS]?|WHICH) ${PLACES}(?= |$)`);
const RANK_COUNT = /\bAM (?:HAEUFIGSTEN|OEFTESTEN)\b|\bMOST OFTEN\b|\bHOW OFTEN\b|\bMEISTEN (?:BUCHUNGEN|UMSAETZE|ZAHLUNGEN|EINKAEUFE)\b|\bMOST (?:TRANSACTIONS|PAYMENTS|PURCHASES)\b/;
/** A comparison: needs a period on top ("mehr als 100 Euro" is none). */
const COMPARE = /\bVERGLICHEN MIT\b|\bIM VERGLEICH\b|\bVERGLEICH\b|\bVS\b|\bVERSUS\b|\bGEGENUEBER\b|\b(?:HOEHER|NIEDRIGER|HIGHER|LOWER)\b|\b(?:MEHR|WENIGER)\b.*\bALS\b|\b(?:MORE|LESS)\b.*\bTHAN\b|\bCOMPARED\b|\bCOMPARE\b/;

/** What a ranking is of, where the question says it: payees ("wo", "Händler") or categories ("wofür", "Kategorien"); null otherwise. */
export function rankByFromQuestion(question: string): AskRank['by'] | null {
  const text = fold(question);
  if (RANK_PAYEE.test(text) || WHERE.test(text)) return 'payee';
  return /\bWOFUER\b|\bKATEGORIE|\bWHAT (?:DO I|DID I) SPEND\b|\bCATEGOR/.test(text) ? 'category' : null;
}

/** A ranking the question asks for, or null. */
export function rankFromQuestion(question: string): AskRank | null {
  const text = fold(question);
  if (!RANK.test(text)) return WHERE.test(text) ? { by: 'payee', metric: RANK_COUNT.test(text) ? 'count' : 'sum' } : null;
  return { by: RANK_PAYEE.test(text) ? 'payee' : 'category', metric: RANK_COUNT.test(text) ? 'count' : 'sum' };
}

/** What a running period is set against when the question names only one side. */
function runningOf(other: AskPeriod): AskPeriod | null {
  if (other.kind === 'lastMonth' || other.kind === 'month') return { kind: 'thisMonth' };
  if (other.kind === 'lastYear' || other.kind === 'year') return { kind: 'thisYear' };
  return null;
}

/** The previous period of a running one ("diesen Monat mehr?" is against last month). */
function previousOf(running: AskPeriod): AskPeriod | null {
  if (running.kind === 'thisMonth') return { kind: 'lastMonth' };
  if (running.kind === 'thisYear') return { kind: 'lastYear' };
  return null;
}

/**
 * The two periods a comparison sets against each other — the first named
 * first — or null when the question compares nothing or names no period.
 */
export function compareFromQuestion(question: string, today: string): { period: AskPeriod; against: AskPeriod } | null {
  const text = fold(question);
  // "gegen" compares only between two periods ("2026 gegen 2025"); "gegen Hagel", "gegen Mitte September" do not.
  const loose = !COMPARE.test(text) && /\bGEGEN\b/.test(text);
  if (!COMPARE.test(text) && !loose) return null;
  const periods = periodsFromQuestion(question, today);
  if (periods.length >= 2) return { period: periods[0], against: periods[1] };
  if (loose) return null;
  if (periods.length === 1) {
    const [only] = periods;
    const running = runningOf(only);
    if (running) return { period: running, against: only };
    const previous = previousOf(only);
    if (previous) return { period: only, against: previous };
  }
  return null;
}

/** Words that say the money went out or came in; prepositions only where no such word does. */
const OUT_WORDS = /\b(?:AUSGEGEBEN|AUSGABE|AUSGABEN|ABBUCHUNG|ABBUCHUNGEN|LASTSCHRIFT|LASTSCHRIFTEN|BEZAHLT|GEZAHLT|ZAHLE|ZAHLT|KOSTET|KOSTEN|GEKOSTET|UEBERWIESEN|ABGEBUCHT|BERECHNET|ABGEZOGEN|EINGEZOGEN|SPENT|SPEND|PAID|PAY|COST|COSTS|CHARGED)\b/;
/** Words for money taken, which "hat mir" does not turn around: "Was hat mir Vodafone abgebucht?" is money out. */
const DEBIT_WORDS = /\b(?:ABGEBUCHT|BERECHNET|ABGEZOGEN|EINGEZOGEN|KOSTET|KOSTEN|GEKOSTET|CHARGED|COST|COSTS)\b/;
const IN_WORDS = /BEKOMMEN|\b(?:ERHALTEN|EINGEGANGEN|EINGAENGE|EINGANG|EINGENOMMEN|EINNAHME|EINNAHMEN|VERDIENT|ERSTATTET|RECEIVED|EARNED|INCOME|REFUND)/;
const OUT_TO = /\b(?:AN|BEI|FUER|TO|AT)\b/;
/**
 * Money to the asker: "Wer hat mir … überwiesen", "Was hat mir Lea geschickt", "Who sent me …",
 * "How much did Lea send me?". Only with someone doing it: "Give me my spending at Amazon" and
 * "Send me my Rewe total" ask the app for something and are no money in.
 */
const TO_ME = /\b(?:HAT|HABEN|HAETTE) MIR\b|\bAN MICH\b|\b\w+ (?:SENT|TRANSFERRED) ME\b|\b(?:DID|DOES|DO|HAS|HAVE|WILL) (?:\w+ ){1,3}(?:SEND|SENT|GIVE|GIVEN|PAY|PAID|TRANSFER|TRANSFERRED) ME\b|\b(?:PAID|GAVE|PAYS) ME\b|\bG(?:O|E)T PAID\b|\bBEEN PAID\b/;
/** Both ways in so many words: "Ein- und Ausgaben", "Einnahmen und Ausgaben", "income and spending". */
const BOTH_WAYS = /\bEIN UND AUSGABEN\b|\bEINNAHMEN UND AUSGABEN\b|\bAUSGABEN UND EINNAHMEN\b|\bINCOME AND (?:SPENDING|EXPENSES)\b|\b(?:SPENDING|EXPENSES) AND INCOME\b/;
const IN_FROM = /\b(?:VON|VOM|FROM)\b/;

/** The words before a name: "an Amazon", "bei Rewe", "von Nadine", "für Netflix", "on Uber". */
const BEFORE_NAME = /(?:^|[\s,(])(?:an|bei|beim|von|vom|für|fuer|to|from|at|on|for)\s+(?:(?:den|die|das|dem|der|meine[nmr]?|my|the)\s+)?/giu;
/** The name after them: a word, and one more ("Amazon Prime"). */
const NAME_AT = /^([\p{L}\p{N}][\p{L}\p{N}&'.\-]*)(?:\s+([\p{L}\p{N}][\p{L}\p{N}&'.\-]*))?/u;

const MONTHS_DE = ['JANUAR', 'FEBRUAR', 'MAERZ', 'APRIL', 'MAI', 'JUNI', 'JULI', 'AUGUST', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DEZEMBER'];
const MONTHS_EN = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const SHORT = ['JAN', 'FEB', 'MRZ', 'APR', 'MAI', 'JUN', 'JUL', 'AUG', 'SEP', 'OKT', 'NOV', 'DEZ'];
const NUMBERS: Record<string, number> = {
  ZWEI: 2, DREI: 3, VIER: 4, FUENF: 5, SECHS: 6, SIEBEN: 7, ACHT: 8, NEUN: 9, ZEHN: 10, ZWOELF: 12,
  TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7, EIGHT: 8, NINE: 9, TEN: 10, TWELVE: 12,
};
const LAST_N = '(?:LETZTE[NR]?|VERGANGENE[NR]?|PAST|LAST)';
const RULES: Array<[RegExp, (m: RegExpExecArray) => AskPeriod]> = [
  [/\bHEUTE\b|\bTODAY\b/, () => ({ kind: 'today' })],
  [/\b(?:LETZTE[NMR]?|VORIGE[NMR]?|VERGANGENE[NMR]?) MONAT\b|\bVORMONAT\b|\bLAST MONTH\b|\bPREVIOUS MONTH\b/, () => ({ kind: 'lastMonth' })],
  [/\b(?:DIESE[NMR]?|LAUFENDE[NMR]?) MONAT\b|\bTHIS MONTH\b/, () => ({ kind: 'thisMonth' })],
  [/\b(?:LETZTE[NMS]?|VORIGE[NMS]?|VERGANGENE[NMS]?) JAHR\b|\bVORJAHR\b|\bLAST YEAR\b/, () => ({ kind: 'lastYear' })],
  [/\b(?:DIESE[NMS]?|LAUFENDE[NMS]?|GANZE[NS]?) JAHR\b|\bHEUER\b|\bWHOLE YEAR\b|\bTHIS YEAR\b|\bSEIT JANUAR\b|\bSEIT (?:ANFANG|BEGINN) (?:DES|DIESES) JAHRES\b|\bSEIT JAHRES(?:ANFANG|BEGINN)\b|\bSINCE THE (?:START|BEGINNING) OF THE YEAR\b|\bYEAR TO DATE\b|\bYTD\b/, () => ({ kind: 'thisYear' })],
  [/\bHALBE[NS]? JAHR\b|\bHALF A YEAR\b|\bSECHS MONATE/, () => ({ kind: 'months', months: 6 })],
  [new RegExp(`\\b${LAST_N} (\\d{1,3}|[A-Z]+) (TAGE?N?|DAYS|WOCHEN|WEEKS|MONATE?N?|MONTHS)\\b`), (m) => {
    const n = /^\d+$/.test(m[1]) ? +m[1] : NUMBERS[m[1]] ?? 0;
    if (n <= 0) return { kind: 'all' };
    return m[2].startsWith('MONAT') || m[2] === 'MONTHS' ? { kind: 'months', months: n }
      : m[2].startsWith('WOCHE') || m[2] === 'WEEKS' ? { kind: 'days', days: n * 7 } : { kind: 'days', days: n };
  }],
  [/\b(?:LETZTE[NR]?|VERGANGENE[NR]?|DIESE[NR]?) WOCHE\b|\b(?:LAST|THIS|PAST) WEEK\b/, () => ({ kind: 'days', days: 7 })],
];
// i18n-data-end

const fold = (s: string) => foldText(s).replace(/\s+/g, ' ');
const bare = (s: string) => foldText(s).replace(/[^A-Z0-9]/g, '');

/** The category the question names in its own words, or null. */
export function categoryFromQuestion(question: string): BuiltinCategoryId | null {
  const text = ` ${fold(question)}`;
  for (const [id, words] of CATEGORY_WORDS) if (words.some((w) => text.includes(` ${w}`))) return id;
  // "Wo war ich im Oktober essen?": "essen" with "wo" is eating out, whatever else the noun can mean.
  if (/ WO /.test(`${text} `) && / ESSEN(?= |$)/.test(text)) return 'dining';
  return null;
}

/** Whether a word is one for a category ("Tank", "Streaming"), not a name. */
function isCategoryWord(word: string): boolean {
  const w = fold(word);
  if (!w) return false;
  return CATEGORY_WORDS.some(([, words]) => words.some((c) => w.startsWith(c) || (w.length >= 4 && c.startsWith(w))));
}

/** Whether a word can be a name to look for: none for money, a time or a category. */
function isName(word: string): boolean {
  const w = fold(word);
  if (w.length < 2 || /^\d+$/.test(w)) return false;
  if (w.split(' ').every((p) => NOT_A_SEARCH.has(p))) return false;
  return monthIn(w) == null && !isCategoryWord(w) && !RULES.some(([re]) => re.test(w)) && !/^(?:MONAT|JAHR|WOCHE|TAG|MONTH|YEAR|WEEK|DAY)/.test(w);
}

/** A name the question puts after "an", "bei", "von", "für" …, as written there; or null. */
export function searchFromQuestion(question: string): string | null {
  for (const before of question.matchAll(BEFORE_NAME)) {
    const m = NAME_AT.exec(question.slice(before.index + before[0].length));
    if (!m) continue;
    // "bei Rewe Lebensmittel": the name, without the word that follows it; a
    // second word only when written as a name ("an Amazon Prime", not "an Mama gezahlt").
    const words = m[2] && /^[\p{Lu}\p{N}]/u.test(m[2]) ? [m[1], m[2]] : [m[1]];
    while (words.length && !isName(words[words.length - 1])) words.pop();
    const name = words.join(' ').replace(/[.?!,]+$/, '');
    if (name && isName(name)) return name;
  }
  return null;
}

/** What the question asks for in so many words ("wie oft", "pro Monat" …), or null. */
export function kindFromQuestion(question: string): AskKind | null {
  const text = fold(question);
  for (const [re, kind] of KIND_RULES) if (re.test(text)) return kind;
  if (PER_YEAR.test(text)) return 'average';
  return LIST.test(text) && !ASKS_TOTAL.test(text) ? 'list' : null;
}

/**
 * Whether an average is asked per month or per year in so many words; null
 * where the question says neither ("im Schnitt"). Per month where it says both.
 */
export function perFromQuestion(question: string): 'month' | 'year' | null {
  const text = fold(question);
  if (PER_MONTH.test(text)) return 'month';
  return PER_YEAR.test(text) ? 'year' : null;
}

/** Whether the question asks for a total ("wie viel", "insgesamt", "how much"). */
export function asksTotal(question: string): boolean {
  return ASKS_TOTAL.test(fold(question));
}

/**
 * A list's direction: both ways unless a word says which. "Buchungen von Lea"
 * are hers to you and yours to her; "an Amazon", "bei Rewe" go out.
 */
export function listDir(question: string, dir: AskDir | null): AskDir {
  if (saysDirection(question)) return dir ?? 'out';
  return dir === 'out' ? 'out' : 'all';
}

/** Whether the question has a word for money going out or coming in (not just "an", "bei", "von"). */
export function saysDirection(question: string): boolean {
  const text = fold(question);
  return TO_ME.test(text) || OUT_WORDS.test(text) || IN_WORDS.test(text);
}

/** Out or in, as the question's verbs say — or its "an"/"von" where no verb does; null where it says neither or both. */
export function dirFromQuestion(question: string): AskDir | null {
  const text = fold(question);
  if (BOTH_WAYS.test(text)) return 'all';
  if (TO_ME.test(text) && !DEBIT_WORDS.test(text)) return 'in';
  const out = OUT_WORDS.test(text);
  const into = IN_WORDS.test(text);
  if (out && into) return 'all';
  if (out) return 'out';
  if (into) return 'in';
  const to = OUT_TO.test(text);
  const from = IN_FROM.test(text);
  return to === from ? null : to ? 'out' : 'in';
}

/** 1–12 for a whole month name (German or English), or its short form before a year. */
function monthIn(word: string, beforeYear = false): number | null {
  const f = foldText(word).replace(/[^A-Z]/g, '');
  if (!f) return null;
  let i = MONTHS_DE.indexOf(f);
  if (i < 0) i = MONTHS_EN.indexOf(f);
  if (i < 0 && beforeYear) i = SHORT.indexOf(f);
  return i < 0 ? null : i + 1;
}

/**
 * The period the question names in so many words — "letzten Monat", "im
 * September", "seit Juli", "August 2025", "2025", "letzte 30 Tage", "die
 * letzten drei Monate" — or null. A month without its year is the last one of
 * that name up to today; a bare month word must be written out ("Mai", not
 * "Jan", which may be a name).
 */
export function periodFromQuestion(question: string, today: string): AskPeriod | null {
  const folded = fold(question);
  const part = partOfYear(folded, today);
  if (part) return part;
  for (const [re, make] of RULES) {
    const m = re.exec(folded);
    if (m) {
      const period = make(m);
      if (period.kind !== 'all') return period;
    }
  }
  const words = folded.split(/[^A-Z0-9]+/).filter(Boolean);
  const [year, month] = today.split('-').map(Number);
  for (let i = 0; i < words.length; i++) {
    const next = words[i + 1];
    const withYear = !!next && /^(?:19|20)\d{2}$/.test(next);
    const m = monthIn(words[i], withYear);
    if (m == null) continue;
    const y = withYear ? +next : m > month ? year - 1 : year;
    const at = `${y}-${String(m).padStart(2, '0')}`;
    return words[i - 1] === 'SEIT' || words[i - 1] === 'SINCE' ? { kind: 'since', month: at } : { kind: 'month', month: at };
  }
  const y = words.find((w) => /^(?:19|20)\d{2}$/.test(w));
  return y && +y <= year ? { kind: 'year', year: +y } : null;
}

// i18n-data-start — quarters and halves, German and English
// "Q1" alone may be a name (the fuel chain): a quarter only after "im", "in", "das" or before a year.
const QUARTER_NTH = /\b(?:(ERSTE|ZWEITE|DRITTE|VIERTE|FIRST|SECOND|THIRD|FOURTH)[NMS]? (?:QUARTAL|QUARTER)|(?:IM|IN|DAS|THE) Q([1-4])|Q([1-4])(?= (?:(?:19|20)\d{2}\b|(?:LETZTE|VORIGE)[NMS]? JAHR|VORJAHR|LAST YEAR)))\b/;
const LAST_YEAR_WORDS = /\b(?:(?:LETZTE|VORIGE|VERGANGENE)[NMS]? JAHR(?:ES)?|VORJAHR(?:ES)?|LAST YEAR)\b/;
const QUARTER_LAST = /\b(?:(?:LETZTE|VORIGE|VERGANGENE)[NMS]? QUARTAL|VORQUARTAL|LAST QUARTER|PREVIOUS QUARTER)\b/;
const QUARTER_THIS = /\b(?:(?:DIESE|LAUFENDE)[NMS]? QUARTAL|THIS QUARTER)\b/;
const HALF_NTH = /\b(?:(ERSTE|ZWEITE)[NMS]? HALBJAHR|(FIRST|SECOND) HALF)\b/;
const LAST_WEEKEND = /\b(?:(?:LETZTE|VORIGE|VERGANGENE)[NMS]? WOCHENENDE|LAST WEEKEND)\b/;
const MONTH_SPAN = /\b(?:ZWISCHEN|VON|BETWEEN|FROM) ([A-Z]+) (?:UND|BIS|AND|TO|UNTIL) ([A-Z]+)\b/;
const NTH: Record<string, number> = { ERSTE: 1, ZWEITE: 2, DRITTE: 3, VIERTE: 4, FIRST: 1, SECOND: 2, THIRD: 3, FOURTH: 4 };
// i18n-data-end

/** A quarter or half of a year the question names, as days; a part not yet begun this year is last year's. */
function partOfYear(folded: string, today: string): AskPeriod | null {
  const [year, month] = today.split('-').map(Number);
  const range = (y: number, first: number, months: number): AskPeriod => {
    const last = first + months - 1;
    const end = `${y}-${String(last).padStart(2, '0')}-${String(new Date(Date.UTC(y, last, 0)).getUTCDate()).padStart(2, '0')}`;
    return { kind: 'range', from: `${y}-${String(first).padStart(2, '0')}-01`, to: end < today ? end : today };
  };
  // A year the question names ("Q1 2025", "erstes Halbjahr letztes Jahr"); else this year's, or last year's for a part not yet begun.
  const named = /\b((?:19|20)\d{2})\b/.exec(folded);
  const namedYear = named && +named[1] <= year ? +named[1] : LAST_YEAR_WORDS.test(folded) ? year - 1 : null;
  const nth = (n: number, months: number) => {
    const first = (n - 1) * months + 1;
    return range(namedYear ?? (first > month ? year - 1 : year), first, months);
  };
  const thisQuarter = Math.floor((month - 1) / 3) + 1;
  let m: RegExpExecArray | null;
  if (LAST_WEEKEND.test(folded)) {
    // The Saturday and Sunday before this week (Monday its first day).
    const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
    const day = (add: number) => {
      const d = new Date(`${today}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + add);
      return d.toISOString().slice(0, 10);
    };
    return { kind: 'range', from: day(-weekday - 2), to: day(-weekday - 1) };
  }
  if ((m = MONTH_SPAN.exec(folded))) {
    const a = monthIn(m[1]);
    const b = monthIn(m[2]);
    if (a && b && a <= b) {
      const y = namedYear ?? (b > month ? year - 1 : year);
      return range(y, a, b - a + 1);
    }
  }
  if (QUARTER_THIS.test(folded) && namedYear == null) return nth(thisQuarter, 3);
  if (QUARTER_LAST.test(folded) && namedYear == null) return thisQuarter === 1 ? range(year - 1, 10, 3) : nth(thisQuarter - 1, 3);
  if ((m = QUARTER_NTH.exec(folded))) return nth(m[1] ? NTH[m[1]] : +(m[2] ?? m[3]), 3);
  if ((m = HALF_NTH.exec(folded))) return nth(NTH[m[1] ?? m[2]], 6);
  return null;
}

/** Every period the question names, in the order it names them ("diesen vs. letzten Monat"). */
export function periodsFromQuestion(question: string, today: string): AskPeriod[] {
  const folded = fold(question);
  const found: { at: number; end: number; period: AskPeriod }[] = [];
  const taken = (at: number, end: number) => found.some((f) => at < f.end && end > f.at);
  for (const [re, make] of RULES) {
    for (const m of folded.matchAll(new RegExp(re.source, 'g'))) {
      const period = make(m as RegExpExecArray);
      const at = m.index ?? 0;
      if (period.kind !== 'all' && !taken(at, at + m[0].length)) found.push({ at, end: at + m[0].length, period });
    }
  }
  // "letzten" alone after a period ("diesen vs. letzten Monat"): the same unit, one back.
  if (found.length === 1 && /\bVS\b|\bVERSUS\b|\bGEGENUEBER\b/.test(folded) && /\bLETZTE[NMRS]?\b|\bVORIGE[NMRS]?\b/.test(folded)) {
    const previous = previousOf(found[0].period);
    if (previous) found.push({ at: folded.length, end: folded.length, period: previous });
  }
  const [year, month] = today.split('-').map(Number);
  const words = [...folded.matchAll(/[A-Z0-9]+/g)];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const at = w.index ?? 0;
    if (taken(at, at + w[0].length)) continue;
    const next = words[i + 1]?.[0];
    const withYear = !!next && /^(?:19|20)\d{2}$/.test(next);
    const m = monthIn(w[0], withYear);
    if (m != null) {
      const y = withYear ? +next! : m > month ? year - 1 : year;
      const end = withYear ? (words[i + 1].index ?? 0) + next!.length : at + w[0].length;
      found.push({ at, end, period: { kind: 'month', month: `${y}-${String(m).padStart(2, '0')}` } });
      if (withYear) i++;
    } else if (/^(?:19|20)\d{2}$/.test(w[0]) && +w[0] <= year) {
      found.push({ at, end: at + w[0].length, period: { kind: 'year', year: +w[0] } });
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.period);
}

/**
 * The search the question asks for: Nano's reading (null when it gave none),
 * with what the question says plainly in its place. Null only when neither
 * found anything to search by.
 */
export function readQuestion(
  question: string,
  nano: NanoReading | null,
  today: string,
  own: readonly { id: string; name: string }[] = [],
): AskQuery | null {
  const q = question.trim();
  // Nano's name must stand in the question, and be one; else the question's own "an …", "bei …".
  const nanoName = nano?.search && isName(nano.search) && bare(q).includes(bare(nano.search)) ? nano.search : null;
  const search = nanoName ?? searchFromQuestion(q);
  const ownNamed = own.find((c) => c.name.trim() && ` ${fold(q)} `.includes(` ${fold(c.name)} `));
  const rank = rankFromQuestion(q);
  // A ranking takes a category only from the question's own words: Nano read
  // "Wo kaufe ich am häufigsten ein?" as Lebensmittel, which would rank the supermarkets alone.
  const named = (ownNamed?.id as CategoryId | undefined) ?? categoryFromQuestion(q);
  let category: CategoryId | null = named ?? (rank ? null : nano?.category ?? null);
  let hint: CategoryId | null = null;
  // A name beats a category: "Amazon" is every Amazon booking, whichever category each is in.
  if (search && category) {
    hint = category;
    category = null;
  }
  const compare = rank ? null : compareFromQuestion(q, today);
  const period = compare?.period ?? periodFromQuestion(q, today);
  const kind: AskKind | null = rank ? 'rank' : compare ? 'compare' : kindFromQuestion(q);
  const dir = dirFromQuestion(q);
  if (!nano && !search && !category && !period && !kind && !dir) return null;
  return {
    ...(rank ? { rank } : {}),
    ...(compare ? { against: compare.against } : {}),
    ...(kind === 'average' && perFromQuestion(q) === 'year' ? { per: 'year' as const } : {}),
    kind: kind ?? 'sum',
    // Income is what comes in, whatever else was said of the direction.
    dir: category === 'income' ? 'in' : kind === 'list' ? listDir(q, dir) : dir ?? nano?.dir ?? 'out',
    category,
    search,
    period: period ?? { kind: 'all' },
    hint,
  };
}

// ---------------------------------------------------------------------------
// The desktop's reading (6.0): no Nano, the built-in model
//
// The rules above read what the question says in so many words, as on the
// phone. What Nano adds there comes from two other places here: the name is
// looked for among the user's own payees ("Was zahle ich für Netflix" finds
// the Netflix in the bookings, whatever stands before it), and the category
// from the category model (lib/category-model.ts questionCategory), which
// reads what is left of the question — "Essen gehen", "Klamotten" — the way
// it reads a booking.

// i18n-data-start — question words that are neither topic nor name, folded
const NOT_TOPIC = new Set(
  ('OFT HAEUFIG HAEUFIGSTEN OEFTESTEN MEISTEN MEISTE MEISTES PRO DURCHSCHNITT DURCHSCHNITTLICH SCHNITT GROESSTE GROESSTEN '
    + 'TEUERSTE TEUERSTEN HOECHSTE HOECHSTEN WANN ZULETZT WO WER WEM WEN WELCHE WELCHER WELCHEN WELCHEM WELCHES SUMME GESAMT '
    + 'KOSTEN KOSTET GEKOSTET ZAHLE ZAHLT ZAHLST ES SIND IST WAR WAREN HATTE HATTEN HABEN HAST WIR DU MIR MICH UNS EIN EINE EINEN '
    + 'EINEM EINER INSGESAMT ETWA UNGEFAEHR DENN EIGENTLICH SO NOCH SCHON MEHR WENIGER ALS GEGENUEBER VERGLICHEN VERGLEICH MIT '
    + 'ZU ZUM ZUR AUF AUS NACH UEBER UNTER FUERS INS BIS DAFUER DAVON MONATLICH JAEHRLICH WOECHENTLICH TAEGLICH AUSGEBEN BEZAHLE '
    + 'GEBE GEBEN GEGEBEN KAUFE KAUFT GEKAUFT EINGEKAUFT EINKAUFEN JEDES AUFS '
    + 'HOW MUCH MANY OFTEN AVERAGE PER BIGGEST LARGEST HIGHEST WHEN WHERE WHO WHOM WHICH WHAT DID DO DOES I WE YOU IS ARE WAS WERE '
    + 'HAVE HAS HAD IN ON AT BY WITH ABOUT A AN MORE LESS THAN COMPARED VS MONTHLY YEARLY WEEKLY ANNUAL ANNUALLY ANNUM EVERY BUY BOUGHT PAY SPEND COST').split(' '),
);
// i18n-data-end

const wordsOf = (question: string) => question.split(/\s+/).map((w) => w.replace(/^[„“"'(]+|[?!.,;:„“"')]+$/g, '')).filter(Boolean);

/** Whether a word of a question says nothing of what it is about: a filler, a time, money, the kind of answer. */
function noTopic(word: string): boolean {
  const w = fold(word);
  if (w.length < 2 || /^\d+$/.test(w)) return true;
  if (NOT_SEARCHED.has(w) || NOT_A_SEARCH.has(w) || NOT_TOPIC.has(w)) return true;
  return monthIn(w, true) != null || RULES.some(([re]) => re.test(w));
}

/**
 * What a question is about, for the category model: its words without the
 * fillers, times, money words and kinds of answer — "Wie viel habe ich
 * letzten Monat für Essen gehen ausgegeben?" is "Essen gehen". Empty when
 * nothing is left.
 */
export function questionTopic(question: string): string {
  return wordsOf(question).filter((w) => !noTopic(w)).join(' ');
}

/**
 * The name a question asks about, as written there, when it is one of the
 * user's own payees: a word (or two in a row) that begins a word of a payee's
 * name — "Netflix" for "NETFLIX.COM", "Rewe" for "REWE Markt GmbH". Two words
 * before one; the first in the question wins. `payees` are the names the
 * bookings in view are listed under.
 */
export function nameFromPayees(question: string, payees: readonly string[]): string | null {
  const all = wordsOf(question);
  const words = all.filter((w) => !noTopic(w) && isName(w));
  if (!payees.length) return null;
  const payeeWords = new Set<string>();
  const payeeTexts: string[] = [];
  for (const p of payees) {
    const parts = fold(p).split(/[^A-Z0-9&]+/).filter(Boolean);
    parts.forEach((x) => payeeWords.add(x));
    payeeTexts.push(` ${parts.join(' ')} `);
  }
  const known = [...payeeWords];
  const begins = (w: string) => {
    const b = bare(w);
    return b.length >= 3 && known.some((x) => x.startsWith(b) && (b.length >= 4 || x.length === b.length));
  };
  // Two words in a row as a payee has them ("Deutsche Bahn"), even where the second alone would be a category's.
  for (let i = 0; i + 1 < all.length; i++) {
    if (noTopic(all[i]) || noTopic(all[i + 1]) || bare(all[i]).length < 2) continue;
    const two = ` ${bare(all[i])} ${bare(all[i + 1])} `;
    if (payeeTexts.some((t) => t.includes(two))) return `${all[i]} ${all[i + 1]}`;
  }
  return words.find(begins) ?? null;
}

// ---------------------------------------------------------------------------
// The Umsätze search, read the same way (Android, 5.9.0)

// i18n-data-start — words of a search that are no name, folded
/** Time words and fillers a search leaves out of the text it searches for. */
const NOT_SEARCHED = new Set(
  ('IM IN AM VOM VON BEI BEIM AN FUER FUR DER DIE DAS DEN DEM DES UND ODER ALLE ALLES MEIN MEINE MEINEN MEINER MEINEM '
    + 'WAS WIE VIEL VIELE ICH HABE HAB AUSGEGEBEN BEKOMMEN BEZAHLT GEZAHLT ZAHLUNG ZAHLUNGEN UMSATZ UMSAETZE BUCHUNGEN '
    + 'AUSGABE AUSGABEN EINNAHME EINNAHMEN EINGANG EINGAENGE GELD '
    + 'LETZTE LETZTEN LETZTER LETZTES LETZTEM DIESE DIESEN DIESER DIESES DIESEM VORIGE VORIGEN VORIGER VORIGES '
    + 'VERGANGENE VERGANGENEN VERGANGENER LAUFENDE LAUFENDEN LAUFENDER MONAT MONATE MONATEN JAHR JAHRES WOCHE WOCHEN '
    + 'TAG TAGE TAGEN HEUTE HEUER SEIT HALBE HALBEN HALBES VORMONAT VORJAHR '
    + 'ZWEI DREI VIER FUENF SECHS SIEBEN ACHT NEUN ZEHN ZWOELF '
    + 'THE AT ON FOR FROM TO OF AND MY ALL SPENT SPENDING PAID PAYMENTS INCOME LAST THIS PAST SINCE MONTH MONTHS YEAR '
    + 'WEEK WEEKS DAY DAYS TODAY').split(' '),
);
const SEARCH_IN = /\b(?:EINNAHMEN?|EINGAENGE|EINGANG|BEKOMMEN|INCOME|RECEIVED)\b/;
const SEARCH_OUT = /\b(?:AUSGABEN?|AUSGEGEBEN|BEZAHLT|SPENT|SPENDING)\b/;
// i18n-data-end

/**
 * A search in the Umsätze list read as its filters — "Tanken im August" as
 * Mobilität in August, "Amazon letzten Monat" as "Amazon" last month — or
 * null for a plain search ("Rewe", "4711"), which stays text. By rule alone,
 * so it is instant; what is left of the words is the text searched for. Only
 * what the words name is returned: the rest of the filter stays as it was.
 */
export function searchAsFilter(
  text: string,
  today: string,
  own: readonly { id: string; name: string }[] = [],
): Pick<TxFilter, 'query'> & Partial<Pick<TxFilter, 'dir' | 'category' | 'from' | 'to'>> | null {
  const q = text.trim();
  if (!q) return null;
  const folded = fold(q);
  const period = periodFromQuestion(q, today);
  const ownNamed = own.find((c) => c.name.trim() && ` ${folded} `.includes(` ${fold(c.name)} `));
  const category = (ownNamed?.id as CategoryId | undefined) ?? categoryFromQuestion(q);
  const dir: TxFilter['dir'] | null = category === 'income' || SEARCH_IN.test(folded) ? 'in' : SEARCH_OUT.test(folded) ? 'out' : null;
  if (!period && !category && !dir) return null;
  const ownWords = new Set(ownNamed ? fold(ownNamed.name).split(' ') : []);
  const rest = q.split(/\s+/).filter((word) => {
    const w = fold(word);
    if (!w) return false;
    if (NOT_SEARCHED.has(w) || ownWords.has(w) || isCategoryWord(w) || monthIn(w, true) != null) return false;
    // A year, or the number in "letzte 30 Tage".
    return !(/^\d+$/.test(w) && period);
  });
  // Only what the words name changes; a month picked before stays for "Ausgaben bei Rewe".
  const days = period ? periodDays(period, today) : null;
  return {
    query: rest.join(' ').replace(/[?!.,;]+$/, ''),
    ...(dir ? { dir } : {}),
    ...(category ? { category } : {}),
    ...(period ? { from: days?.from, to: days?.to } : {}),
  };
}

// ---------------------------------------------------------------------------
// The days a period spans

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The day after the same day `n` months before (the 31st where that month is shorter: its last). */
function monthsBack(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const total = y * 12 + (m - 1) - n;
  const py = Math.floor(total / 12);
  const pm = (total % 12) + 1;
  return addDays(`${py}-${pad(pm)}-${pad(Math.min(d, lastDay(py, pm)))}`, 1);
}

/** First and last day of a period (yyyy-mm-dd, both included, never after today); null for all time. */
export function periodDays(period: AskPeriod, today: string): { from: string; to: string } | null {
  const [y, m] = today.split('-').map(Number);
  const clip = (to: string) => (to > today ? today : to);
  switch (period.kind) {
    case 'all': return null;
    case 'today': return { from: today, to: today };
    case 'thisMonth': return { from: `${y}-${pad(m)}-01`, to: today };
    case 'lastMonth': {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(lastDay(py, pm))}` };
    }
    case 'thisYear': return { from: `${y}-01-01`, to: today };
    case 'lastYear': return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case 'month': {
      const [py, pm] = period.month.split('-').map(Number);
      return { from: `${period.month}-01`, to: clip(`${period.month}-${pad(lastDay(py, pm))}`) };
    }
    case 'since': return { from: `${period.month}-01`, to: today };
    case 'year': return { from: `${period.year}-01-01`, to: clip(`${period.year}-12-31`) };
    case 'days': return { from: addDays(today, -(period.days - 1)), to: today };
    case 'months': return { from: monthsBack(today, period.months), to: today };
    case 'range': return { from: period.from, to: clip(period.to) };
  }
}

// ---------------------------------------------------------------------------
// The answer, worked out from the loaded bookings

export type AskAnswer = {
  /** The search answered: the one asked, or — where its name found nothing — Nano's category instead. */
  query: AskQuery;
  /** What the Umsätze list shows for "Umsätze zeigen" — the same bookings the answer counts. */
  filter: TxFilter;
  /** The days counted: the asked period within what is loaded. */
  from: string;
  to: string;
  /** The asked period starts before the loaded bookings: a sum is then at least this much. */
  partial: boolean;
  /** No loaded booking lies in the asked period at all. */
  outside: boolean;
  count: number;
  /** Cents, as a positive figure: what went out or came in (dir 'all': out and in apart). */
  cents: number;
  outCents: number;
  inCents: number;
  /** The largest or the latest booking, for those questions. */
  tx: SerializedTransaction | null;
  /** For a per-month average: over how many whole months loaded; 0 when none is. */
  months: number;
  /** Cents like `cents`, of the bookings inside those whole months only: what the average divides. 0 when none is. */
  monthCents: number;
  /**
   * An average per year, when a whole month is loaded: with 12 or more whole
   * months the real sum of the last 12 (`last12`), else the monthly average
   * over all of them times 12.
   */
  year?: { cents: number; last12: boolean };
  /** Matching bookings in a currency other than the one summed, left out (as lib/analytics.ts does). */
  otherCurrency: number;
  /** The currency every figure here is in. */
  currency: string;
  /** kind 'rank': every category or payee, first by the ranking's measure. */
  rank?: AskRankRow[];
  /** kind 'list': the newest LIST_ROWS bookings counted, newest first. */
  latest?: SerializedTransaction[];
  /** kind 'compare': the asked period and the one it is set against, worked out alike. */
  compare?: { a: AskAnswer; b: AskAnswer };
};

/** One line of a ranking: a category or a payee, its money and count, and the list's filter for it. */
export type AskRankRow = {
  key: string;
  category: CategoryId | null;
  /** The payee, as the lists name it. */
  name: string | null;
  cents: number;
  count: number;
  /** Of all that was ranked, 0–1, by the ranking's own measure. */
  share: number;
  filter: TxFilter;
};

/** How many lines the phone's tile shows of a ranking (components/insights/Ask.tsx). */
export const RANK_ROWS = 5;

/** How many bookings a list answer shows; "Umsätze zeigen" opens all of them. */
export const LIST_ROWS = 5;

/**
 * The earlier side of a comparison, cut to the running side's length: the
 * 1st to the 22nd of last month against this month's 1st to 22nd — a whole
 * month against a half one would always say "less".
 */
function againstSpan(period: AskPeriod, against: AskPeriod, today: string): AskPeriod {
  const days = periodDays(against, today);
  if (!days) return against;
  const [, m, d] = today.split('-').map(Number);
  if (period.kind === 'thisMonth') {
    const last = `${days.from.slice(0, 8)}${pad(Math.min(d, lastDay(+days.from.slice(0, 4), +days.from.slice(5, 7))))}`;
    return { kind: 'range', from: days.from, to: last < days.to ? last : days.to };
  }
  if (period.kind === 'thisYear') {
    const y = +days.from.slice(0, 4);
    const last = `${y}-${pad(m)}-${pad(Math.min(d, lastDay(y, m)))}`;
    return { kind: 'range', from: days.from, to: last < days.to ? last : days.to };
  }
  return against;
}

/**
 * Works the answer out over `txs` (the loaded bookings of the accounts in
 * view, `loaded` the days they cover). Umbuchungen between the user's own
 * accounts count only when the question names a category or a search.
 */
export function computeAnswer(
  query: AskQuery,
  txs: readonly SerializedTransaction[],
  ctx: SearchContext & {
    categoryOf: CategoryOf;
    /** The payee as the lists name it (Nano's brand on Android) — what a ranking groups and shows. Default: the bank's name. */
    payeeOf?: (tx: SerializedTransaction) => string;
    /** The one currency summed, as the Analyse picks it (lib/analytics.ts). Default: the first booking's, else EUR. */
    currency?: string;
  },
  loaded: { from: string; to: string },
  today: string,
): AskAnswer {
  const asked = periodDays(query.period, today) ?? loaded;
  const from = asked.from > loaded.from ? asked.from : loaded.from;
  const to = asked.to < loaded.to ? asked.to : loaded.to;
  const outside = from > to;
  const filter: TxFilter = {
    dir: query.dir, category: query.category, query: query.search ?? '', from: outside ? asked.from : from, to: outside ? asked.to : to,
  };

  const neutral = new Set(CATEGORIES.filter((c) => c.neutral).map((c) => c.id as string));
  const plain = !query.category && !query.search;
  const found = outside ? [] : filterTransactions(txs, filter, ctx).filter((tx) => tx.amount !== 0 && !(plain && neutral.has(ctx.categoryOf(tx).id)));
  // Currencies are never added together: one is summed, the rest set aside and counted.
  const currency = ctx.currency || txs.find((t) => t.currency)?.currency || 'EUR';
  const matched = found.filter((tx) => (tx.currency || 'EUR') === currency);
  const otherCurrency = found.length - matched.length;

  // The name finds nothing: the category Nano read is the better guess ("Streaming" names no payee).
  if (!found.length && !outside && query.search && query.hint) {
    return computeAnswer({ ...query, search: null, category: query.hint, hint: null }, txs, ctx, loaded, today);
  }

  // Two periods, each worked out as a plain sum.
  if (query.kind === 'compare' && query.against) {
    const plain = { ...query, kind: 'sum' as const, against: undefined };
    const a = computeAnswer(plain, txs, ctx, loaded, today);
    const b = computeAnswer({ ...plain, period: againstSpan(query.period, query.against, today) }, txs, ctx, loaded, today);
    return { ...a, query, compare: { a, b } };
  }

  // A split booking counts with its share in the category asked about.
  const centsOf = (tx: SerializedTransaction) => (query.category
    ? categoryPieces(tx, ctx.categoryOf).filter((p) => p.id === query.category).reduce((s, p) => s + Math.abs(p.cents), 0)
    : Math.abs(Math.round(tx.amount * 100)));

  const sums = (list: readonly SerializedTransaction[]) => {
    let outCents = 0;
    let inCents = 0;
    for (const tx of list) {
      if (tx.amount < 0) outCents += centsOf(tx);
      else inCents += centsOf(tx);
    }
    return { outCents, inCents, cents: query.dir === 'in' ? inCents : query.dir === 'out' ? outCents : outCents + inCents };
  };
  const { outCents, inCents, cents } = sums(matched);

  // A per-month average divides what the whole months hold, not the days around them:
  // 14 weeks of 100 € over two whole months are 400 € a month, not 700 €.
  const whole = outside ? null : wholeMonthSpan(from, to, today);
  const inWhole = (tx: SerializedTransaction) => {
    const day = bookingDay(tx);
    return !!whole && day >= whole.from && day <= whole.to;
  };
  const monthCents = whole ? sums(matched.filter(inWhole)).cents : 0;
  // Per year: the last 12 whole months as they were, where that many are loaded; else the monthly average times 12.
  let year: AskAnswer['year'];
  let counted = whole;
  if (query.kind === 'average' && query.per === 'year' && whole) {
    if (whole.months >= 12) {
      const [y, m] = whole.to.split('-').map(Number);
      const start = y * 12 + (m - 1) - 11;
      counted = { months: 12, from: `${Math.floor(start / 12)}-${pad((start % 12) + 1)}-01`, to: whole.to };
      const span = counted;
      year = { cents: sums(matched.filter((t) => bookingDay(t) >= span.from && bookingDay(t) <= span.to)).cents, last12: true };
    } else {
      year = { cents: Math.round((monthCents * 12) / whole.months), last12: false };
    }
  }
  // The way to the bookings follows what was counted.
  const shown: TxFilter = query.kind === 'average' && counted ? { ...filter, from: counted.from, to: counted.to } : filter;

  let tx: SerializedTransaction | null = null;
  if (query.kind === 'largest') {
    for (const t of matched) if (!tx || centsOf(t) > centsOf(tx)) tx = t;
  } else if (query.kind === 'last') {
    for (const t of matched) if (!tx || bookingDay(t) > bookingDay(tx)) tx = t;
  }

  return {
    query, filter: shown, from, to, outside, partial: !outside && asked.from < loaded.from,
    count: matched.length, cents, outCents, inCents, tx, months: whole?.months ?? 0, monthCents, otherCurrency, currency,
    ...(year ? { year } : {}),
    ...(query.kind === 'rank' && query.rank ? { rank: rankRows(matched, query, filter, ctx.categoryOf, ctx.payeeOf ?? counterpartyName) } : {}),
    ...(query.kind === 'list' ? { latest: newest(matched, LIST_ROWS) } : {}),
  };
}

/** The `n` newest bookings, newest first; of one day, in the order they came. */
export function newest(list: readonly SerializedTransaction[], n: number): SerializedTransaction[] {
  return list
    .map((tx, i) => ({ tx, i, day: bookingDay(tx) }))
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.i - b.i))
    .slice(0, n)
    .map((x) => x.tx);
}

/** Every category or payee of the matched bookings, by money or by count. */
function rankRows(
  matched: readonly SerializedTransaction[],
  query: AskQuery,
  filter: TxFilter,
  categoryOf: CategoryOf,
  payeeOf: (tx: SerializedTransaction) => string,
): AskRankRow[] {
  const rank = query.rank!;
  const groups = new Map<string, { category: CategoryId | null; name: string | null; cents: number; count: number }>();
  const add = (key: string, category: CategoryId | null, name: string | null, cents: number) => {
    const g = groups.get(key) ?? { category, name, cents: 0, count: 0 };
    g.cents += cents;
    g.count += 1;
    groups.set(key, g);
  };
  for (const tx of matched) {
    if (rank.by === 'payee') {
      const name = payeeOf(tx);
      if (name) add(foldText(name), null, name, Math.abs(Math.round(tx.amount * 100)));
    } else {
      // A split booking ranks with each of its shares.
      for (const piece of categoryPieces(tx, categoryOf)) add(piece.id, piece.id, null, Math.abs(piece.cents));
    }
  }
  const measure = (g: { cents: number; count: number }) => (rank.metric === 'count' ? g.count : g.cents);
  const total = [...groups.values()].reduce((s, g) => s + measure(g), 0) || 1;
  return [...groups.entries()]
    .sort(([, x], [, y]) => measure(y) - measure(x) || y.cents - x.cents || y.count - x.count)
    .map(([key, g]) => ({
      key, category: g.category, name: g.name, cents: g.cents, count: g.count, share: measure(g) / total,
      filter: g.category ? { ...filter, category: g.category } : { ...filter, query: g.name ?? '' },
    }));
}

/**
 * The calendar months that lie wholly in [from, to] and are over by today:
 * how many, and their first and last day. Null when none does.
 */
export function wholeMonthSpan(from: string, to: string, today: string): { months: number; from: string; to: string } | null {
  let n = 0;
  let start = '';
  let end = '';
  let [y, m] = from.split('-').map(Number);
  if (+from.slice(8) !== 1) [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  for (;;) {
    const first = `${y}-${pad(m)}-01`;
    const last = `${y}-${pad(m)}-${pad(lastDay(y, m))}`;
    if (last > to || last >= today || first < from) break;
    n++;
    start ||= first;
    end = last;
    [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  }
  return n ? { months: n, from: start, to: end } : null;
}

/** How many calendar months lie wholly in [from, to] and are over by today. */
export function wholeMonths(from: string, to: string, today: string): number {
  return wholeMonthSpan(from, to, today)?.months ?? 0;
}
