// Analyse and Verträge & Abos (components/Analysis, components/insights, components/Contracts), and the overview: account hero, account list, month summary, balance chart (components/overview).
// Also the words lib/analytics, lib/recurring, lib/balances and lib/balance-history put on screen.

import type { ReactNode } from 'react';
import type { Cadence } from '../../recurring';
import { INTL_LOCALES } from '../locale.ts';

/** "103 Umsätze": a count and its noun, joined by a no-break space so they never wrap apart. */
const counted = (n: number, one: string, many: string) =>
  `${n.toLocaleString(INTL_LOCALES.de)}\u00a0${n === 1 ? one : many}`;

export const de = {
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
    transfersLeftOut: (n: number) => `${counted(n, 'Umbuchung', 'Umbuchungen')} nicht mitgezählt`,
    firstBooking: (day: string) => `erste Buchung am ${day}`,
    commonPeriod: 'Zeitraum, den alle Konten abdecken',
    otherCurrencyAccounts: (n: number) => `${counted(n, 'Konto', 'Konten')} in anderer Währung nicht enthalten`,
    foreignBookings: (n: number) => `${counted(n, 'Umsatz', 'Umsätze')} in Fremdwährung nicht enthalten`,
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
    /** Under "Keine Umsätze im geladenen Zeitraum": which period that is. */
    emptyRange: (range: string, days: number) => `Geladen ist der Zeitraum ${range} (${counted(days, 'Tag', 'Tage')}).`,
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
      empty: 'In diesem Zeitraum ist kein Geld an andere gegangen.',
      share: (share: string) => `${share} der Ausgaben`,
      /** The payment service a shop was paid through. */
      via: (service: string) => `über ${service}`,
      showCash: 'Alle Abhebungen anzeigen',
      showAll: (name: string) => `Alle Umsätze mit ${name} anzeigen`,
    },
    largest: {
      title: 'Größte Einzelausgaben',
      subtitle: 'ohne Verträge, Abos und Bargeld',
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
    /** The section's title on the Zahlungen page. */
    title: 'Verträge & Abos',
    /** The tab, for a screen reader. */
    label: 'Verträge und Abos',
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
      /** In the "Vermutlich beendet" group, which already says why. */
      endedCompact: (day: string) => `Zuletzt am ${day}`,
      last: (day: string) => `Zuletzt ${day}`,
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
    dismiss: 'Ausblenden',
    dismissHint: 'Aus dieser Liste und den Summen nehmen',
    dismissed: (name: string) => `„${name}“ ausgeblendet.`,
    undo: 'Rückgängig',
    since: (n: number, day: string) => `${n} Buchungen seit ${day}`,
    byDirectDebit: 'per Lastschrift',
    varies: 'Betrag schwankt',
    mandate: 'Mandatsreferenz',
    restore: 'Wieder anzeigen',
    /** Read after "Wieder anzeigen": which series comes back. */
    restoreWhich: (name: string) => ` – ${name}`,
    noneFound: 'Keine Verträge erkannt',
    /** Under "Keine Umsätze im geladenen Zeitraum": which period that is. */
    noneInRange: (range: string) => `Geladen ist der Zeitraum ${range}.`,
    noRegular: 'Keine regelmäßigen Zahlungen erkannt',
    noRegularHint: (range: string) =>
      `Im Zeitraum ${range} wiederholt sich keine Zahlung oft und gleichmäßig genug, um sie als Vertrag zu erkennen.`,
    longerHelps: 'Mit einem längeren Verlauf klappt das oft besser.',
    regularIncome: 'Regelmäßige Eingänge',
    longerHistory: 'Längerer Verlauf',
    moreFound: 'Weitere erkannte Zahlungen',
    endedTitle: (n: number) => `Vermutlich beendet (${n})`,
    /** Beside "Vermutlich beendet" and "Ausgeblendet". */
    notInTotals: 'Nicht in den Summen',
    endedHint: 'Zwei erwartete Buchungen sind ausgeblieben.',
    hiddenTitle: (n: number) => `Ausgeblendet (${n})`,
    /** After the bank's reason. */
    cannotRecognise: 'Ohne Umsätze lassen sich keine Verträge erkennen.',
    howItWorks: 'Regelmäßige Zahlungen erkennt die App auf diesem Rechner in den Umsätzen deiner Konten.',
    loadHint: (account: string) => `Das Abrufen der Umsätze von ${account} kann eine Freigabe erfordern.`,
    summary: 'Zusammenfassung',
    /** Under a monthly figure: "pro Monat · 3 Verträge". */
    perMonthWith: (what: string) => `pro Monat · ${what}`,
    /** Everything but Wohnen & Energie, when that has a figure of its own. */
    subscriptions: 'Übrige Fixkosten',
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
    projected: 'hochgerechnet aus dem Rhythmus',
    excluded: 'Umbuchungen und Bargeld nicht mitgezählt',
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
    /** "GiroKomfort und Visa reichen 91 Tage zurück". */
    reach: (accounts: string, several: boolean, days: number) =>
      `${accounts} ${several ? 'reichen' : 'reicht'} ${counted(days, 'Tag', 'Tage')} zurück`,
    noneRecognised: 'Keine regelmäßigen erkannt',
    recognising: 'Verträge werden erkannt …',
  },

  /** Demnächst fällig, the overview's tile of what the next 30 days bring (components/Contracts.tsx). */
  /** Where the balance is heading by the month's end (lib/forecast.ts, components/insights/Forecast.tsx). */
  forecast: {
    /** "Ende Oktober" — the month's name as the language writes it. */
    title: (month: string) => `Kontostand Ende ${month}`,
    estimate: 'Prognose',
    approx: 'ca.',
    low: (amount: ReactNode, day: string) => ['Tiefster Stand ca. ', amount, ` am ${day}`],
    zero: (day: string, amount: ReactNode) => [`Am ${day} könnte das Konto ins Minus rutschen – auf ca. `, amount, '. Im Dispo fallen Sollzinsen an.'],
    limit: (day: string, amount: ReactNode) => [`Am ${day} könnte der Dispositionsrahmen nicht reichen – ca. `, amount, '. Eine Zahlung könnte dann zurückgehen.'],
    basis: 'Gerechnet aus',
    balance: 'Kontostand heute',
    pending: (n: number) => counted(n, 'Vorgemerkter Umsatz', 'Vorgemerkte Umsätze'),
    regular: (n: number) => counted(n, 'regelmäßige Zahlung', 'regelmäßige Zahlungen'),
    orders: (n: number) => counted(n, 'Auftrag deiner Bank', 'Aufträge deiner Bank'),
    usual: (months: number) => (months === 1 ? 'übliche Ausgaben des letzten Monats' : `übliche Ausgaben der letzten ${months} Monate`),
    noUsual: 'ohne übliche Ausgaben – dafür fehlt noch ein ganzer geladener Monat',
    notToday: 'Für eine Prognose braucht es den heutigen Kontostand.',
    hint: 'Eine Schätzung aus deinen Umsätzen, keine Zusage: Was die Bank bucht, kann abweichen.',
  },

  /** The one button that asks the bank for a year (components/insights/shared.tsx). */
  loadYear: {
    label: 'Umsätze für 12 Monate abrufen',
    /** While the Analyse counts every account: whose year it fetches. */
    labelFor: (account: string) => `Umsätze von ${account} für 12 Monate abrufen`,
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
    total: 'Gesamtsaldo',
    incomplete: 'unvollständig',
    loadAll: 'Alle Salden abrufen',
  },

  /** Sparziele (components/overview/SavingsGoal.tsx, lib/savings-goal.ts). */
  goals: {
    title: 'Sparziele',
    set: 'Sparziel setzen',
    edit: 'Sparziel ändern',
    intro: (account: string) => `Für ${account}. Der Kontostand ist der Fortschritt.`,
    name: 'Name',
    target: 'Zielbetrag',
    by: 'Bis wann? (optional)',
    nameInvalid: 'Gib dem Ziel einen Namen.',
    targetInvalid: 'Gib einen Betrag über 0 an.',
    perMonth: (amount: ReactNode): ReactNode[] => ['Das sind ', amount, ' im Monat'],
    perMonthDetail: (left: ReactNode, months: number): ReactNode[] =>
      ['noch ', left, months === 1 ? ' in einem Monat' : ` in ${months} Monaten`],
    sealed: 'Verschlüsselt nur auf diesem Telefon',
    save: 'Speichern',
    remove: 'Sparziel löschen',
    missing: (amount: ReactNode): ReactNode[] => ['noch ', amount],
    reached: 'Erreicht',
    /** "Plan: 98 € im Monat bis Juni 2027 · Monat 9 von 17" */
    plan: (amount: ReactNode, month: string, current: number, months: number): ReactNode[] =>
      ['Plan: ', amount, ` im Monat bis ${month} · Monat ${current} von ${months}`],
    share: (percent: number) => `${percent} % erreicht`,
    shareSaid: (percent: number) => `Fortschritt: ${percent} Prozent`,
    due: 'Der Termin ist vorbei.',
  },

  /** The line of figures under the balance on a wide window (components/overview/MonthFigures.tsx). */
  monthFigures: {
    /** "Eingänge 1.–24. Oktober": the days of this month the loaded Umsätze cover. */
    income: (days: string) => `Eingänge ${days}`,
    spending: (days: string) => `Ausgänge ${days}`,
    due: 'Demnächst fällig, 30 Tage',
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
    transfersLeftOut: (n) => `${countedEn(n, 'internal transfer', 'internal transfers')} not counted`,
    firstBooking: (day) => `first transaction on ${day}`,
    commonPeriod: 'the period all accounts cover',
    otherCurrencyAccounts: (n) => `${countedEn(n, 'account', 'accounts')} in another currency not included`,
    foreignBookings: (n) => `${countedEn(n, 'transaction', 'transactions')} in a foreign currency not included`,
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
    emptyRange: (range, days) => `The loaded period is ${range} (${countedEn(days, 'day', 'days')}).`,
    emptyRangeLonger: 'With a longer history there may be something to analyse.',
    noSpending: 'No spending',
    categories: {
      title: 'Spending by category',
      empty: 'There is no spending in this period that can be put into a category.',
      rest: (n) => `Others (${n})`,
    },
    monthly: {
      title: 'Monthly comparison',
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
      empty: 'No money went to anyone else in this period.',
      share: (share) => `${share} of spending`,
      via: (service) => `via ${service}`,
      showCash: 'Show all withdrawals',
      showAll: (name) => `Show all transactions with ${name}`,
    },
    largest: {
      title: 'Largest single payments',
      subtitle: 'excluding contracts, subscriptions and cash',
      emptyTitle: 'No single payments',
      empty: 'Apart from contracts, subscriptions and cash, there is no spending in this period.',
      repeats: (n, wide, day) => [`${n}×`, wide(' in this period'), ` · last on ${day}`],
      showThese: 'Show these in Transactions',
      showOne: 'Show in Transactions',
    },
  },

  contracts: {
    title: 'Contracts & subscriptions',
    label: 'Contracts and subscriptions',
    otherContracts: 'Other contracts',
    columns: {
      contract: 'Contract',
      next: 'Next transaction',
      nextIncoming: 'Next incoming payment',
      perYear: 'Per year',
    },
    due: {
      endedCompact: (day) => `Last on ${day}`,
      last: (day) => `Last on ${day}`,
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
    dismiss: 'Hide',
    dismissHint: 'Take it out of this list and the totals',
    dismissed: (name) => `“${name}” hidden.`,
    undo: 'Undo',
    since: (n, day) => `${n} transactions since ${day}`,
    byDirectDebit: 'by direct debit',
    varies: 'amount varies',
    mandate: 'Mandate reference',
    restore: 'Show again',
    restoreWhich: (name) => ` – ${name}`,
    noneFound: 'No contracts recognised',
    noneInRange: (range) => `The loaded period is ${range}.`,
    noRegular: 'No regular payments recognised',
    noRegularHint: (range) =>
      `In the period ${range}, no payment repeats often and evenly enough to be recognised as a contract.`,
    longerHelps: 'A longer history often works better.',
    regularIncome: 'Regular incoming payments',
    longerHistory: 'Longer history',
    moreFound: 'Other recognised payments',
    endedTitle: (n) => `Probably ended (${n})`,
    notInTotals: 'Not in the totals',
    endedHint: 'Two expected transactions have not arrived.',
    hiddenTitle: (n) => `Hidden (${n})`,
    cannotRecognise: 'Without transactions, no contracts can be recognised.',
    howItWorks: 'The app recognises regular payments in your accounts’ transactions, on this computer.',
    loadHint: (account) => `Loading the transactions of ${account} may need approval.`,
    summary: 'Summary',
    perMonthWith: (what) => `per month · ${what}`,
    subscriptions: 'Other fixed costs',
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
    projected: 'projected from how often they recur',
    excluded: 'Internal transfers and cash not counted',
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
    reach: (accounts, several, days) => `${accounts} ${several ? 'go' : 'goes'} back ${countedEn(days, 'day', 'days')}`,
    noneRecognised: 'No regular ones recognised',
    recognising: 'Recognising contracts…',
  },

  forecast: {
    title: (month) => `Balance at the end of ${month}`,
    estimate: 'Forecast',
    approx: 'approx.',
    low: (amount, day) => ['Lowest approx. ', amount, ` on ${day}`],
    zero: (day, amount) => [`On ${day} the account could go overdrawn – to approx. `, amount, '. Overdraft interest applies.'],
    limit: (day, amount) => [`On ${day} the overdraft limit may not be enough – approx. `, amount, '. A payment could then be returned.'],
    basis: 'Worked out from',
    balance: 'today’s balance',
    pending: (n) => countedEn(n, 'pending transaction', 'pending transactions'),
    regular: (n) => countedEn(n, 'regular payment', 'regular payments'),
    orders: (n) => countedEn(n, 'order at your bank', 'orders at your bank'),
    usual: (months) => `usual spending of the last ${months === 1 ? 'month' : `${months} months`}`,
    noUsual: 'without usual spending – that needs a whole loaded month',
    notToday: 'A forecast needs today’s balance.',
    hint: 'An estimate from your transactions, not a promise: what the bank books may differ.',
  },

  loadYear: {
    label: 'Load 12 months of transactions',
    labelFor: (account) => `Load 12 months of transactions for ${account}`,
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
    total: 'Total balance',
    incomplete: 'incomplete',
    loadAll: 'Load all balances',
  },

  goals: {
    title: 'Savings goals',
    set: 'Set a savings goal',
    edit: 'Change savings goal',
    intro: (account) => `For ${account}. The balance is the progress.`,
    name: 'Name',
    target: 'Target',
    by: 'By when? (optional)',
    nameInvalid: 'Give the goal a name.',
    targetInvalid: 'Enter an amount above 0.',
    perMonth: (amount) => ['That is ', amount, ' a month'],
    perMonthDetail: (left, months) => ['', left, months === 1 ? ' to go in one month' : ` to go in ${months} months`],
    sealed: 'Encrypted, only on this phone',
    save: 'Save',
    remove: 'Delete savings goal',
    missing: (amount) => [amount, ' to go'],
    reached: 'Reached',
    plan: (amount, month, current, months) => ['Plan: ', amount, ` a month until ${month} · month ${current} of ${months}`],
    share: (percent) => `${percent}% reached`,
    shareSaid: (percent) => `Progress: ${percent} percent`,
    due: 'The date has passed.',
  },

  monthFigures: {
    income: (days) => `Money in ${days}`,
    spending: (days) => `Money out ${days}`,
    due: 'Due in the next 30 days',
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
