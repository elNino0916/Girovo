// Words several screens share: the buttons every dialog has, the names of the
// app's places, the terms of a booking. One translation for each, so
// "Abbrechen" is never "Cancel" in one dialog and "Abort" in the next.

export const de = {
  /** The page description (app/layout.tsx). */
  appDescription: 'Direktzugang zu deiner Bank über FinTS 3.0',
  cancel: 'Abbrechen',
  close: 'Schließen',
  /** The top app bar's way up from a page reached from another (Einstellungen on a phone). */
  back: 'Zurück',
  done: 'Fertig',
  save: 'Speichern',
  delete: 'Löschen',
  retry: 'Erneut versuchen',
  copied: 'Kopiert',
  more: 'Mehr',
  logout: 'Abmelden',
  search: 'Suche',
  shortcuts: 'Tastenkürzel',
  hideAmounts: 'Beträge ausblenden',
  showAmounts: 'Beträge anzeigen',
  /** What a hidden amount reads as to a screen reader. */
  amountHidden: 'Betrag ausgeblendet',
  theme: {
    label: 'Darstellung',
    light: 'Hell',
    dark: 'Dunkel',
    system: 'System',
  },
  /** The app's places, as the navigation names them. */
  nav: {
    overview: 'Übersicht',
    transactions: 'Umsätze',
    analysis: 'Analyse',
    contracts: 'Verträge & Abos',
    settings: 'Einstellungen',
    messages: 'Mitteilungen',
  },
  /** A booking's terms, as a bank statement uses them. */
  booking: {
    transaction: 'Umsatz',
    transactions: 'Umsätze',
    pending: 'Vorgemerkt',
    amount: 'Betrag',
    purpose: 'Verwendungszweck',
    credit: 'Gutschrift',
    debit: 'Belastung',
    incoming: 'Eingänge',
    outgoing: 'Ausgänge',
    spending: 'Ausgaben',
    difference: 'Differenz',
    creditorId: 'Gläubiger-ID',
    instant: 'Echtzeit',
  },
  account: {
    account: 'Konto',
    accounts: 'Konten',
    balance: 'Kontostand',
    copyIban: 'IBAN kopieren',
  },
  /** An order whose outcome the bank did not confirm. */
  statusUnclear: 'Status unklar',
  approval: 'Freigabe',
  /**
   * Said once per section of a screen, beside the control there that asks
   * the bank for something (a read, a longer period) — not on every row of a
   * list, and not on a menu entry that only opens a panel: the panel's own
   * control says it.
   */
  mayNeedApproval: 'Kann eine Freigabe erfordern.',
  fetchFailed: 'Abruf fehlgeschlagen',
};

export const en: typeof de = {
  appDescription: 'Direct access to your bank over FinTS 3.0',
  cancel: 'Cancel',
  close: 'Close',
  back: 'Back',
  done: 'Done',
  save: 'Save',
  delete: 'Delete',
  retry: 'Try again',
  copied: 'Copied',
  more: 'More',
  logout: 'Log out',
  search: 'Search',
  shortcuts: 'Keyboard shortcuts',
  hideAmounts: 'Hide amounts',
  showAmounts: 'Show amounts',
  amountHidden: 'Amount hidden',
  theme: {
    label: 'Appearance',
    light: 'Light',
    dark: 'Dark',
    system: 'System',
  },
  nav: {
    overview: 'Overview',
    transactions: 'Transactions',
    analysis: 'Analysis',
    contracts: 'Contracts & subscriptions',
    settings: 'Settings',
    messages: 'Messages',
  },
  booking: {
    transaction: 'Transaction',
    transactions: 'Transactions',
    pending: 'Pending',
    amount: 'Amount',
    purpose: 'Payment reference',
    credit: 'Credit',
    debit: 'Debit',
    incoming: 'Money in',
    outgoing: 'Money out',
    spending: 'Spending',
    difference: 'Difference',
    creditorId: 'Creditor ID',
    instant: 'Instant',
  },
  account: {
    account: 'Account',
    accounts: 'Accounts',
    balance: 'Balance',
    copyIban: 'Copy IBAN',
  },
  statusUnclear: 'Status unclear',
  approval: 'Approval',
  mayNeedApproval: 'May need approval.',
  fetchFailed: 'Could not load',
};
