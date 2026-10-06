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
  /** Erfassen · Prüfen · Freigabe · Fertig — the last two are common's. */
  stepper: {
    label: 'Fortschritt der Überweisung',
    enter: 'Erfassen',
    review: 'Prüfen',
    /** What a screen reader hears for one step: "Schritt 2 von 4: Prüfen (aktuell)". */
    step: (n: number, total: number, label: string, state: string) => `Schritt ${n} von ${total}: ${label} (${state})`,
    states: { done: 'erledigt', refused: 'abgelehnt', current: 'aktuell', open: 'offen' },
  },
  /** The chip above the payee: where the prefilled values came from. */
  source: {
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
    template: (label: string) => `Vorlage „${label}“ übernommen.`,
    checkFields: (n: number) => (n === 1 ? 'Bitte prüfe das markierte Feld.' : `Bitte prüfe die ${n} markierten Felder.`),
  },
  /** A time of day: "13:12 Uhr". */
  clock: (time: string) => `${time} Uhr`,
  recipient: 'Empfänger',
  /** The form's check and the GiroCode's (lib/girocode.ts). */
  nameMissing: 'Bitte gib den Namen des Empfängers an.',
  /** The GiroCode's check (lib/girocode.ts) and the transfer route's. */
  bicInvalid: 'Die BIC ist ungültig.',
  noAccount: 'Kein Konto unterstützt Überweisungen über FinTS.',
  form: {
    fromAccount: 'Von Konto',
    recent: 'Letzte Empfänger',
    /** In a recent payee's tooltip, for one of your own accounts. */
    ownAccount: 'Eigenes Konto',
    name: 'Name',
    nameHint: 'So, wie das Konto des Empfängers lautet – deine Bank gleicht ihn mit der IBAN ab.',
    namePlaceholder: 'Vor- und Nachname oder Firma',
    payment: 'Zahlung',
    available: 'Verfügbar',
    /** Standard or Echtzeit — the form's switch and the review's row. */
    execution: 'Ausführung',
    standard: 'Standard',
    noInstant: 'Echtzeit bietet deine Bank für dieses Konto nicht über FinTS an.',
    instantHint: 'In Sekunden beim Empfänger, rund um die Uhr.',
    charsLeft: (n: number) => `Noch ${n} Zeichen.`,
    countsWrittenOut: 'Umlaute und Sonderzeichen zählen ausgeschrieben (ä → ae).',
    purposePlaceholder: 'z. B. Rechnung 2026-118',
    chooseAccount: 'Bitte wähle das Konto, von dem du überweist.',
    nameUnsendable: 'Der Name besteht nur aus Zeichen, die eine Überweisung nicht übertragen kann.',
    nameTooLong: (length: number, max: number) =>
      `Für die Bank ist der Name ${length} Zeichen lang, höchstens ${max} gehen: `
      + 'Umlaute und Sonderzeichen werden ausgeschrieben (ä → ae).',
    /** `over`: how many characters too many, counted as the bank counts. */
    purposeTooLong: (over: number) =>
      `Für die Bank ${over === 1 ? 'ein Zeichen' : `${over} Zeichen`} zu lang: `
      + 'Umlaute und Sonderzeichen werden ausgeschrieben (ä → ae, € → EUR).',
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
    checkDigits: 'Nach dem Ländercode folgen zwei Prüfziffern.',
    /** `country`: its name as Intl writes it, or null when there is none. */
    length: (length: number, typed: number, country: string | null) =>
      `Eine IBAN ${country ? `aus ${countryDative(country)} ` : ''}hat ${length} Stellen – eingegeben sind ${typed}.`,
    checksum: 'Die Prüfziffer passt nicht. Bitte vergleiche die IBAN Zeichen für Zeichen.',
    own: 'Das ist die IBAN deines Auftragskontos. Bitte gib das Konto des Empfängers an.',
  },
  /** Under the IBAN field, once it passes. */
  ibanHint: {
    notSepa: 'SEPA-Überweisungen erreichen nur Konten im SEPA-Raum.',
    lookingUp: 'Bank wird gesucht …',
    unknownBank: 'IBAN gültig. Die Bank ist im Verzeichnis nicht hinterlegt.',
    /** `country`: named for an IBAN from abroad, else null. */
    // "in den Niederlanden", "in der Schweiz": the article the dative needs.
    valid: (country: string | null) => `IBAN gültig${country ? ` · Konto in ${countryDative(country)}` : ''}.`,
  },
  /** Reading a GiroCode off an image (components/transfer/GiroCodeDrop.tsx). */
  giro: {
    read: 'GiroCode einlesen',
    reading: 'GiroCode wird gelesen …',
    /** The same, for a screen reader's status line. */
    readingStatus: 'GiroCode wird gelesen',
    dropHere: 'Bild hier ablegen',
    wait: 'Einen Moment bitte.',
    pick: 'Bild mit dem Code auswählen',
    pickOrDrop: 'Bild hierher ziehen, mit Strg+V einfügen oder auswählen',
    errors: {
      notAnImage: 'Bitte wähle ein Bild (PNG, JPG oder einen Screenshot) mit dem GiroCode.',
      noCode: 'Kein GiroCode gefunden. Nutze ein scharfes Bild, auf dem der Code vollständig zu sehen ist.',
      notEpc: 'Kein gültiger GiroCode – unterstützt werden nur SEPA-Überweisungen in Euro.',
    },
  },
  /** One wording for the hint under Betrag and the warning on Prüfen. */
  funds: {
    over: (available: boolean) => `Mehr als ${available ? 'verfügbar' : 'dein Kontostand'} – die Bank kann den Auftrag ablehnen.`,
    /** The balance afterwards arrives as text or as an element. */
    overdraft: (amount: ReactNode): ReactNode[] => ['Kontostand danach ca. ', amount, ' – du nutzt deinen Dispositionsrahmen.'],
  },
  /** The sheet's buttons. */
  actions: {
    toReview: 'Weiter zur Prüfung',
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
    busy: 'Bitte warten – ein anderer Vorgang läuft noch.',
    creditDate: (date: ReactNode): ReactNode[] => ['Gutschrift voraussichtlich ', date],
    duplicateTitle: 'Schon einmal überwiesen?',
    duplicateCheck: 'Prüfe, ob du diese Zahlung wirklich noch einmal senden möchtest.',
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
    rewritten: 'So übermittelt an die Bank: Umlaute ausgeschrieben (ä → ae), nicht übertragbare Zeichen weggelassen.',
    /** `action`: the primary button's label. */
    next: (action: string) =>
      `Nach „${action}“ gleicht die Bank den Empfängernamen ab und bittet dich um die Freigabe in deiner Banking-App.`,
  },
  /** The Namensabgleich step of the sheet. */
  vopStep: {
    introUnchecked: (amount: ReactNode): ReactNode[] => [
      'Für diesen Empfänger liefert der Namensabgleich kein eindeutiges Ergebnis. Prüfe die Angaben, bevor du ',
      amount,
      ' freigibst.',
    ],
    intro: (amount: ReactNode): ReactNode[] => [
      'Die Bank hat den Empfängernamen mit dem Namen zur IBAN abgeglichen. Prüfe das Ergebnis, bevor du ',
      amount,
      ' freigibst.',
    ],
    askPayee: 'Frag beim Empfänger nach, ob Name und IBAN stimmen – über einen Weg, den du schon kennst, nicht über die '
      + 'Rechnung oder E-Mail, aus der die IBAN stammt.',
    risk: 'Gibst du die Überweisung trotz Abweichung frei, trägst du das Risiko, dass das Geld beim falschen Empfänger ankommt.',
  },
  /** The bank's Namensabgleich result (components/VopResult.tsx). */
  vop: {
    /** Said of every verdict without a result: nothing was compared, nothing confirmed. */
    unconfirmed: 'Niemand hat bestätigt, dass die IBAN zu diesem Namen gehört.',
    verdicts: {
      MATCH: {
        label: 'Name stimmt überein',
        blurb: 'Der Empfängername passt zu dem Namen, den die Bank zu dieser IBAN führt.',
      },
      CLOSE_MATCH: {
        label: 'Name weicht leicht ab',
        blurb: 'Die Bank führt zu dieser IBAN einen ähnlichen, aber nicht identischen Namen.',
      },
      NO_MATCH: {
        label: 'Name stimmt nicht überein',
        blurb: 'Der Empfängername passt nicht zu dem Namen, den die Bank zu dieser IBAN führt.',
      },
      NOT_APPLICABLE: { label: 'Kein Abgleich möglich', blurb: 'Der Name konnte nicht geprüft werden.' },
      PENDING: { label: 'Prüfung läuft noch', blurb: 'Der Name konnte noch nicht geprüft werden.' },
      UNKNOWN: { label: 'Prüfergebnis unklar', blurb: 'Die Bank hat ein Ergebnis geliefert, das sich nicht zuordnen lässt.' },
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
      `Dein gewählter Zeitraum endet am ${date} – „${action}“ lädt die Umsätze bis heute. Das kann eine Freigabe erfordern.`,
    refreshHint: (action: string) => `„${action}“ ruft sie neu ab – das kann eine Freigabe erfordern.`,
  },
  /** The "Status unklar" step and what "Jetzt nachsehen" found. */
  unknown: {
    noConfirmation: 'Für diese Überweisung liegt keine Bestätigung vor. Sie kann trotzdem bei deiner Bank angekommen sein und '
      + 'ausgeführt werden.',
    /** `action`: the check button's label. */
    beforeResend: (action: string) =>
      'Bevor du sie erneut sendest: Sieh nach, ob sie schon in deinen Umsätzen oder bei den vorgemerkten Umsätzen '
      + `steht – „${action}“ ruft beide neu ab, das kann eine Freigabe erfordern.`,
    loadingPending: 'Vorgemerkte Umsätze werden abgerufen …',
    loading: 'Umsätze werden abgerufen …',
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
    failedBooked: 'Abruf der Umsätze fehlgeschlagen.',
    failedPending: 'Abruf der vorgemerkten Umsätze fehlgeschlagen.',
    notVisible: 'Noch nicht sichtbar – bitte nicht erneut senden',
    notChecked: 'Nicht nachgesehen – bitte nicht erneut senden',
    /** Where the check looked, as `notYet` names it — only what was actually read. */
    searched: (booked: boolean, pending: boolean) =>
      [booked && 'deinen Umsätzen', pending && 'den vorgemerkten Umsätzen'].filter(Boolean).join(' und '),
    notYet: (places: string, time: ReactNode): ReactNode[] => [
      `In ${places} steht sie noch nicht (Stand `,
      time,
      '). Je nach Bank erscheint eine Überweisung erst später. Sieh später noch einmal nach oder prüfe es in deiner Banking-App.',
    ],
    nothingToRead: 'Für dieses Konto liefert deine Bank keine Umsätze an die App. Prüfe es in deiner Banking-App.',
    tryAgain: 'Versuche es gleich noch einmal oder prüfe es in deiner Banking-App.',
  },
  refused: {
    withReason: 'Deine Bank hat den Auftrag abgelehnt:',
    plain: 'Deine Bank hat den Auftrag abgelehnt.',
  },
  /** The bank's own words on a result step. */
  bankAnswer: {
    label: 'Antwort deiner Bank',
    /** Under a refusal: its code, for a call to the bank. */
    reference: (code: ReactNode): ReactNode[] => ['Rückmeldung der Bank: ', code],
  },
  /** Closing the sheet before anything was sent. */
  discard: {
    title: 'Eingaben verwerfen?',
    body: 'Die Überweisung wurde noch nicht gesendet. Was du eingegeben hast, geht verloren.',
    keep: 'Weiter bearbeiten',
    confirm: 'Verwerfen',
  },
  /** Closing the sheet on the Namensabgleich step. */
  discardVop: {
    title: 'Überweisung verwerfen?',
    body: 'Der Auftrag liegt geprüft bei deiner Bank, ist aber nicht freigegeben. Verwirfst du ihn, wird kein Geld überwiesen.',
    keep: 'Weiter prüfen',
    confirm: 'Überweisung verwerfen',
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
    unavailable: 'Vorlagen sind gerade nicht verfügbar, weil dein verschlüsselter Speicher nicht geladen werden konnte.',
    use: 'Vorlage verwenden',
    noneYet: 'Noch keine Vorlagen.',
    howToSave: 'Ist eine Überweisung ausgeführt, kannst du den Empfänger als Vorlage speichern.',
    manage: 'Vorlagen verwalten …',
    manageTitle: 'Vorlagen verwalten',
    manageDescription: 'Vorlagen werden verschlüsselt gespeichert und sind nur nach deiner Anmeldung lesbar.',
    notSaving: 'Änderungen werden gerade nicht gespeichert, weil dein verschlüsselter Speicher nicht verfügbar ist.',
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
    saveHint: 'Empfänger, IBAN, Betrag und Verwendungszweck – verschlüsselt auf diesem Rechner.',
    save: 'Als Vorlage speichern',
  },
  /** Geld anfordern (components/ShareAccount.tsx). */
  share: {
    title: 'Geld anfordern',
    intro: 'Ein GiroCode für dein Konto. Die zahlende Person scannt ihn mit ihrer Banking-App und bekommt die Überweisung '
      + 'an dich fertig ausgefüllt.',
    amountInvalid: 'Bitte gib einen gültigen Betrag an, zum Beispiel 25,00 – oder lass das Feld leer.',
    amountNotPositive: 'Der Betrag muss größer als 0,00 € sein – oder lass das Feld leer.',
    codeFailed: 'Der GiroCode konnte nicht erstellt werden.',
    copyFailed: 'Kopieren war nicht möglich.',
    imageCopyFailed: 'Das Bild ließ sich nicht kopieren. Speichere es stattdessen als PNG.',
    imageSaveFailed: 'Das Bild konnte nicht gespeichert werden.',
    /** No amount in the code: the payer fills it in. */
    anyAmount: 'Betrag frei wählbar',
    copyDetails: 'Kontodaten kopieren',
    copyImage: 'Bild kopieren',
    savePng: 'Als PNG speichern',
    detailsCopied: 'Kontodaten kopiert',
    imageCopied: 'GiroCode als Bild kopiert',
    covered: 'Beträge sind ausgeblendet – der Code enthält den Betrag und ließe sich vom Bildschirm scannen.',
    showCode: 'Code anzeigen',
    /** The code's description for a screen reader. */
    codeLabel: (name: string, amount: string) => `GiroCode: Überweisung an ${name}, ${amount}`,
    checkAmount: 'Bitte prüfe den Betrag.',
    noCode: 'Kein GiroCode – bitte prüfe die Angaben.',
    yourName: 'Dein Name',
    /** Quotes the Namensabgleich's "Name stimmt nicht überein". */
    nameDiffers: (holder: string) =>
      `Weicht vom Kontoinhaber „${holder}“ ab. Die Bank der zahlenden Person meldet dann womöglich „Name stimmt nicht überein“.`,
    useHolder: 'Kontoinhaber übernehmen',
    nameHint: 'So, wie deine Bank den Kontoinhaber führt.',
    amountHint: 'Leer lassen, wenn die zahlende Person den Betrag selbst eingibt.',
    purposePlaceholder: 'z. B. Anteil Konzertkarten',
    copyBic: 'BIC kopieren',
    explainer: 'Lesbar mit Banking-Apps, die GiroCodes scannen können. Der Code enthält nur Name, IBAN, BIC, Betrag und '
      + 'Verwendungszweck; die zahlende Person prüft und gibt die Überweisung in ihrer eigenen App frei.',
  },
  /** Why a GiroCode cannot be built (lib/girocode.ts). */
  epc: {
    amountNaN: 'Der Betrag ist keine gültige Zahl.',
    amountDecimals: 'Der Betrag darf höchstens zwei Nachkommastellen haben.',
    amountRange: 'Der Betrag muss zwischen 0,01 € und 999.999.999,99 € liegen.',
    nameTooLong: (max: number) => `Der Name darf höchstens ${max} Zeichen lang sein.`,
    ibanInvalid: 'Die IBAN ist ungültig.',
    purposeTooLong: (max: number) => `Der Verwendungszweck darf höchstens ${max} Zeichen lang sein.`,
    tooLong: 'Name und Verwendungszweck sind zusammen zu lang für einen GiroCode. Bitte kürze den Verwendungszweck.',
  },
  /** Drawing a QR code (lib/qr.ts). */
  qr: {
    tooLong: 'Der Inhalt ist zu lang für einen QR-Code.',
    browserOnly: 'Ein PNG kann nur im Browser erzeugt werden.',
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
    nameMissing: 'Bitte den Namen des Empfängers angeben.',
    nameTooLong: (max: number) => `Der Name des Empfängers ist zu lang (höchstens ${max} Zeichen, Umlaute zählen doppelt).`,
    ibanInvalid: 'Die IBAN ist ungültig (Prüfsumme oder Format).',
    amountInvalid: 'Der Betrag ist ungültig.',
    purposeTooLong: (max: number) => `Der Verwendungszweck ist zu lang (höchstens ${max} Zeichen, Umlaute zählen doppelt).`,
    unknownAccount: 'Unbekanntes Konto.',
    sameIban: 'Empfänger-IBAN und Auftraggeber-IBAN sind identisch.',
    noIban: 'Dieses Konto hat keine IBAN und unterstützt keine SEPA-Überweisungen.',
    unsupported: (instant: boolean) =>
      `Dieses Konto unterstützt keine ${instant ? 'Echtzeitüberweisung' : 'SEPA-Überweisung'} über FinTS.`,
    vopRequired: 'Diese Bank verlangt für Überweisungen einen Namensabgleich (Verification of Payee), '
      + 'meldet die dafür nötigen Geschäftsvorfälle aber nicht an. Bitte im Online-Banking der Bank überweisen.',
    vopIncomplete: 'Die Bank prüft den Empfängernamen noch und hat das Ergebnis nicht vollständig geliefert. '
      + 'Bitte in einem Moment erneut versuchen.',
    vopWithdrawn: 'Die Bank hat die Freigabe zurückgezogen, ohne ein Prüfergebnis zu liefern.',
    noHold: 'Kein Auftrag wartet auf die Bestätigung des Namensabgleichs.',
    holdExpired: 'Das Prüfergebnis ist zu alt. Bitte die Überweisung noch einmal starten.',
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
  stepper: {
    label: 'Transfer progress',
    enter: 'Details',
    review: 'Review',
    step: (n, total, label, state) => `Step ${n} of ${total}: ${label} (${state})`,
    states: { done: 'completed', refused: 'declined', current: 'current', open: 'upcoming' },
  },
  source: {
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
    template: (label) => `Template “${label}” applied.`,
    checkFields: (n) => (n === 1 ? 'Please check the highlighted field.' : `Please check the ${n} highlighted fields.`),
  },
  clock: (time) => time,
  recipient: 'Recipient',
  nameMissing: 'Please enter the recipient’s name.',
  bicInvalid: 'The BIC is invalid.',
  noAccount: 'No account supports transfers over FinTS.',
  form: {
    fromAccount: 'From account',
    recent: 'Recent recipients',
    ownAccount: 'Your own account',
    name: 'Name',
    nameHint: 'As it appears on the recipient’s account – your bank checks it against the IBAN.',
    namePlaceholder: 'First and last name, or company',
    payment: 'Payment',
    available: 'Available',
    execution: 'Transfer type',
    standard: 'Standard',
    noInstant: 'Your bank does not offer instant transfers for this account over FinTS.',
    instantHint: 'Reaches the recipient in seconds, around the clock.',
    charsLeft: (n) => (n === 1 ? '1 character left.' : `${n} characters left.`),
    countsWrittenOut: 'Umlauts and special characters count as written out (ä → ae).',
    purposePlaceholder: 'e.g. Invoice 2026-118',
    chooseAccount: 'Please choose the account you are transferring from.',
    nameUnsendable: 'The name consists only of characters a transfer cannot carry.',
    nameTooLong: (length, max) =>
      `For the bank, the name is ${length} characters long and ${max} is the maximum: `
      + 'umlauts and special characters are written out (ä → ae).',
    purposeTooLong: (over) =>
      `${over === 1 ? 'One character' : `${over} characters`} too long for the bank: `
      + 'umlauts and special characters are written out (ä → ae, € → EUR).',
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
    checkDigits: 'The country code is followed by two check digits.',
    length: (length, typed, country) =>
      `An IBAN ${country ? `from ${theCountry(country)} ` : ''}has ${length} characters – you entered ${typed}.`,
    checksum: 'The check digits do not match. Please compare the IBAN character by character.',
    own: 'This is the IBAN of the account you are sending from. Please enter the recipient’s account.',
  },
  ibanHint: {
    notSepa: 'SEPA transfers only reach accounts in the SEPA area.',
    lookingUp: 'Looking up the bank…',
    unknownBank: 'IBAN valid. The bank is not listed in the directory.',
    valid: (country) => `IBAN valid${country ? ` · account in ${theCountry(country)}` : ''}.`,
  },
  giro: {
    read: 'Read a GiroCode',
    reading: 'Reading GiroCode…',
    readingStatus: 'Reading GiroCode',
    dropHere: 'Drop the image here',
    wait: 'One moment, please.',
    pick: 'Choose an image with the code',
    pickOrDrop: 'Drag an image here, paste it with Ctrl+V or choose one',
    errors: {
      notAnImage: 'Please choose an image (PNG, JPG or a screenshot) with the GiroCode.',
      noCode: 'No GiroCode found. Use a sharp image that shows the whole code.',
      notEpc: 'Not a valid GiroCode – only SEPA transfers in euros are supported.',
    },
  },
  funds: {
    over: (available) => `More than ${available ? 'is available' : 'your balance'} – the bank may decline the order.`,
    overdraft: (amount) => ['Balance afterwards: about ', amount, ' – you will be using your overdraft.'],
  },
  actions: {
    toReview: 'Continue to review',
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
    busy: 'Please wait – another operation is still running.',
    creditDate: (date) => ['Expected to arrive on ', date],
    duplicateTitle: 'Already transferred?',
    duplicateCheck: 'Check whether you really want to send this payment again.',
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
    rewritten: 'Sent to the bank like this: umlauts written out (ä → ae), characters that cannot be transmitted left out.',
    next: (action) =>
      `After “${action}”, the bank checks the recipient’s name and asks for your approval in your banking app.`,
  },
  vopStep: {
    introUnchecked: (amount) => [
      'The name check gives no clear result for this recipient. Check the details before you approve ',
      amount,
      '.',
    ],
    intro: (amount) => [
      'The bank has compared the recipient’s name with the name held for the IBAN. Check the result before you approve ',
      amount,
      '.',
    ],
    askPayee: 'Ask the recipient whether the name and IBAN are right – through a channel you already know, not through the '
      + 'invoice or email the IBAN came from.',
    risk: 'If you approve the transfer despite the mismatch, you bear the risk that the money reaches the wrong recipient.',
  },
  vop: {
    unconfirmed: 'Nobody has confirmed that the IBAN belongs to this name.',
    verdicts: {
      MATCH: {
        label: 'Name matches',
        blurb: 'The recipient name matches the name the bank holds for this IBAN.',
      },
      CLOSE_MATCH: {
        label: 'Name differs slightly',
        blurb: 'The bank holds a similar but not identical name for this IBAN.',
      },
      NO_MATCH: {
        label: 'Name does not match',
        blurb: 'The recipient name does not match the name the bank holds for this IBAN.',
      },
      NOT_APPLICABLE: { label: 'No check possible', blurb: 'The name could not be checked.' },
      PENDING: { label: 'Check still running', blurb: 'The name could not be checked yet.' },
      UNKNOWN: { label: 'Check result unclear', blurb: 'The bank returned a result that cannot be classified.' },
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
      `Your selected period ends on ${date} – “${action}” loads transactions up to today. This may require approval.`,
    refreshHint: (action) => `“${action}” fetches them again – this may require approval.`,
  },
  unknown: {
    noConfirmation: 'There is no confirmation for this transfer. It may still have reached your bank and be carried out.',
    beforeResend: (action) =>
      'Before you send it again: check whether it already appears in your transactions or your pending transactions '
      + `– “${action}” fetches both again, which may require approval.`,
    loadingPending: 'Fetching pending transactions…',
    loading: 'Fetching transactions…',
    sent: 'Sent',
    foundBooked: 'Found in your transactions',
    foundPending: 'Found in your pending transactions',
    found: (amount, name, bookedOn) => [
      amount,
      ` to ${name}`,
      ...(bookedOn != null ? [', booked on ', bookedOn] : []),
      '. Do not send the transfer again.',
    ],
    failedBooked: 'Could not load transactions.',
    failedPending: 'Could not load pending transactions.',
    notVisible: 'Not visible yet – please do not send it again',
    notChecked: 'Not checked – please do not send it again',
    searched: (booked, pending) =>
      [booked && 'your transactions', pending && 'your pending transactions'].filter(Boolean).join(' or '),
    notYet: (places, time) => [
      `It does not appear in ${places} yet (as of `,
      time,
      '). Depending on the bank, a transfer may only appear later. Check again later or look in your banking app.',
    ],
    nothingToRead: 'Your bank does not provide transactions for this account to the app. Check in your banking app.',
    tryAgain: 'Try again in a moment or check in your banking app.',
  },
  refused: {
    withReason: 'Your bank declined the order:',
    plain: 'Your bank declined the order.',
  },
  bankAnswer: {
    label: 'Your bank’s answer',
    reference: (code) => ['Bank response: ', code],
  },
  discard: {
    title: 'Discard your entries?',
    body: 'The transfer has not been sent yet. What you have entered will be lost.',
    keep: 'Keep editing',
    confirm: 'Discard',
  },
  discardVop: {
    title: 'Discard transfer?',
    body: 'The order is with your bank and has been checked, but not approved. If you discard it, no money will be transferred.',
    keep: 'Keep reviewing',
    confirm: 'Discard transfer',
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
    unavailable: 'Templates are not available right now because your encrypted storage could not be loaded.',
    use: 'Use a template',
    noneYet: 'No templates yet.',
    howToSave: 'Once a transfer has been completed, you can save the recipient as a template.',
    manage: 'Manage templates…',
    manageTitle: 'Manage templates',
    manageDescription: 'Templates are stored encrypted and can only be read after you log in.',
    notSaving: 'Changes are not being saved right now because your encrypted storage is not available.',
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
    saveHint: 'Recipient, IBAN, amount and payment reference – encrypted on this computer.',
    save: 'Save as template',
  },
  share: {
    title: 'Request money',
    intro: 'A GiroCode for your account. The person paying scans it with their banking app and gets the transfer to you '
      + 'ready filled in.',
    amountInvalid: 'Please enter a valid amount, for example 25.00 – or leave the field empty.',
    amountNotPositive: 'The amount must be more than €0.00 – or leave the field empty.',
    codeFailed: 'The GiroCode could not be created.',
    copyFailed: 'Could not copy.',
    imageCopyFailed: 'The image could not be copied. Save it as a PNG instead.',
    imageSaveFailed: 'The image could not be saved.',
    anyAmount: 'Any amount',
    copyDetails: 'Copy account details',
    copyImage: 'Copy image',
    savePng: 'Save as PNG',
    detailsCopied: 'Account details copied',
    imageCopied: 'GiroCode copied as an image',
    covered: 'Amounts are hidden – the code contains the amount and could be scanned off the screen.',
    showCode: 'Show code',
    codeLabel: (name, amount) => `GiroCode: transfer to ${name}, ${amount}`,
    checkAmount: 'Please check the amount.',
    noCode: 'No GiroCode – please check the details.',
    yourName: 'Your name',
    nameDiffers: (holder) =>
      `Differs from the account holder “${holder}”. The bank of the person paying may then report “Name does not match”.`,
    useHolder: 'Use account holder',
    nameHint: 'As your bank lists the account holder.',
    amountHint: 'Leave empty if the person paying enters the amount themselves.',
    purposePlaceholder: 'e.g. Share of concert tickets',
    copyBic: 'Copy BIC',
    explainer: 'Readable by banking apps that can scan GiroCodes. The code only contains the name, IBAN, BIC, amount and '
      + 'payment reference; the person paying checks and approves the transfer in their own app.',
  },
  epc: {
    amountNaN: 'The amount is not a valid number.',
    amountDecimals: 'The amount can have at most two decimal places.',
    amountRange: 'The amount must be between €0.01 and €999,999,999.99.',
    nameTooLong: (max) => `The name can be at most ${max} characters long.`,
    ibanInvalid: 'The IBAN is invalid.',
    purposeTooLong: (max) => `The payment reference can be at most ${max} characters long.`,
    tooLong: 'Name and payment reference together are too long for a GiroCode. Please shorten the payment reference.',
  },
  qr: {
    tooLong: 'The content is too long for a QR code.',
    browserOnly: 'A PNG can only be created in the browser.',
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
    nameMissing: 'Please enter the recipient’s name.',
    nameTooLong: (max) => `The recipient’s name is too long (at most ${max} characters; umlauts count double).`,
    ibanInvalid: 'The IBAN is invalid (checksum or format).',
    amountInvalid: 'The amount is invalid.',
    purposeTooLong: (max) => `The payment reference is too long (at most ${max} characters; umlauts count double).`,
    unknownAccount: 'Unknown account.',
    sameIban: 'The recipient IBAN and the payer IBAN are identical.',
    noIban: 'This account has no IBAN and does not support SEPA transfers.',
    unsupported: (instant) => `This account does not support ${instant ? 'instant transfers' : 'SEPA transfers'} over FinTS.`,
    vopRequired: 'This bank requires a name check (Verification of Payee) for transfers, '
      + 'but does not announce the business transactions this needs. Please make the transfer in the bank’s online banking.',
    vopIncomplete: 'The bank is still checking the recipient’s name and has not delivered the complete result. '
      + 'Please try again in a moment.',
    vopWithdrawn: 'The bank withdrew the approval without delivering a check result.',
    noHold: 'No order is waiting for the name check to be confirmed.',
    holdExpired: 'The check result is too old. Please start the transfer again.',
  },
};
