// The login: bank search, credentials, help, the login frame (components/auth), and the approval wait and TAN method choice (TanWaitOverlay, TanMethodPicker, SessionGuard), with the consent prompts for logos and usage data.

import type { ReactNode } from 'react';

export const de = {
  /** While a login, or the setup of a TAN method, waits for the bank. */
  connecting: 'Verbinde mit der Bank …',
  /** The no on both consent tiles (company logos, usage data). */
  noThanks: 'Nein danke',

  /** The progress on the login's stage (AuthShell); the third step is common.approval. */
  steps: {
    label: 'Schritte der Anmeldung',
    bank: 'Bank',
    credentials: 'Anmeldung',
    /** After a finished step's name, for screen readers. */
    done: '(erledigt)',
  },

  /** What happens to the data: the wide login's side tile, and the note under the form. */
  privacy: {
    title: 'Deine Daten bleiben bei dir',
    pin: {
      title: 'Deine PIN wird nie gespeichert',
      text: 'Sie bleibt nur im Arbeitsspeicher und ist mit der Abmeldung weg.',
    },
    direct: {
      title: 'Direkte Verbindung',
      text: 'Von diesem Rechner direkt zu deiner Bank, über ihren FinTS-Zugang.',
    },
    device: {
      title: 'Dieses Gerät wird gemerkt',
      text: 'Nach der Anmeldung, mit deiner PIN verschlüsselt – deine Bank fragt dann seltener nach einer Freigabe. Rückgängig mit „Gerät vergessen“ im Sitzungsmenü.',
    },
    /** Nothing leaves the machine but the bank traffic. The lines about outside lookups follow the text. */
    nothingOut: {
      title: 'Keine Daten an Dritte',
      text: 'Keine Werbung, kein Tracking, keine Weitergabe.',
    },
    /** Usage data is shared, with the user's yes. */
    usageOn: {
      title: 'Keine Werbung',
      text: 'Keine Werbung, keine Weitergabe.',
    },
    /** Usage data is not shared, or not asked about yet. */
    usageOff: {
      title: 'Kein Tracking',
      text: 'Keine Werbung, keine Nutzungsstatistik ohne deine Zustimmung.',
    },
    /** The desktop app's update check is on. */
    updates: 'Nach Updates fragt die App bei GitHub – dort kommen nur ihre Versionsnummer und deine IP-Adresse an.',
    logosOn: 'Für Firmenlogos gehen Firmennamen an den Logo-Dienst Brandfetch – abschaltbar im Sitzungsmenü.',
    logosOff: 'Die Firmenlogos von Brandfetch hast du ausgeschaltet.',
    logosUnasked: 'Firmenlogos nur mit deiner Zustimmung: Dafür gehen Firmennamen an den Logo-Dienst Brandfetch.',
    telemetryOn: 'Fehlerberichte und, mit deiner Zustimmung, Nutzungsdaten gehen an den Entwickler von Girovo – nie Kontodaten, Beträge oder Namen.',
    errorReports: 'Fehlerberichte gehen an den Entwickler von Girovo – ohne Kontodaten, Beträge und Namen.',
    usageNeedsYes: 'Nutzungsdaten nur mit deiner Zustimmung.',
    /** The narrow layout's note under the form; the logo and error-report lines follow it. */
    note: 'Deine PIN wird nie gespeichert, die Verbindung läuft direkt zu deiner Bank. Nach der Anmeldung merkt sich die App dieses Gerät, mit deiner PIN verschlüsselt.',
  },

  /** Step one: find the bank (components/auth/BankPicker.tsx). */
  bankPicker: {
    title: 'Bank wählen',
    intro: 'Bei welcher Bank führst du dein Konto?',
    /** The bank chosen last time has left the bank list. */
    staleTitle: 'Deine Bank vom letzten Mal steht nicht mehr in der Liste',
    staleText: (name: string, blz: ReactNode): ReactNode[] => [
      `${name} (BLZ `,
      blz,
      ') – vielleicht hat sie fusioniert. Such deine Bank bitte neu, am genauesten mit deiner IBAN.',
    ],
    label: 'Bank suchen',
    placeholder: 'Name, Ort, BLZ oder IBAN',
    clear: 'Suche leeren',
    results: 'Gefundene Banken',
    /** Under the field: how many Bankleitzahlen the list holds, the figure already formatted. */
    count: (n: ReactNode): ReactNode[] => [n, ' Bankleitzahlen mit FinTS-Zugang'],
    /** The one-click picks under the search. */
    quickPicks: 'Schnellauswahl',
    /** A pick that starts a search: a group of banks with no single BLZ. */
    searchFor: (bank: string) => `${bank} suchen`,
    searching: 'Suche …',
    unavailable: 'Die Suche ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.',
    // An IBAN on its way.
    ibanForeign: 'Hier gibt es nur deutsche Banken – eine deutsche IBAN beginnt mit DE.',
    ibanInvalid: 'Diese IBAN stimmt nicht. Prüfe sie bitte noch einmal.',
    ibanIncomplete: 'Tippe weiter – die BLZ steckt in Stelle 5 bis 12 deiner IBAN.',
    // Nothing found, said for what was searched.
    noneForIban: 'Zu dieser IBAN gibt es keine Bank mit FinTS-Zugang. Nicht jede Bank bietet FinTS an.',
    noneForBlz: 'Keine Bank mit dieser BLZ. Eine BLZ hat 8 Ziffern – du findest sie in deiner IBAN an Stelle 5 bis 12.',
    /** A bank people look for that offers no FinTS access (N26, Revolut, …). */
    withoutFints: (bank: string) => `${bank} bietet kein FinTS an. Mit Girovo lässt sich das Konto dort deshalb nicht nutzen.`,
    noneForName: 'Keine Bank mit diesem Namen oder Ort. Nicht jede Bank bietet FinTS an.',
    // Above a list that is long, or whose rows share one name.
    ibanBank: 'Die Bank zu deiner IBAN:',
    firstHits: (n: number) => `Die ersten ${n} Treffer – ergänze den Ort oder gib deine IBAN ein.`,
    sameNames: 'Gib deine IBAN ein, dann findest du genau deine Bank.',
    // The status line a screen reader hears; the BLZ comes in formatted.
    statusIbanBank: (name: string, blz: string) => `Die Bank zu deiner IBAN: ${name}, BLZ ${blz}`,
    statusOne: (name: string, blz: string) => `1 Bank gefunden: ${name}, BLZ ${blz}`,
    /** `atLeast` when the search stopped at its limit. */
    statusMany: (n: number, atLeast: boolean) => `${atLeast ? `Mindestens ${n}` : n} Banken gefunden.`,
  },

  /** Step two: the online-banking credentials (components/auth/Credentials.tsx). */
  credentials: {
    /** The heading and the submit button. */
    title: 'Anmelden',
    intro: 'Mit den Zugangsdaten deines Online-Bankings.',
    noProductId: (file: ReactNode): ReactNode[] => [
      'Es ist keine registrierte FinTS-Produkt-ID hinterlegt. Banken lehnen die Anmeldung damit meist ab (Code 9078). Trage die ID in ',
      file,
      ' ein.',
    ],
    /** Picks another bank; the screen reader also hears changeBank. */
    change: 'Ändern',
    changeBank: (bank: string) => `andere Bank statt ${bank} wählen`,
    /** What the bank calls the login name, where it is known for certain. */
    loginLabels: {
      vrNetKey: 'VR-NetKey oder Alias',
      /** Sparkasse's, and everyone else's. */
      loginName: 'Anmeldename oder Legitimations-ID',
      accessNumber: 'Zugangsnummer',
      participantNumber: 'Teilnehmernummer',
      postbankId: 'Postbank ID',
    },
    /** Under the generic login label. */
    loginHint: 'So wie beim Online-Banking deiner Bank.',
    loginMissing: 'Bitte gib deinen Anmeldenamen ein.',
    /** What the bank calls the secret. "PIN" alone invites the bank card's four digits. */
    secrets: {
      pin: {
        label: 'Online-Banking-PIN',
        /** For the reveal button (reveal). */
        short: 'PIN',
        /** The secret with its article, as rememberedText needs it. */
        withIt: 'Mit deiner PIN',
        hint: 'Nicht die PIN deiner Bankkarte.',
        missing: 'Bitte gib deine PIN ein.',
      },
      postbank: {
        label: 'Passwort',
        short: 'Passwort',
        withIt: 'Mit deinem Passwort',
        hint: 'Das Passwort zu deiner Postbank ID.',
        missing: 'Bitte gib dein Passwort ein.',
      },
    },
    reveal: (secret: string) => `${secret} anzeigen`,
    capsLock: 'Feststelltaste ist aktiv',
    /** The one hard requirement, said before the PIN goes anywhere; the bank's app named where it is known. */
    approvalHint: (app?: string) =>
      `Freigabe danach in deiner Banking-App${app ? `, z. B. ${app}` : ''}. chipTAN, smsTAN und TAN-Generator gehen hier nicht.`,
    rememberedTitle: 'Dieses Gerät ist gemerkt',
    rememberedText: (withIt: string) => `${withIt} klappt die Anmeldung hier meist ohne neue Freigabe.`,
    locked: 'Entsperren kann nur deine Bank.',
    lockoutRisk: 'Mehrere Fehlversuche können deinen Online-Zugang sperren.',
    /** A failure that came without words of its own. */
    failed: 'Die Anmeldung ist fehlgeschlagen.',
    slow: 'Deine Bank antwortet noch nicht.',
    slowCanCancel: 'Deine Bank antwortet noch nicht. Du kannst die Anmeldung abbrechen.',
    cancelled: 'Anmeldung abgebrochen.',
  },

  /** "Was brauche ich?" under the bank search and the credentials (components/auth/LoginHelp.tsx). */
  help: {
    toggle: 'Was brauche ich?',
    credentials: {
      title: 'Die Zugangsdaten deines Online-Bankings',
      text: 'Anmeldename und PIN, so wie auf der Website deiner Bank. Nicht die PIN deiner Bankkarte.',
    },
    /** The same point on the credentials step, where the form already says which PIN. */
    credentialsShort: 'Anmeldename und PIN, so wie auf der Website deiner Bank.',
    fints: {
      title: 'FinTS-Zugang',
      text: 'Darüber spricht die App mit deiner Bank. Ist er für deinen Zugang nicht freigeschaltet, hilft dir deine Bank.',
    },
    approval: {
      title: 'Freigabe per App',
      text: 'Anmeldung und Aufträge gibst du in der Banking-App deiner Bank frei, z. B. mit S-pushTAN, SecureGo plus oder BestSign. chipTAN, smsTAN und TAN-Generator gehen hier nicht.',
    },
    findBank: {
      title: 'Deine Bank finden',
      text: 'Am genauesten mit deiner IBAN: Die Stellen 5 bis 12 sind die Bankleitzahl (BLZ).',
    },
    forgotPin: {
      title: 'PIN vergessen?',
      text: 'Eine neue PIN bekommst du nur von deiner Bank – Girovo speichert deine PIN nie.',
    },
  },

  /** The approval wait (components/TanWaitOverlay.tsx). */
  tanWait: {
    /** What each approval is called while it is waited for, unless the app names it itself. */
    title: {
      login: 'Anmeldung freigeben',
      statements: 'Umsatzabruf freigeben',
      pending: 'Vorgemerkte Umsätze freigeben',
      balance: 'Saldoabfrage freigeben',
      transfer: 'Überweisung freigeben',
    },
    /** What the screen behind does once the approval is in. */
    afterConfirm: {
      login: 'Deine Konten werden geladen …',
      statements: 'Umsätze werden geladen …',
      pending: 'Vorgemerkte Umsätze werden geladen …',
      balance: 'Der Saldo wird abgerufen …',
      transfer: 'Die Überweisung ist freigegeben.',
    },
    /**
     * The bank refused: "Ablehnen" in the app, or the bank said no. The
     * bank's own words follow the text. (A transfer's sheet has its own step
     * for a refusal; its entry keeps the map complete.)
     */
    refused: {
      login: { title: 'Anmeldung nicht freigegeben', text: 'Deine Bank hat die Anmeldung abgelehnt:' },
      statements: { title: 'Umsatzabruf nicht freigegeben', text: 'Deine Bank hat den Abruf abgelehnt:' },
      pending: { title: 'Abruf nicht freigegeben', text: 'Deine Bank hat den Abruf abgelehnt:' },
      balance: { title: 'Saldoabfrage nicht freigegeben', text: 'Deine Bank hat die Abfrage abgelehnt:' },
      transfer: { title: 'Überweisung nicht ausgeführt', text: 'Deine Bank hat den Auftrag abgelehnt:' },
    },
    confirmed: 'Freigabe bestätigt',
    /** The status of the approval could not be read. */
    checkFailed: 'Freigabe konnte nicht geprüft werden',
    checkFailedText: 'Ob die Freigabe angekommen ist, ließ sich nicht feststellen.',
    newRequest: 'Neue Anfrage senden',
    overdue: 'Die Frist deiner Bank ist abgelaufen.',
    /** Where to look; the device's name comes in as its own element. */
    device: (name: ReactNode): ReactNode[] => ['Gerät: ', name],
    /** Above the bank's challenge text, when an order is shown too. */
    challenge: 'Anfrage deiner Bank',
    helpToggle: 'Keine Anfrage bekommen?',
    openMethod: (method: string) => `Öffne „${method}“ selbst, auch wenn keine Mitteilung erschienen ist.`,
    openApp: 'Öffne deine Banking-App selbst, auch wenn keine Mitteilung erschienen ist.',
    checkDevice: (device: string) => `Sieh auf dem Gerät nach, das deine Bank angefragt hat: „${device}“.`,
    checkDevices: 'Hast du mehrere Geräte für die Freigabe eingerichtet, sieh auf allen nach.',
    checkNotifications: 'Prüfe, ob die App auf deinem Telefon Mitteilungen senden darf.',
    /** Under a refusal: the bank's return codes, for whoever calls the bank. */
    reference: (codes: ReactNode): ReactNode[] => ['Rückmeldung der Bank: ', codes],
    /** Leaving a transfer's approval while it can still arrive. */
    abort: {
      title: 'Freigabe abbrechen?',
      text: 'Die Überweisung wurde vielleicht schon ausgeführt. Brichst du jetzt ab, bleibt ihr Status unklar – prüfe deine Umsätze, bevor du sie noch einmal sendest.',
      confirm: 'Trotzdem abbrechen',
      keepWaiting: 'Weiter warten',
    },
    /** Under the amount of the transfer being approved. */
    to: (name: string) => `an ${name}`,
    compareIn: (method: string) => `Vergleiche das mit der Anzeige in „${method}“.`,
    compareApp: 'Vergleiche das mit der Anzeige in deiner Banking-App.',
    // The status line above the buttons.
    confirmedShort: 'Bestätigt',
    noConfirmationYet: 'Noch keine Bestätigung',
    waitingForConfirmation: 'Warte auf Bestätigung',
    /** Before the counter, for screen readers: "Seit 1:05". */
    elapsed: 'Seit',
    limitPassed: (limit: string) => `Die Frist deiner Bank von ${limit} ist abgelaufen.`,
    inTime: 'Rechtzeitig angekommen.',
    limit: (limit: string) => `Deine Bank wartet bis zu ${limit} auf die Freigabe.`,
    /** The bank's time limit: whole seconds, or whole minutes rounded down. */
    seconds: (n: number) => (n === 1 ? '1 Sekunde' : `${n} Sekunden`),
    minutes: (n: number) => (n === 1 ? '1 Minute' : `${n} Minuten`),
  },

  /** Step three: the TAN method (components/TanMethodPicker.tsx). */
  tanMethod: {
    title: 'Sicherheitsverfahren',
    /** Said before the fact, on the card and in the wide layout's side tile. */
    deviceMemory: 'Nach der ersten Freigabe merkt sich die App dieses Gerät – rückgängig mit „Gerät vergessen“ im Sitzungsmenü.',
    chooseDevice: 'Gerät wählen',
    chooseDeviceText: 'Auf welchem Gerät möchtest du freigeben?',
    method: (name: string) => `Verfahren: ${name}`,
    otherMethod: 'Anderes Verfahren',
    onlyOne: 'Deine Bank bietet für diesen Zugang nur ein Verfahren an.',
    /** The method's name comes in as its own element. */
    connectingVia: (method: ReactNode): ReactNode[] => ['Verbinde über ', method, ' …'],
    choose: 'Wähle, wie du Anmeldung und Aufträge freigibst. Die Freigabe erfolgt direkt in deiner Banking-App.',
    /** The methods that need a typed TAN, as one list ("chipTAN und smsTAN"), and how many they are. */
    typedNote: (names: string, n: number) =>
      `${names} ${n === 1 ? 'braucht' : 'brauchen'} eine TAN-Eingabe und ${n === 1 ? 'geht' : 'gehen'} hier nicht.`,
    none: 'Für diesen Zugang gibt es kein Verfahren, das hier funktioniert.',
    onlyTypedTitle: 'Nur Verfahren mit TAN-Eingabe',
    onlyTyped: (names: string) =>
      `Für deinen Zugang meldet deine Bank: ${names}. Hier geht aber nur die Freigabe in einer Banking-App.`,
    askBank: (app?: string) =>
      `Frag deine Bank nach der Freigabe per App${app ? ` (z. B. ${app})` : ''} oder stell sie in deinem Online-Banking um. Danach kannst du dich hier anmelden.`,
    back: 'Zurück zur Anmeldung',
    /** The wide layout's side tile: what is about to happen. */
    aside: {
      title: 'So läuft die Freigabe',
      chooseTitle: 'Verfahren wählen',
      chooseText: 'Das, mit dem du auch im Online-Banking deiner Bank freigibst.',
      openTitle: 'Banking-App öffnen',
      openText: 'Deine Bank schickt die Anfrage an das Gerät, das du dort hinterlegt hast.',
      confirmTitle: 'Anfrage bestätigen',
      confirmText: 'Danach geht es hier von selbst weiter.',
    },
  },

  /** The last minute before the automatic logout (components/SessionGuard.tsx). */
  sessionGuard: {
    /** The window's title while the warning is up: the countdown ("0:45"), then the page's own title. */
    windowTitle: (countdown: string, title: string) => `Abmeldung in ${countdown} – ${title}`,
    /** For screen readers at 60, 30 and 10 seconds; the time comes in words ("42 Sekunden"). */
    announce: (left: string) => `Noch ${left} bis zur automatischen Abmeldung.`,
    title: 'Möchtest du angemeldet bleiben?',
    text: 'Du warst eine Weile nicht aktiv. Aus Sicherheitsgründen meldet dich die App gleich automatisch ab.',
    /** The countdown's accessible name; the time comes in words. */
    timeLeft: (left: string) => `Noch ${left}`,
    /** Under the countdown. */
    untilLogout: 'bis zur Abmeldung',
    /** Transfers of this session whose outcome is unclear; `to` is the payee phrase ("an Lea Becker"). */
    unclear: (n: number, to: string) => (n === 1
      ? `Der Status deiner Überweisung ${to} ist unklar. Nach der Abmeldung steht sie nicht mehr in den Mitteilungen.`
      : `Der Status von ${n} Überweisungen ${to} ist unklar. Nach der Abmeldung stehen sie nicht mehr in den Mitteilungen.`),
    stay: 'Angemeldet bleiben',
  },

  /** "Firmenlogos anzeigen?", the Übersicht tile (components/MerchantLogoConsent.tsx). */
  logos: {
    title: 'Firmenlogos anzeigen?',
    /** What goes out. "Aus deinen Umsätzen", not "an die du zahlst": a salary's employer is looked up too. */
    disclosure: 'Dafür gehen Firmennamen aus deinen Umsätzen an den Logo-Dienst Brandfetch – keine Beträge, IBANs oder Verwendungszwecke. Wie bei jedem Abruf sieht Brandfetch dabei deine IP-Adresse.',
    load: 'Logos laden',
    later: 'Du kannst das jederzeit im Sitzungsmenü oben rechts ändern.',
    /** The toasts after the answer. */
    on: 'Firmenlogos sind eingeschaltet.',
    off: 'Firmenlogos bleiben aus.',
  },

  /** "Nutzungsdaten teilen?", the desktop app's Übersicht tile (components/telemetry/UsageConsent.tsx). */
  usage: {
    title: 'Nutzungsdaten teilen?',
    /** What a yes shares. */
    disclosure: 'Dann erfährt der Entwickler von Girovo, welche Bereiche du nutzt, wie Anmeldungen ausgehen und wie lange deine Bank für Abrufe braucht – mit ihrer Bankleitzahl. Nie dabei: Anmeldename, PIN, IBANs, Salden, Umsätze, Beträge oder Empfänger. Wie bei jeder Verbindung sieht der Server deine IP-Adresse.',
    /** Error reports need no yes; the user is told so wherever they are asked. */
    errorReports: 'Fehlerberichte schickt Girovo immer – ohne Kontodaten, Beträge und Namen.',
    later: 'Ändern kannst du das jederzeit im Sitzungsmenü oben rechts.',
    share: 'Teilen',
    /** The toasts after the answer. */
    on: 'Nutzungsdaten werden geteilt.',
    off: 'Nutzungsdaten bleiben auf diesem Rechner.',
  },

  /** What the login's routes answer (app/api/connect, select-tan, device-status). */
  api: {
    /** The login was called off; the browser has stopped listening already. */
    cancelled: 'Die Anmeldung wurde abgebrochen.',
    invalidBlz: 'Bitte eine gültige 8-stellige Bankleitzahl angeben.',
    bankGone: 'Diese Bank steht nicht mehr in der Liste – vielleicht hat sie fusioniert. Wähle sie über „Ändern“ neu aus.',
    missingCredentials: 'Bitte Anmeldename und PIN angeben.',
    /** The bank refused without words of its own. Names the PIN: lib/bank-answer.ts reads that as a credential answer. */
    refused: 'Deine Bank hat die Anmeldung abgelehnt. Prüfe Anmeldename und PIN.',
    methodNotOffered: 'Dieses Verfahren bietet deine Bank für deinen Zugang nicht an.',
    methodNeedsTan: 'Dieses Verfahren braucht eine TAN-Eingabe. Hier geht nur die Freigabe in einer Banking-App.',
    loginFailed: 'Anmeldung fehlgeschlagen.',
    /** device-status asked with GET, the old query-string form. */
    usePost: 'Bitte per POST abfragen.',
  },
};

export const en: typeof de = {
  connecting: 'Connecting to the bank…',
  noThanks: 'No thanks',

  steps: {
    label: 'Login steps',
    bank: 'Bank',
    credentials: 'Login',
    done: '(done)',
  },

  privacy: {
    title: 'Your data stays with you',
    pin: {
      title: 'Your PIN is never stored',
      text: 'It stays in memory only and is gone when you log out.',
    },
    direct: {
      title: 'Direct connection',
      text: 'From this computer straight to your bank, through its FinTS access.',
    },
    device: {
      title: 'This device will be remembered',
      text: 'After you log in, encrypted with your PIN – your bank then asks for approval less often. You can undo this with “Forget device” in the session menu.',
    },
    nothingOut: {
      title: 'No data to third parties',
      text: 'No ads, no tracking, no sharing.',
    },
    usageOn: {
      title: 'No ads',
      text: 'No ads, no sharing.',
    },
    usageOff: {
      title: 'No tracking',
      text: 'No ads, no usage statistics without your consent.',
    },
    updates: 'The app checks GitHub for updates – only its version number and your IP address arrive there.',
    logosOn: 'For company logos, company names go to the logo service Brandfetch – you can switch this off in the session menu.',
    logosOff: 'You have switched off the company logos from Brandfetch.',
    logosUnasked: 'Company logos only with your consent: for them, company names go to the logo service Brandfetch.',
    telemetryOn: 'Error reports and, with your consent, usage data go to Girovo’s developer – never account data, amounts or names.',
    errorReports: 'Error reports go to Girovo’s developer – without account data, amounts or names.',
    usageNeedsYes: 'Usage data only with your consent.',
    note: 'Your PIN is never stored, and the connection runs straight to your bank. After you log in, the app remembers this device, encrypted with your PIN.',
  },

  bankPicker: {
    title: 'Choose your bank',
    intro: 'Which bank is your account with?',
    staleTitle: 'Your bank from last time is no longer on the list',
    staleText: (name, blz) => [
      `${name} (BLZ `,
      blz,
      ') – it may have merged. Please search for your bank again; your IBAN finds it most precisely.',
    ],
    label: 'Search for your bank',
    placeholder: 'Name, town, bank code or IBAN',
    clear: 'Clear search',
    results: 'Banks found',
    count: (n) => [n, ' bank codes with FinTS access'],
    quickPicks: 'Quick picks',
    searchFor: (bank) => `Search for ${bank}`,
    searching: 'Searching…',
    unavailable: 'The search cannot be reached right now. Please try again in a moment.',
    ibanForeign: 'Only German banks are available here – a German IBAN starts with DE.',
    ibanInvalid: 'This IBAN is not correct. Please check it again.',
    ibanIncomplete: 'Keep typing – the bank code (BLZ) is in positions 5 to 12 of your IBAN.',
    noneForIban: 'There is no bank with FinTS access for this IBAN. Not every bank offers FinTS.',
    noneForBlz: 'No bank with this bank code (BLZ). A bank code has 8 digits – you’ll find it in positions 5 to 12 of your IBAN.',
    withoutFints: (bank) => `${bank} does not offer FinTS, so your account there cannot be used with Girovo.`,
    noneForName: 'No bank with this name or town. Not every bank offers FinTS.',
    ibanBank: 'The bank for your IBAN:',
    firstHits: (n) => `The first ${n} matches – add the town or enter your IBAN.`,
    sameNames: 'Enter your IBAN to find exactly your bank.',
    statusIbanBank: (name, blz) => `The bank for your IBAN: ${name}, BLZ ${blz}`,
    statusOne: (name, blz) => `1 bank found: ${name}, BLZ ${blz}`,
    statusMany: (n, atLeast) => `${atLeast ? `At least ${n}` : n} banks found.`,
  },

  credentials: {
    title: 'Log in',
    intro: 'With your online banking login details.',
    noProductId: (file) => [
      'No registered FinTS product ID is set up. Banks then usually decline the login (code 9078). Enter the ID in ',
      file,
      '.',
    ],
    change: 'Change',
    changeBank: (bank) => `choose a different bank instead of ${bank}`,
    loginLabels: {
      vrNetKey: 'VR-NetKey or alias',
      loginName: 'Login name or legitimation ID',
      // The bank’s own word too: it is what its letters and its website say.
      accessNumber: 'Access number (Zugangsnummer)',
      participantNumber: 'Participant number (Teilnehmernummer)',
      postbankId: 'Postbank ID',
    },
    loginHint: 'Just as in your bank’s online banking.',
    loginMissing: 'Please enter your login name.',
    secrets: {
      pin: {
        label: 'Online banking PIN',
        short: 'PIN',
        withIt: 'With your PIN',
        hint: 'Not the PIN of your bank card.',
        missing: 'Please enter your PIN.',
      },
      postbank: {
        label: 'Password',
        // Mid-phrase in English: "Show password".
        short: 'password',
        withIt: 'With your password',
        hint: 'The password for your Postbank ID.',
        missing: 'Please enter your password.',
      },
    },
    reveal: (secret) => `Show ${secret}`,
    capsLock: 'Caps Lock is on',
    approvalHint: (app) =>
      `You then approve in your banking app${app ? `, e.g. ${app}` : ''}. chipTAN, smsTAN and TAN generators do not work here.`,
    rememberedTitle: 'This device is remembered',
    rememberedText: (withIt) => `${withIt}, logging in here usually works without a new approval.`,
    locked: 'Only your bank can unlock it.',
    lockoutRisk: 'Several failed attempts can lock your online access.',
    failed: 'The login failed.',
    slow: 'Your bank has not answered yet.',
    slowCanCancel: 'Your bank has not answered yet. You can cancel the login.',
    cancelled: 'Login cancelled.',
  },

  help: {
    toggle: 'What do I need?',
    credentials: {
      title: 'Your online banking login details',
      text: 'Login name and PIN, just as on your bank’s website. Not the PIN of your bank card.',
    },
    credentialsShort: 'Login name and PIN, just as on your bank’s website.',
    fints: {
      title: 'FinTS access',
      text: 'The app talks to your bank through it. If it is not enabled for your access, your bank can help you.',
    },
    approval: {
      title: 'Approval via app',
      text: 'You approve logins and orders in your bank’s banking app, e.g. with S-pushTAN, SecureGo plus or BestSign. chipTAN, smsTAN and TAN generators do not work here.',
    },
    findBank: {
      title: 'Finding your bank',
      text: 'Most precisely with your IBAN: positions 5 to 12 are the bank code (BLZ).',
    },
    forgotPin: {
      title: 'Forgot your PIN?',
      text: 'Only your bank can give you a new PIN – Girovo never stores your PIN.',
    },
  },

  tanWait: {
    title: {
      login: 'Approve login',
      statements: 'Approve transaction retrieval',
      // Not "Approve pending transactions": what is approved is reading them.
      pending: 'Approve retrieval of pending transactions',
      balance: 'Approve balance enquiry',
      transfer: 'Approve transfer',
    },
    afterConfirm: {
      login: 'Loading your accounts…',
      statements: 'Loading transactions…',
      pending: 'Loading pending transactions…',
      balance: 'Retrieving the balance…',
      transfer: 'The transfer is approved.',
    },
    refused: {
      login: { title: 'Login not approved', text: 'Your bank declined the login:' },
      statements: { title: 'Transaction retrieval not approved', text: 'Your bank declined the retrieval:' },
      pending: { title: 'Retrieval not approved', text: 'Your bank declined the retrieval:' },
      balance: { title: 'Balance enquiry not approved', text: 'Your bank declined the enquiry:' },
      transfer: { title: 'Transfer not completed', text: 'Your bank declined the order:' },
    },
    confirmed: 'Approval confirmed',
    checkFailed: 'Approval could not be checked',
    checkFailedText: 'It could not be determined whether the approval arrived.',
    newRequest: 'Send a new request',
    overdue: 'Your bank’s time limit has expired.',
    device: (name) => ['Device: ', name],
    challenge: 'Your bank’s request',
    helpToggle: 'No request received?',
    openMethod: (method) => `Open “${method}” yourself, even if no notification has appeared.`,
    openApp: 'Open your banking app yourself, even if no notification has appeared.',
    checkDevice: (device) => `Check the device your bank sent the request to: “${device}”.`,
    checkDevices: 'If you have set up several devices for approval, check all of them.',
    checkNotifications: 'Check that the app is allowed to send notifications on your phone.',
    reference: (codes) => ['Bank response code: ', codes],
    abort: {
      title: 'Cancel approval?',
      text: 'The transfer may already have been completed. If you cancel now, its status stays unclear – check your transactions before you send it again.',
      confirm: 'Cancel anyway',
      keepWaiting: 'Keep waiting',
    },
    to: (name) => `to ${name}`,
    compareIn: (method) => `Compare this with what “${method}” shows.`,
    compareApp: 'Compare this with what your banking app shows.',
    confirmedShort: 'Confirmed',
    noConfirmationYet: 'No confirmation yet',
    waitingForConfirmation: 'Waiting for confirmation',
    elapsed: 'Elapsed',
    limitPassed: (limit) => `Your bank’s time limit of ${limit} has expired.`,
    inTime: 'Arrived in time.',
    limit: (limit) => `Your bank waits up to ${limit} for the approval.`,
    seconds: (n) => (n === 1 ? '1 second' : `${n} seconds`),
    minutes: (n) => (n === 1 ? '1 minute' : `${n} minutes`),
  },

  tanMethod: {
    title: 'Security method',
    deviceMemory: 'After the first approval, the app remembers this device – you can undo this with “Forget device” in the session menu.',
    chooseDevice: 'Choose a device',
    chooseDeviceText: 'Which device do you want to approve on?',
    method: (name) => `Method: ${name}`,
    otherMethod: 'Other method',
    onlyOne: 'Your bank offers only one method for this access.',
    connectingVia: (method) => ['Connecting via ', method, '…'],
    choose: 'Choose how you approve logins and orders. Approval takes place directly in your banking app.',
    typedNote: (names, n) =>
      `${names} ${n === 1 ? 'needs' : 'need'} a typed TAN and ${n === 1 ? 'does' : 'do'} not work here.`,
    none: 'There is no method for this access that works here.',
    onlyTypedTitle: 'Only methods with a typed TAN',
    onlyTyped: (names) =>
      `For your access, your bank reports: ${names}. But only approval in a banking app works here.`,
    askBank: (app) =>
      `Ask your bank for approval via app${app ? ` (e.g. ${app})` : ''} or switch to it in your online banking. Then you can log in here.`,
    back: 'Back to login',
    aside: {
      title: 'How approval works',
      chooseTitle: 'Choose a method',
      chooseText: 'The one you also use to approve in your bank’s online banking.',
      openTitle: 'Open your banking app',
      openText: 'Your bank sends the request to the device you have registered with it.',
      confirmTitle: 'Confirm the request',
      confirmText: 'After that, it carries on here by itself.',
    },
  },

  sessionGuard: {
    windowTitle: (countdown, title) => `Logout in ${countdown} – ${title}`,
    announce: (left) => `Automatic logout in ${left}.`,
    title: 'Do you want to stay logged in?',
    text: 'You have not been active for a while. For security reasons, the app will log you out automatically in a moment.',
    timeLeft: (left) => `${left} left`,
    untilLogout: 'until logout',
    unclear: (n, to) => (n === 1
      ? `The status of your transfer ${to} is unclear. After you log out, it is no longer listed in Messages.`
      : `The status of ${n} transfers ${to} is unclear. After you log out, they are no longer listed in Messages.`),
    stay: 'Stay logged in',
  },

  logos: {
    title: 'Show company logos?',
    disclosure: 'For this, company names from your transactions go to the logo service Brandfetch – no amounts, IBANs or payment references. As with any request, Brandfetch sees your IP address.',
    load: 'Load logos',
    later: 'You can change this at any time in the session menu at the top right.',
    on: 'Company logos are on.',
    off: 'Company logos stay off.',
  },

  usage: {
    title: 'Share usage data?',
    disclosure: 'Girovo’s developer then learns which parts you use, how logins turn out and how long your bank takes for data requests – along with its bank code. Never included: login name, PIN, IBANs, balances, transactions, amounts or recipients. As with any connection, the server sees your IP address.',
    errorReports: 'Girovo always sends error reports – without account data, amounts or names.',
    later: 'You can change this at any time in the session menu at the top right.',
    share: 'Share',
    on: 'Usage data is shared from now on.',
    off: 'Usage data stays on this computer.',
  },

  api: {
    cancelled: 'The login was cancelled.',
    invalidBlz: 'Please provide a valid 8-digit bank code.',
    bankGone: 'This bank is no longer on the list – it may have merged. Choose it again via “Change”.',
    missingCredentials: 'Please provide your login name and PIN.',
    refused: 'Your bank declined the login. Check your login name and PIN.',
    methodNotOffered: 'Your bank does not offer this method for your access.',
    methodNeedsTan: 'This method needs a typed TAN. Only approval in a banking app works here.',
    loginFailed: 'Login failed.',
    usePost: 'Please use POST.',
  },
};
