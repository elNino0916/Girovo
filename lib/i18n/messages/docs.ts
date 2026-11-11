// Documents kept on this machine (lib/doc-store.ts): the bank's own
// Kontoauszüge (components/BankStatements.tsx) and the receipts attached to
// bookings (components/transactions/ReceiptSection.tsx) — and the store's
// refusals.

export const de = {
  /** What the store answers when it cannot (app/api/docs, app/api/bank-statements). */
  server: {
    unavailable: 'Die gespeicherten Dokumente sind gerade nicht erreichbar.',
    read: 'Die gespeicherten Dokumente ließen sich nicht lesen.',
    write: 'Das Dokument ließ sich nicht speichern.',
    locked: 'Die gespeicherten Dokumente lassen sich mit dieser PIN nicht öffnen. In den Einstellungen kannst du neu beginnen.',
    gone: 'Dieses Dokument gibt es nicht mehr.',
    /** After "Gespeicherte Daten löschen": nothing more is saved until the logout. */
    wiped: 'Bis zum Abmelden werden keine Dokumente mehr gespeichert.',
    /** Starting over waits for the bank's word on the PIN: a mistyped one must not replace the store. */
    notYet: 'Das geht erst, wenn deine Bank die PIN angenommen hat. Lade zuerst deine Umsätze.',
    tooLarge: 'Das Dokument ist größer als 8 MB.',
    full: 'Zu viele Dokumente gespeichert. Lösche ein paar.',
    format: 'Das Dokument ließ sich nicht zuordnen.',
    notADocument: 'Das ist weder ein Bild noch ein PDF.',
  },

  /**
   * The store does not open with this PIN (it changed at the bank): said in
   * Einstellungen and with the bank's Kontoauszüge, with the way out
   * (lib/doc-store.ts resetDocs — the old one set aside, nothing deleted).
   */
  unreadable: {
    title: 'Gespeicherte Dokumente nicht lesbar',
    hint: 'Nicht lesbar. Hat sich deine PIN geändert? Bis du neu beginnst, werden keine Belege und Auszüge gespeichert.',
    startOver: 'Neu beginnen …',
    dialog: {
      title: 'Belege und Auszüge neu beginnen?',
      description: 'Mit dieser PIN lassen sie sich nicht öffnen. Girovo hebt sie als Sicherung auf und beginnt neu.',
      confirm: 'Neu beginnen',
    },
    done: 'Neu begonnen. Belege und Auszüge werden wieder gespeichert.',
  },

  /** A document's file name when it brings none of its own ("Kontoauszug 2026-007.pdf"). */
  fileName: { statement: 'Kontoauszug', receipt: 'Beleg' },

  /** Opening, saving and removing a kept document, wherever it is listed. */
  open: 'Öffnen',
  save: 'Speichern',
  saved: (name: string) => `„${name}“ gespeichert.`,
  openFailed: 'Das Dokument ließ sich nicht öffnen.',

  /** The bank's own Kontoauszüge, per account. */
  statements: {
    title: 'Kontoauszüge deiner Bank',
    /** The menu entry beside Girovo's own Kontoauszug. */
    menu: 'Auszüge deiner Bank …',
    intro: 'Auf diesem Rechner gespeichert, mit deiner PIN verschlüsselt.',
    fetch: 'Auszüge abrufen',
    fetching: 'Auszüge werden abgerufen …',
    none: 'Noch keine Auszüge gespeichert',
    /** After a fetch. */
    added: (n: number) => (n === 1 ? '1 neuer Auszug gespeichert.' : `${n} neue Auszüge gespeichert.`),
    nothingNew: 'Deine Bank hat keine neuen Auszüge bereitgestellt.',
    more: 'Es gibt noch mehr. Ruf die Auszüge noch einmal ab.',
    held: 'Nicht alle ließen sich speichern. Speichere sie vor dem Abmelden, sonst sind sie weg.',
    /** Said while none are kept: why Girovo keeps every one. */
    delivered: 'Manche Banken bieten einen Auszug nur einmal an. Darum behält Girovo jeden.',
    numbered: (n: number, y: number) => `Auszug ${n}/${y}`,
    dated: (day: string) => `Auszug vom ${day}`,
    plain: 'Kontoauszug',
    removeLabel: (title: string) => `${title} von diesem Rechner löschen`,
    removeDialog: {
      title: 'Auszug von diesem Rechner löschen?',
      description: 'Deine Bank bietet ihn vielleicht nicht noch einmal an. Im Online-Banking findest du ihn meist weiter.',
      confirm: 'Löschen',
    },
    failed: 'Die Auszüge ließen sich nicht abrufen.',
    locked: 'Die gespeicherten Auszüge lassen sich mit dieser PIN nicht öffnen. Neue bleiben nur bis zum Abmelden.',
  },

  /** A booking's receipts: an invoice, a till receipt — a photo or a PDF. */
  receipts: {
    title: 'Belege',
    attach: 'Beleg anhängen',
    /** Android: the button whose menu offers the camera or a file. */
    add: 'Beleg hinzufügen',
    takePhoto: 'Foto aufnehmen',
    chooseFile: 'Datei wählen',
    scanFailed: 'Die Kamera ließ sich nicht öffnen. Versuch es noch einmal oder wähle eine Datei.',
    /** A photographed receipt's name: "Beleg vom 21.10.2026". */
    photoName: (day: string) => `Beleg vom ${day}`,
    /** The desktop: a file dragged onto the section, or a screenshot pasted. */
    dropHint: 'Zieh eine Datei hierher oder füge einen Screenshot mit Strg+V ein.',
    dropHere: 'Loslassen, um den Beleg anzuhängen',
    wrongType: 'Als Beleg geht ein Foto oder ein PDF.',
    hint: 'Ein Foto oder PDF, etwa die Rechnung. Mit deiner PIN verschlüsselt gespeichert.',
    attaching: 'Beleg wird gespeichert …',
    attached: 'Beleg angehängt.',
    removed: 'Beleg entfernt.',
    removeLabel: (name: string) => `Beleg „${name}“ entfernen`,
    removeDialog: {
      title: 'Beleg entfernen?',
      description: 'Er wird von diesem Rechner gelöscht.',
      confirm: 'Entfernen',
    },
    /** A row's marker, for screen readers. */
    marker: 'mit Beleg',
    /** The transfer of an invoice read from its file: keep the file for the booking. */
    keepInvoice: 'Rechnung an die Buchung heften',
    keepInvoiceHint: 'Sobald deine Bank die Überweisung bucht, hängt die Rechnung an der Buchung.',
    /** After a statement read matched waiting invoices to their bookings. */
    matched: (n: number) => (n === 1 ? 'Eine Rechnung hängt jetzt an ihrer Buchung.' : `${n} Rechnungen hängen jetzt an ihren Buchungen.`),
    waiting: (n: number) => (n === 1 ? 'Eine Rechnung wartet auf ihre Buchung.' : `${n} Rechnungen warten auf ihre Buchungen.`),
  },
};

export const en: typeof de = {
  server: {
    unavailable: 'The saved documents cannot be reached right now.',
    read: 'The saved documents could not be read.',
    write: 'The document could not be saved.',
    locked: 'The saved documents do not open with this PIN. You can start again in the settings.',
    gone: 'This document no longer exists.',
    wiped: 'No more documents are saved until you log out.',
    notYet: 'This works only once your bank has accepted the PIN. Load your transactions first.',
    tooLarge: 'The document is larger than 8 MB.',
    full: 'Too many documents saved. Delete a few.',
    format: 'The document could not be filed.',
    notADocument: 'This is neither an image nor a PDF.',
  },

  unreadable: {
    title: 'Saved documents unreadable',
    hint: 'Can’t be read. Has your PIN changed? Until you start again, no receipts or statements are saved.',
    startOver: 'Start again…',
    dialog: {
      title: 'Start receipts and statements again?',
      description: 'They can’t be opened with this PIN. Girovo keeps them as a backup and starts again.',
      confirm: 'Start again',
    },
    done: 'Started again. Receipts and statements are saved again.',
  },

  fileName: { statement: 'Statement', receipt: 'Receipt' },

  open: 'Open',
  save: 'Save',
  saved: (name) => `“${name}” saved.`,
  openFailed: 'The document could not be opened.',

  statements: {
    title: 'Your bank’s statements',
    menu: 'Your bank’s statements…',
    intro: 'Saved on this computer, encrypted with your PIN.',
    fetch: 'Load statements',
    fetching: 'Loading statements…',
    none: 'No statements saved yet',
    added: (n) => (n === 1 ? '1 new statement saved.' : `${n} new statements saved.`),
    nothingNew: 'Your bank has not provided any new statements.',
    more: 'There are more. Load the statements again.',
    held: 'Not all of them could be saved. Save them before you log out, or they are gone.',
    delivered: 'Some banks offer a statement only once. That is why Girovo keeps every one.',
    numbered: (n, y) => `Statement ${n}/${y}`,
    dated: (day) => `Statement of ${day}`,
    plain: 'Statement',
    removeLabel: (title) => `Delete ${title} from this computer`,
    removeDialog: {
      title: 'Delete the statement from this computer?',
      description: 'Your bank may not offer it again. You can usually still find it in your online banking.',
      confirm: 'Delete',
    },
    failed: 'The statements could not be loaded.',
    locked: 'The saved statements do not open with this PIN. New ones are kept only until you log out.',
  },

  receipts: {
    title: 'Receipts',
    attach: 'Attach a receipt',
    add: 'Add a receipt',
    takePhoto: 'Take a photo',
    chooseFile: 'Choose a file',
    scanFailed: 'The camera could not be opened. Try again or choose a file.',
    photoName: (day) => `Receipt of ${day}`,
    dropHint: 'Drag a file here or paste a screenshot with Ctrl+V.',
    dropHere: 'Drop to attach the receipt',
    wrongType: 'A receipt is a photo or a PDF.',
    hint: 'A photo or PDF, such as the invoice. Saved encrypted with your PIN.',
    attaching: 'Saving the receipt…',
    attached: 'Receipt attached.',
    removed: 'Receipt removed.',
    removeLabel: (name) => `Remove receipt “${name}”`,
    removeDialog: {
      title: 'Remove the receipt?',
      description: 'It will be deleted from this computer.',
      confirm: 'Remove',
    },
    marker: 'with receipt',
    keepInvoice: 'Attach the invoice to the booking',
    keepInvoiceHint: 'As soon as your bank books the transfer, the invoice is attached to the booking.',
    matched: (n) => (n === 1 ? 'An invoice is now attached to its booking.' : `${n} invoices are now attached to their bookings.`),
    waiting: (n) => (n === 1 ? 'An invoice is waiting for its booking.' : `${n} invoices are waiting for their bookings.`),
  },
};
