// What only the Android app says: fingerprint login, the category guess
// with Gemini Nano, its updates, the phone's integrity check
// (components/android, mobile/bridges).

export const de = {
  biometric: {
    /** The switch on the Einstellungen page. */
    label: 'Mit Fingerabdruck anmelden',
    hint: 'Deine PIN wird dafür auf diesem Telefon gespeichert, verschlüsselt mit einem Schlüssel, den nur dein Fingerabdruck öffnet. Kommt ein neuer Fingerabdruck dazu, ist sie gelöscht.',
    unavailable: {
      'none-enrolled': 'Richte zuerst in den Android-Einstellungen einen Fingerabdruck ein.',
      'no-hardware': 'Dieses Telefon hat keinen Fingerabdrucksensor, den Girovo nutzen kann.',
      'security-update': 'Der Fingerabdrucksensor braucht ein Sicherheitsupdate von Android.',
      unavailable: 'Der Fingerabdrucksensor ist gerade nicht verfügbar.',
    },
    enrollTitle: 'Fingerabdruck für Girovo',
    enrollSubtitle: (bank: string) => `Damit meldest du dich künftig bei ${bank} an.`,
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
    invalidated: 'Auf diesem Telefon ist ein neuer Fingerabdruck dazugekommen. Melde dich einmal mit deiner PIN an und schalte die Anmeldung mit Fingerabdruck dann wieder ein.',
    refused: 'Die Bank hat die gespeicherte PIN nicht angenommen. Sie ist gelöscht – melde dich mit deiner PIN an.',
  },

  /** The category guess with Gemini Nano (components/android: Einstellungen and the progress line). */
  categories: {
    title: 'Kategorien mit Gemini Nano',
    hint: 'Ordnet Umsätze zu, die die Regeln nicht erkennen – mit dem Sprachmodell von Android, nur auf diesem Telefon.',
    downloading: 'Android lädt Gemini Nano',
    downloadProgress: (got: string, total: string) => `${got} von ${total}`,
    downloadable: 'Android lädt Gemini Nano, sobald das Telefon so weit ist – oft erst im WLAN.',
    downloadNow: 'Jetzt laden',
    unsupported: 'Nicht unterstütztes Telefon',
    unsupportedHint: 'Dieses Telefon bietet Gemini Nano nicht an. Umsätze ordnen hier nur die Regeln zu.',
    update: 'Gemini Nano braucht ein Systemupdate. Installiere die neuesten Updates, dann ordnet Girovo auch hier zu.',
    aicore: 'Gemini Nano braucht eine neuere Version von Android AICore aus Google Play.',
    /** Under Umsätze and on Analyse while Nano works through the bookings. */
    working: 'Kategorien werden zugeordnet',
    count: (done: number, total: number) => `${done} von ${total}`,
    waiting: 'Wartet auf Gemini Nano',
  },

  /** The phone's integrity check (lib/device-integrity.ts): Einstellungen and the login. */
  integrity: {
    title: 'Gerätesicherheit',
    trusted: 'Geprüft von der Sicherheitshardware dieses Telefons: Android des Herstellers, Bootloader gesperrt.',
    custom: 'Auf diesem Telefon läuft ein eigenes Android mit gesperrtem Bootloader, etwa GrapheneOS. Die Sicherheitshardware bestätigt es – sicher, solange du diesem System vertraust.',
    modified: 'Dieses Telefon ist verändert: Der Bootloader ist entsperrt oder das System nicht geprüft. Eine App mit Root-Rechten könnte mitlesen, was du eintippst – auch deine PIN.',
    unknown: 'Dieses Telefon kann seinen Zustand nicht nachweisen, deshalb kann Girovo ihn nicht prüfen.',
    foreign: 'Diese Girovo-App ist nicht mit Girovos Schlüssel signiert. Lade Girovo nur von GitHub (elNino0916/Girovo) oder aus Google Play.',
    development: 'Ein Entwicklungs-Build: Seine Signatur wird nicht geprüft.',
    /** The login's warning, before the PIN is typed. */
    modifiedTitle: 'Dieses Telefon ist verändert',
    modifiedLogin: 'Der Bootloader ist entsperrt oder das System nicht geprüft. Eine App mit Root-Rechten könnte deine PIN mitlesen – melde dich nur an, wenn du diesem Telefon vertraust.',
    foreignTitle: 'Das ist nicht die offizielle Girovo-App',
    foreignLogin: 'Sie ist nicht mit Girovos Schlüssel signiert und könnte deine PIN weitergeben. Gib sie hier nicht ein, sondern lade Girovo von GitHub (elNino0916/Girovo) oder aus Google Play.',
  },

  updates: {
    install: 'Installieren',
    installs: 'Android fragt gleich, ob du die neue Version installieren willst. Girovo startet danach neu.',
    permission: 'Erlaube Girovo in den Android-Einstellungen, Apps zu installieren, und tippe dann noch einmal auf „Installieren“.',
    /** The Google Play build: Play brings updates. */
    play: 'Updates kommen über Google Play.',
    playAvailable: 'Bei Google Play gibt es eine neue Version von Girovo.',
    playUpdate: 'Über Google Play aktualisieren',
  },

  /** An invoice shared with Girovo (components/android/useLaunches.ts). */
  launch: {
    unreadable: 'Die geteilte Datei ließ sich nicht öffnen.',
  },

  /** Pull to refresh (components/android/PullToRefresh.tsx), for a screen reader. */
  refresh: {
    refreshing: 'Umsätze werden abgerufen',
  },

  /** The notification while an approval in the bank's app is awaited. */
  approval: {
    title: 'Warte auf deine Freigabe',
    text: 'Gib die Anfrage in deiner Banking-App frei – Girovo bleibt so lange mit deiner Bank verbunden.',
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
    hint: 'Your PIN is stored on this phone for this, encrypted with a key only your fingerprint opens. If a new fingerprint is added, it is deleted.',
    unavailable: {
      'none-enrolled': 'Set up a fingerprint in Android’s settings first.',
      'no-hardware': 'This phone has no fingerprint sensor Girovo can use.',
      'security-update': 'The fingerprint sensor needs a security update from Android.',
      unavailable: 'The fingerprint sensor isn’t available right now.',
    },
    enrollTitle: 'Fingerprint for Girovo',
    enrollSubtitle: (bank: string) => `You’ll use it to log in to ${bank} from now on.`,
    unlockTitle: 'Log in to Girovo',
    unlockSubtitle: (bank: string) => `${bank} · with your fingerprint`,
    usePin: 'Enter PIN',
    cancel: 'Cancel',
    loginButton: 'Log in with fingerprint',
    nowOn: 'Fingerprint login is on.',
    nowOff: 'Fingerprint login is off.',
    enrollFailed: 'Fingerprint login couldn’t be turned on.',
    invalidated: 'A new fingerprint was added on this phone. Log in once with your PIN, then turn fingerprint login back on.',
    refused: 'The bank didn’t accept the stored PIN. It has been deleted – log in with your PIN.',
  },

  categories: {
    title: 'Categories with Gemini Nano',
    hint: 'Sorts bookings the rules don’t recognise – with Android’s language model, only on this phone.',
    downloading: 'Android is downloading Gemini Nano',
    downloadProgress: (got: string, total: string) => `${got} of ${total}`,
    downloadable: 'Android downloads Gemini Nano once the phone is ready – often only on Wi-Fi.',
    downloadNow: 'Download now',
    unsupported: 'Unsupported phone',
    unsupportedHint: 'This phone doesn’t offer Gemini Nano. Here, only the rules sort bookings.',
    update: 'Gemini Nano needs a system update. Install the latest updates and Girovo sorts here too.',
    aicore: 'Gemini Nano needs a newer version of Android AICore from Google Play.',
    working: 'Assigning categories',
    count: (done: number, total: number) => `${done} of ${total}`,
    waiting: 'Waiting for Gemini Nano',
  },

  integrity: {
    title: 'Device security',
    trusted: "Checked by this phone's security hardware: the maker's Android, bootloader locked.",
    custom: "This phone runs its own Android with a locked bootloader, such as GrapheneOS. The security hardware confirms it – safe as long as you trust that system.",
    modified: 'This phone has been modified: the bootloader is unlocked or the system is not verified. An app with root rights could read what you type – your PIN too.',
    unknown: "This phone can't prove its state, so Girovo can't check it.",
    foreign: "This Girovo app isn't signed with Girovo's key. Only get Girovo from GitHub (elNino0916/Girovo) or Google Play.",
    development: "A development build: its signature isn't checked.",
    modifiedTitle: 'This phone has been modified',
    modifiedLogin: 'The bootloader is unlocked or the system is not verified. An app with root rights could read your PIN – only sign in if you trust this phone.',
    foreignTitle: "This isn't the official Girovo app",
    foreignLogin: "It isn't signed with Girovo's key and could pass your PIN on. Don't enter it here – get Girovo from GitHub (elNino0916/Girovo) or Google Play.",
  },

  updates: {
    install: 'Install',
    installs: 'Android will ask whether you want to install the new version. Girovo restarts afterwards.',
    permission: 'Allow Girovo to install apps in Android’s settings, then tap “Install” again.',
    play: 'Updates come through Google Play.',
    playAvailable: 'A new version of Girovo is on Google Play.',
    playUpdate: 'Update through Google Play',
  },

  launch: {
    unreadable: 'The shared file couldn’t be opened.',
  },

  refresh: {
    refreshing: 'Fetching transactions',
  },

  approval: {
    title: 'Waiting for your approval',
    text: 'Approve the request in your banking app – Girovo stays connected to your bank meanwhile.',
  },

  share: {
    giroCode: 'Share GiroCode',
    button: 'Share image',
  },
};
