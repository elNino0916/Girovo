// The profile chip and its Sitzung panel (components/shell/ProfileMenu.tsx):
// who is logged in, the settings, this computer, and the dialogs it opens.

import type { ReactNode } from 'react';
import type { AvatarId } from '../../avatars';

export const de = {
  /** The chip's accessible name: whose session, and an unreadable store if there is one. */
  chip: (holder: string, vaultBroken: boolean) =>
    (holder ? `Sitzung von ${holder}` : 'Sitzung') + (vaultBroken ? ' – gespeicherte Daten nicht lesbar' : ''),
  panel: 'Sitzung',
  /** Under the holder's name when the bank is not known. */
  loggedIn: 'Angemeldet',
  /** "Seit 18:41 Uhr · Abmeldung in 9:51" — the countdown comes in as its own element. */
  sinceAndLogout: (since: string, countdown: ReactNode): ReactNode[] => [`Seit ${since} · Abmeldung in `, countdown],

  settings: 'Einstellungen',
  idle: 'Automatisch abmelden nach',
  idleOption: (minutes: number) => `${minutes} Min`,
  language: 'Sprache',
  logos: 'Firmenlogos',
  logosHint: 'Nur Firmennamen gehen an Brandfetch, das dabei deine IP-Adresse sieht.',
  usage: 'Nutzungsdaten teilen',
  usageHint: 'Welche Bereiche du nutzt – nie Kontodaten. Fehlerberichte gehen immer.',
  /** Beside "Tastenkürzel" when the single-key shortcuts are switched off. */
  singleKeysOff: 'Einzeltasten aus',

  thisComputer: 'Auf diesem Rechner',
  deviceRemembered: 'Gerät gemerkt',
  deviceRememberedHint: 'Deine Bank fragt seltener nach einer Freigabe.',
  deviceNotRemembered: 'Gerät nicht gemerkt',
  deviceNotRememberedHint: 'Bei der nächsten Anmeldung fragt deine Bank nach einer Freigabe.',
  forget: 'Vergessen …',
  vault: 'Gespeicherte Daten',
  vaultHint: 'Verschlüsselt auf diesem Rechner',
  vaultDelete: 'Löschen …',
  vaultUnreadable: 'Gespeicherte Daten nicht lesbar',
  vaultUnreadableHint: 'Meist, weil sich deine PIN geändert hat. Was du jetzt änderst, wird nicht gespeichert.',
  vaultReset: 'Zurücksetzen …',
  vaultUnavailable: 'Vorlagen, Kontonamen und Kategorien gelten in dieser Sitzung nur bis zum Abmelden.',

  avatar: {
    /** The big avatar's name: pressing it opens the pictures. */
    change: 'Bild ändern',
    /** The pictures as a group. */
    choose: 'Bild für dein Profil',
    initials: 'Initialen',
    /** The user's own picture as one of the choices. */
    own: 'Eigenes Bild',
    chooseFile: 'Eigenes Bild wählen …',
    removeFile: 'Bild entfernen',
    /** Under the pictures: where an own picture goes. */
    stays: 'Ein eigenes Bild bleibt verschlüsselt auf diesem Rechner.',
    unreadable: 'Dieses Bild ließ sich nicht öffnen. Nimm ein JPG, PNG oder WebP.',
    tooLarge: 'Dieses Bild ist auch verkleinert noch zu groß. Nimm ein anderes.',
    names: {
      piggy: 'Sparschwein',
      cat: 'Katze',
      leaf: 'Blatt',
      flower: 'Tulpe',
      mountain: 'Berg',
      wave: 'Wellen',
      coffee: 'Kaffee',
      music: 'Musik',
      rocket: 'Rakete',
      anchor: 'Anker',
      star: 'Stern',
    } as Record<AvatarId, string>,
  },

  /** "Trotzdem abmelden?" — while a transfer of this session has an unclear outcome. */
  logoutConfirm: {
    title: 'Trotzdem abmelden?',
    one: (name: string, amount: ReactNode): ReactNode[] =>
      [`Ob deine Überweisung an ${name || 'den Empfänger'} über `, amount, ' ausgeführt wurde, ist unklar.'],
    several: (n: number) => `Bei ${n} Überweisungen dieser Sitzung ist unklar, ob sie ausgeführt wurden.`,
    afterOne: 'Nach dem Abmelden steht sie nicht mehr in den Mitteilungen. Sende sie nicht noch einmal, bevor du in deinen Umsätzen nachgesehen hast.',
    afterSeveral: 'Nach dem Abmelden stehen sie nicht mehr in den Mitteilungen. Sende keine davon noch einmal, bevor du in deinen Umsätzen nachgesehen hast.',
  },

  forgetDialog: {
    title: 'Gerät vergessen?',
    description: (bank: string | null) =>
      `Die App löscht die Geräte-Kennung, unter der ${bank ?? 'deine Bank'} diesen Rechner kennt. Bei der nächsten Anmeldung gilt er als neues Gerät: Deine Bank fragt dann wieder nach einer Freigabe.`,
    body: 'Deine aktuelle Sitzung bleibt bestehen. Gibst du den Rechner weiter, lösche auch deine gespeicherten Daten.',
    wipe: 'Auch gespeicherte Daten von diesem Rechner löschen',
    wipeHint: 'Vorlagen, Kontonamen, Kategorien und die Überweisungen der letzten 14 Tage samt früherer Sicherungen, dazu der Anmeldename und die Bank, die die Anmeldung vorausfüllt – endgültig.',
    confirm: 'Gerät vergessen',
    confirmWipe: 'Vergessen und löschen',
  },

  resetDialog: {
    title: 'Gespeicherte Daten zurücksetzen?',
    description: 'Es wird eine neue, leere Ablage angelegt. Die alte Datei bleibt als Sicherung auf diesem Rechner.',
    body: 'Vorlagen, Kontonamen und Kategorien beginnen dann neu. Was du in dieser Sitzung schon geändert hast, wird übernommen und ab jetzt wieder gespeichert.',
    confirm: 'Zurücksetzen',
  },

  wipeDialog: {
    title: 'Gespeicherte Daten löschen?',
    description: 'Vorlagen, Kontonamen, Kategorien und die Überweisungen der letzten 14 Tage werden von diesem Rechner gelöscht, frühere Sicherungen eingeschlossen – dazu der Anmeldename und die Bank, die die Anmeldung vorausfüllt. Das lässt sich nicht rückgängig machen.',
    body: 'Deine aktuelle Sitzung bleibt bestehen. Was du bis zum Abmelden änderst, wird nicht mehr gespeichert; bei der nächsten Anmeldung beginnst du mit leeren Vorlagen.',
  },
};

export const en: typeof de = {
  chip: (holder, vaultBroken) =>
    (holder ? `Session: ${holder}` : 'Session') + (vaultBroken ? ' – saved data unreadable' : ''),
  panel: 'Session',
  loggedIn: 'Logged in',
  sinceAndLogout: (since, countdown) => [`Since ${since} · logout in `, countdown],

  settings: 'Settings',
  idle: 'Log out automatically after',
  idleOption: (minutes) => `${minutes} min`,
  language: 'Language',
  logos: 'Company logos',
  logosHint: 'Only company names go to Brandfetch, which sees your IP address.',
  usage: 'Share usage data',
  usageHint: 'Which parts you use – never account data. Error reports are always sent.',
  singleKeysOff: 'Single keys off',

  thisComputer: 'On this computer',
  deviceRemembered: 'Device remembered',
  deviceRememberedHint: 'Your bank asks for approval less often.',
  deviceNotRemembered: 'Device not remembered',
  deviceNotRememberedHint: 'Your bank will ask for an approval at your next login.',
  forget: 'Forget…',
  vault: 'Saved data',
  vaultHint: 'Encrypted on this computer',
  vaultDelete: 'Delete…',
  vaultUnreadable: 'Saved data unreadable',
  vaultUnreadableHint: 'Usually because your PIN has changed. What you change now will not be saved.',
  vaultReset: 'Reset…',
  vaultUnavailable: 'In this session, templates, account names and categories last only until you log out.',

  avatar: {
    change: 'Change picture',
    choose: 'Picture for your profile',
    initials: 'Initials',
    own: 'Your own picture',
    chooseFile: 'Choose your own picture…',
    removeFile: 'Remove picture',
    stays: 'Your own picture stays encrypted on this computer.',
    unreadable: 'This picture could not be opened. Use a JPG, PNG or WebP.',
    tooLarge: 'This picture is still too large, even made smaller. Choose another one.',
    names: {
      piggy: 'Piggy bank',
      cat: 'Cat',
      leaf: 'Leaf',
      flower: 'Tulip',
      mountain: 'Mountain',
      wave: 'Waves',
      coffee: 'Coffee',
      music: 'Music',
      rocket: 'Rocket',
      anchor: 'Anchor',
      star: 'Star',
    },
  },

  logoutConfirm: {
    title: 'Log out anyway?',
    one: (name, amount) => ['It is unclear whether your transfer of ', amount, ` to ${name || 'the recipient'} was completed.`],
    several: (n) => `It is unclear whether ${n} transfers from this session were completed.`,
    afterOne: 'After you log out, it is no longer listed in Messages. Do not send it again before you have checked your transactions.',
    afterSeveral: 'After you log out, they are no longer listed in Messages. Do not send any of them again before you have checked your transactions.',
  },

  forgetDialog: {
    title: 'Forget device?',
    description: (bank) =>
      `The app deletes the device ID by which ${bank ?? 'your bank'} knows this computer. At your next login it counts as a new device, and your bank asks for an approval again.`,
    body: 'Your current session stays open. If you are passing this computer on, delete your saved data too.',
    wipe: 'Also delete saved data from this computer',
    wipeHint: 'Templates, account names, categories and the transfers of the last 14 days, earlier backups included, plus the login name and bank the login screen fills in – for good.',
    confirm: 'Forget device',
    confirmWipe: 'Forget and delete',
  },

  resetDialog: {
    title: 'Reset saved data?',
    description: 'A new, empty store is created. The old file stays on this computer as a backup.',
    body: 'Templates, account names and categories then start afresh. What you have already changed in this session is kept and saved from now on.',
    confirm: 'Reset',
  },

  wipeDialog: {
    title: 'Delete saved data?',
    description: 'Templates, account names, categories and the transfers of the last 14 days are deleted from this computer, earlier backups included – along with the login name and bank the login screen fills in. This cannot be undone.',
    body: 'Your current session stays open. What you change until you log out is no longer saved; at your next login you start with empty templates.',
  },
};
