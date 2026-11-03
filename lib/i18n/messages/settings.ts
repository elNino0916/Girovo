// The Einstellungen page (components/settings/Settings.tsx) and the search
// entries that bring the user to one of its settings (components/CommandPalette.tsx).
// A row's own name is the Sitzung panel's where it was there before
// (session.ts, history.ts): the same setting keeps the same words.

export const de = {
  sections: {
    general: 'Allgemein',
    /** The phone's integrity, fingerprint login, the remembered device. */
    security: 'Sicherheit',
    /** Gemini Nano and the user's own categories. */
    categories: 'Kategorien',
    privacy: 'Datenschutz',
    about: 'Über Girovo',
  },
  idleHint: 'Eine Minute vorher fragt Girovo nach – während einer Freigabe nie.',
  licence: 'Freie Software unter der MIT-Lizenz',
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
  /**
   * Über Girovo → which releases the updater offers (components/settings/UpdateChannel.tsx;
   * the desktop app and the GitHub APK only). `stable` and `preview` are also the row's value.
   */
  channel: {
    title: 'Update-Kanal',
    stable: 'Stabil',
    preview: '6.0-Vorschau',
    intro: 'Welche Updates du bekommst.',
    stableHint: 'Fertige Versionen. Empfohlen.',
    previewHint: 'Was in Girovo 6.0 kommt, schon vorab.',
    /** Under the choice. The desktop: back to "Stabil" offers the latest stable release, older as it may be. */
    note: 'Vorschauen sind noch nicht fertig und können Fehler haben. Zurück zu „Stabil“ kannst du jederzeit – du bekommst dann die aktuelle stabile Version, auch wenn sie älter ist.',
    /** Android installs no older version over a newer one. */
    noteAndroid: 'Vorschauen sind noch nicht fertig und können Fehler haben. Gehst du zurück zu „Stabil“, kommt dein nächstes Update mit der nächsten stabilen Version – eine ältere kann Android nicht installieren.',
    apply: 'Übernehmen',
  },
};

export const en: typeof de = {
  sections: {
    general: 'General',
    security: 'Security',
    categories: 'Categories',
    privacy: 'Privacy',
    about: 'About Girovo',
  },
  idleHint: 'Girovo asks a minute before – never during an approval.',
  licence: 'Free software under the MIT licence',
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
  channel: {
    title: 'Update channel',
    stable: 'Stable',
    preview: '6.0 preview',
    intro: 'Which updates you get.',
    stableHint: 'Finished versions. Recommended.',
    previewHint: 'What’s coming in Girovo 6.0, ahead of time.',
    note: 'Previews aren’t finished and may have bugs. You can go back to “Stable” at any time – you’ll then get the current stable version, even if it’s older.',
    noteAndroid: 'Previews aren’t finished and may have bugs. If you go back to “Stable”, your next update is the next stable version – Android can’t install an older one.',
    apply: 'Apply',
  },
};
