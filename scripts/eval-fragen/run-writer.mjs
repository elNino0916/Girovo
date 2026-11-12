// The writer's sentences over invented bookings: ten questions planned and
// answered as the desktop app does, each sentence with the guard's verdict
// (lib/gemma-writer.ts usable) and how long Gemma took. For comparing models
// by eye; nothing is scored. The folder holds llama-b12250 and the model as
// gemma-4-E2B_q4_0-it.gguf, as the app's own Gemma folder does.
//
//   node scripts/eval-fragen/run-writer.mjs <gemma folder>
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lib = (p) => import(pathToFileURL(path.join(ROOT, 'lib', p)).href);
const { computeAnswer } = await lib('nano-ask.ts');
const { readAsked } = await lib('ask-read.ts');
const { checkPlan, plannerInput, plannerSystem } = await lib('ask-planner.ts');
const { writerInput, writerSystem, usable } = await lib('gemma-writer.ts');

const dir = process.argv[2];
const find = (d, name) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { const f = find(p, name); if (f) return f; } else if (e.name === name) return p;
  }
  return null;
};
const exe = find(path.join(dir, 'llama-b12250'), 'llama-server.exe');
const model = path.join(dir, 'gemma-4-E2B_q4_0-it.gguf');
const port = await new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const key = crypto.randomBytes(32).toString('hex');
const BASE = `http://127.0.0.1:${port}`;
const child = spawn(exe, ['-m', model, '--host', '127.0.0.1', '--port', String(port), '--jinja', '-c', '4096', '-np', '1', '-ngl', '99', '--device', 'Vulkan0', '--no-webui'],
  { env: { ...process.env, LLAMA_API_KEY: key }, stdio: 'ignore', windowsHide: true });
process.on('exit', () => child.kill());
for (let i = 0; ; i++) {
  if (child.exitCode != null || i > 600) throw new Error('no start');
  try { if ((await fetch(`${BASE}/health`, { headers: { authorization: `Bearer ${key}` } })).ok) break; } catch { /* starting */ }
  await new Promise((r) => setTimeout(r, 200));
}
async function prompt(system, user, json = false) {
  const r = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0, top_k: 1, seed: 0, max_tokens: 160, cache_prompt: true, chat_template_kwargs: { enable_thinking: false }, ...(json ? { response_format: { type: 'json_object' } } : {}) }),
  });
  return String((await r.json()).choices?.[0]?.message?.content ?? '').trim();
}

const today = '2026-11-12';
const cat = {};
const txs = [];
const add = (day, amount, name, category) => {
  const tx = { valueDate: day, entryDate: day, bankDay: day, amount, currency: 'EUR', purpose: name, bookingText: amount < 0 ? 'Kartenzahlung' : 'Gutschrift', remoteName: name, remoteIban: '', remoteBic: '' };
  cat[txs.length] = category;
  txs.push(tx);
};
for (const m of ['2026-08', '2026-09', '2026-10', '2026-11']) {
  add(`${m}-01`, 2850, 'Arbeitgeber GmbH', 'income');
  add(`${m}-03`, -890, 'Hausverwaltung Meier', 'housing');
  add(`${m}-05`, -12.99, 'Netflix', 'media');
  add(`${m}-06`, -10.99, 'Spotify', 'media');
  if (m !== '2026-11') {
    add(`${m}-09`, -54.2, 'Rewe', 'groceries'); add(`${m}-16`, -38.75, 'Lidl', 'groceries'); add(`${m}-23`, -61.1, 'Rewe', 'groceries');
    add(`${m}-12`, -23.5, 'Pinos Pizza', 'dining'); add(`${m}-20`, -31.8, 'Lieferando', 'dining');
    add(`${m}-14`, -68.4, 'Shell', 'mobility'); add(`${m}-27`, -129.99, 'Amazon', 'shopping');
  }
}
add('2026-10-18', -412, 'MediaMarkt', 'shopping');
add('2026-09-08', 150, 'Lea Schmidt', 'income');
const categoryOf = (tx) => ({ id: cat[txs.indexOf(tx)], source: 'rule' });
const loaded = { from: '2026-08-01', to: today };

const questions = [
  'Wie viel hab ich im Oktober für Lebensmittel ausgegeben?',
  'Netflix pro Monat',
  'Wie oft war ich bei Rewe?',
  'Größte Ausgabe dieses Jahr',
  'Wann war ich zuletzt bei Shell?',
  'Wofür geb ich am meisten aus?',
  'Wo war ich im September essen?',
  'Hab ich im Oktober mehr ausgegeben als im September?',
  'Was hat mir Lea geschickt?',
  'How much did I spend on Amazon since August?',
];
for (const q of questions) {
  const payees = [...new Set(txs.map((t) => t.remoteName))];
  const ctx = { question: q, today, own: [], payees, prev: null };
  const planned = checkPlan(await prompt(plannerSystem(today, []), plannerInput(ctx), true), ctx);
  const read = planned && 'plan' in planned ? { query: planned.plan } : readAsked(q, null, { today, own: [], reading: null });
  if (!('query' in read)) { console.log(`\n${q}\n  (no reading)`); continue; }
  const answer = computeAnswer(read.query, txs, { categoryOf }, loaded, today);
  const lang = /^[A-Za-z ]+\?$/.test(q) && /\b(how|what|did)\b/i.test(q) ? 'en' : 'de';
  const input = writerInput(q, answer, { lang, nameOf: (id) => ({ housing: 'Wohnen & Energie', groceries: 'Lebensmittel', dining: 'Essen & Trinken', media: 'Abos & Medien', shopping: 'Shopping', mobility: 'Mobilität', income: 'Einnahmen' })[id] ?? id, payeeOf: (tx) => tx.remoteName });
  const t = performance.now();
  const text = await prompt(writerSystem(lang), input.prompt);
  console.log(`\n${q}\n  ${usable(text, input) ? 'OK ' : 'BAD'} ${Math.round(performance.now() - t)} ms  ${text.replace(/\s+/g, ' ')}`);
}
child.kill();
process.exit(0);
