// Girovo AI question set, rules only: every question of questions.json read by
// lib/ask-read.ts readAsked with no model (reading and plan null), each
// conversation in order, the reading before a follow-up handed in as `prev`
// as the app does (components/insights/AskThread.tsx: the last turn read as a query).
//
//   node scripts/eval-fragen/run.mjs              every turn, ✓ or ✗ with its misses
//   node scripts/eval-fragen/run.mjs --failures   only the misses
//   node scripts/eval-fragen/run.mjs --only d007  one item (several: --only d007,e003)
//   node scripts/eval-fragen/run.mjs --baseline   also writes baseline.json from this run
//   node scripts/eval-fragen/run.mjs --set holdout.json   another set (relative to this folder)
//
// Writes scripts/eval-fragen/results/rules-latest.json (rules-<set>-latest.json for another set).
//
// A model-backed run reuses the set and the score through runSet:
//   import { runSet } from './run.mjs';
//   const { rows, summary } = await runSet({ readTurn: async (question, prevQuery, lang) => readResult });

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAsked } from '../../lib/ask-read.ts';
import { scoreTurn, summarize } from './score.mjs';

const here = new URL('./', import.meta.url);

/** The question set: { today, contracts?, items }. `file` is relative to this folder. */
export function loadSet(file = 'questions.json') {
  return JSON.parse(readFileSync(path.resolve(fileURLToPath(here), file), 'utf8'));
}

/** The rules-only reader: what the app reads with no model at all. `contracts`: the live contracts' names the set assumes. */
export function rulesReader(today, contracts = []) {
  return async (question, prevQuery) => readAsked(question, prevQuery, { today, own: [], reading: null, plan: null, contracts });
}

/**
 * Runs the set through `readTurn(question, prevQuery, lang)` (a ReadResult,
 * or a promise of one) and scores every turn. `prevQuery` is the query of the
 * last turn of the same conversation that was read as one, or null.
 * `only` limits the run to these item ids; `onTurn(row)` sees each row as it is scored.
 */
export async function runSet({ readTurn, only = null, onTurn = null, set = loadSet() } = {}) {
  const { today, items } = set;
  readTurn ??= rulesReader(today, set.contracts ?? []);
  const rows = [];
  for (const item of items) {
    if (only && !only.includes(item.id)) continue;
    let prev = null;
    for (const [turn, { q, expect }] of item.turns.entries()) {
      let result;
      let error = null;
      try {
        result = await readTurn(q, prev, item.lang);
      } catch (err) {
        result = null;
        error = String(err?.message ?? err);
      }
      const { ok, misses } = scoreTurn(result, expect, today);
      const row = { id: item.id, lang: item.lang, turn, q, expect, result, ok, misses: error ? [`error: ${error}`, ...misses] : misses };
      rows.push(row);
      onTurn?.(row);
      if (result && 'query' in result) prev = result.query;
    }
  }
  return { today, rows, summary: summarize(rows) };
}

const pct = (p, t) => (t ? `${Math.round((p / t) * 100)}%` : 'n/a');

/** The totals as lines of text. */
export function report(summary) {
  const lines = [];
  const table = (title, groups) => {
    lines.push(`${title}:`);
    for (const [k, v] of Object.entries(groups)) lines.push(`  ${k.padEnd(12)} ${String(v.passed).padStart(3)}/${String(v.total).padEnd(3)} ${pct(v.passed, v.total)}`);
  };
  lines.push(`Turns: ${summary.passed}/${summary.total} (${pct(summary.passed, summary.total)})   Items: ${summary.items.passed}/${summary.items.total}`);
  table('By kind', summary.byKind);
  table('By topic', summary.byTopic);
  table('By language', summary.byLang);
  table('By turn', summary.byTurn);
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const failures = args.includes('--failures');
  const at = args.indexOf('--only');
  const only = at >= 0 && args[at + 1] ? args[at + 1].split(',') : null;
  const setAt = args.indexOf('--set');
  const setFile = setAt >= 0 && args[setAt + 1] ? args[setAt + 1] : 'questions.json';
  const own = path.basename(setFile, '.json');
  const { today, rows, summary } = await runSet({
    only,
    set: loadSet(setFile),
    onTurn(row) {
      if (failures && row.ok) return;
      const label = `${row.id}${row.turn ? `.${row.turn + 1}` : ''}`;
      console.log(`${row.ok ? '✓' : '✗'} ${label.padEnd(7)} ${row.q}`);
      for (const m of row.misses) console.log(`          ${m}`);
    },
  });
  console.log('');
  console.log(report(summary));
  if (!only) {
    const dir = new URL('results/', here);
    mkdirSync(dir, { recursive: true });
    const file = new URL(own === 'questions' ? 'rules-latest.json' : `rules-${own}-latest.json`, dir);
    writeFileSync(file, `${JSON.stringify({ today, reader: 'rules', summary, rows }, null, 2)}\n`);
    console.log(`\nWrote ${fileURLToPath(file)}`);
    if (args.includes('--baseline') && own === 'questions') {
      const passing = rows.filter((r) => r.ok).map((r) => `${r.id}.${r.turn + 1}`);
      const byKind = Object.fromEntries(Object.entries(summary.byKind).map(([k, v]) => [k, `${v.passed}/${v.total}`]));
      const base = new URL('baseline.json', here);
      writeFileSync(base, `${JSON.stringify({ reader: 'rules', today, passed: summary.passed, total: summary.total, byKind, passing }, null, 2)}\n`);
      console.log(`Wrote ${fileURLToPath(base)}`);
    }
  }
}

// Run as a script, not when imported by a model-backed run or the test.
if (import.meta.main) await main();
