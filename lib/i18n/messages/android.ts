// What only the Android app says: fingerprint login, the category
// model as a download, its updates (components/android, mobile/bridges).

export const de = {
  biometric: {
    /** The switch in the Sitzung panel. */
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

  model: {
    title: 'Textmodell für Kategorien',
    hint: 'Ordnet Umsätze zu, die die Regeln nicht erkennen. Einmal rund 300 MB von Hugging Face; danach läuft es nur auf diesem Telefon.',
    download: 'Herunterladen',
    size: 'rund 300 MB, am besten im WLAN',
    progress: (got: string, total: string) => `${got} von ${total}`,
    cancel: 'Abbrechen',
    installed: 'Installiert und geprüft.',
    remove: 'Entfernen',
    failed: 'Der Download hat nicht geklappt. Versuch es später noch einmal.',
    removed: 'Das Textmodell ist entfernt. Die Regeln ordnen weiter zu.',
    ready: 'Das Textmodell ist geladen und geprüft.',
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

  /** The notification while an approval in the bank's app is awaited. */
  approval: {
    title: 'Warte auf deine Freigabe',
    text: 'Gib den Auftrag in deiner Banking-App frei – Girovo bleibt so lange mit deiner Bank verbunden.',
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

  model: {
    title: 'Text model for categories',
    hint: 'Sorts bookings the rules don’t recognise. Around 300 MB from Hugging Face, once; after that it runs only on this phone.',
    download: 'Download',
    size: 'around 300 MB, ideally over Wi-Fi',
    progress: (got: string, total: string) => `${got} of ${total}`,
    cancel: 'Cancel',
    installed: 'Installed and verified.',
    remove: 'Remove',
    failed: 'The download didn’t work. Try again later.',
    removed: 'The text model has been removed. The rules keep sorting.',
    ready: 'The text model is downloaded and verified.',
  },

  updates: {
    install: 'Install',
    installs: 'Android will ask whether you want to install the new version. Girovo restarts afterwards.',
    permission: 'Allow Girovo to install apps in Android’s settings, then tap “Install” again.',
    play: 'Updates come through Google Play.',
    playAvailable: 'A new version of Girovo is on Google Play.',
    playUpdate: 'Update through Google Play',
  },

  approval: {
    title: 'Waiting for your approval',
    text: 'Approve it in your banking app – Girovo stays connected to your bank meanwhile.',
  },

  share: {
    giroCode: 'Share GiroCode',
    button: 'Share image',
  },
};
