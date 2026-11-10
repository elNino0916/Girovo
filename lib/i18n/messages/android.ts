// What only the Android app says: fingerprint login, the category guess
// with Gemini Nano, its updates, the phone's integrity check
// (components/android, mobile/bridges).

export const de = {
  biometric: {
    /** The switch on the Einstellungen page. */
    label: 'Mit Fingerabdruck anmelden',
    hint: 'Deine PINs bleiben geschützt auf dem Telefon. Nur dein Fingerabdruck öffnet sie.',
    unavailable: {
      'none-enrolled': 'Richte zuerst in den Android-Einstellungen einen Fingerabdruck ein.',
      'no-hardware': 'Dieses Telefon hat keinen Fingerabdrucksensor, den Girovo nutzen kann.',
      'security-update': 'Der Fingerabdrucksensor braucht ein Sicherheitsupdate von Android.',
      unavailable: 'Der Fingerabdrucksensor ist gerade nicht verfügbar.',
    },
    enrollTitle: 'Fingerabdruck für Girovo',
    /** `more`: the further banks logged in now, sealed along. */
    enrollSubtitle: (bank: string, more = 0) => (more
      ? `Damit meldest du dich künftig bei ${bank} an – und bei ${more === 1 ? 'einer weiteren Bank' : `${more} weiteren Banken`}.`
      : `Damit meldest du dich künftig bei ${bank} an.`),
    unlockTitle: 'Bei Girovo anmelden',
    unlockSubtitle: (bank: string) => `${bank} · mit deinem Fingerabdruck`,
    /** The prompt's way out. */
    usePin: 'PIN eingeben',
    cancel: 'Abbrechen',
    /** On the login form, while a fingerprint login is set up for this login name. */
    loginButton: 'Mit Fingerabdruck anmelden',
    nowOn: 'Die Anmeldung mit Fingerabdruck ist eingeschaltet.',
    nowOff: 'Die Anmeldung mit Fingerabdruck ist ausgeschaltet.',
    enrollFailed: 'Die Anmeldung mit Fingerabdruck ließ sich nicht einschalten.',
    invalidated: 'Ein neuer Fingerabdruck ist dazugekommen. Melde dich mit deiner PIN an und schalte den Fingerabdruck wieder ein.',
    refused: 'Die Bank hat die gespeicherte PIN nicht angenommen. Sie ist gelöscht – melde dich mit deiner PIN an.',
    /** The prompt after a further bank logged in with its PIN typed, while fingerprint login is on. */
    sealTitle: 'PIN mit Fingerabdruck sichern',
    sealSubtitle: (bank: string) => `Dann meldet dich dein Fingerabdruck auch bei ${bank} an.`,
    notNow: 'Nicht jetzt',
    sealed: (bank: string) => `Die PIN für ${bank} ist jetzt mit deinem Fingerabdruck gesichert.`,
    sealFailed: (bank: string) => `Die PIN für ${bank} ließ sich nicht sichern.`,
  },

  /** The category guess with Gemini Nano (components/android: Einstellungen and the progress line). */
  categories: {
    title: 'Kategorien mit Gemini Nano',
    hint: 'Ordnet zu, was die Regeln nicht erkennen – nur auf diesem Telefon.',
    downloading: 'Android lädt Gemini Nano',
    downloadProgress: (got: string, total: string) => `${got} von ${total}`,
    downloadable: 'Android lädt Gemini Nano bald – oft erst im WLAN.',
    downloadNow: 'Jetzt laden',
    /** A minute after the request, while AICore has not begun (it decides when — a Xiaomi waited hours). */
    notStarted: 'Der Download hat noch nicht begonnen.',
    notStartedHint: 'Das kann Stunden dauern. Oft hilft es, das Telefon im WLAN zu laden und „AICore“ und „Private Compute Services“ im Play Store zu aktualisieren.',
    /** Beside its row's check, for a screen reader: Android has Nano, and it sorts. */
    running: 'Aktiv',
    unsupported: 'Nicht unterstütztes Telefon',
    /** Before AICore's own words on each model variant, on a phone without Nano: for a report. */
    aicoreSaid: 'Antwort von AICore',
    unsupportedHint: 'Dieses Telefon hat kein Gemini Nano. Hier ordnen nur die Regeln zu.',
    update: 'Gemini Nano braucht ein Systemupdate. Installiere die neuesten Updates.',
    aicore: 'Gemini Nano braucht ein Update von „AICore“ aus Google Play.',
    /** Under Umsätze and on Analyse while Nano works through the bookings. */
    working: 'Kategorien werden zugeordnet',
    count: (done: number, total: number) => `${done} von ${total}`,
    waiting: 'Wartet auf Gemini Nano',
  },

  /** The home screen widget (BalanceWidget.java): since when its Gesamtsaldo stands. */
  widget: {
    /** The widget's title, in the app's language (the phone's may differ). */
    title: 'Gesamtsaldo',
    stamp: (at: Date) =>
      `Stand ${at.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}, ${at.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`,
  },

  /** The phone's integrity check (lib/device-integrity.ts): Einstellungen and the login. */
  integrity: {
    title: 'Gerätesicherheit',
    trusted: 'Dieses Telefon bestätigt, dass sein Android unverändert ist.',
    custom: 'Auf diesem Telefon läuft ein eigenes, geschütztes Android wie GrapheneOS. Sicher, solange du diesem System vertraust.',
    modified: 'Das System dieses Telefons ist verändert oder nicht geprüft. Eine App mit Root-Rechten könnte mitlesen, was du eintippst – auch deine PIN.',
    unknown: 'Dieses Telefon kann nicht nachweisen, dass es unverändert ist.',
    foreign: 'Diese App stammt nicht von Girovo. Lade Girovo nur von GitHub (elNino0916/Girovo) oder aus Google Play.',
    development: 'Eine Testversion: Ihre Herkunft wird nicht geprüft.',
    /** The verdict in a few words, on the Einstellungen row; the sentences above are its dialog. */
    short: {
      trusted: 'Sicher – vom Telefon bestätigt',
      custom: 'Eigenes Android, geschützt',
      modified: 'Verändert – nicht sicher',
      unknown: 'Nicht nachweisbar',
    },
    foreignShort: 'Keine offizielle Girovo-App',
    keepsNothingShort: 'Girovo speichert hier nichts',
    /** A phone Girovo keeps nothing on (lib/device-integrity.ts keepsNothing): Einstellungen and the login. */
    keepsNothing: 'Darum speichert Girovo auf diesem Telefon nichts – kein gemerktes Gerät, keine Umsätze, keine Daten. Alles gilt nur bis zum Abmelden.',
    keepsNothingTitle: 'Girovo speichert auf diesem Telefon nichts',
    keepsNothingLogin: 'Dieses Telefon ist nicht als sicher bestätigt. Deine Bank fragt jedes Mal nach einer Freigabe, und alles gilt nur bis zum Abmelden.',
    /** A route that keeps something, refused on such a phone (mobile/server/index.ts). */
    notKept: 'Girovo speichert hier nichts, weil dieses Telefon nicht als sicher bestätigt ist (Einstellungen → Gerätesicherheit).',
    /** The fingerprint switch on such a phone. */
    noFingerprint: 'Auf diesem Telefon nicht möglich',
    /** The login's warning, before the PIN is typed. */
    modifiedTitle: 'Dieses Telefon ist verändert',
    modifiedLogin: 'Das System ist verändert oder nicht geprüft. Eine App mit Root-Rechten könnte deine PIN mitlesen – melde dich nur an, wenn du diesem Telefon vertraust.',
    foreignTitle: 'Das ist nicht die offizielle Girovo-App',
    foreignLogin: 'Sie könnte deine PIN weitergeben. Gib sie hier nicht ein und lade Girovo von GitHub (elNino0916/Girovo) oder aus Google Play.',
    /** Keeping data on an unsafe phone anyway (components/android/SaveAnyway.tsx): held "Schließen" for 10 s. */
    saveAnyway: {
      kicker: 'Warnung',
      title: 'Daten auf einem unsicheren Telefon speichern?',
      leadModified: 'Dieses Telefon ist gerootet oder verändert. Apps mit Root-Rechten können alles lesen, was Girovo hier ablegt.',
      leadUnknown: 'Dieses Telefon kann nicht nachweisen, dass es unverändert ist. Ist es gerootet, können Apps mit Root-Rechten alles lesen, was Girovo hier ablegt.',
      risks: [
        'Kontostände, Umsätze, IBANs, Notizen und Dokumente liegen dann lesbar für jede App mit Root-Rechten.',
        'Ein gemerktes Gerät erspart dir die Freigabe beim Anmelden – auch jedem, der dein Telefon samt PIN in die Hände bekommt.',
        'Deine PIN speichert Girovo trotzdem nie, und die Anmeldung per Fingerabdruck bleibt aus. Beim Tippen kann eine Root-App sie aber mitlesen.',
      ],
      still: 'Erlaube das nur, wenn du jede App mit Root-Rechten auf diesem Telefon kennst und ihr vertraust.',
      understood: 'Ich verstehe das Risiko',
      restart: 'Girovo startet dafür neu – danach meldest du dich wieder an.',
      cancel: 'Nichts speichern',
      allow: 'Trotzdem speichern',
      keptShort: 'speichert trotzdem',
      kept: 'Du hast erlaubt, dass Girovo auf diesem Telefon trotzdem speichert.',
      revoke: 'Wieder nichts speichern',
    },
  },

  updates: {
    install: 'Installieren',
    installs: 'Android fragt gleich, ob du die neue Version installieren willst. Girovo startet danach neu.',
    permission: 'Erlaube Girovo in den Android-Einstellungen, Apps zu installieren, und tippe dann noch einmal auf „Installieren“.',
    /** A release for a newer Android than the phone's (mobile/bridges/updates.ts). */
    needsAndroid: (version: string) =>
      `Diese Version braucht Android ${version} oder neuer. Hier bleibt Girovo bei der aktuellen Version.`,
    /** A release Android counts as older than the installed app and would refuse (UpdaterPlugin). */
    olderVersion: 'Diese Version lässt sich über die vorhandene nicht installieren.',
    /** The Google Play build: Play brings updates. */
    play: 'Updates kommen über Google Play.',
    playAvailable: 'Bei Google Play gibt es eine neue Version von Girovo.',
    playUpdate: 'Über Google Play aktualisieren',
    /** GitHub's quota for the connection used up; `minutes` until it takes requests again, null when it named no time. */
    rateLimited: (minutes: number | null) =>
      minutes == null
        ? 'Die Suche nach Updates geht gerade nicht. Versuche es später noch einmal.'
        : minutes === 1
          ? 'Die Suche nach Updates geht gerade nicht – wieder in etwa einer Minute.'
          : `Die Suche nach Updates geht gerade nicht – wieder in etwa ${minutes} Minuten.`,
    httpError: (status: number) => `Die Suche nach Updates hat nicht geklappt (Fehler ${status}).`,
  },

  /** An invoice shared with Girovo (components/android/useLaunches.ts). */
  launch: {
    unreadable: 'Die geteilte Datei ließ sich nicht öffnen.',
  },

  /** Pull to refresh (components/android/PullToRefresh.tsx), for a screen reader. */
  refresh: {
    refreshing: 'Umsätze werden geladen',
  },

  /** The notification while an approval in the bank's app is awaited. */
  approval: {
    title: 'Warte auf deine Freigabe',
    text: 'Bestätige in deiner Banking-App – Girovo wartet so lange.',
  },

  share: {
    /** The share sheet's title for a GiroCode. */
    giroCode: 'GiroCode teilen',
    /** Geld anfordern's button, where the desktop saves the image. */
    button: 'Bild teilen',
  },
};

export const en: typeof de = {
  biometric: {
    label: 'Log in with fingerprint',
    hint: 'Your PINs stay protected on the phone. Only your fingerprint opens them.',
    unavailable: {
      'none-enrolled': 'Set up a fingerprint in Android’s settings first.',
      'no-hardware': 'This phone has no fingerprint sensor Girovo can use.',
      'security-update': 'The fingerprint sensor needs a security update from Android.',
      unavailable: 'The fingerprint sensor isn’t available right now.',
    },
    enrollTitle: 'Fingerprint for Girovo',
    enrollSubtitle: (bank: string, more = 0) => (more
      ? `You’ll use it to log in to ${bank} from now on – and to ${more === 1 ? 'one more bank' : `${more} more banks`}.`
      : `You’ll use it to log in to ${bank} from now on.`),
    unlockTitle: 'Log in to Girovo',
    unlockSubtitle: (bank: string) => `${bank} · with your fingerprint`,
    usePin: 'Enter PIN',
    cancel: 'Cancel',
    loginButton: 'Log in with fingerprint',
    nowOn: 'Fingerprint login is on.',
    nowOff: 'Fingerprint login is off.',
    enrollFailed: 'Fingerprint login couldn’t be turned on.',
    invalidated: 'A new fingerprint was added. Log in with your PIN and turn fingerprint login back on.',
    refused: 'The bank didn’t accept the stored PIN. It has been deleted – log in with your PIN.',
    sealTitle: 'Secure PIN with fingerprint',
    sealSubtitle: (bank: string) => `Your fingerprint will then log you in to ${bank} too.`,
    notNow: 'Not now',
    sealed: (bank: string) => `Your PIN for ${bank} is now secured with your fingerprint.`,
    sealFailed: (bank: string) => `Your PIN for ${bank} couldn’t be secured.`,
  },

  categories: {
    title: 'Categories with Gemini Nano',
    hint: 'Sorts what the rules don’t recognise – only on this phone.',
    downloading: 'Android is downloading Gemini Nano',
    downloadProgress: (got: string, total: string) => `${got} of ${total}`,
    downloadable: 'Android downloads Gemini Nano soon – often only on Wi-Fi.',
    downloadNow: 'Download now',
    notStarted: 'The download hasn’t started yet.',
    notStartedHint: 'This can take hours. It often helps to charge the phone on Wi-Fi and update “AICore” and “Private Compute Services” in the Play Store.',
    running: 'Active',
    unsupported: 'Unsupported phone',
    aicoreSaid: 'AICore reported',
    unsupportedHint: 'This phone doesn’t have Gemini Nano. Only the rules sort here.',
    update: 'Gemini Nano needs a system update. Install the latest updates.',
    aicore: 'Gemini Nano needs an update of “AICore” from Google Play.',
    working: 'Assigning categories',
    count: (done: number, total: number) => `${done} of ${total}`,
    waiting: 'Waiting for Gemini Nano',
  },

  widget: {
    title: 'Total balance',
    stamp: (at) =>
      `As of ${at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`,
  },

  integrity: {
    title: 'Device security',
    trusted: 'This phone confirms that its Android is unmodified.',
    custom: 'This phone runs its own protected Android, such as GrapheneOS. Safe as long as you trust that system.',
    modified: 'This phone’s system is modified or unverified. An app with root rights could read what you type – your PIN too.',
    unknown: 'This phone can’t prove that it is unmodified.',
    foreign: 'This app doesn’t come from Girovo. Only get Girovo from GitHub (elNino0916/Girovo) or Google Play.',
    development: 'A test version: where it comes from isn’t checked.',
    short: {
      trusted: 'Safe – confirmed by the phone',
      custom: 'Own Android, protected',
      modified: 'Modified – not safe',
      unknown: "Can't be proven",
    },
    foreignShort: 'Not the official Girovo app',
    keepsNothingShort: 'Girovo keeps nothing here',
    keepsNothing: 'So Girovo keeps nothing on this phone – no remembered device, no transactions, no data. Everything lasts only until you log out.',
    keepsNothingTitle: 'Girovo keeps nothing on this phone',
    keepsNothingLogin: 'This phone isn’t confirmed as safe. Your bank asks for an approval every time, and everything lasts only until you log out.',
    notKept: 'Girovo keeps nothing here, because this phone isn’t confirmed as safe (Settings → Device security).',
    noFingerprint: 'Not possible on this phone',
    modifiedTitle: 'This phone has been modified',
    modifiedLogin: 'The system is modified or unverified. An app with root rights could read your PIN – only log in if you trust this phone.',
    foreignTitle: "This isn't the official Girovo app",
    foreignLogin: 'It could pass your PIN on. Don’t enter it here, and get Girovo from GitHub (elNino0916/Girovo) or Google Play.',
    saveAnyway: {
      kicker: 'Warning',
      title: 'Keep data on an unsafe phone?',
      leadModified: 'This phone is rooted or modified. Apps with root rights can read everything Girovo keeps here.',
      leadUnknown: "This phone can't prove it is unmodified. If it is rooted, apps with root rights can read everything Girovo keeps here.",
      risks: [
        'Balances, transactions, IBANs, notes and documents become readable to any app with root rights.',
        'A remembered device skips the approval at login – for anyone who gets hold of your phone and your PIN, too.',
        'Girovo still never keeps your PIN, and fingerprint login stays off. A root app can read it as you type it, though.',
      ],
      still: 'Only allow this if you know and trust every app with root rights on this phone.',
      understood: 'I understand the risk',
      restart: 'Girovo restarts for this – sign in again afterwards.',
      cancel: 'Keep nothing',
      allow: 'Keep data anyway',
      keptShort: 'keeps data anyway',
      kept: 'You allowed Girovo to keep its data on this phone anyway.',
      revoke: 'Keep nothing again',
    },
  },

  updates: {
    install: 'Install',
    installs: 'Android will ask whether you want to install the new version. Girovo restarts afterwards.',
    permission: 'Allow Girovo to install apps in Android’s settings, then tap “Install” again.',
    needsAndroid: (version) => `This version needs Android ${version} or later. Girovo stays at the current version here.`,
    olderVersion: 'This version can’t be installed over the one you have.',
    play: 'Updates come through Google Play.',
    playAvailable: 'A new version of Girovo is on Google Play.',
    playUpdate: 'Update through Google Play',
    rateLimited: (minutes) =>
      minutes == null
        ? 'Checking for updates isn’t possible right now. Try again later.'
        : minutes === 1
          ? 'Checking for updates isn’t possible right now – again in about a minute.'
          : `Checking for updates isn’t possible right now – again in about ${minutes} minutes.`,
    httpError: (status) => `Checking for updates didn’t work (error ${status}).`,
  },

  launch: {
    unreadable: 'The shared file couldn’t be opened.',
  },

  refresh: {
    refreshing: 'Loading transactions',
  },

  approval: {
    title: 'Waiting for your approval',
    text: 'Confirm in your banking app – Girovo waits until then.',
  },

  share: {
    giroCode: 'Share GiroCode',
    button: 'Share image',
  },
};
