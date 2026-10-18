// Umsätze kept on this computer (lib/history.ts, lib/history-store.ts): the
// switch in the Sitzung panel and its dialogs, what the list and the Zeitraum
// control say about the kept part, and the server's refusals.

export const de = {
  /** The switch in the Sitzung panel's "Auf diesem Rechner". */
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
  },
};
