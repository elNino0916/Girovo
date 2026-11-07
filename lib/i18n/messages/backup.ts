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
    hint: 'Daten, Umsätze und Dokumente in einer Datei mit Passwort',
    make: 'Erstellen …',
    restore: 'Wiederherstellen …',
  },
  make: {
    title: 'Sicherung erstellen',
    intro: 'Die Datei enthält Vorlagen, Kategorien, Notizen, Budgets, Umsätze und Dokumente deiner angemeldeten Banken. Sie ist mit einem Passwort geschützt, das du jetzt wählst.',
    password: 'Passwort für die Sicherung',
    confirm: 'Passwort wiederholen',
    hint: (n: number) => `Mindestens ${n} Zeichen. Vergisst du es, lässt sich die Sicherung nicht mehr öffnen.`,
    tooShort: (n: number) => `Das Passwort braucht mindestens ${n} Zeichen.`,
    mismatch: 'Die beiden Passwörter stimmen nicht überein.',
    save: 'Sicherung speichern',
    saved: 'Sicherung gespeichert',
    /** One line per bank in the answer. */
    summary: (bank: string, accounts: number, bookings: number, docs: number) =>
      `${bank}: ${countDe(bookings, 'Umsatz', 'Umsätze')} aus ${countDe(accounts, 'Konto', 'Konten')}, ${countDe(docs, 'Dokument', 'Dokumente')}`,
    missing: (bank: string) => `${bank}: Einige Daten ließen sich nicht öffnen und fehlen in der Sicherung.`,
  },
  restore: {
    title: 'Sicherung wiederherstellen',
    intro: 'Die Sicherung ergänzt deine Daten, nichts wird überschrieben. Das klappt nur für Banken, bei denen du gerade angemeldet bist.',
    file: 'Datei',
    choose: 'Datei wählen …',
    none: 'Noch keine Datei gewählt',
    password: 'Passwort der Sicherung',
    run: 'Wiederherstellen',
    done: 'Sicherung wiederhergestellt',
    result: (bank: string, days: number, docs: number, vault: boolean) =>
      `${bank}: ${[vault ? 'persönliche Daten' : '', days ? `${countDe(days, 'Tag', 'Tage')} Umsätze` : '', docs ? countDe(docs, 'Dokument', 'Dokumente') : ''].filter(Boolean).join(', ') || 'nichts Neues'}`,
    skipped: (bank: string) => `${bank || 'Eine Bank'}: nicht angemeldet. Melde dich an und versuche es noch einmal.`,
    historyOff: (bank: string) => `${bank}: Die Umsätze wurden nicht übernommen, weil „Umsätze behalten“ aus ist.`,
    full: (bank: string, n: number) => `${bank}: Für ${countDe(n, 'Dokument', 'Dokumente')} war kein Platz mehr.`,
  },
  server: {
    format: 'Die Sicherung ist beschädigt.',
    notABackup: 'Das ist keine Girovo-Sicherung.',
    newer: 'Die Sicherung stammt aus einer neueren Version. Aktualisiere Girovo und versuche es noch einmal.',
    password: 'Das Passwort stimmt nicht.',
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
    hint: 'Data, transactions and documents in one file with a password',
    make: 'Create …',
    restore: 'Restore …',
  },
  make: {
    title: 'Create backup',
    intro: 'The file holds the templates, categories, notes, budgets, transactions and documents of the banks you are logged in to. It is protected with a password you choose now.',
    password: 'Password for the backup',
    confirm: 'Repeat password',
    hint: (n) => `At least ${n} characters. If you forget it, the backup can’t be opened any more.`,
    tooShort: (n) => `The password needs at least ${n} characters.`,
    mismatch: 'The two passwords do not match.',
    save: 'Save backup',
    saved: 'Backup saved',
    summary: (bank, accounts, bookings, docs) =>
      `${bank}: ${countEn(bookings, 'transaction', 'transactions')} from ${countEn(accounts, 'account', 'accounts')}, ${countEn(docs, 'document', 'documents')}`,
    missing: (bank) => `${bank}: Some data couldn’t be opened and is missing from the backup.`,
  },
  restore: {
    title: 'Restore backup',
    intro: 'The backup adds to your data, nothing is overwritten. This only works for banks you are logged in to right now.',
    file: 'File',
    choose: 'Choose file …',
    none: 'No file chosen yet',
    password: 'Backup password',
    run: 'Restore',
    done: 'Backup restored',
    result: (bank, days, docs, vault) =>
      `${bank}: ${[vault ? 'personal data' : '', days ? `${countEn(days, 'day', 'days')} of transactions` : '', docs ? countEn(docs, 'document', 'documents') : ''].filter(Boolean).join(', ') || 'nothing new'}`,
    skipped: (bank) => `${bank || 'A bank'}: not logged in. Log in and try again.`,
    historyOff: (bank) => `${bank}: The transactions were not restored because “Keep transactions” is off.`,
    full: (bank, n) => `${bank}: There was no room for ${countEn(n, 'document', 'documents')}.`,
  },
  server: {
    format: 'The backup is damaged.',
    notABackup: 'This is not a Girovo backup.',
    newer: 'The backup comes from a newer version. Update Girovo and try again.',
    password: 'The password is wrong.',
    tooShort: (n) => `The password needs at least ${n} characters.`,
    nothing: 'There is nothing to back up.',
    tooLarge: 'The backup is too large.',
    unknownAction: 'Unknown action.',
  },
};
