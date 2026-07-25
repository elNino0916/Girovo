// Company logo lookup against Wikidata.
//
// Wikidata is used because it is genuinely public (no key, no account, no
// commercial terms), because it already stores the logos this app needs
// (property P154, files hosted on Wikimedia Commons — the same source as
// public/logos/), and because it is structured enough to *verify* a match
// rather than guess one: an entity's `instance of` classes and its parent
// organisation are queryable, so "Amazon" can be told apart from the river and
// "DB Vertrieb GmbH" can be walked up to Deutsche Bahn.
//
// Two calls per unresolved batch:
//   1. wbsearchentities — one per candidate string, for recall.
//   2. one SPARQL query  — verifies every surviving candidate at once, for
//      precision: logo, instance-of classes, parent organisation.
//
// Nothing is written to disk. Results (including misses) live in a process
// cache so a name is looked up at most once per server run.
//
// PRIVACY: this is the only code path in the app that talks to a host other
// than the user's bank, and it is the reason MERCHANT_LOGOS exists. Only the
// cleaned company core leaves the machine — never a full counterparty string,
// an amount, an IBAN or a date — and only for names that lib/merchant-match.ts
// judged corporate.

import 'server-only';

import crypto from 'node:crypto';
import {
  TYPE_DENYLIST, bestScore, candidates, looksCorporate,
} from './merchant-match';
import { MERCHANT_LOGOS } from './session';

export type Merchant = {
  /** Wikidata item the logo came from. */
  id: string;
  /** Display name, for the image's alt text and tooltip. */
  label: string;
  /** Opaque id for /api/merchant-logo — never the upstream URL. */
  logo: string;
};

const SEARCH_API = 'https://www.wikidata.org/w/api.php';
const SPARQL_API = 'https://query.wikidata.org/sparql';

// Wikimedia requires a descriptive User-Agent identifying the client.
const USER_AGENT =
  'Sooskasse-FinTS/2.0 (self-hosted personal banking client; +https://github.com/elNino0916/Sooskasse-FinTS)';

const REQUEST_TIMEOUT_MS = 6000;
const MAX_CANDIDATES_PER_NAME = 6;
const MAX_LOGO_CACHE = 300;

// ---------------------------------------------------------------------------
// Process caches. Pinned to globalThis for the same reason sessions are: Next
// re-evaluates route modules on hot reload, and re-querying Wikidata for names
// already resolved would be both slow and needlessly chatty.
// ---------------------------------------------------------------------------
type MerchantGlobal = typeof globalThis & {
  __sooskasseMerchants?: Map<string, Merchant | null>;
  __sooskasseMerchantInflight?: Map<string, Promise<Merchant | null>>;
  __sooskasseLogoUrls?: Map<string, string>;
  __sooskasseLogoBytes?: Map<string, { body: Uint8Array; type: string }>;
};
const g = globalThis as MerchantGlobal;

const resolved: Map<string, Merchant | null> = (g.__sooskasseMerchants ??= new Map());
const inflight: Map<string, Promise<Merchant | null>> = (g.__sooskasseMerchantInflight ??= new Map());
/** logo id → upstream Commons URL. Doubles as the proxy's allowlist. */
const logoUrls: Map<string, string> = (g.__sooskasseLogoUrls ??= new Map());
const logoBytes: Map<string, { body: Uint8Array; type: string }> = (g.__sooskasseLogoBytes ??= new Map());

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) {
      console.warn(`[merchants] ${new URL(url).host} answered ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn('[merchants] lookup failed:', (err as Error)?.message || err);
    return null;
  }
}

// Wikidata is a shared public service; keep the app to a few requests at a time
// even when a statement covers dozens of new counterparties.
let active = 0;
const queue: (() => void)[] = [];
const MAX_CONCURRENT = 4;

async function throttled<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((r) => queue.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    queue.shift()?.();
  }
}

// ---------------------------------------------------------------------------
// Step 1 — recall: what could this name be?
// ---------------------------------------------------------------------------
type SearchHit = { id: string; label: string; matchedText: string };

async function search(query: string, language: 'de' | 'en'): Promise<SearchHit[]> {
  const url = `${SEARCH_API}?${new URLSearchParams({
    action: 'wbsearchentities',
    search: query,
    language,
    uselang: language,
    type: 'item',
    limit: String(MAX_CANDIDATES_PER_NAME),
    format: 'json',
    origin: '*',
  })}`;

  type Response = {
    search?: { id: string; label?: string; match?: { text?: string } }[];
  };
  const data = await throttled(() => getJson<Response>(url));
  return (data?.search || []).map((s) => ({
    id: s.id,
    label: s.label || '',
    matchedText: s.match?.text || s.label || '',
  }));
}

// ---------------------------------------------------------------------------
// Step 2 — precision: is it a company, and what is its logo?
// ---------------------------------------------------------------------------
type Verified = {
  id: string;
  label: string;
  types: Set<string>;
  logoUrl?: string;
  /** Logo of the parent organisation, for subsidiaries that have none. */
  parentLogoUrl?: string;
  parentLabel?: string;
};

async function verify(ids: string[]): Promise<Map<string, Verified>> {
  const out = new Map<string, Verified>();
  if (!ids.length) return out;

  // One query for the whole batch. No transitive P279* closure — requiring a
  // logo already excludes almost everything that isn't an organisation, and the
  // denylist catches the rest, so this stays fast and never times out.
  const values = ids.map((id) => `wd:${id}`).join(' ');
  const query = `
    SELECT ?item ?itemLabel ?type ?logo ?parent ?parentLabel ?parentLogo WHERE {
      VALUES ?item { ${values} }
      OPTIONAL { ?item wdt:P154 ?logo . }
      OPTIONAL { ?item wdt:P31 ?type . }
      OPTIONAL {
        ?item wdt:P749 ?parent .
        OPTIONAL { ?parent wdt:P154 ?parentLogo . }
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en". }
    }`;

  const url = `${SPARQL_API}?${new URLSearchParams({ query, format: 'json' })}`;

  type Binding = Record<string, { value: string } | undefined>;
  type Response = { results?: { bindings?: Binding[] } };
  const data = await throttled(() => getJson<Response>(url));
  if (!data) return out;

  const qid = (uri: string | undefined) => (uri ? uri.split('/').pop() || '' : '');

  for (const b of data.results?.bindings || []) {
    const id = qid(b.item?.value);
    if (!id) continue;
    const entry = out.get(id) || { id, label: '', types: new Set<string>() };
    if (b.itemLabel?.value) entry.label = b.itemLabel.value;
    if (b.type?.value) entry.types.add(qid(b.type.value));
    if (b.logo?.value) entry.logoUrl = b.logo.value;
    if (b.parentLogo?.value) entry.parentLogoUrl = b.parentLogo.value;
    if (b.parentLabel?.value) entry.parentLabel = b.parentLabel.value;
    out.set(id, entry);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Picking the usable mark
// ---------------------------------------------------------------------------

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

/** "…/Special:FilePath/DB%20Vertrieb.svg" → "DB Vertrieb.svg" */
function commonsFilename(url: string): string | null {
  const tail = url.split('Special:FilePath/')[1];
  if (!tail) return null;
  try {
    return decodeURIComponent(tail.split('?')[0]);
  } catch {
    return null;
  }
}

/** Width ÷ height for Commons files, in one batched request. */
async function aspectRatios(urls: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const byTitle = new Map<string, string>();
  for (const u of urls) {
    const f = commonsFilename(u);
    if (f) byTitle.set(`File:${f}`, u);
  }
  if (!byTitle.size) return out;

  const api = `${COMMONS_API}?${new URLSearchParams({
    action: 'query',
    titles: [...byTitle.keys()].join('|'),
    prop: 'imageinfo',
    iiprop: 'size',
    format: 'json',
    origin: '*',
  })}`;

  type Response = {
    query?: { pages?: Record<string, { title?: string; imageinfo?: { width: number; height: number }[] }> };
  };
  const data = await throttled(() => getJson<Response>(api));
  for (const page of Object.values(data?.query?.pages || {})) {
    const info = page.imageinfo?.[0];
    const url = page.title ? byTitle.get(page.title) : undefined;
    if (info?.width && info?.height && url) out.set(url, info.width / info.height);
  }
  return out;
}

// A mark wider than this renders as an illegible sliver in the ~30px tile a
// transaction row gives it. "DB Vertrieb" is a 120×21 wordmark (5.7:1); the
// Deutsche Bahn square behind it is what actually reads at that size.
const MAX_USABLE_ASPECT = 3.5;

/**
 * Choose between a company's own mark and its parent group's.
 *
 * The subsidiary's own logo is the more accurate answer and wins by default —
 * comdirect should not be shown as Commerzbank. But German statements are full
 * of back-office entities whose "logo" is a long horizontal wordmark, and at
 * avatar size the group's mark is the one a person recognises.
 */
async function pickLogo(v: Verified): Promise<{ url: string; label: string } | null> {
  const own = v.logoUrl;
  const parent = v.parentLogoUrl;
  if (!own) return parent ? { url: parent, label: v.parentLabel || v.label } : null;
  if (!parent) return { url: own, label: v.label };

  const ratios = await aspectRatios([own, parent]);
  const ownAspect = ratios.get(own) ?? 1;
  const parentAspect = ratios.get(parent) ?? 1;

  if (ownAspect > MAX_USABLE_ASPECT && parentAspect < ownAspect) {
    return { url: parent, label: v.parentLabel || v.label };
  }
  return { url: own, label: v.label };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Register a Commons URL and return the opaque id the browser will ask for. */
function registerLogo(commonsUrl: string): string {
  const https = commonsUrl.replace(/^http:/, 'https:');
  const id = crypto.createHash('sha1').update(https).digest('hex').slice(0, 20);
  logoUrls.set(id, https);
  return id;
}

async function resolveOne(rawName: string): Promise<Merchant | null> {
  if (!looksCorporate(rawName)) return null;

  for (const rung of candidates(rawName)) {
    const hits = await search(rung.query, 'de');
    const pool = hits.length ? hits : await search(rung.query, 'en');
    if (!pool.length) continue;

    // Score on what the search actually matched before spending a verification
    // request: only plausible names are worth checking.
    const plausible = pool
      .map((h) => ({ hit: h, score: bestScore(rung.core, [h.label, h.matchedText]) }))
      .filter((c) => c.score >= rung.minScore)
      .sort((a, b) => b.score - a.score);
    if (!plausible.length) continue;

    const verified = await verify(plausible.map((c) => c.hit.id));

    for (const { hit, score } of plausible) {
      const v = verified.get(hit.id);
      if (!v) continue;
      // A thing with no `instance of` at all is too thin to trust.
      if (!v.types.size) continue;
      if ([...v.types].some((t) => TYPE_DENYLIST.has(t))) continue;

      // Own mark, or the parent group's when the subsidiary hasn't got one it
      // can be recognised by — this is what turns "DB Vertrieb GmbH" into the
      // Deutsche Bahn logo.
      const picked = await pickLogo(v);
      if (!picked) continue;

      const label = picked.label || hit.label;
      console.log(`[merchants] "${rung.core}" → ${label} (${hit.id}, score ${score.toFixed(2)})`);
      return { id: hit.id, label, logo: registerLogo(picked.url) };
    }
  }

  return null;
}

/**
 * Resolve counterparty names to company logos.
 *
 * Never throws and never blocks on a slow lookup for long: a name that can't be
 * resolved — because it isn't a company, because nothing matched confidently,
 * or because Wikidata was unreachable — comes back as null and the UI keeps its
 * plain avatar.
 */
export async function resolveMerchants(names: string[]): Promise<Record<string, Merchant | null>> {
  const out: Record<string, Merchant | null> = {};
  if (!MERCHANT_LOGOS) return out;

  const wanted = [...new Set(names.map((n) => String(n || '').trim()).filter(Boolean))].slice(0, 60);

  await Promise.all(wanted.map(async (name) => {
    const key = name.toLowerCase();

    if (resolved.has(key)) {
      out[name] = resolved.get(key)!;
      return;
    }

    let job = inflight.get(key);
    if (!job) {
      job = resolveOne(name)
        .catch(() => null)
        .then((m) => {
          // Cache misses too — an unrecognised counterparty must not be looked
          // up again on every statement reload.
          resolved.set(key, m);
          inflight.delete(key);
          return m;
        });
      inflight.set(key, job);
    }
    out[name] = await job;
  }));

  return out;
}

/**
 * Fetch a logo's bytes. Only ids this process minted are served, so the proxy
 * cannot be pointed at an arbitrary host.
 */
export async function fetchLogo(id: string): Promise<{ body: Uint8Array; type: string } | null> {
  const cached = logoBytes.get(id);
  if (cached) return cached;

  const url = logoUrls.get(id);
  if (!url) return null;

  try {
    // Commons renders SVG marks to PNG at the requested width, so the browser
    // gets one predictable raster regardless of how the logo was uploaded.
    const res = await fetch(`${url}?width=96`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) return null;

    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return null;

    const body = new Uint8Array(await res.arrayBuffer());
    if (body.byteLength > 512 * 1024) return null;

    if (logoBytes.size >= MAX_LOGO_CACHE) {
      logoBytes.delete(logoBytes.keys().next().value as string);
    }
    const entry = { body, type };
    logoBytes.set(id, entry);
    return entry;
  } catch (err) {
    console.warn('[merchants] logo fetch failed:', (err as Error)?.message || err);
    return null;
  }
}
