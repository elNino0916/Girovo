// Bank database: all German FinTS/PIN-TAN institutes.
//
// Source: fints-institute-db (npm) — derived from the official DK/ZKA institute
// list. Each entry maps BLZ → name, BIC, location and the FinTS 3.0 PIN/TAN URL.
// On top of that we detect a "brand" per bank group so the frontend can show a
// matching logo, and expose a curated list of popular banks for quick access.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const raw = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'node_modules', 'fints-institute-db', 'fints-institutes.json'), 'utf8'),
);

// Supplement: banks whose PIN/TAN URL is missing from the DK institute list
// (e.g. Commerzbank, Targobank). Extracted from hbci4java's blz.properties
// (LGPL, https://github.com/hbci4j/hbci4java) — see banks-extra.json.
let extra = [];
try {
  extra = JSON.parse(fs.readFileSync(path.join(__dirname, 'banks-extra.json'), 'utf8'));
} catch { /* optional */ }

// ---------------------------------------------------------------------------
// Brand detection — used to pick a logo + accent color in the frontend.
// ---------------------------------------------------------------------------
const BRAND_RULES = [
  ['sparkasse', /sparkasse|kreissparkasse|stadtsparkasse|spk\b/i],
  ['sparda', /sparda/i],
  ['psd', /\bpsd\b/i],
  ['vrbank', /volksbank|raiffeisen|vr[- ]?bank|vr bank|spar- ?u\.? ?kredit|budenheim|genossenschaftsbank|verbund|aachener bank|gladbacher bank|k(ö|oe)lner bank|dortmunder volks/i],
  ['deutschebank', /deutsche bank/i],
  ['postbank', /postbank/i],
  ['commerzbank', /commerzbank/i],
  ['comdirect', /comdirect/i],
  ['ing', /\bing[- ]/i],
  ['dkb', /deutsche kreditbank|\bdkb\b/i],
  ['hypovereinsbank', /hypovereinsbank|unicredit/i],
  ['santander', /santander/i],
  ['targobank', /targobank/i],
  ['norisbank', /norisbank/i],
  ['consorsbank', /consorsbank|bnp paribas/i],
  ['apobank', /apotheker|apobank/i],
  ['gls', /\bgls\b/i],
  ['triodos', /triodos/i],
  ['ethikbank', /ethikbank/i],
  ['oldenburgische', /oldenburgische landesbank|\bolb\b/i],
  ['degussa', /degussa/i],
];

function brandOf(name) {
  for (const [brand, re] of BRAND_RULES) {
    if (re.test(name)) return brand;
  }
  return 'generic';
}

// Only banks that actually speak FinTS PIN/TAN are usable in this app.
const institutes = [
  ...raw
    .filter((b) => b.pinTanURL && b.blz)
    .map((b) => ({
      blz: b.blz,
      name: (b.name || '').trim(),
      location: (b.location || '').trim(),
      bic: b.bic || '',
      url: b.pinTanURL,
    })),
  ...extra,
].map((b) => ({ ...b, name: b.name.trim(), brand: brandOf(b.name) }));

const byBlz = new Map(institutes.map((b) => [b.blz, b]));

// ---------------------------------------------------------------------------
// Search: by BLZ (prefix) or by name/location (word matching, diacritic-safe).
// ---------------------------------------------------------------------------
const normalize = (s) =>
  s
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '');

const searchIndex = institutes.map((b) => ({ bank: b, text: normalize(`${b.name} ${b.location}`) }));

export function searchBanks(query, limit = 25) {
  const q = (query || '').trim();
  if (!q) return [];

  if (/^\d{3,8}$/.test(q)) {
    // Looks like a BLZ (or the beginning of one)
    const exact = byBlz.get(q);
    const prefix = institutes.filter((b) => b.blz.startsWith(q) && b !== exact);
    return [exact, ...prefix].filter(Boolean).slice(0, limit);
  }

  const words = normalize(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const matches = [];
  for (const { bank, text } of searchIndex) {
    if (words.every((w) => text.includes(w))) {
      matches.push(bank);
      if (matches.length >= 200) break; // plenty; ranked below
    }
  }
  // Rank: name starts with query > shorter names first (usually the "head" institute)
  const nq = normalize(q);
  matches.sort((a, b) => {
    const aStarts = normalize(a.name).startsWith(nq) ? 0 : 1;
    const bStarts = normalize(b.name).startsWith(nq) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return a.name.length - b.name.length;
  });
  return matches.slice(0, limit);
}

export function lookupBlz(blz) {
  return byBlz.get(String(blz).trim()) || null;
}

export const bankCount = institutes.length;

// ---------------------------------------------------------------------------
// Curated quick-pick list shown on the login screen.
// Sparkasse/VR entries have no fixed BLZ — the user finds their local institute
// via the search — so the quick picks are the big nationwide banks.
// ---------------------------------------------------------------------------
export const POPULAR_BANKS = [
  { key: 'sparkasse', name: 'Sparkasse', brand: 'sparkasse', search: 'Sparkasse', hint: 'Deine lokale Sparkasse per BLZ oder Ort suchen · S-pushTAN' },
  { key: 'vrbank', name: 'Volksbank / VR-Bank', brand: 'vrbank', search: 'Volksbank', hint: 'Deine lokale VR-Bank per BLZ oder Ort suchen · SecureGo plus' },
  { key: 'ing', name: 'ING', brand: 'ing', blz: '50010517', hint: 'Banking to go App' },
  { key: 'dkb', name: 'DKB', brand: 'dkb', blz: '12030000', hint: 'DKB-App' },
  { key: 'commerzbank', name: 'Commerzbank', brand: 'commerzbank', blz: '10040000', hint: 'photoTAN' },
  { key: 'deutschebank', name: 'Deutsche Bank', brand: 'deutschebank', blz: '10070000', hint: 'photoTAN' },
  { key: 'postbank', name: 'Postbank', brand: 'postbank', blz: '10010010', hint: 'BestSign' },
  { key: 'comdirect', name: 'comdirect', brand: 'comdirect', blz: '20041111', hint: 'photoTAN' },
  { key: 'hypovereinsbank', name: 'HypoVereinsbank', brand: 'hypovereinsbank', blz: '70020270', hint: 'appTAN' },
  { key: 'targobank', name: 'Targobank', brand: 'targobank', blz: '30020900', hint: 'easyTAN' },
  { key: 'consorsbank', name: 'Consorsbank', brand: 'consorsbank', blz: '76030080', hint: 'SecurePlus' },
  { key: 'norisbank', name: 'norisbank', brand: 'norisbank', blz: '10077777', hint: 'photoTAN' },
  { key: 'sparda', name: 'Sparda-Bank', brand: 'sparda', search: 'Sparda', hint: 'Deine lokale Sparda-Bank suchen · SpardaSecureApp' },
  { key: 'psd', name: 'PSD Bank', brand: 'psd', search: 'PSD', hint: 'Deine lokale PSD Bank suchen' },
  { key: 'apobank', name: 'apoBank', brand: 'apobank', blz: '30060601', hint: 'apoTAN' },
  { key: 'gls', name: 'GLS Bank', brand: 'gls', blz: '43060967', hint: 'SecureGo plus' },
]
  .map((p) => {
    if (p.blz) {
      const inst = byBlz.get(p.blz);
      if (!inst) return null; // BLZ not in the current dataset — drop the preset
      return { ...p, url: inst.url, bic: inst.bic, fullName: inst.name };
    }
    return p;
  })
  .filter(Boolean);
