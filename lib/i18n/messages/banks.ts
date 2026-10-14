// More than one bank in one view (lib/linked-banks.ts): "Weitere Bank
// anmelden" and its sheet (components/AddBank.tsx), the banks in the account
// list and the Sitzung panel, and what the approval overlay and Mitteilungen
// say once there are several. Bank names arrive as the bank sent them.

import type { ReactNode } from 'react';

export const de = {
  /** The action, and the name of the sheet it opens. */
  add: 'Weitere Bank anmelden',
  /** Over the login step the sheet shows: where in the login's three steps the user is. */
  step: (step: number, of: number) => `Weitere Bank anmelden · Schritt ${step} von ${of}`,
  /** After the next login: a remembered bank, one click from its login form. */
  alsoLogin: (bank: string) => `Auch bei ${bank} anmelden`,
  loginAgain: 'Erneut anmelden',
  /** A bank's state, in the account list and the Sitzung panel. */
  state: {
    /** The first login: its encrypted store holds the personal data of the whole view. */
    primary: 'Hauptanmeldung – hier liegen deine gespeicherten Daten',
    active: 'Angemeldet',
    /** Its session ended during this one; its accounts stay as they were last read. */
    loggedOut: 'Abgemeldet',
    /** Remembered from an earlier session, not logged in now. */
    remembered: 'Nicht angemeldet',
  },
  /** The Sitzung panel's group of banks. */
  group: 'Banken',
  /** Why a further login was not added. */
  refused: {
    sameLogin: (bank: string) => `Bei ${bank} bist du mit diesem Anmeldenamen schon angemeldet.`,
    /** `accounts`: the accounts' names, quoted and joined. */
    collision: (accounts: string, count: number, bank: string) =>
      `${accounts} ${count === 1 ? 'hat' : 'haben'} dieselbe Kontonummer wie ein Konto, das schon angezeigt wird. `
      + `Zwei Konten mit derselben Kontonummer kann Girovo nicht nebeneinander zeigen – ${bank} wurde deshalb nicht hinzugefügt.`,
    nothingNew: (bank: string) => `Alle Konten dieser Anmeldung werden schon angezeigt – ${bank} wurde nicht noch einmal hinzugefügt.`,
    tooMany: (n: number) => `Neben deiner Hauptbank kann Girovo höchstens ${n} weitere Banken zeigen.`,
  },
  added: (bank: string, n: number) => `Bei ${bank} angemeldet – ${n === 1 ? '1 Konto' : `${n} Konten`} hinzugefügt.`,
  cancelled: (bank: string) => `Anmeldung bei ${bank} abgebrochen.`,
  /** A read or an order for an account whose bank's session has ended. */
  loggedOutRead: (bank: string) => `Bei ${bank} bist du nicht mehr angemeldet. Melde dich dort erneut an.`,
  /** A linked bank's session ended (the server forgot it): that bank only, the rest stays. */
  ended: (bank: string) => `Deine Sitzung bei ${bank} ist beendet. Deine anderen Banken bleiben angemeldet.`,
  /** Opens the confirmation; the bank's name for screen readers. */
  remove: 'Entfernen …',
  removeNamed: (bank: string) => `${bank} entfernen …`,
  removeDialog: {
    title: 'Bank entfernen?',
    description: (bank: string) => `${bank} und ihre Konten verschwinden aus deiner Übersicht.`,
    body: 'Girovo meldet dich dort ab und bietet die Anmeldung beim nächsten Mal nicht mehr an. Bei deiner Bank selbst ändert sich nichts.',
    confirm: 'Bank entfernen',
  },
  removed: (bank: string) => `${bank} entfernt.`,
  /** Gesamtsaldo: the linked banks that are not logged in, so their accounts are missing. */
  notLoggedIn: (banks: string) => `Nicht angemeldet: ${banks}`,
  /** The approval overlay, once more than one bank is in the view. */
  asks: (bank: ReactNode): ReactNode[] => [bank, ' fragt nach dieser Freigabe'],
  /** Mitteilungen, once more than one bank is in the view: who sent it. */
  from: (bank: string) => `Von ${bank}`,
  /** The account list's name for one bank's accounts. */
  accountsAt: (bank: string) => `Konten bei ${bank}`,
};

export const en: typeof de = {
  add: 'Log in to another bank',
  step: (step, of) => `Log in to another bank · step ${step} of ${of}`,
  alsoLogin: (bank) => `Also log in to ${bank}`,
  loginAgain: 'Log in again',
  state: {
    primary: 'Main login – your saved data lives here',
    active: 'Logged in',
    loggedOut: 'Logged out',
    remembered: 'Not logged in',
  },
  group: 'Banks',
  refused: {
    sameLogin: (bank) => `You are already logged in to ${bank} with this login name.`,
    collision: (accounts, count, bank) =>
      `${accounts} ${count === 1 ? 'has' : 'have'} the same account number as an account already shown. `
      + `Girovo cannot show two accounts with the same account number side by side – so ${bank} was not added.`,
    nothingNew: (bank) => `Every account of this login is already shown – ${bank} was not added again.`,
    tooMany: (n) => `Beside your main bank, Girovo can show at most ${n} more banks.`,
  },
  added: (bank, n) => `Logged in to ${bank} – ${n === 1 ? '1 account' : `${n} accounts`} added.`,
  cancelled: (bank) => `Login to ${bank} cancelled.`,
  loggedOutRead: (bank) => `You are no longer logged in to ${bank}. Log in there again.`,
  ended: (bank) => `Your session with ${bank} has ended. Your other banks stay logged in.`,
  remove: 'Remove…',
  removeNamed: (bank) => `Remove ${bank}…`,
  removeDialog: {
    title: 'Remove bank?',
    description: (bank) => `${bank} and its accounts leave your overview.`,
    body: 'Girovo logs you out there and stops offering this login next time. Nothing changes at your bank itself.',
    confirm: 'Remove bank',
  },
  removed: (bank) => `${bank} removed.`,
  notLoggedIn: (banks) => `Not logged in: ${banks}`,
  asks: (bank) => [bank, ' is asking for this approval'],
  from: (bank) => `From ${bank}`,
  accountsAt: (bank) => `Accounts at ${bank}`,
};
