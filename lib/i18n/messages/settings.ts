// The Einstellungen page (components/settings/Settings.tsx) and the search
// entries that bring the user to one of its settings (components/CommandPalette.tsx).
// A row's own name is the Sitzung panel's where it was there before
// (session.ts, history.ts): the same setting keeps the same words.

export const de = {
  sections: {
    general: 'Allgemein',
    privacy: 'Datenschutz',
    about: 'Über Girovo',
  },
  idleHint: 'Ohne Eingabe meldet Girovo dich nach dieser Zeit ab. Eine Minute vorher fragt es nach – während einer Freigabe nie.',
  licence: 'Freie Software unter der MIT-Lizenz',
  source: 'Quellcode auf GitHub',
  privacyPolicy: 'Datenschutzerklärung',
  /** The Sitzung panel's way here, and what it says when the saved data needs a look. */
  open: 'Einstellungen',
  /** Under a setting found in the search. */
  inSettings: 'In den Einstellungen',
  /** A setting's name in the search, where the page's row says it as a sentence. */
  find: {
    idle: 'Automatisch abmelden',
    device: 'Gerät merken',
  },
};

export const en: typeof de = {
  sections: {
    general: 'General',
    privacy: 'Privacy',
    about: 'About Girovo',
  },
  idleHint: 'Without input, Girovo logs you out after this time. It asks a minute before – never during an approval.',
  licence: 'Free software under the MIT licence',
  source: 'Source code on GitHub',
  privacyPolicy: 'Privacy policy',
  open: 'Settings',
  inSettings: 'In Settings',
  find: {
    idle: 'Automatic logout',
    device: 'Remember this device',
  },
};
