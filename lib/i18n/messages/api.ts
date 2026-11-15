// Girovo API (Girovo Next, desktop; docs/girovo-api.md): the dialog an app's
// request opens (components/api/ApiConsent.tsx) and Einstellungen → Girovo API
// (components/api/ApiSettings.tsx).

import type { ApiErrorCode, ApiPermission, TransferState } from '../../api/types';

const permissionsDe: Record<ApiPermission, string> = {
  'accounts.read': 'Konten und Salden lesen',
  'transactions.read': 'Umsätze lesen',
  'insights.read': 'Analyse, Verträge, Budgets und Sparziele lesen',
  ask: 'Girovo AI fragen',
  'categories.write': 'Kategorien ändern',
  'notes.write': 'Notizen schreiben',
  'budgets.write': 'Budgets und Sparziele ändern',
  'settings.read': 'Einstellungen lesen',
  'settings.write': 'Einstellungen ändern',
  'bank.refresh': 'Neue Umsätze von der Bank holen',
  'transfers.request': 'Überweisungen vorschlagen',
};

const permissionsEn: Record<ApiPermission, string> = {
  'accounts.read': 'Read accounts and balances',
  'transactions.read': 'Read transactions',
  'insights.read': 'Read analysis, contracts, budgets and savings goals',
  ask: 'Ask Girovo AI',
  'categories.write': 'Change categories',
  'notes.write': 'Write notes',
  'budgets.write': 'Change budgets and savings goals',
  'settings.read': 'Read settings',
  'settings.write': 'Change settings',
  'bank.refresh': 'Get new transactions from the bank',
  'transfers.request': 'Suggest transfers',
};

export const de = {
  permissions: permissionsDe,
  /** One line under a permission that needs more than its name. */
  permissionHints: {
    'bank.refresh': 'Braucht die Bank eine Freigabe, fragt dich Girovo.',
    'transfers.request': 'Du prüfst und sendest jede Überweisung selbst in Girovo.',
  } as Partial<Record<ApiPermission, string>>,

  /** The dialog, like Windows' UAC. */
  consent: {
    title: 'Darf diese App auf Girovo zugreifen?',
    titleMore: 'Darf diese App mehr tun?',
    publisher: (name: string) => `Herausgeber: ${name}`,
    publisherUnknown: 'Herausgeber: unbekannt',
    verified: 'Bestätigter Herausgeber',
    viaMcp: 'über Girovo MCP',
    /** The name the app gave itself, where it is not the one Girovo found. */
    saysItIs: (name: string) => `Nennt sich „${name}“`,
    elevated: 'Läuft als Administrator',
    unknownWarning: 'Girovo kann nicht prüfen, von wem diese App stammt. Lass sie nur zu, wenn du ihr vertraust.',
    reasonLabel: 'Die App schreibt',
    asks: 'Sie möchte',
    asksMore: 'Sie möchte zusätzlich',
    allow: 'Zulassen',
    refuse: 'Ablehnen',
    /** The app's icon, for a screen reader. */
    icon: (name: string) => `Symbol von ${name}`,
  },

  /** Einstellungen → Girovo API. */
  page: {
    use: 'Girovo API zulassen',
    hint: 'Apps auf diesem Rechner können mit Girovo arbeiten, wenn du es erlaubst.',
    local: 'Webseiten und andere Geräte erreichen Girovo darüber nicht.',
    apps: 'Apps',
    noApps: 'Noch keine App zugelassen.',
    revoke: 'Zugriff entziehen',
    lastUsed: (when: string) => `zuletzt ${when}`,
    neverUsed: 'noch nicht verwendet',
    unknownPublisher: 'Herausgeber unbekannt',
    log: 'Verlauf',
    noLog: 'Noch keine Anfragen.',
    /** Under the newest three: the rest of the Verlauf. */
    showAll: (n: number) => `Alle anzeigen (${n})`,
    showLess: 'Weniger anzeigen',
    developers: 'Für Entwickler',
    docs: 'Dokumentation',
    /** Girovo API and Girovo MCP for developers, in the reader's language. */
    docsUrl: 'https://developer.girovo.de/',
    /** What a call did, in the Verlauf. */
    methods: {
      hello: 'Hat sich angemeldet',
      'accounts.list': 'Konten gelesen',
      'transactions.list': 'Umsätze gelesen',
      'contracts.list': 'Verträge gelesen',
      'budgets.list': 'Budgets gelesen',
      'goals.list': 'Sparziele gelesen',
      'insights.month': 'Analyse gelesen',
      'categories.set': 'Kategorie geändert',
      'rules.add': 'Regel für Kategorie angelegt',
      'categories.create': 'Eigene Kategorie angelegt',
      'notes.set': 'Notiz geändert',
      'budgets.set': 'Budget geändert',
      'goals.set': 'Sparziel geändert',
      'reminders.set': 'Erinnerung geändert',
      'contracts.rename': 'Vertrag umbenannt',
      'settings.get': 'Einstellungen gelesen',
      'settings.set': 'Einstellung geändert',
      'bank.refresh': 'Neue Umsätze geholt',
      'transfers.request': 'Überweisung angefragt',
      'transfers.status': 'Überweisung nachgefragt',
      'events.subscribe': 'Meldungen abonniert',
      'events.unsubscribe': 'Meldungen abbestellt',
    } as Record<string, string>,
    /** The setting settings.set changed, by its key (lib/api/settings.ts). */
    settings: {
      language: 'Sprache',
      theme: 'Design',
      blackBackground: 'Schwarzer Hintergrund',
      idleMinutes: 'Automatisch abmelden',
      balancesAtLogin: 'Salden beim Anmelden abrufen',
      bookingsAtLogin: 'Umsätze beim Anmelden abrufen',
      keepBalances: 'Letzte Salden behalten',
      keepBookings: 'Umsätze behalten',
      companyLogos: 'Firmenlogos',
      ai: 'Girovo AI',
      aiTone: 'Ton von Girovo AI',
      aiLength: 'Länge der Antworten',
      aiUseName: 'Mit Vornamen ansprechen',
      aiNames: 'Namen aufräumen',
      singleKeyShortcuts: 'Tastenkürzel mit einer Taste',
      accountOrder: 'Reihenfolge der Konten',
      accountGrouping: 'Gruppierung der Konten',
      hiddenAccounts: 'Ausgeblendete Konten',
      // Never through the API: named when an app tried.
      pin: 'PIN',
      windowsHello: 'Windows Hello',
      securityKeys: 'Sicherheitsschlüssel',
      linkedUnlock: 'Weitere Banken mit anmelden',
      forgetDevice: 'Gerät vergessen',
      deviceRemembered: 'Gerät vergessen',
      deleteData: 'Daten löschen',
      resetData: 'Daten zurücksetzen',
      wipeData: 'Daten löschen',
      resetHistory: 'Umsätze neu beginnen',
      restoreBackup: 'Sicherung wiederherstellen',
      backup: 'Sicherung',
      api: 'Girovo API',
      apiOn: 'Girovo API',
      apiGrants: 'Zugriffe der Apps',
      updateChannel: 'Updatekanal',
      earlyUpdates: 'Neueste Updates sofort',
      autoUpdates: 'Automatische Updates',
      installUpdate: 'Update installieren',
      usageData: 'Nutzungsdaten',
      backgroundChecks: 'Neue Umsätze melden',
      sync: 'Abgleich',
    } as Record<string, string>,
    /** Where a transfer an app asked for stands. */
    transfer: {
      pending: 'Wartet auf dich',
      sent: 'Gesendet',
      refused: 'Nicht gesendet',
      failed: 'Fehlgeschlagen',
      unclear: 'Status unklar',
    } satisfies Record<TransferState, string>,
    /** Why a call was not answered. */
    outcomes: {
      locked: 'Girovo war gesperrt',
      denied: 'Abgelehnt',
      not_permitted: 'Nicht erlaubt',
      invalid: 'Ungültig',
      refused_by_user: 'Von dir abgelehnt',
      bank_error: 'Fehler der Bank',
      method_not_found: 'Unbekannt',
      internal: 'Fehler in Girovo',
      timeout: 'Keine Antwort von dir',
    } satisfies Record<ApiErrorCode, string>,
  },

  /** Einstellungen → Girovo API: setting up an AI assistant with Girovo MCP (src-tauri/mcp-helper). */
  mcp: {
    title: 'Mit KI-Assistenten verbinden',
    hint: 'Assistenten wie Claude arbeiten über Girovo MCP mit Girovo. Was sie dürfen, entscheidest du.',
    needsApi: 'Dafür muss Girovo API an sein.',
    helper: 'Girovo MCP',
    missing: 'In dieser Version ist Girovo MCP nicht dabei.',
    cloud: 'Was ein Assistent liest, geht an seinen Anbieter, außer er läuft auf deinem Rechner.',
  },

  /** The transfer sheet opened for an app's request (components/TransferSheet.tsx). */
  request: {
    from: (app: string, publisher: string | null) => `Angefragt von ${app} (${publisher ?? 'Herausgeber unbekannt'})`,
    hint: 'Prüf alles. Gesendet wird erst, wenn du selbst sendest.',
  },

  /** The login while an app's request waits for it (components/api/ApiWaitingNotice.tsx). */
  waiting: (app: string, publisher: string | null, more: number) => {
    const who = `${app} (${publisher ?? 'Herausgeber unbekannt'})`;
    const asks = more === 0 ? `${who} möchte` : more === 1 ? `${who} und eine weitere App möchten` : `${who} und ${more} weitere Apps möchten`;
    return `${asks} auf Girovo zugreifen. Melde dich an, um zu entscheiden.`;
  },

  /** Einstellungen' list. */
  summaryOff: 'Aus',
  summaryOn: (apps: number) => (apps ? `An · ${apps === 1 ? 'eine App' : `${apps} Apps`}` : 'An'),
};

export const en: typeof de = {
  permissions: permissionsEn,
  permissionHints: {
    'bank.refresh': 'If the bank needs an approval, Girovo asks you.',
    'transfers.request': 'You check and send every transfer yourself in Girovo.',
  },

  consent: {
    title: 'Allow this app to access Girovo?',
    titleMore: 'Allow this app to do more?',
    publisher: (name: string) => `Publisher: ${name}`,
    publisherUnknown: 'Publisher: unknown',
    verified: 'Verified publisher',
    viaMcp: 'through Girovo MCP',
    saysItIs: (name: string) => `Calls itself “${name}”`,
    elevated: 'Runs as administrator',
    unknownWarning: 'Girovo cannot check who made this app. Only allow it if you trust it.',
    reasonLabel: 'The app says',
    asks: 'It would like to',
    asksMore: 'It would also like to',
    allow: 'Allow',
    refuse: 'Refuse',
    icon: (name: string) => `Icon of ${name}`,
  },

  page: {
    use: 'Allow Girovo API',
    hint: 'Apps on this computer can work with Girovo if you allow it.',
    local: "Websites and other devices can't reach Girovo this way.",
    apps: 'Apps',
    noApps: 'No app allowed yet.',
    revoke: 'Remove access',
    lastUsed: (when: string) => `last used ${when}`,
    neverUsed: 'not used yet',
    unknownPublisher: 'Unknown publisher',
    log: 'History',
    noLog: 'No requests yet.',
    showAll: (n) => `Show all (${n})`,
    showLess: 'Show less',
    developers: 'For developers',
    docs: 'Documentation',
    docsUrl: 'https://developer.girovo.de/en',
    methods: {
      hello: 'Signed in',
      'accounts.list': 'Read accounts',
      'transactions.list': 'Read transactions',
      'contracts.list': 'Read contracts',
      'budgets.list': 'Read budgets',
      'goals.list': 'Read savings goals',
      'insights.month': 'Read analysis',
      'categories.set': 'Changed a category',
      'rules.add': 'Added a category rule',
      'categories.create': 'Added an own category',
      'notes.set': 'Changed a note',
      'budgets.set': 'Changed a budget',
      'goals.set': 'Changed a savings goal',
      'reminders.set': 'Changed a reminder',
      'contracts.rename': 'Renamed a contract',
      'settings.get': 'Read settings',
      'settings.set': 'Changed a setting',
      'bank.refresh': 'Got new transactions',
      'transfers.request': 'Asked for a transfer',
      'transfers.status': 'Checked a transfer',
      'events.subscribe': 'Subscribed to updates',
      'events.unsubscribe': 'Unsubscribed from updates',
    },
    settings: {
      language: 'Language',
      theme: 'Theme',
      blackBackground: 'Black background',
      idleMinutes: 'Automatic logout',
      balancesAtLogin: 'Get balances at login',
      bookingsAtLogin: 'Get transactions at login',
      keepBalances: 'Keep last balances',
      keepBookings: 'Keep transactions',
      companyLogos: 'Company logos',
      ai: 'Girovo AI',
      aiTone: 'Tone of Girovo AI',
      aiLength: 'Length of answers',
      aiUseName: 'Use first name',
      aiNames: 'Tidy names',
      singleKeyShortcuts: 'Single key shortcuts',
      accountOrder: 'Order of accounts',
      accountGrouping: 'Grouping of accounts',
      hiddenAccounts: 'Hidden accounts',
      pin: 'PIN',
      windowsHello: 'Windows Hello',
      securityKeys: 'Security keys',
      linkedUnlock: 'Log in to further banks too',
      forgetDevice: 'Forget device',
      deviceRemembered: 'Forget device',
      deleteData: 'Delete data',
      resetData: 'Reset data',
      wipeData: 'Delete data',
      resetHistory: 'Start transactions over',
      restoreBackup: 'Restore backup',
      backup: 'Backup',
      api: 'Girovo API',
      apiOn: 'Girovo API',
      apiGrants: 'App access',
      updateChannel: 'Update channel',
      earlyUpdates: 'Newest updates at once',
      autoUpdates: 'Automatic updates',
      installUpdate: 'Install update',
      usageData: 'Usage data',
      backgroundChecks: 'Report new transactions',
      sync: 'Sync',
    },
    transfer: {
      pending: 'Waiting for you',
      sent: 'Sent',
      refused: 'Not sent',
      failed: 'Failed',
      unclear: 'Status unclear',
    },
    outcomes: {
      locked: 'Girovo was locked',
      denied: 'Refused',
      not_permitted: 'Not allowed',
      invalid: 'Invalid',
      refused_by_user: 'Refused by you',
      bank_error: 'Bank error',
      method_not_found: 'Unknown',
      internal: 'Error in Girovo',
      timeout: 'You did not answer',
    },
  },

  mcp: {
    title: 'Connect AI assistants',
    hint: 'Assistants like Claude work with Girovo through Girovo MCP. You decide what they may do.',
    needsApi: 'Girovo API has to be on for this.',
    helper: 'Girovo MCP',
    missing: 'Girovo MCP is not part of this version.',
    cloud: 'What an assistant reads goes to its provider, unless it runs on your computer.',
  },

  request: {
    from: (app: string, publisher: string | null) => `Requested by ${app} (${publisher ?? 'unknown publisher'})`,
    hint: 'Check everything. Nothing is sent until you send it yourself.',
  },

  waiting: (app: string, publisher: string | null, more: number) => {
    const who = `${app} (${publisher ?? 'unknown publisher'})`;
    const asks = more === 0 ? `${who} wants` : more === 1 ? `${who} and one more app want` : `${who} and ${more} more apps want`;
    return `${asks} to access Girovo. Log in to decide.`;
  },

  summaryOff: 'Off',
  summaryOn: (apps: number) => (apps ? `On · ${apps === 1 ? 'one app' : `${apps} apps`}` : 'On'),
};
