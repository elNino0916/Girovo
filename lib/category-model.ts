// The on-device category guess for bookings the keyword rules miss
// (lib/categorize.ts, between the keywords and "Sonstiges").
//
// A multilingual text-embedding model — multilingual-e5-base, int8
// ONNX, fetched by scripts/fetch-model.mjs — turns a booking's counterparty
// (and, where it says something, its Verwendungszweck) into a vector and
// compares it with short descriptions of each spending category, and with
// the counterparties the user has filed by rule. The closest category is the
// guess — but only when it is clearly the closest: a wrong category is the
// very thing this is meant to cure, so anything less stays "Sonstiges".
//
// Everything runs in this process. No text leaves the machine, nothing is
// written to disk, and nothing is logged. The model is loaded on first use
// and released after a quiet minute: it takes about 600 MB while loaded.
//
// Only money going out is guessed. Incoming money mostly comes from people,
// whose names say nothing a model could read; the codes and keywords keep
// deciding those, as they keep deciding Umbuchung, Bargeld and the bank's fees.

import fs from 'node:fs';
import path from 'node:path';
import ort from 'onnxruntime-node';
import { Tokenizer } from '@huggingface/tokenizers';
import type { CategoryId } from './categories.ts';

/** The categories a guess may name — the spending ones. */
export type GuessableCategory = Extract<CategoryId,
  'housing' | 'groceries' | 'mobility' | 'shopping' | 'leisure' | 'media' | 'health' | 'insurance' | 'taxes' | 'savings'>;

/**
 * What each category is, in the words its bookings use: several short
 * descriptions each, one kind of business per line. A booking is as close to
 * a category as it is to the closest of them.
 */
export const CATEGORY_PROTOTYPES: Record<GuessableCategory, string[]> = {
  housing: [
    'Miete für die Wohnung an Vermieter oder Hausverwaltung',
    'Nebenkosten, Betriebskosten, Hausgeld der Eigentümergemeinschaft',
    'Strom: Abschlag an Stromanbieter, Energieversorger oder Stadtwerke',
    'Gas, Fernwärme, Heizkosten, Wasser und Abwasser',
    'Schornsteinfeger, Hausmeisterdienst, Müllabfuhr',
    'Wohnungseigentümergemeinschaft WEG, Hausgeld',
  ],
  groceries: [
    'Supermarkt, Lebensmittel einkaufen, Discounter',
    'Bäckerei, Backstube, Brötchen und Brot',
    'Metzgerei, Fleischerei, Feinkost, Käsetheke',
    'Drogerie, Drogeriemarkt, Körperpflege',
    'Getränkemarkt, Getränke',
    'Bioladen, Hofladen, Wochenmarkt, Obst und Gemüse',
  ],
  mobility: [
    'Tankstelle: Benzin, Diesel, tanken',
    'Parken: Parkhaus, Parkplatz, Parkgebühr, Parkschein per App',
    'Bahn, Bus, Zugticket, Fahrkarte, Verkehrsverbund, Deutschlandticket',
    'Taxi, Carsharing, E-Scooter, Mietwagen',
    'Autowerkstatt, Kfz-Reparatur, Reifen, TÜV, Waschanlage',
    'Ladestation, Elektroauto laden, Ladesäule',
    'Fahrradladen, Fahrradwerkstatt',
    'Fernbus, Busticket, Parkhaus, Parkplatzgebühr',
  ],
  shopping: [
    // Not "Onlineshop": that word pulled every "… Online GmbH" (a web host) into Shopping.
    'Versandhandel, Paket mit der Bestellung, Lieferung nach Hause',
    'Kleidung, Mode, Schuhe, Bekleidungsgeschäft',
    'Elektronik, Technik, Computer, Handy kaufen',
    'Baumarkt, Möbelhaus, Einrichtung, Haushaltswaren',
    'Buchhandlung, Spielwaren, Schreibwaren, Geschenke',
    'Kaufhaus, Warenhaus, Einkaufszentrum',
    'Juwelier, Uhren, Schmuck, Elektrogeschäft, Fachhandel',
  ],
  leisure: [
    'Restaurant, Gaststätte, essen gehen',
    'Café, Bistro, Imbiss, Döner, Pizzeria',
    'Bar, Kneipe, Club, Diskothek',
    'Kino, Theater, Konzert, Tickets für eine Veranstaltung',
    'Fitnessstudio, Sportverein, Schwimmbad, Sauna',
    'Hotel, Urlaub, Reise, Ferienwohnung',
    'Freizeitpark, Museum, Zoo, Ausflug',
    'Bowling, Minigolf, Escape Room, Kletterhalle, Trampolinpark',
    'Lieferdienst, Essen bestellen',
    'Trattoria, Ristorante, Steakhaus, Gasthaus, Kebab, Eiscafé',
  ],
  media: [
    'Streaming-Abo für Filme, Serien oder Musik',
    'Mobilfunkvertrag, Handyrechnung, Internet, DSL, Telefon',
    'Zeitung, Zeitschrift, Abonnement',
    'Software-Abo, App, Cloud-Speicher',
    'Webhosting, Server, Domain, Rechenzentrum, Cloud-Hosting',
    'Videospiele, Gaming, Spieleplattform',
    'Sport-Streaming, Fernsehen, Pay-TV',
  ],
  health: [
    'Apotheke, Medikamente',
    'Arztpraxis, Arzt, Zahnarzt, Facharzt',
    'Physiotherapie, Krankengymnastik, Ergotherapie, Heilpraktiker',
    'Krankenhaus, Klinik, Labor',
    'Optiker, Brille, Kontaktlinsen, Hörgeräte',
    'Hörakustiker, Hörgeräteakustik, Gemeinschaftspraxis, Privatrechnung vom Arzt',
  ],
  insurance: [
    'Versicherung, Versicherungsbeitrag',
    'Haftpflichtversicherung, Hausratversicherung',
    'Kfz-Versicherung, Autoversicherung',
    'Krankenkasse, Krankenversicherung, Beitrag',
    'Lebensversicherung, Berufsunfähigkeitsversicherung, Rechtsschutzversicherung',
  ],
  taxes: [
    'Finanzamt, Steuerzahlung, Einkommensteuer',
    'Kfz-Steuer, Grundsteuer, Hundesteuer',
    'Stadtkasse, Gemeinde, Gebühren, Bußgeld',
    'Rundfunkbeitrag, Beitragsservice von ARD und ZDF',
    'Gerichtskasse, Behörde, Amt',
  ],
  savings: [
    'Sparplan, Depot, Wertpapiere, ETF',
    'Bausparvertrag, Bausparkasse',
    'Tagesgeld, Sparkonto, Festgeld',
    'Broker, Aktien, Kryptowährung',
    'Altersvorsorge, Riester-Rente',
    'Einzahlung ins Depot, Geld anlegen, Kryptobörse',
  ],
};

export const GUESSABLE = Object.keys(CATEGORY_PROTOTYPES) as GuessableCategory[];

/**
 * What money between people looks like. A booking closest to these gets no
 * category at all: a gift or a repayment to a friend is not "Shopping", even
 * when its words ("Geschenk") come near it. Rent or concert tickets paid to a
 * person still match their own category better, and keep it.
 */
export const PRIVATE_PROTOTYPES = [
  'Geschenk, Taschengeld, Rückzahlung an Familie oder Freunde',
  'Überweisung an eine Privatperson',
  'Danke, Glückwunsch zum Geburtstag, Hochzeit',
  'geliehenes Geld zurück, Anteil, Auslage',
];

/** The scores a booking is judged by: each category's, and how close it is to money between people. */
export type CategoryScores = Record<GuessableCategory, number> & { private: number };

/**
 * When a guess counts. Each model has its own, calibrated on labelled German
 * bookings (scripts/eval-category-model.mjs) and shipped beside its weights
 * as model.json (scripts/fetch-model.mjs). These are multilingual-e5-base's,
 * for a model folder that carries none.
 */
export const DEFAULT_THRESHOLDS = {
  /** The closest category must be at least this similar… */
  minScore: 0.8075,
  /** …and this much closer than the next one. */
  minMargin: 0.006,
  /** A counterparty this similar to one the user filed by rule takes that rule's category. */
  exampleScore: 0.92,
};

export type Thresholds = typeof DEFAULT_THRESHOLDS;

/**
 * The guess from similarity scores — pure, so the tests pin it. `scores`
 * holds each category's similarity to the booking; `example` the closest
 * counterparty the user filed by rule, if any.
 */
export function pickCategory(
  scores: CategoryScores,
  example: { category: GuessableCategory; score: number } | null,
  t: Thresholds = DEFAULT_THRESHOLDS,
): GuessableCategory | null {
  if (example && example.score >= t.exampleScore) return example.category;
  // "private" competes like a category, and wins by naming none.
  const ranked = (Object.entries(scores) as [GuessableCategory | 'private', number][]).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  if (!best || best[0] === 'private' || best[1] < t.minScore) return null;
  if (second && best[1] - second[1] < t.minMargin) return null;
  return best[0];
}

/**
 * German words statements spell without umlauts, as stems with their real
 * spelling. Only stems that are certain: "ae → ä" everywhere would read
 * "Michael" as "Michäl" and "Steuer" as "Steür". The model knows "Bäcker" and
 * not "Baecker" — that difference decided whether a bakery got a category.
 */
const UMLAUT_STEMS: readonly (readonly [string, string])[] = [
  ['baeck', 'bäck'], ['getraenk', 'getränk'], ['aerzt', 'ärzt'], ['gaertner', 'gärtner'], ['moebel', 'möbel'],
  ['buecher', 'bücher'], ['buero', 'büro'], ['gebuehr', 'gebühr'], ['pruef', 'prüf'],
  ['kuech', 'küch'], ['schluessel', 'schlüssel'], ['fruehst', 'frühst'], ['kaese', 'käse'], ['haendl', 'händl'],
  ['geschaeft', 'geschäft'], ['baeder', 'bäder'], ['buehne', 'bühne'], ['ueberweis', 'überweis'], ['tuev', 'tüv'],
  ['hoerakust', 'hörakust'], ['hoergeraet', 'hörgerät'], ['kieferorthopaed', 'kieferorthopäd'],
  ['muenchen', 'münchen'], ['koeln', 'köln'], ['duesseldorf', 'düsseldorf'], ['nuernberg', 'nürnberg'],
  ['wuerzburg', 'würzburg'], ['saarbruecken', 'saarbrücken'], ['moenchengladbach', 'mönchengladbach'],
  ['schaefer', 'schäfer'], ['mueller', 'müller'], ['schroeder', 'schröder'], ['koenig', 'könig'], ['jaeger', 'jäger'],
  ['kraemer', 'krämer'], ['loewen', 'löwen'], ['buerger', 'bürger'], ['gruen', 'grün'],
];
const UMLAUT_PATTERN = new RegExp(UMLAUT_STEMS.map(([from]) => from).join('|'), 'gi');
const UMLAUT_FIX = new Map(UMLAUT_STEMS.map(([from, to]) => [from, to]));

/**
 * A statement's text as a person would write it, so the model can read it:
 * a text in capitals ("SCHAEFER DEIN BAECKER GMBH") in ordinary case, short
 * acronyms (DB, DM, AOK) kept, the umlauts the statement dropped back where
 * the word is certain — and no numbers: a branch number, an invoice or a
 * customer number says nothing about what was paid for, and only moved a
 * shop's bookings in and out of a category one by one ("… 0415").
 */
export function readable(text: string): string {
  let s = text.replace(/\S*\d\S*\d\S*/g, ' ').replace(/\s+/g, ' ').trim();
  if (!/\p{Ll}/u.test(s)) {
    s = s.replace(/\p{L}+/gu, (w) => (w.length <= 3 ? w : w[0] + w.slice(1).toLowerCase()));
  }
  return s.replace(UMLAUT_PATTERN, (m) => {
    const to = UMLAUT_FIX.get(m.toLowerCase()) ?? m;
    if (m === m.toUpperCase()) return to.toUpperCase();
    return m[0] === m[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to;
  });
}

/**
 * The text a booking is read by: the counterparty, and the Verwendungszweck
 * when it says something (a card system's record says nothing), both made
 * readable. e5 is asked symmetrically, so both sides carry the "query: " prefix.
 */
export function bookingText(name: string, purpose?: string | null): string {
  const n = readable(name);
  const p = readable(String(purpose ?? '')).slice(0, 140);
  return `query: ${p ? `${n} – ${p}` : n}`;
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

const MAX_TOKENS = 64;
const BATCH = 32;
const IDLE_MS = 60_000;
const MAX_CACHE = 4000;

type Loaded = {
  tokenizer: Tokenizer;
  session: ort.InferenceSession;
  prototypes: { category: GuessableCategory | 'private'; v: Float32Array }[];
  thresholds: Thresholds;
};

// On globalThis, like the other process state: a hot reload must not load a
// second copy of a 600 MB model.
const g = globalThis as typeof globalThis & {
  __girovoCategoryModel?: { loading: Promise<Loaded> | null; idle: ReturnType<typeof setTimeout> | null; queue: Promise<unknown>; cache: Map<string, Float32Array> };
};
const state = (g.__girovoCategoryModel ??= { loading: null, idle: null, queue: Promise.resolve(), cache: new Map() });

/**
 * Where the model is: beside the built server in the desktop app
 * (GIROVO_MODEL_DIR), else models/ in the project. Every path into it is
 * marked turbopackIgnore: decided at run time, it must not make the build's
 * file tracer copy the project — or the model itself — into the server bundle.
 */
export function modelDir(): string {
  return process.env.GIROVO_MODEL_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), 'models', 'category-model');
}

/** Whether the model files are there — without them the keyword rules decide alone. */
export function modelAvailable(): boolean {
  const dir = modelDir();
  return ['model_quantized.onnx', 'tokenizer.json', 'tokenizer_config.json'].every((f) => fs.existsSync(/*turbopackIgnore: true*/ path.join(dir, f)));
}

/**
 * The thresholds calibrated for the model in modelDir() — its model.json,
 * written by scripts/fetch-model.mjs — else DEFAULT_THRESHOLDS. Each one is
 * taken only when it is a number a similarity can be measured against.
 */
export function modelThresholds(): Thresholds {
  let saved: Partial<Record<keyof Thresholds, unknown>> = {};
  try {
    saved = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ path.join(modelDir(), 'model.json'), 'utf8')).thresholds ?? {};
  } catch {
    // No calibration beside the model: the defaults.
  }
  const t = { ...DEFAULT_THRESHOLDS };
  for (const key of Object.keys(t) as (keyof Thresholds)[]) {
    const v = saved[key];
    if (typeof v === 'number' && v >= 0 && v <= 1) t[key] = v;
  }
  return t;
}

async function load(): Promise<Loaded> {
  const dir = modelDir();
  const tokenizer = new Tokenizer(
    JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ path.join(dir, 'tokenizer.json'), 'utf8')),
    JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ path.join(dir, 'tokenizer_config.json'), 'utf8')),
  );
  // Two threads: enough for a few hundred short texts, and the bank requests
  // running beside it keep their share of the machine.
  const session = await ort.InferenceSession.create(/*turbopackIgnore: true*/ path.join(dir, 'model_quantized.onnx'), {
    executionProviders: ['cpu'],
    intraOpNumThreads: 2,
    interOpNumThreads: 1,
  });
  const loaded: Loaded = { tokenizer, session, prototypes: [], thresholds: modelThresholds() };
  const texts: { category: GuessableCategory | 'private'; text: string }[] = [
    ...GUESSABLE.flatMap((category) => CATEGORY_PROTOTYPES[category].map((text) => ({ category, text: `query: ${text}` }))),
    ...PRIVATE_PROTOTYPES.map((text) => ({ category: 'private' as const, text: `query: ${text}` })),
  ];
  const vectors = await run(loaded, texts.map((t) => t.text));
  loaded.prototypes = texts.map((t, i) => ({ category: t.category, v: vectors[i] }));
  return loaded;
}

/** The model, loaded if need be; the idle timer starts over with every use. */
async function model(): Promise<Loaded> {
  if (state.idle) clearTimeout(state.idle);
  state.loading ??= load().catch((err) => {
    state.loading = null;
    throw err;
  });
  const loaded = await state.loading;
  state.idle = setTimeout(() => {
    state.idle = null;
    const was = state.loading;
    state.loading = null;
    void was?.then((m) => m.session.release()).catch(() => {});
  }, IDLE_MS);
  state.idle.unref?.();
  return loaded;
}

/** Unit-length mean-pooled embeddings of `texts`, in batches. */
async function run(m: Loaded, texts: string[]): Promise<Float32Array[]> {
  const out: Float32Array[] = [];
  for (let at = 0; at < texts.length; at += BATCH) {
    const batch = texts.slice(at, at + BATCH).map((t) => {
      const ids = m.tokenizer.encode(t).ids;
      // Keep the closing token when a long text is cut.
      return ids.length > MAX_TOKENS ? [...ids.slice(0, MAX_TOKENS - 1), ids[ids.length - 1]] : ids;
    });
    const len = Math.max(...batch.map((ids) => ids.length));
    const n = batch.length;
    const ids = new BigInt64Array(n * len);
    const mask = new BigInt64Array(n * len);
    batch.forEach((row, i) => row.forEach((id, j) => {
      ids[i * len + j] = BigInt(id);
      mask[i * len + j] = 1n;
    }));
    const feeds: Record<string, ort.Tensor> = {
      input_ids: new ort.Tensor('int64', ids, [n, len]),
      attention_mask: new ort.Tensor('int64', mask, [n, len]),
    };
    if (m.session.inputNames.includes('token_type_ids')) {
      feeds.token_type_ids = new ort.Tensor('int64', new BigInt64Array(n * len), [n, len]);
    }
    const result = await m.session.run(feeds);
    const hidden = result[m.session.outputNames[0]];
    const data = hidden.data as Float32Array;
    const dim = hidden.dims[2];
    batch.forEach((row, i) => {
      const v = new Float32Array(dim);
      for (let j = 0; j < row.length; j++) {
        const base = (i * len + j) * dim;
        for (let k = 0; k < dim; k++) v[k] += data[base + k];
      }
      let norm = 0;
      for (let k = 0; k < dim; k++) norm += v[k] * v[k];
      norm = Math.sqrt(norm) || 1;
      for (let k = 0; k < dim; k++) v[k] /= norm;
      out.push(v);
    });
  }
  return out;
}

/** Embeddings for `texts`, from the cache where it has them. One caller at a time uses the model. */
async function embed(texts: string[]): Promise<Float32Array[]> {
  const job = state.queue.then(async () => {
    const missing = [...new Set(texts.filter((t) => !state.cache.has(t)))];
    if (missing.length) {
      const m = await model();
      const vectors = await run(m, missing);
      missing.forEach((t, i) => state.cache.set(t, vectors[i]));
      // Oldest first out: a Map keeps insertion order.
      for (const key of state.cache.keys()) {
        if (state.cache.size <= MAX_CACHE) break;
        state.cache.delete(key);
      }
    }
    return texts.map((t) => state.cache.get(t)!);
  });
  state.queue = job.catch(() => {});
  return job;
}

const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/** How close `v` is to each category, and to money between people: the closest of each one's descriptions. */
function scoresOf(m: Loaded, v: Float32Array): CategoryScores {
  const scores = Object.fromEntries([...GUESSABLE, 'private'].map((c) => [c, -1])) as CategoryScores;
  for (const p of m.prototypes) scores[p.category] = Math.max(scores[p.category], dot(v, p.v));
  return scores;
}

export type GuessItem = { key: string; name: string; purpose?: string | null };
export type GuessExample = { name: string; category: GuessableCategory };

/**
 * Each item's category guess, or null where none is clear enough. `examples`
 * are the counterparties the user filed by rule — a near-identical name takes
 * their category. `t` defaults to the loaded model's own thresholds.
 */
export async function guessCategories(
  items: GuessItem[],
  examples: GuessExample[] = [],
  t?: Thresholds,
): Promise<Record<string, GuessableCategory | null>> {
  const out: Record<string, GuessableCategory | null> = {};
  if (!items.length) return out;
  const m = await model();
  const texts = items.map((it) => bookingText(it.name, it.purpose));
  const exampleTexts = examples.map((e) => bookingText(e.name));
  const vectors = await embed([...texts, ...exampleTexts]);
  const exampleVectors = vectors.slice(texts.length);
  items.forEach((it, i) => {
    const v = vectors[i];
    const scores = scoresOf(m, v);
    let example: { category: GuessableCategory; score: number } | null = null;
    exampleVectors.forEach((ev, j) => {
      const s = dot(v, ev);
      if (!example || s > example.score) example = { category: examples[j].category, score: s };
    });
    out[it.key] = pickCategory(scores, example, t ?? m.thresholds);
  });
  return out;
}

/** For calibration (scripts/eval-category-model.mjs): every category's score for each text. */
export async function scoreTexts(texts: string[]): Promise<CategoryScores[]> {
  const m = await model();
  const vectors = await embed(texts);
  return vectors.map((v) => scoresOf(m, v));
}

/** Lets a script end: releases the model now instead of after the idle minute. */
export async function releaseModel(): Promise<void> {
  if (state.idle) clearTimeout(state.idle);
  state.idle = null;
  const was = state.loading;
  state.loading = null;
  // The vectors belong to this model; whatever loads next may be another.
  state.cache.clear();
  await was?.then((m) => m.session.release()).catch(() => {});
}
