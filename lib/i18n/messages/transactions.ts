// Umsätze: the list, its filters and periods, a booking's detail, pending entries, exports (CSV, PDF) and the printed Kontoauszug and Buchungsbeleg (components/Transactions, components/transactions, components/Statement).

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
  /** Said wherever a fetch from the bank may ask for an approval. */
  mayNeedApproval: 'Kann eine Freigabe erfordern.',
  refresh: 'Aktualisieren',
  notFetched: 'Noch nicht abgerufen',
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
    busy: 'Möglich, sobald der laufende Vorgang fertig ist.',
    loadingRange: (range: string) => `Lädt ${range} …`,
    /** After the loaded range: "05.07.–03.10.2026 · abgerufen 14:32 Uhr". */
    fetchedAt: (time: string) => `abgerufen ${time} Uhr`,
    /** After "Abruf fehlgeschlagen". */
    failedAt: (time: string) => `um ${time} Uhr`,
    /** Leads to the Vorgemerkt panel, which the filter also reaches. */
    pendingMatch: (n: number) =>
      (n === 1 ? 'Außerdem passt 1 vorgemerkter Umsatz' : `Außerdem passen ${n} vorgemerkte Umsätze`),
    noStatements: 'Keine Umsätze für dieses Konto',
    noStatementsBody: 'Deine Bank bietet für dieses Konto keine Umsatzabfrage über FinTS an.',
    loading: 'Umsätze werden geladen.',
    loadFailed: 'Umsätze konnten nicht geladen werden',
    notFetched: 'Umsätze noch nicht abgerufen',
    fetch: 'Umsätze abrufen',
    empty: 'Keine Umsätze in diesem Zeitraum',
    /** `range` as fmtRange writes it ("05.07.–03.10.2026"); its dash becomes the "und". */
    nothingBooked: (range: string) => `Zwischen ${range.replace(/\s*–\s*/, ' und ')} wurde nichts gebucht.`,
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
    allWordsApart: (query: string) => `Jedes Wort von „${query}“ kommt vor, aber kein Umsatz enthält alle zusammen.`,
    otherFilters: (query: string) => `„${query}“ findet Umsätze, aber keinen, der zu den übrigen Filtern passt.`,
    noneInPeriod: 'Im geladenen Zeitraum passt kein Umsatz zu diesen Filtern.',
    refresh: 'Umsätze aktualisieren.',
    /** The latest fetch failed; the list still shows the one before. */
    failedKeptOld: (error: string) => `Abruf fehlgeschlagen: ${error} Angezeigt werden die zuletzt abgerufenen Umsätze.`,
    switchTo: (account: string) => `Zu „${account}“ wechseln`,
    /** A transfer whose status is unclear went out from another account than the one shown. */
    sentFromOther: (from: string, shown: string) =>
      `Die Überweisung ging von „${from}“ aus. Diese Liste zeigt „${shown}“ – ob sie ausgeführt wurde, siehst du nur dort.`,
    belongsToOther: (owner: string, shown: string) => `Der Umsatz gehört zu „${owner}“. Diese Liste zeigt „${shown}“.`,
    /** The list was fetched before a transfer whose status is unclear. */
    fetchedBeforeTransfer: (time: ReactNode) =>
      ['Diese Umsätze wurden um ', time, ' Uhr abgerufen, vor deiner Überweisung – sie kann hier noch nicht stehen.'],
    acrossAccounts: (account: string) =>
      `Die Analyse hat alle Konten mit Umsätzen gezählt. Diese Liste zeigt nur ${account}.`,
    /** While a filter is set: "12 von 240 Umsätzen". */
    countOf: (shown: number, total: number) => `${nDe(shown)} von ${nDe(total)} ${total === 1 ? 'Umsatz' : 'Umsätzen'}`,
    otherCurrency: (n: number) => `${n} in anderer Währung nicht summiert`,
    reset: 'Zurücksetzen',
    incomeTotal: 'Summe der Eingänge',
    expenseTotal: 'Summe der Ausgänge',
    /** Search words that were also read as a month: "„mai“ auch als Monat Mai gesucht". */
    monthWords: (words: readonly { text: string; month: string | null }[]) =>
      `${words.map((w) => `„${w.text}“ auch als Monat ${w.month}`).join(', ')} gesucht`,
  },

  /** Search, direction chips, category and month (components/transactions/TxFilterBar.tsx). */
  filter: {
    placeholder: 'Name, Zweck, Kategorie, Betrag, Monat',
    searchLabel: 'Umsätze durchsuchen',
    clear: 'Suche leeren',
    /** For a screen reader: what the search reads, and how to type an amount, a day, a month. */
    hint: 'Sucht im Namen, Verwendungszweck, in der Kategorie und IBAN. Beträge wie 12,99, über 100 als >100, von 50 bis 100 als 50-100, ein Tag wie 28.09. und ein Monat wie August.',
    direction: 'Richtung',
    all: 'Alle',
    categoryIs: (label: string) => `Kategorie: ${label}`,
    allCategories: 'Alle Kategorien',
    month: 'Monat',
    daysAre: (days: string) => `Zeitraum der Liste: ${days}`,
    chooseMonth: 'Monat wählen',
    wholePeriod: 'Ganzer geladener Zeitraum',
    monthsInPeriod: 'Monat im geladenen Zeitraum',
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
    /** Under a preset that reaches further back than what is loaded. */
    mayNeedApproval: 'Kann eine Freigabe erfordern',
    title: 'Zeitraum',
    is: (label: string) => `Zeitraum: ${label}`,
    choose: 'Zeitraum wählen',
    custom: 'Eigener Zeitraum',
    customMenu: 'Eigener Zeitraum …',
    busy: 'Bitte warten – ein anderer Vorgang läuft noch.',
    load: 'Zeitraum laden',
    startAfterEnd: 'Der Beginn liegt nach dem Ende.',
    startInFuture: 'Der Beginn liegt in der Zukunft.',
    endInFuture: 'Höchstens bis heute.',
    from: 'Von',
    to: 'Bis',
    longerHistory: 'Kann eine Freigabe erfordern. Manche Banken liefern weniger Verlauf.',
    apply: 'Übernehmen',
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
    behindStatement: ', vor dem letzten Umsatzabruf',
    bookedSince: (n: number) => `${n} inzwischen gebucht`,
    matches: (n: number) => (n === 1 ? '1 passt zu deiner Suche' : `${n} passen zu deiner Suche`),
    loadingShort: 'Wird abgerufen …',
    refresh: 'Vorgemerkte Umsätze aktualisieren.',
    loading: 'Vorgemerkte Umsätze werden geladen.',
    intro: 'Angekündigte Lastschriften und Kartenzahlungen, die deine Bank noch nicht gebucht hat.',
    fetch: 'Vorgemerkte abrufen',
    showLess: 'Weniger anzeigen',
    showAll: (n: number) => `Alle ${n} anzeigen`,
  },

  /** The list, one section per day (components/transactions/TxList.tsx). */
  days: {
    skip: 'Liste überspringen',
    future: 'Diese Buchungen tragen einen Buchungstag in der Zukunft – die Bank verbucht sie erst an diesem Tag.',
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
  detail: {
    title: 'Umsatzdetails',
    pendingTitle: 'Vorgemerkter Umsatz',
    /** When a card was used: "bezahlt am 30.09. um 14:05". */
    paidOn: (day: string, time: string | null) => `bezahlt am ${day}${time ? ` um ${time}` : ''}`,
    status: 'Status',
    repeat: 'Erneut überweisen',
    refund: 'Zurücküberweisen',
    receipt: 'Beleg (PDF)',
    payment: 'Zahlung',
    paidAt: 'Bezahlt am',
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
    ruled: (name: string, label: string) => `Alle Umsätze von ${name} sind jetzt „${label}“ – auch künftige.`,
    undone: (label: string, byRule: boolean) => `Wieder „${label}“, ${byRule ? 'wie deine Regel' : 'automatisch erkannt'}.`,
    unruled: (name: string) => `Regel entfernt. Die Umsätze von ${name} werden wieder automatisch eingeordnet.`,
    change: 'Ändern',
    changeLabel: (label: string) => `Kategorie ändern, aktuell ${label}`,
    yourRuleFor: (name: string) => `Deine Regel für ${name}`,
    howAppFiles: 'Wie die App den Umsatz einordnet',
    /** The way back from a choice for one booking: "Automatisch (Lebensmittel & Drogerie)". */
    undoItem: (byRule: boolean, label: string) => `${byRule ? 'Wie die Regel' : 'Automatisch'} (${label})`,
    removeRule: (name: string) => `Regel für ${name} entfernen`,
    offerOthers: (n: number, name: string, label: string) =>
      `Auch ${n === 1 ? 'den anderen Umsatz' : `die ${nDe(n)} anderen Umsätze`} von ${name} als „${label}“ einordnen?`,
    offerFuture: (name: string, label: string) => `Künftige Umsätze von ${name} auch als „${label}“ einordnen?`,
    alsoFuture: 'Gilt dann auch für künftige Umsätze.',
    applyAll: 'Für alle übernehmen',
    saveRule: 'Als Regel speichern',
    sessionOnly: 'Gilt nur für diese Sitzung – deine persönlichen Daten werden gerade nicht gespeichert.',
    rules: 'Deine Regeln',
    remove: 'Entfernen',
  },

  /** The printed Kontoauszug and Buchungsbeleg (components/Statement.tsx, lib/print-doc.ts). */
  doc: {
    pdfFailed: (error: string) => `PDF konnte nicht gespeichert werden: ${error}`,
    /** The file names the save dialog offers, ASCII only: "Kontoauszug_SK-20261004-1A2B3C4D.pdf". */
    statementFile: 'Kontoauszug',
    receiptFile: 'Buchungsbeleg',
    /** "04.10.2026, 14:32 Uhr (MESZ)" — a timestamp that says which clock it is on. */
    created: (date: string, time: string, zone: string | undefined) => `${date}, ${time} Uhr${zone ? ` (${zone})` : ''}`,
    /** The page count in the page margin, around the printer's own counters: "Seite 2 von 3". */
    pageOf: <T>(page: T, pages: T): (string | T)[] => ['Seite ', page, ' von ', pages],
    /** The letterhead of a bank without a name. */
    bank: 'Bank',
    institution: 'Kontoführendes Institut',
    blz: 'BLZ',
    generatedBy: (generator: string) =>
      `Erstellt mit ${generator} aus den Daten, die die Bank per FinTS übermittelt hat. Die Bank hat dieses Dokument nicht ausgestellt; maßgeblich sind ihre eigenen Kontoauszüge.`,
    checksum: 'Prüfsumme (SHA-256)',
    aheadNote:
      '„Noch nicht gebucht“: Die Bank hat den Umsatz bereits gemeldet, sein Buchungstag liegt aber nach dem Erstellungsdatum.',
    openingDerived:
      'Alter Kontostand errechnet: neuer Kontostand abzüglich der Umsätze, die er enthält. Einen Anfangssaldo hat die Bank nicht gemeldet.',
    closingDerived:
      'Neuer Kontostand errechnet: alter Kontostand zuzüglich der Umsätze dieses Auszugs. Einen Endsaldo hat die Bank nicht gemeldet.',
    noPending: 'Vorgemerkte Umsätze sind nicht enthalten: Die Bank hat sie noch nicht gebucht.',
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
    mixed: 'Die Umsätze sind in mehreren Währungen geführt und werden nicht addiert.',
    notReported: 'nicht gemeldet',
    /** Bookings dated after the closing balance's day: "Noch nicht enthalten: 2 Umsätze ab 05.10.2026". */
    notIncluded: (n: number, date: ReactNode) =>
      ['Noch nicht enthalten: ', n === 1 ? '1 Umsatz vom' : `${n} Umsätze ab`, ' ', date],
    /** The bank's balances do not fit the bookings, by `amount`. */
    unexplained: (amount: ReactNode) =>
      ['Alter und neuer Kontostand stammen von der Bank; die Umsätze dieses Auszugs erklären ', amount, ' des Unterschieds nicht.'],
    payee: 'Zahlungsempfänger',
    pendingLead: 'Vorgemerkt, noch nicht gebucht.',
    pendingBody: 'Betrag, Wertstellung und Referenzen können sich bis zur Buchung noch ändern.',
    aheadLead: 'Noch nicht gebucht.',
    aheadBody: (date: ReactNode) =>
      ['Die Bank meldet den Umsatz mit dem Buchungstag ', date, '; er liegt nach dem Erstellungsdatum dieses Belegs.'],
    recipientAccount: 'Empfängerkonto',
    debitedAccount: 'Belastetes Konto',
    payerAccount: 'Auftraggeberkonto',
    owner: 'Inhaber',
    booking: 'Buchung',
    bookingType: 'Buchungsart',
    /** Beside a Vormerkposten's Wertstellung. */
    provisional: 'vorläufig',
    receiptEnd: 'Ende des Buchungsbelegs',
    valueNote: 'Die Wertstellung (Valuta) bestimmt die Zinsberechnung und kann vom Buchungstag abweichen.',
    /** The credit line beside the balance: on an account, on a card. */
    overdraftLimit: 'Dispositionsrahmen',
    creditLimit: 'Kreditrahmen',
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
    noAccount: 'Kein Konto angegeben.',
    noStatements: 'Für dieses Konto bietet deine Bank keine Umsätze über FinTS an.',
    transactionsFailed: 'Umsätze konnten nicht geladen werden.',
    pendingFailed: 'Vorgemerkte Umsätze konnten nicht geladen werden.',
    balanceFailed: 'Kontostand konnte nicht geladen werden.',
  },

  /** The frame around a bank's answer in an error alert (components/BankAnswer.tsx): its return codes. */
  bankAnswer: {
    codes: (codes: string) => `Rückmeldung der Bank: ${codes}`,
  },
};

export const en: typeof de = {
  count: (n) => `${nEn(n)} ${n === 1 ? 'transaction' : 'transactions'}`,
  mayNeedApproval: 'May need approval.',
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
    busy: 'Possible once the current operation has finished.',
    loadingRange: (range) => `Loading ${range}…`,
    fetchedAt: (time) => `loaded at ${time}`,
    failedAt: (time) => `at ${time}`,
    pendingMatch: (n) => (n === 1 ? '1 pending transaction also matches' : `${n} pending transactions also match`),
    noStatements: 'No transactions for this account',
    noStatementsBody: 'Your bank doesn’t offer transaction retrieval for this account over FinTS.',
    loading: 'Loading transactions.',
    loadFailed: 'Could not load transactions',
    notFetched: 'Transactions not loaded yet',
    fetch: 'Load transactions',
    empty: 'No transactions in this period',
    nothingBooked: (range) => `Nothing was booked between ${range.replace(/\s*–\s*/, ' and ')}.`,
    longerPeriod: 'A longer period might show more.',
    noMatches: 'No matching transactions',
    resetFilters: 'Reset filters',
    quote: (word) => `“${word}”`,
    inLoaded: 'in the loaded period',
    inLoadedRange: (range) => ['in the loaded period (', range, ')'],
    notFound: (words, count, where) =>
      [words, count === 1 ? ' doesn’t appear in any transaction ' : ' don’t appear in any transaction ', where, '.'],
    allWordsApart: (query) => `Every word of “${query}” appears, but no transaction contains them all together.`,
    otherFilters: (query) => `“${query}” finds transactions, but none that match the other filters.`,
    noneInPeriod: 'No transaction in the loaded period matches these filters.',
    refresh: 'Refresh transactions.',
    failedKeptOld: (error) => `Could not load: ${error} Showing the most recently loaded transactions.`,
    switchTo: (account) => `Switch to “${account}”`,
    sentFromOther: (from, shown) =>
      `The transfer was sent from “${from}”. This list shows “${shown}” – you can only see whether it was completed in “${from}”.`,
    belongsToOther: (owner, shown) => `The transaction belongs to “${owner}”. This list shows “${shown}”.`,
    fetchedBeforeTransfer: (time) =>
      ['These transactions were loaded at ', time, ', before your transfer – it can’t be in this list yet.'],
    acrossAccounts: (account) => `The analysis counted all accounts with transactions. This list only shows ${account}.`,
    countOf: (shown, total) => `${nEn(shown)} of ${nEn(total)} ${total === 1 ? 'transaction' : 'transactions'}`,
    otherCurrency: (n) => `${n} in another currency, not added up`,
    reset: 'Reset',
    incomeTotal: 'Total money in',
    expenseTotal: 'Total money out',
    monthWords: (words) => `Also searched as a month: ${words.map((w) => `“${w.text}” (${w.month})`).join(', ')}`,
  },

  filter: {
    placeholder: 'Name, reference, category, amount, month',
    searchLabel: 'Search transactions',
    clear: 'Clear search',
    hint: 'Searches the name, payment reference, category and IBAN. Amounts like 12.99, over 100 as >100, 50 to 100 as 50-100, a day like 28/09 and a month like August.',
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
    mayNeedApproval: 'May need approval',
    title: 'Period',
    is: (label) => `Period: ${label}`,
    choose: 'Choose period',
    custom: 'Custom period',
    customMenu: 'Custom period…',
    busy: 'Please wait – another operation is still running.',
    load: 'Load period',
    startAfterEnd: 'The start is after the end.',
    startInFuture: 'The start is in the future.',
    endInFuture: 'No later than today.',
    from: 'From',
    to: 'To',
    longerHistory: 'May need approval. Some banks send less history.',
    apply: 'Apply',
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
    behindStatement: ', before transactions were last loaded',
    bookedSince: (n) => `${n} booked since`,
    matches: (n) => (n === 1 ? '1 matches your search' : `${n} match your search`),
    loadingShort: 'Loading…',
    refresh: 'Refresh pending transactions.',
    loading: 'Loading pending transactions.',
    intro: 'Announced direct debits and card payments your bank hasn’t booked yet.',
    fetch: 'Load pending transactions',
    showLess: 'Show less',
    showAll: (n) => `Show all ${n}`,
  },

  days: {
    skip: 'Skip list',
    future: 'These transactions carry a booking date in the future – the bank only books them on that day.',
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

  detail: {
    title: 'Transaction details',
    pendingTitle: 'Pending transaction',
    paidOn: (day, time) => `paid on ${day}${time ? ` at ${time}` : ''}`,
    status: 'Status',
    repeat: 'Transfer again',
    refund: 'Transfer back',
    receipt: 'Receipt (PDF)',
    payment: 'Payment',
    paidAt: 'Paid on',
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
    ruled: (name, label) => `All transactions with ${name} are now filed under “${label}” – future ones too.`,
    undone: (label, byRule) => `Back to “${label}”, ${byRule ? 'as your rule says' : 'recognised automatically'}.`,
    unruled: (name) => `Rule removed. Transactions with ${name} are filed automatically again.`,
    change: 'Change',
    changeLabel: (label) => `Change category, currently ${label}`,
    yourRuleFor: (name) => `Your rule for ${name}`,
    howAppFiles: 'How the app files the transaction',
    undoItem: (byRule, label) => `${byRule ? 'As the rule says' : 'Automatic'} (${label})`,
    removeRule: (name) => `Remove rule for ${name}`,
    offerOthers: (n, name, label) =>
      `Also file ${n === 1 ? 'the other transaction' : `the ${nEn(n)} other transactions`} with ${name} under “${label}”?`,
    offerFuture: (name, label) => `Also file future transactions with ${name} under “${label}”?`,
    alsoFuture: 'This then also applies to future transactions.',
    applyAll: 'Apply to all',
    saveRule: 'Save as rule',
    sessionOnly: 'Only applies to this session – your personal data isn’t being saved right now.',
    rules: 'Your rules',
    remove: 'Remove',
  },

  doc: {
    pdfFailed: (error) => `Could not save the PDF: ${error}`,
    statementFile: 'Account_statement',
    receiptFile: 'Transaction_receipt',
    created: (date, time, zone) => `${date}, ${time}${zone ? ` (${zone})` : ''}`,
    pageOf: (page, pages) => ['Page ', page, ' of ', pages],
    bank: 'Bank',
    institution: 'Account-holding institution',
    blz: 'Bank code',
    generatedBy: (generator) =>
      `Created with ${generator} from the data the bank sent over FinTS. The bank did not issue this document; its own account statements are authoritative.`,
    checksum: 'Checksum (SHA-256)',
    aheadNote:
      '“Not booked yet”: the bank has already reported the transaction, but its booking date is after the date this document was created.',
    openingDerived:
      'Opening balance calculated: closing balance minus the transactions it contains. The bank did not report an opening balance.',
    closingDerived:
      'Closing balance calculated: opening balance plus the transactions on this statement. The bank did not report a closing balance.',
    noPending: 'Pending transactions are not included: the bank has not booked them yet.',
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
    mixed: 'The transactions are in more than one currency and are not added up.',
    notReported: 'not reported',
    notIncluded: (n, date) => ['Not yet included: ', n === 1 ? '1 transaction dated' : `${n} transactions from`, ' ', date],
    unexplained: (amount) =>
      ['The opening and closing balances come from the bank; the transactions on this statement do not explain ', amount, ' of the difference.'],
    payee: 'Payee',
    pendingLead: 'Pending, not booked yet.',
    pendingBody: 'The amount, value date and references may still change until the transaction is booked.',
    aheadLead: 'Not booked yet.',
    aheadBody: (date) =>
      ['The bank reports the transaction with the booking date ', date, ', which is after the date this receipt was created.'],
    recipientAccount: 'Recipient account',
    debitedAccount: 'Debited account',
    payerAccount: 'Payer account',
    owner: 'Holder',
    booking: 'Booking',
    bookingType: 'Booking type',
    provisional: 'provisional',
    receiptEnd: 'End of transaction receipt',
    valueNote: 'The value date determines how interest is calculated and can differ from the booking date.',
    overdraftLimit: 'Overdraft limit',
    creditLimit: 'Credit limit',
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
    noAccount: 'No account specified.',
    noStatements: 'Your bank doesn’t offer transactions for this account over FinTS.',
    transactionsFailed: 'Could not load transactions.',
    pendingFailed: 'Could not load pending transactions.',
    balanceFailed: 'Could not load the balance.',
  },

  bankAnswer: {
    codes: (codes) => `Response from the bank: ${codes}`,
  },
};
