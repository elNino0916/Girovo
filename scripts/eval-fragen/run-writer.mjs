// The writer's sentences over invented bookings: ten questions planned and
// answered as the desktop app does, each sentence with the guard's verdict
// (lib/gemma-writer.ts usable) and how long Gemma took. For comparing models
// by eye; nothing is scored. The folder holds llama-b12250 and the model as
// gemma-4-E2B_q4_0-it.gguf, as the app's own Gemma folder does (the default).
//
//   node scripts/eval-fragen/run-writer.mjs [<gemma folder>] [--model <file.gguf>] [--server <llama-server>]
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { costLine, modelArgs, spread, startLlama } from '../eval-llama.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lib = (p) => import(pathToFileURL(path.join(ROOT, 'lib', p)).href);
const { computeAnswer } = await lib('nano-ask.ts');
const { readAsked } = await lib('ask-read.ts');
const { checkPlan, plannerInput, plannerSystem } = await lib('ask-planner.ts');
const { writerInput, writerSystem, usable } = await lib('gemma-writer.ts');

const args = process.argv.slice(2);
const llama = await startLlama(modelArgs(args, args[0] && !args[0].startsWith('--') ? args[0] : null));
const times = { plan: [], write: [] };
async function prompt(system, user, json = false) {
  const t = performance.now();
  const text = await llama.chat([{ role: 'system', content: system }, { role: 'user', content: user }], { maxTokens: 160, json });
  times[json ? 'plan' : 'write'].push(performance.now() - t);
  return text;
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
  'Was kam dieses Jahr von Lea Schmidt?',
  'Wie viel Gehalt habe ich im Oktober bekommen?',
  'Was kostet mich Spotify im Monat?',
  'Wie viel geb ich im Schnitt für Essen gehen aus?',
  'Wie oft hab ich bei Lieferando bestellt?',
  'Wo kaufe ich am häufigsten ein?',
  'Ein- und Ausgaben im Oktober',
  'Wie viel ging an Ikea?',
  'Ausgaben im März',
  'Wie viel hab ich seit Juli bei Amazon ausgegeben?',
  'Größter Eingang im September',
  'Zeig alle Zahlungen an Amazon',
  'Wie viel hab ich letzte Woche ausgegeben?',
  'Mehr für Lebensmittel als letzten Monat?',
  'What did I spend on groceries in October?',
  'How often did I go to Rewe?',
  'Where did I eat out in October?',
  'Biggest expense this year',
  'How much did Lea send me?',
  'Tanken im Oktober',
];
const stats = [];
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
  const ok = usable(text, input);
  const ms = Math.round(performance.now() - t);
  stats.push({ ok, ms, words: text.split(/\s+/).filter(Boolean).length });
  console.log(`\n${q}\n  ${ok ? 'OK ' : 'BAD'} ${ms} ms  ${text.replace(/\s+/g, ' ')}`);
}
const okCount = stats.filter((x) => x.ok).length;
const sorted = stats.map((x) => x.ms).sort((a, b) => a - b);
console.log(`\nUsable: ${okCount}/${stats.length}   median ${sorted[Math.floor(sorted.length / 2)] ?? 0} ms   ${(stats.reduce((n, x) => n + x.words, 0) / (stats.length || 1)).toFixed(1)} words on average`);
const cost = await llama.stop();
console.log(costLine(`${llama.label} writer`, cost, spread(times.write)));
console.log(`planner per call: median ${spread(times.plan).median} ms, p90 ${spread(times.plan).p90} ms`);
process.exit(0);
