// What the app says while it works with the bank (components/FintsProvider.tsx), and what the server answers: API routes, bank errors, bank answers, the session log, the vault (app/api, lib/api.ts, lib/bank-fetch.ts, lib/bank-answer.ts, lib/session-log.ts, lib/vault.ts).

export const de = {
  /** The local server's own answers (lib/api.ts, lib/client-api.ts). */
  server: {
    /** The server no longer knows the session (HTTP 401). */
    sessionExpired: 'Sitzung abgelaufen. Bitte neu anmelden.',
    /** The request never reached the local server (crashed, restarting). */
    unreachable: 'Keine Verbindung zum lokalen Server. Bitte versuche es erneut.',
    /** An error answer that brought no message of its own. */
    failed: (status: number) => `Fehler (${status})`,
  },

  /** A bank that does not answer, or not usefully (lib/bank-answer.ts, lib/bank-fetch.ts). */
  bank: {
    /** An error page (maintenance), a reply that is no FinTS message, or no answer in time. */
    unavailable: 'Deine Bank antwortet gerade nicht – oft ist das eine Wartung.',
    /** No connection at all (no network, the name not resolved). */
    unreachable: 'Deine Bank ist gerade nicht erreichbar. Prüfe deine Internetverbindung.',
    /** The next step a login or a read adds to either sentence above — never an order. */
    tryAgainLater: 'Versuche es in ein paar Minuten noch einmal.',
    /** A return code the bank sent without a sentence. */
    noReason: 'Deine Bank hat keine Begründung mitgeschickt.',
    /** The bank's certificate did not check out. */
    insecure: 'Die Verbindung zu deiner Bank ließ sich nicht sicher aufbauen. Prüfe Datum und Uhrzeit dieses Rechners.',
    cancelled: 'Die Anfrage an deine Bank wurde abgebrochen.',
    unexpected: 'Bei der Verbindung mit deiner Bank ist ein unerwarteter Fehler aufgetreten.',
    /** lib-fints' English errors, as they concern the user. */
    tanEntryNeeded: 'Dieses Verfahren braucht eine TAN-Eingabe. Hier geht nur die Freigabe in einer Banking-App.',
    notOffered: 'Deine Bank bietet diesen Vorgang für dein Konto über FinTS nicht an.',
    noIban: 'Für dieses Konto meldet deine Bank keine IBAN.',
    /** The order went out and its answer never came back (lib/fints-order.ts): "Status unklar", never "failed". */
    orderUnanswered:
      'Die Verbindung zur Bank ist abgebrochen, nachdem der Auftrag gesendet wurde. Ob er ausgeführt wurde, ist unklar.',
  },

  /** The encrypted personal-data vault (lib/vault.ts, app/api/vault). */
  vault: {
    unavailable: 'Für diese Sitzung können keine persönlichen Daten gespeichert werden.',
    locked: 'Deine gespeicherten Daten lassen sich mit dieser PIN nicht öffnen. Setze sie zurück, um neu zu beginnen.',
    format: 'Die Daten haben ein unbekanntes Format.',
    tooLarge: 'Zu viele gespeicherte Einträge. Lösche ein paar Vorlagen oder Kategorie-Zuordnungen und versuche es erneut.',
    /** A request too large to be read at all. */
    tooMany: 'Zu viele gespeicherte Einträge.',
    read: 'Deine gespeicherten Daten konnten nicht gelesen werden.',
    write: 'Deine Daten konnten nicht gespeichert werden.',
    wipe: 'Deine gespeicherten Daten konnten nicht vollständig gelöscht werden. Bitte versuche es erneut.',
    noData: 'Keine Daten angegeben.',
    unknownAction: 'Unbekannte Aktion.',
    /** The client's notices about it (components/FintsProvider.tsx). */
    saveFailed: 'Deine persönlichen Einstellungen konnten nicht gespeichert werden.',
    reset: 'Persönliche Daten zurückgesetzt. Änderungen werden wieder gespeichert.',
    wiped: 'Deine gespeicherten Daten sind von diesem Rechner gelöscht. Bis zum Abmelden wird nichts mehr gespeichert.',
    templateInvalid: 'Vorlage nicht gespeichert: Name oder IBAN ist ungültig.',
  },

  /** What a logout says (lib/session-log.ts, components/FintsProvider.tsx). */
  logout: {
    /** "an Lea Becker", "an A, B und C": each payee once, `others` before the last one. */
    payees: (others: readonly string[], last: string) => (others.length ? `an ${others.join(', ')} und ${last}` : `an ${last}`),
    byUser: 'Du hast dich abgemeldet.',
    /** The login's own approval was called off. */
    loginCancelled: 'Anmeldung abgebrochen.',
    /** Added once the server confirmed it dropped the session, and the PIN with it. */
    pinDropped: 'Die App hat deine PIN verworfen.',
    idle: 'Du wurdest aus Sicherheitsgründen abgemeldet.',
    /** After `idle`: one transfer whose outcome is not known. `to` is a payees() phrase, or ''. */
    unclearOne: (to: string) =>
      `Der Status deiner Überweisung${to ? ` ${to}` : ''} ist unklar – prüfe deine Umsätze, bevor du sie noch einmal sendest.`,
    /** After `idle`: `count` (two or more) such transfers. */
    unclearMany: (count: number, to: string) =>
      `Der Status von ${count} Überweisungen${to ? ` ${to}` : ''} ist unklar – prüfe deine Umsätze, bevor du eine davon noch einmal sendest.`,
    expired: 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.',
  },

  /** An approval in the banking app being waited for (FintsProvider; TanWaitOverlay shows it). */
  wait: {
    /** What each kind of approval asks the user to confirm, as the object of "bestätige …". */
    subject: {
      login: 'die Anmeldung',
      statements: 'den Umsatzabruf',
      pending: 'den Abruf der vorgemerkten Umsätze',
      balance: 'die Saldoabfrage',
      transfer: 'die Überweisung',
    },
    /** The same, naming the account (the user's own name for it first) and the first day asked for. */
    statementsOf: (account: string, from: string) => `den Abruf der Umsätze von ${account} ab ${from}`,
    pendingOf: (account: string) => `den Abruf der vorgemerkten Umsätze von ${account}`,
    balanceOf: (account: string) => `die Saldoabfrage für ${account}`,
    /** With an app-approval method: the method as the bank names it ("pushTAN 2.0"). */
    openApp: (method: string, subject: string) => `Öffne „${method}“ und bestätige ${subject}.`,
    confirmInApp: (subject: string) => `Bestätige ${subject} in deiner Banking-App.`,
    /** A statement asking for its own approval right after the login's. */
    secondApproval: 'Die Anmeldung ist freigegeben – für die Umsätze fragt deine Bank ein zweites Mal.',
    /** The bank closed the dialog before the approval arrived — the bank's timeout, not the user's. */
    endedTitle: 'Freigabe nicht rechtzeitig angekommen',
    endedText: 'Deine Bank hat die Anfrage beendet. Sende sie neu und bestätige sie in der App.',
    /** The bank refused, or left it unclear, without a word of its own. */
    notConfirmed: 'Deine Bank hat die Freigabe nicht bestätigt.',
  },

  /** A wait, not a failure: said as a notice, never in the error's red. */
  busy: 'Bitte warten – ein anderer Vorgang läuft noch.',

  login: {
    /** A login the user called off while the bank was being asked. */
    cancelled: 'Die Anmeldung wurde abgebrochen.',
    deviceRecognised: 'Gerät erkannt – ohne neue Freigabe angemeldet.',
    noTanMethod: 'Deine Bank bietet für diesen Zugang kein Sicherheitsverfahren an.',
  },

  device: {
    saved: 'Gerät gemerkt – künftige Anmeldungen brauchen seltener eine Freigabe.',
    /** The action on that notice; it opens the confirmation. */
    forget: 'Gerät vergessen …',
    forgotten: 'Gerät vergessen – bei der nächsten Anmeldung fragt deine Bank wieder nach einer Freigabe.',
    forgottenAndWiped:
      'Gerät vergessen und deine gespeicherten Daten von diesem Rechner gelöscht. Bis zum Abmelden wird nichts mehr gespeichert.',
  },

  /** Reading statements, balances and pending transactions. */
  reads: {
    /** The bank's statement ends before a balance this session already holds. */
    cutShort: (until: string) =>
      `Deine Bank hat nur Umsätze bis ${until} geliefert. Der Kontostand bleibt der zuletzt abgerufene.`,
    /** An answer without a balance is not a zero balance. */
    noBalance: 'Deine Bank hat für dieses Konto keinen Saldo gemeldet.',
    balanceMismatch: 'Die Antwort deiner Bank passte nicht zur Saldoabfrage.',
    /** "Alle Salden abrufen" with only accounts left whose statement is the way to their balance. */
    balanceWithStatements:
      'Diese Konten melden ihren Saldo nur mit den Umsätzen. Wähle bei den Umsätzen einen Zeitraum bis heute.',
    /** An approval for a new period that was not given; `span` is the period still shown. */
    olderNotFetched: (span: string) => `Ältere Umsätze wurden nicht abgerufen – es bleibt beim Zeitraum ${span}.`,
    periodNotFetched: (span: string) => `Der neue Zeitraum wurde nicht abgerufen – es bleibt bei ${span}.`,
    invalidPeriod: 'Bitte einen gültigen Zeitraum wählen.',
    /** `reason`: the bank's or the server's words. */
    pendingFailed: (account: string, reason: string) =>
      `Abruf der vorgemerkten Umsätze für „${account}“ fehlgeschlagen: ${reason}`,
  },

  /** The transfer and request-money sheets, refused before they open. */
  launch: {
    noTransferAccount: 'Kein Konto unterstützt Überweisungen über FinTS.',
    noIbanAccount: 'Für keines deiner Konten liegt eine IBAN vor.',
  },

  /** In a plain browser, printing is the way to a PDF. */
  printAsPdf: 'Im Druckdialog „Als PDF speichern“ wählen.',
};

export const en: typeof de = {
  server: {
    sessionExpired: 'Session expired. Please log in again.',
    unreachable: 'No connection to the local server. Please try again.',
    failed: (status) => `Error (${status})`,
  },

  bank: {
    unavailable: 'Your bank isn’t answering right now – this is often maintenance.',
    unreachable: 'Your bank can’t be reached right now. Check your internet connection.',
    tryAgainLater: 'Try again in a few minutes.',
    noReason: 'Your bank didn’t give a reason.',
    insecure: 'A secure connection to your bank could not be established. Check the date and time on this computer.',
    cancelled: 'The request to your bank was cancelled.',
    unexpected: 'An unexpected error occurred in the connection to your bank.',
    tanEntryNeeded: 'This method needs a TAN to be entered. Only approval in a banking app works here.',
    notOffered: 'Your bank doesn’t offer this operation for your account over FinTS.',
    noIban: 'Your bank reports no IBAN for this account.',
    orderUnanswered:
      'The connection to the bank broke off after the order was sent. It is unclear whether it was completed.',
  },

  vault: {
    unavailable: 'No personal data can be saved for this session.',
    locked: 'Your saved data can’t be opened with this PIN. Reset it to start again.',
    format: 'The data is in an unknown format.',
    tooLarge: 'Too many saved entries. Delete a few templates or category assignments and try again.',
    tooMany: 'Too many saved entries.',
    read: 'Your saved data could not be read.',
    write: 'Your data could not be saved.',
    wipe: 'Your saved data could not be deleted completely. Please try again.',
    noData: 'No data given.',
    unknownAction: 'Unknown action.',
    saveFailed: 'Your personal settings could not be saved.',
    reset: 'Personal data reset. Changes will be saved again.',
    wiped: 'Your saved data has been deleted from this computer. Nothing more will be saved until you log out.',
    templateInvalid: 'Template not saved: the name or IBAN is invalid.',
  },

  logout: {
    payees: (others, last) => (others.length ? `to ${others.join(', ')} and ${last}` : `to ${last}`),
    byUser: 'You have logged out.',
    loginCancelled: 'Login cancelled.',
    pinDropped: 'The app has discarded your PIN.',
    idle: 'You were logged out for security reasons.',
    unclearOne: (to) =>
      `The status of your transfer${to ? ` ${to}` : ''} is unclear – check your transactions before you send it again.`,
    unclearMany: (count, to) =>
      `The status of ${count} transfers${to ? ` ${to}` : ''} is unclear – check your transactions before you send any of them again.`,
    expired: 'Your session has expired. Please log in again.',
  },

  wait: {
    subject: {
      login: 'the login',
      statements: 'the request for your transactions',
      pending: 'the request for your pending transactions',
      balance: 'the balance enquiry',
      transfer: 'the transfer',
    },
    statementsOf: (account, from) => `the request for the transactions of ${account} from ${from}`,
    pendingOf: (account) => `the request for the pending transactions of ${account}`,
    balanceOf: (account) => `the balance enquiry for ${account}`,
    openApp: (method, subject) => `Open “${method}” and confirm ${subject}.`,
    confirmInApp: (subject) => `Confirm ${subject} in your banking app.`,
    secondApproval: 'The login is approved – your bank asks a second time for the transactions.',
    endedTitle: 'Approval did not arrive in time',
    endedText: 'Your bank ended the request. Send it again and confirm it in the app.',
    notConfirmed: 'Your bank did not confirm the approval.',
  },

  busy: 'Please wait – another operation is still in progress.',

  login: {
    cancelled: 'The login was cancelled.',
    deviceRecognised: 'Device recognised – logged in without a new approval.',
    noTanMethod: 'Your bank offers no security method for this login.',
  },

  device: {
    saved: 'Device remembered – future logins will need an approval less often.',
    forget: 'Forget device…',
    forgotten: 'Device forgotten – at your next login, your bank will ask for an approval again.',
    forgottenAndWiped:
      'Device forgotten and your saved data deleted from this computer. Nothing more will be saved until you log out.',
  },

  reads: {
    cutShort: (until) =>
      `Your bank only sent transactions up to ${until}. The balance remains the last one retrieved.`,
    noBalance: 'Your bank reported no balance for this account.',
    balanceMismatch: 'Your bank’s answer did not match the balance enquiry.',
    balanceWithStatements:
      'These accounts only report their balance with their transactions. Under Transactions, choose a period up to today.',
    olderNotFetched: (span) => `Older transactions were not retrieved – the period stays ${span}.`,
    periodNotFetched: (span) => `The new period was not retrieved – the period stays ${span}.`,
    invalidPeriod: 'Please choose a valid period.',
    pendingFailed: (account, reason) => `Could not retrieve the pending transactions for “${account}”: ${reason}`,
  },

  launch: {
    noTransferAccount: 'No account supports transfers over FinTS.',
    noIbanAccount: 'No IBAN is available for any of your accounts.',
  },

  printAsPdf: 'In the print dialog, choose “Save as PDF”.',
};
