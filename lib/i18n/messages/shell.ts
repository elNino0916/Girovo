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
    keys: '/, ?, N, B, G und 1–9',
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
    inboxHint: 'Nachrichten deiner Bank und Vorgänge dieser Sitzung',
    updateTo: (version: string) => `Update auf Version ${version}`,
    installed: (version: string) => `Installiert: Version ${version}`,
    /** Beside the account that is selected now. */
    selected: 'Ausgewählt',
    showAll: (query: string) => `Alle Treffer für „${query}“ anzeigen`,
    /** Android with Gemini Nano: the typed question, handed to "Frag deine Umsätze". */
    ask: (question: string) => `„${question}“ fragen`,
    askHint: 'Frag deine Umsätze · auf diesem Telefon gerechnet',
    /** The desktop: no Gemini Nano, the app's own model (components/insights/Ask.tsx). */
    askHintDesktop: 'Frag deine Umsätze · auf diesem Rechner gerechnet',
    inSelected: (n: number) => `${n} ${n === 1 ? 'Umsatz' : 'Umsätze'} im ausgewählten Konto`,
    newest: (shown: number, total: number) => `Die ${shown} neuesten von ${total} Treffern`,
    noResults: (query: string) => `Keine Treffer für „${query}“`,
    /** What a screen reader hears about the results. */
    results: (n: number, txNote: string | null) =>
      `${n === 1 ? '1 Ergebnis' : `${n} Ergebnisse`}${txNote ? ` · Umsätze: ${txNote}` : ''}`,
    field: 'Umsatz, Konto oder Aktion suchen',
    placeholder: 'Umsatz, Konto oder Aktion suchen …',
    intro: 'Tippe einen Namen, Verwendungszweck oder Betrag, um in den geladenen Umsätzen zu suchen.',
    resultsLabel: 'Ergebnisse',
    emptyHint:
      'Suche nach einer Aktion wie „Überweisen“, nach einem Konto oder nach geladenen Umsätzen – Name, Verwendungszweck oder Betrag wie „12,99“.',
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
      singleKeys: ['tastenkürzel', 'shortcuts', 'einzeltasten', 'sprachsteuerung', 'barrierefreiheit', 'tastatur'],
      updates: ['update', 'aktualisieren', 'aktualisierung', 'version', 'neue version', 'upgrade', 'installieren'],
      channel: ['update-kanal', 'nightly', 'vorschau', 'vorabversion', 'beta', 'preview'],
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
      'Einzelne Tasten wirken nur, solange du nicht in einem Eingabefeld schreibst – und lassen sich ganz ausschalten.',
    /** Under the switch; `palette` is "Strg+K" or "⌘K", `toastKey` "F6". */
    switchHint: (palette: string, toastKey: string) =>
      `/, ?, N, B, G und 1–9. Ausschalten, wenn du per Sprache steuerst oder Tasten leicht versehentlich triffst. ${palette}, Alt+1–3 und ${toastKey} bleiben eingeschaltet.`,
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
      ' für die drei Bereiche. Eine Zahl wechselt zu einem schon abgerufenen Konto.',
    ],
    /** Between keys, for a screen reader: "1 bis 9", "Alt plus 1". */
    to: 'bis',
    or: 'oder',
    plus: 'plus',
  },

  /** What switching "Beträge ausblenden" from a key or the palette says. */
  amounts: {
    shown: 'Beträge werden wieder angezeigt.',
    hiddenB: 'Beträge ausgeblendet – mit B blendest du sie wieder ein.',
    hidden: 'Beträge ausgeblendet.',
  },

  /** A digit key naming an account that a switch would have to fetch first. */
  switchByKey: {
    busy: (account: string) => `„${account}“ lässt sich wählen, sobald der laufende Vorgang fertig ist.`,
    failed: (account: string) => `Der letzte Abruf für „${account}“ ist fehlgeschlagen. Ein neuer kann eine Freigabe erfordern.`,
    otherPeriod: (account: string) =>
      `Die Umsätze von „${account}“ sind für einen anderen Zeitraum abgerufen. Ein neuer Abruf kann eine Freigabe erfordern.`,
    notLoaded: (account: string) => `„${account}“ ist noch nicht abgerufen. Ein Abruf kann eine Freigabe erfordern.`,
    loadNow: 'Jetzt abrufen',
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
      `Erhalten bei der Anmeldung um ${time}. Mitteilungen werden nicht gespeichert – nach dem Abmelden sind sie hier nicht mehr zu sehen.`,
    none: 'Keine Mitteilungen',
    /**
     * Messages come with the login's synchronisation only (app/api/connect).
     * `noneHint` when the bank was asked and said nothing; a remembered
     * device skips that round trip, and then the bank was not asked at all
     * (`noneNotAsked`, FintsProvider's messagesAsked).
     */
    noneHint: 'Deine Bank hat bei dieser Anmeldung nichts mitgeteilt. Neue Mitteilungen siehst du nach der nächsten Anmeldung.',
    noneNotAsked: 'Auf einem gemerkten Gerät fragt Girovo deine Bank beim Anmelden nicht nach Mitteilungen.',
    activity: 'Vorgänge dieser Sitzung',
    noActivity:
      'Noch keine Überweisungen in dieser Sitzung. Ausgeführte, abgelehnte und unklare Aufträge stehen hier, bis du dich abmeldest.',
    /** The app's own news, after the bank's messages. */
    thisApp: 'Diese App',
    /** After a new message's subject, for a screen reader. */
    new: '(neu)',
    copyText: 'Text kopieren',
    /** Contract notices (lib/contract-watch.ts), after the session's activity. */
    contracts: 'Verträge & Abos',
    priceRose: (name: string, month: string) => `${name}: seit ${month} teurer`,
    priceDetail: (delta: ReactNode, perYear: ReactNode): ReactNode[] => [delta, ' mehr pro Zahlung – ', perYear, ' im Jahr'],
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
    unclear: 'Ob die Bank den Auftrag ausgeführt hat, ist nicht bekannt. Prüfe deine Umsätze, bevor du ihn wiederholst.',
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
    notLoaded: (names: string) => `Umsätze noch nicht abgerufen: ${names}`,
    load: 'Umsätze abrufen',
    /** Nothing ticked. */
    noneShown: 'Kein Konto angehakt. Hake links ein Konto an, um seine Umsätze zu sehen.',
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
    noTransactions: 'Für dieses Konto bietet deine Bank keine Umsätze an – daher auch keinen Kontoauszug.',
    loading: 'Die Umsätze werden gerade geladen. Danach gibt es den Kontoauszug.',
    notLoaded: 'Den Kontoauszug gibt es, sobald die Umsätze dieses Kontos geladen sind.',
  },

  /** The safe answer before a logout or a restart over transfers whose status is unclear. */
  lookAtUnclear: {
    one: 'Umsätze prüfen',
    several: 'In Mitteilungen ansehen',
  },

  /** "Neu in Girovo 6" (components/NewInSix.tsx): once after the update, and from Einstellungen → Über Girovo. */
  newInSix: {
    title: 'Neu in Girovo 6',
    intro: 'Ein paar Neuerungen schaltest du selbst ein, weil sie eine PIN aufbewahren oder über dieses Gerät hinausreichen. Das geht gleich hier oder später in den Einstellungen.',
    introPlain: 'Was sich mit Version 6 geändert hat.',
    toTurnOn: 'Zum Einschalten',
    alsoNew: 'Außerdem neu',
    done: 'Fertig',
    /** Einstellungen → Über Girovo. */
    row: 'Neu in Girovo 6',
    rowHint: 'Was Version 6 mitbringt und was du dafür einschalten kannst',
    overview: { title: 'Alle Konten auf einen Blick', text: 'Mit mehreren Konten zeigt die Übersicht sie alle zusammen, mit dem Gesamtsaldo darüber.' },
    frame: { title: 'Ein neues Fenster', text: 'Eine Seitenleiste mit deinen Konten zum Ein- und Ausblenden, die Suche in der Titelleiste.' },
    widget: { title: 'Widget für den Startbildschirm', text: 'Dein Gesamtsaldo, verdeckt, bis du tippst. Halte den Startbildschirm gedrückt und wähle „Widgets“.' },
    orders: { title: 'Aufträge', text: 'Daueraufträge und terminierte Überweisungen deiner Bank auf einer eigenen Seite unter Zahlungen.' },
    kept: { title: 'Letzte Salden', text: 'Die letzten Kontostände bleiben bis zur nächsten Anmeldung zu sehen, mit dem Verlauf des Gesamtsaldos.' },
    cards: { title: 'Kreditkarten der Sparkassen', text: 'Die Umsätze deiner Sparkassen-Kreditkarte, wo die Bank sie anbietet.' },
    updates: { title: 'Updates beim Start', text: 'Neue Versionen lädt und installiert Girovo im Startfenster, bevor sich das Fenster öffnet.' },
    /** The desktop app only: the Tauri shell (src-tauri) in place of Electron. */
    rust: { title: 'Rust in Girovo', text: 'Girovo für Windows und Linux läuft jetzt auf einer neuen, schlankeren Grundlage in Rust – vom Fenster bis zu den Updates.' },
    contracts: { title: 'Verträge, die sich melden', text: 'Wird ein Abo teurer, steht seit wann und um wie viel im Jahr. Und wenn du willst, erinnert Girovo dich vor der Kündigungsfrist.' },
    /** The desktop: "Frag deine Umsätze" with the built-in model (components/insights/Ask.tsx). */
    ask: { title: 'Frag deine Umsätze', text: 'Stell in der Analyse eine Frage wie „Wie viel ging letzten Monat an Rewe?“. Girovo rechnet die Antwort auf diesem Rechner aus.' },
  },

  /** The update dialog and the places that point to it (components/updates). */
  updates: {
    title: 'Updates',
    ready: (v: string) => `Version ${v} ist bereit`,
    available: (v: string) => `Version ${v} ist verfügbar`,
    /** The desktop's way back from a preview to the stable release (Update-Kanal "Stabil"). */
    backTo: (v: string) => `Zurück zu Version ${v}`,
    backNote: 'Diese Version ist älter als deine Nightly. Was es nur in der Nightly gibt, etwa die Anordnung deiner Konten, geht dabei verloren.',
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
        ? 'Die Überweisung mit unklarem Status steht nach dem Neustart nicht mehr in den Mitteilungen – prüfe sie vorher in deinen Umsätzen.'
        : `Die ${n} Überweisungen mit unklarem Status stehen nach dem Neustart nicht mehr in den Mitteilungen – prüfe sie vorher in deinen Umsätzen.`,
    cannotUpdate: 'Diese Version der App kann sich nicht selbst aktualisieren. Lade die neue Version auf GitHub herunter.',
    noFile: 'Für diese Version gibt es keine Datei, die die App prüfen könnte. Lade sie auf GitHub herunter.',
    restarts: 'Girovo wird beendet, installiert die neue Version und startet von selbst neu – meist in weniger als einer Minute.',
    logsOut: 'Du wirst dabei abgemeldet.',
    approvalRunning: 'Gerade läuft eine Freigabe. Neu starten kannst du, sobald sie abgeschlossen ist.',
    checking: 'Suche nach Updates …',
    latest: 'Du nutzt die neueste Version.',
    lastChecked: (time: ReactNode) => ['Zuletzt geprüft: ', time],
    autoOff: 'Die App sucht nicht von selbst nach Updates.',
    whatsNew: 'Was ist neu',
    onGitHub: 'Auf GitHub',
    downloading: 'Wird heruntergeladen …',
    progress: 'Download des Updates',
    percent: (n: number) => `${n} Prozent`,
    checksum: 'Die Datei wird vor der Installation mit der Prüfsumme von GitHub abgeglichen.',
    auto: 'Automatisch nach Updates suchen',
    autoHint:
      'Beim Start und alle sechs Stunden. Die Anfrage an GitHub enthält nur die Versionsnummer der App. Wie bei jedem Abruf sieht GitHub dabei deine IP-Adresse – nichts über deine Konten.',
    /** The installed Windows app: the same switch, which also installs at start (src-tauri/src/updater/start.rs). */
    autoInstall: 'Updates automatisch installieren',
    autoInstallHint:
      'Beim Start sucht Girovo nach einer neuen Version, lädt sie herunter und installiert sie, bevor das Fenster aufgeht; zwischendurch wird alle sechs Stunden nachgesehen. Aus: nur, wenn du es sagst. Die Anfrage an GitHub enthält nur die Versionsnummer der App. Wie bei jedem Abruf sieht GitHub dabei deine IP-Adresse – nichts über deine Konten.',
    // The toasts, the Mitteilungen row, the Sitzung panel's row and the login bar's button.
    downloaded: (v: string) => `Version ${v} ist heruntergeladen. Installiert wird erst, wenn du neu startest.`,
    details: 'Details',
    /** The first start after the update from a version called Sooskasse-FinTS. */
    renamed: (v: string) => `Sooskasse-FinTS heißt jetzt Girovo. Version ${v} ist installiert.`,
    updated: (v: string) => `Girovo wurde auf Version ${v} aktualisiert.`,
    whatsNewAsk: 'Was ist neu?',
    notCompleted: (v: string) => `Das Update auf Version ${v} wurde nicht abgeschlossen.`,
    readyToInstall: (v: string) => `Version ${v} ist bereit zur Installation`,
    updatedTo: (v: string) => `Aktualisiert auf Version ${v}`,
    stillOn: (current: ReactNode) => ['Du nutzt noch Version ', current, '. Installiert wird erst, wenn du neu startest.'],
    notYetDownloaded: (current: ReactNode) => [
      'Du nutzt Version ', current, '. Heruntergeladen wird erst, wenn du auf „Herunterladen“ klickst.',
    ],
    installNow: 'Jetzt installieren …',
    detailsAndDownload: 'Details und Download …',
    /** The installed Windows app: updates only through the start window (src-tauri/src/updater/start.rs). */
    detailsAndRestart: 'Details und Neustart …',
    restartToInstall: 'Jetzt neu starten und installieren',
    restartToGoBack: (v: string) => `Neu starten und zu Version ${v} zurück`,
    restartLogsOut: 'Beim Neustart wirst du abgemeldet.',
    orAtNextStart: 'Ohne Neustart wird das Update beim nächsten Start installiert.',
    atStartNote: (current: ReactNode) => ['Du nutzt Version ', current, '. Installiert wird beim nächsten Start – oder gleich mit einem Neustart.'],
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
  greeting: (hour) => (hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'),
  countdown: (s) => {
    if (s >= 120) return `${Math.ceil(s / 60)} minutes`;
    if (s > 60) return `${Math.floor(s / 60)} minute and ${s % 60 === 1 ? '1 second' : `${s % 60} seconds`}`;
    if (s === 60) return '1 minute';
    return s === 1 ? '1 second' : `${s} seconds`;
  },

  singleKeys: {
    name: 'Single-key shortcuts',
    keys: '/, ?, N, B, G and 1–9',
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
    inboxHint: 'Messages from your bank and this session’s activity',
    updateTo: (version) => `Update to version ${version}`,
    installed: (version) => `Installed: version ${version}`,
    selected: 'Selected',
    showAll: (query) => `Show all results for “${query}”`,
    ask: (question) => `Ask “${question}”`,
    askHint: 'Ask your transactions · worked out on this phone',
    askHintDesktop: 'Ask your transactions · worked out on this computer',
    inSelected: (n) => `${n} ${n === 1 ? 'transaction' : 'transactions'} in the selected account`,
    newest: (shown, total) => `The newest ${shown} of ${total} results`,
    noResults: (query) => `No results for “${query}”`,
    results: (n, txNote) => `${n === 1 ? '1 result' : `${n} results`}${txNote ? ` · Transactions: ${txNote}` : ''}`,
    field: 'Search for a transaction, account or action',
    placeholder: 'Search for a transaction, account or action…',
    intro: 'Type a name, payment reference or amount to search the loaded transactions.',
    resultsLabel: 'Results',
    emptyHint:
      'Search for an action like “Transfer”, for an account or for loaded transactions – a name, payment reference or amount like “12.99”.',
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
      singleKeys: ['keyboard shortcuts', 'shortcuts', 'single keys', 'voice control', 'accessibility', 'keyboard'],
      updates: ['update', 'updates', 'new version', 'version', 'upgrade', 'install'],
      channel: ['update channel', 'nightly', 'preview', 'beta', 'pre-release', 'early access'],
      loginBalances: ['balances', 'login', 'load automatically'],
      loginBookings: ['transactions', 'login', 'load automatically', 'all accounts', 'launch'],
      keepBalances: ['keep balances', 'saved balances', 'total balance history'],
      alerts: ['notifications', 'alerts', 'price increase', 'salary', 'balance', 'warning'],
      shortcuts: ['shortcuts', 'keyboard', 'help', 'keys', 'hotkeys'],
    },
  },

  shortcuts: {
    description: 'Single keys only work while you’re not typing in a field – and can be turned off completely.',
    switchHint: (palette, toastKey) =>
      `/, ?, N, B, G and 1–9. Turn them off if you use voice control or easily hit keys by accident. ${palette}, Alt+1–3 and ${toastKey} stay on.`,
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
      ' for Contracts & subscriptions. A number switches to an account that has already been loaded.',
    ],
    to: 'to',
    or: 'or',
    plus: 'plus',
  },

  amounts: {
    shown: 'Amounts are shown again.',
    hiddenB: 'Amounts hidden – press B to show them again.',
    hidden: 'Amounts hidden.',
  },

  switchByKey: {
    busy: (account) => `“${account}” can be selected once the current task has finished.`,
    failed: (account) => `The last attempt to load “${account}” failed. Trying again may need approval.`,
    otherPeriod: (account) =>
      `The transactions of “${account}” were loaded for a different period. Loading them again may need approval.`,
    notLoaded: (account) => `“${account}” hasn’t been loaded yet. Loading it may need approval.`,
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
      `Received when you logged in at ${time}. Messages aren’t stored – after you log out, they’re no longer shown here.`,
    none: 'No messages',
    noneHint: 'Your bank sent no messages at this login. You’ll see new ones after your next login.',
    noneNotAsked: 'On a remembered device, Girovo doesn’t ask your bank for messages when you log in.',
    activity: 'This session’s activity',
    noActivity: 'No transfers in this session yet. Completed, rejected and unclear orders stay here until you log out.',
    thisApp: 'This app',
    new: '(new)',
    copyText: 'Copy text',
    contracts: 'Contracts & subscriptions',
    priceRose: (name, month) => `${name}: dearer since ${month}`,
    priceDetail: (delta, perYear) => [delta, ' more per payment – ', perYear, ' per year'],
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
    unclear: 'It’s not known whether the bank carried out the order. Check your transactions before you repeat it.',
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
    noneShown: 'No account ticked. Tick an account on the left to see its transactions.',
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
    noTransactions: 'Your bank doesn’t provide transactions for this account – so there’s no account statement either.',
    loading: 'The transactions are loading. The account statement will be available after that.',
    notLoaded: 'The account statement is available once this account’s transactions have loaded.',
  },

  lookAtUnclear: {
    one: 'Check transactions',
    several: 'View in Messages',
  },

  newInSix: {
    title: 'New in Girovo 6',
    intro: 'A few new features are yours to turn on, because they keep a PIN or reach beyond this device. You can do it right here or later in Settings.',
    introPlain: 'What changed with version 6.',
    toTurnOn: 'To turn on',
    alsoNew: 'Also new',
    done: 'Done',
    row: 'New in Girovo 6',
    rowHint: 'What version 6 brings, and what you can turn on for it',
    overview: { title: 'All accounts at a glance', text: 'With several accounts, the overview shows them all together, with the total balance above.' },
    frame: { title: 'A new window', text: 'A sidebar with your accounts to show and hide, and search in the title bar.' },
    widget: { title: 'Home screen widget', text: 'Your total balance, covered until you tap. Touch and hold the home screen and pick “Widgets”.' },
    orders: { title: 'Orders', text: 'Your bank’s standing orders and scheduled transfers on a page of their own under Payments.' },
    kept: { title: 'Last balances', text: 'The last balances stay visible until your next login, with the total balance’s history.' },
    cards: { title: 'Sparkasse credit cards', text: 'The transactions of your Sparkasse credit card, where the bank offers them.' },
    updates: { title: 'Updates at start', text: 'Girovo downloads and installs new versions in the start window, before the window opens.' },
    rust: { title: 'Rust in Girovo', text: 'Girovo for Windows and Linux now runs on a new, leaner foundation built in Rust — from the window to the updates.' },
    contracts: { title: 'Contracts that speak up', text: 'When a subscription gets dearer, you see since when and how much it adds up to in a year. And if you like, Girovo reminds you before the notice period ends.' },
    ask: { title: 'Ask your transactions', text: 'Ask a question in the Analysis, such as “How much went to Rewe last month?”. Girovo works out the answer on this computer.' },
  },

  updates: {
    title: 'Updates',
    ready: (v) => `Version ${v} is ready`,
    available: (v) => `Version ${v} is available`,
    backTo: (v) => `Back to version ${v}`,
    backNote: 'This version is older than your nightly. Anything only the nightly has, such as the order of your accounts, is lost.',
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
        ? 'After the restart, the transfer with an unclear status will no longer be in Messages – check it in your transactions first.'
        : `After the restart, the ${n} transfers with an unclear status will no longer be in Messages – check them in your transactions first.`,
    cannotUpdate: 'This version of the app can’t update itself. Download the new version from GitHub.',
    noFile: 'There’s no file for this version that the app could verify. Download it from GitHub.',
    restarts: 'Girovo closes, installs the new version and restarts by itself – usually in less than a minute.',
    logsOut: 'You’ll be logged out in the process.',
    approvalRunning: 'An approval is in progress. You can restart once it’s complete.',
    checking: 'Checking for updates…',
    latest: 'You’re using the latest version.',
    lastChecked: (time) => ['Last checked: ', time],
    autoOff: 'The app doesn’t check for updates by itself.',
    whatsNew: 'What’s new',
    onGitHub: 'On GitHub',
    downloading: 'Downloading…',
    progress: 'Update download',
    percent: (n) => `${n} per cent`,
    checksum: 'Before it’s installed, the file is checked against GitHub’s checksum.',
    auto: 'Check for updates automatically',
    autoHint:
      'At start-up and every six hours. The request to GitHub contains only the app’s version number. As with any request, GitHub sees your IP address – nothing about your accounts.',
    autoInstall: 'Install updates automatically',
    autoInstallHint:
      'At start-up Girovo looks for a new version, downloads it and installs it before the window opens; in between it checks every six hours. Off: only when you ask. The request to GitHub contains only the app’s version number. As with any request, GitHub sees your IP address – nothing about your accounts.',
    downloaded: (v) => `Version ${v} has been downloaded. It’s only installed when you restart.`,
    details: 'Details',
    renamed: (v) => `Sooskasse-FinTS is now called Girovo. Version ${v} is installed.`,
    updated: (v) => `Girovo has been updated to version ${v}.`,
    whatsNewAsk: 'What’s new?',
    notCompleted: (v) => `The update to version ${v} was not completed.`,
    readyToInstall: (v) => `Version ${v} is ready to install`,
    updatedTo: (v) => `Updated to version ${v}`,
    stillOn: (current) => ['You’re still using version ', current, '. It’s only installed when you restart.'],
    notYetDownloaded: (current) => ['You’re using version ', current, '. Nothing is downloaded until you click “Download”.'],
    installNow: 'Install now…',
    detailsAndDownload: 'Details and download…',
    detailsAndRestart: 'Details and restart…',
    restartToInstall: 'Restart and install now',
    restartToGoBack: (v) => `Restart and go back to version ${v}`,
    restartLogsOut: 'Restarting logs you out.',
    orAtNextStart: 'Without a restart, it’s installed the next time you open Girovo.',
    atStartNote: (current) => ['You’re using version ', current, '. It’s installed at the next start – or right away with a restart.'],
    whatsNewOpen: 'See what’s new…',
    loadingPct: (pct) => `Downloading… ${pct}%`,
    readyTag: 'Ready to install',
    barReady: 'Update ready',
    barAvailable: 'Update available',
    barTitle: (label, v) => `${label}: version ${v}`,
  },
};
