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
  bestScore, candidates, facilitatorOf, getMerchantKey, looksCorporate, nameScore,
} from './merchant-match';
export { getMerchantKey };
import { BRANDFETCH_CLIENT_ID, MERCHANT_LOGOS } from './session';

export type Merchant = {
  /** Brandfetch brand id the logo came from. */
  id: string;
  /** Display name, for the image's alt text and tooltip. */
  label: string;
  /** Opaque id for /api/merchant-logo — never the upstream URL. */
  logo: string;
  /**
   * The payment provider the purchase went through, set only when the shop was
   * identified from the Verwendungszweck because the booking's counterparty was
   * the provider itself. Mirrors `Merchant` in lib/fints-types.ts.
   */
  via?: { label: string; logo: string };
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

export type MerchantItem = {
  name: string;
  purpose?: string;
  key?: string;
};

const KNOWN_DOMAINS: Record<string, { domain: string; label: string }> = {
  'g2a': { domain: 'g2a.com', label: 'G2A.COM' },
  'g2a com': { domain: 'g2a.com', label: 'G2A.COM' },
  'g2a.com': { domain: 'g2a.com', label: 'G2A.COM' },
  'deutsche post': { domain: 'deutschepost.de', label: 'Deutsche Post' },
  'netflix': { domain: 'netflix.com', label: 'Netflix' },
  'steam': { domain: 'steampowered.com', label: 'Steam' },
  'steampowered': { domain: 'steampowered.com', label: 'Steam' },
  'steampowered.com': { domain: 'steampowered.com', label: 'Steam' },
  'valve': { domain: 'valvesoftware.com', label: 'Valve Corporation' },
  'valve corporation': { domain: 'valvesoftware.com', label: 'Valve Corporation' },
  'spotify': { domain: 'spotify.com', label: 'Spotify' },
  'amazon': { domain: 'amazon.de', label: 'Amazon' },
  'ebay': { domain: 'ebay.de', label: 'eBay' },
  'zalando': { domain: 'zalando.de', label: 'Zalando' },
  'epic games': { domain: 'epicgames.com', label: 'Epic Games' },
  'nintendo': { domain: 'nintendo.com', label: 'Nintendo' },
  'playstation': { domain: 'playstation.com', label: 'PlayStation' },
  'ubisoft': { domain: 'ubisoft.com', label: 'Ubisoft' },
  'apple': { domain: 'apple.com', label: 'Apple' },
  'paypal': { domain: 'paypal.com', label: 'PayPal' },
};

// The providers whose own mark can be shown as a badge on the shop's logo.
// Addressed by domain, so a badge costs no search — Brandfetch's logo CDN
// resolves a hostname directly.
const FACILITATOR_BRANDS: Record<string, { domain: string; label: string }> = {
  paypal: { domain: 'paypal.com', label: 'PayPal' },
  klarna: { domain: 'klarna.com', label: 'Klarna' },
  mollie: { domain: 'mollie.com', label: 'Mollie' },
  adyen: { domain: 'adyen.com', label: 'Adyen' },
  stripe: { domain: 'stripe.com', label: 'Stripe' },
  sumup: { domain: 'sumup.com', label: 'SumUp' },
  square: { domain: 'squareup.com', label: 'Square' },
  sq: { domain: 'squareup.com', label: 'Square' },
  izettle: { domain: 'zettle.com', label: 'Zettle' },
  zettle: { domain: 'zettle.com', label: 'Zettle' },
  nexi: { domain: 'nexi.it', label: 'Nexi' },
  unzer: { domain: 'unzer.com', label: 'Unzer' },
  payone: { domain: 'payone.com', label: 'PAYONE' },
  worldline: { domain: 'worldline.com', label: 'Worldline' },
  nuvei: { domain: 'nuvei.com', label: 'Nuvei' },
  trustly: { domain: 'trustly.com', label: 'Trustly' },
  gocardless: { domain: 'gocardless.com', label: 'GoCardless' },
  shopify: { domain: 'shopify.com', label: 'Shopify' },
  smart2pay: { domain: 'smart2pay.com', label: 'Smart2Pay' },
  s2p: { domain: 'smart2pay.com', label: 'Smart2Pay' },
  giropay: { domain: 'giropay.de', label: 'giropay' },
  sofort: { domain: 'klarna.com', label: 'Sofort' },
  wero: { domain: 'wero-wallet.eu', label: 'Wero' },
};

/**
 * The provider badge for a shop that was only identifiable from the purpose.
 *
 * Returned only when the shop and the provider are genuinely different
 * companies — a PayPal booking that resolved to PayPal itself gets no badge,
 * because there would be nothing for it to explain.
 */
function viaBadge(rawName: string, resolvedDomain: string): Merchant['via'] | undefined {
  const token = facilitatorOf(rawName);
  if (!token) return undefined;
  const brand = FACILITATOR_BRANDS[token];
  if (!brand || brand.domain === resolvedDomain) return undefined;
  return { label: brand.label, logo: registerLogo(brand.domain) };
}

async function resolveOne(rawName: string, purpose: string | undefined, businessBooking: boolean): Promise<Merchant | null> {
  if (!looksCorporate(rawName, businessBooking, purpose)) return null;

  for (const rung of candidates(rawName, purpose)) {
    const known = KNOWN_DOMAINS[rung.core.toLowerCase()];
    if (known) {
      console.log(`[merchants] "${rung.core}" → ${known.label} (${known.domain}, direct match)`);
      return {
        id: known.domain,
        label: known.label,
        logo: registerLogo(known.domain),
        ...(rung.fromPurpose ? { via: viaBadge(rawName, known.domain) } : {}),
      };
    }

    // A rung whose query is exactly a hostname needs no search: Brandfetch's
    // logo CDN is addressed by domain. Anchored, so only a rung deliberately
    // built from a domain hint can take this path — never a counterparty name
    // that merely happens to contain a dot.
    if (/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(rung.query)) {
      const domain = rung.query.toLowerCase();
      const label = domain.split('.')[0].toUpperCase();
      console.log(`[merchants] "${rung.core}" → ${label} (${domain}, direct domain)`);
      return {
        id: domain,
        label,
        logo: registerLogo(domain),
        ...(rung.fromPurpose ? { via: viaBadge(rawName, domain) } : {}),
      };
    }

    const hits = await search(rung.query);
    if (!hits.length) continue;

    // Score on name and bare domain before spending any bytes on a logo fetch:
    // only a plausible match is worth showing, a wrong logo is worse than none.
    const plausible = hits
      .map((h) => {
        const nScore = bestScore(rung.core, [h.name]);
        const dScore = nameScore(rung.core, domainCore(h.domain));
        const score = Math.max(nScore, dScore);
        const domainMatch = dScore >= 0.85 ? 1 : 0;
        return { hit: h, score, domainMatch };
      })
      .filter((c) => c.score >= rung.minScore)
      .sort((a, b) => (b.score - a.score) || (b.domainMatch - a.domainMatch) || (Number(b.hit.claimed) - Number(a.hit.claimed)));
    if (!plausible.length) continue;

    const { hit, score } = plausible[0];
    console.log(`[merchants] "${rung.core}" → ${hit.name} (${hit.domain}, score ${score.toFixed(2)})`);
    return {
      id: hit.brandId,
      label: hit.name,
      logo: registerLogo(hit.domain),
      ...(rung.fromPurpose ? { via: viaBadge(rawName, hit.domain) } : {}),
    };
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
export async function resolveMerchants(
  items: (string | MerchantItem)[],
  /**
   * The subset whose booking proves a business — a SEPA direct debit or a card
   * payment. Those names may skip the person veto in lib/merchant-match.ts.
   */
  businessNames: Iterable<string> = [],
): Promise<Record<string, Merchant | null>> {
  const out: Record<string, Merchant | null> = {};
  if (!MERCHANT_LOGOS) return out;

  const parsedItems: { name: string; purpose?: string; key: string }[] = [];
  const seenKeys = new Set<string>();

  for (const raw of items) {
    let name = '';
    let purpose: string | undefined;
    let key = '';

    if (typeof raw === 'string') {
      name = raw.trim();
      key = name;
    } else if (raw && typeof raw === 'object') {
      name = String(raw.name ?? '').trim();
      purpose = raw.purpose ? String(raw.purpose).trim() : undefined;
      key = raw.key || (purpose ? getMerchantKey({ remoteName: name, purpose }) : name);
    }

    if (!name || seenKeys.has(key)) continue;
    seenKeys.add(key);
    parsedItems.push({ name, purpose, key });
    if (parsedItems.length >= 60) break;
  }

  const business = new Set([...businessNames].map((n) => String(n || '').trim()).filter(Boolean));

  await Promise.all(parsedItems.map(async (item) => {
    // The cache key carries the verdict, so the same name seen first on a
    // transfer and later on a card payment is not answered from the stricter
    // of the two runs.
    const cacheKey = `${business.has(item.name) ? 'b' : 'p'}:${item.key.toLowerCase()}`;

    // Only a result resolved from the name alone may be published under the
    // name. A hint-derived logo belongs to one shop behind the wrapper, and
    // publishing it under "PayPal Europe" would put a G2A mark on every other
    // PayPal booking in the statement.
    const publish = (res: Merchant | null) => {
      out[item.key] = res;
      if (item.key === item.name) out[item.name] = res;
    };

    if (resolved.has(cacheKey)) {
      publish(resolved.get(cacheKey)!);
      return;
    }

    let job = inflight.get(cacheKey);
    if (!job) {
      job = resolveOne(item.name, item.purpose, business.has(item.name))
        .catch(() => null)
        .then((m) => {
          // Cache misses too — an unrecognised counterparty must not be looked
          // up again on every statement reload.
          resolved.set(cacheKey, m);
          inflight.delete(cacheKey);
          return m;
        });
      inflight.set(cacheKey, job);
    }
    publish(await job);
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
