# Girovo AI: four other small models against Gemma 4 E2B (2026-11-14)

The owner asked whether Gemma 4 E2B is really the best model for Girovo AI on the desktop. Four models were downloaded, run through every Girovo AI eval, and deleted again: Qwen3.5 4B, Qwen3.5 2B, Ministral 3 3B and Phi-4-mini. Gemma 4 E4B was left out on purpose. Its result from 2026-11-12 stands: blind 89 % against 90 % for E2B, at twice the time.

## Setup

- PC: i9-13900K, 64 GB, RTX 4080 SUPER (16 GB), Vulkan.
- Runtime: the app's own llama.cpp b12250 (`gemma/llama-b12250`). It loaded all four models, including Qwen3.5's new hybrid architecture and Ministral 3's image part, so no newer llama.cpp was needed.
- The same server flags as the app (`--jinja -c 4096 -np 1 -ngl 99 --device Vulkan0`; vision `-c 8192`). The same request as the app: temperature 0, top_k 1, seed 0, `chat_template_kwargs.enable_thinking: false`, JSON held for the planner. Each model used the chat template in its own GGUF. Qwen3.5 thinks by default, and `enable_thinking: false` is the switch its model card documents. No answer contained a `<think>` block.
- The prompts were tuned on Gemma and were not changed for this round. Every other model starts with that handicap, mostly in the writer and the style runs.
- Scripts: every eval now takes `--model <gguf>` and `--server <llama-server>`, and vision also takes an mmproj. Without them they run E2B from the app folder as before (`scripts/eval-llama.mjs`).

| model | file | source | license (model card) |
|---|---|---|---|
| Gemma 4 E2B | gemma-4-E2B_q4_0-it.gguf, 3.35 GB | google/gemma-4-E2B-it-qat-q4_0-gguf | Apache 2.0 |
| Qwen3.5 4B | Qwen3.5-4B-Q4_K_M.gguf, 3.03 GB + mmproj BF16 0.68 GB | ggml-org/Qwen3.5-4B-GGUF (Qwen has no own GGUF) | Apache 2.0 |
| Qwen3.5 2B | Qwen3.5-2B-Q4_K_M.gguf, 1.28 GB + mmproj F16 0.67 GB | unsloth/Qwen3.5-2B-GGUF (no Qwen or ggml-org GGUF) | Apache 2.0 |
| Ministral 3 3B | Ministral-3-3B-Instruct-2512-Q4_K_M.gguf, 2.15 GB + mmproj BF16 0.84 GB | mistralai/Ministral-3-3B-Instruct-2512-GGUF (Mistral's own) | Apache 2.0 |
| Phi-4-mini 3.8B | Phi-4-mini-instruct-Q4_K_M.gguf, 2.49 GB, text only | unsloth/Phi-4-mini-instruct-GGUF (Microsoft has no own GGUF) | MIT |

All SHA-256 values matched the repos' LFS hashes. q4_0 builds exist too: Qwen3.5 4B 2.58 GB and 2B 1.21 GB (unsloth), Phi-4-mini 2.33 GB (bartowski). Mistral publishes none. unsloth's Qwen3.5 4B Q4_K_M is 2.74 GB; ggml-org's build is larger.

## Results

| | E2B | Qwen3.5 4B | Qwen3.5 2B | Ministral 3 3B | Phi-4-mini |
|---|---|---|---|---|---|
| planner, questions (342 turns) | 98 % | **99 %** | 97 % | 94 % | 96 % |
| planner, holdout (94) | **97 %** | **97 %** | 90 % | 91 % | 94 % |
| planner, blind (81) | 89 % | **90 %** | 88 % | 89 % | 85 % |
| plans valid JSON / usable | 100 / 97 % | 100 / 100 % | 100 / 100 % | 100 / 94 % | 100 / 99 % |
| writer, guard passes (30) | 27 | **29** | 26 | 20 | 26 |
| style: none / friendly short / friendly long | 27 / **28 / 28** | 27 / 25 / 24 | 22 / 26 / 26 | 19 / 22 / 15 | 26 / 26 / **28** |
| sentences, friendly long | 1.7 | 1.6 | 1.1 | 1.7 | 1.5 |
| categories, holdout (83) | 93 % | 94 % | 46 % | **95 %** | 72 % |
| persons given a category (of 10) | 3 | 2 | **1** | 3 | 2 |
| clean names, holdout brands (37) | 31 (84 %) | 33 (89 %) | **35 (95 %)** | 33 (89 %) | 17 (46 %) |
| brand names, checked (75) / false brands (37) | 59 / 17 | 58 / **6** | 48 / 1 | **64** / 18 | 40 / 5 |
| vision fields right (120) | see below | **119** | 108 | 107 | – |
| file size (model + image part) | 3.35 GB (+ ~1 GB) | 3.03 + 0.68 GB | 1.28 + 0.67 GB | 2.15 + 0.84 GB | 2.49 GB |
| GPU memory added / server RAM | 1.6–2.1 GB / 1.8 GB | 3.4 GB / 3.4–3.9 GB | 1.5 GB / 1.6–1.8 GB | 2.8 GB / 2.4 GB | 3.2 GB / 2.7 GB |
| with the image part (`-c 8192`) | – | 5.6 GB / 7.8 GB | 2.5 GB / 3.3 GB | 5.4 GB / 4.9 GB | – |
| load (warm file cache) | 2.6–3.0 s | 3.5–3.9 s | 2.4–2.8 s | 2.6–3.1 s | 2.8–3.4 s |

Categories CASES (105, the tuning set): E2B 98 %, Qwen3.5 4B 94 %, 2B 50 %, Ministral 93 %, Phi 66 %. Clean names, the tuning half: 32, 34, 33, 33 and 15 of 38.

The blind set has 81 turns, so one turn is 1.2 points. On blind, every model except Phi lies within two turns of E2B. Holdout is no longer blind: its misses were fixed in the rules, and the rules help every model the same way.

### Speed

A game (R.E.P.O.) started at 20:31, while the runs were going. The owner said to carry on, so these runs had the game open on the same GPU:

- **No game:** E2B, every suite. Qwen3.5 4B, questions and holdout.
- **Game open:** Qwen3.5 4B from blind on, plus vision. Everything for Qwen3.5 2B, Ministral 3 and Phi-4-mini. A second run of E2B and Qwen3.5 4B (questions and writer) at 21:00, so the two have a comparison under the same load.

Milliseconds per call, median / p90:

| | planner, no game | planner, game | writer, no game | writer, game | per booking (categories) |
|---|---|---|---|---|---|
| E2B | 317 / 483 | 728 / 1098 | 209 / 324 | 292 / 405 | 50 / 69 (no game) |
| Qwen3.5 4B | 396 / 474 | 724 / 854 | – | 506 / 785 | 212 / 250 (game) |
| Qwen3.5 2B | – | 442 / 538 | – | 320 / 528 | 129 / 151 (game) |
| Ministral 3 3B | – | 796 / 963 | – | 329 / 467 | 57 / 80 (game) |
| Phi-4-mini | – | 475 / 644 | – | 332 / 456 | 54 / 107 (game) |
| vision, per image | 2.4 s (2026-11-13) | | | | Qwen 4B 3.0 s, 2B 1.7 s, Ministral 1.8 s (game) |

The game made the timings noisy: E2B's planner went from 317 to 728 ms with the game open, while Qwen3.5 2B's was 442 ms during it. Measured without the game, Qwen3.5 4B plans about 25 % slower than E2B. Under the same load it writes about 1.7× slower. Both Qwen models are slow on the short booking prompts (4× Ministral and Phi, under the same game). That is most likely the hybrid architecture: llama.cpp cannot reuse a recurrent state for a shared prompt prefix, so every booking processes the whole category prompt again. This is a guess and was not checked.

GPU memory is the rise in `nvidia-smi` memory.used after the server starts. Server RAM is the peak working set of llama-server, which counts the mapped model file. With the game open, the GPU number is rougher.

### Vision (receipts and invoices, 24 invented images from make_set.py)

| field | E2B (2026-11-13) | Qwen3.5 4B | Qwen3.5 2B | Ministral 3 3B | Tesseract + rules |
|---|---|---|---|---|---|
| amount (24) | 24 | **24** | 17 | 23 | 24 |
| IBAN (12) | 6 | **12** | **12** | 10 | 10 |
| shop on a receipt (12) | 12 | **12** | 11 | 11 | 0 |
| receipt category (12) | 11 | 11 | 8 | 10 | – |
| date (24) | 14 | **24** | **24** | 17 | – |
| invoice number, items | – | 12, 12 | 12, 12 | 12, 12 | 12, – |

E2B's image part was not downloaded this round, since only the four models were approved. Its column comes from the run on 2026-11-13, on the same set (make_set.py draws the same images from seed 7). Qwen3.5 4B got 119 of 120 fields right, every IBAN and every date included. That is the first model here that would beat Tesseract on IBANs.

## Sample sentences

Writer, no style (`run-writer.mjs`), the same questions:

| question | E2B | Qwen3.5 4B | Qwen3.5 2B | Ministral 3 3B | Phi-4-mini |
|---|---|---|---|---|---|
| Wie oft war ich bei Rewe? | Du warst 6-mal bei Rewe, das macht zusammen 345,90 €. | Du warst insgesamt 6-mal bei Rewe. | Du hast bei Rewe 6-mal eingebracht und insgesamt 345,90 € ausgegeben. | Bei Rewe hast du 6-mal ausgegeben. | Du bist bei Rewe 6-mal gewesen, insgesamt 345,90 €. |
| Wofür geb ich am meisten aus? | Du gibst am meisten für Wohnen & Energie aus, mit 3.560,00 €. | Du gibst am meisten für Wohnen & Energie aus, insgesamt 3.560,00 €. | Am meisten hast du für Wohnen & Energie ausgegeben, 3.560,00 €. | Am meisten gibst du für \*\*Wohnen & Energie\*\* mit \*\*3.560,00 €\*\* aus. | Am meisten ausgebend ist Wohnen & Energie mit 3.560,00 €. |
| Größte Ausgabe dieses Jahr | Dieses Jahr waren deine größten Ausgaben 890,00 € bei Hausverwaltung Meier am 3. August 2026. | Deine größte Ausgabe dieses Jahr waren 890,00 € bei Hausverwaltung Meier am 3. August. Da die Umsätze erst ab dem 1. August geladen wurden, könnte der Betrag höher sein. | Deine größte Ausgabe dieses Jahr war 890,00 € bei Hausverwaltung Meier am 3. August 2026. | 890,00 € gingst du an Hausverwaltung Meier. (refused) | Deine größte Ausgabe dieses Jahr waren 890,00 € bei Hausverwaltung Meier am 3. August 2026. |
| Wo kaufe ich am häufigsten ein? | Du kaufst am häufigsten bei Rewe, mit 6-mal 345,90 €. | Du kaufst am häufigsten bei Rewe, wo du insgesamt 6-mal einkaufst und 345,90 € ausgeben hast. | Am häufigsten kaufst du bei Rewe, 345,90 €. | Du kaufst am häufigsten bei Rewe ein. | Am häufigsten kaufst du bei der Arbeitgeber GmbH, 4-mal, jeweils 11.400,00 €. (passed, wrong) |

Friendly, long, addressed by name (`run-writer-style.mjs`):

- E2B: "Nino, dieses Jahr kam von Lea Schmidt mindestens 150,00 € von ihr. Das ist ein einziger Eintrag."
- Qwen3.5 4B: "Nino, dieses Jahr hast du von Lea Schmidt mindestens 150,00 € bekommen. Da die Umsätze erst ab dem 1. August 2026 geladen sind, könnte der tatsächliche Betrag noch höher sein."
- Qwen3.5 2B: "Nino, du hast dieses Jahr von Lea Schmidt mindestens 150,00 € bekommen." (says the long length in one sentence)
- Ministral 3 3B: "Nino, von Lea Schmidt hast du mindestens \*\*150,00 €\*\* erhalten. Da die Umsätze erst ab August geladen sind, könnte es mehr gewesen sein."
- Phi-4-mini: "Nino, von Lea Schmidt bist du dieses Jahr mindestens 150,00 € bekommen. Es gab 1 Umsatz. Es kann mehr gewesen sein, …"

## Observations

- **German.** Qwen3.5 4B writes the best German of the five: full, natural sentences, and it explains the "mindestens" (bookings loaded only from August) without being asked. E2B is short, correct and sometimes clumsy ("kam von Lea Schmidt mindestens 150,00 € von ihr"). Qwen3.5 2B makes word errors ("6-mal eingebracht", "Im letzten 7. Tag"). Phi-4-mini makes grammar errors ("bist du … bekommen", "Am meisten ausgebend") and answered a plain "Sag hallo" in Danish. Ministral 3 writes fragments ("12,99 € pro Monat für Netflix.") and puts Markdown bold in many answers. The guard does not catch `**`, so the app would show the asterisks.
- **Instruction following.** E2B keeps the style rules best: 28/30 in both friendly runs, with the name first. Qwen3.5 4B loses three or four more sentences to the guard in the style runs, mostly because it reads a wrong figure as the per-month average ("1.459,05 € für Spotify pro Monat"). E2B makes the same mistake on Netflix and Spotify. Qwen3.5 2B ignores "ausführlich" (1.1 sentences). Ministral breaks the most rules. A guard pass does not mean a true sentence: "Lea hat dir insgesamt 11.550,00 € geschickt" passes for both Qwen models and Phi in the style run, because the rules read that question as all income. E2B said "von 5 verschiedenen Eingängen" instead. Phi's "Am häufigsten kaufst du bei der Arbeitgeber GmbH" passed the guard too.
- **JSON.** Every model returned valid JSON for every plan, held by `response_format`. Ministral's plans were unusable most often (14 of 245 failed `checkPlan` and went to the rules), and E2B's 8 of 245. Both Qwen models sent no unusable plan at all.
- **Booking jobs.** Qwen3.5 2B answers "NONE" for clear bookings (Backhaus Müller, APCOA Parking, Taxi-Zentrale): 47 of 105 left as Sonstiges. Phi-4-mini guesses wrong a lot (26 wrong). Ministral and Qwen3.5 4B are level with E2B on categories. Qwen3.5 4B gives far fewer brands to names without one (6 of 37, against 17 for E2B and 18 for Ministral).
- **Speed and memory.** Qwen3.5 4B needs about twice E2B's GPU memory and RAM. It plans about 25 % slower and writes 1.7× slower, and it is about 4× slower per booking. Qwen3.5 2B is as light as E2B. Ministral and Phi take 2.4 to 3.5 GB.

## Recommendation

**Keep Gemma 4 E2B.** No model reads the questions measurably better. On blind, Qwen3.5 4B is one turn ahead, and Qwen3.5 2B, Ministral and Phi are level or behind. E2B also keeps the style rules best and is the fastest and lightest of the good models. A split does not pay off either. Qwen3.5 4B would write a little better German, but two models would need about 5 GB together, or a 3 s reload whenever the job changes, for writing that scores only two sentences better.

Qwen3.5 4B is worth a second look in two cases:

1. **If Girovo ever reads receipt or invoice photos with a model.** Qwen3.5 4B got 119 of 120 fields. E2B misses half the IBANs and gets the year wrong on ten dates. That would be a separate model loaded only for a photo, since the image part needs 5.6 GB GPU and 7.8 GB RAM in all. Qwen3.5 2B gets the IBANs and dates as well, at a third of the memory, but misses 7 of 24 amounts.
2. **If the writer becomes the weak spot in Girovo 7.** Re-test Qwen3.5 4B with the writer and style prompts tuned for it. This round did not re-tune anything.

What switching the main model to Qwen3.5 4B would cost:

- **Download:** 3.03 GB instead of 3.35 GB, which is slightly smaller. With the image part, 3.7 GB.
- **Runtime:** none. b12250 runs it as shipped. `gemma.rs` would change `MODEL_URL`, `MODEL_FILE` and `MODEL_SHA256` and keep its folder name.
- **Hardware:** about 3.4 GB of GPU memory instead of 1.6–2.1 GB, so cards with 4 GB get tight. CPU-only PCs would be slower too (not measured here; E2B CPU numbers are in `girovo-llm-eval/README.md`).
- **Prompts:** the style prompts would need re-tuning (25 and 24 of 30 against E2B's 28 and 28), and the blind set would need a fresh read through the new model.
- **Licence:** Apache 2.0, the same as Gemma 4. Ministral is Apache 2.0 and Phi-4-mini MIT, so no candidate brings licence trouble.

## Running it again

```
node scripts/eval-fragen/run-gemma.mjs --model <gguf> [--set holdout.json | --set blind.json]
node scripts/eval-fragen/run-writer.mjs --model <gguf>
node scripts/eval-fragen/run-writer-style.mjs --model <gguf>
node scripts/eval-gemma-bookings.mjs --model <gguf>
node scripts/eval-gemma-bookings.mjs --model <gguf> --only clean --holdout
python scripts/eval-gemma-vision/make_set.py <folder>
node scripts/eval-gemma-vision/bench.mjs <folder> <mmproj> --model <gguf>
```

Each run ends with one line of cost: load time, GPU memory added, server RAM, and per call the median and p90. With `--set blind.json`, the planner prints only the score.

The model files were deleted after this round. `C:\Users\ninob\girovo-llm-eval\models\` is empty, and the app's Gemma folder was not touched.
