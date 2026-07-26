// Company logo lookup against Brandfetch.
//
// Brandfetch is used because it is a purpose-built brand-logo service: a Brand
// Search API for turning a company name into a domain (recall), and a Logo
// CDN for turning a domain into a crisp, correctly-sized mark (the fetch). It
// requires a client ID (free, from https://developers.brandfetch.com) but no
// account is needed to view logos, and no counterparty data is stored on
// Brandfetch's side beyond the search text itself.
//
// Two calls per unresolved batch:
//   1. Brand Search API — one per candidate string, for recall.
//   2. Logo CDN — one per surviving hit, to fetch the actual image bytes.
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
  bestScore, candidates, looksCorporate,
} from './merchant-match';
import { BRANDFETCH_CLIENT_ID, MERCHANT_LOGOS } from './session';

export type Merchant = {
  /** Brandfetch brand id the logo came from. */
  id: string;
  /** Display name, for the image's alt text and tooltip. */
  label: string;
  /** Opaque id for /api/merchant-logo — never the upstream URL. */
  logo: string;
};

const SEARCH_API = 'https://api.brandfetch.io/v2/search';
const LOGO_CDN = 'https://cdn.brandfetch.io';

const REQUEST_TIMEOUT_MS = 6000;
const MAX_CANDIDATES_PER_NAME = 6;
const MAX_LOGO_CACHE = 300;
/** Requested render size, doubled for retina per Brandfetch's own guidance. */
const LOGO_PX = 128;
/** Needed only to satisfy the Logo CDN's hotlink check — see fetchLogo(). */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// ---------------------------------------------------------------------------
// Process caches. Pinned to globalThis for the same reason sessions are: Next
// re-evaluates route modules on hot reload, and re-querying Brandfetch for
// names already resolved would be both slow and needlessly chatty.
// ---------------------------------------------------------------------------
type MerchantGlobal = typeof globalThis & {
  __sooskasseMerchants?: Map<string, Merchant | null>;
  __sooskasseMerchantInflight?: Map<string, Promise<Merchant | null>>;
  __sooskasseLogoDomains?: Map<string, string>;
  __sooskasseLogoBytes?: Map<string, { body: Uint8Array; type: string }>;
};
const g = globalThis as MerchantGlobal;

const resolved: Map<string, Merchant | null> = (g.__sooskasseMerchants ??= new Map());
const inflight: Map<string, Promise<Merchant | null>> = (g.__sooskasseMerchantInflight ??= new Map());
/** logo id → upstream domain. Doubles as the proxy's allowlist. */
const logoDomains: Map<string, string> = (g.__sooskasseLogoDomains ??= new Map());
const logoBytes: Map<string, { body: Uint8Array; type: string }> = (g.__sooskasseLogoBytes ??= new Map());

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
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

// Brandfetch is a metered third-party service; keep the app to a few requests
// at a time even when a statement covers dozens of new counterparties.
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
type SearchHit = {
  brandId: string;
  name: string;
  domain: string;
  claimed: boolean;
};

async function search(query: string): Promise<SearchHit[]> {
  const url = `${SEARCH_API}/${encodeURIComponent(query)}?${new URLSearchParams({
    c: BRANDFETCH_CLIENT_ID,
  })}`;

  type Hit = {
    brandId?: string;
    name?: string | null;
    domain?: string;
    claimed?: boolean;
  };
  const data = await throttled(() => getJson<Hit[]>(url));

  const out: SearchHit[] = [];
  for (const h of data || []) {
    if (!h.domain) continue;
    out.push({
      brandId: h.brandId || h.domain,
      name: h.name || h.domain,
      domain: h.domain,
      claimed: !!h.claimed,
    });
    if (out.length >= MAX_CANDIDATES_PER_NAME) break;
  }
  return out;
}

/** "paypal.com" → "paypal"; used only for scoring, never for lookup. */
function domainCore(domain: string): string {
  return domain.split('.')[0] || domain;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Register a domain and return the opaque id the browser will ask for. */
function registerLogo(domain: string): string {
  const id = crypto.createHash('sha1').update(domain).digest('hex').slice(0, 20);
  logoDomains.set(id, domain);
  return id;
}

async function resolveOne(rawName: string): Promise<Merchant | null> {
  if (!looksCorporate(rawName)) return null;

  for (const rung of candidates(rawName)) {
    const hits = await search(rung.query);
    if (!hits.length) continue;

    // Score on name and bare domain before spending any bytes on a logo fetch:
    // only a plausible match is worth showing, a wrong logo is worse than none.
    const plausible = hits
      .map((h) => ({ hit: h, score: bestScore(rung.core, [h.name, domainCore(h.domain)]) }))
      .filter((c) => c.score >= rung.minScore)
      .sort((a, b) => (b.score - a.score) || (Number(b.hit.claimed) - Number(a.hit.claimed)));
    if (!plausible.length) continue;

    const { hit, score } = plausible[0];
    console.log(`[merchants] "${rung.core}" → ${hit.name} (${hit.domain}, score ${score.toFixed(2)})`);
    return { id: hit.brandId, label: hit.name, logo: registerLogo(hit.domain) };
  }

  return null;
}

/**
 * Resolve counterparty names to company logos.
 *
 * Never throws and never blocks on a slow lookup for long: a name that can't be
 * resolved — because it isn't a company, because nothing matched confidently,
 * or because Brandfetch was unreachable — comes back as null and the UI keeps
 * its plain avatar.
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

  const domain = logoDomains.get(id);
  if (!domain) return null;

  try {
    // fallback/404 asks Brandfetch to fail rather than hand back a generic
    // lettermark placeholder — this app would rather show no logo than a wrong
    // or made-up one.
    const url = `${LOGO_CDN}/${encodeURIComponent(domain)}/fallback/404/h/${LOGO_PX}/w/${LOGO_PX}/icon.png` +
      `?${new URLSearchParams({ c: BRANDFETCH_CLIENT_ID })}`;
    const res = await fetch(url, {
      // The CDN is meant for direct <img> embeds and hotlink-blocks anything
      // that doesn't look like a browser's image request — a bare server
      // fetch gets 302'd to a docs page instead of the logo, regardless of
      // the client ID.
      headers: {
        'User-Agent': BROWSER_UA,
        'Sec-Fetch-Dest': 'image',
        Referer: 'https://cdn.brandfetch.io/',
      },
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
