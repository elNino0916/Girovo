// Regenerates banks-data.json — the institute database used by banks.mjs.
//
// Primary source: hbci4java's blz.properties (actively maintained by the
// Hibiscus community; the stale fints-institute-db npm dataset still lists
// 1000+ dead fiducia.de/gad.de hosts from before the Atruvia merger).
// The fints-institute-db URL is kept as `urlAlt` where it differs and isn't
// a known-dead host, so the server can fall back if the primary fails.
//
// Usage:
//   node scripts/update-banks.mjs               (fetches from GitHub)
//   node scripts/update-banks.mjs <path>        (local blz.properties)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'banks-data.json');
const SOURCE_URL = 'https://raw.githubusercontent.com/hbci4j/hbci4java/master/src/main/resources/blz.properties';

const DEAD_HOSTS = /fiducia\.de|gad\.de|dresdner-bank\.de|banking-dkb\.s-fints-pt-dkb\.de/i;

// Hosts that were shut down after bank/IT mergers, with their live successors
// (verified 2026-07: fiducia.de/gad.de no longer resolve, dresdner-bank.de has
// a broken TLS cert; Atruvia and Commerzbank serve the routed BLZs).
function fixUrl(url) {
  try {
    const u = new URL(url);
    if (/(^|\.)fiducia\.de$/i.test(u.hostname)) return 'https://fints2.atruvia.de/cgi-bin/hbciservlet';
    if (/(^|\.)gad\.de$/i.test(u.hostname)) return 'https://fints1.atruvia.de/cgi-bin/hbciservlet';
    if (/(^|\.)dresdner-bank\.de$/i.test(u.hostname)) return 'https://fints.commerzbank.de/fints';
    // Retired regional Sparkasse gateways (DNS no longer resolves) → the
    // current per-region FinTS 3.0 gateway.
    const spk = /^hbci-pintan-(rl|bw|rp)\.s-hbci\.de$/i.exec(u.hostname);
    if (spk) return `https://banking-${spk[1]}1.s-fints-pt-${spk[1]}.de/fints30`;
    return url;
  } catch {
    return url;
  }
}

async function loadProperties() {
  const localPath = process.argv[2];
  if (localPath) {
    return fs.readFileSync(localPath, 'utf8');
  }
  console.log(`Fetching ${SOURCE_URL} …`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString('utf8');
}

const props = await loadProperties();

// blz.properties format: BLZ=name|city|BIC|checksum|hbciDomain|pinTanURL|hbciVersion|pinTanVersion|
const banks = new Map();
for (const line of props.split(/\r?\n/)) {
  const eq = line.indexOf('=');
  if (eq < 1) continue;
  const blz = line.slice(0, eq);
  if (!/^\d{8}$/.test(blz)) continue;
  const [name, city, bic, , , url] = line.slice(eq + 1).split('|');
  const cleanUrl = (url || '').trim();
  if (!cleanUrl.startsWith('https://')) continue;
  banks.set(blz, {
    blz,
    name: (name || '').trim(),
    location: (city || '').trim(),
    bic: (bic || '').trim(),
    url: fixUrl(cleanUrl),
  });
}
console.log(`hbci4java: ${banks.size} institutes with PIN/TAN URL`);

// Merge the npm dataset: alternate URLs + any institute hbci4java lacks.
let alts = 0, extra = 0;
try {
  const legacy = require('fints-institute-db');
  for (const b of legacy) {
    if (!b.blz || !b.pinTanURL) continue;
    const url = fixUrl(b.pinTanURL).replace(/\/+$/, '');
    const entry = banks.get(b.blz);
    if (entry) {
      if (url !== entry.url.replace(/\/+$/, '') && !DEAD_HOSTS.test(url)) {
        entry.urlAlt = url;
        alts++;
      }
    } else if (!DEAD_HOSTS.test(url)) {
      banks.set(b.blz, {
        blz: b.blz,
        name: (b.name || '').trim(),
        location: (b.location || '').trim(),
        bic: b.bic || '',
        url,
      });
      extra++;
    }
  }
} catch {
  console.log('fints-institute-db not installed — skipping alternate URLs');
}

const list = [...banks.values()].sort((a, b) => a.blz.localeCompare(b.blz));
fs.writeFileSync(OUT, JSON.stringify(list, null, 1) + '\n');
console.log(`Wrote ${list.length} institutes (${alts} with alternate URL, ${extra} legacy-only) → ${path.basename(OUT)}`);
