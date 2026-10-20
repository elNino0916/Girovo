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
  unreadable: 'Mit dieser PIN nicht lesbar – meist, weil sie sich geändert hat. Bis du neu beginnst, kommen keine dazu.',
  unavailable: 'Die gespeicherten Umsätze ließen sich nicht laden. In dieser Sitzung kommen keine dazu.',
  startOver: 'Neu beginnen …',

  /** Switching it off: what goes, said before it goes. */
  offDialog: {
    title: 'Gespeicherte Umsätze löschen?',
    description: 'Die App behält deine Umsätze dann nicht mehr und löscht die bisher gespeicherten von diesem Rechner, frühere Sicherungen eingeschlossen. Das lässt sich nicht rückgängig machen.',
    body: 'Deine Bank zeigt sie weiter, solange sie sie anbietet – oft nur die letzten Monate.',
    confirm: 'Ausschalten und löschen',
  },

  /** The way out of a file this PIN cannot open. Nothing is deleted. */
  resetDialog: {
    title: 'Gespeicherte Umsätze neu beginnen?',
    description: 'Die bisherige Datei lässt sich mit dieser PIN nicht öffnen. Sie bleibt als Sicherung auf diesem Rechner, und die App beginnt eine neue.',
    confirm: 'Neu beginnen',
  },

  /** Toasts (components/FintsProvider.tsx). */
  turnedOn: 'Deine Umsätze werden ab jetzt auf diesem Rechner behalten.',
  deleted: 'Die gespeicherten Umsätze sind von diesem Rechner gelöscht. Es kommen keine mehr dazu.',
  restarted: 'Neu begonnen – deine Umsätze werden wieder behalten.',

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
    wipe: 'Die gespeicherten Umsätze konnten nicht vollständig gelöscht werden. Bitte versuche es erneut.',
    unknownAction: 'Unbekannte Aktion.',
    /** Restoring or importing Umsätze while "Umsätze behalten" is off. */
    notKept: 'Umsätze werden auf diesem Rechner nicht behalten – schalte „Umsätze behalten“ zuerst ein.',
    locked: 'Die gespeicherten Umsätze lassen sich mit dieser PIN nicht öffnen.',
  },
  /** Older Umsätze from the online banking's export (lib/bank-import.ts, components/settings/ImportDialog.tsx). */
  import: {
    row: 'Ältere Umsätze importieren',
    rowHint: 'CSV, camt oder MT940 aus deinem Online-Banking',
    open: 'Importieren …',
    title: 'Ältere Umsätze importieren',
    intro: 'Lade im Online-Banking deiner Bank die Umsätze eines Zeitraums herunter – ungefiltert, als CSV, camt.053 oder MT940 – und wähle die Datei hier. Girovo ergänzt damit nur Tage, die es noch nicht gespeichert hat; was die Bank per FinTS geliefert hat, bleibt unverändert.',
    choose: 'Datei wählen …',
    none: 'Noch keine Datei gewählt',
    reading: 'Datei wird gelesen …',
    format: { csv: 'CSV', mt940: 'MT940', camt: 'camt' },
    found: (format: string, count: string, from: string, to: string) => `${format} · ${count} vom ${from} bis ${to}`,
    skipped: (n: number) => `${nDe(n)} ${n === 1 ? 'Zeile ist' : 'Zeilen sind'} kein gebuchter Umsatz und ${n === 1 ? 'bleibt' : 'bleiben'} außen vor.`,
    account: 'Konto',
    foreign: 'Die Datei nennt ein Konto, das zu dieser Anmeldung nicht gehört. Prüfe, ob du das richtige Konto gewählt hast.',
    run: 'Importieren',
    done: (days: number, count: string) =>
      days ? `${nDe(days)} ${days === 1 ? 'Tag' : 'Tage'} mit ${count} ergänzt.` : 'Nichts Neues – diese Tage sind schon gespeichert.',
    keepOff: 'Importieren geht nur, solange „Umsätze behalten“ an ist.',
    server: {
      tooLarge: 'Die Datei ist zu groß.',
      notReadable: 'Diese Datei kann Girovo nicht lesen. Exportiere die Umsätze als CSV, camt.053 oder MT940.',
      noAccount: 'Wähle das Konto, zu dem die Datei gehört.',
      nothing: 'Die Datei enthält keine Tage, die sich ergänzen ließen.',
    },
  },
};

export const en: typeof de = {
  keep: 'Keep transactions on this computer',
  keepHint: 'Encrypted with your PIN.',
  keptSince: (date) => `Kept since ${date}, encrypted with your PIN.`,
  loading: 'Loading saved transactions…',
  unreadable: 'Can’t be opened with this PIN – usually because it has changed. Nothing is added until you start again.',
  unavailable: 'The saved transactions could not be loaded. Nothing is added in this session.',
  startOver: 'Start again…',

  offDialog: {
    title: 'Delete saved transactions?',
    description: 'The app stops keeping your transactions and deletes the ones saved so far from this computer, earlier backups included. This cannot be undone.',
    body: 'Your bank keeps showing them for as long as it offers them – often only the last few months.',
    confirm: 'Turn off and delete',
  },

  resetDialog: {
    title: 'Start saved transactions again?',
    description: 'The current file can’t be opened with this PIN. It stays on this computer as a backup, and the app starts a new one.',
    confirm: 'Start again',
  },

  turnedOn: 'Your transactions will be kept on this computer from now on.',
  deleted: 'The saved transactions have been deleted from this computer. No more will be added.',
  restarted: 'Started again – your transactions are being kept again.',

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
    wipe: 'The saved transactions could not be deleted completely. Please try again.',
    unknownAction: 'Unknown action.',
    notKept: 'Transactions are not kept on this computer – switch on “Keep transactions” first.',
    locked: 'The saved transactions cannot be opened with this PIN.',
  },
  import: {
    row: 'Import older transactions',
    rowHint: 'CSV, camt or MT940 from your online banking',
    open: 'Import …',
    title: 'Import older transactions',
    intro: 'Download a period’s transactions in your bank’s online banking – unfiltered, as CSV, camt.053 or MT940 – and choose the file here. Girovo only adds days it has not saved yet; what the bank delivered via FinTS stays as it is.',
    choose: 'Choose file …',
    none: 'No file chosen yet',
    reading: 'Reading the file …',
    format: { csv: 'CSV', mt940: 'MT940', camt: 'camt' },
    found: (format, count, from, to) => `${format} · ${count} from ${from} to ${to}`,
    skipped: (n) => `${nEn(n)} ${n === 1 ? 'row is' : 'rows are'} not a booked transaction and ${n === 1 ? 'is' : 'are'} left out.`,
    account: 'Account',
    foreign: 'The file names an account that does not belong to this login. Check that you chose the right account.',
    run: 'Import',
    done: (days, count) => (days ? `${nEn(days)} ${days === 1 ? 'day' : 'days'} with ${count} added.` : 'Nothing new – these days are already saved.'),
    keepOff: 'Importing only works while “Keep transactions” is on.',
    server: {
      tooLarge: 'The file is too large.',
      notReadable: 'Girovo cannot read this file. Export the transactions as CSV, camt.053 or MT940.',
      noAccount: 'Choose the account the file belongs to.',
      nothing: 'The file holds no days that could be added.',
    },
  },
};
