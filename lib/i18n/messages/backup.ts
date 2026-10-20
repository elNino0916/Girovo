// A backup of what Girovo keeps on this machine (lib/backup.ts,
// components/settings/BackupDialogs.tsx): made, and restored.

const nDe = (n: number) => n.toLocaleString('de-DE');
const nEn = (n: number) => n.toLocaleString('en-GB');
const countDe = (n: number, one: string, many: string) => `${nDe(n)} ${n === 1 ? one : many}`;
const countEn = (n: number, one: string, many: string) => `${nEn(n)} ${n === 1 ? one : many}`;

export const de = {
  /** The offered file name, ASCII only: "Girovo-Sicherung_2026-10-19.girovo". */
  file: 'Girovo-Sicherung',
  /** Einstellungen → Auf diesem Rechner. */
  row: {
    title: 'Sicherung',
    hint: 'Daten, Umsätze und Dokumente als verschlüsselte Datei',
    make: 'Erstellen …',
    restore: 'Wiederherstellen …',
  },
  make: {
    title: 'Sicherung erstellen',
    intro: 'Die Datei enthält alles, was Girovo auf diesem Rechner für die angemeldeten Banken aufbewahrt: Vorlagen, Kategorien, Notizen, Budgets, die gespeicherten Umsätze und deine Dokumente. Sie wird mit einem Passwort verschlüsselt, das du jetzt wählst.',
    password: 'Passwort für die Sicherung',
    confirm: 'Passwort wiederholen',
    hint: (n: number) => `Mindestens ${n} Zeichen. Ohne dieses Passwort lässt sich die Sicherung nicht öffnen – auch nicht von uns.`,
    tooShort: (n: number) => `Das Passwort braucht mindestens ${n} Zeichen.`,
    mismatch: 'Die beiden Passwörter stimmen nicht überein.',
    save: 'Sicherung speichern',
    saved: 'Sicherung gespeichert',
    /** One line per bank in the answer. */
    summary: (bank: string, accounts: number, bookings: number, docs: number) =>
      `${bank}: ${countDe(bookings, 'Umsatz', 'Umsätze')} aus ${countDe(accounts, 'Konto', 'Konten')}, ${countDe(docs, 'Dokument', 'Dokumente')}`,
    missing: (bank: string) => `${bank}: Ein Teil der Daten ließ sich mit der PIN nicht öffnen und ist nicht enthalten.`,
  },
  restore: {
    title: 'Sicherung wiederherstellen',
    intro: 'Was die Sicherung enthält, kommt zu dem dazu, was hier schon gespeichert ist – Vorhandenes bleibt, wie es ist. Wiederhergestellt wird nur für Banken, bei denen du gerade angemeldet bist.',
    file: 'Datei',
    choose: 'Datei wählen …',
    none: 'Noch keine Datei gewählt',
    password: 'Passwort der Sicherung',
    run: 'Wiederherstellen',
    done: 'Sicherung wiederhergestellt',
    result: (bank: string, days: number, docs: number, vault: boolean) =>
      `${bank}: ${[vault ? 'persönliche Daten' : '', days ? `${countDe(days, 'Tag', 'Tage')} Umsätze` : '', docs ? countDe(docs, 'Dokument', 'Dokumente') : ''].filter(Boolean).join(', ') || 'nichts Neues'}`,
    skipped: (bank: string) => `${bank || 'Eine Bank'}: nicht angemeldet – melde dich dort an und stelle die Sicherung noch einmal wieder her.`,
    historyOff: (bank: string) => `${bank}: Die Umsätze wurden nicht übernommen, weil „Umsätze behalten“ aus ist.`,
    full: (bank: string, n: number) => `${bank}: ${countDe(n, 'Dokument passte', 'Dokumente passten')} nicht mehr in den Speicher.`,
  },
  server: {
    format: 'Die Sicherung ist beschädigt und lässt sich nicht lesen.',
    notABackup: 'Das ist keine Girovo-Sicherung.',
    newer: 'Diese Sicherung stammt aus einer neueren Girovo-Version. Aktualisiere Girovo und versuche es dann noch einmal.',
    password: 'Das Passwort passt nicht zu dieser Sicherung.',
    tooShort: (n: number) => `Das Passwort braucht mindestens ${n} Zeichen.`,
    nothing: 'Es gibt nichts zu sichern.',
    tooLarge: 'Die Sicherung ist zu groß.',
    unknownAction: 'Unbekannte Aktion.',
  },
};

export const en: typeof de = {
  file: 'Girovo-backup',
  row: {
    title: 'Backup',
    hint: 'Data, transactions and documents as one encrypted file',
    make: 'Create …',
    restore: 'Restore …',
  },
  make: {
    title: 'Create backup',
    intro: 'The file holds everything Girovo keeps on this computer for the banks you are logged in to: templates, categories, notes, budgets, the saved transactions and your documents. It is encrypted with a password you choose now.',
    password: 'Password for the backup',
    confirm: 'Repeat password',
    hint: (n) => `At least ${n} characters. Without this password the backup cannot be opened – not even by us.`,
    tooShort: (n) => `The password needs at least ${n} characters.`,
    mismatch: 'The two passwords do not match.',
    save: 'Save backup',
    saved: 'Backup saved',
    summary: (bank, accounts, bookings, docs) =>
      `${bank}: ${countEn(bookings, 'transaction', 'transactions')} from ${countEn(accounts, 'account', 'accounts')}, ${countEn(docs, 'document', 'documents')}`,
    missing: (bank) => `${bank}: Part of the data could not be opened with the PIN and is not included.`,
  },
  restore: {
    title: 'Restore backup',
    intro: 'What the backup holds is added to what is already saved here – nothing here is changed. Only banks you are logged in to right now are restored.',
    file: 'File',
    choose: 'Choose file …',
    none: 'No file chosen yet',
    password: 'Backup password',
    run: 'Restore',
    done: 'Backup restored',
    result: (bank, days, docs, vault) =>
      `${bank}: ${[vault ? 'personal data' : '', days ? `${countEn(days, 'day', 'days')} of transactions` : '', docs ? countEn(docs, 'document', 'documents') : ''].filter(Boolean).join(', ') || 'nothing new'}`,
    skipped: (bank) => `${bank || 'A bank'}: not logged in – log in there and restore the backup again.`,
    historyOff: (bank) => `${bank}: The transactions were not restored because “Keep transactions” is off.`,
    full: (bank, n) => `${bank}: ${countEn(n, 'document', 'documents')} no longer fitted into the storage.`,
  },
  server: {
    format: 'The backup is damaged and cannot be read.',
    notABackup: 'This is not a Girovo backup.',
    newer: 'This backup comes from a newer version of Girovo. Update Girovo and try again.',
    password: 'The password does not match this backup.',
    tooShort: (n) => `The password needs at least ${n} characters.`,
    nothing: 'There is nothing to back up.',
    tooLarge: 'The backup is too large.',
    unknownAction: 'Unknown action.',
  },
};
