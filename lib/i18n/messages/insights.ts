// Analyse and Verträge & Abos (components/Analysis, components/insights, components/Contracts), and the overview: account hero, account list, month summary, balance chart (components/overview).
// Also the words lib/analytics, lib/recurring, lib/balances and lib/balance-history put on screen.

import type { ReactNode } from 'react';
import type { Cadence } from '../../recurring';
import { INTL_LOCALES } from '../locale.ts';

/** "103 Umsätze": a count and its noun, joined by a no-break space so they never wrap apart. */
const counted = (n: number, one: string, many: string) =>
  `${n.toLocaleString(INTL_LOCALES.de)}\u00a0${n === 1 ? one : many}`;

export const de = {
  /** Said beside every control that asks the bank for something. */
  mayNeedApproval: 'Kann eine Freigabe erfordern.',
  /** The same as a row's quiet label, without the full stop (the account list). */
  mayNeedApprovalLabel: 'Kann eine Freigabe erfordern',
  income: 'Einnahmen',
  available: 'Verfügbar',
  loadBalance: 'Saldo abrufen',
  /** Before an estimate: "ca. 13 €". */
  approx: 'ca.',
  amountsHidden: 'Beträge ausgeblendet',
  /** A payee or a booking the bank sent without a name. */
  noName: 'Ohne Namen',
  /** What a figure was worked out from: "Basis: GiroKomfort und Visa". */
  basis: (what: string) => `Basis: ${what}`,
  /** What a figure leaves out: "ohne Visa Classic", "ohne 2 Umbuchungen". */
  without: (what: string) => `ohne ${what}`,
  /** A share, the figure already written: "24 %", "<1 %". */
  percent: (figure: string) => `${figure}\u00a0%`,
  /** An account name field's way back to the bank's own name. */
  resetTo: (name: string) => `Auf „${name}“ zurücksetzen`,

  /** Counts with their noun. */
  count: {
    bookings: (n: number) => counted(n, 'Umsatz', 'Umsätze'),
    days: (n: number) => counted(n, 'Tag', 'Tage'),
    months: (n: number) => counted(n, 'Monat', 'Monate'),
    accounts: (n: number) => counted(n, 'Konto', 'Konten'),
    transfers: (n: number) => counted(n, 'Umbuchung', 'Umbuchungen'),
    contracts: (n: number) => counted(n, 'Vertrag', 'Verträge'),
    withdrawals: (n: number) => counted(n, 'Abhebung', 'Abhebungen'),
    regularIncoming: (n: number) => counted(n, 'regelmäßiger Eingang', 'regelmäßige Eingänge'),
  },

  bookings: {
    load: 'Umsätze abrufen',
    loading: 'Umsätze werden geladen',
    loadingDots: 'Umsätze werden geladen …',
    show: 'Umsätze anzeigen',
    none: 'Keine Umsätze',
    /** Inside a line: "Juli 2026 · keine Umsätze". */
    noneInline: 'keine Umsätze',
    noneInRange: 'Keine Umsätze im geladenen Zeitraum',
    noneForAccount: 'Keine Umsätze für dieses Konto',
  },

  /** A day in words, from today — lower case, as it follows other words. */
  relative: {
    today: 'heute',
    tomorrow: 'morgen',
    yesterday: 'gestern',
    inDays: (n: number) => `in ${n} Tagen`,
    daysAgo: (n: number) => `vor ${n} Tagen`,
  },

  /** Where a stretch of days starts or ends: "ab 05.07.", "bis 03.10.". */
  period: {
    from: (day: string) => `ab ${day}`,
    until: (day: string) => `bis ${day}`,
  },

  /** A month on a chart's axis (lib/analytics.ts monthShort). */
  monthsShort: ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'],
  /** A search word read as a month, said back in full: "August 2026". */
  monthsLong: [
    'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
  ],

  /** A month of the analysis, and one its figures do not wholly cover. */
  month: {
    incomplete: (days: string) => `unvollständig, ${days}`,
    incompleteLabel: (days: string) => `Unvollständig, ${days}`,
    /** A chart readout's title: "September 2025 · nur 01.09.–15.09.". */
    only: (days: string) => `nur ${days}`,
    previous: 'Vorheriger Monat',
    next: 'Nächster Monat',
    previousNamed: (month: string) => `Vorheriger Monat: ${month}`,
    nextNamed: (month: string) => `Nächster Monat: ${month}`,
  },

  /** How often a recurring payment comes (lib/recurring.ts). */
  cadence: {
    weekly: 'wöchentlich',
    monthly: 'monatlich',
    quarterly: 'vierteljährlich',
    halfyearly: 'halbjährlich',
    yearly: 'jährlich',
  } as Record<Cadence, string>,

  /** The Umsatzanalyse (components/Analysis.tsx, components/insights/AnalysisParts.tsx). */
  analysis: {
    label: 'Umsatzanalyse',
    /** The tab's first section, for a screen reader. */
    overview: 'Überblick',
    noAccount: 'Kein Konto ausgewählt',
    noAccountHint: 'Wähle in der Übersicht ein Konto, dessen Umsätze du auswerten möchtest.',
    loadFailed: 'Umsätze konnten nicht geladen werden',
    unsupported: (account: string) =>
      `Für ${account} stellt deine Bank über diesen Zugang keine Umsätze bereit. Wähle ein anderes Konto, um es auszuwerten.`,
    notLoaded: 'Umsätze noch nicht abgerufen',
    notLoadedHint: (account: string) =>
      `Die Analyse wertet die Umsätze von ${account} aus. Das Abrufen kann eine Freigabe erfordern.`,
    /** Announced once a month — or, with null, the whole range — is picked. */
    nowShowing: (month: string | null) => `Analyse zeigt jetzt ${month ?? 'den gesamten Zeitraum'}.`,
    scope: {
      label: 'Welche Konten',
      account: 'Dieses Konto',
      all: 'Alle Konten mit Umsätzen',
    },
    periodMenu: 'Zeitraum der Analyse',
    wholeRange: 'Gesamter Zeitraum',
    /** After the count of bookings: "103 Umsätze im Oktober 2026". */
    inPeriod: (period: string) => `im ${period}`,
    transfersLeftOut: (n: number) => `${counted(n, 'Umbuchung', 'Umbuchungen')} ausgeklammert`,
    firstBooking: (day: string) => `erste Buchung am ${day}`,
    commonPeriod: 'Zeitraum, den alle Konten abdecken',
    otherCurrencyAccounts: (n: number) => `${counted(n, 'Konto', 'Konten')} in anderer Währung nicht enthalten`,
    foreignBookings: (n: number) => `${counted(n, 'Umsatz', 'Umsätze')} in Fremdwährung nicht enthalten`,
    computedHere: 'berechnet auf diesem Rechner',
    /** What a headline figure is made of: "aus 12 Umsätzen". */
    fromBookings: (n: number) => (n === 0 ? 'keine Umsätze' : `aus ${counted(n, 'Umsatz', 'Umsätzen')}`),
    /** Under the difference. */
    net: {
      even: 'Einnahmen und Ausgaben gleich hoch',
      more: 'mehr eingenommen als ausgegeben',
      less: 'mehr ausgegeben als eingenommen',
    },
    average: {
      /** On a phone. */
      short: 'Ø Monatsausgaben',
      label: 'Ø Ausgaben pro Monat',
      spoken: 'Durchschnittliche Ausgaben pro Monat',
      fromMonths: (n: number) => `aus ${counted(n, 'vollem Monat', 'vollen Monaten')}`,
      needsTwo: 'Braucht mindestens zwei volle Monate',
      tooShort: 'Noch zu wenig Verlauf',
    },
    /** A month's spending against the other complete months: "12 % mehr als im September". */
    versus: {
      month: (month: string) => `im ${month}`,
      average: (n: number) => `im Schnitt der ${n} anderen vollen Monate`,
      same: (basis: string) => `so viel wie ${basis}`,
      more: (pct: number, basis: string) => `${pct}\u00a0% mehr als ${basis}`,
      less: (pct: number, basis: string) => `${pct}\u00a0% weniger als ${basis}`,
    },
    emptyRange: (range: string, days: number) => `Für ${range} (${counted(days, 'Tag', 'Tage')}) liegen keine Buchungen vor.`,
    emptyRangeLonger: 'Mit einem längeren Verlauf gibt es vielleicht etwas auszuwerten.',
    noSpending: 'Keine Ausgaben',
    categories: {
      title: 'Ausgaben nach Kategorie',
      empty: 'In diesem Zeitraum gibt es keine Ausgaben, die sich einer Kategorie zuordnen lassen.',
      /** The share bar's last segment: every category after the sixth. */
      rest: (n: number) => `Weitere (${n})`,
    },
    monthly: {
      title: 'Monatsvergleich',
      subtitle: 'Einnahmen und Ausgaben',
      asChart: 'Als Diagramm',
      asTable: 'Als Tabelle',
      partial: 'Unvollständiger Monat',
      hint: 'Wähle einen Monat, um die Analyse darauf zu beschränken.',
      caption: 'Einnahmen und Ausgaben je Monat',
      month: 'Monat',
      /** The chart, for a screen reader. */
      summary: (months: number) => `Säulendiagramm: Einnahmen und Ausgaben für ${counted(months, 'Monat', 'Monate')}`,
      peaks: (spending: string, income: string) => `Höchste Ausgaben im ${spending}, höchste Einnahmen im ${income}.`,
      /** One month's bars, for a screen reader. */
      values: (income: string, spending: string) => `Einnahmen ${income}, Ausgaben ${spending}`,
    },
    payees: {
      title: 'Top-Empfänger',
      subtitle: (period: string) => `nach Ausgaben · ${period}`,
      empty: 'In diesem Zeitraum ist kein Geld an andere gegangen.',
      share: (share: string) => `${share} der Ausgaben`,
      /** The payment service a shop was paid through. */
      via: (service: string) => `über ${service}`,
      showCash: 'Alle Abhebungen anzeigen',
      showAll: (name: string) => `Alle Umsätze mit ${name} anzeigen`,
    },
    largest: {
      title: 'Größte Einzelausgaben',
      subtitle: (period: string) => `ohne Verträge, Abos und Bargeld · ${period}`,
      emptyTitle: 'Keine einzelnen Ausgaben',
      empty: 'In diesem Zeitraum gibt es außer Verträgen, Abos und Bargeld keine Ausgaben.',
      /** "3× in diesem Zeitraum · zuletzt 28.09.2026" — `wide` gets what only wider screens show. */
      repeats: (n: number, wide: (s: string) => ReactNode, day: string): ReactNode[] => [
        `${n}×`, wide(' in diesem Zeitraum'), ` · zuletzt ${day}`,
      ],
      showThese: 'Diese Buchungen in den Umsätzen zeigen',
      showOne: 'In den Umsätzen zeigen',
    },
  },

  /** Verträge & Abos (components/Contracts.tsx, components/insights/ContractRow.tsx). */
  contracts: {
    /** The tab, for a screen reader. */
    label: 'Verträge und Abos',
    /** A series whose bookings name nobody (lib/recurring.ts). */
    unknown: 'Unbekannt',
    /** The group for contracts that fit no other (lib/recurring.ts). */
    otherContracts: 'Weitere Verträge',
    columns: {
      contract: 'Vertrag',
      next: 'Nächste Buchung',
      nextIncoming: 'Nächster Eingang',
      perYear: 'Pro Jahr',
    },
    /** When a series is due, or why it is not. */
    due: {
      endedCompact: (day: string) => `Zuletzt am ${day} · vermutlich beendet`,
      last: (day: string) => `Zuletzt ${day}`,
      ended: 'vermutlich beendet',
      overdueCompact: (day: string) => `Erwartet am ${day}, noch nicht gebucht`,
      overdue: 'erwartet, noch nicht gebucht',
      missingCompact: (day: string) => `Erwartet am ${day}, noch nicht in den Umsätzen`,
      missing: 'noch nicht in den Umsätzen',
      expectedCompact: (day: string) => `Voraussichtlich am ${day}`,
      /** "voraussichtlich, in 5 Tagen". */
      expected: (when: string) => `voraussichtlich, ${when}`,
    },
    /** An estimate in whole euros: "ca. 13 € pro Monat". */
    perMonth: (amount: ReactNode): ReactNode[] => ['ca. ', amount, ' pro Monat'],
    perYear: (amount: ReactNode): ReactNode[] => ['ca. ', amount, ' im Jahr'],
    rose: (amount: ReactNode): ReactNode[] => ['Betrag gestiegen ', amount],
    before: (amount: ReactNode): ReactNode[] => ['vorher ', amount],
    /** Under the amount: when it was last booked. */
    lastShort: (day: string) => `zuletzt ${day}`,
    actionsFor: (name: string) => `Aktionen für ${name}`,
    dismiss: 'Nicht als Vertrag zählen',
    dismissHint: 'Aus dieser Liste und den Summen nehmen',
    dismissed: (name: string) => `„${name}“ zählt nicht mehr als Vertrag.`,
    undo: 'Rückgängig',
    since: (n: number, day: string) => `${n} Buchungen seit ${day}`,
    byDirectDebit: 'per Lastschrift',
    varies: 'Betrag schwankt',
    mandate: 'Mandatsreferenz',
    restore: 'Wieder anzeigen',
    /** Read after "Wieder anzeigen": which series comes back. */
    restoreWhich: (name: string) => ` – ${name} als Vertrag`,
    noneFound: 'Keine Verträge erkannt',
    noneInRange: (range: string) =>
      `Für ${range} liegen keine Buchungen vor, in denen sich regelmäßige Zahlungen erkennen ließen.`,
    noRegular: 'Keine regelmäßigen Zahlungen erkannt',
    noRegularHint: (range: string) =>
      `Im Zeitraum ${range} wiederholt sich keine Zahlung oft und gleichmäßig genug, um sie als Vertrag zu erkennen.`,
    longerHelps: 'Mit einem längeren Verlauf klappt das oft besser.',
    regularIncome: 'Regelmäßige Eingänge',
    longerHistory: 'Längerer Verlauf',
    moreFound: 'Weitere erkannte Zahlungen',
    endedTitle: (n: number) => `Beendet (${n})`,
    notInTotals: 'Nicht in den Summen',
    endedHint: 'Zweimal ausgeblieben – vermutlich gekündigt oder umgestellt.',
    hiddenTitle: (n: number) => `Ausgeblendet (${n})`,
    notCounted: 'Nicht als Vertrag gezählt',
    vaultUnavailable: 'Deine persönlichen Daten sind gerade nicht verfügbar – diese Auswahl gilt nur bis zur Abmeldung.',
    /** After the bank's reason. */
    cannotRecognise: 'Ohne Umsätze lassen sich keine Verträge erkennen.',
    notLoaded: 'Noch keine Umsätze abgerufen',
    howItWorks: 'Regelmäßige Zahlungen erkennt die App auf diesem Rechner in den Umsätzen deiner Konten.',
    loadHint: (account: string) => `Ruf dafür die Umsätze von ${account} ab – das kann eine Freigabe erfordern.`,
    summary: 'Zusammenfassung',
    /** Under a monthly figure: "pro Monat · 3 Verträge". */
    perMonthWith: (what: string) => `pro Monat · ${what}`,
    subscriptions: 'Abos & Verträge',
    fixedCosts: 'Fixkosten',
    inLoadedHistory: 'im geladenen Verlauf',
    fixedPerYear: 'Fixkosten pro Jahr',
    /** Before a sum the history may be short of. */
    atLeast: 'mind.',
    /** The rhythms a short history cannot show, as adjectives: "Vierteljährliche und jährliche". */
    unseenAdjective: {
      quarterly: 'vierteljährliche',
      halfyearly: 'halbjährliche',
      yearly: 'jährliche',
    } as Partial<Record<Cadence, string>>,
    unseenPayments: (rhythms: string) => `${rhythms} Zahlungen zeigt erst ein längerer Verlauf`,
    unseenContracts: (rhythms: string) => `${rhythms} Verträge zeigen sich erst in einem längeren Verlauf.`,
    loadYearForYearly: 'Für jährliche Verträge 12 Monate abrufen.',
    projected: 'hochgerechnet aus dem Rhythmus',
    computedHere: 'Berechnet auf diesem Rechner aus den geladenen Umsätzen.',
    estimate: 'Schätzung',
    excluded: 'Umbuchungen und Bargeld ausgenommen',
    otherCurrency: (n: number) => `${counted(n, 'Vertrag', 'Verträge')} in anderer Währung nicht summiert`,
    reloadAccount: (account: string) => `${account} erneut abrufen`,
    /** After the bank's reason, when an account in scope failed. */
    failedHint: (n: number) =>
      `Ohne ${n === 1 ? 'dieses Konto' : 'diese Konten'} wären die Summen unvollständig – sie erscheinen, sobald die Umsätze da sind.`,
    historyDays: (n: number) => `${counted(n, 'Tag', 'Tage')} Verlauf`,
    loading: 'wird abgerufen …',
    notIncluded: 'nicht enthalten',
    noFints: 'keine Umsätze über FinTS',
    /** After a button's words, for a screen reader: "Umsätze abrufen für Tagesgeld". */
    forAccount: (account: string) => `für ${account}`,
    loadYear: '12 Monate abrufen',
    noSwitch: 'Das Konto wird dafür nicht gewechselt.',
    /** "GiroKomfort und Visa reichen 91 Tage zurück". */
    reach: (accounts: string, several: boolean, days: number) =>
      `${accounts} ${several ? 'reichen' : 'reicht'} ${counted(days, 'Tag', 'Tage')} zurück`,
    noneRecognised: 'Keine regelmäßigen erkannt',
    recognising: 'Verträge werden erkannt …',
  },

  /** Demnächst fällig, the overview's tile of what the next 30 days bring (components/Contracts.tsx). */
  upcoming: {
    title: 'Demnächst fällig',
    next30: 'nächste 30 Tage',
    expected: 'voraussichtlich',
    all: 'Alle Verträge',
    failed: (account: string) => `Abruf für ${account} fehlgeschlagen – ohne Umsätze lässt sich nichts vorhersehen.`,
    notLoaded: (account: string) =>
      `Sobald die Umsätze von ${account || 'diesem Konto'} abgerufen sind, stehen hier die nächsten erwarteten Buchungen.`,
    none: (account: string) => `Für ${account} ist in den nächsten 30 Tagen keine regelmäßige Buchung zu erwarten.`,
    noneYet: 'In den geladenen Umsätzen sind noch keine regelmäßigen Zahlungen erkannt.',
    /** Before the rhythm, for a screen reader: "am 05.10., ". */
    on: (day: string) => `am ${day}, `,
    more: (n: number) => `und ${counted(n, 'weitere Buchung', 'weitere Buchungen')} in den 30 Tagen`,
    sum: 'Summe der 30 Tage, ca.',
  },

  /** The one button that asks the bank for a year (components/insights/shared.tsx). */
  loadYear: {
    label: 'Umsätze für 12 Monate abrufen',
    hint: 'Kann eine Freigabe erfordern. Manche Banken liefern weniger Verlauf.',
  },

  /** The account hero: the balance and what qualifies it (components/overview/AccountHero.tsx). */
  hero: {
    loading: 'Kontostand wird geladen',
    title: (account: string) => `Konto ${account}`,
    cardBalance: 'Kartensaldo',
    balanceOn: (day: string) => `Saldo am ${day}`,
    bookingDay: (day: string) => `Buchungstag ${day}`,
    bookingDayHint:
      'Die Bank datiert diesen Saldo auf ihren nächsten Buchungstag. Er enthält bereits Buchungen mit diesem Datum.',
    asOf: (day: string) => `Stand ${day}`,
    creditLimit: 'Kreditrahmen',
    overdraft: 'Dispositionsrahmen',
    pendingCount: (n: number) => (n === 1 ? '1 vorgemerkter Umsatz' : `${n} vorgemerkte Umsätze`),
    /** When the pending list was fetched: "Stand 14:05 Uhr". */
    pendingAsOf: (since: string, behind: boolean) => `Stand ${since}${behind ? ', vor dem letzten Umsatzabruf' : ''}`,
    closingHint: 'Endsaldo des geladenen Zeitraums laut deiner Bank',
    /** Shows hidden amounts again. */
    show: 'Anzeigen',
    pastRange: 'Der Zeitraum endet vor heute.',
    currentFailed: (card: boolean, reason: string) =>
      `Abruf des aktuellen ${card ? 'Kartensaldos' : 'Kontostands'} fehlgeschlagen: ${reason}`,
    loadCurrent: (card: boolean) => `Aktuellen ${card ? 'Kartensaldo' : 'Kontostand'} abrufen`,
    pastRangeHint: (card: boolean) =>
      `Zeitraum endet vor heute – den aktuellen ${card ? 'Kartensaldo' : 'Kontostand'} zeigt ein Abruf bis heute.`,
    fetching: 'Kontostand wird abgerufen',
    fetchingDots: 'Saldo wird abgerufen …',
    noBalanceYet: 'Noch kein Saldo abgerufen',
    noBalance: 'Kein Saldo abrufbar',
    noBalanceHint: 'Deine Bank meldet für dieses Konto über diesen Zugang keinen Saldo.',
    /** Before a credit card's number. */
    card: 'Karte',
    renameLabel: 'Konto umbenennen',
    nameLabel: 'Kontoname',
    nameHint:
      'Er wird verschlüsselt auf diesem Rechner gespeichert, deine Bank erfährt davon nichts. Ein leeres Feld zeigt wieder den Namen deiner Bank.',
    historyTooShort: 'Der geladene Zeitraum ist zu kurz.',
    noHistory: 'Kein Kontoverlauf.',
    figureStands: 'Der Saldo oben ist der, den deine Bank gemeldet hat.',
    historyCaption: 'Tagesendsaldo nach Buchungstag, aus den Umsätzen und Salden deiner Bank nachgerechnet.',
  },

  /** The Kontoverlauf chart (components/overview/BalanceChart.tsx). */
  balanceChart: {
    title: 'Kontoverlauf',
    /** The slider's value, read out: "Kontostand am 28.09.2026: 1.234,56 €". */
    spoken: (day: string, amount: string) => `Kontostand am ${day}: ${amount}`,
    on: (day: string) => `Kontostand am ${day}`,
    range: (from: string, to: string) => `Vom ${from} bis ${to}`,
    hidden: 'Beträge sind ausgeblendet.',
    summary: (range: string, low: string, lowDay: string, high: string, highDay: string, last: string) =>
      `${range}: niedrigster Stand ${low} am ${lowDay}, höchster Stand ${high} am ${highDay}, zuletzt ${last}.`,
    max: (amount: string) => `Max. ${amount}`,
    min: (amount: string) => `Min. ${amount}`,
    minOn: (amount: string, day: string) => `Min. ${amount} am ${day}`,
    keys: 'Mit den Pfeiltasten wählst du einen Tag, mit Bild auf und Bild ab springst du eine Woche.',
  },

  /** How an account is named and told apart (components/overview/AccountIdentity.tsx). */
  identity: {
    vaultLoading: 'Deine persönlichen Einstellungen werden noch geladen. Gleich kannst du deine Konten umbenennen.',
    vaultError:
      'Deine gespeicherten persönlichen Einstellungen ließen sich nicht entschlüsseln – meist, weil sich deine PIN geändert hat. Bis sie zurückgesetzt sind, kann ein neuer Kontoname nicht gespeichert werden.',
    vaultUnavailable: 'Kontonamen werden verschlüsselt auf diesem Rechner gespeichert. Das ist in dieser Sitzung nicht möglich.',
    ibanEnds: (tail: string) => `IBAN endet auf ${tail}`,
    cardEnds: (tail: string) => `Karte endet auf ${tail}`,
    accountNumber: (number: string) => `Kontonummer ${number}`,
  },

  /** Konten und Karten, the account list (components/overview/AccountList.tsx). */
  accounts: {
    title: 'Konten und Karten',
    rename: 'Umbenennen',
    renameAll: 'Konten umbenennen',
    renameHint:
      'Gib deinen Konten eigene Namen. Sie werden verschlüsselt auf diesem Rechner gespeichert, deine Bank erfährt davon nichts. Ein leeres Feld zeigt wieder den Namen deiner Bank.',
    namesSaved: (n: number): string => (n === 1 ? 'Kontoname gespeichert.' : 'Kontonamen gespeichert.'),
    nameFor: (bank: string, ident: string) => `Name für ${bank}, ${ident}`,
    atBank: (bank: string) => `Bei der Bank: ${bank}`,
    none: 'Keine Konten',
    noneHint: 'Deine Bank hat für diesen Zugang keine Konten gemeldet.',
    notYet: (accounts: string) => `Noch nicht abgerufen: ${accounts}`,
    excludedHint: 'Konten, für die deine Bank keinen Saldo meldet, und Konten in anderer Währung zählen nicht mit.',
    busyApproval: 'Bitte warten – eine Freigabe läuft',
    busyFetch: 'Bitte warten – ein Abruf läuft',
    fetching: 'Saldo wird abgerufen',
    cannotFetch: 'Kein Abruf möglich',
    total: 'Gesamtsaldo',
    incomplete: 'unvollständig',
    loadAll: 'Alle Salden abrufen',
  },

  /** Monatsbilanz, this month in and out (components/overview/MonthSummary.tsx). */
  monthSummary: {
    title: 'Monatsbilanz',
    /** Last month as a yardstick: "Im September", "Im September bis 04.09.". */
    inMonth: (month: string) => `Im ${month}`,
    inMonthUntil: (month: string, day: string) => `Im ${month} bis ${day}`,
    inMonthSpan: (month: string, days: string) => `Im ${month}, ${days}`,
    unsupported: 'Deine Bank bietet für dieses Konto keine Umsatzabfrage über FinTS an.',
    pending: 'Sobald die Umsätze dieses Kontos abgerufen sind, steht hier die Bilanz des Monats.',
    notLoaded: 'Keine Umsätze geladen',
    monthNotLoaded: (month: string) => `${month} ist nicht geladen`,
    loadToToday: 'Bis heute laden',
    loadToTodayHint: 'Lädt die letzten 90 Tage. Kann eine Freigabe erfordern.',
    loaded: (range: ReactNode): ReactNode[] => ['Geladen ist der Zeitraum ', range, '.'],
    noneYet: (month: string) => `Noch keine Umsätze im ${month}`,
    onlyTransfers: (n: number) =>
      `Bisher nur ${n === 1 ? 'eine Umbuchung' : `${n} Umbuchungen`} zwischen deinen eigenen Konten – die zählen hier nicht mit.`,
    empty: 'Sobald etwas gebucht ist, siehst du hier, was rein- und rausging.',
    toAnalysis: 'Zur Analyse',
    withoutForeign: (n: number) => `ohne ${n} in Fremdwährung`,
  },

  /** Why there is no Kontoverlauf (lib/balance-history.ts). */
  balanceHistory: {
    invalidRange: 'Der Zeitraum ist ungültig.',
    noBalances: 'Die Bank hat zu diesem Abruf keine Salden geliefert.',
    missingBalances: 'Die Bank hat nicht zu jedem Kontoauszug einen Anfangs- und Endsaldo geliefert.',
    currencies: 'Die Umsätze sind in mehr als einer Währung geführt.',
    gap: 'Die Kontoauszüge der Bank schließen nicht lückenlos aneinander an.',
    badBooking: 'Nicht jeder Umsatz hat ein gültiges Buchungsdatum und einen Betrag.',
    count: 'Die Zahl der Umsätze passt nicht zu den Kontoauszügen der Bank.',
    sum: 'Die Umsätze ergeben nicht die Salden, die die Bank meldet.',
    dates: 'Die Buchungsdaten passen nicht zu den Kontoauszügen der Bank.',
    unverified: 'Für diesen Zeitraum liegen keine geprüften Salden vor.',
    tooLong: 'Der Zeitraum ist zu lang für einen Kontoverlauf.',
  },

  /** Reads that failed, as one sentence for a toast (lib/balances.ts). */
  balances: {
    quoted: (name: string) => `„${name}“`,
    fetchFailed: (accounts: string, reason: string | null) =>
      (reason ? `Abruf für ${accounts} fehlgeschlagen: ${reason}` : `Abruf für ${accounts} fehlgeschlagen.`),
  },
};

/** "103 transactions", with a no-break space. */
const countedEn = (n: number, one: string, many: string) =>
  `${n.toLocaleString(INTL_LOCALES.en)}\u00a0${n === 1 ? one : many}`;

export const en: typeof de = {
  mayNeedApproval: 'May need approval.',
  mayNeedApprovalLabel: 'May need approval',
  income: 'Income',
  available: 'Available',
  loadBalance: 'Load balance',
  approx: 'approx.',
  amountsHidden: 'Amounts hidden',
  noName: 'Unnamed',
  basis: (what) => `Based on ${what}`,
  without: (what) => `excluding ${what}`,
  percent: (figure) => `${figure}%`,
  resetTo: (name) => `Reset to “${name}”`,

  count: {
    bookings: (n) => countedEn(n, 'transaction', 'transactions'),
    days: (n) => countedEn(n, 'day', 'days'),
    months: (n) => countedEn(n, 'month', 'months'),
    accounts: (n) => countedEn(n, 'account', 'accounts'),
    transfers: (n) => countedEn(n, 'internal transfer', 'internal transfers'),
    contracts: (n) => countedEn(n, 'contract', 'contracts'),
    withdrawals: (n) => countedEn(n, 'withdrawal', 'withdrawals'),
    regularIncoming: (n) => countedEn(n, 'regular incoming payment', 'regular incoming payments'),
  },

  bookings: {
    load: 'Load transactions',
    loading: 'Loading transactions',
    loadingDots: 'Loading transactions…',
    show: 'Show transactions',
    none: 'No transactions',
    noneInline: 'no transactions',
    noneInRange: 'No transactions in the loaded period',
    noneForAccount: 'No transactions for this account',
  },

  relative: {
    today: 'today',
    tomorrow: 'tomorrow',
    yesterday: 'yesterday',
    inDays: (n) => `in ${n} days`,
    daysAgo: (n) => `${n} days ago`,
  },

  period: {
    from: (day) => `from ${day}`,
    until: (day) => `until ${day}`,
  },

  monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  monthsLong: [
    'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
  ],

  month: {
    incomplete: (days) => `incomplete, ${days}`,
    incompleteLabel: (days) => `Incomplete, ${days}`,
    only: (days) => `only ${days}`,
    previous: 'Previous month',
    next: 'Next month',
    previousNamed: (month) => `Previous month: ${month}`,
    nextNamed: (month) => `Next month: ${month}`,
  },

  cadence: {
    weekly: 'weekly',
    monthly: 'monthly',
    quarterly: 'quarterly',
    halfyearly: 'half-yearly',
    yearly: 'yearly',
  },

  analysis: {
    label: 'Spending analysis',
    overview: 'At a glance',
    noAccount: 'No account selected',
    noAccountHint: 'In the overview, choose an account whose transactions you want to analyse.',
    loadFailed: 'Could not load transactions',
    unsupported: (account) =>
      `Your bank does not provide transactions for ${account} through this access. Choose another account to analyse it.`,
    notLoaded: 'Transactions not loaded yet',
    notLoadedHint: (account) => `The analysis works from the transactions of ${account}. Loading them may need approval.`,
    nowShowing: (month) => `The analysis now shows ${month ?? 'the whole period'}.`,
    scope: {
      label: 'Which accounts',
      account: 'This account',
      all: 'All accounts with transactions',
    },
    periodMenu: 'Analysis period',
    wholeRange: 'Whole period',
    inPeriod: (period) => `in ${period}`,
    transfersLeftOut: (n) => `${countedEn(n, 'internal transfer', 'internal transfers')} left out`,
    firstBooking: (day) => `first transaction on ${day}`,
    commonPeriod: 'the period all accounts cover',
    otherCurrencyAccounts: (n) => `${countedEn(n, 'account', 'accounts')} in another currency not included`,
    foreignBookings: (n) => `${countedEn(n, 'transaction', 'transactions')} in a foreign currency not included`,
    computedHere: 'worked out on this computer',
    fromBookings: (n) => (n === 0 ? 'no transactions' : `from ${countedEn(n, 'transaction', 'transactions')}`),
    net: {
      even: 'Income and spending are the same',
      more: 'more came in than went out',
      less: 'more went out than came in',
    },
    average: {
      short: 'Avg. monthly spending',
      label: 'Avg. spending per month',
      spoken: 'Average spending per month',
      fromMonths: (n) => `from ${countedEn(n, 'full month', 'full months')}`,
      needsTwo: 'Needs at least two full months',
      tooShort: 'Not enough history yet',
    },
    versus: {
      month: (month) => `in ${month}`,
      average: (n) => `the average of the other ${n} full months`,
      same: (basis) => `as much as ${basis}`,
      more: (pct, basis) => `${pct}% more than ${basis}`,
      less: (pct, basis) => `${pct}% less than ${basis}`,
    },
    emptyRange: (range, days) => `There are no transactions for ${range} (${countedEn(days, 'day', 'days')}).`,
    emptyRangeLonger: 'With a longer history there may be something to analyse.',
    noSpending: 'No spending',
    categories: {
      title: 'Spending by category',
      empty: 'There is no spending in this period that can be put into a category.',
      rest: (n) => `Others (${n})`,
    },
    monthly: {
      title: 'Monthly comparison',
      subtitle: 'Income and spending',
      asChart: 'As a chart',
      asTable: 'As a table',
      partial: 'Incomplete month',
      hint: 'Choose a month to limit the analysis to it.',
      caption: 'Income and spending per month',
      month: 'Month',
      summary: (months) => `Bar chart: income and spending for ${countedEn(months, 'month', 'months')}`,
      peaks: (spending, income) => `Highest spending in ${spending}, highest income in ${income}.`,
      values: (income, spending) => `Income ${income}, spending ${spending}`,
    },
    payees: {
      title: 'Top payees',
      subtitle: (period) => `by spending · ${period}`,
      empty: 'No money went to anyone else in this period.',
      share: (share) => `${share} of spending`,
      via: (service) => `via ${service}`,
      showCash: 'Show all withdrawals',
      showAll: (name) => `Show all transactions with ${name}`,
    },
    largest: {
      title: 'Largest single payments',
      subtitle: (period) => `excluding contracts, subscriptions and cash · ${period}`,
      emptyTitle: 'No single payments',
      empty: 'Apart from contracts, subscriptions and cash, there is no spending in this period.',
      repeats: (n, wide, day) => [`${n}×`, wide(' in this period'), ` · last on ${day}`],
      showThese: 'Show these in Transactions',
      showOne: 'Show in Transactions',
    },
  },

  contracts: {
    label: 'Contracts and subscriptions',
    unknown: 'Unknown',
    otherContracts: 'Other contracts',
    columns: {
      contract: 'Contract',
      next: 'Next transaction',
      nextIncoming: 'Next incoming payment',
      perYear: 'Per year',
    },
    due: {
      endedCompact: (day) => `Last on ${day} · probably ended`,
      last: (day) => `Last on ${day}`,
      ended: 'probably ended',
      overdueCompact: (day) => `Expected on ${day}, not booked yet`,
      overdue: 'expected, not booked yet',
      missingCompact: (day) => `Expected on ${day}, not in your transactions yet`,
      missing: 'not in your transactions yet',
      expectedCompact: (day) => `Expected on ${day}`,
      expected: (when) => `expected, ${when}`,
    },
    perMonth: (amount) => ['approx. ', amount, ' per month'],
    perYear: (amount) => ['approx. ', amount, ' per year'],
    rose: (amount) => ['Amount up ', amount],
    before: (amount) => ['previously ', amount],
    lastShort: (day) => `last on ${day}`,
    actionsFor: (name) => `Actions for ${name}`,
    dismiss: 'Don’t count as a contract',
    dismissHint: 'Take it out of this list and the totals',
    dismissed: (name) => `“${name}” no longer counts as a contract.`,
    undo: 'Undo',
    since: (n, day) => `${n} transactions since ${day}`,
    byDirectDebit: 'by direct debit',
    varies: 'amount varies',
    mandate: 'Mandate reference',
    restore: 'Show again',
    restoreWhich: (name) => ` – ${name} as a contract`,
    noneFound: 'No contracts recognised',
    noneInRange: (range) => `There are no transactions for ${range} in which regular payments could be recognised.`,
    noRegular: 'No regular payments recognised',
    noRegularHint: (range) =>
      `In the period ${range}, no payment repeats often and evenly enough to be recognised as a contract.`,
    longerHelps: 'A longer history often works better.',
    regularIncome: 'Regular incoming payments',
    longerHistory: 'Longer history',
    moreFound: 'Other recognised payments',
    endedTitle: (n) => `Ended (${n})`,
    notInTotals: 'Not in the totals',
    endedHint: 'Missed twice – probably cancelled or changed.',
    hiddenTitle: (n) => `Hidden (${n})`,
    notCounted: 'Not counted as a contract',
    vaultUnavailable: 'Your personal data is not available right now – this choice only lasts until you log out.',
    cannotRecognise: 'Without transactions, no contracts can be recognised.',
    notLoaded: 'No transactions loaded yet',
    howItWorks: 'The app recognises regular payments in your accounts’ transactions, on this computer.',
    loadHint: (account) => `To do so, load the transactions of ${account} – this may need approval.`,
    summary: 'Summary',
    perMonthWith: (what) => `per month · ${what}`,
    subscriptions: 'Subscriptions & contracts',
    fixedCosts: 'Fixed costs',
    inLoadedHistory: 'in the loaded history',
    fixedPerYear: 'Fixed costs per year',
    atLeast: 'at least',
    unseenAdjective: {
      quarterly: 'quarterly',
      halfyearly: 'half-yearly',
      yearly: 'yearly',
    },
    unseenPayments: (rhythms) => `${rhythms} payments only show in a longer history`,
    unseenContracts: (rhythms) => `${rhythms} contracts only show up in a longer history.`,
    loadYearForYearly: 'For yearly contracts, load 12 months.',
    projected: 'projected from how often they recur',
    computedHere: 'Worked out on this computer from the loaded transactions.',
    estimate: 'Estimate',
    excluded: 'Internal transfers and cash left out',
    otherCurrency: (n) => `${countedEn(n, 'contract', 'contracts')} in another currency not added up`,
    reloadAccount: (account) => `Load ${account} again`,
    failedHint: (n) =>
      `Without ${n === 1 ? 'this account' : 'these accounts'} the totals would be incomplete – they appear once the transactions are in.`,
    historyDays: (n) => `${countedEn(n, 'day', 'days')} of history`,
    loading: 'loading…',
    notIncluded: 'not included',
    noFints: 'no transactions over FinTS',
    forAccount: (account) => `for ${account}`,
    loadYear: 'Load 12 months',
    noSwitch: 'This does not switch the account.',
    reach: (accounts, several, days) => `${accounts} ${several ? 'go' : 'goes'} back ${countedEn(days, 'day', 'days')}`,
    noneRecognised: 'No regular ones recognised',
    recognising: 'Recognising contracts…',
  },

  upcoming: {
    title: 'Due soon',
    next30: 'next 30 days',
    expected: 'expected',
    all: 'All contracts',
    failed: (account) => `Could not load ${account} – without transactions, nothing can be predicted.`,
    notLoaded: (account) =>
      `Once the transactions of ${account || 'this account'} are loaded, the next expected transactions appear here.`,
    none: (account) => `No regular transaction is expected for ${account} in the next 30 days.`,
    noneYet: 'No regular payments have been recognised in the loaded transactions yet.',
    on: (day) => `on ${day}, `,
    more: (n) => `and ${countedEn(n, 'more transaction', 'more transactions')} in the 30 days`,
    sum: 'Total for the 30 days, approx.',
  },

  loadYear: {
    label: 'Load 12 months of transactions',
    hint: 'May need approval. Some banks send less history.',
  },

  hero: {
    loading: 'Loading balance',
    title: (account) => `Account ${account}`,
    cardBalance: 'Card balance',
    balanceOn: (day) => `Balance on ${day}`,
    bookingDay: (day) => `Booking date ${day}`,
    bookingDayHint: 'The bank dates this balance to its next booking date. It already includes transactions with that date.',
    asOf: (day) => `As of ${day}`,
    creditLimit: 'Credit limit',
    overdraft: 'Overdraft limit',
    pendingCount: (n) => (n === 1 ? '1 pending transaction' : `${n} pending transactions`),
    pendingAsOf: (since, behind) => `as of ${since}${behind ? ', before transactions were last loaded' : ''}`,
    closingHint: 'Closing balance of the loaded period, according to your bank',
    show: 'Show',
    pastRange: 'The period ends before today.',
    currentFailed: (card, reason) => `Could not load the current ${card ? 'card balance' : 'balance'}: ${reason}`,
    loadCurrent: (card) => `Load current ${card ? 'card balance' : 'balance'}`,
    pastRangeHint: (card) =>
      `The period ends before today – loading up to today shows the current ${card ? 'card balance' : 'balance'}.`,
    fetching: 'Loading balance',
    fetchingDots: 'Loading balance…',
    noBalanceYet: 'No balance loaded yet',
    noBalance: 'No balance available',
    noBalanceHint: 'Your bank reports no balance for this account through this access.',
    card: 'Card',
    renameLabel: 'Rename account',
    nameLabel: 'Account name',
    nameHint:
      'It is stored encrypted on this computer, and your bank knows nothing about it. An empty field shows your bank’s name again.',
    historyTooShort: 'The loaded period is too short.',
    noHistory: 'No balance history.',
    figureStands: 'The balance above is the one your bank reported.',
    historyCaption: 'End-of-day balance by booking date, recalculated from your bank’s transactions and balances.',
  },

  balanceChart: {
    title: 'Balance history',
    spoken: (day, amount) => `Balance on ${day}: ${amount}`,
    on: (day) => `Balance on ${day}`,
    range: (from, to) => `From ${from} to ${to}`,
    hidden: 'Amounts are hidden.',
    summary: (range, low, lowDay, high, highDay, last) =>
      `${range}: lowest ${low} on ${lowDay}, highest ${high} on ${highDay}, latest ${last}.`,
    max: (amount) => `Max. ${amount}`,
    min: (amount) => `Min. ${amount}`,
    minOn: (amount, day) => `Min. ${amount} on ${day}`,
    keys: 'Use the arrow keys to choose a day, and Page Up and Page Down to jump a week.',
  },

  identity: {
    vaultLoading: 'Your personal settings are still loading. You can rename your accounts in a moment.',
    vaultError:
      'Your saved personal settings could not be decrypted – usually because your PIN has changed. Until they are reset, a new account name cannot be saved.',
    vaultUnavailable: 'Account names are stored encrypted on this computer. That is not possible in this session.',
    ibanEnds: (tail) => `IBAN ending in ${tail}`,
    cardEnds: (tail) => `Card ending in ${tail}`,
    accountNumber: (number) => `Account number ${number}`,
  },

  accounts: {
    title: 'Accounts and cards',
    rename: 'Rename',
    renameAll: 'Rename accounts',
    renameHint:
      'Give your accounts names of your own. They are stored encrypted on this computer, and your bank knows nothing about them. An empty field shows your bank’s name again.',
    namesSaved: (n) => (n === 1 ? 'Account name saved.' : 'Account names saved.'),
    nameFor: (bank, ident) => `Name for ${bank}, ${ident}`,
    atBank: (bank) => `At the bank: ${bank}`,
    none: 'No accounts',
    noneHint: 'Your bank reported no accounts for this access.',
    notYet: (accounts) => `Not loaded yet: ${accounts}`,
    excludedHint: 'Accounts your bank reports no balance for, and accounts in another currency, are not counted.',
    busyApproval: 'Please wait – an approval is in progress',
    busyFetch: 'Please wait – loading from your bank',
    fetching: 'Loading balance',
    cannotFetch: 'Cannot be loaded',
    total: 'Total balance',
    incomplete: 'incomplete',
    loadAll: 'Load all balances',
  },

  monthSummary: {
    title: 'Monthly summary',
    inMonth: (month) => `In ${month}`,
    inMonthUntil: (month, day) => `In ${month} until ${day}`,
    inMonthSpan: (month, days) => `In ${month}, ${days}`,
    unsupported: 'Your bank does not offer transaction queries for this account over FinTS.',
    pending: 'Once this account’s transactions are loaded, the month’s summary appears here.',
    notLoaded: 'No transactions loaded',
    monthNotLoaded: (month) => `${month} is not loaded`,
    loadToToday: 'Load up to today',
    loadToTodayHint: 'Loads the last 90 days. May need approval.',
    loaded: (range) => ['The loaded period is ', range, '.'],
    noneYet: (month) => `No transactions in ${month} yet`,
    onlyTransfers: (n) =>
      `So far only ${n === 1 ? 'one internal transfer' : `${n} internal transfers`} between your own accounts – they do not count here.`,
    empty: 'Once something is booked, you can see here what came in and went out.',
    toAnalysis: 'Open analysis',
    withoutForeign: (n) => `excluding ${n} in a foreign currency`,
  },

  balanceHistory: {
    invalidRange: 'The period is invalid.',
    noBalances: 'The bank sent no balances with this request.',
    missingBalances: 'The bank did not send an opening and closing balance with every account statement.',
    currencies: 'The transactions are in more than one currency.',
    gap: 'The bank’s account statements do not follow on from one another without gaps.',
    badBooking: 'Not every transaction has a valid booking date and an amount.',
    count: 'The number of transactions does not match the bank’s account statements.',
    sum: 'The transactions do not add up to the balances the bank reports.',
    dates: 'The booking dates do not match the bank’s account statements.',
    unverified: 'There are no verified balances for this period.',
    tooLong: 'The period is too long for a balance history.',
  },

  balances: {
    quoted: (name) => `“${name}”`,
    fetchFailed: (accounts, reason) => (reason ? `Could not load ${accounts}: ${reason}` : `Could not load ${accounts}.`),
  },
};
