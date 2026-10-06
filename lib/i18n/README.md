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
for the server, and read by `electron/main.cjs` for the shell's own dialogs and
the update window. Without a choice, German systems get German and everything
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
3. **Move the German, don't rewrite it.** German is the source and already
   reviewed. Change a German text only where it has to become a function
   (a placeholder, a plural).
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
