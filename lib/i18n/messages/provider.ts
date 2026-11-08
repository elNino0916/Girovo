// What the app says while it works with the bank (components/FintsProvider.tsx), and what the server answers: API routes, bank errors, bank answers, the session log, the vault (app/api, lib/api.ts, lib/bank-fetch.ts, lib/bank-answer.ts, lib/session-log.ts, lib/vault.ts).

export const de = {
  /** Once, after 5.9.0 split the category: to someone with own choices on Freizeit. */
  diningSplit: 'Neu: „Essen & Trinken“ ist jetzt eine eigene Kategorie. Was du selbst unter Freizeit einsortiert hast, bleibt dort.',
  /** The local server's own answers (lib/api.ts, lib/client-api.ts). */
  server: {
    /** The server no longer knows the session (HTTP 401). */
    sessionExpired: 'Sitzung abgelaufen. Bitte neu anmelden.',
    /** The request never reached the local server (crashed, restarting). */
    unreachable: 'Das hat gerade nicht geklappt. Versuche es noch einmal oder starte Girovo neu.',
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
    insecure: 'Keine sichere Verbindung zu deiner Bank. Prüfe Datum und Uhrzeit dieses Rechners.',
    cancelled: 'Der Vorgang wurde abgebrochen.',
    unexpected: 'Ein unerwarteter Fehler ist aufgetreten. Versuche es noch einmal.',
    /** lib-fints' English errors, as they concern the user. */
    tanEntryNeeded: 'Deine Bank wartet auf eine TAN. Starte den Vorgang bitte noch einmal.',
    notOffered: 'Deine Bank bietet das für dieses Konto nicht über Girovo an.',
    noIban: 'Für dieses Konto meldet deine Bank keine IBAN.',
    /** The order went out and its answer never came back (lib/fints-order.ts): "Status unklar", never "failed". */
    orderUnanswered:
      'Die Verbindung brach nach dem Senden ab. Ob der Auftrag ausgeführt wurde, ist unklar.',
  },

  /** The encrypted personal-data vault (lib/vault.ts, app/api/vault). */
  vault: {
    unavailable: 'In dieser Sitzung kann Girovo nichts speichern.',
    locked: 'Deine gespeicherten Daten lassen sich mit dieser PIN nicht öffnen. Setze sie zurück, um neu zu beginnen.',
    format: 'Die Daten lassen sich nicht lesen.',
    tooLarge: 'Zu viele gespeicherte Einträge. Lösche ein paar Vorlagen oder Kategorie-Zuordnungen und versuche es erneut.',
    /** A request too large to be read at all. */
    tooMany: 'Zu viele gespeicherte Einträge.',
    read: 'Deine gespeicherten Daten konnten nicht gelesen werden.',
    write: 'Deine Daten konnten nicht gespeichert werden.',
    wipe: 'Deine gespeicherten Daten konnten nicht vollständig gelöscht werden. Bitte versuche es erneut.',
    noData: 'Keine Daten angegeben.',
    unknownAction: 'Unbekannte Aktion.',
    /** The client's notices about it (components/FintsProvider.tsx). */
    saveFailed: 'Deine Einstellungen konnten nicht gespeichert werden.',
    reset: 'Persönliche Daten zurückgesetzt. Änderungen werden wieder gespeichert.',
    /** Resetting waits for the bank's word on the PIN: a mistyped one must not replace the saved data. */
    notYet: 'Zurücksetzen geht erst, wenn deine Bank deine PIN angenommen hat. Lade einmal deine Umsätze und versuche es dann noch einmal.',
    wiped: 'Deine gespeicherten Daten sind von diesem Rechner gelöscht. Bis zum Abmelden wird nichts mehr gespeichert.',
    templateInvalid: 'Vorlage nicht gespeichert: Name oder IBAN ist ungültig.',
  },

  /** "Weitere Banken mit anmelden" on the desktop (lib/linked-unlock.ts, app/api/linked-unlock). */
  linkedUnlock: {
    unavailable: 'Weitere Banken mit anmelden gibt es nur in der Desktop-App.',
    noSecret: 'Die PINs lassen sich hier nicht sicher speichern.',
    /** The kept PINs do not open with this PIN, and the bank has not taken it yet: nothing is overwritten. */
    notYet: 'Die gespeicherten PINs lassen sich mit dieser PIN nicht öffnen. Lade einmal deine Umsätze und versuche es dann noch einmal.',
    unknownAction: 'Unbekannte Aktion.',
  },
  /** app/api/windows-hello (lib/windows-hello.ts). */
  windowsHello: {
    unavailable: 'Windows Hello gibt es nur in der Desktop-App.',
    notYet: 'Die PIN lässt sich erst speichern, wenn deine Bank sie angenommen hat. Lade einmal deine Umsätze und versuche es dann noch einmal.',
    noKey: 'Windows Hello hat nicht geklappt. Versuche es noch einmal.',
    unknownAction: 'Unbekannte Aktion.',
  },

  /** app/api/security-key (lib/security-key.ts). */
  securityKey: {
    unavailable: 'Sicherheitsschlüssel gibt es nur in der Desktop-App.',
    notYet: 'Die PIN lässt sich erst speichern, wenn deine Bank sie angenommen hat. Lade einmal deine Umsätze und versuche es dann noch einmal.',
    noKey: 'Der Schlüssel hat nicht geklappt. Versuche es noch einmal.',
    tooMany: 'Mehr Schlüssel gehen nicht. Entferne zuerst einen.',
    unknownAction: 'Unbekannte Aktion.',
  },

  /** What a logout says (lib/session-log.ts, components/FintsProvider.tsx). */
  logout: {
    /** "an Lea Becker", "an A, B und C": each payee once, `others` before the last one. */
    payees: (others: readonly string[], last: string) => (others.length ? `an ${others.join(', ')} und ${last}` : `an ${last}`),
    byUser: 'Du hast dich abgemeldet.',
    /** The login's own approval was called off. */
    loginCancelled: 'Anmeldung abgebrochen.',
    /** Added once the server confirmed it dropped the session, and the PIN with it. */
    pinDropped: 'Deine PIN ist gelöscht.',
    idle: 'Du wurdest aus Sicherheitsgründen abgemeldet.',
    /** The desktop: the window closed into the notification area, and the session ended with it. */
    hidden: 'Du wurdest beim Schließen des Fensters abgemeldet.',
    /** The system notice for that logout, when it left a transfer unclear (`unclearOne`/`unclearMany` as its text). */
    hiddenTitle: 'Du wurdest abgemeldet',
    /** After a logout's notice: one transfer whose outcome is not known. `to` is a payees() phrase, or ''. */
    unclearOne: (to: string) =>
      `Der Status deiner Überweisung${to ? ` ${to}` : ''} ist unklar – prüfe deine Umsätze, bevor du sie noch einmal sendest.`,
    /** After a logout's notice: `count` (two or more) such transfers. */
    unclearMany: (count: number, to: string) =>
      `Der Status von ${count} Überweisungen${to ? ` ${to}` : ''} ist unklar – prüfe deine Umsätze, bevor du eine davon noch einmal sendest.`,
    expired: 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.',
  },

  /** An approval in the banking app being waited for (FintsProvider; TanWaitOverlay shows it). */
  wait: {
    /** What each kind of approval asks the user to confirm, as the object of "bestätige …". */
    subject: {
      login: 'die Anmeldung',
      statements: 'die Umsatzabfrage',
      pending: 'die Abfrage der vorgemerkten Umsätze',
      balance: 'die Saldoabfrage',
      transfer: 'die Überweisung',
      portfolio: 'die Depotabfrage',
      bankStatements: 'die Abfrage der Kontoauszüge',
    },
    /** The same, naming the account (the user's own name for it first) and the first day asked for. */
    statementsOf: (account: string, from: string) => `die Umsatzabfrage für ${account} ab ${from}`,
    pendingOf: (account: string) => `die Abfrage der vorgemerkten Umsätze von ${account}`,
    balanceOf: (account: string) => `die Saldoabfrage für ${account}`,
    portfolioOf: (account: string) => `die Depotabfrage für ${account}`,
    bankStatementsOf: (account: string) => `die Abfrage der Kontoauszüge von ${account}`,
    /** With an app-approval method: the method as the bank names it ("pushTAN 2.0"). */
    openApp: (method: string, subject: string) => `Öffne „${method}“ und bestätige ${subject}.`,
    confirmInApp: (subject: string) => `Bestätige ${subject} in deiner Banking-App.`,
    /** With a method whose TAN is typed (chipTAN, photoTAN, smsTAN). */
    typeTan: (subject: string) => `Gib die TAN für ${subject} ein.`,
    /** The route refused what was typed: it cannot be a TAN. */
    badTan: 'Das ist keine gültige TAN.',
    /** A statement asking for its own approval right after the login's. */
    secondApproval: 'Die Anmeldung ist freigegeben – für die Umsätze fragt deine Bank ein zweites Mal.',
    /** The bank closed the dialog before the approval arrived — the bank's timeout, not the user's. */
    endedTitle: 'Freigabe nicht rechtzeitig angekommen',
    endedText: 'Deine Bank hat den Vorgang beendet.',
    /** The bank refused, or left it unclear, without a word of its own. */
    notConfirmed: 'Deine Bank hat die Freigabe nicht bestätigt.',
    /** An order's approval whose answer never came back: nothing about it may sound like "send it again". */
    unverifiable: 'Girovo kann gerade nicht feststellen, ob die Freigabe angekommen ist.',
  },

  /** A wait, not a failure: said as a notice, never in the error's red. */
  busy: 'Bitte warten – ein anderer Vorgang läuft noch.',

  login: {
    /** A login the user called off while the bank was being asked. */
    cancelled: 'Die Anmeldung wurde abgebrochen.',
    deviceRecognised: 'Gerät erkannt – ohne neue Freigabe angemeldet.',
    /** A remembered device logs in afresh: its bank now knows Girovo's own product ID (lib/product-fallback.ts). */
    productChanged: 'Diese Anmeldung braucht einmal eine Freigabe. Danach erkennt deine Bank dein Gerät wieder.',
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
      `Deine Bank hat nur Umsätze bis ${until} geschickt. Der Kontostand bleibt der letzte bekannte.`,
    /** An answer without a balance is not a zero balance. */
    noBalance: 'Deine Bank hat für dieses Konto keinen Saldo gemeldet.',
    balanceMismatch: 'Deine Bank hat statt des Saldos etwas anderes geschickt. Versuche es noch einmal.',
    /** "Alle Salden abrufen" with only accounts left whose statement is the way to their balance. */
    balanceWithStatements:
      'Diese Konten melden ihren Saldo nur mit den Umsätzen. Wähle dort einen Zeitraum bis heute.',
    /** An approval for a new period that was not given; `span` is the period still shown. */
    olderNotFetched: (span: string) => `Ältere Umsätze wurden nicht geladen – es bleibt bei ${span}.`,
    periodNotFetched: (span: string) => `Der neue Zeitraum wurde nicht geladen – es bleibt bei ${span}.`,
    invalidPeriod: 'Bitte einen gültigen Zeitraum wählen.',
    /** `reason`: the bank's or the server's words. */
    pendingFailed: (account: string, reason: string) =>
      `Vorgemerkte Umsätze für „${account}“ nicht geladen: ${reason}`,
  },

  /** The transfer and request-money sheets, refused before they open. */
  launch: {
    noTransferAccount: 'Keines deiner Konten erlaubt Überweisungen über Girovo.',
    noIbanAccount: 'Für keines deiner Konten liegt eine IBAN vor.',
  },

  /** In a plain browser, printing is the way to a PDF. */
  printAsPdf: 'Im Druckdialog „Als PDF speichern“ wählen.',
};

export const en: typeof de = {
  diningSplit: 'New: “Eating out” is now a category of its own. Whatever you filed under Leisure yourself stays there.',
  server: {
    sessionExpired: 'Session expired. Please log in again.',
    unreachable: 'That didn’t work just now. Try again or restart Girovo.',
    failed: (status) => `Error (${status})`,
  },

  bank: {
    unavailable: 'Your bank isn’t answering right now – this is often maintenance.',
    unreachable: 'Your bank can’t be reached right now. Check your internet connection.',
    tryAgainLater: 'Try again in a few minutes.',
    noReason: 'Your bank didn’t give a reason.',
    insecure: 'No secure connection to your bank. Check the date and time on this computer.',
    cancelled: 'This was cancelled.',
    unexpected: 'An unexpected error occurred. Try again.',
    tanEntryNeeded: 'Your bank is waiting for a TAN. Please start again.',
    notOffered: 'Your bank doesn’t offer this for this account through Girovo.',
    noIban: 'Your bank reports no IBAN for this account.',
    orderUnanswered:
      'The connection broke off after sending. It is unclear whether the order was completed.',
  },

  vault: {
    unavailable: 'Girovo can’t save anything in this session.',
    locked: 'Your saved data can’t be opened with this PIN. Reset it to start again.',
    format: 'The data can’t be read.',
    tooLarge: 'Too many saved entries. Delete a few templates or category assignments and try again.',
    tooMany: 'Too many saved entries.',
    read: 'Your saved data could not be read.',
    write: 'Your data could not be saved.',
    wipe: 'Your saved data could not be deleted completely. Please try again.',
    noData: 'No data given.',
    unknownAction: 'Unknown action.',
    saveFailed: 'Your settings could not be saved.',
    reset: 'Personal data reset. Changes will be saved again.',
    notYet: 'You can reset only once your bank has accepted your PIN. Load your transactions once, then try again.',
    wiped: 'Your saved data has been deleted from this computer. Nothing more will be saved until you log out.',
    templateInvalid: 'Template not saved: the name or IBAN is invalid.',
  },

  linkedUnlock: {
    unavailable: 'Logging in to further banks too is only available in the desktop app.',
    noSecret: 'The PINs can’t be saved safely here.',
    notYet: 'The saved PINs don’t open with this PIN. Load your transactions once, then try again.',
    unknownAction: 'Unknown action.',
  },
  windowsHello: {
    unavailable: 'Windows Hello is only available in the desktop app.',
    notYet: 'The PIN can only be saved once your bank has accepted it. Load your transactions once, then try again.',
    noKey: 'Windows Hello didn’t work. Try again.',
    unknownAction: 'Unknown action.',
  },
  securityKey: {
    unavailable: 'Security keys are only available in the desktop app.',
    notYet: 'The PIN can only be saved once your bank has accepted it. Load your transactions once, then try again.',
    noKey: 'The key didn’t work. Try again.',
    tooMany: 'No more keys fit. Remove one first.',
    unknownAction: 'Unknown action.',
  },

  logout: {
    payees: (others, last) => (others.length ? `to ${others.join(', ')} and ${last}` : `to ${last}`),
    byUser: 'You have logged out.',
    loginCancelled: 'Login cancelled.',
    pinDropped: 'Your PIN has been deleted.',
    idle: 'You were logged out for security reasons.',
    hidden: 'You were logged out when you closed the window.',
    hiddenTitle: 'You were logged out',
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
      portfolio: 'the holdings enquiry',
      bankStatements: 'the request for your statements',
    },
    statementsOf: (account, from) => `the request for the transactions of ${account} from ${from}`,
    pendingOf: (account) => `the request for the pending transactions of ${account}`,
    balanceOf: (account) => `the balance enquiry for ${account}`,
    portfolioOf: (account) => `the holdings enquiry for ${account}`,
    bankStatementsOf: (account) => `the request for the statements of ${account}`,
    openApp: (method, subject) => `Open “${method}” and confirm ${subject}.`,
    confirmInApp: (subject) => `Confirm ${subject} in your banking app.`,
    typeTan: (subject) => `Enter the TAN for ${subject}.`,
    badTan: 'That is not a valid TAN.',
    secondApproval: 'The login is approved – your bank asks a second time for the transactions.',
    endedTitle: 'Approval did not arrive in time',
    endedText: 'Your bank ended the request.',
    notConfirmed: 'Your bank did not confirm the approval.',
    unverifiable: 'Girovo can’t tell right now whether the approval arrived.',
  },

  busy: 'Please wait – another operation is still in progress.',

  login: {
    cancelled: 'The login was cancelled.',
    deviceRecognised: 'Device recognised – logged in without a new approval.',
    productChanged: 'This login needs one approval. After that, your bank recognises your device again.',
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
      `Your bank only sent transactions up to ${until}. The balance stays the last known one.`,
    noBalance: 'Your bank reported no balance for this account.',
    balanceMismatch: 'Your bank sent something other than the balance. Try again.',
    balanceWithStatements:
      'These accounts only report their balance with their transactions. Choose a period up to today under Transactions.',
    olderNotFetched: (span) => `Older transactions were not loaded – it stays at ${span}.`,
    periodNotFetched: (span) => `The new period was not loaded – it stays at ${span}.`,
    invalidPeriod: 'Please choose a valid period.',
    pendingFailed: (account, reason) => `Pending transactions for “${account}” not loaded: ${reason}`,
  },

  launch: {
    noTransferAccount: 'None of your accounts allows transfers through Girovo.',
    noIbanAccount: 'No IBAN is available for any of your accounts.',
  },

  printAsPdf: 'In the print dialog, choose “Save as PDF”.',
};
