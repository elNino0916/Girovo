// The question set with Gemma planning (lib/ask-planner.ts), as the desktop
// app does it: llama-server started headless on 127.0.0.1 from the app's own
// Gemma folder (or --dir), the same planner prompt and checks, the rules where
// no usable plan comes back. Writes results/gemma-latest.json.
//
//   node scripts/eval-fragen/run-gemma.mjs [--dir <gemma folder>] [--failures] [--only d001,d002] [--set holdout.json]
//
// Another set (relative to this folder) writes results/gemma-<set>-latest.json.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { report, runSet } from './run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const lib = (p) => import(pathToFileURL(path.join(ROOT, 'lib', p)).href);
const { checkPlan, plannerInput, plannerSystem } = await lib('ask-planner.ts');
const { readAsked } = await lib('ask-read.ts');
const { intentOf } = await lib('ask-intents.ts');

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
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
  { env: { ...process.env, LLAMA_API_KEY: key }, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
process.on('exit', () => child.kill());
for (let i = 0; ; i++) {
  if (child.exitCode != null || i > 600) throw new Error('llama-server did not start');
  try { if ((await fetch(`${BASE}/health`, { headers: { authorization: `Bearer ${key}` } })).ok) break; } catch { /* starting */ }
  await new Promise((r) => setTimeout(r, 200));
}

// The request the app's shell sends (src-tauri/src/gemma.rs chat_body), JSON held.
async function prompt(system, user, maxTokens) {
  const r = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0, top_k: 1, seed: 0, max_tokens: maxTokens, cache_prompt: true, chat_template_kwargs: { enable_thinking: false }, response_format: { type: 'json_object' } }),
  });
  const j = await r.json();
  return String(j.choices?.[0]?.message?.content ?? '').trim() || null;
}

const setFile = arg('set') ?? 'questions.json';
const own = path.basename(setFile, '.json');
const set = JSON.parse(fs.readFileSync(path.resolve(HERE, setFile), 'utf8'));
const today = set.today;
const system = plannerSystem(today, []);
let lastQuestion = null;
const times = [];
const raws = {};

async function readTurn(question, prevQuery) {
  const prev = prevQuery && lastQuestion ? { question: lastQuestion, query: prevQuery } : null;
  lastQuestion = question;
  const intent = intentOf(question);
  if (intent) return { intent };
  const ctx = { question, today, own: [], payees: [], prev };
  const t = performance.now();
  const raw = await prompt(system, plannerInput(ctx), 200);
  times.push(performance.now() - t);
  raws[question] = raw;
  const planned = checkPlan(raw, ctx);
  if (planned && 'offTopic' in planned) return { offTopic: true };
  if (planned) return { query: planned.plan, by: 'plan' };
  return readAsked(question, prevQuery, { today, own: [], reading: null });
}

const only = arg('only')?.split(',') ?? null;
const failures = args.includes('--failures');
const { rows, summary } = await runSet({
  readTurn, only, set,
  onTurn: (row) => { if (!failures || !row.ok) console.log(`${row.ok ? '✓' : '✗'} ${row.id}.${row.turn} ${row.q}${row.ok ? '' : `\n    ${row.misses.join('; ')}\n    gemma: ${raws[row.q]}`}`); },
});
times.sort((a, b) => a - b);
console.log(`\n${report(summary)}\nmedian planner ${Math.round(times[Math.floor(times.length / 2)] ?? 0)} ms`);
fs.mkdirSync(path.join(HERE, 'results'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'results', own === 'questions' ? 'gemma-latest.json' : `gemma-${own}-latest.json`), JSON.stringify({ summary, rows, raws }, null, 1));
child.kill();
process.exit(0);
