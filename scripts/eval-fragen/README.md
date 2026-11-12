# Girovo AI question set

About 190 questions people type into Girovo AI (160 German, 30 English), each with the reading it should get. Some are short conversations with follow-ups. The score compares what `lib/ask-read.ts` `readAsked` returns with that reading, field by field. The answer itself is not scored: Girovo computes it from the reading, so a right reading means a right answer.

## Run it

```
node scripts/eval-fragen/run.mjs              # every turn, ✓ or ✗ with what was wrong
node scripts/eval-fragen/run.mjs --failures   # only the misses
node scripts/eval-fragen/run.mjs --only d007  # one item, or several: d007,e003
node scripts/eval-fragen/run.mjs --baseline   # also writes baseline.json from this run
```

This run uses the rules only, with no model. It prints totals by kind of answer, by topic, by language and for first turns against follow-ups, and writes `results/rules-latest.json`.

`rules.test.mjs` runs with `npm test` and fails when fewer turns pass than `baseline.json` records. It also names the turns that passed before and fail now. When a change makes more pass, run with `--baseline` and commit the new file.

## Three sets

- `questions.json`: the set the rules are tuned on. `baseline.json` and `rules.test.mjs` belong to it.
- `holdout.json`: about 70 items written later, without looking at the rules. Its misses were then looked at and fixed, so it is no longer blind.
- `blind.json`: about 65 items in other voices (polite full sentences, slang, dictation, dialect). Nobody tuning the rules has read its misses. Keep it that way: score it, don't fix it item by item.

`--set holdout.json` runs another set, with either runner; its results go to `results/<runner>-<set>-latest.json`.

## With Gemma

```
node scripts/eval-fragen/run-gemma.mjs [--set blind.json] [--failures] [--dir <gemma folder>]
node scripts/eval-fragen/run-writer.mjs <gemma folder>
```

`run-gemma.mjs` starts llama-server from the app's Gemma folder (or `--dir`) and plans every turn as the desktop app does (`lib/ask-planner.ts`). `run-writer.mjs` prints the sentences Gemma writes for ten questions over invented bookings, with the guard's verdict, to compare models by eye.

Scores on 2026-11-12, turns right:

| set | rules alone | Gemma 4 E2B | Gemma 4 E4B |
|---|---|---|---|
| questions | 79% | 98% | 99% |
| holdout, first run | 55% | 72% | 74% |
| blind | 79% | 90% | 89% |

E4B planned in about 710 ms against 380 ms for E2B and is a 5.2 GB download against 3.3 GB. It writes longer sentences that keep more of the facts. On reading the question it was no better, so the app stays on E2B.

## Your own model run

`run.mjs` exports `runSet({ readTurn })`. `readTurn(question, prevQuery, lang)` returns a ReadResult (or a promise of one), the same shape `readAsked` returns. `prevQuery` is the query of the conversation's last turn that was read as one, as the app hands it on. A Gemma run would ask its plan, then call `readAsked(question, prevQuery, { today, own: [], reading, plan })`. `runSet` returns `{ rows, summary }`, and `report(summary)` prints the same totals.

## Add a question

Add an item to `questions.json`. Give it the next free id (`d…` German, `e…` English) and the `lang`. Every turn has `q`, what the user types, and `expect`, the reading a good product gives. Write it the way people really type: lowercase, no question mark, typos. An optional `note` says why the item is there.

`expect` lists only what matters for that question:

| field | meaning |
|---|---|
| `kind` | sum, count, average, largest, last, rank, compare, list (the bookings themselves: "Zeig alle Zahlungen an Amazon") |
| `dir` | out, in, all |
| `category` | a category id (`dining` is Essen & Trinken, `groceries` the supermarket), or null for none |
| `search` | a lowercase piece the reading's name must contain (`"rewe"`), or null for no name |
| `period`, `against` | an AskPeriod, compared by the days it spans on the set's `today` (2026-11-12), so `lastMonth` equals `{ "kind": "month", "month": "2026-10" }` |
| `rankBy`, `rankMetric` | for a ranking: category or payee, sum or count |
| `intent` | contracts, read, set, refresh, with `setting` and `value` where they matter; or one of the app's figures (`lib/ask-facts.ts`): balance, monthEnd, contractCost, priceRises, salary, owed, goal, with `name` (a lowercase piece of the contract, person or goal, or null) where it matters |
| `offTopic` | true for small talk, nonsense and orders Girovo cannot carry out |

Any field may be a list of values that are all right (`"kind": ["sum", "average"]`). `anyOf` holds whole readings of which any one is right.

Leave out what does not matter. For a question with no period, leave `period` out unless "all time" is the point. For a question about a payee, leave `category` out: the name decides.
