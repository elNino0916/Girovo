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
    intro: 'Welche Versionen dir Girovo zum Update anbietet.',
    stableHint: 'Nur fertige Versionen. Empfohlen.',
    previewHint: 'Auch Vorabversionen von Girovo 6.0, sobald es sie gibt.',
    unstable: 'Vorschauversionen sind noch nicht fertig: Sie können Fehler haben, und bis zur fertigen Version ändert sich manches noch.',
    back: 'Zurück zu „Stabil“ geht jederzeit – Girovo bietet dir dann aber erst die nächste stabile Version an, die höher ist als deine installierte.',
    noOlder: 'Eine ältere Version installiert das Update nicht.',
    noOlderAndroid: 'Eine ältere Version kann Android nicht über eine neuere installieren.',
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
    intro: 'Which versions Girovo offers you as updates.',
    stableHint: 'Finished versions only. Recommended.',
    previewHint: 'Also early versions of Girovo 6.0, as soon as there are any.',
    unstable: 'Preview versions aren’t finished: they can have bugs, and some things will still change before the final version.',
    back: 'You can go back to “Stable” at any time – but Girovo will then only offer you the next stable version that’s higher than the one installed.',
    noOlder: 'The update won’t install an older version.',
    noOlderAndroid: 'Android can’t install an older version over a newer one.',
    apply: 'Apply',
  },
};
