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
  loadBalance: 'Saldo laden',
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
    load: 'Umsätze laden',
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
    noAccountHint: 'Wähle in der Übersicht ein Konto.',
    loadFailed: 'Umsätze konnten nicht geladen werden',
    unsupported: (account: string) =>
      `Deine Bank liefert für ${account} keine Umsätze. Wähle ein anderes Konto.`,
    notLoaded: 'Umsätze noch nicht geladen',
    notLoadedHint: (account: string) =>
      `Lade die Umsätze von ${account}. Das kann eine Freigabe brauchen.`,
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
    emptyRange: (range: string, days: number) => `Geladen: ${range} (${counted(days, 'Tag', 'Tage')}).`,
    emptyRangeLonger: 'Lade einen längeren Zeitraum.',
    noSpending: 'Keine Ausgaben',
    categories: {
      title: 'Ausgaben nach Kategorie',
      empty: 'Keine Ausgaben mit Kategorie in diesem Zeitraum.',
      /** The share bar's last segment: every category after the sixth. */
      rest: (n: number) => `Weitere (${n})`,
    },
    monthly: {
      title: 'Monatsvergleich',
      asChart: 'Als Diagramm',
      asTable: 'Als Tabelle',
      partial: 'Unvollständiger Monat',
      hint: 'Wähle einen Monat, um nur ihn zu sehen.',
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
      empty: 'Keine Zahlungen an andere in diesem Zeitraum.',
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
      empty: 'In diesem Zeitraum nur Verträge, Abos und Bargeld.',
      /** "3× in diesem Zeitraum · zuletzt 28.09.2026" — `wide` gets what only wider screens show. */
      repeats: (n: number, wide: (s: string) => ReactNode, day: string): ReactNode[] => [
        `${n}×`, wide(' in diesem Zeitraum'), ` · zuletzt ${day}`,
      ],
      showThese: 'Alle in den Umsätzen zeigen',
      showOne: 'In den Umsätzen zeigen',
    },
  },

  /** Verträge & Abos (components/Contracts.tsx, components/insights/ContractRow.tsx). */
  contracts: {
    /** The section's title on the Zahlungen page. */
    title: 'Verträge & Abos',
    /** The desktop's row to them (Zahlungen): "12 erkannt · Fixkosten pro Jahr mind. 15.790 €". */
    entrySummary: (count: number, yearly: ReactNode): ReactNode[] => [`${count} erkannt · Fixkosten pro Jahr mind. `, yearly],
    entryNone: 'Noch keine regelmäßigen Zahlungen erkannt',
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
    /** A price rise within the last year (lib/recurring.ts priceChange), from the month it began. */
    roseSince: (amount: ReactNode, month: string): ReactNode[] => ['Seit ', month, ' ', amount],
    /** In the details: what the rise comes to in a year. */
    perYearMore: (amount: ReactNode): ReactNode[] => [amount, ' mehr im Jahr'],
    /** A cancellation reminder (lib/contract-watch.ts), on the row. */
    cancelBy: (day: string) => `Kündbar bis ${day}`,
    reminder: {
      set: 'Kündigungsfrist …',
      change: 'Kündigungsfrist ändern …',
      title: 'Kündigungsfrist',
      description: (name: string) => `Girovo erinnert dich, bevor du ${name} nicht mehr kündigen kannst.`,
      by: 'Kündbar bis',
      byHint: 'Der letzte Tag, an dem deine Kündigung angekommen sein muss.',
      lead: 'Erinnern',
      leads: { week: '1 Woche vorher', twoWeeks: '2 Wochen vorher', month: '1 Monat vorher' },
      notify: 'Mit „Neue Umsätze melden“ auch als Benachrichtigung.',
      save: 'Speichern',
      remove: 'Erinnerung entfernen',
      past: 'Dieser Tag ist schon vorbei.',
      missing: 'Gib den Tag an, bis zu dem du kündigen kannst.',
    },
    /** A contract the user adds from a booking (lib/manual-contracts.ts). */
    manual: {
      add: 'Vertrag hinzufügen',
      addHint: 'Aus einer Buchung, die Girovo übersehen hat',
      fromBooking: 'Als Vertrag merken',
      title: 'Als Vertrag merken',
      pickTitle: 'Vertrag hinzufügen',
      pickIntro: 'Wähle eine Buchung des Vertrags. Ähnliche vom selben Empfänger kommen dazu.',
      search: 'Buchungen durchsuchen',
      noMatches: 'Keine passende Buchung.',
      name: 'Name',
      rhythm: 'Rhythmus',
      guessed: 'Aus den Buchungen erkannt – du kannst ihn ändern.',
      found: (n: number, since: string) => (n > 1 ? `${n} Buchungen gehören dazu, die erste am ${since}.` : 'Bisher nur diese Buchung.'),
      noPayer: 'Diese Buchung hat keinen Namen – Girovo findet keine weiteren.',
      other: 'Andere Buchung',
      save: 'Hinzufügen',
      added: (name: string) => `${name} steht jetzt in Verträge & Abos.`,
      mark: 'Von dir hinzugefügt',
      remove: 'Entfernen',
      removeHint: 'Aus Verträge & Abos nehmen – die Buchungen bleiben.',
      removed: (name: string) => `${name} entfernt`,
    },
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
    noneInRange: (range: string) => `Geladen: ${range}.`,
    noRegular: 'Keine regelmäßigen Zahlungen erkannt',
    noRegularHint: (range: string) =>
      `Im Zeitraum ${range} wiederholt sich keine Zahlung regelmäßig.`,
    longerHelps: 'Ein längerer Zeitraum hilft oft.',
    regularIncome: 'Regelmäßige Eingänge',
    longerHistory: 'Längerer Verlauf',
    moreFound: 'Weitere erkannte Zahlungen',
    endedTitle: (n: number) => `Vermutlich beendet (${n})`,
    /** Beside "Vermutlich beendet" and "Ausgeblendet". */
    notInTotals: 'Nicht in den Summen',
    endedHint: 'Zwei erwartete Buchungen sind ausgeblieben.',
    hiddenTitle: (n: number) => `Ausgeblendet (${n})`,
    /** After the bank's reason. */
    cannotRecognise: 'Ohne Umsätze findet Girovo keine Verträge.',
    howItWorks: 'Girovo erkennt regelmäßige Zahlungen in deinen Umsätzen, direkt auf diesem Rechner.',
    loadHint: (account: string) => `Das Laden von ${account} kann eine Freigabe brauchen.`,
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
    otherCurrency: (n: number) => `${counted(n, 'Vertrag', 'Verträge')} in anderer Währung nicht mitgerechnet`,
    reloadAccount: (account: string) => `${account} neu laden`,
    /** After the bank's reason, when an account in scope failed. */
    failedHint: (n: number) =>
      `Die Summen kommen, sobald die Umsätze ${n === 1 ? 'dieses Kontos' : 'dieser Konten'} da sind.`,
    historyDays: (n: number) => `${counted(n, 'Tag', 'Tage')} Verlauf`,
    loading: 'wird geladen …',
    notIncluded: 'nicht enthalten',
    noFints: 'Bank liefert keine Umsätze',
    /** After a button's words, for a screen reader: "Umsätze laden für Tagesgeld". */
    forAccount: (account: string) => `für ${account}`,
    loadYear: '12 Monate laden',
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
    /** The desktop's chart of the forecast (components/insights/Forecast.tsx ForecastChart). */
    chartLabel: 'Erwarteter Kontostand bis zum Monatsende',
    /** A Vorgemerkter in what is due, which carries no name. */
    pendingName: 'Vorgemerkter Umsatz',
    /** The heading of what is due under the chart: the chart runs to the month's end. */
    dueToMonthEnd: 'Fällig bis Monatsende',
    low: (amount: ReactNode, day: string) => ['Tiefster Stand ca. ', amount, ` am ${day}`],
    zero: (day: string, amount: ReactNode) => [`Am ${day} könnte das Konto ins Minus gehen – ca. `, amount, '. Dann fallen Dispozinsen an.'],
    limit: (day: string, amount: ReactNode) => [`Am ${day} könnte der Dispo nicht reichen – ca. `, amount, '. Dann kann eine Zahlung zurückgehen.'],
    basis: 'Gerechnet aus',
    balance: 'Kontostand heute',
    pending: (n: number) => counted(n, 'Vorgemerkter Umsatz', 'Vorgemerkte Umsätze'),
    regular: (n: number) => counted(n, 'regelmäßige Zahlung', 'regelmäßige Zahlungen'),
    orders: (n: number) => counted(n, 'Auftrag deiner Bank', 'Aufträge deiner Bank'),
    usual: (months: number) => (months === 1 ? 'übliche Ausgaben des letzten Monats' : `übliche Ausgaben der letzten ${months} Monate`),
    noUsual: 'ohne übliche Ausgaben – dafür fehlt ein voller Monat',
    notToday: 'Die Prognose braucht den heutigen Kontostand.',
    hint: 'Eine Schätzung, keine Zusage. Deine Bank kann anders buchen.',
  },

  /** The one button that asks the bank for a year (components/insights/shared.tsx). */
  loadYear: {
    label: 'Umsätze für 12 Monate laden',
    /** While the Analyse counts every account: whose year it fetches. */
    labelFor: (account: string) => `Umsätze von ${account} für 12 Monate laden`,
  },

  /** The account hero: the balance and what qualifies it (components/overview/AccountHero.tsx). */
  hero: {
    loading: 'Kontostand wird geladen',
    title: (account: string) => `Konto ${account}`,
    cardBalance: 'Kartensaldo',
    balanceOn: (day: string) => `Saldo am ${day}`,
    bookingDay: (day: string) => `Buchungstag ${day}`,
    bookingDayHint:
      'Stand des nächsten Buchungstags – seine Buchungen sind schon enthalten.',
    asOf: (day: string) => `Stand ${day}`,
    creditLimit: 'Kreditrahmen',
    overdraft: 'Dispositionsrahmen',
    pendingCount: (n: number) => (n === 1 ? '1 vorgemerkter Umsatz' : `${n} vorgemerkte Umsätze`),
    /** When the pending list was fetched: "Stand 14:05 Uhr". */
    pendingAsOf: (since: string, behind: boolean) => `Stand ${since}${behind ? ', älter als die Umsatzliste' : ''}`,
    closingHint: 'Endsaldo des geladenen Zeitraums laut deiner Bank',
    /** Shows hidden amounts again. */
    show: 'Anzeigen',
    pastRange: 'Der Zeitraum endet vor heute.',
    currentFailed: (card: boolean, reason: string) =>
      `Der aktuelle ${card ? 'Kartensaldo' : 'Kontostand'} konnte nicht geladen werden: ${reason}`,
    loadCurrent: (card: boolean) => `Aktuellen ${card ? 'Kartensaldo' : 'Kontostand'} laden`,
    pastRangeHint: (card: boolean) =>
      `Für den aktuellen ${card ? 'Kartensaldo' : 'Kontostand'} lade bis heute.`,
    fetchingDots: 'Saldo wird geladen …',
    noBalanceYet: 'Noch kein Saldo geladen',
    noBalance: 'Kein Saldo verfügbar',
    noBalanceHint: 'Deine Bank meldet für dieses Konto keinen Saldo.',
    /** Before a credit card's number. */
    card: 'Karte',
    renameLabel: 'Konto umbenennen',
    nameLabel: 'Kontoname',
    nameHint:
      'Verschlüsselt auf diesem Rechner – deine Bank sieht ihn nicht. Leer lassen für den Namen der Bank.',
    historyTooShort: 'Der geladene Zeitraum ist zu kurz.',
    noHistory: 'Kein Kontoverlauf.',
    figureStands: 'Der Saldo oben kommt direkt von deiner Bank.',
    historyCaption: 'Kontostand am Ende jedes Tages, aus Umsätzen und Salden errechnet.',
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
    keys: 'Pfeiltasten: Tag wählen. Bild auf, Bild ab: eine Woche springen.',
  },

  /** How an account is named and told apart (components/overview/AccountIdentity.tsx). */
  identity: {
    vaultLoading: 'Einen Moment – gleich kannst du deine Konten umbenennen.',
    vaultError:
      'Deine Einstellungen lassen sich nicht öffnen, meist nach einer neuen PIN. Bis sie zurückgesetzt sind, kannst du keine Kontonamen speichern.',
    vaultUnavailable: 'In dieser Sitzung lassen sich keine Kontonamen speichern.',
    ibanEnds: (tail: string) => `IBAN endet auf ${tail}`,
    cardEnds: (tail: string) => `Karte endet auf ${tail}`,
    accountNumber: (number: string) => `Kontonummer ${number}`,
  },

  /** Konten und Karten: every account at once (components/overview/AccountsOverview.tsx). */
  accounts: {
    title: 'Konten und Karten',
    rename: 'Umbenennen',
    renameAll: 'Konten umbenennen',
    renameHint:
      'Eigene Namen, verschlüsselt auf diesem Rechner – deine Bank sieht sie nicht. Leer lassen für den Namen der Bank.',
    namesSaved: (n: number): string => (n === 1 ? 'Kontoname gespeichert.' : 'Kontonamen gespeichert.'),
    nameFor: (bank: string, ident: string) => `Name für ${bank}, ${ident}`,
    atBank: (bank: string) => `Bei der Bank: ${bank}`,
    none: 'Keine Konten',
    noneHint: 'Deine Bank hat für diesen Zugang keine Konten gemeldet.',
    notYet: (accounts: string) => `Noch nicht geladen: ${accounts}`,
    excludedHint: 'Nicht mitgezählt: Konten ohne Saldo, ein noch nicht geladenes Depot und Konten in anderer Währung.',
    busyApproval: 'Bitte warten – eine Freigabe läuft',
    busyFetch: 'Bitte warten – Girovo lädt von deiner Bank',
    fetching: 'Saldo wird geladen',
    total: 'Gesamtsaldo',
    incomplete: 'unvollständig',
    loadAll: 'Alle Salden laden',

    // ---- the overview, every account at once (components/overview/AccountsOverview.tsx)
    /** The groups "Nach Art", in their order. */
    groups: { giro: 'Girokonten', saving: 'Sparen & Anlegen', credit: 'Karten & Kredite', other: 'Weitere Konten' },
    all: 'Alle',
    filterLabel: 'Konten nach Art zeigen',
    /** "6 Konten bei 2 Banken" */
    count: (accounts: number, banks: number) =>
      `${accounts === 1 ? '1 Konto' : `${accounts} Konten`}${banks > 1 ? ` bei ${banks} Banken` : ''}`,
    assets: 'Vermögen',
    liabilities: 'Verbindlichkeiten',
    /** In the Gesamtsaldo's place while a balance is missing: no partial sum. */
    pending: 'Noch nicht vollständig',
    /** A row's figure that was not read in this session. */
    notFetched: 'Nicht geladen',
    /** The Gesamtsaldo's curve behind its sparkline (lib/kept-balances.ts). */
    netWorth: 'Verlauf des Gesamtsaldos',
    netWorthCaption: 'Aus den Tagen mit allen Salden, dazwischen gilt der letzte Stand.',
    /** The table's heads (from 640px). */
    columns: { account: 'Konto', last: 'Letzter Umsatz', balance: 'Kontostand' },
    /** Under a figure in the table: what kind of figure it is. */
    loanBalance: 'Restschuld',
    card: 'Karte',
    /** The account's page, a level below: the way back. */
    back: 'Alle Konten',
    /** "Konten anordnen": the sheet, and its trigger. */
    arrange: 'Konten anordnen',
    arrangeShort: 'Anordnen',
    arrangeHint: 'Halte ein Konto fest und zieh es an seinen Platz.',
    arrangeKeys: 'Mit der Tastatur: den Griff wählen, dann Pfeil hoch oder runter.',
    grouping: 'Gruppieren',
    groupings: { type: 'Nach Art', bank: 'Nach Bank', none: 'Keine' },
    /** The grip's name, and what a screen reader hears after a move. */
    move: (name: string) => `${name} verschieben`,
    moved: (name: string, place: number, of: number) => `${name}: Platz ${place} von ${of}`,
    done: 'Fertig',
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
    /** "diesem Rechner": the phone build says Telefon (phone.ts). */
    sealed: 'Verschlüsselt nur auf diesem Rechner',
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
    noBalances: 'Deine Bank hat keine Salden mitgeschickt.',
    missingBalances: 'Deine Bank hat nicht alle Salden mitgeschickt.',
    currencies: 'Die Umsätze haben mehr als eine Währung.',
    gap: 'In den Umsätzen deiner Bank fehlen Tage.',
    badBooking: 'Manchen Umsätzen fehlt ein Buchungstag oder ein Betrag.',
    count: 'Die Zahl der Umsätze stimmt nicht.',
    sum: 'Die Umsätze ergeben nicht die Salden der Bank.',
    dates: 'Die Buchungstage passen nicht zusammen.',
    unverified: 'Für diesen Zeitraum fehlen geprüfte Salden.',
    tooLong: 'Der Zeitraum ist zu lang.',
  },

  /** Reads that failed, as one sentence for a toast (lib/balances.ts). */
  balances: {
    quoted: (name: string) => `„${name}“`,
    fetchFailed: (accounts: string, reason: string | null) =>
      (reason ? `Girovo konnte ${accounts} nicht laden: ${reason}` : `Girovo konnte ${accounts} nicht laden.`),
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
    noAccountHint: 'Choose an account in the overview.',
    loadFailed: 'Could not load transactions',
    unsupported: (account) =>
      `Your bank sends no transactions for ${account}. Choose another account.`,
    notLoaded: 'Transactions not loaded yet',
    notLoadedHint: (account) => `Load the transactions of ${account}. This may need an approval.`,
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
    emptyRange: (range, days) => `Loaded: ${range} (${countedEn(days, 'day', 'days')}).`,
    emptyRangeLonger: 'Load a longer period.',
    noSpending: 'No spending',
    categories: {
      title: 'Spending by category',
      empty: 'No categorised spending in this period.',
      rest: (n) => `Others (${n})`,
    },
    monthly: {
      title: 'Monthly comparison',
      asChart: 'As a chart',
      asTable: 'As a table',
      partial: 'Incomplete month',
      hint: 'Choose a month to see just that month.',
      caption: 'Income and spending per month',
      month: 'Month',
      summary: (months) => `Bar chart: income and spending for ${countedEn(months, 'month', 'months')}`,
      peaks: (spending, income) => `Highest spending in ${spending}, highest income in ${income}.`,
      values: (income, spending) => `Income ${income}, spending ${spending}`,
    },
    payees: {
      title: 'Top payees',
      empty: 'No payments to others in this period.',
      share: (share) => `${share} of spending`,
      via: (service) => `via ${service}`,
      showCash: 'Show all withdrawals',
      showAll: (name) => `Show all transactions with ${name}`,
    },
    largest: {
      title: 'Largest single payments',
      subtitle: 'excluding contracts, subscriptions and cash',
      emptyTitle: 'No single payments',
      empty: 'Only contracts, subscriptions and cash in this period.',
      repeats: (n, wide, day) => [`${n}×`, wide(' in this period'), ` · last on ${day}`],
      showThese: 'Show all in Transactions',
      showOne: 'Show in Transactions',
    },
  },

  contracts: {
    title: 'Contracts & subscriptions',
    entrySummary: (count, yearly) => [`${count} found · fixed costs at least `, yearly, ' a year'],
    entryNone: 'No regular payments found yet',
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
    roseSince: (amount, month) => ['Since ', month, ' ', amount],
    perYearMore: (amount) => [amount, ' more per year'],
    cancelBy: (day) => `Cancel by ${day}`,
    reminder: {
      set: 'Notice period…',
      change: 'Change notice period…',
      title: 'Notice period',
      description: (name) => `Girovo reminds you before you can no longer cancel ${name}.`,
      by: 'Cancel by',
      byHint: 'The last day your cancellation must have arrived.',
      lead: 'Remind me',
      leads: { week: '1 week before', twoWeeks: '2 weeks before', month: '1 month before' },
      notify: 'With “Report new transactions” on, also as a notification.',
      save: 'Save',
      remove: 'Remove reminder',
      past: 'This day has already passed.',
      missing: 'Enter the day you can cancel by.',
    },
    manual: {
      add: 'Add a contract',
      addHint: 'From a transaction Girovo missed',
      fromBooking: 'Save as contract',
      title: 'Save as contract',
      pickTitle: 'Add a contract',
      pickIntro: 'Choose one of the contract’s transactions. Similar ones from the same payee are added.',
      search: 'Search transactions',
      noMatches: 'No matching transaction.',
      name: 'Name',
      rhythm: 'Frequency',
      guessed: 'Read from the transactions – you can change it.',
      found: (n, since) => (n > 1 ? `${n} transactions belong to it, the first on ${since}.` : 'Only this transaction so far.'),
      noPayer: 'This transaction has no name – Girovo can’t find others.',
      other: 'Another transaction',
      save: 'Add',
      added: (name) => `${name} is now in Contracts & subscriptions.`,
      mark: 'Added by you',
      remove: 'Remove',
      removeHint: 'Take it out of Contracts & subscriptions – the transactions stay.',
      removed: (name) => `${name} removed`,
    },
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
    noneInRange: (range) => `Loaded: ${range}.`,
    noRegular: 'No regular payments recognised',
    noRegularHint: (range) =>
      `No payment repeats regularly in the period ${range}.`,
    longerHelps: 'A longer period often helps.',
    regularIncome: 'Regular incoming payments',
    longerHistory: 'Longer history',
    moreFound: 'Other recognised payments',
    endedTitle: (n) => `Probably ended (${n})`,
    notInTotals: 'Not in the totals',
    endedHint: 'Two expected transactions have not arrived.',
    hiddenTitle: (n) => `Hidden (${n})`,
    cannotRecognise: 'Without transactions, Girovo can’t find contracts.',
    howItWorks: 'Girovo spots regular payments in your transactions, right on this computer.',
    loadHint: (account) => `Loading ${account} may need an approval.`,
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
    otherCurrency: (n) => `${countedEn(n, 'contract', 'contracts')} in another currency not included`,
    reloadAccount: (account) => `Load ${account} again`,
    failedHint: (n) =>
      `The totals appear once ${n === 1 ? 'this account’s' : 'these accounts’'} transactions are in.`,
    historyDays: (n) => `${countedEn(n, 'day', 'days')} of history`,
    loading: 'loading…',
    notIncluded: 'not included',
    noFints: 'bank sends no transactions',
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
    chartLabel: 'Expected balance to the end of the month',
    pendingName: 'Pending transaction',
    dueToMonthEnd: 'Due by the end of the month',
    low: (amount, day) => ['Lowest approx. ', amount, ` on ${day}`],
    zero: (day, amount) => [`On ${day} the account could go overdrawn – approx. `, amount, '. Overdraft interest then applies.'],
    limit: (day, amount) => [`On ${day} the overdraft may not be enough – approx. `, amount, '. A payment could then be returned.'],
    basis: 'Worked out from',
    balance: 'today’s balance',
    pending: (n) => countedEn(n, 'pending transaction', 'pending transactions'),
    regular: (n) => countedEn(n, 'regular payment', 'regular payments'),
    orders: (n) => countedEn(n, 'order at your bank', 'orders at your bank'),
    usual: (months) => `usual spending of the last ${months === 1 ? 'month' : `${months} months`}`,
    noUsual: 'without usual spending – that needs a full month',
    notToday: 'The forecast needs today’s balance.',
    hint: 'An estimate, not a promise. Your bank may book differently.',
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
    bookingDayHint: 'As of the next booking date – its transactions are already included.',
    asOf: (day) => `As of ${day}`,
    creditLimit: 'Credit limit',
    overdraft: 'Overdraft limit',
    pendingCount: (n) => (n === 1 ? '1 pending transaction' : `${n} pending transactions`),
    pendingAsOf: (since, behind) => `as of ${since}${behind ? ', older than the transaction list' : ''}`,
    closingHint: 'Closing balance of the loaded period, according to your bank',
    show: 'Show',
    pastRange: 'The period ends before today.',
    currentFailed: (card, reason) => `Could not load the current ${card ? 'card balance' : 'balance'}: ${reason}`,
    loadCurrent: (card) => `Load current ${card ? 'card balance' : 'balance'}`,
    pastRangeHint: (card) =>
      `For the current ${card ? 'card balance' : 'balance'}, load up to today.`,
    fetchingDots: 'Loading balance…',
    noBalanceYet: 'No balance loaded yet',
    noBalance: 'No balance available',
    noBalanceHint: 'Your bank reports no balance for this account.',
    card: 'Card',
    renameLabel: 'Rename account',
    nameLabel: 'Account name',
    nameHint:
      'Encrypted on this computer – your bank never sees it. Leave it empty for the bank’s name.',
    historyTooShort: 'The loaded period is too short.',
    noHistory: 'No balance history.',
    figureStands: 'The balance above comes straight from your bank.',
    historyCaption: 'Balance at the end of each day, worked out from transactions and balances.',
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
    keys: 'Arrow keys: choose a day. Page Up, Page Down: jump a week.',
  },

  identity: {
    vaultLoading: 'One moment – you can rename your accounts shortly.',
    vaultError:
      'Your settings can’t be opened, usually after a new PIN. Until they are reset, you can’t save account names.',
    vaultUnavailable: 'Account names can’t be saved in this session.',
    ibanEnds: (tail) => `IBAN ending in ${tail}`,
    cardEnds: (tail) => `Card ending in ${tail}`,
    accountNumber: (number) => `Account number ${number}`,
  },

  accounts: {
    title: 'Accounts and cards',
    rename: 'Rename',
    renameAll: 'Rename accounts',
    renameHint:
      'Your own names, encrypted on this computer – your bank never sees them. Leave one empty for the bank’s name.',
    namesSaved: (n) => (n === 1 ? 'Account name saved.' : 'Account names saved.'),
    nameFor: (bank, ident) => `Name for ${bank}, ${ident}`,
    atBank: (bank) => `At the bank: ${bank}`,
    none: 'No accounts',
    noneHint: 'Your bank reported no accounts for this access.',
    notYet: (accounts) => `Not loaded yet: ${accounts}`,
    excludedHint: 'Not counted: accounts without a balance, a securities account not loaded yet and accounts in another currency.',
    busyApproval: 'Please wait – an approval is in progress',
    busyFetch: 'Please wait – loading from your bank',
    fetching: 'Loading balance',
    total: 'Total balance',
    incomplete: 'incomplete',
    loadAll: 'Load all balances',

    groups: { giro: 'Current accounts', saving: 'Savings & investments', credit: 'Cards & loans', other: 'Other accounts' },
    all: 'All',
    filterLabel: 'Show accounts by type',
    count: (accounts, banks) =>
      `${accounts === 1 ? '1 account' : `${accounts} accounts`}${banks > 1 ? ` at ${banks} banks` : ''}`,
    assets: 'Assets',
    liabilities: 'Liabilities',
    pending: 'Not complete yet',
    notFetched: 'Not loaded',
    netWorth: 'Total balance over time',
    netWorthCaption: 'From the days with every balance; in between, the last one counts.',
    columns: { account: 'Account', last: 'Latest transaction', balance: 'Balance' },
    loanBalance: 'Outstanding',
    card: 'Card',
    back: 'All accounts',
    arrange: 'Arrange accounts',
    arrangeShort: 'Arrange',
    arrangeHint: 'Hold an account and drag it into place.',
    arrangeKeys: 'With the keyboard: pick the handle, then the up or down arrow.',
    grouping: 'Group',
    groupings: { type: 'By type', bank: 'By bank', none: 'None' },
    move: (name) => `Move ${name}`,
    moved: (name, place, of) => `${name}: position ${place} of ${of}`,
    done: 'Done',
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
    sealed: 'Encrypted, only on this computer',
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
    noBalances: 'Your bank sent no balances.',
    missingBalances: 'Your bank didn’t send every balance.',
    currencies: 'The transactions are in more than one currency.',
    gap: 'Days are missing from your bank’s transactions.',
    badBooking: 'Some transactions lack a booking date or an amount.',
    count: 'The number of transactions doesn’t match.',
    sum: 'The transactions don’t add up to the bank’s balances.',
    dates: 'The booking dates don’t match up.',
    unverified: 'Checked balances are missing for this period.',
    tooLong: 'The period is too long.',
  },

  balances: {
    quoted: (name) => `“${name}”`,
    fetchFailed: (accounts, reason) => (reason ? `Could not load ${accounts}: ${reason}` : `Could not load ${accounts}.`),
  },
};
