'use strict';

// The desktop shell's own texts, in German and English: its error dialogs, its
// menu, the file types its save dialogs offer, and what the updater and the
// file save tell the page (electron/updater.cjs, electron/file-save.cjs). The
// page's texts live in lib/i18n/messages, which the main process cannot load;
// the few the shell needs are here, German and English side by side as there.
//
// The shell speaks the app's language: the choice stored as the preference
// `fints.locale` (lib/i18n/locale.ts — the page writes it through
// window.electronStore), else the system's — German for German, English for
// anything else. It is asked each time a text is made, so a change in the app
// reaches the next dialog and the next update message without a restart.
//
// main.cjs says where the choice and the system's language are found
// (configure). Until it has — under `node --test`, say — the shell speaks
// German, the language every text is written in first.

/** The preference key (lib/i18n/locale.ts LOCALE_PREF). */
const LOCALE_PREF = 'fints.locale';
/** The cookie the server reads the choice from (lib/i18n/locale.ts LOCALE_COOKIE). */
const LOCALE_COOKIE = 'girovo-locale';

const de = {
  /** Starting the server, and losing it (main.cjs). */
  start: {
    /** The title of the dialog when the app cannot start; the reason is its text. */
    failed: 'Girovo konnte nicht starten',
    serverStopped: (code) => `Der Server wurde mit Code ${code} beendet.`,
    serverTimeout: 'Der Server hat nicht rechtzeitig geantwortet.',
    /** A development build without its server: for whoever builds the app. */
    serverMissing: (entry) => `Der gebaute Server fehlt (${entry}).\n\nFühre zuerst "npm run electron:build" aus.`,
    serverExited: (code) => `Der Server wurde unerwartet beendet (Code ${code}).`,
    /** The title when the server stopped while the app was running; serverExited is its text. */
    closed: 'Girovo musste beendet werden',
  },
  /** The application menu, with the access keys Windows underlines. */
  menu: {
    file: '&Datei',
    quit: 'Beenden',
    edit: '&Bearbeiten',
    cut: 'Ausschneiden',
    copy: 'Kopieren',
    paste: 'Einfügen',
    selectAll: 'Alles auswählen',
    view: '&Ansicht',
    reload: 'Neu laden',
    resetZoom: 'Zoom zurücksetzen',
    zoomIn: 'Vergrößern',
    zoomOut: 'Verkleinern',
    fullScreen: 'Vollbild',
    devTools: 'Entwicklertools',
  },
  /** The file types a save dialog offers. */
  fileTypes: {
    csv: 'CSV-Datei',
    png: 'PNG-Bild',
    pdf: 'PDF',
    pdfDocument: 'PDF-Dokument',
  },
  /** Saving a file the app made (file-save.cjs). */
  files: {
    saveFailed: 'Die Datei konnte nicht gespeichert werden.',
    openElsewhere:
      'Die Datei ist noch in einem anderen Programm geöffnet, zum Beispiel in Excel. Schließe sie dort oder wähle einen anderen Namen.',
    notThere: 'Die Datei konnte dort nicht gespeichert werden. Wähle einen anderen Ordner.',
  },
  /** The updater's messages, as the update dialog shows them (updater.cjs). */
  updates: {
    noSpace: 'Auf dem Laufwerk ist nicht genug Platz für das Update.',
    installLocked:
      'Das Update konnte nicht gestartet werden – die Datei ist gesperrt. Ein Virenscanner prüft sie vielleicht noch; versuche es gleich noch einmal.',
    folderLocked: 'Die Datei konnte nicht gespeichert werden – der Ordner ist schreibgeschützt oder gesperrt.',
    fileGone: 'Die heruntergeladene Datei ist nicht mehr da. Lade das Update noch einmal herunter.',
    timeout: 'GitHub hat nicht rechtzeitig geantwortet. Versuche es später noch einmal.',
    connectionLost: 'Die Verbindung zu GitHub ist abgebrochen. Versuche es noch einmal.',
    offline: 'Keine Verbindung zu GitHub. Bist du mit dem Internet verbunden?',
    checkFailed: 'Die Suche nach Updates hat nicht geklappt.',
    downloadFailed: 'Der Download hat nicht geklappt.',
    installFailed: 'Das Update konnte nicht gestartet werden.',
    unreadable: 'Die Antwort von GitHub war unverständlich.',
    tooLarge: 'Die Datei ist größer als angekündigt und wurde verworfen.',
    interrupted: 'Der Download wurde unterbrochen. Versuche es noch einmal.',
    /** Said at the start after an install that did not come up. */
    notCompleted: (version) => `Das Update auf Version ${version} wurde nicht abgeschlossen. Du kannst es noch einmal versuchen.`,
    rateLimited: 'GitHub nimmt gerade keine weiteren Anfragen an. Versuche es später noch einmal.',
    httpError: (status) => `GitHub hat mit einem Fehler geantwortet (HTTP ${status}).`,
    noFolder: 'Es gibt keinen Ordner, in dem die neue Version gespeichert werden kann.',
    downloadHttp: (status) => `Der Download ist fehlgeschlagen (HTTP ${status}).`,
    digestMismatch: 'Die Datei stimmt nicht mit der Prüfsumme von GitHub überein und wurde gelöscht.',
    changed: 'Die heruntergeladene Datei fehlt oder wurde verändert. Lade das Update noch einmal herunter.',
  },
};

/** @type {typeof de} */
const en = {
  start: {
    failed: 'Girovo could not start',
    serverStopped: (code) => `The server stopped with code ${code}.`,
    serverTimeout: 'The server did not answer in time.',
    serverMissing: (entry) => `The built server is missing (${entry}).\n\nRun "npm run electron:build" first.`,
    serverExited: (code) => `The server stopped unexpectedly (code ${code}).`,
    closed: 'Girovo had to close',
  },
  menu: {
    file: '&File',
    quit: 'Exit',
    edit: '&Edit',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select all',
    view: '&View',
    reload: 'Reload',
    resetZoom: 'Reset zoom',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fullScreen: 'Full screen',
    devTools: 'Developer tools',
  },
  fileTypes: {
    csv: 'CSV file',
    png: 'PNG image',
    pdf: 'PDF',
    pdfDocument: 'PDF document',
  },
  files: {
    saveFailed: 'The file could not be saved.',
    openElsewhere:
      'The file is still open in another program, Excel for example. Close it there or choose a different name.',
    notThere: 'The file could not be saved there. Choose a different folder.',
  },
  updates: {
    noSpace: 'There is not enough space on the drive for the update.',
    installLocked:
      'The update could not be started – the file is locked. A virus scanner may still be checking it; try again in a moment.',
    folderLocked: 'The file could not be saved – the folder is read-only or locked.',
    fileGone: 'The downloaded file is no longer there. Download the update again.',
    timeout: 'GitHub did not answer in time. Try again later.',
    connectionLost: 'The connection to GitHub broke off. Try again.',
    offline: 'No connection to GitHub. Are you connected to the internet?',
    checkFailed: 'Checking for updates did not work.',
    downloadFailed: 'The download did not work.',
    installFailed: 'The update could not be started.',
    unreadable: 'GitHub’s answer could not be understood.',
    tooLarge: 'The file is larger than announced and was discarded.',
    interrupted: 'The download was interrupted. Try again.',
    notCompleted: (version) => `The update to version ${version} was not completed. You can try again.`,
    rateLimited: 'GitHub is not taking any more requests right now. Try again later.',
    httpError: (status) => `GitHub answered with an error (HTTP ${status}).`,
    noFolder: 'There is no folder the new version can be saved in.',
    downloadHttp: (status) => `The download failed (HTTP ${status}).`,
    digestMismatch: 'The file does not match GitHub’s checksum and was deleted.',
    changed: 'The downloaded file is missing or was changed. Download the update again.',
  },
};

const TEXTS = { de, en };

const isLocale = (v) => v === 'de' || v === 'en';

/** Where the choice and the system’s language come from (configure). */
let source = { stored: () => null, system: () => 'de' };

/**
 * main.cjs’s: `stored` answers the preference `fints.locale` (prefs().get),
 * `system` the system’s language (app.getLocale(), valid once the app is ready).
 */
function configure({ stored, system }) {
  source = { stored, system };
}

/** The language the user chose in the app, or null without a choice. */
function storedLocale() {
  try {
    const v = source.stored();
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

/** 'de' or 'en': the stored choice, else German for a German system and English for any other. */
function shellLocale() {
  const stored = storedLocale();
  if (stored) return stored;
  let system = '';
  try {
    system = String(source.system() || '');
  } catch { /* unknown: as for any other language */ }
  return system.toLowerCase().startsWith('de') ? 'de' : 'en';
}

/** The shell’s texts in the language speaking right now, or in `locale`. */
function shellTexts(locale = shellLocale()) {
  return TEXTS[locale] || TEXTS.de;
}

module.exports = { LOCALE_PREF, LOCALE_COOKIE, TEXTS, configure, storedLocale, shellLocale, shellTexts };
