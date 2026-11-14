// Gemma 4 E2B with its image part (gemma-4-E2B-it-mmproj.gguf from Hugging Face, ~1 GB, not shipped)
// against Tesseract + lib/invoice-text.ts, the desktop's way to read an invoice photo today, on
// invented invoices and receipts drawn by make_set.py. Measured 2026-11-13 (24 images, GPU free):
// amounts 24/24 both; IBAN Gemma 6/12 (digits dropped, every one fails the checksum) vs 10/12;
// a receipt's shop Gemma 12/12 vs 0/12, its category 11/12; dates Gemma 14/24 (wrong year);
// 2.4 s per image vs 0.9 s.
//
//   python scripts/eval-gemma-vision/make_set.py <folder>
//   node scripts/eval-gemma-vision/bench.mjs <folder> <mmproj file> [--model <file.gguf>] [--server <llama-server>]
//
// --model with its own mmproj compares another image-capable model.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { costLine, modelArgs, spread, startLlama } from '../eval-llama.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { readInvoiceText } = await import(pathToFileURL(path.join(ROOT, 'lib', 'invoice-text.ts')).href);
const [setDir, mmproj] = process.argv.slice(2);
const truth = JSON.parse(fs.readFileSync(path.join(setDir, 'truth.json'), 'utf8'));

// --- Gemma
const llama = await startLlama({ ...modelArgs(process.argv.slice(2)), mmproj, ctx: 8192 });

const SYSTEM = 'Du liest das Foto einer Rechnung oder eines Kassenbons und antwortest nur mit einem JSON-Objekt. '
  + 'Felder: "art": "rechnung" oder "kassenbon"; "name": der Aussteller (Firma oder Laden, nicht der Kunde); "betrag": der zu zahlende Gesamtbetrag als Zahl (nicht netto, nicht MwSt.); '
  + '"datum": YYYY-MM-DD; "iban": die IBAN zum Bezahlen ohne Leerzeichen oder null; "nummer": die Rechnungsnummer oder null; '
  + '"kategorie": eine von groceries, dining, shopping, mobility, health, leisure, housing, media, insurance, taxes, other; "positionen": Anzahl der Artikelzeilen. Erfinde nichts.';
async function gemma(file) {
  const b64 = fs.readFileSync(path.join(setDir, file)).toString('base64');
  const t = performance.now();
  const r = await fetch(`${llama.base}/v1/chat/completions`, { method: 'POST', headers: llama.headers, body: JSON.stringify({
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } }, { type: 'text', text: 'Lies dieses Dokument.' }] }],
    temperature: 0, top_k: 1, seed: 0, max_tokens: 300, chat_template_kwargs: { enable_thinking: false }, response_format: { type: 'json_object' },
  }) });
  const j = await r.json();
  const text = String(j.choices?.[0]?.message?.content ?? '');
  let o = null; try { o = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? 'null'); } catch {}
  return { o, ms: performance.now() - t, text };
}

// --- Tesseract + the app's invoice rules
const { createWorker } = await import('tesseract.js');
const worker = await createWorker(['deu', 'eng'], 1, { langPath: path.join(ROOT, 'public', 'ocr'), gzip: true, cachePath: path.join(setDir, '.tess') });
async function tess(file) {
  const t = performance.now();
  const { data } = await worker.recognize(path.join(setDir, file));
  return { r: readInvoiceText(data.text), ms: performance.now() - t, text: data.text };
}

const norm = (s) => String(s ?? '').toLocaleLowerCase('de').normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]/g, '');
const nameOk = (got, want) => { const g = norm(got), w = norm(want); return !!g && (g === w || w.includes(g) && g.length >= 4 || g.includes(w)); };
const amt = (x) => (typeof x === 'number' ? x : x == null ? null : Number(String(x).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')));
const score = { gemma: {}, tess: {} };
const add = (who, field, ok) => { const s = (score[who][field] ??= [0, 0]); s[1]++; if (ok) s[0]++; };
const times = { gemma: [], tess: [] };
for (const t of truth) {
  const g = await gemma(t.file);
  const s = await tess(t.file);
  times.gemma.push(g.ms); times.tess.push(s.ms);
  const o = g.o ?? {};
  const kind = t.type;
  add('gemma', `${kind}:name`, nameOk(o.name, t.name));
  add('gemma', `${kind}:amount`, Math.abs((amt(o.betrag) ?? -1) - t.amount) < 0.005);
  add('tess', `${kind}:name`, nameOk(s.r.name, t.name));
  add('tess', `${kind}:amount`, s.r.amount != null && Math.abs(s.r.amount - t.amount) < 0.005);
  add('gemma', `${kind}:date`, o.datum === t.date);
  if (kind === 'invoice') {
    add('gemma', 'invoice:iban', String(o.iban ?? '').replace(/\s/g, '').toUpperCase() === t.iban);
    add('tess', 'invoice:iban', s.r.iban === t.iban);
    add('gemma', 'invoice:number', norm(o.nummer) === norm(t.number));
    add('tess', 'invoice:number', norm(s.r.purpose).includes(norm(t.number)));
  } else {
    add('gemma', 'receipt:category', o.kategorie === t.category);
    add('gemma', 'receipt:items', Number(o.positionen) === t.items);
  }
  console.log(`${t.file}: gemma ${JSON.stringify(o)} (${Math.round(g.ms)} ms) | tesseract ${JSON.stringify({ name: s.r.name, amount: s.r.amount, iban: s.r.iban, purpose: s.r.purpose })} (${Math.round(s.ms)} ms)`);
}
const med = (xs) => Math.round([...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]);
console.log(`\nfield                 ${llama.label.slice(0, 14).padEnd(14)} Tesseract + rules`);
for (const f of [...new Set([...Object.keys(score.gemma), ...Object.keys(score.tess)])].sort()) {
  const g = score.gemma[f], s = score.tess[f];
  console.log(`${f.padEnd(20)}  ${g ? `${g[0]}/${g[1]}` : '-'}`.padEnd(37) + (s ? `${s[0]}/${s[1]}` : '-'));
}
console.log(`median per image: Gemma ${med(times.gemma)} ms, Tesseract ${med(times.tess)} ms`);
await worker.terminate();
console.log(costLine(llama.label, await llama.stop(), spread(times.gemma)));
process.exit(0);
