// Gemini Nano's half of the category guess on Android (mobile/server/categories.ts
// runs it through the GirovoNano plugin): the prompt it was calibrated with,
// how its answer is read, and the user's examples, matched by name outside
// the model. Pure, so the tests run it on the desktop.
//
// Calibrated on the owner's Galaxy S26 Ultra (nano-v4-fast through ML Kit's
// Prompt API, temperature 0) on hand-made bookings, tuned on some and
// measured once on others: of 115 bookings with a category the rules had
// not decided, 104 right and 12 wrong guesses, where e5 had 85 and 13.
// Nano gives no score to hold back an unsure answer — sampling, a second
// question and its thinking mode were all tried — so the prompt itself asks
// for NONE whenever the name says nothing about the trade.
//
// The system text and the list are the calibration's own (round fast-v6:
// v5 with Essen & Trinken apart from Freizeit, 5.9.0).
// A change to them is a new calibration: raise NANO_PROMPT_VERSION with it.

import { GUESSABLE, type GuessExample, type GuessableCategory } from './category-guess.ts';

// i18n-data-start — the prompt is the model's input, calibrated in German
/** Nano's instruction: one id or NONE, and when to say NONE. */
export const NANO_SYSTEM =
  "Du ordnest ausgehende Kontobuchungen genau einer von elf Kategorien zu – oder keiner. Eine falsche Kategorie ist schlimmer als keine. Antworte NONE bei jeder Privatperson (Vor- und Nachname, Familie …), egal welcher Zweck dabeisteht, und bei einem Firmennamen, der nichts über die Art des Geschäfts verrät. Sonst entscheide nach der Art des Geschäfts, die der Empfängername oder der Verwendungszweck verrät – auch wenn der Name nur die Branche nennt (Getränke, Juwelier, Kino, Baumarkt, Optik). Umlaute stehen in Kontoauszügen oft als ae, oe, ue (BAECKER = Bäcker). Antworte mit genau einem Wort aus dieser Liste und sonst nichts: NONE, housing, groceries, mobility, shopping, dining, leisure, media, health, insurance, taxes, savings.";

/** The eleven categories with their boundaries, and invented examples — the fixed head of every prompt. */
export const NANO_CATEGORY_LIST =
  "Kategorien:\n"
  + "- housing: Wohnen & Energie – Miete, Hausverwaltung, Wohnungsbaugesellschaft, Hausgeld, Nebenkosten; Strom, Gas, Wasser, Fernwärme (Stadtwerke, Energieversorger); Schornsteinfeger und Hausmeister.\n"
  + "- groceries: Lebensmittel & Drogerie – alles zum Essen und Trinken für zu Hause: Supermarkt, Discounter, Bäckerei, Metzgerei, Getränkemarkt und Getränkehandel, Asia-, Bio- und Feinkostmarkt, Hofladen; Drogerie und Drogeriemarkt.\n"
  + "- mobility: Mobilität – Tankstelle, Ladesäule, Parkhaus, Parkplatz, Parken per App, Bahn, Bus, ÖPNV, Taxi; Autohaus, Kfz-Werkstatt, Inspektion, Reifen, Autowäsche; Fahrradladen und Fahrradreparatur.\n"
  + "- shopping: Shopping – Versandhandel, Kleidung, Schuhe, Elektronik und Elektrogeschäfte, Möbel, Baumarkt, Bücher, Spielwaren, Schreibwaren, Schmuck und Juwelier.\n"
  + "- dining: Essen & Trinken unterwegs – Restaurant, Trattoria, Gasthaus, Café, Eiscafé, Imbiss, Döner, Kebab und Kebaphaus, Pizzeria, Burger, Sushi, Bar, Kneipe, Biergarten, Mensa, Lieferdienst. Lebensmittel für zu Hause sind groceries.\n"
  + "- leisure: Freizeit – Kino, Theater, Konzert, Tickets; Schwimmbad, Kletterhalle, Bowling, Fitnessstudio, Sport; Videospiele und Spieleshops (Steam, Game-Keys); Freizeitpark, Museum, Zoo; Hotel und Übernachtung.\n"
  + "- media: Abos & Medien – Streaming, Musik, Zeitung, Mobilfunk, Internet, eSIM; Software- und Cloud-Abos, Spiele-Abos, Webhosting und Server.\n"
  + "- health: Gesundheit – Apotheke, Arzt- und Zahnarztpraxis, auch deren Privatrechnung oder Privatliquidation, Labor, Physiotherapie, Ergotherapie, Optiker und Optik, Hörakustiker. Eine Krankenversicherung ist insurance.\n"
  + "- insurance: Versicherungen – jeder Versicherungsbeitrag, auch Kranken-, Zahnzusatz-, Kfz-, Haftpflicht- und Hausratversicherung.\n"
  + "- taxes: Steuern & Abgaben – Finanzamt, Steuern, Stadt- oder Gemeindekasse, Gebühren, Bußgeld; der Rundfunkbeitrag (ARD, ZDF, Deutschlandradio, Beitragsservice) ist taxes, nicht media.\n"
  + "- savings: Sparen & Anlegen – Sparplan, Depot, Broker, Wertpapiere, ETF, Kryptobörse, Bausparen, Tagesgeld.\n"
  + "\n"
  + "Beispiele:\n"
  + "Empfänger: Jonas Weber · Verwendungszweck: Konzertkarten → NONE\n"
  + "Empfänger: Familie Krause · Verwendungszweck: Weihnachtsgeld → NONE\n"
  + "Empfänger: Nordwind Handels GmbH · Verwendungszweck: RE 2291 → NONE\n"
  + "Empfänger: Kranz & Co. KG · Verwendungszweck: Rechnung 1182 → NONE\n"
  + "Empfänger: Sabine und Paul Richter · Verwendungszweck: Urlaub → NONE\n"
  + "Empfänger: REWE Markt GmbH · Verwendungszweck: – → groceries\n"
  + "Empfänger: Stadtwerke Bonn · Verwendungszweck: Abschlag Strom → housing\n";
// i18n-data-end

/** Raised with every change to the texts above: answers cached under another version are asked again. */
export const NANO_PROMPT_VERSION = 6;

/**
 * The part of the prompt that is the booking's own, after NANO_CATEGORY_LIST
 * — as the calibration rounds sent it, byte for byte.
 */
export function nanoBookingText(name: string, purpose?: string | null): string {
  const p = String(purpose ?? '').trim();
  return `\nEmpfänger: ${String(name).trim()}\nVerwendungszweck: ${p || '–'}\nKategorie-ID:`; // i18n-data
}

/**
 * Nano's answer as a category: NONE (or nothing usable) is no category; else
 * the first of the ten ids it names, as a word of its own.
 */
export function parseNanoAnswer(answer: string | null | undefined): GuessableCategory | null {
  const text = String(answer ?? '').trim().toLowerCase();
  if (!text || /^none\b/.test(text)) return null;
  let best: { id: GuessableCategory; at: number } | null = null;
  for (const id of GUESSABLE) {
    const at = text.search(new RegExp(`(^|[^a-z])${id}([^a-z]|$)`));
    if (at >= 0 && (!best || at < best.at)) best = { id, at };
  }
  return best?.id ?? null;
}

// ---------------------------------------------------------------------------
// The user's examples, matched by name outside the model.
//
// In the prompt, Nano copied the category of any example that merely looked
// alike ("Getränke Hoffmann" took "Getränke Wolf"'s) and kept its own opinion
// over an identical one ("Hornbach" stayed Shopping though the user filed it
// as Wohnen). So the example decides on its own when the names are nearly the
// same, and Nano never sees it. 0.8 lies above every look-alike the
// calibration found (at most 0.63) and below every spelling of one shop.

/** How alike two names must be for the user's example to decide. */
export const EXAMPLE_MIN = 0.8;

/** Legal forms, branch words and connectives — what two spellings of one shop differ in. */
const NOISE = new Set(
  // i18n-data-next-line
  'gmbh mbh ag ev kg co gbr ek sca se ug ohg kgaa bv haftungsbeschraenkt fil filiale und de'.split(' '),
);

/** A name's words, folded as bank statements write them, without legal forms, numbers or single letters. */
export function nameWords(name: string): string[] {
  return String(name ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 1 && !NOISE.has(w) && !/^\d+$/.test(w));
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/**
 * How alike two names are, 0 to 1: the larger of their trigram overlap (Dice)
 * and the share of the shorter name's words the longer one has — a little
 * less than full when the longer has more ("ADAC" in "ADAC Mitgliedschaft").
 */
export function nameSimilarity(a: string, b: string): number {
  const wa = nameWords(a), wb = nameWords(b);
  if (!wa.length || !wb.length) return 0;
  const ta = trigrams(wa.join(' ')), tb = trigrams(wb.join(' '));
  let both = 0;
  for (const g of ta) if (tb.has(g)) both++;
  const dice = (2 * both) / (ta.size + tb.size);
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  const found = short.filter((w) => long.includes(w)).length;
  return Math.max(dice, (found / short.length) * (short.length === long.length ? 1 : 0.9));
}

/** The user's example for this name, when one is nearly the same counterparty. */
export function exampleFor(name: string, examples: GuessExample[]): GuessExample | null {
  let best: { example: GuessExample; score: number } | null = null;
  for (const example of examples) {
    const score = nameSimilarity(name, example.name);
    if (score >= EXAMPLE_MIN && (!best || score > best.score)) best = { example, score };
  }
  return best?.example ?? null;
}
