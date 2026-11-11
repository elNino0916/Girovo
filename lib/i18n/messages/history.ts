// Umsätze kept on this computer (lib/history.ts, lib/history-store.ts): the
// switch on the Einstellungen page and its dialogs, what the list and the Zeitraum
// control say about the kept part, and the server's refusals.

const nDe = (n: number) => n.toLocaleString('de-DE');
const nEn = (n: number) => n.toLocaleString('en-GB');

export const de = {
  /** The switch in the Einstellungen page's "Auf diesem Rechner". */
  keep: 'Umsätze auf diesem Rechner behalten',
  keepHint: 'Mit deiner PIN verschlüsselt.',
  /** The hint once some are kept; `date` is the oldest kept day ("12.03.2025"). */
  keptSince: (date: string) => `Seit ${date} gespeichert, mit deiner PIN verschlüsselt.`,
  loading: 'Gespeicherte Umsätze werden geladen …',
  unreadable: 'Nicht lesbar. Hat sich deine PIN geändert? Bis du neu beginnst, kommen keine dazu.',
  unavailable: 'Die gespeicherten Umsätze ließen sich nicht laden. In dieser Sitzung kommen keine dazu.',
  startOver: 'Neu beginnen …',

  /** Switching it off: what goes, said before it goes. */
  offDialog: {
    title: 'Gespeicherte Umsätze löschen?',
    description: 'Alle gespeicherten Umsätze werden von diesem Rechner gelöscht, auch ältere Sicherungen. Das lässt sich nicht rückgängig machen.',
    body: 'Deine Bank zeigt sie weiter, oft aber nur die letzten Monate.',
    confirm: 'Ausschalten und löschen',
  },

  /** The way out of a file this PIN cannot open. Nothing is deleted. */
  resetDialog: {
    title: 'Gespeicherte Umsätze neu beginnen?',
    description: 'Mit dieser PIN lassen sie sich nicht öffnen. Girovo hebt sie als Sicherung auf und beginnt neu.',
    confirm: 'Neu beginnen',
  },

  /** Toasts (components/FintsProvider.tsx). */
  turnedOn: 'Deine Umsätze bleiben ab jetzt auf diesem Rechner.',
  deleted: 'Die gespeicherten Umsätze sind gelöscht.',
  restarted: 'Neu begonnen. Deine Umsätze werden wieder behalten.',

  /** The Umsätze list (components/Transactions.tsx, components/transactions/TxList.tsx). */
  list: {
    /** Before the first day the list takes from this computer. */
    divider: 'Ab hier: auf diesem Rechner gespeichert',
  },

  /** The Zeitraum control (components/transactions/PeriodControl.tsx). */
  period: {
    label: 'Alles Gespeicherte',
    short: 'Gespeichert',
    /** Under it in the menu: "seit 12.03.2025 · von diesem Rechner". */
    since: (date: string) => `seit ${date} · von diesem Rechner`,
  },

  /** The server's refusals (lib/history-store.ts, app/api/history). */
  server: {
    unavailable: 'Für diese Sitzung lassen sich keine Umsätze speichern.',
    read: 'Die gespeicherten Umsätze konnten nicht gelesen werden.',
    write: 'Die Umsätze konnten nicht gespeichert werden.',
    wipe: 'Die gespeicherten Umsätze ließen sich nicht ganz löschen. Versuche es noch einmal.',
    unknownAction: 'Unbekannte Aktion.',
    /** Restoring or importing Umsätze while "Umsätze behalten" is off. */
    notKept: 'Schalte zuerst „Umsätze behalten“ ein.',
    locked: 'Die gespeicherten Umsätze lassen sich mit dieser PIN nicht öffnen.',
    /** Starting over waits for the bank's word on the PIN: a mistyped one must not replace the file. */
    notYet: 'Das geht erst, wenn deine Bank die PIN angenommen hat. Lade zuerst deine Umsätze.',
  },
  /** Older Umsätze from the online banking's export (lib/bank-import.ts, components/settings/ImportDialog.tsx). */
  import: {
    row: 'Ältere Umsätze importieren',
    rowHint: 'CSV, camt oder MT940 aus deinem Online-Banking',
    open: 'Importieren …',
    title: 'Ältere Umsätze importieren',
    intro: 'Lade deine Umsätze im Online-Banking herunter, als CSV, camt.053 oder MT940, und wähle die Datei hier. Girovo ergänzt nur Tage, die noch fehlen.',
    choose: 'Datei wählen …',
    none: 'Noch keine Datei gewählt',
    reading: 'Datei wird gelesen …',
    format: { csv: 'CSV', mt940: 'MT940', camt: 'camt' },
    found: (format: string, count: string, from: string, to: string) => `${format} · ${count} vom ${from} bis ${to}`,
    skipped: (n: number) => `${nDe(n)} ${n === 1 ? 'Zeile' : 'Zeilen'} ohne gebuchten Umsatz übersprungen.`,
    account: 'Konto',
    foreign: 'Die Datei gehört zu einem anderen Konto. Prüfe, ob du das richtige gewählt hast.',
    run: 'Importieren',
    done: (days: number, count: string) =>
      days ? `${nDe(days)} ${days === 1 ? 'Tag' : 'Tage'} mit ${count} ergänzt.` : 'Nichts Neues. Diese Tage sind schon gespeichert.',
    keepOff: 'Importieren geht nur, solange „Umsätze behalten“ an ist.',
    server: {
      tooLarge: 'Die Datei ist zu groß.',
      notReadable: 'Diese Datei kann Girovo nicht lesen. Exportiere die Umsätze als CSV, camt.053 oder MT940.',
      noAccount: 'Wähle das Konto, zu dem die Datei gehört.',
      nothing: 'Die Datei enthält keine neuen Tage.',
    },
  },
};

export const en: typeof de = {
  keep: 'Keep transactions on this computer',
  keepHint: 'Encrypted with your PIN.',
  keptSince: (date) => `Kept since ${date}, encrypted with your PIN.`,
  loading: 'Loading saved transactions…',
  unreadable: 'Can’t be read. Has your PIN changed? Nothing is added until you start again.',
  unavailable: 'The saved transactions could not be loaded. Nothing is added in this session.',
  startOver: 'Start again…',

  offDialog: {
    title: 'Delete saved transactions?',
    description: 'All saved transactions are deleted from this computer, older backups too. This cannot be undone.',
    body: 'Your bank still shows them, but often only the last few months.',
    confirm: 'Turn off and delete',
  },

  resetDialog: {
    title: 'Start saved transactions again?',
    description: 'They can’t be opened with this PIN. Girovo keeps them as a backup and starts again.',
    confirm: 'Start again',
  },

  turnedOn: 'Your transactions now stay on this computer.',
  deleted: 'The saved transactions have been deleted.',
  restarted: 'Started again. Your transactions are being kept again.',

  list: {
    divider: 'From here on: saved on this computer',
  },

  period: {
    label: 'Everything saved',
    short: 'Saved',
    since: (date) => `since ${date} · from this computer`,
  },

  server: {
    unavailable: 'No transactions can be saved for this session.',
    read: 'The saved transactions could not be read.',
    write: 'The transactions could not be saved.',
    wipe: 'The saved transactions couldn’t all be deleted. Try again.',
    unknownAction: 'Unknown action.',
    notKept: 'Turn on “Keep transactions” first.',
    locked: 'The saved transactions cannot be opened with this PIN.',
    notYet: 'This works only once your bank has accepted the PIN. Load your transactions first.',
  },
  import: {
    row: 'Import older transactions',
    rowHint: 'CSV, camt or MT940 from your online banking',
    open: 'Import …',
    title: 'Import older transactions',
    intro: 'Download your transactions in your online banking, as CSV, camt.053 or MT940, and choose the file here. Girovo only adds days that are missing.',
    choose: 'Choose file …',
    none: 'No file chosen yet',
    reading: 'Reading the file …',
    format: { csv: 'CSV', mt940: 'MT940', camt: 'camt' },
    found: (format, count, from, to) => `${format} · ${count} from ${from} to ${to}`,
    skipped: (n) => `Skipped ${nEn(n)} ${n === 1 ? 'row' : 'rows'} without a booked transaction.`,
    account: 'Account',
    foreign: 'The file belongs to another account. Check that you chose the right one.',
    run: 'Import',
    done: (days, count) => (days ? `${nEn(days)} ${days === 1 ? 'day' : 'days'} with ${count} added.` : 'Nothing new. These days are already saved.'),
    keepOff: 'Importing only works while “Keep transactions” is on.',
    server: {
      tooLarge: 'The file is too large.',
      notReadable: 'Girovo cannot read this file. Export the transactions as CSV, camt.053 or MT940.',
      noAccount: 'Choose the account the file belongs to.',
      nothing: 'The file has no new days.',
    },
  },
};
