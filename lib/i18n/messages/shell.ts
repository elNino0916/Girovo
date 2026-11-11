// The frame around every screen: masthead, navigation, command palette, shortcuts, Mitteilungen, toasts, the shared UI primitives (components/shell, components/ui, CommandPalette, ShortcutsHelp, Inbox, Toasts), and the in-app updates (components/updates).

import type { ReactNode } from 'react';

export const de = {
  // Said in several places of the frame, the same way each time.
  transfer: 'Überweisen',
  requestMoney: 'Geld anfordern',
  searchTransactions: 'Umsätze durchsuchen',
  /** The phone's search bar, at the head of the Übersicht: it opens the search. */
  searchBar: {
    /** Where a question about the bookings can be answered: Gemini Nano on a phone, the desktop's own model. */
    ask: 'Umsätze suchen oder fragen',
    plain: 'Umsätze und mehr suchen',
  },
  /** Zahlungen, the phone's second place: paying, and what is paid regularly. */
  payments: {
    recent: 'Zuletzt bezahlt',
    templates: 'Vorlagen',
    /** A recent payee's row, for a screen reader: what a press does. */
    payAgain: (name: string) => `${name} überweisen`,
    /** Under "GiroCode scannen". */
    scanHint: 'Eine Rechnung mit der Kamera lesen',
    scanInvoiceHint: 'Auch ohne GiroCode',
    /** The desktop: an invoice from a file, its GiroCode or its text read. */
    openInvoice: 'Rechnung öffnen',
    openInvoiceHint: 'PDF oder Bild, mit oder ohne GiroCode',
  },
  statementPdf: 'Kontoauszug als PDF',
  checkForUpdates: 'Nach Updates suchen',
  unread: (n: number) => `${n} ungelesen`,
  /** For a screen reader, after a link that opens the browser. */
  opensExternally: '(öffnet extern)',
  /** A time of day, "14:32" → "14:32 Uhr". */
  clock: (time: string) => `${time} Uhr`,
  /** The Control key, as the keyboard labels it. */
  ctrl: 'Strg',
  version: (v: string) => `Version ${v}`,
  /** Einstellungen → Über Girovo: the head's update line and the footer. */
  about: {
    upToDate: 'Auf dem neuesten Stand',
    /** After "© 2026 elNino0916": the publisher's name is a link. */
    publishedBy: (name: ReactNode) => ['Herausgegeben von ', name],
  },
  /** The hour of day, said the way a counter clerk would say it. */
  greeting: (hour: number): string =>
    hour < 5 ? 'Guten Abend' : hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend',
  /** The auto-logout countdown as a screen reader should hear it: "42 Sekunden", "2 Minuten". */
  countdown: (s: number) => {
    if (s >= 120) return `${Math.ceil(s / 60)} Minuten`;
    if (s > 60) return `${Math.floor(s / 60)} Minute und ${s % 60 === 1 ? '1 Sekunde' : `${s % 60} Sekunden`}`;
    if (s === 60) return '1 Minute';
    return s === 1 ? '1 Sekunde' : `${s} Sekunden`;
  },

  /** The switch for shortcuts on one unmodified key (WCAG 2.1.4). */
  singleKeys: {
    name: 'Kürzel mit einzelnen Tasten',
    keys: '/, ?, N, B, G und 1 bis 9',
    turnOff: 'Kürzel mit einzelnen Tasten ausschalten',
    turnOn: 'Kürzel mit einzelnen Tasten einschalten',
    nowOn: 'Kürzel mit einzelnen Tasten sind eingeschaltet.',
    nowOff: 'Kürzel mit einzelnen Tasten sind ausgeschaltet.',
  },

  theme: {
    /** The setting with its value: "Darstellung: Hell". */
    current: (name: string) => `Darstellung: ${name}`,
    followsSystem: 'Folgt der Einstellung deines Systems',
    /** The login bar's one-press switch, named by what it does. */
    flip: (toDark: boolean, fromSystem: boolean) => `${toDark ? 'Dunkel' : 'Hell'} darstellen${fromSystem ? ' (statt System)' : ''}`,
  },

  /** "Suche", the command palette. */
  palette: {
    groups: { actions: 'Aktionen', session: 'Sitzung' },
    youAreHere: 'Du bist hier',
    currentSetting: 'Aktuelle Einstellung',
    shareHint: 'GiroCode mit deinen Kontodaten',
    csv: 'Umsätze als CSV exportieren',
    /** Under the CSV export: the loaded period, if any. */
    csvNote: (range: string) => (range ? `${range} · für Excel` : 'Für Excel'),
    inboxHint: 'Nachrichten deiner Bank und deine Überweisungen',
    updateTo: (version: string) => `Update auf Version ${version}`,
    installed: (version: string) => `Installiert: Version ${version}`,
    /** Beside the account that is selected now. */
    selected: 'Ausgewählt',
    showAll: (query: string) => `Alle Treffer für „${query}“ anzeigen`,
    /** Android with Gemini Nano: the typed question, handed to "Frag deine Umsätze". */
    ask: (question: string) => `„${question}“ fragen`,
    askHint: 'Girovo AI',
    /** The desktop: no Gemini Nano, the app's own model (components/insights/Ask.tsx). */
    askHintDesktop: 'Girovo AI',
    inSelected: (n: number) => `${n} ${n === 1 ? 'Umsatz' : 'Umsätze'} im ausgewählten Konto`,
    newest: (shown: number, total: number) => `Die ${shown} neuesten von ${total} Treffern`,
    noResults: (query: string) => `Keine Treffer für „${query}“`,
    /** What a screen reader hears about the results. */
    results: (n: number, txNote: string | null) =>
      `${n === 1 ? '1 Ergebnis' : `${n} Ergebnisse`}${txNote ? ` · Umsätze: ${txNote}` : ''}`,
    field: 'Umsatz, Konto oder Aktion suchen',
    placeholder: 'Umsatz, Konto oder Aktion suchen …',
    intro: 'Finde Umsätze nach Name, Verwendungszweck oder Betrag.',
    resultsLabel: 'Ergebnisse',
    emptyHint:
      'Versuch eine Aktion wie „Überweisen“, ein Konto oder einen Betrag wie „12,99“.',
    /** The key hints at the palette's foot. */
    keys: { select: 'auswählen', open: 'öffnen', close: 'schließen' },
    /**
     * Words that find a command besides its name — never shown. The German
     * ones find it in English too (CommandPalette); Abmelden has its own,
     * fixed list there.
     */
    words: {
      transfer: ['überweisung', 'geld senden', 'zahlen', 'bezahlen', 'echtzeit', 'sepa'],
      share: ['girocode', 'qr', 'code', 'empfangen', 'kontodaten', 'iban teilen'],
      search: ['suche', 'filter', 'finden', 'buchungen'],
      statement: ['pdf', 'drucken', 'auszug', 'beleg', 'dokument'],
      csv: ['export', 'excel', 'csv', 'tabelle', 'download', 'herunterladen'],
      privacy: ['privat', 'verbergen', 'verstecken', 'datenschutz', 'bildschirm teilen', 'beträge', 'einblenden'],
      inbox: ['nachrichten', 'bank', 'vorgänge', 'hinweise', 'inbox'],
      overview: ['start', 'konten', 'finanzübersicht', 'kontostand'],
      analysis: ['auswertung', 'kategorien', 'ausgaben', 'einnahmen', 'statistik', 'umsatzanalyse'],
      contracts: ['zahlungen', 'abos', 'abonnements', 'fixkosten', 'wiederkehrend', 'daueraufträge', 'verträge', 'vorlagen'],
      settings: ['optionen', 'konfiguration', 'präferenzen', 'einstellung', 'zahnrad'],
      language: ['sprache', 'deutsch', 'englisch', 'english', 'language'],
      idle: ['abmeldezeit', 'timeout', 'inaktiv', 'zeitlimit'],
      logos: ['logos', 'firmenlogos', 'brandfetch'],
      usage: ['nutzungsdaten', 'telemetrie', 'statistik'],
      device: ['gerät', 'gerät vergessen', 'freigabe seltener'],
      data: ['gespeicherte daten', 'persönliche daten', 'daten löschen'],
      keep: ['umsätze behalten', 'verlauf', 'gespeicherte umsätze'],
      categories: ['eigene kategorien', 'kategorie anlegen', 'kategorie umbenennen', 'kategorie löschen'],
      backup: ['sicherung', 'backup', 'wiederherstellen', 'exportieren', 'umzug', 'neues gerät'],
      theme: ['theme', 'modus', 'farbe', 'dark mode', 'nachtmodus', 'aussehen'],
      black: ['schwarz', 'oled', 'amoled', 'hintergrund', 'dunkel', 'dark mode'],
      singleKeys: ['tastenkürzel', 'shortcuts', 'einzeltasten', 'sprachsteuerung', 'barrierefreiheit', 'tastatur'],
      updates: ['update', 'aktualisieren', 'aktualisierung', 'version', 'neue version', 'upgrade', 'installieren'],
      channel: ['update-kanal', 'nightly', 'vorschau', 'vorabversion', 'beta', 'preview'],
      early: ['sofort', 'neueste updates', 'früher', 'zuerst', 'gestaffelt', 'updates'],
      fromFile: ['update aus datei', 'setup', 'girovoupdate', 'installieren', 'datei', 'ältere version', 'downgrade', 'zurück'],
      loginBalances: ['salden', 'anmeldung', 'automatisch abrufen', 'kontostände'],
      loginBookings: ['umsätze', 'anmeldung', 'automatisch abrufen', 'alle konten', 'start'],
      keepBalances: ['salden behalten', 'gespeicherte salden', 'kontostände', 'gesamtsaldo verlauf'],
      alerts: ['mitteilungen', 'benachrichtigungen', 'hinweise', 'preiserhöhung', 'gehalt', 'kontostand', 'warnung'],
      shortcuts: ['shortcuts', 'tastatur', 'hilfe', 'kürzel'],
    },
  },

  /** The Tastenkürzel dialog (ShortcutsHelp). */
  shortcuts: {
    description:
      'Einzelne Tasten wirken nicht, während du in ein Feld schreibst.',
    /** Under the switch; `palette` is "Strg+K" or "⌘K", `toastKey` "F6". */
    switchHint: (palette: string, toastKey: string) =>
      `/, ?, N, B, G und 1 bis 9. Ausschalten bei Sprachsteuerung oder wenn du dich oft vertippst. ${palette}, Alt+1 bis 3 und ${toastKey} bleiben an.`,
    groups: { everywhere: 'Überall', navigation: 'Navigation', actions: 'Aktionen', lists: 'In Listen und Dialogen' },
    /** "?": the shortcuts dialog itself. */
    thisList: 'Diese Übersicht',
    toToast: 'Zur neuesten Benachrichtigung und zurück',
    switchAccount: 'Konto wechseln',
    newTransfer: 'Neue Überweisung',
    toggleAmounts: 'Beträge aus- oder einblenden',
    moveSelection: 'Auswahl bewegen',
    chooseOrOpen: 'Auswählen oder öffnen',
    /** In place of a switched-off key: drawn, and as a screen reader hears it. */
    off: 'aus',
    offSpoken: 'ausgeschaltet',
    /** The two-key form under Navigation; the keys are G_TABS in components/shell/useShortcuts.ts. */
    gKeys: (key: (k: string) => ReactNode) => [
      'Oder ', key('G'), ' drücken, dann ', key('Ü'), ', ', key('A'), ' oder ', key('V'),
      ' für die drei Bereiche. Eine Zahl öffnet ein geladenes Konto.',
    ],
    /** Between keys, for a screen reader: "1 bis 9", "Alt plus 1". */
    to: 'bis',
    or: 'oder',
    plus: 'plus',
  },

  /** What switching "Beträge ausblenden" from a key or the palette says. */
  amounts: {
    shown: 'Beträge werden wieder angezeigt.',
    hiddenB: 'Beträge ausgeblendet. Mit B zeigst du sie wieder.',
    hidden: 'Beträge ausgeblendet.',
  },

  /** A digit key naming an account that a switch would have to fetch first. */
  switchByKey: {
    busy: (account: string) => `„${account}“ kannst du wählen, sobald Girovo fertig ist.`,
    failed: (account: string) => `„${account}“ konnte nicht geladen werden. Neu laden kann eine Freigabe erfordern.`,
    otherPeriod: (account: string) =>
      `„${account}“ ist für einen anderen Zeitraum geladen. Neu laden kann eine Freigabe erfordern.`,
    notLoaded: (account: string) => `„${account}“ ist noch nicht geladen. Laden kann eine Freigabe erfordern.`,
    loadNow: 'Jetzt laden',
  },

  toasts: {
    region: 'Benachrichtigungen',
    /** After a toast's message, for a screen reader: how to reach its button. */
    reachAction: (key: string, label: string) => `Mit ${key} zur Schaltfläche „${label}“.`,
  },

  /** The shared primitives (components/ui). */
  ui: {
    copy: 'Kopieren',
    copyFailed: 'Kopieren nicht möglich',
    /** After a field's label. */
    optional: '(optional)',
    /** The close button of an inline alert or a toast. */
    dismiss: 'Hinweis schließen',
    remove: 'Entfernen',
    /** An error state's heading when the caller gives none. */
    failed: 'Das hat nicht geklappt',
  },

  /** The Mitteilungen drawer. */
  inbox: {
    bankMessages: 'Mitteilungen deiner Bank',
    received: (time: string) =>
      `Erhalten beim Anmelden um ${time}. Nach dem Abmelden sind sie weg.`,
    none: 'Keine Mitteilungen',
    /**
     * Messages come with the login's synchronisation only (app/api/connect).
     * `noneHint` when the bank was asked and said nothing; a remembered
     * device skips that round trip, and then the bank was not asked at all
     * (`noneNotAsked`, FintsProvider's messagesAsked).
     */
    noneHint: 'Deine Bank hat beim Anmelden nichts geschickt.',
    noneNotAsked: 'Auf einem gemerkten Gerät lädt Girovo beim Anmelden keine Mitteilungen.',
    activity: 'Überweisungen seit der Anmeldung',
    noActivity:
      'Noch keine. Deine Überweisungen stehen hier bis zum Abmelden.',
    /** The app's own news, after the bank's messages. */
    thisApp: 'Diese App',
    /** After a new message's subject, for a screen reader. */
    new: '(neu)',
    copyText: 'Text kopieren',
    /** Contract notices (lib/contract-watch.ts), after the session's activity. */
    contracts: 'Verträge & Abos',
    priceRose: (name: string, month: string) => `${name}: seit ${month} teurer`,
    priceDetail: (delta: ReactNode, perYear: ReactNode): ReactNode[] => [delta, ' mehr pro Zahlung (', perYear, ' im Jahr)'],
    cancelTitle: (name: string, day: string) => `${name}: kündbar bis ${day}`,
    cancelLeft: (days: number) =>
      days > 1 ? `Noch ${days} Tage` : days === 1 ? 'Noch 1 Tag' : days === 0 ? 'Heute ist der letzte Tag' : 'Die Frist ist vorbei',
    openContracts: 'Ansehen',
    messageCopied: 'Mitteilung kopiert',
    /** The message on paper (components/Statement.tsx): the desktop app's save dialog, a browser's print dialog. */
    savePdf: 'Als PDF speichern',
    /** A transfer's outcome; the unclear one is t.common.statusUnclear. */
    outcome: { executed: 'Ausgeführt', failed: 'Nicht ausgeführt' },
    /** Before the payee's name, for a screen reader. */
    transferTo: 'Überweisung an',
    unknownPayee: 'Unbekannter Empfänger',
    fromAccount: (account: string) => `von ${account}`,
    unclear: 'Unklar, ob die Bank den Auftrag ausgeführt hat. Prüfe deine Umsätze, bevor du ihn wiederholst.',
    withPayee: 'Umsätze mit diesem Empfänger',
  },

  bottomBar: {
    label: 'Hauptnavigation',
    /** Zahlungen, short enough for the phone's bar. */
    contracts: 'Zahlungen',
  },

  masthead: {
    skip: 'Zum Inhalt springen',
    /** In the bell's name, after the unread count. */
    newAppVersion: 'neue App-Version',
    newContractNews: 'Neues zu Verträgen',
  },

  /**
   * The desktop's frame (components/shell/TitleBar.tsx, Sidebar.tsx;
   * "Konten als Ebenen", 2026-11-04): the sidebar's month and accounts.
   */
  /** The caption buttons the Tauri desktop app draws itself (components/shell/CaptionButtons.tsx). */
  caption: {
    minimize: 'Minimieren',
    maximize: 'Maximieren',
    restore: 'Verkleinern',
    close: 'Schließen',
  },

  frame: {
    menu: 'Seitenleiste ein- und ausklappen',
    accounts: 'Konten',
    /** A layer's name: a click shows that account alone. */
    showOnly: (name: string) => `Nur ${name} zeigen`,
    /** A layer's tick box. */
    tick: (name: string) => `${name} in der Übersicht`,
    /** Over an account's page when it is the one ticked. */
    onlyThis: 'Nur dieses Konto',
    showAll: 'Alle Konten zeigen',
    /** "3 von 4 Konten" */
    shownCount: (shown: number, all: number) => `${shown} von ${all} Konten`,
    /** "Notgroschen ausgeblendet" */
    hidden: (names: string) => `${names} ausgeblendet`,
    /** The ledger's heading while a ticked account's balance is missing: no partial sum. */
    totalPending: 'Gesamtsaldo noch nicht vollständig',
    /** On Zahlungen in the sidebar: payments due in the next 30 days. */
    dueBadge: (n: number) => `${n} fällig`,
    /** Ticked accounts whose Umsätze this session has not read. */
    notLoaded: (names: string) => `Umsätze noch nicht geladen: ${names}`,
    load: 'Umsätze laden',
    /** Nothing ticked. */
    noneShown: 'Kein Konto angehakt. Hake links eins an.',
    /** The month in the sidebar. */
    month: 'Monat',
    /** The day picked in the month, as a chip over the ledger. */
    day: (day: string) => `Am ${day}`,
    clearDay: 'Ganzen Zeitraum zeigen',
    /** The month: a day's marks, to a screen reader and in the legend. */
    hasBookings: 'mit Umsätzen',
    hasDue: 'Zahlung fällig',
    legendBookings: 'Umsätze',
    legendDue: 'Fällig',
    /** Einstellungen's sections in the sidebar. */
    sections: 'Bereiche der Einstellungen',
    prevMonth: 'Vorheriger Monat',
    nextMonth: 'Nächster Monat',
  },

  /** The Übersicht's tile for unread bank messages (MessagesTeaser). */
  /** The CSV export (components/shell/actions.ts). */
  csv: {
    notCreated: 'Die CSV-Datei konnte nicht erstellt werden.',
    /** `count` is `n`, formatted. */
    saved: (n: number, count: string) => `${count} ${n === 1 ? 'Umsatz' : 'Umsätze'} als CSV-Datei gespeichert.`,
    notSaved: 'Die CSV-Datei konnte nicht gespeichert werden.',
  },

  /** Why there is no Kontoauszug yet. */
  statementHint: {
    noTransactions: 'Deine Bank liefert für dieses Konto keine Umsätze, also auch keinen Kontoauszug.',
    loading: 'Umsätze werden geladen. Danach gibt es den Kontoauszug.',
    notLoaded: 'Lade zuerst die Umsätze dieses Kontos.',
  },

  /** The safe answer before a logout or a restart over transfers whose status is unclear. */
  lookAtUnclear: {
    one: 'Umsätze prüfen',
    several: 'In Mitteilungen ansehen',
  },


  /** The update dialog and the places that point to it (components/updates). */
  updates: {
    title: 'Updates',
    ready: (v: string) => `Version ${v} ist bereit`,
    available: (v: string) => `Version ${v} ist verfügbar`,
    /** The desktop's way back from a preview to the stable release (Update-Kanal "Stabil"). */
    backTo: (v: string) => `Zurück zu Version ${v}`,
    backNote: 'Diese Version ist älter als deine Nightly. Was nur die Nightly hat, geht verloren, etwa die Anordnung deiner Konten.',
    newIn: (v: string) => `Neu in Version ${v}`,
    releaseOf: (version: ReactNode, date: ReactNode, current: ReactNode) => [
      'Version ', version, ' vom ', date, ' · du nutzt ', current,
    ],
    youUse: (current: ReactNode) => ['Du nutzt Version ', current],
    updatedFrom: (from: ReactNode) => ['Aktualisiert von Version ', from, '.'],
    justUpdated: 'Gerade aktualisiert.',
    installedIs: (current: ReactNode) => ['Installiert ist Version ', current, '.'],
    openDownloadPage: 'Download-Seite öffnen',
    inBackground: 'Im Hintergrund laden',
    restartNow: 'Jetzt neu starten',
    later: 'Später',
    download: 'Herunterladen',
    unclearRestart: (n: number) =>
      n === 1
        ? 'Die Überweisung mit unklarem Status steht nach dem Neustart nicht mehr in den Mitteilungen. Prüfe sie vorher in deinen Umsätzen.'
        : `Die ${n} Überweisungen mit unklarem Status stehen nach dem Neustart nicht mehr in den Mitteilungen. Prüfe sie vorher in deinen Umsätzen.`,
    cannotUpdate: 'Diese Version kann sich nicht selbst aktualisieren. Hol dir die neue auf der Download-Seite.',
    noFile: 'Girovo kann dieses Update nicht prüfen. Hol es dir auf der Download-Seite.',
    restarts: 'Girovo startet neu und installiert das Update, meist in unter einer Minute.',
    logsOut: 'Du wirst dabei abgemeldet.',
    approvalRunning: 'Eine Freigabe läuft noch. Danach kannst du neu starten.',
    checking: 'Suche nach Updates …',
    latest: 'Du nutzt die neueste Version.',
    lastChecked: (time: ReactNode) => ['Zuletzt geprüft: ', time],
    autoOff: 'Girovo sucht nicht selbst nach Updates.',
    whatsNew: 'Was ist neu',
    onGitHub: 'Auf GitHub',
    downloading: 'Wird heruntergeladen …',
    progress: 'Download des Updates',
    percent: (n: number) => `${n} Prozent`,
    checksum: 'Girovo prüft die Datei vor der Installation.',
    auto: 'Automatisch nach Updates suchen',
    autoHint:
      'Beim Start und alle sechs Stunden. Über deine Konten wird nichts gesendet.',
    /** The installed Windows app: the same switch, which also installs at start (src-tauri/src/updater/start.rs). */
    autoInstall: 'Updates automatisch installieren',
    /** "Update aus Datei installieren" (components/updates/FileUpdateDialog.tsx). */
    file: {
      checking: 'Datei wird geprüft …',
      checkingHint: 'Girovo prüft, ob sie echt ist.',
      readyTitle: (v: string) => `Version ${v} installieren?`,
      ready: 'Ein echtes Girovo-Update. Girovo schließt sich, installiert es und startet neu.',
      older: (v: string, current: string) =>
        `Version ${v} ist älter als deine (${current}). Daten einer neueren Version kann sie vielleicht nicht öffnen.`,
      same: (v: string) => `Version ${v} ist schon installiert. Sie wird noch einmal installiert.`,
      holding: 'Girovo wartet noch auf deine Bank. Danach kannst du installieren.',
      install: 'Installieren',
      refusedTitle: 'Diese Datei wird nicht installiert',
    },
    /** "Als Datei speichern" (components/updates/UpdateDialog.tsx SaveAsFile). */
    bundle: {
      save: 'Als Datei speichern',
      hint: 'Zum Installieren ohne Internet oder auf einem anderen PC.',
      writing: 'Datei wird gespeichert …',
      saved: (name: string) => `Gespeichert als ${name}.`,
      failed: 'Das Update ließ sich nicht als Datei speichern.',
    },
    autoInstallHint:
      'Neue Versionen werden beim Start installiert.',
    // The toasts, the Mitteilungen row, the Sitzung panel's row and the login bar's button.
    downloaded: (v: string) => `Version ${v} ist heruntergeladen. Sie wird beim Neustart installiert.`,
    details: 'Details',
    /** The first start after the update from a version called Sooskasse-FinTS. */
    renamed: (v: string) => `Sooskasse-FinTS heißt jetzt Girovo. Version ${v} ist installiert.`,
    updated: (v: string) => `Girovo wurde auf Version ${v} aktualisiert.`,
    whatsNewAsk: 'Was ist neu?',
    notCompleted: (v: string) => `Das Update auf Version ${v} wurde nicht abgeschlossen.`,
    readyToInstall: (v: string) => `Version ${v} ist bereit zur Installation`,
    updatedTo: (v: string) => `Aktualisiert auf Version ${v}`,
    stillOn: (current: ReactNode) => ['Du nutzt noch Version ', current, '. Installiert wird beim Neustart.'],
    notYetDownloaded: (current: ReactNode) => [
      'Du nutzt Version ', current, '. Noch nichts heruntergeladen.',
    ],
    installNow: 'Jetzt installieren …',
    detailsAndDownload: 'Details und Download …',
    /** The installed Windows app: updates only through the start window (src-tauri/src/updater/start.rs). */
    detailsAndRestart: 'Details und Neustart …',
    restartToInstall: 'Jetzt neu starten und installieren',
    restartToGoBack: (v: string) => `Neu starten und zu Version ${v} zurück`,
    restartLogsOut: 'Beim Neustart wirst du abgemeldet.',
    orAtNextStart: 'Ohne Neustart wird das Update beim nächsten Start installiert.',
    atStartNote: (current: ReactNode) => ['Du nutzt Version ', current, '. Installiert wird beim nächsten Start oder gleich mit einem Neustart.'],
    whatsNewOpen: 'Was ist neu? …',
    loadingPct: (pct: number) => `Lädt … ${pct} %`,
    readyTag: 'Bereit zur Installation',
    barReady: 'Update bereit',
    barAvailable: 'Update verfügbar',
    barTitle: (label: string, v: string) => `${label}: Version ${v}`,
  },
};

export const en: typeof de = {
  transfer: 'Transfer',
  requestMoney: 'Request money',
  searchTransactions: 'Search transactions',
  searchBar: {
    ask: 'Search or ask about transactions',
    plain: 'Search transactions and more',
  },
  payments: {
    recent: 'Recently paid',
    templates: 'Templates',
    payAgain: (name) => `Transfer to ${name}`,
    scanHint: 'Read an invoice with the camera',
    scanInvoiceHint: 'Also without a GiroCode',
    openInvoice: 'Open an invoice',
    openInvoiceHint: 'PDF or image, with or without a GiroCode',
  },
  statementPdf: 'Account statement as PDF',
  checkForUpdates: 'Check for updates',
  unread: (n) => `${n} unread`,
  opensExternally: '(opens externally)',
  clock: (time) => time,
  ctrl: 'Ctrl',
  version: (v) => `Version ${v}`,
  about: {
    upToDate: 'Up to date',
    publishedBy: (name) => ['Published by ', name],
  },
  greeting: (hour) => (hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'),
  countdown: (s) => {
    if (s >= 120) return `${Math.ceil(s / 60)} minutes`;
    if (s > 60) return `${Math.floor(s / 60)} minute and ${s % 60 === 1 ? '1 second' : `${s % 60} seconds`}`;
    if (s === 60) return '1 minute';
    return s === 1 ? '1 second' : `${s} seconds`;
  },

  singleKeys: {
    name: 'Single-key shortcuts',
    keys: '/, ?, N, B, G and 1 to 9',
    turnOff: 'Turn off single-key shortcuts',
    turnOn: 'Turn on single-key shortcuts',
    nowOn: 'Single-key shortcuts are on.',
    nowOff: 'Single-key shortcuts are off.',
  },

  theme: {
    current: (name) => `Appearance: ${name}`,
    followsSystem: 'Follows your system’s setting',
    flip: (toDark, fromSystem) => `Switch to ${toDark ? 'dark' : 'light'}${fromSystem ? ' (instead of System)' : ''}`,
  },

  palette: {
    groups: { actions: 'Actions', session: 'Session' },
    youAreHere: 'You are here',
    currentSetting: 'Current setting',
    shareHint: 'GiroCode with your account details',
    csv: 'Export transactions as CSV',
    csvNote: (range) => (range ? `${range} · for Excel` : 'For Excel'),
    inboxHint: 'Messages from your bank and your transfers',
    updateTo: (version) => `Update to version ${version}`,
    installed: (version) => `Installed: version ${version}`,
    selected: 'Selected',
    showAll: (query) => `Show all results for “${query}”`,
    ask: (question) => `Ask “${question}”`,
    askHint: 'Girovo AI',
    askHintDesktop: 'Girovo AI',
    inSelected: (n) => `${n} ${n === 1 ? 'transaction' : 'transactions'} in the selected account`,
    newest: (shown, total) => `The newest ${shown} of ${total} results`,
    noResults: (query) => `No results for “${query}”`,
    results: (n, txNote) => `${n === 1 ? '1 result' : `${n} results`}${txNote ? ` · Transactions: ${txNote}` : ''}`,
    field: 'Search for a transaction, account or action',
    placeholder: 'Search for a transaction, account or action…',
    intro: 'Find transactions by name, payment reference or amount.',
    resultsLabel: 'Results',
    emptyHint:
      'Try an action like “Transfer”, an account or an amount like “12.99”.',
    keys: { select: 'select', open: 'open', close: 'close' },
    words: {
      transfer: ['send money', 'pay', 'payment', 'instant', 'sepa'],
      share: ['girocode', 'qr', 'code', 'receive', 'get paid', 'account details', 'share iban'],
      search: ['find', 'filter', 'bookings'],
      statement: ['pdf', 'print', 'bank statement', 'receipt', 'document'],
      csv: ['export', 'excel', 'csv', 'spreadsheet', 'table', 'download'],
      privacy: ['private', 'privacy', 'hide', 'conceal', 'mask', 'screen sharing', 'share screen', 'amounts', 'show'],
      inbox: ['notifications', 'bank', 'activity', 'notices', 'inbox', 'mailbox'],
      overview: ['home', 'start', 'accounts', 'financial overview', 'balance'],
      analysis: ['evaluation', 'categories', 'spending', 'income', 'statistics', 'spending analysis'],
      contracts: ['payments', 'subscriptions', 'fixed costs', 'recurring', 'standing orders', 'contracts', 'templates'],
      settings: ['settings', 'options', 'preferences', 'configuration', 'gear'],
      language: ['language', 'german', 'english', 'deutsch'],
      idle: ['auto logout', 'timeout', 'inactivity', 'idle'],
      logos: ['logos', 'company logos', 'brandfetch'],
      usage: ['usage data', 'telemetry', 'statistics'],
      device: ['device', 'forget device', 'remember device'],
      data: ['saved data', 'personal data', 'delete data'],
      keep: ['keep transactions', 'history', 'saved transactions'],
      categories: ['your categories', 'custom categories', 'new category', 'rename category', 'delete category'],
      backup: ['backup', 'restore', 'export data', 'move', 'new device'],
      theme: ['theme', 'mode', 'colour', 'color', 'dark mode', 'night mode', 'appearance'],
      black: ['black', 'oled', 'amoled', 'background', 'dark', 'dark mode'],
      singleKeys: ['keyboard shortcuts', 'shortcuts', 'single keys', 'voice control', 'accessibility', 'keyboard'],
      updates: ['update', 'updates', 'new version', 'version', 'upgrade', 'install'],
      channel: ['update channel', 'nightly', 'preview', 'beta', 'pre-release', 'early access'],
      early: ['right away', 'latest updates', 'early', 'first', 'staged', 'updates'],
      fromFile: ['update from file', 'setup', 'girovoupdate', 'install', 'file', 'older version', 'downgrade', 'roll back'],
      loginBalances: ['balances', 'login', 'load automatically'],
      loginBookings: ['transactions', 'login', 'load automatically', 'all accounts', 'launch'],
      keepBalances: ['keep balances', 'saved balances', 'total balance history'],
      alerts: ['notifications', 'alerts', 'price increase', 'salary', 'balance', 'warning'],
      shortcuts: ['shortcuts', 'keyboard', 'help', 'keys', 'hotkeys'],
    },
  },

  shortcuts: {
    description: 'Single keys don’t work while you’re typing in a field.',
    switchHint: (palette, toastKey) =>
      `/, ?, N, B, G and 1 to 9. Turn off for voice control or if you often mistype. ${palette}, Alt+1 to 3 and ${toastKey} stay on.`,
    groups: { everywhere: 'Everywhere', navigation: 'Navigation', actions: 'Actions', lists: 'In lists and dialogues' },
    thisList: 'This list',
    toToast: 'To the latest notification and back',
    switchAccount: 'Switch account',
    newTransfer: 'New transfer',
    toggleAmounts: 'Hide or show amounts',
    moveSelection: 'Move selection',
    chooseOrOpen: 'Select or open',
    off: 'off',
    offSpoken: 'turned off',
    // The keys stay G_TABS' own (O works for Overview too). V is not the
    // initial of Contracts, so English names each section.
    gKeys: (key) => [
      'Or press ', key('G'), ', then ', key('O'), ' for Overview, ', key('A'), ' for Analysis or ', key('V'),
      ' for Payments. A number opens a loaded account.',
    ],
    to: 'to',
    or: 'or',
    plus: 'plus',
  },

  amounts: {
    shown: 'Amounts are shown again.',
    hiddenB: 'Amounts hidden. Press B to show them.',
    hidden: 'Amounts hidden.',
  },

  switchByKey: {
    busy: (account) => `You can pick “${account}” once Girovo is done.`,
    failed: (account) => `“${account}” couldn’t be loaded. Loading again may need approval.`,
    otherPeriod: (account) =>
      `“${account}” is loaded for another period. Loading again may need approval.`,
    notLoaded: (account) => `“${account}” isn’t loaded yet. Loading may need approval.`,
    loadNow: 'Load now',
  },

  toasts: {
    region: 'Notifications',
    reachAction: (key, label) => `Press ${key} to reach the “${label}” button.`,
  },

  ui: {
    copy: 'Copy',
    copyFailed: 'Couldn’t copy',
    optional: '(optional)',
    dismiss: 'Dismiss',
    remove: 'Remove',
    failed: 'That didn’t work',
  },

  inbox: {
    bankMessages: 'Messages from your bank',
    received: (time) =>
      `Received when you logged in at ${time}. They’re gone once you log out.`,
    none: 'No messages',
    noneHint: 'Your bank sent nothing when you logged in.',
    noneNotAsked: 'On a remembered device, Girovo doesn’t load messages when you log in.',
    activity: 'Transfers since you logged in',
    noActivity: 'None yet. Your transfers stay here until you log out.',
    thisApp: 'This app',
    new: '(new)',
    copyText: 'Copy text',
    contracts: 'Contracts & subscriptions',
    priceRose: (name, month) => `${name}: dearer since ${month}`,
    priceDetail: (delta, perYear) => [delta, ' more per payment (', perYear, ' a year)'],
    cancelTitle: (name, day) => `${name}: cancel by ${day}`,
    cancelLeft: (days) =>
      days > 1 ? `${days} days left` : days === 1 ? '1 day left' : days === 0 ? 'Today is the last day' : 'The deadline has passed',
    openContracts: 'View',
    messageCopied: 'Message copied',
    savePdf: 'Save as PDF',
    outcome: { executed: 'Completed', failed: 'Not completed' },
    transferTo: 'Transfer to',
    unknownPayee: 'Unknown recipient',
    fromAccount: (account) => `from ${account}`,
    unclear: 'Unclear whether the bank carried out the order. Check your transactions before you repeat it.',
    withPayee: 'Transactions with this recipient',
  },

  bottomBar: {
    label: 'Main navigation',
    contracts: 'Payments',
  },

  masthead: {
    skip: 'Skip to content',
    newAppVersion: 'new app version',
    newContractNews: 'contract news',
  },

  caption: {
    minimize: 'Minimise',
    maximize: 'Maximise',
    restore: 'Restore down',
    close: 'Close',
  },

  frame: {
    menu: 'Expand or collapse the sidebar',
    accounts: 'Accounts',
    showOnly: (name) => `Show only ${name}`,
    tick: (name) => `${name} in the overview`,
    onlyThis: 'Only this account',
    showAll: 'Show all accounts',
    shownCount: (shown, all) => `${shown} of ${all} accounts`,
    hidden: (names) => `${names} hidden`,
    totalPending: 'Total balance not complete yet',
    dueBadge: (n) => `${n} due`,
    notLoaded: (names) => `Transactions not loaded yet: ${names}`,
    load: 'Load transactions',
    noneShown: 'No account ticked. Tick one on the left.',
    month: 'Month',
    day: (day) => `On ${day}`,
    clearDay: 'Show the whole period',
    hasBookings: 'with transactions',
    hasDue: 'payment due',
    legendBookings: 'Transactions',
    legendDue: 'Due',
    sections: 'Settings sections',
    prevMonth: 'Previous month',
    nextMonth: 'Next month',
  },

  csv: {
    notCreated: 'The CSV file could not be created.',
    saved: (n, count) => `${count} ${n === 1 ? 'transaction' : 'transactions'} saved as a CSV file.`,
    notSaved: 'The CSV file could not be saved.',
  },

  statementHint: {
    noTransactions: 'Your bank provides no transactions for this account, so no account statement either.',
    loading: 'Transactions are loading. The account statement comes after that.',
    notLoaded: 'Load this account’s transactions first.',
  },

  lookAtUnclear: {
    one: 'Check transactions',
    several: 'View in Messages',
  },


  updates: {
    title: 'Updates',
    ready: (v) => `Version ${v} is ready`,
    available: (v) => `Version ${v} is available`,
    backTo: (v) => `Back to version ${v}`,
    backNote: 'This version is older than your nightly. Anything only the nightly has is lost, such as the order of your accounts.',
    newIn: (v) => `New in version ${v}`,
    releaseOf: (version, date, current) => ['Version ', version, ' from ', date, ' · you’re using ', current],
    youUse: (current) => ['You’re using version ', current],
    updatedFrom: (from) => ['Updated from version ', from, '.'],
    justUpdated: 'Just updated.',
    installedIs: (current) => ['Version ', current, ' is installed.'],
    openDownloadPage: 'Open download page',
    inBackground: 'Download in the background',
    restartNow: 'Restart now',
    later: 'Later',
    download: 'Download',
    unclearRestart: (n) =>
      n === 1
        ? 'After the restart, the transfer with an unclear status will no longer be in Messages. Check it in your transactions first.'
        : `After the restart, the ${n} transfers with an unclear status will no longer be in Messages. Check them in your transactions first.`,
    cannotUpdate: 'This version can’t update itself. Get the new one from the download page.',
    noFile: 'Girovo can’t check this update. Get it from the download page.',
    restarts: 'Girovo restarts and installs the update, usually in under a minute.',
    logsOut: 'You’ll be logged out in the process.',
    approvalRunning: 'An approval is still running. You can restart after that.',
    checking: 'Checking for updates…',
    latest: 'You’re using the latest version.',
    lastChecked: (time) => ['Last checked: ', time],
    autoOff: 'Girovo doesn’t check for updates by itself.',
    whatsNew: 'What’s new',
    onGitHub: 'On GitHub',
    downloading: 'Downloading…',
    progress: 'Update download',
    percent: (n) => `${n} per cent`,
    checksum: 'Girovo checks the file before installing it.',
    auto: 'Check for updates automatically',
    autoHint:
      'At start-up and every six hours. Nothing about your accounts is sent.',
    autoInstall: 'Install updates automatically',
    file: {
      checking: 'Checking the file …',
      checkingHint: 'Girovo checks that it’s genuine.',
      readyTitle: (v) => `Install version ${v}?`,
      ready: 'A genuine Girovo update. Girovo closes, installs it and starts again.',
      older: (v, current) => `Version ${v} is older than yours (${current}). It may not open data saved by a newer version.`,
      same: (v) => `Version ${v} is already installed. It will be installed again.`,
      holding: 'Girovo is still waiting for your bank. You can install after that.',
      install: 'Install',
      refusedTitle: 'This file won’t be installed',
    },
    bundle: {
      save: 'Save as a file',
      hint: 'To install without internet or on another PC.',
      writing: 'Saving the file …',
      saved: (name) => `Saved as ${name}.`,
      failed: 'The update couldn’t be saved as a file.',
    },
    autoInstallHint:
      'New versions are installed at start-up.',
    downloaded: (v) => `Version ${v} is downloaded. It’s installed when you restart.`,
    details: 'Details',
    renamed: (v) => `Sooskasse-FinTS is now called Girovo. Version ${v} is installed.`,
    updated: (v) => `Girovo has been updated to version ${v}.`,
    whatsNewAsk: 'What’s new?',
    notCompleted: (v) => `The update to version ${v} was not completed.`,
    readyToInstall: (v) => `Version ${v} is ready to install`,
    updatedTo: (v) => `Updated to version ${v}`,
    stillOn: (current) => ['You’re still using version ', current, '. It’s installed when you restart.'],
    notYetDownloaded: (current) => ['You’re using version ', current, '. Nothing is downloaded yet.'],
    installNow: 'Install now…',
    detailsAndDownload: 'Details and download…',
    detailsAndRestart: 'Details and restart…',
    restartToInstall: 'Restart and install now',
    restartToGoBack: (v) => `Restart and go back to version ${v}`,
    restartLogsOut: 'Restarting logs you out.',
    orAtNextStart: 'Without a restart, it’s installed the next time you open Girovo.',
    atStartNote: (current) => ['You’re using version ', current, '. It’s installed at the next start or right away with a restart.'],
    whatsNewOpen: 'See what’s new…',
    loadingPct: (pct) => `Downloading… ${pct}%`,
    readyTag: 'Ready to install',
    barReady: 'Update ready',
    barAvailable: 'Update available',
    barTitle: (label, v) => `${label}: version ${v}`,
  },
};
