// Umsätze: the list, its filters and periods, a booking's detail, pending entries, exports (CSV, PDF) and the printed Kontoauszug, Buchungsbeleg and bank message (components/Transactions, components/transactions, components/Statement).

import type { ReactNode } from 'react';

const nDe = (n: number) => n.toLocaleString('de-DE');
const nEn = (n: number) => n.toLocaleString('en-GB');

/**
 * A label inside a sentence: "Payment reference" → "payment reference". An
 * acronym ("IBAN", "BIC") and a one-word term ("Primanota") stay as they are.
 */
const lowerFirst = (s: string) => (/^\p{Lu}\p{Ll}\S*\s/u.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

export const de = {
  /** "1 Umsatz", "1.234 Umsätze". */
  count: (n: number) => `${nDe(n)} ${n === 1 ? 'Umsatz' : 'Umsätze'}`,
  refresh: 'Aktualisieren',
  notFetched: 'Noch nicht geladen',
  /** A booking whose Buchungstag is still ahead: the bank has sent it and books it on that day. */
  notBooked: 'Noch nicht gebucht',
  /** Where a booking stands, in a word: the receipt's state line, a row's note, beside a date. */
  state: {
    booked: 'gebucht',
    pending: 'vorgemerkt',
    ahead: 'noch nicht gebucht',
  },
  /** A time of day as a sentence ends it: "14:32 Uhr". */
  clock: (time: string) => `${time} Uhr`,
  /** The payment service a purchase went through: "über PayPal". */
  via: (name: string) => `über ${name}`,
  /** A booking with neither a name nor a booking text. */
  fallbackName: 'Buchung',
  category: 'Kategorie',
  chooseCategory: 'Kategorie wählen',
  entryDate: 'Buchungstag',
  valueDate: 'Wertstellung',
  sum: 'Summe',

  /** The Umsätze tile (components/Transactions.tsx). */
  list: {
    busy: 'Geht, sobald Girovo fertig ist.',
    loadingRange: (range: string) => `Lädt ${range} …`,
    /** Leads to the Vorgemerkt panel, which the filter also reaches. */
    pendingMatch: (n: number) =>
      (n === 1 ? 'Außerdem passt 1 vorgemerkter Umsatz' : `Außerdem passen ${n} vorgemerkte Umsätze`),
    noStatements: 'Keine Umsätze für dieses Konto',
    noStatementsBody: 'Deine Bank liefert für dieses Konto keine Umsätze.',
    loading: 'Umsätze werden geladen.',
    loadFailed: 'Umsätze konnten nicht geladen werden',
    notFetched: 'Umsätze noch nicht geladen',
    fetch: 'Umsätze laden',
    empty: 'Keine Umsätze in diesem Zeitraum',
    longerPeriod: 'Ein längerer Zeitraum zeigt vielleicht mehr.',
    noMatches: 'Keine passenden Umsätze',
    resetFilters: 'Filter zurücksetzen',
    /** A search word, quoted back by the empty list. */
    quote: (word: string) => `„${word}“`,
    inLoaded: 'im geladenen Zeitraum',
    inLoadedRange: (range: ReactNode) => ['im geladenen Zeitraum (', range, ')'],
    /** `words`: the search words that found nothing, quoted and listed; `where`: inLoaded or inLoadedRange. */
    notFound: (words: string, count: number, where: ReactNode) =>
      [words, count === 1 ? ' kommt ' : ' kommen ', where, ' in keinem Umsatz vor.'],
    allWordsApart: (query: string) => `Kein Umsatz enthält alle Wörter von „${query}“.`,
    otherFilters: (query: string) => `„${query}“ findet Umsätze, aber keinen mit diesen Filtern.`,
    noneInPeriod: 'Kein Umsatz im Zeitraum passt zu diesen Filtern.',
    refresh: 'Umsätze aktualisieren.',
    /** The latest fetch failed; the list still shows the one before. */
    failedKeptOld: (error: string) => `Aktualisieren fehlgeschlagen: ${error} Du siehst den letzten Stand.`,
    switchTo: (account: string) => `Zu „${account}“ wechseln`,
    /** A transfer whose status is unclear went out from another account than the one shown. */
    sentFromOther: (from: string, shown: string) =>
      `Ob die Überweisung ausgeführt wurde, siehst du nur in „${from}“, nicht in „${shown}“.`,
    belongsToOther: (owner: string, shown: string) => `Der Umsatz gehört zu „${owner}“. Diese Liste zeigt „${shown}“.`,
    /** The list was fetched before a transfer whose status is unclear. */
    fetchedBeforeTransfer: (time: ReactNode) =>
      ['Stand ', time, ' Uhr, vor deiner Überweisung. Sie kann hier noch nicht stehen.'],
    acrossAccounts: (account: string) =>
      `Die Analyse zählt alle Konten, diese Liste zeigt nur ${account}.`,
    /** While a filter is set: "12 von 240 Umsätzen". */
    countOf: (shown: number, total: number) => `${nDe(shown)} von ${nDe(total)} ${total === 1 ? 'Umsatz' : 'Umsätzen'}`,
    otherCurrency: (n: number) => `${n} in anderer Währung nicht mitgerechnet`,
    reset: 'Zurücksetzen',
    incomeTotal: 'Summe der Eingänge',
    expenseTotal: 'Summe der Ausgänge',
    /** Search words that were also read as a month: "„mai“ auch als Monat Mai gesucht". */
    monthWords: (words: readonly { text: string; month: string | null }[]) =>
      `${words.map((w) => `„${w.text}“ auch als Monat ${w.month}`).join(', ')} gesucht`,
  },

  /** Search, direction chips, category and month (components/transactions/TxFilterBar.tsx). */
  filter: {
    searchLabel: 'Umsätze durchsuchen',
    clear: 'Suche leeren',
    direction: 'Richtung',
    all: 'Alle',
    categoryIs: (label: string) => `Kategorie: ${label}`,
    allCategories: 'Alle Kategorien',
    month: 'Monat',
    daysAre: (days: string) => `Zeitraum der Liste: ${days}`,
    chooseMonth: 'Monat wählen',
    wholePeriod: 'Ganzer geladener Zeitraum',
    monthsInPeriod: 'Monate im geladenen Zeitraum',
    /** The cross beside a chosen month: "September 2026 entfernen". */
    remove: (what: string) => `${what} entfernen`,
  },

  /** Which period the list asks the bank for (components/transactions/PeriodControl.tsx). */
  period: {
    /** Each preset in the menu, and shorter on its button. */
    presets: {
      '30d': { label: 'Letzte 30 Tage', short: '30 Tage' },
      '90d': { label: 'Letzte 90 Tage', short: '90 Tage' },
      thisMonth: { label: 'Dieser Monat', short: 'Dieser Monat' },
      lastMonth: { label: 'Letzter Monat', short: 'Letzter Monat' },
      thisYear: { label: 'Dieses Jahr', short: 'Dieses Jahr' },
      '365d': { label: 'Letzte 12 Monate', short: '12 Monate' },
    },
    title: 'Zeitraum',
    /** The button's name, and the line an empty list starts with: "Zeitraum: 05.07.–03.10.2026". */
    is: (label: string) => `Zeitraum: ${label}`,
    choose: 'Zeitraum wählen',
    custom: 'Eigener Zeitraum',
    customMenu: 'Eigener Zeitraum …',
    busy: 'Bitte warte, bis Girovo fertig ist.',
    /** The menu's heading, and the custom range's button. */
    load: 'Zeitraum laden',
    startAfterEnd: 'Der Beginn liegt nach dem Ende.',
    startInFuture: 'Der Beginn liegt in der Zukunft.',
    endInFuture: 'Höchstens bis heute.',
    from: 'Von',
    to: 'Bis',
    longerHistory: 'Kann eine Freigabe erfordern. Manche Banken liefern weniger Verlauf.',
  },

  /** The export menu on the list (components/transactions/ExportMenu.tsx). */
  exportMenu: {
    label: 'Umsätze exportieren',
    button: 'Export',
    nothing: 'Keine Umsätze im Zeitraum',
    forExcel: (count: string) => `${count} · für Excel`,
    all: 'Alle Umsätze als CSV',
    noFilter: 'Kein Filter aktiv',
    filterEmpty: 'Der Filter zeigt keine Umsätze',
    filtered: 'Gefilterte Umsätze als CSV',
  },

  /** The Vorgemerkt panel (components/transactions/PendingPanel.tsx). */
  pending: {
    allBooked: 'Inzwischen alles gebucht',
    none: 'Deine Bank meldet nichts Vorgemerktes',
    /** How fresh the list is; `since` from fmtSince ("14:32 Uhr"). */
    asOf: (since: string) => `Stand ${since}`,
    /** After asOf, when the bookings beside the list are newer. */
    behindStatement: ', älter als die Umsatzliste',
    bookedSince: (n: number) => `${n} inzwischen gebucht`,
    matches: (n: number) => (n === 1 ? '1 passt zu deiner Suche' : `${n} passen zu deiner Suche`),
    loadingShort: 'Wird geladen …',
    refresh: 'Vorgemerkte Umsätze aktualisieren.',
    loading: 'Vorgemerkte Umsätze werden geladen.',
    intro: 'Angekündigte Lastschriften und Kartenzahlungen, noch nicht gebucht.',
    fetch: 'Vorgemerkte Umsätze laden',
    showLess: 'Weniger anzeigen',
    showAll: (n: number) => `Alle ${n} anzeigen`,
  },

  /** The list, one section per day (components/transactions/TxList.tsx). */
  days: {
    skip: 'Liste überspringen',
    future: 'Buchungstag in der Zukunft. Die Bank bucht sie erst dann.',
    /** Before the day's closing balance on a phone, where "Kontostand" does not fit. */
    balanceShort: 'Stand',
    /** For a screen reader, after "Kontostand". */
    endOfDay: 'am Tagesende:',
    /** For a screen reader, before the day's sum. */
    dayTotal: 'Summe des Tages:',
    end: 'Ende der Umsatzliste',
    shownOf: (shown: number, total: number) => `${shown} von ${total} angezeigt`,
    more: (n: number) => `Weitere ${n} anzeigen`,
  },

  /** A row's small print (components/transactions/model.ts rowNote, TxRow.tsx). */
  row: {
    entryDate: (date: string) => `Buchungstag ${date}`,
    valueDate: (date: string) => `Wertstellung ${date}`,
    /** Under the amount: the day the money really moved. */
    value: (day: string) => `Wert ${day}`,
    /** Under the amount: a Buchungstag still ahead. */
    booking: (day: string) => `Buchung ${day}`,
    /** Over a name the app tidied: what the bank's answer said (TxRow.tsx). */
    perBank: (name: string) => `Laut Bank: ${name}`,
  },

  /** How the list's second line names a card payment (model.ts). */
  card: {
    creditCard: 'Kreditkarte',
    debitCard: 'Debitkarte',
    payment: 'Kartenzahlung',
    credit: 'Kartengutschrift',
    /** A card payment refunded: "Gutschrift · Visa Debit". */
    creditVia: (card: string) => `Gutschrift · ${card}`,
    foreignCurrency: (currency: string) => `Fremdwährung ${currency}`,
    /** A cash machine's record: "Geldautomat · 17.09., 15:55". */
    atm: (day: string, time: string) => `Geldautomat · ${day}, ${time}`,
  },

  /** The kind of booking, as a tag in the drawer names it (lib/categorize.ts BookingKind). */
  kinds: {
    lastschrift: 'Lastschrift',
    karte: 'Kartenzahlung',
    gutschrift: 'Gutschrift',
    ueberweisung: 'Überweisung',
    echtzeit: 'Echtzeitüberweisung',
    dauerauftrag: 'Dauerauftrag',
    bargeld: 'Bargeld',
    entgelt: 'Entgelt',
    zinsen: 'Zinsen',
    ruecklastschrift: 'Rücklastschrift',
    gehalt: 'Gehalt/Rente',
    sonstige: 'Buchung',
  },

  /** The identifiers a booking carries (model.ts referenceRows, lib/print-doc.ts bookingReferences). */
  refs: {
    title: 'Referenzen',
    e2e: 'End-to-End-Referenz',
    mandate: 'Mandatsreferenz',
    customer: 'Kundenreferenz',
    bank: 'Bankreferenz',
    primanota: 'Primanota',
    statementNo: 'Auszug-Nr.',
    code: 'Geschäftsvorfall-Code',
    extra: 'Zusatzinformation',
    original: 'Verwendungszweck (Original)',
  },

  /** The payment reference "Zurücküberweisen" prefills (model.ts transferSeeds). */
  seeds: {
    refund: (purpose: string) => `Rückzahlung: ${purpose}`,
    refundDated: (date: string) => `Rückzahlung vom ${date}`,
  },

  /** Umsatzdetails, the drawer (components/transactions/TxDetail.tsx). */
  /** Aufteilen (components/transactions/BillSplit.tsx): a booking shared, each share asked for. */
  billSplit: {
    action: 'Aufteilen',
    title: 'Aufteilen',
    who: 'Wer zahlt was?',
    you: 'Du',
    person: 'Person',
    unnamed: (n: number) => `Person ${n}`,
    name: 'Name',
    /** A person's share; the chip above says whose. */
    share: 'Anteil',
    yourShare: (amount: ReactNode): ReactNode[] => ['Dein Anteil passt sich an: ', amount],
    youRest: (amount: ReactNode): ReactNode[] => ['Dein Anteil ist, was übrig bleibt: ', amount],
    remove: (name: string) => `${name} entfernen`,
    equal: 'Gleich verteilen',
    purpose: 'Verwendungszweck',
    /** Each request's purpose: "Anteil Sushi Yana, 21.10." */
    purposeFor: (name: string, day: string) => `Anteil ${name}, ${day}`,
    sumOk: (sum: ReactNode): ReactNode[] => ['Summe passt: ', sum],
    over: (diff: ReactNode): ReactNode[] => ['Die Anteile sind ', diff, ' mehr als die Buchung'],
    order: (names: string[]) => (names.length === 1
      ? `${names[0]} bekommt einen GiroCode`
      : `Je ein GiroCode: erst ${names.slice(0, -1).join(', ')}, dann ${names[names.length - 1]}`),
    requestAll: (n: number): string => (n === 1 ? 'Anfordern' : 'Alle anfordern'),
    /** The desktop's requests, every person's code at once (SplitRequests). */
    requests: {
      /** "Sushi Yana · 30,79 € geteilt durch 4" */
      eyebrow: (name: string, total: string, n: number) => `${name} · ${total} geteilt durch ${n}`,
      intro: 'Ein GiroCode pro Person, zum Scannen oder als Bild für den Chat.',
      purpose: (purpose: ReactNode): ReactNode[] => ['Verwendungszweck: ', purpose],
      own: (amount: ReactNode, to: string): ReactNode[] => ['Dein Anteil: ', amount, ` · an ${to}`],
      /** The buttons' names, with whose code it is: "Bild kopieren: Lea". */
      copyFor: (label: string, name: string) => `${label}: ${name}`,
      done: 'Fertig',
    },
    /** Requests made before from this booking, and whether the money came: "Schon angefordert: Lea offen, Max bezahlt." */
    asked: (people: string) => `Schon angefordert: ${people}.`,
    askedOpen: (name: string) => `${name} offen`,
    askedPaid: (name: string) => `${name} bezahlt`,
  },

  detail: {
    title: 'Umsatzdetails',
    /** Android's phone: the drawer's three tabs. */
    tabs: { details: 'Details', notes: 'Notiz & Belege', category: 'Kategorie', attached: 'enthält eine Notiz oder einen Beleg' },
    pendingTitle: 'Vorgemerkter Umsatz',
    /** When a card was used: "bezahlt am 30.09. um 14:05". */
    paidOn: (day: string, time: string | null) => `bezahlt am ${day}${time ? ` um ${time}` : ''}`,
    status: 'Status',
    repeat: 'Erneut überweisen',
    refund: 'Zurücküberweisen',
    receipt: 'Buchungsbeleg (PDF)',
    payment: 'Zahlung',
    card: 'Karte',
    original: 'Originalbetrag',
    /** The card system's exchange rate: "1 € = 1,1563 USD". */
    rate: (rate: string, currency: string) => `1 € = ${rate} ${currency}`,
    fee: 'Einsatzentgelt',
    feeIncluded: 'im Betrag enthalten',
    /** A copy button's label: "Verwendungszweck kopieren". */
    copy: (what: string) => `${what} kopieren`,
    payer: 'Auftraggeber',
    recipient: 'Empfänger',
    allWith: (name: string) => `Alle Umsätze mit ${name}`,
    bankName: 'Name laut Bank',
    shop: 'Geschäft (erkannt)',
    address: 'Anschrift',
    place: 'Ort',
    provider: 'Zahlungsdienstleister',
    providerIban: 'IBAN des Zahlungsdienstleisters',
    country: 'Land',
    /** Girovo Next: the asking bar at the foot of a booking's details (TxDetail.tsx AskAboutBooking). */
    ask: {
      title: 'Frag zu diesem Umsatz',
      /** Two questions about the counterparty, for a debit and for a credit. */
      debit: (name: string) => [`Wie oft zahle ich bei ${name}?`, `Was ging dieses Jahr an ${name}?`],
      credit: (name: string) => [`Wie oft kam Geld von ${name}?`, `Was kam dieses Jahr von ${name}?`],
      own: 'Eigene Frage',
      send: 'Fragen',
    },
  },

  /** How the drawer files a booking, and the rules (TxDetail.tsx CategorySection, RuleList). */
  categorize: {
    source: {
      auto: 'Automatisch erkannt',
      rule: 'Deine Regel für alle Umsätze',
      manual: 'Von dir gewählt',
    },
    ruleWith: (name: string) => `Deine Regel für alle Umsätze von ${name}`,
    /** Menu groups; "Eingänge" and "Ausgaben" are the common words. */
    refundGroup: 'Erstattung einer Ausgabe',
    ownGroup: 'Zwischen deinen Konten',
    filedAs: (label: string) => `Als „${label}“ eingeordnet.`,
    ruled: (name: string, label: string) => `Alle Umsätze von ${name} sind jetzt „${label}“, auch künftige.`,
    undone: (label: string, byRule: boolean) => `Wieder „${label}“, ${byRule ? 'wie deine Regel' : 'automatisch erkannt'}.`,
    unruled: (name: string) => `Regel entfernt. Umsätze von ${name} werden wieder automatisch eingeordnet.`,
    change: 'Ändern',
    changeLabel: (label: string) => `Kategorie ändern, aktuell ${label}`,
    yourRuleFor: (name: string) => `Deine Regel für ${name}`,
    howAppFiles: 'Wie Girovo den Umsatz einordnet',
    /** The way back from a choice for one booking: "Automatisch (Lebensmittel & Drogerie)". */
    undoItem: (byRule: boolean, label: string) => `${byRule ? 'Wie die Regel' : 'Automatisch'} (${label})`,
    removeRule: (name: string) => `Regel für ${name} entfernen`,
    offerOthers: (n: number, name: string, label: string) =>
      `Auch ${n === 1 ? 'den anderen Umsatz' : `die ${nDe(n)} anderen Umsätze`} von ${name} als „${label}“ einordnen?`,
    offerFuture: (name: string, label: string) => `Künftige Umsätze von ${name} auch als „${label}“ einordnen?`,
    alsoFuture: 'Gilt dann auch für künftige Umsätze.',
    applyAll: 'Für alle übernehmen',
    saveRule: 'Als Regel speichern',
    sessionOnly: 'Gilt nur für diese Sitzung. Girovo speichert gerade nichts.',
    rules: 'Deine Regeln',
    remove: 'Entfernen',
    /** The menu's way to a category of the user's own (components/transactions/CategoryDialogs.tsx). */
    newCategory: 'Neue Kategorie …',
    /** The menu's way to split the booking. */
    split: 'Aufteilen …',
    splitHint: 'Auf mehrere Kategorien verteilen',
  },

  /** A booking split across categories (lib/splits.ts, components/transactions/CategoryDialogs.tsx). */
  split: {
    title: 'Umsatz aufteilen',
    intro: (amount: ReactNode) => [
      'Verteile ', amount, ' auf mehrere Kategorien.',
    ],
    /** The first share: whatever the others leave. */
    rest: 'Rest',
    restHint: 'ergibt sich aus den anderen Teilen',
    categoryFor: (n: number) => `Kategorie für Teil ${n}`,
    amountFor: (label: string) => `Betrag für ${label}`,
    addPart: 'Weitere Kategorie',
    removePart: (label: string) => `Teil „${label}“ entfernen`,
    /** Shown under the rows while the shares take more than the booking. */
    over: (amount: ReactNode) => ['Die Teile sind zusammen ', amount, ' höher als der Umsatz.'],
    /** The others take the whole booking: nothing is left for the first share. */
    nothingLeft: (label: string) => `Für „${label}“ bleibt nichts übrig. Jeder Teil braucht einen Betrag über 0.`,
    emptyPart: 'Gib für jeden Teil einen Betrag über 0 ein.',
    twice: 'Eine Kategorie kommt doppelt vor. Fasse die Teile zusammen.',
    save: 'Aufteilen',
    /** Where the category section says how the booking got its categories. */
    source: 'Von dir aufgeteilt',
    heading: 'Aufgeteilt',
    edit: 'Aufteilung ändern',
    undo: 'Aufteilung aufheben',
    saved: (n: number) => `Auf ${nDe(n)} Kategorien aufgeteilt.`,
    undone: (label: string) => `Aufteilung aufgehoben. Der Umsatz zählt wieder ganz als „${label}“.`,
    /** A booking row's category line: "Lebensmittel & Drogerie + Geschenke", "Shopping + 2 weitere". */
    summary: (first: string, second: string, more: number) =>
      more > 0 ? `${first} + ${nDe(more + 1)} weitere` : `${first} + ${second}`,
    /** For a screen reader, beside the row's category glyph. */
    summaryLabel: (labels: string[]) => `Aufgeteilt: ${labels.join(', ')}`,
  },

  /** Categories of the user's own (lib/splits.ts): made from the category menu, kept in Einstellungen. */
  custom: {
    newTitle: 'Neue Kategorie',
    newIntro: 'Zum Beispiel „Spenden“ oder „Hund“. Umsätze ordnest du ihr selbst zu.',
    renameTitle: 'Kategorie umbenennen',
    name: 'Name',
    kind: 'Für',
    create: 'Anlegen',
    createAndFile: 'Anlegen und einordnen',
    empty: 'Gib einen Namen ein.',
    taken: 'Eine Kategorie mit diesem Namen gibt es schon.',
    full: (n: number) => `Mehr als ${nDe(n)} eigene Kategorien gehen nicht.`,
    created: (name: string) => `Kategorie „${name}“ angelegt.`,
    /** Einstellungen → Kategorien. */
    section: 'Eigene Kategorien',
    sectionHint: 'Gelten für alle Konten dieser Anmeldung, geschützt mit deiner PIN.',
    none: 'Noch keine. Lege hier eine an oder beim Umsatz unter „Ändern“.',
    add: 'Neue Kategorie',
    rename: 'Umbenennen',
    renameLabel: (name: string) => `„${name}“ umbenennen`,
    remove: 'Löschen',
    removeLabel: (name: string) => `„${name}“ löschen`,
    removeTitle: (name: string) => `„${name}“ löschen?`,
    removeBody: 'Umsätze darin werden wieder automatisch eingeordnet. Regeln, Budget und Aufteilungen mit ihr gehen verloren.',
    keep: 'Behalten',
    kindOut: 'Ausgaben',
    kindIn: 'Eingänge',
    used: (n: number) => (n === 1 ? '1 Umsatz geladen' : `${nDe(n)} Umsätze geladen`),
    unused: 'Kein geladener Umsatz',
  },

  /** The printed Kontoauszug, Buchungsbeleg and bank message (components/Statement.tsx, lib/print-doc.ts). */
  doc: {
    pdfFailed: (error: string) => `PDF konnte nicht gespeichert werden: ${error}`,
    /** The file names the save dialog offers, ASCII only: "Kontoauszug_SK-20261004-1A2B3C4D.pdf". */
    statementFile: 'Kontoauszug',
    receiptFile: 'Buchungsbeleg',
    messageFile: 'Mitteilung',
    /** "04.10.2026, 14:32 Uhr (MESZ)" — a timestamp that says which clock it is on. */
    created: (date: string, time: string, zone: string | undefined) => `${date}, ${time} Uhr${zone ? ` (${zone})` : ''}`,
    /** The page count in the page margin, around the printer's own counters: "Seite 2 von 3". */
    pageOf: <T>(page: T, pages: T): (string | T)[] => ['Seite ', page, ' von ', pages],
    /** The letterhead of a bank without a name. */
    bank: 'Bank',
    institution: 'Kontoführendes Institut',
    blz: 'BLZ',
    generatedBy: (generator: string) =>
      `Erstellt mit ${generator} aus den Daten der Bank. Die Bank hat dieses Dokument nicht ausgestellt; maßgeblich sind ihre Kontoauszüge.`,
    checksum: 'Prüfsumme (SHA-256)',
    aheadNote:
      '„Noch nicht gebucht“: von der Bank gemeldet, Buchungstag nach dem Erstellungsdatum.',
    openingDerived:
      'Alter Kontostand errechnet aus neuem Kontostand und Umsätzen, weil die Bank ihn nicht gemeldet hat.',
    closingDerived:
      'Neuer Kontostand errechnet aus altem Kontostand und Umsätzen, weil die Bank ihn nicht gemeldet hat.',
    noPending: 'Vorgemerkte Umsätze sind nicht enthalten, da noch nicht gebucht.',
    statement: 'Kontoauszug',
    receipt: 'Buchungsbeleg',
    period: 'Zeitraum',
    createdLabel: 'Erstellt',
    document: 'Dokument',
    holder: 'Kontoinhaber',
    accountNumber: 'Kontonummer',
    /** The table's text column. */
    details: 'Vorgang',
    amountIn: (currency: string) => `Betrag in ${currency}`,
    opening: 'Alter Kontostand',
    closing: 'Neuer Kontostand',
    /** "Alter Kontostand am 05.07.2026". */
    balanceOn: (label: string, date: ReactNode) => [label, ' am ', date],
    /** Behind a balance the sheet worked out itself. */
    derived: '(errechnet)',
    empty: 'Keine Umsätze in diesem Zeitraum.',
    mandateShort: 'Mandatsref.',
    e2eShort: 'End-to-End-Ref.',
    bankNameLine: (name: string) => `Name laut Bank: ${name}`,
    statementEnd: (count: string) => `Ende des Kontoauszugs · ${count}`,
    /** The bookings the balance contains, and those set apart as not yet in it. */
    endCount: (counted: number, outstanding: number) => {
      const head = counted === 1 ? '1 Umsatz' : `${counted} Umsätze`;
      if (!outstanding) return head;
      return `${head}, dazu ${outstanding} noch nicht ${outstanding === 1 ? 'enthaltener' : 'enthaltene'}`;
    },
    credits: (n: number) => `${n} ${n === 1 ? 'Gutschrift' : 'Gutschriften'}`,
    debits: (n: number) => `${n} ${n === 1 ? 'Belastung' : 'Belastungen'}`,
    available: (amount: string) => `Verfügbar ${amount}`,
    totals: 'Summen und Kontostand',
    mixed: 'Umsätze in mehreren Währungen werden nicht addiert.',
    notReported: 'nicht gemeldet',
    /** Bookings dated after the closing balance's day: "Noch nicht enthalten: 2 Umsätze ab 05.10.2026". */
    notIncluded: (n: number, date: ReactNode) =>
      ['Noch nicht enthalten: ', n === 1 ? '1 Umsatz vom' : `${n} Umsätze ab`, ' ', date],
    /** The bank's balances do not fit the bookings, by `amount`. */
    unexplained: (amount: ReactNode) =>
      ['Die Umsätze erklären ', amount, ' des Unterschieds zwischen den Kontoständen der Bank nicht.'],
    payee: 'Zahlungsempfänger',
    pendingLead: 'Vorgemerkt, noch nicht gebucht.',
    pendingBody: 'Betrag, Wertstellung und Referenzen können sich bis zur Buchung noch ändern.',
    aheadLead: 'Noch nicht gebucht.',
    aheadBody: (date: ReactNode) =>
      ['Die Bank bucht ihn am ', date, '.'],
    recipientAccount: 'Empfängerkonto',
    debitedAccount: 'Belastetes Konto',
    payerAccount: 'Auftraggeberkonto',
    owner: 'Inhaber',
    booking: 'Buchung',
    bookingType: 'Buchungsart',
    /** Beside a Vormerkposten's Wertstellung. */
    provisional: 'vorläufig',
    receiptEnd: 'Ende des Buchungsbelegs',
    valueNote: 'Die Wertstellung (Valuta) zählt für die Zinsen und kann vom Buchungstag abweichen.',
    /** The credit line beside the balance: on an account, on a card. */
    overdraftLimit: 'Dispositionsrahmen',
    creditLimit: 'Kreditrahmen',
    /** A message the bank sent at login, on paper. Its subject and text stay the bank's. */
    message: 'Mitteilung der Bank',
    /** When this session received it — the letterhead's first line. */
    received: 'Erhalten',
    subject: 'Betreff',
    messageText: 'Text der Mitteilung',
    messageEnd: 'Ende der Mitteilung',
    /** The footer's sentence on a message — there are no Kontoauszüge to defer to. */
    generatedFromMessage: (generator: string) =>
      `Erstellt mit ${generator} aus einer Mitteilung der Bank, Text unverändert. Die Bank hat dieses Dokument nicht ausgestellt.`,
  },

  /**
   * The CSV export (lib/csv.ts): the header row, the Status column and the
   * file name. The cells keep the German Excel dialect in either language.
   */
  csv: {
    columns: {
      accountName: 'Bezeichnung Auftragskonto',
      accountIban: 'IBAN Auftragskonto',
      accountBic: 'BIC Auftragskonto',
      accountBank: 'Bankname Auftragskonto',
      entryDate: 'Buchungstag',
      valueDate: 'Valutadatum',
      remoteName: 'Name Zahlungsbeteiligter',
      remoteIban: 'IBAN Zahlungsbeteiligter',
      remoteBic: 'BIC Zahlungsbeteiligter',
      /** The shop behind a card processor, or the payer behind a payment service. */
      ultimate: 'Abweichender Empfänger/Auftraggeber',
      bookingText: 'Buchungstext',
      purpose: 'Verwendungszweck',
      amount: 'Betrag',
      currency: 'Waehrung',
      category: 'Kategorie',
      creditorId: 'Glaeubiger ID',
      mandateRef: 'Mandatsreferenz',
      e2eRef: 'Kundenreferenz (End-to-End)',
      status: 'Status',
    },
    /** The Status column; a Buchungstag still ahead is notBooked. */
    booked: 'Gebucht',
    /** The file name, ASCII only: "Umsaetze_593271_2026-07-05_2026-10-03_gefiltert.csv". */
    file: 'Umsaetze',
    fileFiltered: 'gefiltert',
    /** In the file name when there is neither an IBAN nor an account number. */
    fileNoAccount: 'Konto',
  },

  /** Saving a file (lib/download.ts). */
  download: {
    failed: 'Die Datei konnte nicht gespeichert werden.',
  },

  /** What the routes answer (app/api/transactions, pending, balance; lib/fints-statements.ts). */
  api: {
    noAccount: 'Kein Konto gewählt.',
    noStatements: 'Deine Bank liefert für dieses Konto keine Umsätze.',
    transactionsFailed: 'Umsätze konnten nicht geladen werden.',
    pendingFailed: 'Vorgemerkte Umsätze konnten nicht geladen werden.',
    balanceFailed: 'Kontostand konnte nicht geladen werden.',
    /** A credit card booking read over DKKKU (lib/fints-cards.ts): its Buchungstext. */
    cardBooking: 'Kreditkartenumsatz',
    /** …and, for a payment in another currency, what it was there — beside the place. */
    cardForeign: (amount: number, currency: string, rate: number | null) =>
      `${amount.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}${rate ? `, Kurs ${rate.toLocaleString('de-DE', { maximumFractionDigits: 6 })}` : ''}`,
  },

  /** The frame around a bank's answer in an error alert (components/BankAnswer.tsx): its return codes. */
  bankAnswer: {
    codes: (codes: string) => `Rückmeldung der Bank: ${codes}`,
  },
};

export const en: typeof de = {
  count: (n) => `${nEn(n)} ${n === 1 ? 'transaction' : 'transactions'}`,
  refresh: 'Refresh',
  notFetched: 'Not loaded yet',
  notBooked: 'Not booked yet',
  state: {
    booked: 'booked',
    pending: 'pending',
    ahead: 'not booked yet',
  },
  clock: (time) => time,
  via: (name) => `via ${name}`,
  fallbackName: 'Transaction',
  category: 'Category',
  chooseCategory: 'Choose category',
  entryDate: 'Booking date',
  valueDate: 'Value date',
  sum: 'Total',

  list: {
    busy: 'Available once Girovo is done.',
    loadingRange: (range) => `Loading ${range}…`,
    pendingMatch: (n) => (n === 1 ? '1 pending transaction also matches' : `${n} pending transactions also match`),
    noStatements: 'No transactions for this account',
    noStatementsBody: 'Your bank doesn’t send transactions for this account.',
    loading: 'Loading transactions.',
    loadFailed: 'Could not load transactions',
    notFetched: 'Transactions not loaded yet',
    fetch: 'Load transactions',
    empty: 'No transactions in this period',
    longerPeriod: 'A longer period might show more.',
    noMatches: 'No matching transactions',
    resetFilters: 'Reset filters',
    quote: (word) => `“${word}”`,
    inLoaded: 'in the loaded period',
    inLoadedRange: (range) => ['in the loaded period (', range, ')'],
    notFound: (words, count, where) =>
      [words, count === 1 ? ' doesn’t appear in any transaction ' : ' don’t appear in any transaction ', where, '.'],
    allWordsApart: (query) => `No transaction contains all the words of “${query}”.`,
    otherFilters: (query) => `“${query}” finds transactions, but none with these filters.`,
    noneInPeriod: 'No transaction in the period matches these filters.',
    refresh: 'Refresh transactions.',
    failedKeptOld: (error) => `Couldn’t refresh: ${error} You’re seeing the last update.`,
    switchTo: (account) => `Switch to “${account}”`,
    sentFromOther: (from, shown) =>
      `You can only see whether the transfer was completed in “${from}”, not in “${shown}”.`,
    belongsToOther: (owner, shown) => `The transaction belongs to “${owner}”. This list shows “${shown}”.`,
    fetchedBeforeTransfer: (time) =>
      ['As of ', time, ', before your transfer. It can’t be here yet.'],
    acrossAccounts: (account) => `The analysis counts all accounts, this list only shows ${account}.`,
    countOf: (shown, total) => `${nEn(shown)} of ${nEn(total)} ${total === 1 ? 'transaction' : 'transactions'}`,
    otherCurrency: (n) => `${n} in another currency not included`,
    reset: 'Reset',
    incomeTotal: 'Total money in',
    expenseTotal: 'Total money out',
    monthWords: (words) => `Also searched as a month: ${words.map((w) => `“${w.text}” (${w.month})`).join(', ')}`,
  },

  filter: {
    searchLabel: 'Search transactions',
    clear: 'Clear search',
    direction: 'Direction',
    all: 'All',
    categoryIs: (label) => `Category: ${label}`,
    allCategories: 'All categories',
    month: 'Month',
    daysAre: (days) => `List period: ${days}`,
    chooseMonth: 'Choose month',
    wholePeriod: 'Whole loaded period',
    monthsInPeriod: 'Months in the loaded period',
    remove: (what) => `Remove ${what}`,
  },

  period: {
    presets: {
      '30d': { label: 'Last 30 days', short: '30 days' },
      '90d': { label: 'Last 90 days', short: '90 days' },
      thisMonth: { label: 'This month', short: 'This month' },
      lastMonth: { label: 'Last month', short: 'Last month' },
      thisYear: { label: 'This year', short: 'This year' },
      '365d': { label: 'Last 12 months', short: '12 months' },
    },
    title: 'Period',
    is: (label) => `Period: ${label}`,
    choose: 'Choose period',
    custom: 'Custom period',
    customMenu: 'Custom period…',
    busy: 'Please wait until Girovo is done.',
    load: 'Load period',
    startAfterEnd: 'The start is after the end.',
    startInFuture: 'The start is in the future.',
    endInFuture: 'No later than today.',
    from: 'From',
    to: 'To',
    longerHistory: 'May need approval. Some banks send less history.',
  },

  exportMenu: {
    label: 'Export transactions',
    button: 'Export',
    nothing: 'No transactions in the period',
    forExcel: (count) => `${count} · for Excel`,
    all: 'All transactions as CSV',
    noFilter: 'No filter active',
    filterEmpty: 'The filter shows no transactions',
    filtered: 'Filtered transactions as CSV',
  },

  pending: {
    allBooked: 'All booked by now',
    none: 'Your bank reports nothing pending',
    asOf: (since) => `As of ${since}`,
    behindStatement: ', older than the transaction list',
    bookedSince: (n) => `${n} booked since`,
    matches: (n) => (n === 1 ? '1 matches your search' : `${n} match your search`),
    loadingShort: 'Loading…',
    refresh: 'Refresh pending transactions.',
    loading: 'Loading pending transactions.',
    intro: 'Announced direct debits and card payments, not booked yet.',
    fetch: 'Load pending transactions',
    showLess: 'Show less',
    showAll: (n) => `Show all ${n}`,
  },

  days: {
    skip: 'Skip list',
    future: 'Booking date in the future. The bank books them only then.',
    balanceShort: 'Balance',
    endOfDay: 'at end of day:',
    dayTotal: 'Day total:',
    end: 'End of transaction list',
    shownOf: (shown, total) => `${shown} of ${total} shown`,
    more: (n) => `Show ${n} more`,
  },

  row: {
    entryDate: (date) => `Booking date ${date}`,
    valueDate: (date) => `Value date ${date}`,
    value: (day) => `Value ${day}`,
    booking: (day) => `Booking ${day}`,
    perBank: (name) => `According to the bank: ${name}`,
  },

  card: {
    creditCard: 'Credit card',
    debitCard: 'Debit card',
    payment: 'Card payment',
    credit: 'Card credit',
    creditVia: (card) => `Credit · ${card}`,
    foreignCurrency: (currency) => `Foreign currency ${currency}`,
    atm: (day, time) => `Cash machine · ${day}, ${time}`,
  },

  kinds: {
    lastschrift: 'Direct debit',
    karte: 'Card payment',
    gutschrift: 'Credit',
    ueberweisung: 'Transfer',
    echtzeit: 'Instant transfer',
    dauerauftrag: 'Standing order',
    bargeld: 'Cash',
    entgelt: 'Fee',
    zinsen: 'Interest',
    ruecklastschrift: 'Returned direct debit',
    gehalt: 'Salary/pension',
    sonstige: 'Transaction',
  },

  refs: {
    title: 'References',
    e2e: 'End-to-end reference',
    mandate: 'Mandate reference',
    customer: 'Customer reference',
    bank: 'Bank reference',
    primanota: 'Primanota',
    statementNo: 'Statement no.',
    code: 'Transaction code',
    extra: 'Additional information',
    original: 'Payment reference (original)',
  },

  seeds: {
    refund: (purpose) => `Refund: ${purpose}`,
    refundDated: (date) => `Refund of payment dated ${date}`,
  },

  billSplit: {
    action: 'Split',
    title: 'Split',
    who: 'Who pays what?',
    you: 'You',
    person: 'Person',
    unnamed: (n) => `Person ${n}`,
    name: 'Name',
    share: 'Share',
    yourShare: (amount) => ['Your share adjusts: ', amount],
    youRest: (amount) => ['Your share is what is left: ', amount],
    remove: (name) => `Remove ${name}`,
    equal: 'Split equally',
    purpose: 'Payment reference',
    purposeFor: (name, day) => `Share ${name}, ${day}`,
    sumOk: (sum) => ['Total adds up: ', sum],
    over: (diff) => ['The shares are ', diff, ' more than the transaction'],
    order: (names) => (names.length === 1
      ? `${names[0]} gets a GiroCode`
      : `One GiroCode each: first ${names.slice(0, -1).join(', ')}, then ${names[names.length - 1]}`),
    requestAll: (n) => (n === 1 ? 'Request' : 'Request all'),
    requests: {
      eyebrow: (name, total, n) => `${name} · ${total} split ${n} ways`,
      intro: 'One GiroCode per person, to scan or as an image for a chat.',
      purpose: (purpose) => ['Reference: ', purpose],
      own: (amount, to) => ['Your share: ', amount, ` · to ${to}`],
      copyFor: (label, name) => `${label}: ${name}`,
      done: 'Done',
    },
    asked: (people) => `Already requested: ${people}.`,
    askedOpen: (name) => `${name} open`,
    askedPaid: (name) => `${name} paid`,
  },

  detail: {
    title: 'Transaction details',
    tabs: { details: 'Details', notes: 'Note & receipts', category: 'Category', attached: 'has a note or a receipt' },
    pendingTitle: 'Pending transaction',
    paidOn: (day, time) => `paid on ${day}${time ? ` at ${time}` : ''}`,
    status: 'Status',
    repeat: 'Transfer again',
    refund: 'Transfer back',
    receipt: 'Transaction receipt (PDF)',
    payment: 'Payment',
    card: 'Card',
    original: 'Original amount',
    rate: (rate, currency) => `€1 = ${rate} ${currency}`,
    fee: 'Usage fee',
    feeIncluded: 'included in the amount',
    copy: (what) => `Copy ${lowerFirst(what)}`,
    payer: 'Payer',
    recipient: 'Recipient',
    allWith: (name) => `All transactions with ${name}`,
    bankName: 'Name according to the bank',
    shop: 'Shop (recognised)',
    address: 'Address',
    place: 'Location',
    provider: 'Payment provider',
    providerIban: 'Payment provider’s IBAN',
    country: 'Country',
    ask: {
      title: 'Ask about this transaction',
      debit: (name) => [`How often do I pay ${name}?`, `What went to ${name} this year?`],
      credit: (name) => [`How often did money come from ${name}?`, `What came from ${name} this year?`],
      own: 'Your own question',
      send: 'Ask',
    },
  },

  categorize: {
    source: {
      auto: 'Recognised automatically',
      rule: 'Your rule for all transactions',
      manual: 'Chosen by you',
    },
    ruleWith: (name) => `Your rule for all transactions with ${name}`,
    refundGroup: 'Refund of an expense',
    ownGroup: 'Between your accounts',
    filedAs: (label) => `Filed under “${label}”.`,
    ruled: (name, label) => `All transactions with ${name} are now filed under “${label}”, future ones too.`,
    undone: (label, byRule) => `Back to “${label}”, ${byRule ? 'as your rule says' : 'recognised automatically'}.`,
    unruled: (name) => `Rule removed. Transactions with ${name} are filed automatically again.`,
    change: 'Change',
    changeLabel: (label) => `Change category, currently ${label}`,
    yourRuleFor: (name) => `Your rule for ${name}`,
    howAppFiles: 'How Girovo files the transaction',
    undoItem: (byRule, label) => `${byRule ? 'As the rule says' : 'Automatic'} (${label})`,
    removeRule: (name) => `Remove rule for ${name}`,
    offerOthers: (n, name, label) =>
      `Also file ${n === 1 ? 'the other transaction' : `the ${nEn(n)} other transactions`} with ${name} under “${label}”?`,
    offerFuture: (name, label) => `Also file future transactions with ${name} under “${label}”?`,
    alsoFuture: 'Then also applies to future transactions.',
    applyAll: 'Apply to all',
    saveRule: 'Save as rule',
    sessionOnly: 'Only for this session. Girovo isn’t saving anything right now.',
    rules: 'Your rules',
    remove: 'Remove',
    newCategory: 'New category…',
    split: 'Split…',
    splitHint: 'Spread across several categories',
  },

  split: {
    title: 'Split transaction',
    intro: (amount) => [
      'Spread ', amount, ' across several categories.',
    ],
    rest: 'Remainder',
    restHint: 'what the other parts leave',
    categoryFor: (n) => `Category for part ${n}`,
    amountFor: (label) => `Amount for ${label}`,
    addPart: 'Another category',
    removePart: (label) => `Remove part “${label}”`,
    over: (amount) => ['Together the parts come to ', amount, ' more than the transaction.'],
    nothingLeft: (label) => `Nothing is left for “${label}”. Every part needs an amount above 0.`,
    emptyPart: 'Enter an amount above 0 for every part.',
    twice: 'A category appears twice. Combine the parts.',
    save: 'Split',
    source: 'Split by you',
    heading: 'Split',
    edit: 'Change split',
    undo: 'Undo split',
    saved: (n) => `Split across ${nEn(n)} categories.`,
    undone: (label) => `Split undone. The transaction counts fully as “${label}” again.`,
    summary: (first, second, more) => (more > 0 ? `${first} + ${nEn(more + 1)} more` : `${first} + ${second}`),
    summaryLabel: (labels) => `Split: ${labels.join(', ')}`,
  },

  custom: {
    newTitle: 'New category',
    newIntro: 'For example “Donations” or “Dog”. You file transactions into it yourself.',
    renameTitle: 'Rename category',
    name: 'Name',
    kind: 'For',
    create: 'Create',
    createAndFile: 'Create and file',
    empty: 'Enter a name.',
    taken: 'There is already a category with this name.',
    full: (n) => `You can’t have more than ${nEn(n)} categories of your own.`,
    created: (name) => `Category “${name}” created.`,
    section: 'Your categories',
    sectionHint: 'Apply to every account of this login, protected by your PIN.',
    none: 'None yet. Create one here or on a transaction under “Change”.',
    add: 'New category',
    rename: 'Rename',
    renameLabel: (name) => `Rename “${name}”`,
    remove: 'Delete',
    removeLabel: (name) => `Delete “${name}”`,
    removeTitle: (name) => `Delete “${name}”?`,
    removeBody: 'Its transactions are filed automatically again. Rules, budget and splits that use it are lost.',
    keep: 'Keep',
    kindOut: 'Spending',
    kindIn: 'Income',
    used: (n) => (n === 1 ? '1 transaction loaded' : `${nEn(n)} transactions loaded`),
    unused: 'No loaded transaction',
  },

  doc: {
    pdfFailed: (error) => `Could not save the PDF: ${error}`,
    statementFile: 'Account_statement',
    receiptFile: 'Transaction_receipt',
    messageFile: 'Bank_message',
    created: (date, time, zone) => `${date}, ${time}${zone ? ` (${zone})` : ''}`,
    pageOf: (page, pages) => ['Page ', page, ' of ', pages],
    bank: 'Bank',
    institution: 'Account-holding institution',
    blz: 'Bank code',
    generatedBy: (generator) =>
      `Created with ${generator} from the bank’s data. The bank did not issue this document; its account statements are authoritative.`,
    checksum: 'Checksum (SHA-256)',
    aheadNote:
      '“Not booked yet”: reported by the bank, booking date after the creation date.',
    openingDerived:
      'Opening balance calculated from the closing balance and transactions, as the bank did not report it.',
    closingDerived:
      'Closing balance calculated from the opening balance and transactions, as the bank did not report it.',
    noPending: 'Pending transactions are not included, as they are not booked yet.',
    statement: 'Account statement',
    receipt: 'Transaction receipt',
    period: 'Period',
    createdLabel: 'Created',
    document: 'Document',
    holder: 'Account holder',
    accountNumber: 'Account number',
    details: 'Details',
    amountIn: (currency) => `Amount in ${currency}`,
    opening: 'Opening balance',
    closing: 'Closing balance',
    balanceOn: (label, date) => [label, ' on ', date],
    derived: '(calculated)',
    empty: 'No transactions in this period.',
    mandateShort: 'Mandate ref.',
    e2eShort: 'End-to-end ref.',
    bankNameLine: (name) => `Name according to the bank: ${name}`,
    statementEnd: (count) => `End of account statement · ${count}`,
    endCount: (counted, outstanding) => {
      const head = counted === 1 ? '1 transaction' : `${counted} transactions`;
      if (!outstanding) return head;
      return `${head}, plus ${outstanding} not yet included`;
    },
    credits: (n) => `${n} ${n === 1 ? 'credit' : 'credits'}`,
    debits: (n) => `${n} ${n === 1 ? 'debit' : 'debits'}`,
    available: (amount) => `Available ${amount}`,
    totals: 'Totals and balance',
    mixed: 'Transactions in more than one currency are not added up.',
    notReported: 'not reported',
    notIncluded: (n, date) => ['Not yet included: ', n === 1 ? '1 transaction dated' : `${n} transactions from`, ' ', date],
    unexplained: (amount) =>
      ['The transactions do not explain ', amount, ' of the difference between the bank’s balances.'],
    payee: 'Payee',
    pendingLead: 'Pending, not booked yet.',
    pendingBody: 'The amount, value date and references may still change until the transaction is booked.',
    aheadLead: 'Not booked yet.',
    aheadBody: (date) =>
      ['The bank books it on ', date, '.'],
    recipientAccount: 'Recipient account',
    debitedAccount: 'Debited account',
    payerAccount: 'Payer account',
    owner: 'Holder',
    booking: 'Booking',
    bookingType: 'Booking type',
    provisional: 'provisional',
    receiptEnd: 'End of transaction receipt',
    valueNote: 'The value date counts for interest and can differ from the booking date.',
    overdraftLimit: 'Overdraft limit',
    creditLimit: 'Credit limit',
    message: 'Message from the bank',
    received: 'Received',
    subject: 'Subject',
    messageText: 'Message text',
    messageEnd: 'End of message',
    generatedFromMessage: (generator) =>
      `Created with ${generator} from a message from the bank, text unchanged. The bank did not issue this document.`,
  },

  csv: {
    columns: {
      accountName: 'Account name',
      accountIban: 'Account IBAN',
      accountBic: 'Account BIC',
      accountBank: 'Bank name',
      entryDate: 'Booking date',
      valueDate: 'Value date',
      remoteName: 'Counterparty name',
      remoteIban: 'Counterparty IBAN',
      remoteBic: 'Counterparty BIC',
      ultimate: 'Ultimate recipient/payer',
      bookingText: 'Booking text',
      purpose: 'Payment reference',
      amount: 'Amount',
      currency: 'Currency',
      category: 'Category',
      creditorId: 'Creditor ID',
      mandateRef: 'Mandate reference',
      e2eRef: 'Customer reference (end-to-end)',
      status: 'Status',
    },
    booked: 'Booked',
    file: 'Transactions',
    fileFiltered: 'filtered',
    fileNoAccount: 'Account',
  },

  download: {
    failed: 'The file could not be saved.',
  },

  api: {
    noAccount: 'No account chosen.',
    noStatements: 'Your bank doesn’t send transactions for this account.',
    transactionsFailed: 'Could not load transactions.',
    pendingFailed: 'Could not load pending transactions.',
    balanceFailed: 'Could not load the balance.',
    cardBooking: 'Credit card transaction',
    cardForeign: (amount, currency, rate) =>
      `${amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}${rate ? `, rate ${rate.toLocaleString('en-GB', { maximumFractionDigits: 6 })}` : ''}`,
  },

  bankAnswer: {
    codes: (codes) => `Response from the bank: ${codes}`,
  },
};
