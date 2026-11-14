// The question set with Gemma planning (lib/ask-planner.ts), as the desktop
// app does it: llama-server started headless on 127.0.0.1 from the app's own
// Gemma folder (or --dir), the same planner prompt and checks, the rules where
// no usable plan comes back. Writes results/gemma-latest.json.
//
//   node scripts/eval-fragen/run-gemma.mjs [--dir <gemma folder>] [--failures] [--only d001,d002] [--set holdout.json]
//     [--model <file.gguf>] [--server <llama-server>]
//
// Another set (relative to this folder) writes results/gemma-<set>-latest.json;
// another model writes results/<model>-<set>-latest.json. blind.json prints
// only its score, never a miss (README: nobody tuning reads them).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { costLine, modelArgs, spread, startLlama } from '../eval-llama.mjs';
import { report, runSet } from './run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const lib = (p) => import(pathToFileURL(path.join(ROOT, 'lib', p)).href);
const { checkPlan, plannerInput, plannerSystem } = await lib('ask-planner.ts');
const { readAsked } = await lib('ask-read.ts');
const { intentOf } = await lib('ask-intents.ts');

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const llama = await startLlama(modelArgs(args));

// The request the app's shell sends (src-tauri/src/gemma.rs chat_body), JSON held.
async function prompt(system, user, maxTokens) {
  return (await llama.chat([{ role: 'system', content: system }, { role: 'user', content: user }], { maxTokens, json: true })) || null;
}

const setFile = arg('set') ?? 'questions.json';
const own = path.basename(setFile, '.json');
const set = JSON.parse(fs.readFileSync(path.resolve(HERE, setFile), 'utf8'));
const today = set.today;
const system = plannerSystem(today, []);
let lastQuestion = null;
const times = [];
const raws = {};
const plans = { asked: 0, json: 0, usable: 0 };

async function readTurn(question, prevQuery) {
  const prev = prevQuery && lastQuestion ? { question: lastQuestion, query: prevQuery } : null;
  lastQuestion = question;
  const intent = intentOf(question, set.contracts ?? [], today);
  if (intent) return { intent };
  const ctx = { question, today, own: [], payees: [], prev };
  const t = performance.now();
  const raw = await prompt(system, plannerInput(ctx), 200);
  times.push(performance.now() - t);
  raws[question] = raw;
  const planned = checkPlan(raw, ctx);
  plans.asked++;
  try { JSON.parse(raw); plans.json++; } catch { /* not JSON */ }
  if (planned) plans.usable++;
  if (planned && 'offTopic' in planned) return { offTopic: true };
  if (planned) return { query: planned.plan, by: 'plan' };
  return readAsked(question, prevQuery, { today, own: [], reading: null, contracts: set.contracts ?? [] });
}

const only = arg('only')?.split(',') ?? null;
const failures = args.includes('--failures');
const blind = own === 'blind';
const { rows, summary } = await runSet({
  readTurn, only, set,
  onTurn: (row) => { if (!blind && (!failures || !row.ok)) console.log(`${row.ok ? '✓' : '✗'} ${row.id}.${row.turn} ${row.q}${row.ok ? '' : `\n    ${row.misses.join('; ')}\n    gemma: ${raws[row.q]}`}`); },
});
const cost = await llama.stop();
const calls = spread(times);
console.log(`\n${blind ? report(summary).split('\n')[0] : report(summary)}\nplans: ${plans.json}/${plans.asked} valid JSON, ${plans.usable}/${plans.asked} usable (the rest fell back to the rules)\nmedian planner ${calls.median} ms, p90 ${calls.p90} ms\n${costLine(llama.label, cost, calls)}`);
const runner = args.includes('--model') ? llama.label : 'gemma';
fs.mkdirSync(path.join(HERE, 'results'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'results', own === 'questions' ? `${runner}-latest.json` : `${runner}-${own}-latest.json`), JSON.stringify({ summary, rows, raws, plans, cost, calls }, null, 1));
process.exit(0);
