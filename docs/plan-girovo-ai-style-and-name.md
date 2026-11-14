# Girovo AI: tone, length and your first name

Plan from 2026-11-14 for the next session: mockups first, then the build. Branch `girovo-next`.

## What it is

Three new choices on the Girovo AI page, in the "Antworten" group, with a live example below them:

| Setting | Choices | Default (proposal) |
|---|---|---|
| **Ton** | Sachlich · Freundlich | Sachlich |
| **Länge** | Kurz · Ausführlich | Kurz |
| **Anrede** | "Mit Vornamen ansprechen" (switch) and the name itself | On when Girovo finds a first name, else off |

- **Ton** only changes the wording. Figures stay the app's own, and the number checks stay as they are.
- **Länge** changes what goes into an answer, not just how long the sentences are. Kurz is one sentence, figure first. Ausführlich adds what the app has worked out anyway: the comparison with last month, the three biggest items, a tip if there is one.
- **Anrede**: Girovo AI calls you by your first name, but sparingly (see "When the name shows").
- **Live example**: a sample answer that changes as you tap, built from your own bookings like the questions in "Girovo AI ist bereit" (`lib/ai-welcome.ts` topPayee).
- **Settled already**: fixed choices instead of sliders; no third tone ("Locker"); "Freundlich" still follows the voice rules: short, plain, "du", no emojis, no exclamation marks, no dashes.

### Examples (draft, run them through the humanizer)

- Sachlich, Kurz: "Im Oktober gingen 312,40 € an Rewe."
- Freundlich, Kurz: "Im Oktober hast du 312,40 € bei Rewe gelassen."
- Sachlich, Ausführlich: "Im Oktober gingen 312,40 € an Rewe, 28,10 € weniger als im September. Der größte Einkauf waren 64,90 € am 12. Oktober."
- Freundlich, Ausführlich, with name: "Nino, im Oktober hast du 312,40 € bei Rewe gelassen, etwas weniger als im September. Am meisten war es am 12. Oktober mit 64,90 €."

## Where the first name comes from

- **Suggestion from the bank**: `firstName(sessionHolder(accounts))` in `components/shell/session.ts` already exists. It drops titles (Herr, Dr.), handles "BORNEMANN, NINO" and returns nothing for company accounts ("Mustermann GmbH").
- **The user's own name**: a text field prefilled with that suggestion. What's typed there wins, for example a nickname. Leave it empty to use the bank's suggestion again.
- **Nothing found** (company account, empty holder): the switch stays off and the field is empty. It can still be turned on with a typed name.
- **Privacy**: the name is kept in the vault and synced like the other Girovo AI settings. It is only ever given to the model on the device (Gemma on the desktop, Nano on the phone), which fits the new line "Deine Fragen und Umsätze verlassen nie dein Gerät." Later, Girovo API (MCP) must never hand the name out.

## When the name shows

Not in every answer, which gets annoying fast. Proposal:

- the empty conversation: "Hallo Nino, was möchtest du wissen?"
- the first answer of a conversation, at its start, at most
- small talk answers ("Hallo", "Danke")
- "Girovo AI ist bereit": "Nino, Girovo AI ist bereit" or a line under the title (mockup decides)
- later, the notes on the Übersicht

Never inside a sentence about money, never twice in one answer, never when the name also appears in the facts as a payee (user "Lea", payee "Lea Schmidt").

## Step 1: mockups

Folder `.impeccable/mocks/decision/ai-style/`, desktop and phone, dark and light, the real tokens (as in `ai-brand/`).

1. **The settings page**, three layouts to choose from:
   - A: three rows in "Antworten" (Ton and Länge as segmented buttons, Anrede as a switch with the name below), the live example as a card under them
   - B: one row "Antwortstil" that opens a small sub-page with the choices and a large example
   - C: the example card on top with the choices as chips inside it
2. **Where the name shows**: the empty conversation, a first answer, "Girovo AI ist bereit", an answer without the name for comparison.
3. **The four combinations of Ton and Länge** for one real question, side by side, so it's clear how much they differ.

Owner decides: the layout, the defaults, how often the name shows, how "Girovo AI ist bereit" uses it.

## Step 2: build

1. **Vault fields**: `askTone: 'plain' | 'friendly'`, `askLength: 'short' | 'long'`, `askName?: string`, `askUseName?: boolean`. Leave a field out while it's at its default. They go through every place a vault field passes or it gets lost: `components/provider/model.ts` (normalizeVault), `lib/vault.ts` (sanitizeVault, mergeVaults), `lib/sync-entries.ts`. Add tests for the round trip.
2. **`lib/ask-style.ts`** (pure, with tests): the style with defaults filled in. Name resolution is the typed name, else the bank's first name, else none, and only if the switch is on. Also "may the name show here" (conversation start, small talk, not when a payee in the facts has the same word).
3. **Länge in the content**: the code that computes answers (`lib/ask-facts.ts` and related) takes `detail: 'short' | 'long'`. Short drops the extras, long keeps comparison, top three and tip. The facts the writer sees follow from that.
4. **Writer** (`lib/gemma-writer.ts`): `writerSystem(lang, style)` adds one tone line and one length line to WRITER_DE and WRITER_EN, plus an example per tone. `writerInput` carries the name and whether the name may show. Guards: `unbacked()` lets the name through as an allowed word; `usable()` rejects the name in the wrong place or twice, and rejects an answer longer than the length allows.
5. **Fallback sentences** (`lib/i18n/messages/ask.ts`): a plain and a friendly version where the wording differs, and the name prefix only where it may show.
6. **Android**: Gemini Nano's prompt (`lib/nano-ask.ts`) gets the same tone, length and name rules.
7. **Settings UI** (`components/settings/AskSettings.tsx`): SegmentedItem for Ton and Länge (`components/settings/rows.tsx`); SwitchItem plus a text field (`components/ui/form.tsx`) for the name; the live example component.
8. **Name in the conversation**: the empty state and first answer in `components/insights/AskThread.tsx`, "Girovo AI ist bereit" in `components/insights/ai/AiReady.tsx`.
9. **Search**: new targets `askTone`, `askLength`, `askName` in `components/settings/finds.tsx`, `PAGE_OF` in `lib/settings-pages.ts`, search words in `lib/i18n/messages/shell.ts`.
10. **Texts**: German first, then English; run the humanizer; keep the voice rules.
11. **Eval**: `scripts/eval-fragen/run-writer.mjs` for all four combinations, plus name cases (the name at the start, a payee with the same name, a company account). Goal: the share of answers passing the guards stays at today's level for every combination.
12. **Checks**: tsc, `npm test`, `scripts/i18n-check.mjs`, a headless screenshot of the page and a conversation (the `shot.mjs` approach over CDP). Commit, then ask before pushing.

## Risks

- **The small model ignores the tone**: if E2B can't keep "Freundlich" apart reliably, the tone moves into the fallback sentences and the writer gets fixed openings.
- **Name in the wrong place**: the guard in step 4 checks this; the eval cases in step 11 prove it.
- **Joint accounts**: "Max und Erika Mustermann" suggests Max. The text field fixes it if Erika is the one using Girovo.
- **Screen sharing**: "Beträge ausblenden" hides amounts, not the name. Decide whether the name should hide as well.
