// Calibrates and checks the on-device category guess (lib/category-model.ts)
// against a labelled set of German outgoing bookings — names as statements
// carry them, none of them anyone's real data:
//
//   node scripts/eval-category-model.mjs                    the current thresholds
//   node scripts/eval-category-model.mjs --sweep            search for better ones
//   node scripts/eval-category-model.mjs --sweep --strict   …that make no mistake at all
//
// Two sets. CASES is the one to tune on: thresholds, prototype wording. HOLDOUT
// is only ever measured — never word a prototype after one of its misses, or
// it stops telling how the model does on names nobody has looked at. It is
// what decides between two models.
//
// `expect: null` marks a booking no category should be guessed for: a
// private person, a name that says nothing. A wrong category counts worse
// than none — that is the whole point of the thresholds.

import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const m = await import(pathToFileURL(path.join(ROOT, 'lib', 'category-model.ts')).href);

/** [name, purpose, expected category or null] */
const CASES = [
  // groceries — local shops the keyword list does not know
  ['Bäckerei Hoefer', '', 'groceries'], ['Backhaus Müller', '', 'groceries'], ['Landbäckerei Schüren', '', 'groceries'],
  ['Fleischerei Brandt', '', 'groceries'], ['Hofladen Sonnenhof', '', 'groceries'], ['Obst und Gemüse Yilmaz', '', 'groceries'],
  ['Getränke Hoffmann', '', 'groceries'], ['Feinkost Käfer', '', 'groceries'], ['Bio-Markt Vollkorn', '', 'groceries'],
  ['Asia Markt Hoang', '', 'groceries'], ['Bauernmarkt Koblenz', '', 'groceries'], ['Konditorei Schäfer', '', 'groceries'],
  // mobility
  ['EasyPark GmbH', 'Teillieferung(Final)', 'mobility'], ['Parkhaus am Markt', '', 'mobility'], ['APCOA Parking', '', 'mobility'],
  ['Freie Tankstelle Wagner', '', 'mobility'], ['Autohaus Becker Werkstatt', 'Inspektion', 'mobility'], ['Reifen Center Koblenz', '', 'mobility'],
  ['Verkehrsverbund Rhein-Mosel', 'Monatskarte', 'mobility'], ['Taxi-Zentrale Koblenz', '', 'mobility'], ['Mr. Wash Autowaschanlage', '', 'mobility'],
  ['Fahrrad Franz', 'Reparatur', 'mobility'], ['FlixBus', 'Ticket', 'mobility'], ['Ladepark Ionity', '', 'mobility'],
  // leisure
  ['Trattoria da Michele', '', 'leisure'], ['Gasthaus zur Linde', '', 'leisure'], ['Café Extrablatt', '', 'leisure'],
  ['Kebaphaus Anatolia', '', 'leisure'], ['Eiscafe Venezia', '', 'leisure'], ['Kinopolis Koblenz', '', 'leisure'],
  ['Stadttheater Koblenz', 'Eintrittskarten', 'leisure'], ['Kletterhalle Bloc', '', 'leisure'], ['Hallenbad Koblenz', '', 'leisure'],
  ['Hotel Mosellandhaus', '', 'leisure'], ['Biergarten Deutsches Eck', '', 'leisure'], ['Bowlingcenter Strike', '', 'leisure'],
  // shopping
  ['Schuhhaus Ebbinghaus', '', 'shopping'], ['Modehaus Sinn', '', 'shopping'], ['Buchhandlung Reuffel', '', 'shopping'],
  ['Spielwaren Kurtz', '', 'shopping'], ['Elektro Klein', '', 'shopping'], ['Möbelhaus Hess', '', 'shopping'],
  ['Raiffeisen Baumarkt', '', 'shopping'], ['Schreibwaren Lange', '', 'shopping'], ['Juwelier Weiss', '', 'shopping'],
  // health
  ['Löwen-Apotheke', '', 'health'], ['Physiotherapie am Park', '', 'health'], ['Zahnarztpraxis Dr. Meier', 'Rechnung 2026-114', 'health'],
  ['Praxis Dr. med. Schulz', 'Privatrechnung', 'health'], ['Optik Hecht', '', 'health'], ['Hörakustik Kind', '', 'health'],
  ['Ergotherapie Lindner', '', 'health'], ['Labor Dr. Wisplinghoff', '', 'health'], ['Kieferorthopädie Neumann', '', 'health'],
  // housing
  ['Hausverwaltung Kraemer', 'Miete Oktober', 'housing'], ['Energieversorgung Mittelrhein', 'Abschlag Strom', 'housing'],
  ['Stadtwerke Andernach', 'Abschlag Gas', 'housing'], ['Wohnungsbaugesellschaft Koblenz', 'Miete', 'housing'],
  ['WEG Rheinblick 12', 'Hausgeld', 'housing'], ['Schornsteinfeger Klein', 'Feuerstättenschau', 'housing'],
  ['Wasserzweckverband Maifeld', 'Abschlag Wasser', 'housing'],
  // media
  ['Disney Plus', '', 'media'], ['1&1 Telecom', 'Mobilfunk', 'media'], ['Rhein-Zeitung', 'Abo', 'media'],
  ['Audible', 'Mitgliedschaft', 'media'], ['DAZN', '', 'media'], ['Microsoft 365', 'Abonnement', 'media'],
  ['congstar', 'Rechnung Mobilfunk', 'media'], ['Dropbox', 'Plus Plan', 'media'],
  // insurance
  ['HUK-Coburg', 'Kfz-Versicherung', 'insurance'], ['Debeka Krankenversicherung', 'Beitrag', 'insurance'],
  ['ARAG Rechtsschutz', 'Beitrag', 'insurance'], ['Hannoversche Leben', 'Risikolebensversicherung', 'insurance'],
  ['Barmenia', 'Zahnzusatzversicherung', 'insurance'], ['WGV Versicherung', 'Haftpflicht', 'insurance'],
  // taxes
  ['Finanzamt Koblenz', 'Einkommensteuer 2025', 'taxes'], ['Stadtkasse Koblenz', 'Grundbesitzabgaben', 'taxes'],
  ['Bundeskasse Kiel', 'Kfz-Steuer', 'taxes'], ['Verbandsgemeinde Vallendar', 'Hundesteuer', 'taxes'],
  ['Amtsgericht Koblenz', 'Gerichtskosten', 'taxes'], ['Bußgeldstelle', 'Verwarnungsgeld', 'taxes'],
  // savings
  ['Trade Republic', 'Sparplan', 'savings'], ['Scalable Capital', 'Einzahlung', 'savings'], ['Wüstenrot Bausparkasse', 'Bausparbeitrag', 'savings'],
  ['Union Investment', 'Fondssparplan', 'savings'], ['Bitpanda', 'Kauf', 'savings'],
  // as statements spell them: capitals, umlauts written out
  ['Schaefer Dein Baecker', '', 'groceries'], ['SCHAEFER DEIN BAECKER', '', 'groceries'],
  ['Schaefer Dein Baecker 0415', '', 'groceries'], ['SCHAEFER DEIN BAECKER GMBH', '', 'groceries'],
  ['GETRAENKE QUELLE', '', 'groceries'], ['Loewen-Apotheke Koeln', '', 'health'],
  ['MOEBEL MARTIN', '', 'shopping'], ['Gemeinschaftspraxis Dres. Mueller', 'Privatliquidation', 'health'],
  ['Hetzner Online GmbH', '', 'media'], ['HETZNER ONLINE GMBH', '', 'media'],
  ['Hetzner Online GmbH', 'R0024173385 Rechnung Kundennummer K0815', 'media'],
  ['netcup GmbH', 'Rechnung Webhosting', 'media'],
  // no category: private persons and names that say nothing
  ['Max Mustermann', '', null], ['Erika Musterfrau', 'Danke!', null], ['Thomas Schneider', 'Geschenk', null],
  ['Anna Becker', 'Rückzahlung', null], ['Jonas Weber', '', null], ['M. Yilmaz', '', null],
  ['Lisa und Tim Hoffmann', 'Hochzeit', null], ['XY Handels GmbH', '', null], ['ABC Services UG', 'RE 4711', null],
  ['Familie Schmidt', 'Taschengeld', null], ['Kevin Krause', 'Konzertkarten', 'leisure'],
];

/** Measured, never tuned on — see the top. Written before either model scored it. */
const HOLDOUT = [
  // groceries
  ['Metzgerei Hartmann', '', 'groceries'], ['Weinhandlung Becker', '', 'groceries'], ['Reformhaus Engel', '', 'groceries'],
  ['Wochenmarkt Stand Kaya', '', 'groceries'], ['Käserei Alpenblick', '', 'groceries'], ['Hofbäckerei Kuhn', '', 'groceries'],
  ['Türkischer Supermarkt Öz', '', 'groceries'], ['Eierhof Lohmann', '', 'groceries'], ['Getränkemarkt am Ring', '', 'groceries'],
  ['METZGEREI SCHNEIDER GMBH', '', 'groceries'],
  // mobility
  ['Autowerkstatt Yildiz', 'Ölwechsel', 'mobility'], ['Kfz-Meisterbetrieb Roth', '', 'mobility'], ['Parkplatz Hauptbahnhof', '', 'mobility'],
  ['Carsharing Stadtmobil', '', 'mobility'], ['Abschleppdienst Krämer', '', 'mobility'], ['Autoteile Bremer', '', 'mobility'],
  ['Waschpark Sauber', '', 'mobility'], ['Busunternehmen Schäfer', 'Fahrkarte', 'mobility'], ['AUTOHAUS KOENIG', 'Reparatur', 'mobility'],
  ['Tankstelle Weber', '', 'mobility'],
  // leisure
  ['Pizzeria Roma', '', 'leisure'], ['Restaurant Zum Hirschen', '', 'leisure'], ['Sushi Bar Kyoto', '', 'leisure'],
  ['Cocktailbar Havana', '', 'leisure'], ['Freizeitbad Tropical', '', 'leisure'], ['Fitnessstudio Kraftwerk', 'Mitgliedsbeitrag', 'leisure'],
  ['Zoo Neuwied', '', 'leisure'], ['Reisebüro Sonnenschein', 'Pauschalreise', 'leisure'], ['Ferienwohnung Seeblick', '', 'leisure'],
  ['Imbiss bei Ali', '', 'leisure'], ['Weinstube Altstadt', '', 'leisure'], ['Landgasthof Krone', '', 'leisure'],
  // shopping
  ['Parfümerie Pieper', '', 'shopping'], ['Gartencenter Grünland', '', 'shopping'], ['Haushaltswaren Krüger', '', 'shopping'],
  ['Bastelbedarf Kreativ', '', 'shopping'], ['Computerladen PC-Service', '', 'shopping'], ['Sportgeschäft Fit und Fun', '', 'shopping'],
  ['Kaufhaus Kaiser', '', 'shopping'], ['Brautmoden Weiß', '', 'shopping'], ['Elektrofachmarkt Becker', '', 'shopping'],
  ['SCHUHHAUS MUELLER', '', 'shopping'],
  // health
  ['Hausarztpraxis Dr. Klein', '', 'health'], ['Augenarzt Dr. Berg', '', 'health'], ['Heilpraktikerin Sommer', '', 'health'],
  ['Logopädie Praxis Wendt', '', 'health'], ['Sanitätshaus Müller', '', 'health'], ['Rosen-Apotheke', '', 'health'],
  ['Psychotherapeutische Praxis Lang', '', 'health'], ['Krankenhaus St. Elisabeth', 'Zuzahlung', 'health'], ['Zahnarzt Dr. Özdemir', '', 'health'],
  // housing
  ['Rheinenergie AG', 'Abschlag Strom', 'housing'], ['Wasserwerk Neuwied', 'Wasserabschlag', 'housing'],
  ['Immobilienverwaltung Schmitz', 'Nebenkosten', 'housing'], ['Hausmeisterservice Becker', '', 'housing'],
  ['Fernwärme Mittelrhein', 'Abschlag', 'housing'], ['Vermietung Kraus', 'Miete November', 'housing'],
  ['STADTWERKE MAYEN', 'Abschlag', 'housing'],
  // media
  ['Telekom Deutschland', 'Festnetz', 'media'], ['Vodafone Kabel', '', 'media'], ['Süddeutsche Zeitung', 'Digitalabo', 'media'],
  ['Adobe Creative Cloud', '', 'media'], ['PlayStation Plus', '', 'media'], ['Kicker', 'Abo', 'media'],
  ['Freenet Mobilfunk', '', 'media'], ['Mailbox.org', 'E-Mail Postfach', 'media'],
  // insurance
  ['Allianz', 'Hausratversicherung', 'insurance'], ['AXA', 'Krankenzusatzversicherung', 'insurance'],
  ['DEVK', 'Kfz Beitrag', 'insurance'], ['Signal Iduna', 'Berufsunfähigkeit', 'insurance'],
  ['Zurich Versicherung', 'Unfallversicherung', 'insurance'], ['Gothaer', 'Beitrag Haftpflicht', 'insurance'],
  // taxes
  ['Finanzamt Mainz', 'Umsatzsteuer', 'taxes'], ['Stadt Köln', 'Grundsteuer', 'taxes'],
  ['Bürgeramt', 'Gebühr Reisepass', 'taxes'], ['Hauptzollamt Koblenz', 'Kfz-Steuer', 'taxes'],
  ['Landeshauptkasse', 'Gebühren', 'taxes'], ['Ordnungsamt', 'Verwarnungsgeld', 'taxes'],
  // savings
  ['comdirect', 'Wertpapiersparplan', 'savings'], ['Bausparkasse Schwäbisch Hall', '', 'savings'],
  ['DWS Investment', 'Sparplan', 'savings'], ['Coinbase', 'Kauf', 'savings'], ['Smartbroker', 'Einzahlung Depot', 'savings'],
  // no category
  ['Sarah Klein', '', null], ['Peter und Maria Lange', '', null], ['Dennis Hoffmann', 'Danke fürs Essen', null],
  ['J. Schulze', '', null], ['Kerstin Wolf', 'Geburtstag', null], ['Brandt GmbH', '', null],
  ['Müller & Partner GbR', '', null], ['Nordwest Holding AG', '', null], ['Lukas Fischer', 'Auslage', null],
  ['TK Services GmbH', 'RG 2291', null],
];

const t = m.modelThresholds();
const started = Date.now();
const scores = await m.scoreTexts(CASES.map(([name, purpose]) => m.bookingText(name, purpose)));
const heldScores = await m.scoreTexts(HOLDOUT.map(([name, purpose]) => m.bookingText(name, purpose)));
console.log(`${CASES.length + HOLDOUT.length} bookings scored in ${Date.now() - started} ms (model load included)`);

function evaluate(th, verbose = false, set = CASES, setScores = scores) {
  let right = 0, wrong = 0, none = 0, falseGuess = 0, nulls = 0;
  const wrongs = [];
  set.forEach(([name, purpose, expect], i) => {
    const got = m.pickCategory(setScores[i], null, th);
    if (expect === null) {
      nulls++;
      if (got) { falseGuess++; wrongs.push(`  ✗ "${name}${purpose ? ` – ${purpose}` : ''}" → ${got} (should stay Sonstiges)`); }
      return;
    }
    if (got === expect) right++;
    else if (got === null) none++;
    else { wrong++; wrongs.push(`  ✗ "${name}${purpose ? ` – ${purpose}` : ''}" → ${got} (is ${expect})`); }
  });
  const labelled = set.length - nulls;
  const guessed = right + wrong + falseGuess;
  const r = { th, right, wrong, none, falseGuess, coverage: right / labelled, precision: guessed ? right / guessed : 1 };
  if (verbose) {
    console.log(`thresholds ${JSON.stringify(th)}`);
    console.log(`right ${right}/${labelled} (${(100 * r.coverage).toFixed(0)} %) · wrong ${wrong} · left as Sonstiges ${none} · persons given a category ${falseGuess}/${nulls}`);
    console.log(`precision of what it guesses: ${(100 * r.precision).toFixed(1)} %`);
    for (const w of wrongs) console.log(w);
  }
  return r;
}

if (process.argv.includes('--sweep')) {
  const results = [];
  for (let s = 0.75; s <= 0.95; s += 0.0025) for (let g = 0; g <= 0.04; g += 0.002) {
    results.push(evaluate({ ...t, minScore: +s.toFixed(4), minMargin: +g.toFixed(3) }));
  }
  // Best coverage among settings that guess wrong at most 1 time in 20 —
  // or, with --strict, never at all.
  const strict = process.argv.includes('--strict');
  const ok = results
    .filter((r) => (strict ? r.wrong === 0 && r.falseGuess === 0 : r.precision >= 0.95))
    .sort((a, b) => b.coverage - a.coverage || b.th.minScore - a.th.minScore || b.th.minMargin - a.th.minMargin);
  console.log(strict ? 'best with no mistakes:' : 'best at ≥95 % precision:');
  for (const r of ok.slice(0, 5)) console.log(`  minScore ${r.th.minScore} minMargin ${r.th.minMargin} → right ${r.right}, wrong ${r.wrong}, persons ${r.falseGuess}, coverage ${(100 * r.coverage).toFixed(0)} %`);
  if (ok[0]) {
    evaluate(ok[0].th, true);
    console.log('\nheld out, at these thresholds:');
    evaluate(ok[0].th, true, HOLDOUT, heldScores);
  }
} else {
  evaluate(t, true);
  console.log('\nheld out:');
  evaluate(t, true, HOLDOUT, heldScores);
}
await m.releaseModel();
