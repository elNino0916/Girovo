// Sending and requesting money: the transfer sheet and its steps (components/TransferSheet, components/transfer), Namensabgleich (VopResult), Geld anfordern (ShareAccount), GiroCode, and the transfer route's answers.

import type { ReactNode } from 'react';

// "aus der Schweiz", "aus den Niederlanden" — the handful of country names (as
// Intl writes them in German) that take an article. Everything else reads fine
// bare.
const DE_WITH_ARTICLE: Record<string, string> = {
  Schweiz: 'der Schweiz', Slowakei: 'der Slowakei', Niederlande: 'den Niederlanden',
  'Vereinigtes Königreich': 'dem Vereinigten Königreich', 'Republik Moldau': 'der Republik Moldau',
};
const countryDative = (name: string) => DE_WITH_ARTICLE[name] ?? name;

// "from the Netherlands": the SEPA countries English names with an article.
const EN_WITH_ARTICLE = new Set(['Netherlands', 'United Kingdom']);
const theCountry = (name: string) => (EN_WITH_ARTICLE.has(name) ? `the ${name}` : name);

export const de = {
  /** The sheet's heading on each step; Freigabe and Status unklar are common's. */
  titles: {
    form: 'Überweisung',
    review: 'Überweisung prüfen',
    vop: 'Namensabgleich',
    done: 'Überweisung ausgeführt',
    refused: 'Überweisung nicht ausgeführt',
  },
  /** The chip above the payee: where the prefilled values came from. */
  source: {
    invoice: 'Aus der Rechnung gelesen – bitte prüfen',
    girocode: 'Aus GiroCode übernommen',
    template: (label: string) => `Vorlage: ${label}`,
    templateUnnamed: 'Aus Vorlage übernommen',
    repeat: 'Erneut überweisen',
    refund: 'Rückzahlung',
    recent: 'Letzter Empfänger',
  },
  /** What the sheet announces to a screen reader. */
  live: {
    step: (n: number, total: number, title: string) => `Schritt ${n} von ${total}: ${title}.`,
    girocode: (name: string, amount: string | null) => `GiroCode übernommen: ${name}${amount != null ? `, ${amount}` : ''}.`,
    invoice: 'Angaben aus der Rechnung übernommen. Bitte prüfe sie.',
    template: (label: string) => `Vorlage „${label}“ übernommen.`,
    checkFields: (n: number) => (n === 1 ? 'Bitte prüfe das markierte Feld.' : `Bitte prüfe die ${n} markierten Felder.`),
  },
  /** A time of day: "13:12 Uhr". */
  clock: (time: string) => `${time} Uhr`,
  recipient: 'Empfänger',
  /** The form's check, the GiroCode's (lib/girocode.ts) and the transfer route's. */
  nameMissing: 'Bitte gib den Namen des Empfängers an.',
  /** The GiroCode's check (lib/girocode.ts) and the transfer route's. */
  bicInvalid: 'Die BIC ist ungültig.',
  form: {
    /** Android's phone flow, for a screen reader: Betrag, An wen?, Prüfen. */
    part: (n: number, of: number) => `Schritt ${n} von ${of}`,
    fromAccount: 'Von Konto',
    recent: 'Letzte Empfänger',
    /** In a recent payee's tooltip, for one of your own accounts. */
    ownAccount: 'Eigenes Konto',
    name: 'Name',
    nameHint: 'Wie auf dem Konto des Empfängers – deine Bank prüft den Namen.',
    namePlaceholder: 'Vor- und Nachname oder Firma',
    payment: 'Zahlung',
    available: 'Verfügbar',
    /** Standard or Echtzeit — the form's switch and the review's row. */
    execution: 'Ausführung',
    standard: 'Standard',
    noInstant: 'Echtzeit bietet deine Bank für dieses Konto hier nicht an.',
    instantHint: 'In Sekunden beim Empfänger, rund um die Uhr.',
    charsLeft: (n: number) => `Noch ${n} Zeichen.`,
    countsWrittenOut: 'Umlaute und Sonderzeichen zählen ausgeschrieben (ä → ae).',
    purposePlaceholder: 'z. B. Rechnung 2026-118',
    chooseAccount: 'Bitte wähle das Konto, von dem du überweist.',
    nameUnsendable: 'Keines dieser Zeichen kann eine Überweisung übertragen.',
    nameTooLong: (length: number, max: number) =>
      `Name zu lang: ${length} Zeichen, höchstens ${max}. `
      + 'Umlaute und Sonderzeichen zählen ausgeschrieben (ä → ae).',
    /** `over`: how many characters too many, counted as the bank counts. */
    purposeTooLong: (over: number) =>
      `${over === 1 ? 'Ein Zeichen' : `${over} Zeichen`} zu lang. `
      + 'Umlaute und Sonderzeichen zählen ausgeschrieben (ä → ae, € → EUR).',
    amountMissing: 'Bitte gib den Betrag an.',
  },
  /** A typed amount that cannot be sent (components/transfer/model.ts). */
  amount: {
    invalid: 'Bitte gib einen gültigen Betrag an, zum Beispiel 25,00.',
    notPositive: 'Der Betrag muss größer als 0,00 € sein.',
    tooLarge: 'Der Betrag darf höchstens 999.999.999,99 € betragen.',
  },
  /** Why a typed IBAN is not a usable one (components/transfer/iban.ts). */
  iban: {
    missing: 'Bitte gib die IBAN des Empfängers an.',
    countryCode: 'Eine IBAN beginnt mit dem Ländercode, zum Beispiel „DE“.',
    checkDigits: 'Nach dem Ländercode kommen zwei Ziffern.',
    /** `country`: its name as Intl writes it, or null when there is none. */
    length: (length: number, typed: number, country: string | null) =>
      `Eine IBAN ${country ? `aus ${countryDative(country)} ` : ''}hat ${length} Stellen – eingegeben sind ${typed}.`,
    checksum: 'Die IBAN stimmt nicht. Bitte vergleiche sie Zeichen für Zeichen.',
    own: 'Von diesem Konto überweist du. Bitte gib die IBAN des Empfängers an.',
  },
  /** Under the IBAN field, once it passes. */
  ibanHint: {
    notSepa: 'Überweisungen gehen nur an Konten im SEPA-Raum.',
    lookingUp: 'Bank wird gesucht …',
    unknownBank: 'IBAN gültig. Girovo kennt diese Bank nicht.',
    /** `country`: named for an IBAN from abroad, else null. */
    // "in den Niederlanden", "in der Schweiz": the article the dative needs.
    valid: (country: string | null) => `IBAN gültig${country ? ` · Konto in ${countryDative(country)}` : ''}.`,
  },
  /** Reading a GiroCode off an image (components/transfer/GiroCodeDrop.tsx). */
  giro: {
    read: 'GiroCode oder Rechnung einlesen',
    reading: 'Wird gelesen …',
    /** The same, for a screen reader's status line. */
    readingStatus: 'Wird gelesen',
    dropHere: 'Hier ablegen',
    pick: 'Bild oder PDF auswählen',
    pickOrDrop: 'Bild oder PDF wählen, hierher ziehen oder mit Strg+V einfügen',
    /** Android: the camera, through Google's code scanner. */
    scan: 'GiroCode scannen',
    /** Android: an invoice without a GiroCode, photographed and read for its text. */
    scanInvoice: 'Rechnung scannen',
    /** Android: the same from an image or a PDF of the invoice. */
    fromFile: 'Aus Bild oder PDF',
    errors: {
      notAnImage: 'Bitte wähle ein Bild mit dem GiroCode.',
      notAnImageOrPdf: 'Bitte wähle ein Bild oder PDF der Rechnung.',
      noScanner: 'Scannen geht auf diesem Telefon nicht. Wähle ein Bild oder PDF der Rechnung.',
      scanFailed: 'Scannen hat nicht geklappt. Versuch es noch einmal oder wähle eine Datei.',
      noCode: 'Kein GiroCode gefunden. Nimm ein scharfes Bild mit dem ganzen Code.',
      nothingRead: 'Kein GiroCode und keine IBAN gefunden. Nimm ein scharfes Bild der ganzen Rechnung.',
      notEpc: 'Das ist kein GiroCode für eine Überweisung in Euro.',
    },
  },
  /** One wording for the hint under Betrag and the warning on Prüfen. */
  funds: {
    over: (available: boolean) => `Mehr als ${available ? 'verfügbar' : 'dein Kontostand'} – die Bank kann die Zahlung ablehnen.`,
    /** The balance afterwards arrives as text or as an element. */
    overdraft: (amount: ReactNode): ReactNode[] => ['Kontostand danach ca. ', amount, ' – du nutzt deinen Dispo.'],
  },
  /** The sheet's buttons. */
  actions: {
    toReview: 'Weiter zur Prüfung',
    /** Android's phone flow: from the amount on to the payee. */
    toPayee: 'Weiter: An wen?',
    check: 'Angaben prüfen',
    back: 'Zurück',
    sendNow: 'Jetzt überweisen',
    sendAnyway: 'Trotzdem überweisen',
    /** Take over the name the bank holds for the IBAN. */
    adoptName: 'Namen übernehmen',
    sendUnchecked: 'Ohne Abgleich überweisen',
    sendNoResult: 'Ohne Ergebnis überweisen',
    approve: 'Überweisung freigeben',
    refresh: 'Umsätze aktualisieren',
    lookNow: 'Jetzt nachsehen',
    lookAgain: 'Noch einmal nachsehen',
    change: 'Angaben ändern',
  },
  /** The "Prüfen" step (components/transfer/Review.tsx). */
  review: {
    creditDate: (date: ReactNode): ReactNode[] => ['Gutschrift voraussichtlich ', date],
    duplicateTitle: 'Schon einmal überwiesen?',
    to: 'An',
    from: 'Von',
    /** An empty Verwendungszweck. */
    none: 'ohne',
    instantTransfer: 'Echtzeitüberweisung',
    standardTransfer: 'Standardüberweisung',
    /** When the money reaches the payee. */
    credit: 'Gutschrift',
    inSeconds: 'in Sekunden',
    expected: (date: string) => `voraussichtlich ${date}`,
    availableAfter: 'Verfügbar danach',
    balanceAfter: 'Kontostand danach',
    approx: 'ca.',
    asOf: (date: string) => `Stand ${date}`,
    rewritten: 'So kommt es bei der Bank an: Umlaute ausgeschrieben (ä → ae), nicht erlaubte Zeichen weggelassen.',
  },
  /** The Namensabgleich step of the sheet. */
  vopStep: {
    /** No usable result (no check, still running, unclear): the verdict below says which. */
    introUnchecked: (amount: ReactNode): ReactNode[] => ['Prüfe die Angaben, bevor du ', amount, ' freigibst.'],
    intro: (amount: ReactNode): ReactNode[] => [
      'Die Bank hat den Namen zur IBAN geprüft. Sieh dir das Ergebnis an, bevor du ',
      amount,
      ' freigibst.',
    ],
    askPayee: 'Frag den Empfänger, ob Name und IBAN stimmen – auf einem Weg, den du schon kennst, nicht über die '
      + 'Rechnung oder E-Mail mit der IBAN.',
    risk: 'Gibst du trotz Abweichung frei, trägst du das Risiko, dass das Geld beim falschen Empfänger ankommt.',
  },
  /** The bank's Namensabgleich result (components/VopResult.tsx). */
  vop: {
    /** Said of every verdict without a result: nothing was compared, nothing confirmed. */
    unconfirmed: 'Niemand hat bestätigt, dass die IBAN zu diesem Namen gehört.',
    verdicts: {
      MATCH: {
        label: 'Name stimmt überein',
        blurb: 'Die Bank führt diese IBAN unter diesem Namen.',
      },
      CLOSE_MATCH: {
        label: 'Name weicht leicht ab',
        blurb: 'Die Bank führt diese IBAN unter einem ähnlichen, aber anderen Namen.',
      },
      NO_MATCH: {
        label: 'Name stimmt nicht überein',
        blurb: 'Die Bank führt diese IBAN unter einem anderen Namen.',
      },
      NOT_APPLICABLE: { label: 'Kein Abgleich möglich', blurb: 'Der Name konnte nicht geprüft werden.' },
      PENDING: { label: 'Prüfung läuft noch', blurb: 'Der Name konnte noch nicht geprüft werden.' },
      UNKNOWN: { label: 'Prüfergebnis unklar', blurb: 'Girovo versteht das Ergebnis der Bank nicht.' },
    },
    /** The TAN overlay's one line. */
    badge: (label: string) => `Namensabgleich: ${label}`,
    submitted: 'Von dir angegeben',
    suggested: 'Bei der Bank hinterlegt',
    reason: 'Grund',
    bankNote: 'Hinweis deiner Bank',
  },
  /** The "ausgeführt" step. */
  done: {
    to: (name: string) => `an ${name}`,
    instant: 'Echtzeitüberweisung – in Sekunden beim Empfänger.',
    appears: 'Die Buchung erscheint in deinen Umsätzen, sobald die Bank sie meldet.',
    /** `action`: the refresh button's label. */
    pastRange: (date: string, action: string) =>
      `Dein Zeitraum endet am ${date}: „${action}“ lädt die Umsätze bis heute. Kann eine Freigabe erfordern.`,
    refreshHint: (action: string) => `Mit „${action}“ siehst du gleich nach. Kann eine Freigabe erfordern.`,
  },
  /** The "Status unklar" step and what "Jetzt nachsehen" found. */
  unknown: {
    noConfirmation: 'Keine Bestätigung erhalten. Die Überweisung kann trotzdem bei deiner Bank angekommen sein und '
      + 'ausgeführt werden.',
    /** `action`: the check button's label. */
    beforeResend: (action: string) =>
      `Bevor du sie erneut sendest: „${action}“ sucht sie in deinen Umsätzen und den vorgemerkten. `
      + 'Kann eine Freigabe erfordern.',
    loadingPending: 'Vorgemerkte Umsätze werden geladen …',
    loading: 'Umsätze werden geladen …',
    sent: 'Gesendet',
    foundBooked: 'Gefunden in deinen Umsätzen',
    foundPending: 'Gefunden bei den vorgemerkten Umsätzen',
    /** `bookedOn`: the booking date, when it was found among the bookings. */
    found: (amount: ReactNode, name: string, bookedOn: ReactNode | null): ReactNode[] => [
      amount,
      ` an ${name}`,
      ...(bookedOn != null ? [', gebucht am ', bookedOn] : []),
      '. Sende die Überweisung nicht noch einmal.',
    ],
    /** Payments like it are there, but each may be an older one or another order's. */
    unsure: 'Nicht eindeutig – bitte nicht erneut senden',
    /** `count` of them; one is named with `bookedOn` as in found (null: a Vormerkposten). */
    unsureText: (count: number, amount: ReactNode, name: string, bookedOn: ReactNode | null): ReactNode[] => (count > 1
      ? [
        `${count} gleiche Zahlungen über `,
        amount,
        ` an ${name} gefunden. Ob diese Überweisung dabei ist, ist unklar. Prüfe es im Online-Banking deiner Bank.`,
      ]
      : [
        bookedOn != null ? 'In deinen Umsätzen steht eine Zahlung über ' : 'Bei den vorgemerkten Umsätzen steht eine Zahlung über ',
        amount,
        ` an ${name}`,
        ...(bookedOn != null ? [', gebucht am ', bookedOn] : []),
        '. Ob das diese Überweisung ist oder eine frühere, ist unklar. Prüfe es im Online-Banking deiner Bank.',
      ]),
    failedBooked: 'Umsätze konnten nicht geladen werden.',
    failedPending: 'Vorgemerkte Umsätze konnten nicht geladen werden.',
    notVisible: 'Noch nicht sichtbar – bitte nicht erneut senden',
    notChecked: 'Nachsehen nicht möglich – bitte nicht erneut senden',
    /** Where the check looked, as `notYet` names it — only what was actually read. */
    searched: (booked: boolean, pending: boolean) =>
      [booked && 'deinen Umsätzen', pending && 'den vorgemerkten Umsätzen'].filter(Boolean).join(' und '),
    notYet: (places: string, time: ReactNode): ReactNode[] => [
      `In ${places} steht sie noch nicht (Stand `,
      time,
      '). Manche Banken zeigen sie erst später. Sieh später noch einmal nach oder prüfe es im Online-Banking deiner Bank.',
    ],
    nothingToRead: 'Deine Bank zeigt Girovo für dieses Konto keine Umsätze. Prüfe es im Online-Banking deiner Bank.',
    tryAgain: 'Versuche es gleich noch einmal oder prüfe es im Online-Banking deiner Bank.',
  },
  refused: {
    withReason: 'Deine Bank hat abgelehnt:',
    plain: 'Deine Bank hat abgelehnt.',
  },
  /** The bank's own words on a result step. */
  bankAnswer: {
    label: 'Antwort deiner Bank',
    /** Under a refusal: its code, for a call to the bank. */
    reference: (code: ReactNode): ReactNode[] => ['Fehlercode: ', code],
  },
  /**
   * Closing the sheet before anything was sent. `order`: a Dauerauftrag or a
   * Terminüberweisung, which is an Auftrag, not an Überweisung.
   */
  discard: {
    title: 'Eingaben verwerfen?',
    body: (order: boolean) =>
      `${order ? 'Der Auftrag' : 'Die Überweisung'} ist noch nicht gesendet. Deine Eingaben gehen verloren.`,
    keep: 'Weiter bearbeiten',
    confirm: 'Verwerfen',
  },
  /** Closing the sheet on the Namensabgleich step. `order`: as for discard. */
  discardVop: {
    title: (order: boolean): string => (order ? 'Auftrag verwerfen?' : 'Überweisung verwerfen?'),
    body: 'Deine Bank hat die Angaben, aber keine Freigabe. Verwirfst du jetzt, wird kein Geld überwiesen.',
    keep: 'Weiter prüfen',
    confirm: (order: boolean): string => (order ? 'Auftrag verwerfen' : 'Überweisung verwerfen'),
  },
  /** A payment that looks like one already made (lib/transfer-checks.ts). Amounts and dates arrive formatted. */
  duplicate: {
    todayAt: (time: string) => `Heute um ${time}`,
    dayAt: (date: string, time: string) => `Am ${date} um ${time}`,
    /** `when`: todayAt or dayAt. */
    sent: (when: string, money: string, who: string) => `${when} hast du bereits ${money} an ${who} überwiesen.`,
    sentUnclear: (when: string, money: string, who: string) =>
      `${when} hast du bereits eine Überweisung über ${money} an ${who} gesendet – ihr Status ist unklar.`,
    debitPending: (who: string, money: string) => `${who} zieht bereits ${money} per Lastschrift ein – die Buchung ist vorgemerkt.`,
    pending: (money: string, who: string) => `Bei deinen vorgemerkten Umsätzen steht bereits eine Zahlung über ${money} an ${who}.`,
    debitBooked: (date: string, who: string, money: string) => `Am ${date} hat ${who} bereits ${money} per Lastschrift eingezogen.`,
    booked: (date: string, money: string, who: string) => `Am ${date} hast du bereits ${money} an ${who} überwiesen.`,
  },
  /** Vorlagen (components/transfer/Templates.tsx). */
  templates: {
    menu: 'Vorlagen',
    loading: 'Vorlagen werden geladen …',
    unavailable: 'Vorlagen konnten gerade nicht geladen werden.',
    use: 'Vorlage verwenden',
    noneYet: 'Noch keine Vorlagen.',
    howToSave: 'Nach einer Überweisung kannst du den Empfänger als Vorlage speichern.',
    manage: 'Vorlagen verwalten …',
    manageTitle: 'Vorlagen verwalten',
    manageDescription: 'Vorlagen sind verschlüsselt und nur nach der Anmeldung lesbar.',
    notSaving: 'Änderungen werden gerade nicht gespeichert.',
    renamed: (label: string) => `Vorlage in „${label}“ umbenannt.`,
    deleted: (label: string) => `Vorlage „${label}“ gelöscht.`,
    restored: (label: string) => `Vorlage „${label}“ wiederhergestellt.`,
    undo: 'Rückgängig',
    undoLabel: (label: string) => `Rückgängig – „${label}“ wiederherstellen`,
    none: 'Keine Vorlagen',
    newName: (label: string) => `Neuer Name für „${label}“`,
    rename: (label: string) => `„${label}“ umbenennen`,
    remove: (label: string) => `„${label}“ löschen`,
    saved: (label: string) => `Als Vorlage „${label}“ gespeichert.`,
    alreadySaved: (label: string) => `Schon als Vorlage „${label}“ gespeichert.`,
    nameLabel: 'Name der Vorlage',
    saveHint: 'Empfänger, IBAN, Betrag und Verwendungszweck – verschlüsselt auf diesem Gerät.',
    save: 'Als Vorlage speichern',
  },
  /** Geld anfordern (components/ShareAccount.tsx). */
  /** The invoice's page beside the transfer (components/transfer/InvoicePreview.tsx). */
  invoice: {
    title: 'Rechnung',
    amount: 'Betrag',
    noAmount: 'Kein Betrag gefunden',
    from: (account: string) => `von ${account}`,
    change: 'Ändern',
    marked: 'Markiert ist, was Girovo übernommen hat.',
    /** The desktop: the line of the field in use, magnified. */
    lens: 'Auf der Rechnung',
    enlarge: 'Rechnung groß anzeigen',
    debit: 'Laut Rechnung wird per Lastschrift eingezogen – musst du überhaupt überweisen?',
  },

  share: {
    title: 'Geld anfordern',
    /** Aufteilen: on to the next person's request; after the last, done. */
    next: (name: string) => `Weiter: ${name}`,
    done: 'Fertig',
    /** Aufteilen's requests, one per person: "Für Lea · 1 von 2". */
    forWhom: (name: string, step?: { at: number; of: number }) =>
      (step && step.of > 1 ? `Für ${name} · ${step.at} von ${step.of}` : `Für ${name}`),
    intro: 'Wer dir Geld schickt, scannt den Code mit der Banking-App – die Überweisung ist dann ausgefüllt.',
    amountInvalid: 'Bitte gib einen Betrag wie 25,00 an – oder lass das Feld leer.',
    amountNotPositive: 'Der Betrag muss größer als 0,00 € sein – oder lass das Feld leer.',
    codeFailed: 'Der GiroCode konnte nicht erstellt werden.',
    copyFailed: 'Kopieren war nicht möglich.',
    imageCopyFailed: 'Kopieren ging nicht. Speichere das Bild als PNG.',
    imageSaveFailed: 'Das Bild konnte nicht gespeichert werden.',
    /** No amount in the code: the payer fills it in. */
    anyAmount: 'Betrag frei wählbar',
    copyDetails: 'Kontodaten kopieren',
    copyImage: 'Bild kopieren',
    savePng: 'Als PNG speichern',
    detailsCopied: 'Kontodaten kopiert',
    imageCopied: 'GiroCode als Bild kopiert',
    /** Under the code in a copied, saved or shared image. */
    imageCaption: 'Erstellt mit Girovo · girovo.de',
    covered: 'Beträge sind ausgeblendet – der Code verrät den Betrag jedem, der ihn scannt.',
    showCode: 'Code anzeigen',
    /** The code's description for a screen reader. */
    codeLabel: (name: string, amount: string) => `GiroCode: Überweisung an ${name}, ${amount}`,
    checkAmount: 'Bitte prüfe den Betrag.',
    noCode: 'Kein GiroCode – bitte prüfe die Angaben.',
    yourName: 'Dein Name',
    /** Quotes the Namensabgleich's "Name stimmt nicht überein". */
    nameDiffers: (holder: string) =>
      `Weicht vom Kontoinhaber „${holder}“ ab. Wer zahlt, sieht dann womöglich „Name stimmt nicht überein“.`,
    useHolder: 'Kontoinhaber übernehmen',
    nameHint: 'So, wie deine Bank den Kontoinhaber führt.',
    amountHint: 'Leer lassen, wenn die zahlende Person den Betrag selbst eingibt.',
    purposePlaceholder: 'z. B. Anteil Konzertkarten',
    copyBic: 'BIC kopieren',
    explainer: 'Der Code enthält nur Name, IBAN, BIC, Betrag und Verwendungszweck. '
      + 'Wer zahlt, gibt die Überweisung in der eigenen App frei.',
  },
  /** Why a GiroCode cannot be built (lib/girocode.ts). */
  epc: {
    amountNaN: 'Der Betrag ist keine gültige Zahl.',
    amountDecimals: 'Der Betrag darf höchstens zwei Nachkommastellen haben.',
    amountRange: 'Der Betrag muss zwischen 0,01 € und 999.999.999,99 € liegen.',
    nameTooLong: (max: number) => `Der Name darf höchstens ${max} Zeichen lang sein.`,
    ibanInvalid: 'Die IBAN ist ungültig.',
    purposeTooLong: (max: number) => `Der Verwendungszweck darf höchstens ${max} Zeichen lang sein.`,
    tooLong: 'Name und Verwendungszweck sind zusammen zu lang. Bitte kürze den Verwendungszweck.',
  },
  /** Drawing a QR code (lib/qr.ts). */
  qr: {
    tooLong: 'Der Inhalt ist zu lang für einen QR-Code.',
    browserOnly: 'Das Bild lässt sich hier nicht erstellen.',
    imageFailed: 'Das Bild konnte nicht erzeugt werden.',
  },
  /**
   * The SEPA tags of a structured Verwendungszweck (lib/sepa-purpose.ts), as a
   * booking's details name them. CRED and SVWZ are common's (Gläubiger-ID,
   * Verwendungszweck); IBAN and BIC are their own names.
   */
  purposeTags: {
    EREF: 'End-to-End-Referenz',
    KREF: 'Kundenreferenz',
    MREF: 'Mandatsreferenz',
    DEBT: 'Originator-ID',
    COAM: 'Zinskompensationsbetrag',
    OAMT: 'Ursprungsbetrag',
    ABWA: 'Abweichender Auftraggeber',
    ABWE: 'Abweichender Empfänger',
    RTRN: 'Rückgabegrund',
    ORCR: 'Ursprüngliche Gläubiger-ID',
    ORMR: 'Ursprüngliche Mandatsreferenz',
    DDAT: 'Fälligkeitsdatum',
    PURP: 'Zahlungsart',
  },
  /** The answers of /api/transfer and /api/vop-confirm. */
  route: {
    nameTooLong: (max: number) => `Der Name ist zu lang: höchstens ${max} Zeichen, Umlaute zählen doppelt.`,
    ibanInvalid: 'Die IBAN ist ungültig.',
    amountInvalid: 'Der Betrag ist ungültig.',
    purposeTooLong: (max: number) => `Der Verwendungszweck ist zu lang: höchstens ${max} Zeichen, Umlaute zählen doppelt.`,
    unknownAccount: 'Unbekanntes Konto.',
    sameIban: 'Der Empfänger hat dieselbe IBAN wie dein Konto.',
    noIban: 'Von diesem Konto kannst du nicht überweisen – es hat keine IBAN.',
    unsupported: (instant: boolean) =>
      `Deine Bank bietet für dieses Konto hier keine ${instant ? 'Echtzeitüberweisungen' : 'Überweisungen'} an.`,
    vopRequired: 'Deine Bank verlangt einen Namensabgleich, bietet ihn hier aber nicht an. '
      + 'Überweise bitte im Online-Banking deiner Bank.',
    vopIncomplete: 'Die Bank prüft den Namen noch. Versuch es gleich noch einmal.',
    vopWithdrawn: 'Die Bank hat die Freigabe ohne Prüfergebnis zurückgezogen.',
    noHold: 'Nichts wartet auf die Bestätigung des Namensabgleichs.',
    holdExpired: 'Das Prüfergebnis ist zu alt. Starte die Überweisung noch einmal.',
  },
};

export const en: typeof de = {
  titles: {
    form: 'Transfer',
    review: 'Review transfer',
    vop: 'Name check',
    done: 'Transfer completed',
    refused: 'Transfer not completed',
  },
  source: {
    invoice: 'Read from the invoice – please check',
    girocode: 'From GiroCode',
    template: (label) => `Template: ${label}`,
    templateUnnamed: 'From template',
    repeat: 'Transfer again',
    refund: 'Refund',
    recent: 'Recent recipient',
  },
  live: {
    step: (n, total, title) => `Step ${n} of ${total}: ${title}.`,
    girocode: (name, amount) => `GiroCode applied: ${name}${amount != null ? `, ${amount}` : ''}.`,
    invoice: 'Details taken from the invoice. Please check them.',
    template: (label) => `Template “${label}” applied.`,
    checkFields: (n) => (n === 1 ? 'Please check the highlighted field.' : `Please check the ${n} highlighted fields.`),
  },
  clock: (time) => time,
  recipient: 'Recipient',
  nameMissing: 'Please enter the recipient’s name.',
  bicInvalid: 'The BIC is invalid.',
  form: {
    part: (n, of) => `Step ${n} of ${of}`,
    fromAccount: 'From account',
    recent: 'Recent recipients',
    ownAccount: 'Your own account',
    name: 'Name',
    nameHint: 'As on the recipient’s account – your bank checks the name.',
    namePlaceholder: 'First and last name, or company',
    payment: 'Payment',
    available: 'Available',
    execution: 'Transfer type',
    standard: 'Standard',
    noInstant: 'Your bank does not offer instant transfers here for this account.',
    instantHint: 'Reaches the recipient in seconds, around the clock.',
    charsLeft: (n) => (n === 1 ? '1 character left.' : `${n} characters left.`),
    countsWrittenOut: 'Umlauts and special characters count as written out (ä → ae).',
    purposePlaceholder: 'e.g. Invoice 2026-118',
    chooseAccount: 'Please choose the account you are transferring from.',
    nameUnsendable: 'A transfer cannot carry any of these characters.',
    nameTooLong: (length, max) =>
      `Name too long: ${length} characters, at most ${max}. `
      + 'Umlauts and special characters count as written out (ä → ae).',
    purposeTooLong: (over) =>
      `${over === 1 ? 'One character' : `${over} characters`} too long. `
      + 'Umlauts and special characters count as written out (ä → ae, € → EUR).',
    amountMissing: 'Please enter the amount.',
  },
  amount: {
    invalid: 'Please enter a valid amount, for example 25.00.',
    notPositive: 'The amount must be more than €0.00.',
    tooLarge: 'The amount must not exceed €999,999,999.99.',
  },
  iban: {
    missing: 'Please enter the recipient’s IBAN.',
    countryCode: 'An IBAN starts with the country code, for example “DE”.',
    checkDigits: 'Two digits follow the country code.',
    length: (length, typed, country) =>
      `An IBAN ${country ? `from ${theCountry(country)} ` : ''}has ${length} characters – you entered ${typed}.`,
    checksum: 'The IBAN is not right. Please compare it character by character.',
    own: 'You are transferring from this account. Please enter the recipient’s IBAN.',
  },
  ibanHint: {
    notSepa: 'Transfers only reach accounts in the SEPA area.',
    lookingUp: 'Looking up the bank…',
    unknownBank: 'IBAN valid. Girovo does not know this bank.',
    valid: (country) => `IBAN valid${country ? ` · account in ${theCountry(country)}` : ''}.`,
  },
  giro: {
    read: 'Read a GiroCode or invoice',
    reading: 'Reading…',
    readingStatus: 'Reading',
    dropHere: 'Drop it here',
    pick: 'Choose an image or PDF',
    pickOrDrop: 'Choose an image or PDF, drag it here or paste it with Ctrl+V',
    scan: 'Scan GiroCode',
    scanInvoice: 'Scan invoice',
    fromFile: 'From image or PDF',
    errors: {
      notAnImage: 'Please choose an image with the GiroCode.',
      notAnImageOrPdf: 'Please choose an image or PDF of the invoice.',
      noScanner: 'Scanning isn’t available on this phone. Choose an image or PDF of the invoice.',
      scanFailed: 'Scanning didn’t work. Try again or choose a file.',
      noCode: 'No GiroCode found. Use a sharp image of the whole code.',
      nothingRead: 'No GiroCode or IBAN found. Use a sharp image of the whole invoice.',
      notEpc: 'This is not a GiroCode for a transfer in euros.',
    },
  },
  funds: {
    over: (available) => `More than ${available ? 'is available' : 'your balance'} – the bank may decline the payment.`,
    overdraft: (amount) => ['Balance afterwards: about ', amount, ' – you will be using your overdraft.'],
  },
  actions: {
    toReview: 'Continue to review',
    toPayee: 'Next: to whom?',
    check: 'Check details',
    back: 'Back',
    sendNow: 'Transfer now',
    sendAnyway: 'Transfer anyway',
    adoptName: 'Use this name',
    sendUnchecked: 'Transfer without name check',
    sendNoResult: 'Transfer without check result',
    approve: 'Approve transfer',
    refresh: 'Refresh transactions',
    lookNow: 'Check now',
    lookAgain: 'Check again',
    change: 'Change details',
  },
  review: {
    creditDate: (date) => ['Expected to arrive on ', date],
    duplicateTitle: 'Already transferred?',
    to: 'To',
    from: 'From',
    none: 'none',
    instantTransfer: 'Instant transfer',
    standardTransfer: 'Standard transfer',
    credit: 'Arrives',
    inSeconds: 'in seconds',
    expected: (date) => `expected on ${date}`,
    availableAfter: 'Available afterwards',
    balanceAfter: 'Balance afterwards',
    approx: 'approx.',
    asOf: (date) => `as of ${date}`,
    rewritten: 'This is how the bank gets it: umlauts written out (ä → ae), characters it does not allow left out.',
  },
  vopStep: {
    introUnchecked: (amount) => ['Check the details before you approve ', amount, '.'],
    intro: (amount) => [
      'The bank has checked the name against the IBAN. Look at the result before you approve ',
      amount,
      '.',
    ],
    askPayee: 'Ask the recipient whether the name and IBAN are right – by a route you already know, not through the '
      + 'invoice or email with the IBAN.',
    risk: 'If you approve despite the mismatch, you bear the risk that the money reaches the wrong recipient.',
  },
  vop: {
    unconfirmed: 'Nobody has confirmed that the IBAN belongs to this name.',
    verdicts: {
      MATCH: {
        label: 'Name matches',
        blurb: 'The bank holds this IBAN under this name.',
      },
      CLOSE_MATCH: {
        label: 'Name differs slightly',
        blurb: 'The bank holds this IBAN under a similar but different name.',
      },
      NO_MATCH: {
        label: 'Name does not match',
        blurb: 'The bank holds this IBAN under a different name.',
      },
      NOT_APPLICABLE: { label: 'No check possible', blurb: 'The name could not be checked.' },
      PENDING: { label: 'Check still running', blurb: 'The name could not be checked yet.' },
      UNKNOWN: { label: 'Check result unclear', blurb: 'Girovo does not understand the bank’s result.' },
    },
    badge: (label) => `Name check: ${label}`,
    submitted: 'Entered by you',
    suggested: 'Held by the bank',
    reason: 'Reason',
    bankNote: 'Note from your bank',
  },
  done: {
    to: (name) => `to ${name}`,
    instant: 'Instant transfer – reaches the recipient in seconds.',
    appears: 'The booking will appear in your transactions as soon as the bank reports it.',
    pastRange: (date, action) =>
      `Your period ends on ${date}: “${action}” loads transactions up to today. May need approval.`,
    refreshHint: (action) => `“${action}” lets you check straight away. May need approval.`,
  },
  unknown: {
    noConfirmation: 'No confirmation received. The transfer may still have reached your bank and be carried out.',
    beforeResend: (action) =>
      `Before you send it again: “${action}” looks for it in your transactions and pending transactions. `
      + 'May need approval.',
    loadingPending: 'Loading pending transactions…',
    loading: 'Loading transactions…',
    sent: 'Sent',
    foundBooked: 'Found in your transactions',
    foundPending: 'Found in your pending transactions',
    found: (amount, name, bookedOn) => [
      amount,
      ` to ${name}`,
      ...(bookedOn != null ? [', booked on ', bookedOn] : []),
      '. Do not send the transfer again.',
    ],
    unsure: 'Not clear – please do not send it again',
    unsureText: (count, amount, name, bookedOn) => (count > 1
      ? [
        `Found ${count} identical payments of `,
        amount,
        ` to ${name}. Whether this transfer is one of them is unclear. Check in your bank’s online banking.`,
      ]
      : [
        bookedOn != null ? 'Your transactions show a payment of ' : 'Your pending transactions show a payment of ',
        amount,
        ` to ${name}`,
        ...(bookedOn != null ? [', booked on ', bookedOn] : []),
        '. Whether it is this transfer or an earlier one is unclear. Check in your bank’s online banking.',
      ]),
    failedBooked: 'Could not load transactions.',
    failedPending: 'Could not load pending transactions.',
    notVisible: 'Not visible yet – please do not send it again',
    notChecked: 'Could not check – please do not send it again',
    searched: (booked, pending) =>
      [booked && 'your transactions', pending && 'your pending transactions'].filter(Boolean).join(' or '),
    notYet: (places, time) => [
      `It does not appear in ${places} yet (as of `,
      time,
      '). Some banks show it only later. Check again later or look in your bank’s online banking.',
    ],
    nothingToRead: 'Your bank does not show Girovo this account’s transactions. Check in your bank’s online banking.',
    tryAgain: 'Try again in a moment or check in your bank’s online banking.',
  },
  refused: {
    withReason: 'Your bank declined:',
    plain: 'Your bank declined.',
  },
  bankAnswer: {
    label: 'Your bank’s answer',
    reference: (code) => ['Error code: ', code],
  },
  discard: {
    title: 'Discard your entries?',
    body: (order) => `The ${order ? 'order' : 'transfer'} has not been sent yet. Your entries will be lost.`,
    keep: 'Keep editing',
    confirm: 'Discard',
  },
  discardVop: {
    title: (order) => (order ? 'Discard order?' : 'Discard transfer?'),
    body: 'Your bank has the details, but no approval. If you discard now, no money will be transferred.',
    keep: 'Keep reviewing',
    confirm: (order) => (order ? 'Discard order' : 'Discard transfer'),
  },
  duplicate: {
    todayAt: (time) => `today at ${time}`,
    dayAt: (date, time) => `on ${date} at ${time}`,
    sent: (when, money, who) => `You already transferred ${money} to ${who} ${when}.`,
    sentUnclear: (when, money, who) => `You already sent a transfer of ${money} to ${who} ${when} – its status is unclear.`,
    debitPending: (who, money) => `${who} is already collecting ${money} by direct debit – the transaction is pending.`,
    pending: (money, who) => `Your pending transactions already include a payment of ${money} to ${who}.`,
    debitBooked: (date, who, money) => `${who} already collected ${money} by direct debit on ${date}.`,
    booked: (date, money, who) => `You already transferred ${money} to ${who} on ${date}.`,
  },
  templates: {
    menu: 'Templates',
    loading: 'Loading templates…',
    unavailable: 'Templates could not be loaded right now.',
    use: 'Use a template',
    noneYet: 'No templates yet.',
    howToSave: 'After a transfer, you can save the recipient as a template.',
    manage: 'Manage templates…',
    manageTitle: 'Manage templates',
    manageDescription: 'Templates are encrypted and can only be read after you log in.',
    notSaving: 'Changes are not being saved right now.',
    renamed: (label) => `Template renamed to “${label}”.`,
    deleted: (label) => `Template “${label}” deleted.`,
    restored: (label) => `Template “${label}” restored.`,
    undo: 'Undo',
    undoLabel: (label) => `Undo – restore “${label}”`,
    none: 'No templates',
    newName: (label) => `New name for “${label}”`,
    rename: (label) => `Rename “${label}”`,
    remove: (label) => `Delete “${label}”`,
    saved: (label) => `Saved as template “${label}”.`,
    alreadySaved: (label) => `Already saved as template “${label}”.`,
    nameLabel: 'Template name',
    saveHint: 'Recipient, IBAN, amount and payment reference – encrypted on this device.',
    save: 'Save as template',
  },
  invoice: {
    title: 'Invoice',
    amount: 'Amount',
    noAmount: 'No amount found',
    from: (account) => `from ${account}`,
    change: 'Change',
    marked: 'Highlighted is what Girovo took over.',
    lens: 'On the invoice',
    enlarge: 'Show the invoice large',
    debit: 'The invoice says it is collected by direct debit – do you need to transfer at all?',
  },

  share: {
    title: 'Request money',
    next: (name) => `Next: ${name}`,
    done: 'Done',
    forWhom: (name, step) => (step && step.of > 1 ? `For ${name} · ${step.at} of ${step.of}` : `For ${name}`),
    intro: 'Whoever sends you money scans the code with their banking app – the transfer is then filled in.',
    amountInvalid: 'Please enter an amount like 25.00 – or leave the field empty.',
    amountNotPositive: 'The amount must be more than €0.00 – or leave the field empty.',
    codeFailed: 'The GiroCode could not be created.',
    copyFailed: 'Could not copy.',
    imageCopyFailed: 'Could not copy. Save the image as a PNG.',
    imageSaveFailed: 'The image could not be saved.',
    anyAmount: 'Any amount',
    copyDetails: 'Copy account details',
    copyImage: 'Copy image',
    savePng: 'Save as PNG',
    detailsCopied: 'Account details copied',
    imageCopied: 'GiroCode copied as an image',
    imageCaption: 'Made with Girovo · girovo.de',
    covered: 'Amounts are hidden – the code reveals the amount to anyone who scans it.',
    showCode: 'Show code',
    codeLabel: (name, amount) => `GiroCode: transfer to ${name}, ${amount}`,
    checkAmount: 'Please check the amount.',
    noCode: 'No GiroCode – please check the details.',
    yourName: 'Your name',
    nameDiffers: (holder) =>
      `Differs from the account holder “${holder}”. Whoever pays may then see “Name does not match”.`,
    useHolder: 'Use account holder',
    nameHint: 'As your bank lists the account holder.',
    amountHint: 'Leave empty if the person paying enters the amount themselves.',
    purposePlaceholder: 'e.g. Share of concert tickets',
    copyBic: 'Copy BIC',
    explainer: 'The code only contains the name, IBAN, BIC, amount and payment reference. '
      + 'Whoever pays approves the transfer in their own app.',
  },
  epc: {
    amountNaN: 'The amount is not a valid number.',
    amountDecimals: 'The amount can have at most two decimal places.',
    amountRange: 'The amount must be between €0.01 and €999,999,999.99.',
    nameTooLong: (max) => `The name can be at most ${max} characters long.`,
    ibanInvalid: 'The IBAN is invalid.',
    purposeTooLong: (max) => `The payment reference can be at most ${max} characters long.`,
    tooLong: 'Name and payment reference together are too long. Please shorten the payment reference.',
  },
  qr: {
    tooLong: 'The content is too long for a QR code.',
    browserOnly: 'The image cannot be created here.',
    imageFailed: 'The image could not be created.',
  },
  purposeTags: {
    EREF: 'End-to-end reference',
    KREF: 'Customer reference',
    MREF: 'Mandate reference',
    DEBT: 'Originator ID',
    COAM: 'Compensation amount',
    OAMT: 'Original amount',
    ABWA: 'Ultimate payer',
    ABWE: 'Ultimate recipient',
    RTRN: 'Return reason',
    ORCR: 'Original creditor ID',
    ORMR: 'Original mandate reference',
    DDAT: 'Due date',
    PURP: 'Payment type',
  },
  route: {
    nameTooLong: (max) => `The name is too long: at most ${max} characters, umlauts count double.`,
    ibanInvalid: 'The IBAN is invalid.',
    amountInvalid: 'The amount is invalid.',
    purposeTooLong: (max) => `The payment reference is too long: at most ${max} characters, umlauts count double.`,
    unknownAccount: 'Unknown account.',
    sameIban: 'The recipient has the same IBAN as your account.',
    noIban: 'You cannot transfer from this account – it has no IBAN.',
    unsupported: (instant) => `Your bank does not offer ${instant ? 'instant transfers' : 'transfers'} here for this account.`,
    vopRequired: 'Your bank requires a name check but does not offer it here. '
      + 'Please make the transfer in your bank’s online banking.',
    vopIncomplete: 'The bank is still checking the name. Try again in a moment.',
    vopWithdrawn: 'The bank withdrew the approval without a check result.',
    noHold: 'Nothing is waiting for the name check to be confirmed.',
    holdExpired: 'The check result is too old. Please start the transfer again.',
  },
};
