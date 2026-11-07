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
    /** Android: the phone's own light and dark, so the page holds the language alone. */
    language: 'Sprache',
    privacy: 'Datenschutz',
    about: `Über ${APP_NAME}`,
  },
  /** The pages' names in the desktop's folded rail, under their glyphs: a word each. */
  pagesShort: {
    security: 'Sicherheit',
    notifications: 'Hinweise',
    accounts: 'Konten',
    devices: 'Daten',
    appearance: 'Darstellung',
    language: 'Sprache',
    privacy: 'Datenschutz',
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
  idleHint: 'Eine Minute vorher fragt Girovo nach – während einer Freigabe nie.',
  licence: 'Quellcode verfügbar unter der PolyForm Perimeter License 1.0.1',
  /** Über Girovo: the app's website (girovo.de) and its contact address. */
  website: 'Website',
  contact: 'Kontakt',
  /** For a screen reader, after a link that opens the mail app. */
  opensMail: '(öffnet die E-Mail-App)',
  source: 'Quellcode auf GitHub',
  privacyPolicy: 'Datenschutzerklärung',
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
    atLoginHint: 'Nach der Anmeldung liest Girovo jeden Saldo – das kann eine Freigabe erfordern.',
    keep: 'Letzte Salden behalten',
    keepHint: 'Die Übersicht zeigt sie gleich, mit ihrem Stand. Verschlüsselt auf diesem Rechner.',
    deleted: 'Gespeicherte Salden gelöscht.',
  },
  /** 6.0: every shown account's Umsätze read after the login's own (a device's choice, on unless switched off). */
  bookingsAtLogin: {
    title: 'Umsätze beim Anmelden abrufen',
    hint: 'Nach der Anmeldung liest Girovo die Umsätze jedes angezeigten Kontos – das kann eine Freigabe erfordern.',
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
      `Meldest du dich bei ${bank} an, meldet Girovo dich auch bei deinen weiteren Banken an – bei denen, die jetzt angemeldet sind, und bei jeder, bei der du dich später anmeldest. Ihre PINs liegen dafür verschlüsselt auf diesem Rechner. Öffnen kann sie nur deine PIN für ${bank}, in deinem Benutzerkonto.`,
    turnOn: 'Einschalten',
    notNow: 'Nicht jetzt',
    /** A toast after a further bank logged in with its PIN typed, while it is off. */
    offer: (bank: string) => `${bank} beim nächsten Mal gleich mit anmelden?`,
    offerAction: 'Einrichten …',
    nowOn: 'Deine weiteren Banken melden sich jetzt mit an.',
    /** On with no further bank logged in: none is kept until each one logs in once. */
    nowOnLater: 'Eingeschaltet. Melde dich einmal bei deinen weiteren Banken an – danach melden sie sich mit an.',
    nowOff: 'Die PINs deiner weiteren Banken sind gelöscht.',
    sealed: (bank: string) => `${bank} meldet sich künftig mit an.`,
    /** Keeping one bank's PIN failed while it is on (no control to try again from). */
    sealFailed: (bank: string) => `Die PIN für ${bank} ließ sich nicht speichern.`,
    failed: 'Das hat nicht geklappt. Versuche es noch einmal.',
    /** The file no longer opened at the login (the first PIN changed at the bank, a new secret): deleted. */
    dropped: 'Die gespeicherten PINs deiner weiteren Banken ließen sich nicht mehr öffnen und sind gelöscht. „Weitere Banken mit anmelden“ ist aus.',
    /** In the dialogs of "Gerät vergessen" and "Gespeicherte Daten löschen", while it is on. */
    goesToo: 'Dabei werden auch die PINs deiner weiteren Banken gelöscht – „Weitere Banken mit anmelden“ ist danach aus.',
    /** The add-bank sheet's note while it is on, in place of auth.privacy.note: this PIN is kept. */
    privacyNote: 'Mit „Weitere Banken mit anmelden“ bleibt die PIN dieser Bank verschlüsselt auf diesem Rechner, die Verbindung läuft direkt zu deiner Bank. Nach der Anmeldung merkt sich die App dieses Gerät, mit deiner PIN verschlüsselt.',
    /** A kept PIN the bank refused: it is deleted, never tried twice. */
    refused: 'Die Bank hat die gespeicherte PIN nicht angenommen. Sie ist gelöscht – melde dich mit deiner PIN an.',
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
    nowOn: 'Windows Hello ist an. Beim nächsten Mal genügt dein Gesicht, dein Finger oder deine Windows-PIN.',
    nowOff: 'Windows Hello ist aus, die gespeicherte PIN ist gelöscht.',
    failed: 'Windows Hello ließ sich nicht einrichten. Versuche es noch einmal.',
    /** Windows threw an error while setting it up (its HRESULT, "0x80090016"). */
    failedCode: (code: string) => `Windows Hello ließ sich nicht einrichten. Windows meldet den Fehler ${code}.`,
    /** Windows threw an error at the login form's gesture. */
    openFailedCode: (code: string) => `Windows Hello hat nicht geklappt, Windows meldet den Fehler ${code}. Melde dich mit deiner PIN an.`,
    /**
     * Windows' own Windows Hello key storage is missing or damaged (0x80090011,
     * 0x80090016): no app gets a key until the Windows Hello PIN is set up anew.
     */
    brokenStore: (code: string) => `Windows findet seinen Speicher für Windows Hello nicht (Fehler ${code}). Das lässt sich in Windows beheben: unter Einstellungen → Konten → Anmeldeoptionen die PIN entfernen und neu einrichten. Danach versuche es hier noch einmal.`,
    /** The Windows Hello key was replaced or is gone: the kept PIN went with it. */
    invalidated: 'Windows Hello hat sich geändert, die gespeicherte PIN ist gelöscht. Melde dich mit deiner PIN an und schalte es danach wieder ein.',
    /** A kept PIN the bank refused: it is deleted, never tried twice. */
    refused: 'Die Bank hat die gespeicherte PIN nicht angenommen. Sie ist gelöscht – melde dich mit deiner PIN an.',
    /** In the dialogs of "Gerät vergessen" and "Gespeicherte Daten löschen", while it is on. */
    goesToo: 'Die PIN für Windows Hello wird dabei auch gelöscht.',
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
    previewHint: 'Der neueste Stand, jede Nacht gebaut.',
    /** Under the choice. The desktop: back to "Stabil" offers the latest stable release, older as it may be. */
    note: 'Nightlies sind noch nicht fertig und können Fehler haben. Zurück zu „Stabil“ kannst du jederzeit – du bekommst dann die aktuelle stabile Version, auch wenn sie älter ist.',
    /** Android installs no older version over a newer one. */
    noteAndroid: 'Nightlies sind noch nicht fertig und können Fehler haben. Gehst du zurück zu „Stabil“, kommt dein nächstes Update mit der nächsten stabilen Version – eine ältere kann Android nicht installieren.',
    apply: 'Übernehmen',
  },

  /** Über Girovo → staged releases at once (components/settings/UpdateChannel.tsx EarlyUpdatesRow). */
  early: {
    title: 'Neueste Updates sofort erhalten',
    hint: 'Sobald sie verfügbar sind – sonst kommen neue Versionen nach und nach.',
  },

  /** Über Girovo → a Setup.exe downloaded by hand (components/settings/UpdateChannel.tsx FromFileRow). */
  fromFile: {
    title: 'Update aus Datei installieren',
    hint: 'Eine heruntergeladene Setup-Datei von Girovo, auch eine ältere Version',
  },

  /** Einstellungen → Dieses Gerät, the desktop app (components/settings/ResetApp.tsx, src-tauri/src/reset.rs). */
  resetApp: {
    row: 'Girovo zurücksetzen',
    rowHint: 'Alles löschen, was Girovo auf diesem Rechner gespeichert hat',
    title: 'Girovo zurücksetzen?',
    description: 'Girovo löscht alles, was es auf diesem Rechner gespeichert hat, und startet neu wie beim ersten Mal.',
    body: 'Deine Banken, Vorlagen, Kontonamen, Kategorien, gespeicherten Umsätze und Sicherungen, Windows Hello und alle Einstellungen. Deine Banken fragen danach wieder nach einer Freigabe. Das lässt sich nicht rückgängig machen.',
    confirm: 'Zurücksetzen',
    failed: 'Girovo konnte nicht zurückgesetzt werden.',
  },
};

export const en: typeof de = {
  pages: {
    security: 'Sign-in & security',
    notifications: 'Notifications',
    accounts: 'Accounts & transactions',
    devices: 'Data & devices',
    appearance: 'Language & appearance',
    language: 'Language',
    privacy: 'Privacy',
    about: `About ${APP_NAME}`,
  },
  pagesShort: {
    security: 'Security',
    notifications: 'Alerts',
    accounts: 'Accounts',
    devices: 'Data',
    appearance: 'Appearance',
    language: 'Language',
    privacy: 'Privacy',
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
  idleHint: 'Girovo asks a minute before – never during an approval.',
  licence: 'Source available under the PolyForm Perimeter License 1.0.1',
  website: 'Website',
  contact: 'Contact',
  opensMail: '(opens your e-mail app)',
  source: 'Source code on GitHub',
  privacyPolicy: 'Privacy policy',
  imprint: 'Legal notice',
  open: 'Settings',
  inSettings: 'In Settings',
  find: {
    idle: 'Automatic logout',
    device: 'Remember this device',
  },
  balances: {
    atLogin: 'Load balances when logging in',
    atLoginHint: 'After logging in, Girovo loads every balance – this may need an approval.',
    keep: 'Keep the last balances',
    keepHint: 'The overview shows them straight away, with when they were loaded. Encrypted on this computer.',
    deleted: 'Kept balances deleted.',
  },
  bookingsAtLogin: {
    title: 'Load transactions when logging in',
    hint: 'After logging in, Girovo loads the transactions of every account shown – this may need an approval.',
  },
  linkedUnlock: {
    title: 'Log in to further banks too',
    hint: (bank) => `Your PIN for ${bank} logs you in to your further banks too.`,
    askTitle: 'Log in to further banks too?',
    askText: (bank) =>
      `When you log in to ${bank}, Girovo logs you in to your further banks too – those logged in now and each one you log in to later. Their PINs are kept encrypted on this computer for that. Only your PIN for ${bank} opens them, in your user account.`,
    turnOn: 'Turn on',
    notNow: 'Not now',
    offer: (bank) => `Log in to ${bank} automatically next time?`,
    offerAction: 'Set up…',
    nowOn: 'Your further banks now log in too.',
    nowOnLater: 'On. Log in to your further banks once – from then on they log in too.',
    nowOff: 'Your further banks’ PINs have been deleted.',
    sealed: (bank) => `${bank} will now log in too.`,
    sealFailed: (bank) => `Your PIN for ${bank} couldn’t be saved.`,
    failed: 'That didn’t work. Please try again.',
    dropped: 'Your further banks’ saved PINs could no longer be opened and have been deleted. “Log in to further banks too” is off.',
    goesToo: 'This also deletes your further banks’ PINs – “Log in to further banks too” is then off.',
    privacyNote: 'With “Log in to further banks too” on, this bank’s PIN is kept encrypted on this computer, and the connection runs straight to your bank. After you log in, the app remembers this device, encrypted with your PIN.',
    refused: 'The bank didn’t accept the saved PIN. It has been deleted – log in with your PIN.',
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
    failedCode: (code) => `Windows Hello couldn’t be set up. Windows reports error ${code}.`,
    openFailedCode: (code) => `Windows Hello didn’t work, Windows reports error ${code}. Log in with your PIN.`,
    brokenStore: (code) => `Windows can’t find its Windows Hello storage (error ${code}). This can be fixed in Windows: under Settings → Accounts → Sign-in options, remove your PIN and set it up again. Then try again here.`,
    invalidated: 'Windows Hello has changed, so the saved PIN has been deleted. Log in with your PIN and turn it on again afterwards.',
    refused: 'The bank didn’t accept the saved PIN. It has been deleted – log in with your PIN.',
    goesToo: 'This also deletes the PIN saved for Windows Hello.',
  },
  channel: {
    title: 'Update channel',
    stable: 'Stable',
    preview: 'Nightly',
    intro: 'Which updates you get.',
    stableHint: 'Finished versions. Recommended.',
    previewHint: 'The latest state, built every night.',
    note: 'Nightlies aren’t finished and may have bugs. You can go back to “Stable” at any time – you’ll then get the current stable version, even if it’s older.',
    noteAndroid: 'Nightlies aren’t finished and may have bugs. If you go back to “Stable”, your next update is the next stable version – Android can’t install an older one.',
    apply: 'Apply',
  },

  early: {
    title: 'Get the latest updates right away',
    hint: 'As soon as they’re available – otherwise new versions arrive gradually.',
  },

  fromFile: {
    title: 'Install an update from a file',
    hint: 'A Girovo setup file you downloaded, an older version too',
  },

  resetApp: {
    row: 'Reset Girovo',
    rowHint: 'Delete everything Girovo has saved on this computer',
    title: 'Reset Girovo?',
    description: 'Girovo deletes everything it has saved on this computer and starts again as if for the first time.',
    body: 'Your banks, templates, account names, categories, saved transactions and backups, Windows Hello and all settings. Your banks will ask for an approval again afterwards. This can’t be undone.',
    confirm: 'Reset',
    failed: 'Girovo couldn’t be reset.',
  },
};
