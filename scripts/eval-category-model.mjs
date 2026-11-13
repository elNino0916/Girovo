// Calibrates and checks the on-device category guess (lib/category-model.ts)
// against a labelled set of German outgoing bookings — names as statements
// carry them, none of them anyone's real data:
//
//   node scripts/eval-category-model.mjs                    the current thresholds
//   node scripts/eval-category-model.mjs --sweep            search for better ones
//   node scripts/eval-category-model.mjs --sweep --strict   …that make no mistake at all
//
// Two sets. CASES is the one to tune on: thresholds, prototype wording. HOLDOUT
// is only ever measured — never word a prototype after one of its misses, or
// it stops telling how the model does on names nobody has looked at. It is
// what decides between two models.
//
// `expect: null` marks a booking no category should be guessed for: a
// private person, a name that says nothing. A wrong category counts worse
// than none — that is the whole point of the thresholds.

import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const m = await import(pathToFileURL(path.join(ROOT, 'lib', 'category-model.ts')).href);

import { CASES, HOLDOUT } from './category-sets.mjs';

const t = m.modelThresholds();
const started = Date.now();
const scores = await m.scoreTexts(CASES.map(([name, purpose]) => m.bookingText(name, purpose)));
const heldScores = await m.scoreTexts(HOLDOUT.map(([name, purpose]) => m.bookingText(name, purpose)));
console.log(`${CASES.length + HOLDOUT.length} bookings scored in ${Date.now() - started} ms (model load included)`);

function evaluate(th, verbose = false, set = CASES, setScores = scores) {
  let right = 0, wrong = 0, none = 0, falseGuess = 0, nulls = 0;
  const wrongs = [];
  set.forEach(([name, purpose, expect], i) => {
    const got = m.pickCategory(setScores[i], null, th);
    if (expect === null) {
      nulls++;
      if (got) { falseGuess++; wrongs.push(`  ✗ "${name}${purpose ? ` – ${purpose}` : ''}" → ${got} (should stay Sonstiges)`); }
      return;
    }
    if (got === expect) right++;
    else if (got === null) none++;
    else { wrong++; wrongs.push(`  ✗ "${name}${purpose ? ` – ${purpose}` : ''}" → ${got} (is ${expect})`); }
  });
  const labelled = set.length - nulls;
  const guessed = right + wrong + falseGuess;
  const r = { th, right, wrong, none, falseGuess, coverage: right / labelled, precision: guessed ? right / guessed : 1 };
  if (verbose) {
    console.log(`thresholds ${JSON.stringify(th)}`);
    console.log(`right ${right}/${labelled} (${(100 * r.coverage).toFixed(0)} %) · wrong ${wrong} · left as Sonstiges ${none} · persons given a category ${falseGuess}/${nulls}`);
    console.log(`precision of what it guesses: ${(100 * r.precision).toFixed(1)} %`);
    for (const w of wrongs) console.log(w);
  }
  return r;
}

if (process.argv.includes('--sweep')) {
  const results = [];
  for (let s = 0.75; s <= 0.95; s += 0.0025) for (let g = 0; g <= 0.04; g += 0.002) {
    results.push(evaluate({ ...t, minScore: +s.toFixed(4), minMargin: +g.toFixed(3) }));
  }
  // Best coverage among settings that guess wrong at most 1 time in 20 —
  // or, with --strict, never at all.
  const strict = process.argv.includes('--strict');
  const ok = results
    .filter((r) => (strict ? r.wrong === 0 && r.falseGuess === 0 : r.precision >= 0.95))
    .sort((a, b) => b.coverage - a.coverage || b.th.minScore - a.th.minScore || b.th.minMargin - a.th.minMargin);
  console.log(strict ? 'best with no mistakes:' : 'best at ≥95 % precision:');
  for (const r of ok.slice(0, 5)) console.log(`  minScore ${r.th.minScore} minMargin ${r.th.minMargin} → right ${r.right}, wrong ${r.wrong}, persons ${r.falseGuess}, coverage ${(100 * r.coverage).toFixed(0)} %`);
  if (ok[0]) {
    evaluate(ok[0].th, true);
    console.log('\nheld out, at these thresholds:');
    evaluate(ok[0].th, true, HOLDOUT, heldScores);
  }
} else {
  evaluate(t, true);
  console.log('\nheld out:');
  evaluate(t, true, HOLDOUT, heldScores);
}
await m.releaseModel();
