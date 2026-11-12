// The question set, rules only (scripts/eval-fragen/run.mjs): fails when fewer
// turns are read right than baseline.json records. After a change that reads
// more right, raise the baseline: node scripts/eval-fragen/run.mjs --baseline
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runSet } from './run.mjs';

test('the rules read at least as many questions right as the baseline', async () => {
  const baseline = JSON.parse(readFileSync(new URL('./baseline.json', import.meta.url), 'utf8'));
  const { rows, summary } = await runSet({});
  const lost = rows
    .filter((r) => !r.ok && baseline.passing.includes(`${r.id}.${r.turn + 1}`))
    .map((r) => `${r.id}.${r.turn + 1} "${r.q}": ${r.misses.join('; ')}`);
  assert.ok(
    summary.passed >= baseline.passed,
    `${summary.passed}/${summary.total} read right, the baseline is ${baseline.passed}. No longer right:\n${lost.join('\n')}`,
  );
});
