// The Einstellungen page (components/settings/Settings.tsx) and the search
// entries that bring the user to one of its settings (components/CommandPalette.tsx).
// A row's own name is the Sitzung panel's where it was there before
// (session.ts, history.ts): the same setting keeps the same words.

import { APP_NAME } from '../../edition.ts';

export const de = {
  /** The pages the settings are sorted into (lib/settings-pages.ts), each shown on its own. */
  pages: {
    security: 'Anmeldung & Sicherheit',
    notifications: 'Benachrichtigungen',
    accounts: 'Konten & Umsätze',
    devices: 'Daten & Geräte',
    appearance: 'Sprache & Darstellung',
    privacy: 'Datenschutz',
    ask: 'Girovo AI',
    about: `Über ${APP_NAME}`,
  },
  /** The pages' names in the desktop's folded rail, under their glyphs: a word each. */
  pagesShort: {
    security: 'Sicherheit',
    notifications: 'Hinweise',
    accounts: 'Konten',
    devices: 'Daten',
    appearance: 'Darstellung',
    privacy: 'Datenschutz',
    ask: 'AI',
    about: 'Über',
  },
  /** Under each page's name in their list: what is on it, or how it is set. */
  summary: {
    fingerprint: 'Fingerabdruck',
    windowsHello: 'Windows Hello',
    idle: 'automatisches Abmelden',
    alertsOn: 'Neue Umsätze werden gemeldet',
    alertsOff: 'Aus',
    accounts: 'Kategorien, Umsätze und Salden behalten',
    sync: 'Abgleich',
    backup: 'Sicherung',
    kept: 'gespeicherte Daten',
    logos: 'Firmenlogos',
    usage: 'Nutzungsdaten',
    askOn: 'Antworten in ganzen Sätzen',
    askOff: 'Aus',
  },
  /** The subheaders inside a page. */
  groups: {
    signIn: 'Anmeldung',
    thisDevice: 'Dieses Gerät',
    balances: 'Salden',
    bookings: 'Umsätze',
    categories: 'Kategorien',
    updates: 'Updates',
    links: 'Kontakt & Rechtliches',
  },
  idleHint: 'Eine Minute vorher fragt Girovo nach, aber nie während einer Freigabe.',
  licence: 'Quellcode verfügbar unter der PolyForm Perimeter License 1.0.1',
  /** Über Girovo: the app's website (girovo.de) and its contact address. */
  website: 'Website',
  contact: 'Kontakt',
  /** For a screen reader, after a link that opens the mail app. */
  opensMail: '(öffnet die E-Mail-App)',
  source: 'Quellcode auf GitHub',
  privacyPolicy: 'Datenschutzerklärung',
  terms: 'Nutzungsbedingungen',
  /** The provider's legal notice (§ 5 DDG), on the website. */
  imprint: 'Impressum',
  /** The Sitzung panel's way here, and what it says when the saved data needs a look. */
  open: 'Einstellungen',
  /** Under a setting found in the search. */
  inSettings: 'In den Einstellungen',
  /** A setting's name in the search, where the page's row says it as a sentence. */
  find: {
    idle: 'Automatisch abmelden',
    device: 'Gerät merken',
  },
  /** 6.0: balances read after the login (a device's choice), and the last ones kept in the vault (lib/kept-balances.ts). */
  balances: {
    atLogin: 'Salden beim Anmelden abrufen',
    atLoginHint: 'Deine Bank fragt dafür vielleicht nach einer Freigabe.',
    keep: 'Letzte Salden behalten',
    keepHint: 'Die Übersicht zeigt sie sofort. Sie bleiben geschützt auf diesem Rechner.',
    deleted: 'Gespeicherte Salden gelöscht.',
  },
  /** 6.0: every shown account's Umsätze read after the login's own (a device's choice, on unless switched off). */
  bookingsAtLogin: {
    title: 'Umsätze beim Anmelden abrufen',
    hint: 'Für alle angezeigten Konten. Deine Bank fragt dafür vielleicht nach einer Freigabe.',
  },
  /**
   * 6.0, the desktop: the further banks log in with the first one — their PINs
   * kept beside it, opened by its PIN (lib/linked-unlock.ts; on Android the
   * fingerprint does it, android.biometric).
   */
  linkedUnlock: {
    title: 'Weitere Banken mit anmelden',
    hint: (bank: string) => `Deine PIN für ${bank} meldet dich auch bei deinen weiteren Banken an.`,
    /** The dialog that turns it on: the switch's, and the one a further bank's login offers. */
    askTitle: 'Weitere Banken mit anmelden?',
    askText: (bank: string) =>
      `Meldest du dich bei ${bank} an, meldet Girovo dich auch bei deinen weiteren Banken an. Ihre PINs bleiben geschützt auf diesem Rechner. Öffnen kann sie nur deine PIN für ${bank}.`,
    turnOn: 'Einschalten',
    notNow: 'Nicht jetzt',
    /** A toast after a further bank logged in with its PIN typed, while it is off. */
    offer: (bank: string) => `${bank} beim nächsten Mal gleich mit anmelden?`,
    offerAction: 'Einrichten …',
    nowOn: 'Deine weiteren Banken melden sich jetzt mit an.',
    /** On with no further bank logged in: none is kept until each one logs in once. */
    nowOnLater: 'Eingeschaltet. Melde dich einmal bei jeder weiteren Bank an. Danach geht es von selbst.',
    nowOff: 'Die PINs deiner weiteren Banken sind gelöscht.',
    sealed: (bank: string) => `${bank} meldet sich künftig mit an.`,
    /** Keeping one bank's PIN failed while it is on (no control to try again from). */
    sealFailed: (bank: string) => `Die PIN für ${bank} ließ sich nicht speichern.`,
    failed: 'Das hat nicht geklappt. Versuche es noch einmal.',
    /** The file no longer opened at the login (the first PIN changed at the bank, a new secret): deleted. */
    dropped: 'Die PINs deiner weiteren Banken ließen sich nicht mehr öffnen und sind gelöscht. „Weitere Banken mit anmelden“ ist aus.',
    /** In the dialogs of "Gerät vergessen" and "Gespeicherte Daten löschen", while it is on. */
    goesToo: 'Dabei werden auch die PINs deiner weiteren Banken gelöscht, und „Weitere Banken mit anmelden“ ist danach aus.',
    /** The add-bank sheet's note while it is on, in place of auth.privacy.note: this PIN is kept. */
    privacyNote: 'Die PIN dieser Bank bleibt geschützt auf diesem Rechner, damit sich die Bank mit anmeldet. Girovo verbindet sich direkt mit deiner Bank.',
    /** A kept PIN the bank refused: it is deleted, never tried twice. */
    refused: 'Die Bank hat die gespeicherte PIN nicht angenommen. Sie ist gelöscht. Melde dich mit deiner PIN an.',
  },
  /**
   * 6.0, Windows: Windows Hello in place of typing the first login's PIN
   * (lib/windows-hello.ts, src-tauri/src/hello.rs; on Android the
   * fingerprint does it, android.biometric). The further banks follow as
   * with a typed PIN (linkedUnlock).
   */
  windowsHello: {
    title: 'Mit Windows Hello anmelden',
    hint: (bank: string) => `Gesicht, Finger oder deine Windows-PIN statt deiner PIN für ${bank}.`,
    /** The login form's button. */
    loginButton: 'Mit Windows Hello anmelden',
    /** A toast after a login with the PIN typed, while it is off. */
    offer: (bank: string) => `Bei ${bank} nächstes Mal mit Windows Hello anmelden?`,
    offerAction: 'Einrichten',
    nowOn: 'Windows Hello ist an. Nächstes Mal reicht dein Gesicht, Finger oder deine Windows-PIN.',
    nowOff: 'Windows Hello ist aus, die gespeicherte PIN ist gelöscht.',
    failed: 'Windows Hello ließ sich nicht einrichten. Versuche es noch einmal.',
    /** Windows threw an error while setting it up (its HRESULT, "0x80090016"). */
    failedCode: (code: string) => `Windows Hello ließ sich nicht einrichten. Versuche es noch einmal (Fehler ${code}).`,
    /** Windows threw an error at the login form's gesture. */
    openFailedCode: (code: string) => `Windows Hello hat nicht geklappt. Melde dich mit deiner PIN an (Fehler ${code}).`,
    /**
     * Windows' own Windows Hello key storage is missing or damaged (0x80090011,
     * 0x80090016): no app gets a key until the Windows Hello PIN is set up anew.
     */
    brokenStore: (code: string) => `Windows Hello geht auf diesem Rechner gerade nicht. Entferne in Windows unter Einstellungen → Konten → Anmeldeoptionen die PIN und richte sie neu ein (Fehler ${code}).`,
    /** The Windows Hello key was replaced or is gone: the kept PIN went with it. */
    invalidated: 'Windows Hello hat sich geändert, die gespeicherte PIN ist gelöscht. Melde dich mit deiner PIN an und schalte es wieder ein.',
    /** A kept PIN the bank refused: it is deleted, never tried twice. */
    refused: 'Die Bank hat die gespeicherte PIN nicht angenommen. Sie ist gelöscht. Melde dich mit deiner PIN an.',
    /** In the dialogs of "Gerät vergessen" and "Gespeicherte Daten löschen", while it is on. */
    goesToo: 'Die PIN für Windows Hello wird dabei auch gelöscht.',
  },
  /** A YubiKey or other security key instead of the PIN (components/settings/SecurityKeys.tsx). */
  securityKeys: {
    title: 'Mit Sicherheitsschlüssel anmelden',
    hint: (bank: string) => `Ein YubiKey oder ähnlicher Schlüssel statt deiner PIN für ${bank}.`,
    count: (n: number) => (n === 1 ? '1 Schlüssel eingerichtet' : `${n} Schlüssel eingerichtet`),
    loginButton: 'Mit Sicherheitsschlüssel anmelden',
    dialogTitle: 'Sicherheitsschlüssel',
    dialogIntro: 'Steck den Schlüssel ein. Beim Hinzufügen fragt Windows zweimal danach.',
    none: 'Noch kein Schlüssel eingerichtet.',
    add: 'Schlüssel hinzufügen',
    addAnother: 'Weiteren Schlüssel hinzufügen',
    keyName: (n: number) => `Schlüssel ${n}`,
    added: (date: string) => `Hinzugefügt am ${date}`,
    remove: (name: string) => `${name} entfernen`,
    removeConfirm: 'Entfernen',
    rename: (name: string) => `${name} umbenennen`,
    nameLabel: 'Name des Schlüssels',
    namePlaceholder: 'z. B. Schlüsselbund',
    nowOn: 'Schlüssel eingerichtet. Nächstes Mal reicht er statt deiner PIN.',
    removed: 'Schlüssel entfernt, die dafür gespeicherte PIN ist gelöscht.',
    exists: 'Dieser Schlüssel ist schon eingerichtet.',
    unsupported: 'Dieser Schlüssel kann das nicht. Du brauchst einen mit FIDO2.',
    failed: 'Der Schlüssel ließ sich nicht einrichten. Versuche es noch einmal.',
    failedCode: (code: string) => `Der Schlüssel ließ sich nicht einrichten. Versuche es noch einmal (Fehler ${code}).`,
    openFailed: 'Der Schlüssel hat nicht geklappt. Melde dich mit deiner PIN an.',
    openFailedCode: (code: string) => `Der Schlüssel hat nicht geklappt. Melde dich mit deiner PIN an (Fehler ${code}).`,
    wrongKey: 'Das ist nicht der richtige Schlüssel.',
    /** A key that was reset: its copy of the PIN went with it. */
    gone: 'Dieser Schlüssel passt nicht mehr, die dafür gespeicherte PIN ist gelöscht. Melde dich mit deiner PIN an.',
    /** A kept PIN the bank refused: every key's copy is deleted, never tried twice. */
    refused: 'Die Bank hat die gespeicherte PIN nicht angenommen. Sie ist gelöscht. Melde dich mit deiner PIN an.',
    goesToo: 'Die PINs für deine Sicherheitsschlüssel werden dabei auch gelöscht.',
  },
  /**
   * Über Girovo → which releases the updater offers (components/settings/UpdateChannel.tsx;
   * the desktop app and the GitHub APK only). `stable` and `preview` are also the row's value;
   * `preview` is the channel of the nightly builds (.github/workflows/nightly.yml), named Nightly.
   */
  channel: {
    title: 'Update-Kanal',
    stable: 'Stabil',
    preview: 'Nightly',
    intro: 'Welche Updates du bekommst.',
    stableHint: 'Fertige Versionen. Empfohlen.',
    previewHint: 'Das Neueste, jede Nacht.',
    /** Under the choice. The desktop: back to "Stabil" offers the latest stable release, older as it may be. */
    note: 'Vorabversionen können Fehler haben. Zurück zu „Stabil“ geht jederzeit, auch auf eine ältere Version.',
    /** Android installs no older version over a newer one. */
    noteAndroid: 'Vorabversionen können Fehler haben. Gehst du zurück zu „Stabil“, kommt das nächste Update erst mit der nächsten stabilen Version.',
    /** Under the note while a channel that shares usage data (Nightly) is chosen, where the build can share them: choosing it is the yes. */
    usage: (channel: string) => `${channel} teilt Nutzungsdaten, nie Kontodaten.`,
    /** A copy on such a channel that does not share them yet is asked once per start (components/telemetry/NightlyUsage.tsx). */
    usageAsk: {
      title: (channel: string) => `${channel} teilt Nutzungsdaten`,
      text: 'Welche Bereiche du nutzt und ob Anmeldungen klappen, aber nie Kontodaten. Sonst geht es mit „Stabil“ weiter.',
      agree: 'Einverstanden',
      toStable: 'Zu „Stabil“ wechseln',
    },
    apply: 'Übernehmen',
  },

  /** Über Girovo → staged releases at once (components/settings/UpdateChannel.tsx EarlyUpdatesRow). */
  early: {
    title: 'Neueste Updates sofort erhalten',
    hint: 'Sobald sie verfügbar sind. Sonst kommen neue Versionen nach und nach.',
  },

  /** Über Girovo → a Setup.exe downloaded by hand (components/settings/UpdateChannel.tsx FromFileRow). */
  fromFile: {
    title: 'Update aus Datei installieren',
    hint: 'Eine Setup- oder Update-Datei von Girovo, auch eine ältere Version',
  },

  /**
   * Girovo Next: the page "Frag deine Umsätze" (components/settings/AskSettings.tsx).
   * The switch writes vault.askOff; the model row is what answers: Gemini Nano
   * where the phone has it, else the downloaded model. It turns on only once that model is here.
   */
  ask: {
    title: 'Girovo AI',
    hint: 'Antworten in ganzen Sätzen',
    /** The switch while the model is not here yet: on a phone, on the desktop. */
    needsModel: (phone: boolean): string => (phone ? 'Geht, sobald Gemini Nano bereit ist' : 'Lade zuerst das Modell unten'),
    group: 'Antworten',
    nano: 'Gemini Nano',
    nanoReady: 'Bereit',
    nanoDownloading: 'Android lädt es gerade',
    nanoDownloadable: 'Noch nicht geladen',
    model: 'Sprachmodell',
    /** Its size: on a phone, and on the desktop. */
    modelSize: (phone: boolean): string => (phone ? 'Etwa 2,6 GB' : 'Etwa 3 GB'),
    load: 'Laden',
    later: 'Kommt mit einer der nächsten Versionen.',
    /** The desktop's model (src-tauri/src/gemma.rs): where it comes from, said before it loads. */
    aiSize: 'Etwa 3,4 GB',
    aiSource: 'Lädt einmal von Hugging Face und GitHub.',
    aiLoading: (received: string, total: string) => `Lädt: ${received} von ${total}`,
    aiReady: 'Bereit',
    aiFailed: 'Das Laden hat nicht geklappt. Versuch es noch einmal.',
    retry: 'Erneut laden',
    /** A cancelled download goes on where it stopped. */
    resume: 'Weiter laden',
    cancel: 'Abbrechen',
    remove: 'Löschen',
  },

  /** Einstellungen → Dieses Gerät, the desktop app (components/settings/ResetApp.tsx, src-tauri/src/reset.rs). */
  resetApp: {
    row: 'Girovo zurücksetzen',
    rowHint: 'Alles löschen, was Girovo auf diesem Rechner gespeichert hat',
    title: 'Girovo zurücksetzen?',
    description: 'Girovo löscht alle seine Daten auf diesem Rechner und startet wie beim ersten Mal.',
    body: 'Banken, Vorlagen, Kontonamen, Kategorien, gespeicherte Umsätze, Sicherungen, Windows Hello und alle Einstellungen. Deine Banken fragen danach wieder nach einer Freigabe. Das lässt sich nicht rückgängig machen.',
    confirm: 'Zurücksetzen',
    failed: 'Girovo konnte nicht zurückgesetzt werden.',
    left: 'Girovo konnte nicht alles löschen. Versuch es gleich noch einmal.',
  },

  /** Einstellungen → Girovo AI, the desktop: cleaned names in the lists (components/insights/ai/AiNamesSetting.tsx). */
  aiNames: {
    title: 'Namen mit Girovo AI aufräumen',
    hint: 'Zeigt Rewe statt REWE MARKT GMBH 4711',
    needsModel: 'Lade zuerst das Modell unten',
    /** While the names are cleaned in the background. */
    progress: (done: number, total: number) => `${done} von ${total} Namen aufgeräumt`,
  },
};

export const en: typeof de = {
  pages: {
    security: 'Sign-in & security',
    notifications: 'Notifications',
    accounts: 'Accounts & transactions',
    devices: 'Data & devices',
    appearance: 'Language & appearance',
    privacy: 'Privacy',
    ask: 'Girovo AI',
    about: `About ${APP_NAME}`,
  },
  pagesShort: {
    security: 'Security',
    notifications: 'Alerts',
    accounts: 'Accounts',
    devices: 'Data',
    appearance: 'Appearance',
    privacy: 'Privacy',
    ask: 'AI',
    about: 'About',
  },
  summary: {
    fingerprint: 'Fingerprint',
    windowsHello: 'Windows Hello',
    idle: 'automatic logout',
    alertsOn: 'New transactions are reported',
    alertsOff: 'Off',
    accounts: 'Categories, keeping transactions and balances',
    sync: 'Sync',
    backup: 'Backup',
    kept: 'saved data',
    logos: 'Company logos',
    usage: 'Usage data',
    askOn: 'Answers in full sentences',
    askOff: 'Off',
  },
  groups: {
    signIn: 'Sign-in',
    thisDevice: 'This device',
    balances: 'Balances',
    bookings: 'Transactions',
    categories: 'Categories',
    updates: 'Updates',
    links: 'Contact & legal',
  },
  idleHint: 'Girovo asks a minute before, but never during an approval.',
  licence: 'Source available under the PolyForm Perimeter License 1.0.1',
  website: 'Website',
  contact: 'Contact',
  opensMail: '(opens your e-mail app)',
  source: 'Source code on GitHub',
  privacyPolicy: 'Privacy policy',
  terms: 'Terms of use',
  imprint: 'Legal notice',
  open: 'Settings',
  inSettings: 'In Settings',
  find: {
    idle: 'Automatic logout',
    device: 'Remember this device',
  },
  balances: {
    atLogin: 'Load balances when logging in',
    atLoginHint: 'Your bank may ask for an approval for this.',
    keep: 'Keep the last balances',
    keepHint: 'The overview shows them straight away. They stay protected on this computer.',
    deleted: 'Kept balances deleted.',
  },
  bookingsAtLogin: {
    title: 'Load transactions when logging in',
    hint: 'For every account shown. Your bank may ask for an approval for this.',
  },
  linkedUnlock: {
    title: 'Log in to further banks too',
    hint: (bank) => `Your PIN for ${bank} logs you in to your further banks too.`,
    askTitle: 'Log in to further banks too?',
    askText: (bank) =>
      `When you log in to ${bank}, Girovo logs you in to your further banks too. Their PINs stay protected on this computer. Only your PIN for ${bank} opens them.`,
    turnOn: 'Turn on',
    notNow: 'Not now',
    offer: (bank) => `Log in to ${bank} automatically next time?`,
    offerAction: 'Set up…',
    nowOn: 'Your further banks now log in too.',
    nowOnLater: 'On. Log in to each further bank once. After that it happens by itself.',
    nowOff: 'Your further banks’ PINs have been deleted.',
    sealed: (bank) => `${bank} will now log in too.`,
    sealFailed: (bank) => `Your PIN for ${bank} couldn’t be saved.`,
    failed: 'That didn’t work. Please try again.',
    dropped: 'Your further banks’ PINs could no longer be opened and have been deleted. “Log in to further banks too” is off.',
    goesToo: 'This also deletes your further banks’ PINs, and “Log in to further banks too” is then off.',
    privacyNote: 'This bank’s PIN stays protected on this computer so the bank can log in too. Girovo connects straight to your bank.',
    refused: 'The bank didn’t accept the saved PIN. It has been deleted. Log in with your PIN.',
  },
  windowsHello: {
    title: 'Log in with Windows Hello',
    hint: (bank) => `Your face, finger or Windows PIN instead of your PIN for ${bank}.`,
    loginButton: 'Log in with Windows Hello',
    offer: (bank) => `Log in to ${bank} with Windows Hello next time?`,
    offerAction: 'Set up',
    nowOn: 'Windows Hello is on. Next time your face, finger or Windows PIN is enough.',
    nowOff: 'Windows Hello is off, the saved PIN has been deleted.',
    failed: 'Windows Hello couldn’t be set up. Please try again.',
    failedCode: (code) => `Windows Hello couldn’t be set up. Try again (error ${code}).`,
    openFailedCode: (code) => `Windows Hello didn’t work. Log in with your PIN (error ${code}).`,
    brokenStore: (code) => `Windows Hello isn’t working on this computer right now. In Windows, go to Settings → Accounts → Sign-in options, remove your PIN and set it up again (error ${code}).`,
    invalidated: 'Windows Hello has changed, so the saved PIN has been deleted. Log in with your PIN and turn it on again.',
    refused: 'The bank didn’t accept the saved PIN. It has been deleted. Log in with your PIN.',
    goesToo: 'This also deletes the PIN saved for Windows Hello.',
  },
  securityKeys: {
    title: 'Log in with a security key',
    hint: (bank) => `A YubiKey or similar key instead of your PIN for ${bank}.`,
    count: (n) => (n === 1 ? '1 key set up' : `${n} keys set up`),
    loginButton: 'Log in with a security key',
    dialogTitle: 'Security keys',
    dialogIntro: 'Plug in your key. When adding one, Windows asks for it twice.',
    none: 'No key set up yet.',
    add: 'Add key',
    addAnother: 'Add another key',
    keyName: (n) => `Key ${n}`,
    added: (date) => `Added on ${date}`,
    remove: (name) => `Remove ${name}`,
    removeConfirm: 'Remove',
    rename: (name) => `Rename ${name}`,
    nameLabel: 'Key name',
    namePlaceholder: 'e.g. Keyring',
    nowOn: 'Key set up. Next time it replaces your PIN.',
    removed: 'Key removed, and the PIN saved for it is deleted.',
    exists: 'This key is already set up.',
    unsupported: 'This key can’t do that. You need one with FIDO2.',
    failed: 'The key couldn’t be set up. Please try again.',
    failedCode: (code) => `The key couldn’t be set up. Try again (error ${code}).`,
    openFailed: 'The key didn’t work. Log in with your PIN.',
    openFailedCode: (code) => `The key didn’t work. Log in with your PIN (error ${code}).`,
    wrongKey: 'That’s not the right key.',
    gone: 'This key no longer fits, so the PIN saved for it has been deleted. Log in with your PIN.',
    refused: 'The bank didn’t accept the saved PIN. It has been deleted. Log in with your PIN.',
    goesToo: 'This also deletes the PINs saved for your security keys.',
  },
  channel: {
    title: 'Update channel',
    stable: 'Stable',
    preview: 'Nightly',
    intro: 'Which updates you get.',
    stableHint: 'Finished versions. Recommended.',
    previewHint: 'The latest, every night.',
    note: 'Pre-releases may have bugs. You can go back to “Stable” at any time, even to an older version.',
    noteAndroid: 'Pre-releases may have bugs. If you go back to “Stable”, the next update comes only with the next stable version.',
    usage: (channel) => `${channel} shares usage data, never account data.`,
    usageAsk: {
      title: (channel) => `${channel} shares usage data`,
      text: 'Which parts you use and whether logins work, but never account data. Otherwise you carry on with “Stable”.',
      agree: 'Agree',
      toStable: 'Switch to “Stable”',
    },
    apply: 'Apply',
  },

  early: {
    title: 'Get the latest updates right away',
    hint: 'As soon as they’re available. Otherwise new versions arrive gradually.',
  },

  fromFile: {
    title: 'Install an update from a file',
    hint: 'A Girovo setup or update file, an older version too',
  },

  ask: {
    title: 'Girovo AI',
    hint: 'Answers in full sentences',
    needsModel: (phone) => (phone ? 'Works once Gemini Nano is ready' : 'Download the model below first'),
    group: 'Answers',
    nano: 'Gemini Nano',
    nanoReady: 'Ready',
    nanoDownloading: 'Android is downloading it',
    nanoDownloadable: 'Not downloaded yet',
    model: 'Language model',
    modelSize: (phone) => (phone ? 'About 2.6 GB' : 'About 3 GB'),
    load: 'Download',
    later: 'Coming in one of the next versions.',
    aiSize: 'About 3.4 GB',
    aiSource: 'Downloads once from Hugging Face and GitHub.',
    aiLoading: (received, total) => `Downloading: ${received} of ${total}`,
    aiReady: 'Ready',
    aiFailed: 'The download didn\u2019t work. Try again.',
    retry: 'Download again',
    resume: 'Continue',
    cancel: 'Cancel',
    remove: 'Delete',
  },

  resetApp: {
    row: 'Reset Girovo',
    rowHint: 'Delete everything Girovo has saved on this computer',
    title: 'Reset Girovo?',
    description: 'Girovo deletes all its data on this computer and starts as if for the first time.',
    body: 'Banks, templates, account names, categories, saved transactions, backups, Windows Hello and all settings. Your banks will ask for an approval again afterwards. This can’t be undone.',
    confirm: 'Reset',
    failed: 'Girovo couldn’t be reset.',
    left: 'Girovo couldn’t delete everything. Try again in a moment.',
  },

  aiNames: {
    title: 'Tidy names with Girovo AI',
    hint: 'Shows Rewe instead of REWE MARKT GMBH 4711',
    needsModel: 'Download the model below first',
    progress: (done, total) => `${done} of ${total} names tidied`,
  },
};
