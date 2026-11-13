// Gemma 4 E2B on the two booking jobs the phone gives Gemini Nano: a
// category for a booking (lib/nano-categories.ts) and the brand behind a
// counterparty's name (lib/nano-names.ts), with Nano's own prompts, measured
// on the labelled sets: scripts/category-sets.mjs (CASES to tune on, HOLDOUT
// only measured) and scripts/eval-names-set.mjs. For comparison, what the
// desktop does today: e5 for categories (node scripts/eval-category-model.mjs)
// and the tidied name (lib/format.ts displayName) for names.
//
//   node scripts/eval-gemma-bookings.mjs [--dir <gemma folder>] [--only categories|names|clean] [--verbose]
//
// clean: the cleanup prompt (lib/ai-names.ts), a name for every booking. The
// even entries of the names set are the ones to tune on, the odd ones only
// measured.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CASES, HOLDOUT } from './category-sets.mjs';
import { NAMES } from './eval-names-set.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lib = (p) => import(pathToFileURL(path.join(ROOT, 'lib', p)).href);
const { NANO_SYSTEM, NANO_CATEGORY_LIST, nanoBookingText, parseNanoAnswer } = await lib('nano-categories.ts');
const { NAME_SYSTEM, NAME_SHOTS, nameText, parseNameAnswer } = await lib('nano-names.ts');
const { displayName } = await lib('format.ts');
const { CLEAN_SYSTEM, CLEAN_SHOTS, cleanText, parseCleanAnswer } = await lib('ai-names.ts');
const { aiPrompt } = await lib('ai-categorize.ts');

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const verbose = args.includes('--verbose');
const only = arg('only');
const dir = arg('dir') ?? path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'de.elnino0916.sooskasse-fints', 'gemma');
const find = (d, name) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { const f = find(p, name); if (f) return f; } else if (e.name === name) return p;
  }
  return null;
};
const exe = find(path.join(dir, 'llama-b12250'), process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
const model = path.join(dir, 'gemma-4-E2B_q4_0-it.gguf');
if (!exe || !fs.existsSync(model)) throw new Error(`no Gemma in ${dir}`);
const port = await new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const key = crypto.randomBytes(32).toString('hex');
const BASE = `http://127.0.0.1:${port}`;
const child = spawn(exe, ['-m', model, '--host', '127.0.0.1', '--port', String(port), '--jinja', '-c', '4096', '-np', '1', '-ngl', '99', '--device', 'Vulkan0', '--no-webui'],
  { env: { ...process.env, LLAMA_API_KEY: key }, stdio: 'ignore', windowsHide: true });
process.on('exit', () => child.kill());
for (let i = 0; ; i++) {
  if (child.exitCode != null || i > 600) throw new Error('llama-server did not start');
  try { if ((await fetch(`${BASE}/health`, { headers: { authorization: `Bearer ${key}` } })).ok) break; } catch { /* starting */ }
  await new Promise((r) => setTimeout(r, 200));
}
const times = [];
async function prompt(system, user, maxTokens) {
  const t = performance.now();
  const r = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0, top_k: 1, seed: 0, max_tokens: maxTokens, cache_prompt: true, chat_template_kwargs: { enable_thinking: false } }),
  });
  const text = String((await r.json()).choices?.[0]?.message?.content ?? '').trim();
  times.push(performance.now() - t);
  return text;
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.floor(s.length / 2)] ?? 0); };

async function categories(label, set) {
  let right = 0, wrong = 0, none = 0, falseGuess = 0, nulls = 0;
  const misses = [];
  for (const [name, purpose, expect] of set) {
    // The desktop's prompt (lib/ai-categorize.ts): the phone's list with its own additions.
    const p = aiPrompt({ name, purpose: purpose ?? '' });
    const raw = await prompt(p.system, p.user, p.maxTokens);
    const got = parseNanoAnswer(raw);
    const what = `"${name}${purpose ? ` – ${purpose}` : ''}"`;
    if (expect === null) {
      nulls++;
      if (got) { falseGuess++; misses.push(`  ✗ ${what} → ${got} (should stay Sonstiges)`); }
      continue;
    }
    if (got === expect) right++;
    else if (got === null) { none++; if (verbose) misses.push(`  · ${what} → none (is ${expect})`); }
    else { wrong++; misses.push(`  ✗ ${what} → ${got} (is ${expect})`); }
  }
  const labelled = set.length - nulls;
  const guessed = right + wrong + falseGuess;
  console.log(`\n${label}: right ${right}/${labelled} (${Math.round(100 * right / labelled)} %) · wrong ${wrong} · left as Sonstiges ${none} · persons given a category ${falseGuess}/${nulls} · precision ${(100 * (guessed ? right / guessed : 1)).toFixed(1)} %`);
  for (const m of misses) console.log(m);
}

const norm = (s) => String(s ?? '').toLocaleLowerCase('de').normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]/g, '');
const accepted = (expect) => (Array.isArray(expect) ? expect : [expect]).map(norm);

async function names() {
  const r = { gemma: 0, gemmaRaw: 0, rules: 0, rulesStarts: 0, gemmaWrong: 0, gemmaNone: 0, nullsBranded: 0, nulls: 0, brands: 0 };
  const lines = [];
  for (const [name, purpose, expect] of NAMES) {
    const raw = await prompt(NAME_SYSTEM, NAME_SHOTS + nameText(name), 16);
    const parsed = parseNameAnswer(raw, name);
    const shown = displayName(name);
    if (expect === null) {
      r.nulls++;
      if (parsed) { r.nullsBranded++; lines.push(`  ✗ "${name}" → ${parsed} (no brand)`); }
      continue;
    }
    r.brands++;
    const ok = accepted(expect);
    const g = parsed && ok.includes(norm(parsed));
    const gRaw = !/^none\b/i.test(raw) && ok.includes(norm(raw.split('\n')[0]));
    const rules = ok.includes(norm(shown));
    const rulesStarts = rules || ok.some((a) => norm(shown).startsWith(a));
    if (g) r.gemma++; else if (parsed) { r.gemmaWrong++; lines.push(`  ✗ "${name}" → ${parsed} (is ${[].concat(expect).join(' / ')})`); } else r.gemmaNone++;
    if (gRaw) r.gemmaRaw++;
    if (rules) r.rules++;
    if (rulesStarts) r.rulesStarts++;
    if (verbose && !g) lines.push(`  · "${name}" → Gemma "${raw}" · today "${shown}" (is ${[].concat(expect).join(' / ')})`);
  }
  console.log(`\nNames (${r.brands} with a brand, ${r.nulls} without):`);
  console.log(`  Gemma, checked (brand must stand in the name): ${r.gemma}/${r.brands} exact · ${r.gemmaWrong} wrong · ${r.gemmaNone} none · ${r.nullsBranded}/${r.nulls} without a brand given one`);
  console.log(`  Gemma, its raw answer:                          ${r.gemmaRaw}/${r.brands} exact`);
  console.log(`  Today (displayName):                            ${r.rules}/${r.brands} exact · ${r.rulesStarts}/${r.brands} start with the brand`);
  for (const l of lines) console.log(l);
}

async function clean(label, set) {
  let brandsRight = 0, brands = 0, kept = 0, nulls = 0, rejected = 0;
  const lines = [];
  for (const [name, purpose, expect] of set) {
    const raw = await prompt(CLEAN_SYSTEM, CLEAN_SHOTS + cleanText(name, purpose), 20);
    const parsed = parseCleanAnswer(raw, name, purpose);
    if (!parsed) rejected++;
    const shown = parsed ?? displayName(name);
    if (expect === null) {
      nulls++;
      if (parsed) kept++;
      lines.push(`  ${parsed ? '·' : '↩'} "${name}"${purpose ? ` (${purpose})` : ''} → ${shown}${parsed ? '' : `   [model: ${raw}]`}`);
      continue;
    }
    brands++;
    const ok = accepted(expect).includes(norm(shown));
    if (ok) brandsRight++;
    else lines.push(`  ✗ "${name}"${purpose ? ` (${purpose})` : ''} → ${shown} (is ${[].concat(expect).join(' / ')})${parsed ? '' : `   [model: ${raw}]`}`);
  }
  console.log(`
${label}: brands right ${brandsRight}/${brands} · names without a brand cleaned ${kept}/${nulls} · answers the check refused ${rejected}`);
  for (const l of lines) console.log(l);
}

if (only === 'clean') {
  await clean('Clean names, tune (even entries)', NAMES.filter((_, i) => i % 2 === 0));
  if (args.includes('--holdout')) await clean('Clean names, holdout (odd entries, measured only)', NAMES.filter((_, i) => i % 2 === 1));
  console.log(`
median ${median(times)} ms per booking`);
  child.kill();
  process.exit(0);
}
if (only !== 'names') {
  await categories('Categories, CASES', CASES);
  await categories('Categories, HOLDOUT (measured only)', HOLDOUT);
}
if (only !== 'categories') await names();
console.log(`\nmedian ${median(times)} ms per booking`);
child.kill();
process.exit(0);
