// The login: bank search, credentials, help, the login frame (components/auth), and the approval wait and TAN method choice (TanWaitOverlay, TanMethodPicker, SessionGuard), with the consent prompts for logos and usage data.

import type { ReactNode } from 'react';

export const de = {
  /** While a login, or the setup of a TAN method, waits for the bank. */
  connecting: 'Verbinde mit der Bank …',
  /** The no on both consent tiles (company logos, usage data). */
  noThanks: 'Nein danke',
  /** On both consent tiles: where the answer can be changed later. */
  changeLater: 'Das kannst du in den Einstellungen ändern.',

  /** Android's phone: the line under the name on the login's brand field. */
  brandLine: 'Banking direkt mit deiner Bank – ohne jemanden dazwischen.',
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
      text: 'Girovo kennt sie nur, bis du dich abmeldest.',
    },
    direct: {
      title: 'Direkte Verbindung',
      text: 'Von diesem Rechner zu deiner Bank, ohne Umweg.',
    },
    device: {
      title: 'Dieses Gerät wird gemerkt',
      text: 'Geschützt mit deiner PIN. Deine Bank fragt dann seltener nach einer Freigabe.',
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
    updates: 'Bei der Suche nach Updates erfährt girovo.de nur deine Version.',
    logosOn: 'Für Firmenlogos gehen Firmennamen an Brandfetch.',
    logosOff: 'Firmenlogos sind aus.',
    logosUnasked: 'Firmenlogos nur mit deiner Zustimmung.',
    telemetryOn: 'Fehlerberichte und Nutzungsdaten gehen an den Entwickler von Girovo – nie Kontodaten, Beträge oder Namen.',
    errorReports: 'Fehlerberichte gehen an den Entwickler von Girovo – ohne Kontodaten, Beträge und Namen.',
    usageNeedsYes: 'Nutzungsdaten nur mit deiner Zustimmung.',
    /** The narrow layout's note under the form; the logo and error-report lines follow it. */
    note: 'Deine PIN wird nie gespeichert. Girovo spricht direkt mit deiner Bank und merkt sich danach dieses Gerät.',
  },

  /** Step one: find the bank (components/auth/BankPicker.tsx). */
  bankPicker: {
    title: 'Bank wählen',
    /** The bank chosen last time has left the bank list. */
    staleTitle: 'Deine Bank vom letzten Mal fehlt in der Liste',
    staleText: (name: string, blz: ReactNode): ReactNode[] => [
      `${name} (BLZ `,
      blz,
      ') hat vielleicht fusioniert. Such sie neu, am besten mit deiner IBAN.',
    ],
    label: 'Bank suchen',
    placeholder: 'Name, Ort, BLZ oder IBAN',
    clear: 'Suche leeren',
    results: 'Gefundene Banken',
    /** Under the field: how many Bankleitzahlen the list holds, the figure already formatted. */
    count: (n: ReactNode): ReactNode[] => [n, ' Bankleitzahlen zur Auswahl'],
    /** The one-click picks under the search. */
    quickPicks: 'Schnellauswahl',
    /** A pick that starts a search: a group of banks with no single BLZ. */
    searchFor: (bank: string) => `${bank} suchen`,
    searching: 'Suche …',
    unavailable: 'Die Suche klappt gerade nicht. Versuch es gleich noch einmal.',
    // An IBAN on its way.
    ibanForeign: 'Nur deutsche Banken – eine deutsche IBAN beginnt mit DE.',
    ibanInvalid: 'Diese IBAN stimmt nicht. Prüfe sie bitte noch einmal.',
    ibanIncomplete: 'Tippe weiter – die BLZ steckt in Stelle 5 bis 12 deiner IBAN.',
    // Nothing found, said for what was searched.
    noneForIban: 'Keine Bank zu dieser IBAN. Nicht jede Bank funktioniert mit Girovo.',
    noneForBlz: 'Keine Bank mit dieser BLZ. Die BLZ hat 8 Ziffern: Stelle 5 bis 12 deiner IBAN.',
    /** A bank people look for that offers no FinTS access (N26, Revolut, …). */
    withoutFints: (bank: string) => `${bank} bietet den Zugang nicht an, den Girovo braucht.`,
    noneForName: 'Keine Bank mit diesem Namen oder Ort. Nicht jede Bank funktioniert mit Girovo.',
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

  /**
   * 6.0: Girovo without a bank (components/demo) — the design preview's
   * made-up bank, accounts and Umsätze; nothing reaches a bank, nothing is kept.
   */
  demo: {
    /** Under the bank search. */
    start: 'Ohne Bank ausprobieren',
    startHint: 'Mit ausgedachten Konten und Umsätzen. Nichts geht an eine Bank.',
    /** On every screen of the demo. */
    banner: 'Demo: ausgedachte Konten',
    end: 'Demo beenden',
    /** The same, where the banner is narrow (a phone). */
    endShort: 'Beenden',
  },

  /** Step two: the online-banking credentials (components/auth/Credentials.tsx). */
  credentials: {
    /** The heading and the submit button. */
    title: 'Anmelden',
    intro: 'Mit den Zugangsdaten deines Online-Bankings.',
    noProductId: (file: ReactNode): ReactNode[] => [
      'Keine FinTS-Produkt-ID eingetragen – Banken lehnen die Anmeldung dann meist ab (Code 9078). Trag sie in ',
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
      `Danach gibst du die Anmeldung frei: in deiner Banking-App${app ? ` (z. B. ${app})` : ''}, mit chipTAN oder smsTAN.`,
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
    fints: {
      title: 'FinTS-Zugang',
      text: 'So spricht Girovo mit deiner Bank. Ist er nicht freigeschaltet, hilft dir deine Bank.',
    },
    approval: {
      title: 'Freigabe wie gewohnt',
      text: 'Wie im Online-Banking deiner Bank: in ihrer App, z. B. S-pushTAN, SecureGo plus oder BestSign, oder mit chipTAN, photoTAN oder smsTAN.',
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
      statements: 'Freigabe für deine Umsätze',
      pending: 'Freigabe für vorgemerkte Umsätze',
      balance: 'Freigabe für den Kontostand',
      transfer: 'Überweisung freigeben',
      portfolio: 'Freigabe für dein Depot',
      bankStatements: 'Freigabe für Kontoauszüge',
    },
    /** What the screen behind does once the approval is in. */
    afterConfirm: {
      login: 'Deine Konten werden geladen …',
      statements: 'Umsätze werden geladen …',
      pending: 'Vorgemerkte Umsätze werden geladen …',
      balance: 'Kontostand wird geladen …',
      transfer: 'Die Überweisung ist freigegeben.',
      portfolio: 'Bestand wird geladen …',
      bankStatements: 'Kontoauszüge werden geladen …',
    },
    /**
     * The bank refused: "Ablehnen" in the app, or the bank said no. The
     * bank's own words follow the text. (A transfer's sheet has its own step
     * for a refusal; its entry keeps the map complete.)
     */
    refused: {
      login: { title: 'Anmeldung nicht freigegeben', text: 'Deine Bank hat die Anmeldung abgelehnt:' },
      statements: { title: 'Umsätze nicht geladen', text: 'Deine Bank hat abgelehnt:' },
      pending: { title: 'Vorgemerkte Umsätze nicht geladen', text: 'Deine Bank hat abgelehnt:' },
      balance: { title: 'Kontostand nicht geladen', text: 'Deine Bank hat abgelehnt:' },
      transfer: { title: 'Überweisung nicht ausgeführt', text: 'Deine Bank hat den Auftrag abgelehnt:' },
      portfolio: { title: 'Depot nicht geladen', text: 'Deine Bank hat abgelehnt:' },
      bankStatements: { title: 'Kontoauszüge nicht geladen', text: 'Deine Bank hat abgelehnt:' },
    },
    confirmed: 'Freigabe bestätigt',
    /** The status of the approval could not be read. */
    checkFailed: 'Freigabe konnte nicht geprüft werden',
    checkFailedText: 'Girovo weiß nicht, ob die Freigabe angekommen ist.',
    newRequest: 'Neue Anfrage senden',
    overdue: 'Die Frist deiner Bank ist abgelaufen.',
    /** Where to look; the device's name comes in as its own element. */
    device: (name: ReactNode): ReactNode[] => ['Gerät: ', name],
    /** Above the bank's challenge text, when an order is shown too. */
    challenge: 'Anfrage deiner Bank',
    helpToggle: 'Keine Anfrage bekommen?',
    openMethod: (method: string) => `Öffne „${method}“ selbst, auch ohne Mitteilung.`,
    openApp: 'Öffne deine Banking-App selbst, auch ohne Mitteilung.',
    /** Android: the footer's way into the bank's approval app ("S-pushTAN öffnen"). */
    openApprovalApp: (app: string) => `${app} öffnen`,
    /** The desktop: where the approval is waiting. */
    approveOnPhone: (app: string) => `Bestätige in ${app} auf deinem Telefon.`,
    checkDevices: 'Nutzt du mehrere Geräte für Freigaben, sieh auf allen nach.',
    checkNotifications: 'Prüfe, ob deine Banking-App Mitteilungen senden darf.',
    /** Under a refusal: the bank's return codes, for whoever calls the bank. */
    reference: (codes: ReactNode): ReactNode[] => ['Rückmeldung der Bank: ', codes],
    /** Leaving a transfer's approval while it can still arrive. */
    abort: {
      title: 'Freigabe abbrechen?',
      text: 'Die Überweisung ist vielleicht schon ausgeführt. Brichst du ab, bleibt das unklar. Prüfe deine Umsätze, bevor du sie noch einmal sendest.',
      confirm: 'Trotzdem abbrechen',
      keepWaiting: 'Weiter warten',
    },
    /** Under the amount of the transfer being approved. */
    to: (name: string) => `an ${name}`,
    compareIn: (method: string) => `Vergleiche das mit der Anzeige in „${method}“.`,
    compareApp: 'Vergleiche das mit der Anzeige in deiner Banking-App.',
    /** With a typed TAN: the generator or the app on another device shows the order too. */
    compareDevice: 'Vergleiche das mit der Anzeige deines TAN-Generators oder deiner TAN-App.',
    /** Entering a TAN (a method without app approval). */
    entry: {
      label: 'TAN',
      send: 'TAN senden',
      /** The bank wanted another TAN after the first one. */
      again: 'Deine Bank fragt nach einer weiteren TAN.',
      missing: 'Bitte gib die TAN ein.',
      digitsOnly: 'Die TAN besteht nur aus Ziffern.',
      invalid: 'Das ist keine gültige TAN. Gib sie so ein, wie sie angezeigt wird.',
      flickerHint: 'Halte deinen TAN-Generator an die Grafik, die Pfeile auf die Dreiecke.',
      imageHint: 'Scanne die Grafik mit deinem TAN-Generator oder deiner TAN-App.',
      imageAlt: 'Grafik deiner Bank zum Scannen',
      /** The flicker graphic's controls. */
      flicker: 'Flickergrafik',
      size: 'Größe',
      speed: 'Tempo',
      larger: 'Größer',
      smaller: 'Kleiner',
      faster: 'Schneller',
      slower: 'Langsamer',
      pause: 'Anhalten',
      play: 'Abspielen',
      helpToggle: 'Grafik wird nicht erkannt?',
      flickerTips: [
        'Stell die Helligkeit deines Bildschirms hoch.',
        'Ändere Größe und Geschwindigkeit, bis dein TAN-Generator die Grafik liest.',
        'Halte den TAN-Generator ruhig und flach an den Bildschirm.',
      ],
      imageTips: [
        'Stell die Helligkeit deines Bildschirms hoch.',
        'Halte die Kamera ruhig, etwa eine Handbreit vom Bildschirm entfernt.',
      ],
    },
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
    deviceMemory: 'Nach der ersten Freigabe merkt sich Girovo diesen Rechner. Rückgängig mit „Gerät vergessen“ in den Einstellungen.',
    chooseDevice: 'Gerät wählen',
    chooseDeviceText: 'Auf welchem Gerät möchtest du freigeben?',
    method: (name: string) => `Verfahren: ${name}`,
    otherMethod: 'Anderes Verfahren',
    onlyOne: 'Deine Bank bietet für diesen Zugang nur ein Verfahren an.',
    /** The method's name comes in as its own element. */
    connectingVia: (method: ReactNode): ReactNode[] => ['Verbinde über ', method, ' …'],
    choose: 'Wähle, wie du Anmeldung und Aufträge freigibst.',
    /** Under a method's name: how it approves. */
    kind: {
      app: 'Freigabe in der Banking-App',
      typed: 'TAN-Eingabe',
    },
    none: 'Deine Bank bietet für diesen Zugang kein Sicherheitsverfahren an. Frag sie, wie du eines freischaltest.',
    back: 'Zurück zur Anmeldung',
    /** The wide layout's side tile: what is about to happen. */
    aside: {
      title: 'So läuft die Freigabe',
      openTitle: 'Anfrage prüfen',
      openText: 'Deine Bank schickt sie an deine Banking-App oder zeigt sie hier an.',
      confirmTitle: 'Freigeben',
      confirmText: 'In der App bestätigen oder die TAN hier eingeben. Danach geht es von selbst weiter.',
    },
  },

  /** The last minute before the automatic logout (components/SessionGuard.tsx). */
  sessionGuard: {
    /** The window's title while the warning is up: the countdown ("0:45"), then the page's own title. */
    windowTitle: (countdown: string, title: string) => `Abmeldung in ${countdown} – ${title}`,
    /** For screen readers at 60, 30 and 10 seconds; the time comes in words ("42 Sekunden"). */
    announce: (left: string) => `Noch ${left} bis zur automatischen Abmeldung.`,
    title: 'Möchtest du angemeldet bleiben?',
    text: 'Du warst eine Weile nicht aktiv. Zu deiner Sicherheit meldet Girovo dich gleich ab.',
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
    disclosure: 'Dafür gehen Firmennamen aus deinen Umsätzen an den Logo-Dienst Brandfetch – keine Beträge, IBANs oder Verwendungszwecke. Brandfetch sieht dabei deine IP-Adresse.',
    load: 'Logos laden',
    /** The toasts after the answer. */
    on: 'Firmenlogos sind eingeschaltet.',
    off: 'Firmenlogos bleiben aus.',
  },

  /** "Nutzungsdaten teilen?", the desktop app's Übersicht tile (components/telemetry/UsageConsent.tsx). */
  usage: {
    title: 'Nutzungsdaten teilen?',
    /** What a yes shares. */
    disclosure: 'Der Entwickler von Girovo sieht dann, welche Bereiche du nutzt, ob Anmeldungen klappen und wie schnell deine Bank antwortet – samt Bankleitzahl. Nie dabei: Anmeldename, PIN, IBANs, Kontostände, Umsätze, Beträge oder Empfänger. Deine IP-Adresse ist wie bei jeder Verbindung sichtbar.',
    /** Error reports need no yes; the user is told so wherever they are asked. */
    errorReports: 'Fehlerberichte schickt Girovo immer – ohne Kontodaten, Beträge und Namen.',
    share: 'Teilen',
    /** The toasts after the answer. */
    on: 'Nutzungsdaten werden geteilt.',
    off: 'Nutzungsdaten bleiben auf diesem Rechner.',
  },

  /** What the login's routes answer (app/api/connect, select-tan, device-status). */
  api: {
    /** The login was called off; the browser has stopped listening already. */
    cancelled: 'Die Anmeldung wurde abgebrochen.',
    invalidBlz: 'Bitte gib eine gültige Bankleitzahl mit 8 Ziffern ein.',
    bankGone: 'Diese Bank fehlt in der Liste – vielleicht hat sie fusioniert. Wähle sie über „Ändern“ neu.',
    missingCredentials: 'Bitte gib Anmeldename und PIN ein.',
    /** The bank refused without words of its own. Names the PIN: lib/bank-answer.ts reads that as a credential answer. */
    refused: 'Deine Bank hat die Anmeldung abgelehnt. Prüfe Anmeldename und PIN.',
    methodNotOffered: 'Dieses Verfahren bietet deine Bank für deinen Zugang nicht an.',
    loginFailed: 'Anmeldung fehlgeschlagen.',
    /** device-status asked with GET, the old query-string form. */
    usePost: 'Bitte per POST abfragen.',
  },
};

export const en: typeof de = {
  connecting: 'Connecting to the bank…',
  noThanks: 'No thanks',
  changeLater: 'You can change this in Settings.',

  brandLine: 'Banking straight with your bank – no one in between.',
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
      text: 'Girovo only knows it until you log out.',
    },
    direct: {
      title: 'Direct connection',
      text: 'From this computer to your bank, with nothing in between.',
    },
    device: {
      title: 'This device will be remembered',
      text: 'Protected by your PIN. Your bank then asks for approval less often.',
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
    updates: 'When Girovo looks for updates, girovo.de only learns your version.',
    logosOn: 'For company logos, company names go to Brandfetch.',
    logosOff: 'Company logos are off.',
    logosUnasked: 'Company logos only with your consent.',
    telemetryOn: 'Error reports and usage data go to Girovo’s developer – never account data, amounts or names.',
    errorReports: 'Error reports go to Girovo’s developer – without account data, amounts or names.',
    usageNeedsYes: 'Usage data only with your consent.',
    note: 'Your PIN is never stored. Girovo talks straight to your bank and then remembers this device.',
  },

  bankPicker: {
    title: 'Choose your bank',
    staleTitle: 'Your bank from last time is missing from the list',
    staleText: (name, blz) => [
      `${name} (BLZ `,
      blz,
      ') may have merged. Search for it again, best with your IBAN.',
    ],
    label: 'Search for your bank',
    placeholder: 'Name, town, bank code or IBAN',
    clear: 'Clear search',
    results: 'Banks found',
    count: (n) => [n, ' bank codes to choose from'],
    quickPicks: 'Quick picks',
    searchFor: (bank) => `Search for ${bank}`,
    searching: 'Searching…',
    unavailable: 'Search isn’t working right now. Try again in a moment.',
    ibanForeign: 'German banks only – a German IBAN starts with DE.',
    ibanInvalid: 'This IBAN is not correct. Please check it again.',
    ibanIncomplete: 'Keep typing – the bank code (BLZ) is in positions 5 to 12 of your IBAN.',
    noneForIban: 'No bank for this IBAN. Not every bank works with Girovo.',
    noneForBlz: 'No bank with this bank code (BLZ). It has 8 digits: positions 5 to 12 of your IBAN.',
    withoutFints: (bank) => `${bank} doesn’t offer the access Girovo needs.`,
    noneForName: 'No bank with this name or town. Not every bank works with Girovo.',
    ibanBank: 'The bank for your IBAN:',
    firstHits: (n) => `The first ${n} matches – add the town or enter your IBAN.`,
    sameNames: 'Enter your IBAN to find exactly your bank.',
    statusIbanBank: (name, blz) => `The bank for your IBAN: ${name}, BLZ ${blz}`,
    statusOne: (name, blz) => `1 bank found: ${name}, BLZ ${blz}`,
    statusMany: (n, atLeast) => `${atLeast ? `At least ${n}` : n} banks found.`,
  },

  demo: {
    start: 'Try it without a bank',
    startHint: 'With made-up accounts and transactions. Nothing goes to a bank.',
    banner: 'Demo: made-up accounts',
    end: 'End demo',
    endShort: 'End',
  },

  credentials: {
    title: 'Log in',
    intro: 'With your online banking login details.',
    noProductId: (file) => [
      'No FinTS product ID set – banks then usually decline the login (code 9078). Add it in ',
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
      `Then you approve the login: in your banking app${app ? ` (e.g. ${app})` : ''}, with chipTAN or smsTAN.`,
    rememberedTitle: 'This device is remembered',
    rememberedText: (withIt) => `${withIt}, logging in here usually works without a new approval.`,
    locked: 'Only your bank can unlock it.',
    lockoutRisk: 'Several failed attempts can lock your online banking.',
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
    fints: {
      title: 'FinTS access',
      text: 'This is how Girovo talks to your bank. If it isn’t enabled, your bank can help.',
    },
    approval: {
      title: 'Approval as usual',
      text: 'As in your bank’s online banking: in its app, e.g. S-pushTAN, SecureGo plus or BestSign, or with chipTAN, photoTAN or smsTAN.',
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
      statements: 'Approval for your transactions',
      // Not "Approve pending transactions": what is approved is reading them.
      pending: 'Approval for pending transactions',
      balance: 'Approval for the balance',
      transfer: 'Approve transfer',
      portfolio: 'Approval for your securities account',
      bankStatements: 'Approval for account statements',
    },
    afterConfirm: {
      login: 'Loading your accounts…',
      statements: 'Loading transactions…',
      pending: 'Loading pending transactions…',
      balance: 'Loading the balance…',
      transfer: 'The transfer is approved.',
      portfolio: 'Loading holdings…',
      bankStatements: 'Loading statements…',
    },
    refused: {
      login: { title: 'Login not approved', text: 'Your bank declined the login:' },
      statements: { title: 'Transactions not loaded', text: 'Your bank declined:' },
      pending: { title: 'Pending transactions not loaded', text: 'Your bank declined:' },
      balance: { title: 'Balance not loaded', text: 'Your bank declined:' },
      transfer: { title: 'Transfer not completed', text: 'Your bank declined the order:' },
      portfolio: { title: 'Securities account not loaded', text: 'Your bank declined:' },
      bankStatements: { title: 'Statements not loaded', text: 'Your bank declined:' },
    },
    confirmed: 'Approval confirmed',
    checkFailed: 'Approval could not be checked',
    checkFailedText: 'Girovo can’t tell whether the approval arrived.',
    newRequest: 'Send a new request',
    overdue: 'Your bank’s time limit has expired.',
    device: (name) => ['Device: ', name],
    challenge: 'Your bank’s request',
    helpToggle: 'No request received?',
    openMethod: (method) => `Open “${method}” yourself, even without a notification.`,
    openApp: 'Open your banking app yourself, even without a notification.',
    openApprovalApp: (app) => `Open ${app}`,
    approveOnPhone: (app) => `Approve in ${app} on your phone.`,
    checkDevices: 'If you use several devices for approvals, check them all.',
    checkNotifications: 'Check that your banking app may send notifications.',
    reference: (codes) => ['Bank response code: ', codes],
    abort: {
      title: 'Cancel approval?',
      text: 'The transfer may already be completed. If you cancel, that stays unclear. Check your transactions before you send it again.',
      confirm: 'Cancel anyway',
      keepWaiting: 'Keep waiting',
    },
    to: (name) => `to ${name}`,
    compareIn: (method) => `Compare this with what “${method}” shows.`,
    compareApp: 'Compare this with what your banking app shows.',
    compareDevice: 'Compare this with what your TAN generator or TAN app shows.',
    entry: {
      label: 'TAN',
      send: 'Send TAN',
      again: 'Your bank asks for another TAN.',
      missing: 'Please enter the TAN.',
      digitsOnly: 'The TAN is made of digits only.',
      invalid: 'That is not a valid TAN. Enter it as it is shown.',
      flickerHint: 'Hold your TAN generator against the graphic, its arrows on the triangles.',
      imageHint: 'Scan the graphic with your TAN generator or TAN app.',
      imageAlt: 'Your bank’s graphic to scan',
      flicker: 'Flicker graphic',
      size: 'Size',
      speed: 'Speed',
      larger: 'Larger',
      smaller: 'Smaller',
      faster: 'Faster',
      slower: 'Slower',
      pause: 'Pause',
      play: 'Play',
      helpToggle: 'Graphic not recognised?',
      flickerTips: [
        'Turn up the brightness of your screen.',
        'Change the size and speed until your TAN generator reads the graphic.',
        'Hold the TAN generator steady and flat against the screen.',
      ],
      imageTips: [
        'Turn up the brightness of your screen.',
        'Hold the camera steady, about a hand’s width from the screen.',
      ],
    },
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
    deviceMemory: 'After the first approval, Girovo remembers this computer. Undo it with “Forget device” in Settings.',
    chooseDevice: 'Choose a device',
    chooseDeviceText: 'Which device do you want to approve on?',
    method: (name) => `Method: ${name}`,
    otherMethod: 'Other method',
    onlyOne: 'Your bank offers only one method for this login.',
    connectingVia: (method) => ['Connecting via ', method, '…'],
    choose: 'Choose how you approve logins and orders.',
    kind: {
      app: 'Approval in the banking app',
      typed: 'Typed TAN',
    },
    none: 'Your bank offers no security method for this login. Ask your bank how to enable one.',
    back: 'Back to login',
    aside: {
      title: 'How approval works',
      openTitle: 'Check the request',
      openText: 'Your bank sends it to your banking app or shows it here.',
      confirmTitle: 'Approve',
      confirmText: 'Confirm in the app or enter the TAN here. After that, it carries on by itself.',
    },
  },

  sessionGuard: {
    windowTitle: (countdown, title) => `Logout in ${countdown} – ${title}`,
    announce: (left) => `Automatic logout in ${left}.`,
    title: 'Do you want to stay logged in?',
    text: 'You haven’t been active for a while. For your safety, Girovo will log you out shortly.',
    timeLeft: (left) => `${left} left`,
    untilLogout: 'until logout',
    unclear: (n, to) => (n === 1
      ? `The status of your transfer ${to} is unclear. After you log out, it is no longer listed in Messages.`
      : `The status of ${n} transfers ${to} is unclear. After you log out, they are no longer listed in Messages.`),
    stay: 'Stay logged in',
  },

  logos: {
    title: 'Show company logos?',
    disclosure: 'For this, company names from your transactions go to the logo service Brandfetch – no amounts, IBANs or payment references. Brandfetch sees your IP address.',
    load: 'Load logos',
    on: 'Company logos are on.',
    off: 'Company logos stay off.',
  },

  usage: {
    title: 'Share usage data?',
    disclosure: 'Girovo’s developer then sees which parts you use, whether logins work and how fast your bank answers – with its bank code. Never included: login name, PIN, IBANs, balances, transactions, amounts or recipients. As with any connection, your IP address is visible.',
    errorReports: 'Girovo always sends error reports – without account data, amounts or names.',
    share: 'Share',
    on: 'Usage data is shared from now on.',
    off: 'Usage data stays on this computer.',
  },

  api: {
    cancelled: 'The login was cancelled.',
    invalidBlz: 'Please enter a valid 8-digit bank code.',
    bankGone: 'This bank is missing from the list – it may have merged. Choose it again via “Change”.',
    missingCredentials: 'Please enter your login name and PIN.',
    refused: 'Your bank declined the login. Check your login name and PIN.',
    methodNotOffered: 'Your bank does not offer this method for your login.',
    loginFailed: 'Login failed.',
    usePost: 'Please use POST.',
  },
};
