// Monthly budgets and the Kategorie-Check in the Analyse
// (components/insights/Budgets.tsx, components/insights/CategoryCheck.tsx),
// and notes on bookings (components/transactions/NoteSection.tsx, the row's
// mark, lib/csv.ts's Notiz column).

import type { ReactNode } from 'react';
import { INTL_LOCALES } from '../locale.ts';

/** "4 Umsätze": a count and its noun, joined by a no-break space so they never wrap apart. */
const counted = (n: number, one: string, many: string) =>
  `${n.toLocaleString(INTL_LOCALES.de)}\u00a0${n === 1 ? one : many}`;

export const de = {
  /** Monatsbudgets: the tile in the Analyse and the dialog that sets them. */
  budget: {
    title: 'Monatsbudgets',
    /** The categories tile's way in, while no budget is set. */
    set: 'Budgets festlegen',
    edit: 'Bearbeiten',
    editLabel: 'Monatsbudgets bearbeiten',
    /** A row's figures: "212,40 € von 300,00 €". */
    of: (spent: ReactNode, budget: ReactNode): ReactNode[] => [spent, ' von ', budget],
    /** …in a month that is not fully loaded: the spending is a floor. */
    atLeastOf: (spent: ReactNode, budget: ReactNode): ReactNode[] => ['mind. ', spent, ' von ', budget],
    left: (amount: ReactNode): ReactNode[] => [amount, ' übrig'],
    over: (amount: ReactNode): ReactNode[] => [amount, ' drüber'],
    overAtLeast: (amount: ReactNode): ReactNode[] => ['mind. ', amount, ' drüber'],
    exact: 'Budget ausgeschöpft',
    /** Under the budget so far, in a month that is not fully loaded. */
    unknown: 'Rest offen – Monat nicht ganz geladen',
    /** The whole range on view: a budget's own figure. */
    perMonth: (amount: ReactNode): ReactNode[] => [amount, ' pro Monat'],
    running: (day: string) => `Der Monat läuft noch – Stand ${day}.`,
    partial: (from: string, to: string) =>
      `Für diesen Monat sind nur die Umsätze vom ${from} bis ${to} geladen. Die Ausgaben sind daher Mindestwerte.`,
    none: 'Für diesen Monat sind keine Umsätze geladen.',
    wholeRange: 'Budgets gelten pro Monat. Wähle oben einen Monat, um deine Ausgaben damit zu vergleichen.',
    showMonth: (month: string) => `${month} anzeigen`,
    basis: 'Gezählt wie unter „Ausgaben nach Kategorie“: gebuchte Umsätze, Erstattungen verrechnet, ohne Umbuchungen.',
    dialog: {
      title: 'Monatsbudgets',
      intro: 'Wie viel möchtest du pro Monat in einer Kategorie höchstens ausgeben? Ein leeres Feld heißt: kein Budget.',
      /** Under a category: what it cost so far, as a guide. */
      average: (amount: ReactNode): ReactNode[] => ['bisher Ø ', amount, ' pro Monat'],
      amountFor: (category: string) => `Budget für ${category} pro Monat`,
      invalid: 'Gib einen Betrag ein, zum Beispiel 250 oder 250,50.',
      notPositive: 'Der Betrag muss größer als 0 sein.',
      tooLarge: (max: string) => `Höchstens ${max}.`,
      private: 'Verschlüsselt auf diesem Rechner gespeichert. Deine Bank erfährt davon nichts.',
    },
  },

  /** A personal note on a booking. */
  notes: {
    title: 'Notiz',
    add: 'Notiz hinzufügen',
    edit: 'Bearbeiten',
    editLabel: 'Notiz bearbeiten',
    remove: 'Löschen',
    removeLabel: 'Notiz löschen',
    field: 'Deine Notiz zu diesem Umsatz',
    placeholder: 'z. B. Geschenk für Mama',
    hint: 'Nur für dich, verschlüsselt auf diesem Rechner. Die Suche findet sie, der CSV-Export enthält sie, der Beleg nicht.',
    saved: 'Notiz gespeichert.',
    removed: 'Notiz gelöscht.',
    /** The row's mark: its tooltip, and what a screen reader hears. */
    marker: 'Mit Notiz',
    oldestDropped: (n: number) => (n === 1
      ? 'Der Platz für Notizen ist voll – die älteste wurde entfernt.'
      : `Der Platz für Notizen ist voll – die ${n} ältesten wurden entfernt.`),
    /** The CSV export's last column. */
    csvColumn: 'Notiz',
  },

  /** The Kategorie-Check, opened from "Ausgaben nach Kategorie". */
  check: {
    title: 'Kategorie-Check',
    open: 'Kategorie-Check',
    /** The categories tile's footer: "31 von 35 automatisch zugeordneten Umsätzen hast du so gelassen". */
    summary: (kept: number, filed: number) =>
      `${kept.toLocaleString(INTL_LOCALES.de)} von ${counted(filed, 'automatisch zugeordnetem Umsatz', 'automatisch zugeordneten Umsätzen')} hast du so gelassen`,
    noneFiled: 'Noch kein Umsatz automatisch zugeordnet',
    openCount: (n: number) => `${counted(n, 'Umsatz', 'Umsätze')} ohne Kategorie`,
    intro: 'Wie gut die automatischen Kategorien zu deinen Umsätzen passen. Ausgewertet auf diesem Rechner – nichts davon verlässt ihn.',
    facts: {
      filed: 'Automatisch zugeordnet',
      kept: 'So gelassen',
      changed: 'Von dir geändert',
      byYou: 'Von dir zugeordnet',
      open: 'Noch ohne Kategorie',
    },
    sources: {
      caption: 'Automatisch zugeordnete Umsätze nach Herkunft',
      source: 'Herkunft',
      filed: 'Zugeordnet',
      changed: 'Geändert',
      rules: 'Buchungscodes und Stichwörter',
      model: 'Kategoriemodell auf diesem Rechner',
    },
    changedTitle: 'Von dir geändert',
    changedEmpty: 'Du hast bisher keine automatische Zuordnung geändert.',
    by: {
      manual: 'einzeln geändert',
      rule: 'deine Regel',
      mixed: 'Regel und einzeln',
    },
    /** "Shopping → Lebensmittel", and the same in words for a screen reader. */
    fromTo: (from: string, to: string) => `${from} → ${to}`,
    fromToSpoken: (from: string, to: string) => `automatisch ${from}, von dir ${to}`,
    openTitle: 'Noch ohne Kategorie',
    openEmpty: 'Jeder dieser Umsätze hat eine Kategorie.',
    openHint:
      'Eine Kategorie, die du hier wählst, gilt für alle Umsätze dieses Empfängers oder Auftraggebers – auch für künftige. Einzelne Umsätze ordnest du in den Umsatzdetails zu.',
    assign: 'Zuordnen',
    assignFor: (name: string) => `Kategorie für ${name} wählen`,
    filed: (name: string, category: string) => `${name}: unter ${category} abgelegt.`,
    /** A row's facts: "4 Umsätze · zuletzt 28.09.2026". */
    lastOn: (day: string) => `zuletzt ${day}`,
    more: (n: number) => `und ${counted(n, 'weitere Zeile', 'weitere Zeilen')}`,
  },
};

const countedEn = (n: number, one: string, many: string) =>
  `${n.toLocaleString(INTL_LOCALES.en)}\u00a0${n === 1 ? one : many}`;

export const en: typeof de = {
  budget: {
    title: 'Monthly budgets',
    set: 'Set budgets',
    edit: 'Edit',
    editLabel: 'Edit monthly budgets',
    of: (spent, budget) => [spent, ' of ', budget],
    atLeastOf: (spent, budget) => ['at least ', spent, ' of ', budget],
    left: (amount) => [amount, ' left'],
    over: (amount) => [amount, ' over'],
    overAtLeast: (amount) => ['at least ', amount, ' over'],
    exact: 'Budget used up',
    unknown: 'Rest unclear – month not fully loaded',
    perMonth: (amount) => [amount, ' a month'],
    running: (day) => `The month is still running – as of ${day}.`,
    partial: (from, to) =>
      `Only the transactions from ${from} to ${to} are loaded for this month, so the spending shown is a minimum.`,
    none: 'No transactions are loaded for this month.',
    wholeRange: 'Budgets are per month. Choose a month above to compare your spending with them.',
    showMonth: (month) => `Show ${month}`,
    basis: 'Counted as in “Spending by category”: booked transactions, refunds netted, transfers between your accounts left out.',
    dialog: {
      title: 'Monthly budgets',
      intro: 'How much do you want to spend at most in a category each month? An empty field means no budget.',
      average: (amount) => ['so far ', amount, ' a month on average'],
      amountFor: (category) => `Budget for ${category} per month`,
      invalid: 'Enter an amount, for example 250 or 250.50.',
      notPositive: 'The amount must be more than 0.',
      tooLarge: (max) => `At most ${max}.`,
      private: 'Saved encrypted on this computer. Your bank learns nothing of it.',
    },
  },

  notes: {
    title: 'Note',
    add: 'Add note',
    edit: 'Edit',
    editLabel: 'Edit note',
    remove: 'Delete',
    removeLabel: 'Delete note',
    field: 'Your note on this transaction',
    placeholder: 'e.g. Birthday present for Mum',
    hint: 'Only for you, encrypted on this computer. The search finds it and the CSV export includes it; the receipt does not.',
    saved: 'Note saved.',
    removed: 'Note deleted.',
    marker: 'With note',
    oldestDropped: (n) => (n === 1
      ? 'The space for notes is full – the oldest one was removed.'
      : `The space for notes is full – the ${n} oldest were removed.`),
    csvColumn: 'Note',
  },

  check: {
    title: 'Category check',
    open: 'Category check',
    summary: (kept, filed) =>
      `You left ${kept.toLocaleString(INTL_LOCALES.en)} of ${countedEn(filed, 'automatically categorised transaction', 'automatically categorised transactions')} as they were`,
    noneFiled: 'No transaction categorised automatically yet',
    openCount: (n) => `${countedEn(n, 'transaction', 'transactions')} without a category`,
    intro: 'How well the automatic categories fit your transactions. Worked out on this computer – none of it leaves it.',
    facts: {
      filed: 'Categorised automatically',
      kept: 'Left as they were',
      changed: 'Changed by you',
      byYou: 'Categorised by you',
      open: 'Still without a category',
    },
    sources: {
      caption: 'Automatically categorised transactions by source',
      source: 'Source',
      filed: 'Categorised',
      changed: 'Changed',
      rules: 'Booking codes and keywords',
      model: 'Category model on this computer',
    },
    changedTitle: 'Changed by you',
    changedEmpty: 'You haven’t changed any automatic category yet.',
    by: {
      manual: 'changed one by one',
      rule: 'your rule',
      mixed: 'rule and one by one',
    },
    fromTo: (from, to) => `${from} → ${to}`,
    fromToSpoken: (from, to) => `automatically ${from}, by you ${to}`,
    openTitle: 'Still without a category',
    openEmpty: 'Every one of these transactions has a category.',
    openHint:
      'A category you choose here applies to all transactions with this payee or payer – future ones too. To file a single transaction, open its details.',
    assign: 'Categorise',
    assignFor: (name) => `Choose a category for ${name}`,
    filed: (name, category) => `${name}: filed under ${category}.`,
    lastOn: (day) => `latest ${day}`,
    more: (n) => `and ${countedEn(n, 'more row', 'more rows')}`,
  },
};
