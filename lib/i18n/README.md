# Interface languages

Girovo speaks German and English. German is the source: every text is written
in German first, and English says the same thing. What a bank sends — its
messages, its answers, a Verwendungszweck, a booking text — is never
translated; it is shown exactly as the bank wrote it.

## How it fits together

- `messages/<area>.ts` holds one area's texts, German (`de`) and English
  (`en`) side by side. `en` is typed as `typeof de`, so a key or a placeholder
  that one language lacks fails `tsc`.
- `messages/index.ts` collects the areas into `MESSAGES` and the `Messages`
  type.
- `locale.ts` knows the languages and which one is speaking right now.
- `react.tsx`: `LocaleProvider` (in `app/layout.tsx`), `useT()` and
  `useLocale()` for components.
- `server.ts`: an API request speaks the language of the page that sent it
  (cookie `girovo-locale`, else Accept-Language). `lib/api.ts`'s `wrap()` sets
  that up for every route.
- `index.ts`: `msgs()` — the texts in the language speaking right now, for
  code that is not a component.
- `scan.ts`, `scope.ts`, `scripts/i18n-check.mjs` and `guard.test.ts` find
  interface text that is still written straight into the code.

The choice is stored as the preference `fints.locale`, copied into the cookie
for the server, and read by the desktop shell (`src-tauri/src/texts.rs`) for its start window and
the install window. Without a choice, German systems get German and everything
else gets English.

## Writing a text

In a component:

```tsx
const t = useT();
return <h2>{t.transfer.title}</h2>;
```

Anywhere else — a helper, a route, a toast built in a callback:

```ts
throw new Error(msgs().provider.bankUnreachable);
```

The rules:

1. **Every text a person reads goes here.** JSX text, `aria-label`, `title`,
   `placeholder`, `alt`, a toast, an error that reaches the screen, a dialog,
   `document.title`, a file name offered for saving. Log lines and telemetry
   names are for developers and stay as they are.
2. **Bank data stays German.** Patterns, keywords and tables that recognise
   what a bank writes are data, not interface. Mark them so the guard leaves
   them alone: `// i18n-data` on the line, `// i18n-data-next-line`, or
   `// i18n-data-start` … `// i18n-data-end` around a block.
3. **Write it the way "Voice" below says.** German is the source; English
   says the same thing.
4. **Placeholders are parameters, plurals are code.**
   `sent: (name: string) => \`Überweisung an ${name} ausgeführt\``,
   `count: (n: number) => (n === 1 ? '1 Umsatz' : \`${n} Umsätze\`)`.
   Figures and dates arrive already formatted (`fmtMoney`, `fmtDate`, …).
5. **Text with markup** is a function that gets the pieces and returns them
   as an array in the language's own order:
   `hint: (key: (s: string) => ReactNode) => ['Tippe ', key('Esc'), ' zum Schließen']`
   (`import type { ReactNode } from 'react'` — a message file stays a `.ts`
   without JSX). Render it through `rich()` from `lib/i18n/react.tsx`, which
   keys the pieces: `{rich(t.shell.hint((s) => <Kbd>{s}</Kbd>))}`. An element
   passed in whole (`amount: ReactNode`) works the same way.
6. **Never freeze a language.** No translated text in a module-level
   constant, in state, in a ref, in the vault or in a stored preference:
   store an id or a key and translate where it is shown. A `useMemo` or
   `useCallback` that builds text lists `t` in its dependencies.
7. **Behaviour does not change.** Keyboard shortcuts, routes, ids, what a
   search matches, which button is the safe one — all stay. Where matching
   depends on words (the command palette), it matches the words of the
   language on screen and keeps the German ones as data, so both work.
8. **Shared words** live in `messages/common.ts` (`t.common.cancel`). Use
   them; add an area's own words to that area.

## Voice

The owner, 2026-11-07: the texts were far too long and too technical — Girovo
read like an app for developers. Girovo is for people who bank. Every text:

- **Short.** One idea per sentence. A hint under a setting is one line
  (about 70 characters). A dialog's description is one or two short
  sentences. An error says what happened and, if there is one, what to do —
  two short sentences at most.
- **What it means for you, not how it works.** No internals: no FinTS, API,
  HTTP, server, request, cache, token, checksum or hash, signature,
  encryption method, vault, WebDAV, JSON, worker, process, bundle, build,
  "Abruf" in the technical sense. Say what the person sees or decides:
  "Girovo prüft die Datei vor der Installation", not "mit der signierten
  Prüfsumme abgeglichen". A privacy fact stays, in one plain sentence ("Deine
  Daten bleiben auf deinem Gerät.").
- **No explaining the obvious**, no lists of every case, no "zwischendurch",
  "ersatzweise", "jeweils", "entsprechend", "gegebenenfalls", "bzw.".
- **No dashes.** No – or — in any interface text, German or English (owner,
  2026-11-11). Use a period, comma, colon or parentheses instead; a range is
  "1 bis 9" / "1 to 9".
- **Everyday words.** "Rechner" on the desktop and "Telefon" on Android,
  never "Computer". Girovo speaks of itself as "Girovo", never "wir".
- **Bank words stay the banks'** (the glossary below and PRODUCT.md's
  terminology): Kontostand, Verfügbar, Umsätze, Vorgemerkt, Verwendungszweck,
  Freigabe … A bank's own message is shown as the bank wrote it.
- **Safety and money stay exact.** A warning about a transfer, an unclear
  order, logging out or losing data keeps every condition — shorter, never
  softer. Error codes only where someone may need them for support, short
  and at the end ("(Code 9931)").
- **English** mirrors the German in the same few words (see below).

Example — the auto-update switch's hint, before: "Beim Start sucht Girovo
nach einer neuen Version, lädt sie herunter und installiert sie, bevor das
Fenster aufgeht; zwischendurch wird alle sechs Stunden nachgesehen. Aus: nur,
wenn du es sagst. Gefragt wird girovo.de, ersatzweise GitHub; …" — after:
"Neue Versionen werden beim Start installiert."

## English

- **Voice**: the German "du" is a plain, friendly "you". Short sentences, no
  "kindly", no exclamation marks the German does not have, "please" only
  where the German has "bitte" and it still sounds natural.
- **Spelling**: British — colour, organise, authorise, cancelled, catalogue.
- **Case**: sentence case for headings, buttons and labels ("Forget device").
- **Punctuation**: curly quotes “…” where German has „…“; an action that
  opens a dialog ends in "…" with no space before it ("Forget device…").
- **Figures and dates** come from `lib/format.ts`, already in British
  conventions (€1,234.56, 05/10/2026, 5 Oct 2026).
- **Money and safety texts** (transfers, the name check, TANs, logging out
  with an unclear order) say exactly what the German says — no softening, no
  dropped condition.

## Glossary

| German | English |
| --- | --- |
| Übersicht | Overview |
| Umsatz, Umsätze | transaction, transactions |
| Buchung | transaction (booking, where it means the bank's entry) |
| Buchungstag, Wertstellung (Valuta) | booking date, value date |
| vorgemerkt, Vorgemerkte Umsätze | pending, pending transactions |
| Kontostand, Saldo | balance |
| verfügbar | available |
| Kreditrahmen, Dispo | credit limit, overdraft |
| Kartensaldo, Gesamtsaldo | card balance, total balance |
| Girokonto, Sparkonto, Tagesgeld, Festgeld, Depot, Kreditkarte | current account, savings account, instant-access savings, fixed deposit, securities account, credit card |
| Überweisung, Echtzeitüberweisung | transfer, instant transfer |
| Dauerauftrag, Lastschrift, Rücklastschrift | standing order, direct debit, returned direct debit |
| Terminüberweisung, Termin, Turnus, Ausführungstag | scheduled transfer, when, frequency, execution day |
| Gutschrift, Belastung | credit, debit |
| Eingänge, Ausgänge, Ausgaben, Einnahmen | money in, money out, spending, income |
| Empfänger, Zahlungsempfänger, Auftraggeber | recipient, payee, payer |
| Kontoinhaber | account holder |
| Verwendungszweck | payment reference ("reference" where space is short) |
| Gläubiger-ID, Mandatsreferenz, End-to-End-Referenz | creditor ID, mandate reference, end-to-end reference |
| Namensabgleich (Empfängerüberprüfung) | name check; "Verification of Payee" where the official name helps |
| Freigabe, freigeben | approval, approve |
| TAN, TAN-Verfahren | TAN, TAN method (pushTAN, SecureGo plus, chipTAN keep their names) |
| Anmelden, Abmelden, Anmeldename | log in, log out, login name |
| Zugang | login ("FinTS access" for FinTS-Zugang) |
| Sitzung | session |
| Gerät merken, Gerät vergessen | remember this device, forget device |
| Bankleitzahl (BLZ) | bank code (BLZ) |
| Mitteilungen, Postfach | messages, the bank's mailbox |
| Kontoauszug, Buchungsbeleg | account statement, transaction receipt |
| Analyse, Umsatzanalyse | analysis, spending analysis |
| Verträge & Abos, Vertrag, Abo | contracts & subscriptions, contract, subscription |
| Kategorie, Regel | category, rule |
| Vorlage | template |
| GiroCode, Geld anfordern | GiroCode, request money |
| Beträge ausblenden | hide amounts |
| Firmenlogos | company logos |
| Nutzungsdaten, Fehlerberichte | usage data, error reports |
| Ausgeführt, Nicht ausgeführt, Status unklar | completed, not completed, status unclear |
| Abgewickelt über … | processed via … |
| Abschluss, Entgelt, Zinsen | closing entry, fee, interest |
| Sonstiges | other |
| Zeitraum | period |
