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
    locked: 'Die gespeicherten Dokumente lassen sich mit dieser PIN nicht öffnen.',
    gone: 'Dieses Dokument gibt es nicht mehr.',
    tooLarge: 'Das Dokument ist zu groß – höchstens 8 MB.',
    full: 'Es sind schon sehr viele Dokumente gespeichert. Lösche ein paar, dann geht es wieder.',
    format: 'Das Dokument ließ sich nicht zuordnen.',
    notADocument: 'Das ist weder ein Bild noch ein PDF.',
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
    more: 'Deine Bank hält noch mehr bereit – ruf die Auszüge noch einmal ab.',
    held: 'Nicht alle ließen sich auf diesem Rechner speichern. Speichere sie vor der Abmeldung, sonst sind sie weg.',
    /** Said while none are kept: why Girovo keeps every one. */
    delivered: 'Manche Banken vermerken einen abgerufenen Auszug als zugestellt und bieten ihn nicht noch einmal an. Darum behält Girovo jeden.',
    numbered: (n: number, y: number) => `Auszug ${n}/${y}`,
    dated: (day: string) => `Auszug vom ${day}`,
    plain: 'Kontoauszug',
    removeLabel: (title: string) => `${title} von diesem Rechner löschen`,
    removeDialog: {
      title: 'Auszug von diesem Rechner löschen?',
      description: 'Ob deine Bank ihn noch einmal bereitstellt, entscheidet sie. Im Online-Banking findest du ihn meist weiter.',
      confirm: 'Löschen',
    },
    failed: 'Die Auszüge ließen sich nicht abrufen.',
    locked: 'Die gespeicherten Auszüge lassen sich mit dieser PIN nicht öffnen. Neue werden nur für diese Sitzung gehalten.',
  },

  /** A booking's receipts: an invoice, a till receipt — a photo or a PDF. */
  receipts: {
    title: 'Belege',
    attach: 'Beleg anhängen',
    hint: 'Ein Foto oder PDF, etwa die Rechnung – auf diesem Rechner gespeichert, mit deiner PIN verschlüsselt.',
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
    locked: 'The saved documents do not open with this PIN.',
    gone: 'This document no longer exists.',
    tooLarge: 'The document is too large – 8 MB at most.',
    full: 'A great many documents are saved already. Delete a few, then it works again.',
    format: 'The document could not be filed.',
    notADocument: 'This is neither an image nor a PDF.',
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
    more: 'Your bank has more waiting – load the statements again.',
    held: 'Not all of them could be saved on this computer. Save them before you log out, or they are gone.',
    delivered: 'Some banks mark a retrieved statement as delivered and do not offer it again. That is why Girovo keeps every one.',
    numbered: (n, y) => `Statement ${n}/${y}`,
    dated: (day) => `Statement of ${day}`,
    plain: 'Statement',
    removeLabel: (title) => `Delete ${title} from this computer`,
    removeDialog: {
      title: 'Delete the statement from this computer?',
      description: 'Whether your bank provides it again is up to your bank. You can usually still find it in your online banking.',
      confirm: 'Delete',
    },
    failed: 'The statements could not be loaded.',
    locked: 'The saved statements do not open with this PIN. New ones are only held for this session.',
  },

  receipts: {
    title: 'Receipts',
    attach: 'Attach a receipt',
    hint: 'A photo or PDF, such as the invoice – saved on this computer, encrypted with your PIN.',
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
