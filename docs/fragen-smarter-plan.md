# Fragen: a plan to make it smarter (Girovo Next, 2026-11-11)

What the owner saw on the real app:

| Question | What Girovo did | Why |
|---|---|---|
| "Wo war ich im August Essen" | ranked **all** spending by payee: The Ridge EU, a person, Steam… | "Essen" is not in the rules' category words, and a ranking takes a category only from the rules (`lib/nano-ask.ts` readQuestion), so Gemma's "Essen & Trinken" was thrown away |
| "In welchen Restaurants war ich in August" | "Du hattest 2 Umsätze in August 2026." | "welche Restaurants" is no ranking to the rules without "am meisten"; "Restaurants" was taken as a name to search for; the writer then said a count, in poor German ("in August") |
| "Und wo?" before the fix | the same sum again | follow-ups are a regex merge, not understanding |

The root cause is one design choice: **the rules decide, Gemma only suggests**, and the rules are narrow regexes. Gemma 4 can read these questions; we throw its reading away.

## The plan, in order (each step measured before the next)

1. **A question set and a harness in the repo** (`scripts/eval-fragen/`, not the scratchpad): about 150 German and 30 English questions with the expected reading, every miss the owner hit, follow-ups as short conversations, places ("wo", "welche Restaurants", "bei wem"), lists, "wie oft", "wann zuletzt", averages, comparisons, balances, small talk, injections. Two runs: rules only (a node:test in CI) and rules + Gemma (a script that starts llama-server like `gemma-chain.mjs`). Today's score is the baseline.
2. **Gemma plans, the rules check** (the core change): Gemma answers a strict JSON schema (llama-server `json_schema`): kind, direction, category from the app's list, payee as written, period, ranking by place or category, plus the last two turns of the conversation for follow-ups. The rules no longer overrule; they only verify: a period must parse to real dates, a payee must exist among the loaded payees (`nameFromPayees`), a category must be one of the app's. A field that fails is dropped, never guessed. The regex `followUp` stays only as the fallback when Gemma is not there.
3. **Places and lists as real answers**: "wo / in welchen Restaurants / bei welchen Läden" lists every place in that category and period (not a top 5 of everything), with counts and sums; "zeig mir alle Zahlungen an X" lists bookings. A list answer gets a one-line sentence ("Im August warst du in 4 Restaurants, am häufigsten bei Pinos Pizza.").
4. **Words the rules still need** (for Android without Gemma and as the check): a vocabulary for everyday nouns (Essen, Restaurant, Lieferdienst, Tanken, Supermarkt, Kleidung, Handy, Strom…) mapped to categories, built from the question set, not by hand-guessing.
5. **A better writer**: few-shot examples of good answers in the prompt, the list's top names in the facts, German grammar checks the template already gets right ("im August"), one to two sentences, never a bare count when a list was asked. The number guard stays as it is.
6. **New answer kinds** the set will show are missing: "Wie viel Geld habe ich?" (balances), "Was kostet mich Netflix?" (a contract's price), "Wann kam das Gehalt?", "Wie viel bleibt bis Monatsende?" (the forecast).
7. **"Verstanden als" when unsure**: if Gemma and the checks disagree, the answer shows one quiet line of chips ("Essen & Trinken · August 2026 · nach Ort") the user can change, instead of a confident wrong answer.
8. **Android**: the same planner through Gemini Nano 4's structured output once AICore offers it on the owner's phone; until then the rules from step 4.

## What done looks like

The question set at 90 % or more with Gemma (rules only: 75 %), every miss above answered right, and each step in its own commit with its score in the message.

## Not changing

Girovo computes every figure; the number guard; changes to settings only after "Ja, bitte"; nothing leaves the computer.
